/*---------------------------------------------------------------------------------------------
 *  LSP Client for R Sessions
 *  Based on positron-r/src/lsp.ts
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { Socket } from 'net';
import type {
    ILanguageLsp,
    ILanguageConsoleLspConfiguration,
    ILanguageLspStateChangeEvent,
    LanguageLspState,
    LanguageRuntimeDynState,
    IRuntimeSessionMetadata,
} from '../types/supervisor-api';
import {
    LanguageClient,
    LanguageClientOptions,
    State,
    MessageTransports,
    RevealOutputChannelOn,
    DocumentSelector,
    DidChangeConfigurationNotification,
} from 'vscode-languageclient/node';
import { RErrorHandler } from './error-handler';
import { HostConsoleLspBridge } from './console-lsp';
import { VirtualDocumentProvider } from './virtual-documents';
import { RStatementRangeProvider } from './statement-range';
import { RInputBoundaryProvider } from './input-boundaries';
import { RHelpTopicProvider } from './help';
import {
    getArkLspSettings,
    mapArkLspConfiguration,
    toLanguageClientTrace,
} from './lsp-settings';

const LANGUAGE_LSP_STATE = {
    Uninitialized: 'uninitialized' as LanguageLspState,
    Starting: 'starting' as LanguageLspState,
    Stopped: 'stopped' as LanguageLspState,
    Running: 'running' as LanguageLspState,
} as const;

/**
 * Promise with exposed resolve/reject handles
 */
class PromiseHandles<T> {
    resolve!: (value: T | PromiseLike<T>) => void;
    reject!: (reason?: any) => void;
    promise: Promise<T>;

    constructor() {
        this.promise = new Promise<T>((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
}

/**
 * Timeout helper - returns a promise that rejects after the given duration
 */
function timeout(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Timeout: ${message}`)), ms);
    });
}

/**
 * R document selectors for LSP (from positron-r)
 */
export const R_DOCUMENT_SELECTORS: DocumentSelector = [
    { language: 'r', scheme: 'untitled' },
    { language: 'r', scheme: 'inmemory' }, // Console
    { language: 'r', scheme: 'assistant-code-confirmation-widget' },
    { language: 'r', pattern: '**/*.{r,R}' },
    { language: 'r', pattern: '**/*.{rprofile,Rprofile}' },
    { language: 'r', pattern: '**/*.rt' },
    { language: 'r', pattern: '**/*.rhistory' },
];

// Regex to match Quarto virtual document files: .vdoc.[uuid].[ext]
export const VDOC_PATTERN = /^\.vdoc\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.\w+$/i;

// Selector for Quarto virtual documents.
export const VDOC_SELECTOR = { language: 'r', pattern: '**/.vdoc.*.{r,R}' };

// Regex to match notebook console REPL URIs: /notebook-repl-<lang>-<uuid>
export const NOTEBOOK_REPL_PATTERN = /^\/notebook-repl-/;

export function getDocumentSelectorForSession(notebookUri?: vscode.Uri): DocumentSelector {
    if (!notebookUri) {
        return R_DOCUMENT_SELECTORS;
    }

    return [
        { language: 'r', pattern: notebookUri.fsPath },
        VDOC_SELECTOR,
        { language: 'r', scheme: 'inmemory' },
    ];
}

export function shouldHandleLspDiagnostics(uri: vscode.Uri): boolean {
    if (uri.scheme === 'assistant-code-confirmation-widget') {
        return false;
    }

    if (uri.scheme === 'file') {
        const baseName = path.basename(uri.fsPath);
        if (VDOC_PATTERN.test(baseName)) {
            return false;
        }
    }

    return true;
}

export function shouldProvideCompletionForDocument(
    documentUri: vscode.Uri,
    notebookUri?: vscode.Uri,
): boolean {
    if (!notebookUri) {
        if (documentUri.scheme === 'file') {
            const baseName = path.basename(documentUri.fsPath);
            if (VDOC_PATTERN.test(baseName)) {
                return false;
            }
        }

        if (
            documentUri.scheme === 'inmemory' &&
            NOTEBOOK_REPL_PATTERN.test(documentUri.path)
        ) {
            return false;
        }

        return true;
    }

    if (
        documentUri.scheme === 'inmemory' &&
        !NOTEBOOK_REPL_PATTERN.test(documentUri.path)
    ) {
        return false;
    }

    return true;
}

/**
 * Global output channel for R LSP sessions
 *
 * Foreground switches can briefly overlap while services are handed off between
 * sessions, and the start of each session is logged with a session ID, so we
 * use a single output channel for all LSP sessions.
 */
let _lspOutputChannel: vscode.LogOutputChannel | undefined;
function getLspOutputChannel(): vscode.LogOutputChannel {
    if (!_lspOutputChannel) {
        _lspOutputChannel = vscode.window.createOutputChannel('R Language Server', { log: true });
    }
    return _lspOutputChannel;
}

export function disposeLspOutputChannel(): void {
    _lspOutputChannel?.dispose();
    _lspOutputChannel = undefined;
}

/**
 * Wraps an instance of the client side of the R language server.
 * Each R session has its own RLanguageLsp instance.
 */
export class RLanguageLsp implements ILanguageLsp {
    /** The language client instance, if it has been created */
    private client?: LanguageClient;
    readonly consoleLspBridge = new HostConsoleLspBridge(() => this.client);

    private _state: LanguageLspState = LANGUAGE_LSP_STATE.Uninitialized;
    private _stateEmitter = new vscode.EventEmitter<ILanguageLspStateChangeEvent>();
    onDidChangeState = this._stateEmitter.event;

    /** Promise that resolves after initialization is complete */
    private _initializing?: Promise<void>;

    /** Disposable for per-activation items */
    private activationDisposables: vscode.Disposable[] = [];

    /** Positron LSP extension providers */
    private _statementRangeProvider?: RStatementRangeProvider;
    private _inputBoundaryProvider?: RInputBoundaryProvider;
    private _helpTopicProvider?: RHelpTopicProvider;
    private _virtualDocumentProvider?: VirtualDocumentProvider;

    private languageClientName: string;
    private _logChannel: vscode.LogOutputChannel;

    public constructor(
        private readonly _version: string,
        private readonly _metadata: IRuntimeSessionMetadata,
        private readonly _dynState: LanguageRuntimeDynState,
        logChannel: vscode.LogOutputChannel,
    ) {
        this.languageClientName =
            `R language client (${this._version}) for session ` +
            `${_dynState.sessionName} - '${_metadata.sessionId}'`;
        this._logChannel = logChannel;
    }

    /** Console preferences; the Host client owns server initialization and configuration. */
    public get consoleLspConfiguration(): ILanguageConsoleLspConfiguration | undefined {
        if (this._metadata.sessionMode !== 'console') {
            return undefined;
        }

        const workingDirectory = this._dynState.currentWorkingDirectory ?? this._metadata.workingDirectory;
        const folder = workingDirectory
            ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(workingDirectory))
            : undefined;
        const root = folder ?? vscode.workspace.workspaceFolders?.[0];
        const settings = getArkLspSettings(root?.uri);
        // Ark requests nested positron.r.* sections through workspace/configuration.
        // Supply both prefixes so the browser follows the Host's canonical mapping.
        const rSettings = {
            ...settings,
            diagnostics: { ...settings.diagnostics, enabled: settings.diagnostics.enable },
        };

        return {
            rootUri: root?.uri.toString(),
            workspaceFolders: vscode.workspace.workspaceFolders?.map(folder => ({
                uri: folder.uri.toString(),
                name: folder.name,
            })),
            settings: { ark: { lsp: rSettings }, positron: { r: rSettings } },
            allowedCommands: [],
            kernelCompletionFallback: true,
        };
    }

    private log(msg: string, level: vscode.LogLevel = vscode.LogLevel.Info): void {
        const prefix = `[LSP] `;
        switch (level) {
            case vscode.LogLevel.Error:
                this._logChannel.error(prefix + msg);
                break;
            case vscode.LogLevel.Warning:
                this._logChannel.warn(prefix + msg);
                break;
            case vscode.LogLevel.Debug:
                this._logChannel.debug(prefix + msg);
                break;
            default:
                this._logChannel.info(prefix + msg);
        }
    }

    private scheduleConfigurationRefresh(
        client: LanguageClient,
        notifyServer: boolean,
    ): void {
        // vscode-languageclient also watches configuration changes for its
        // legacy `positron.r.trace.server` setting. Apply Ark's canonical value
        // after the current event has reached every listener so it wins without
        // mutating the user's compatibility settings.
        queueMicrotask(() => {
            void this.refreshConfiguration(client, notifyServer).catch((error) => {
                this.log(`Failed to refresh LSP configuration: ${error}`, vscode.LogLevel.Warning);
            });
        });
    }

    private async refreshConfiguration(
        client: LanguageClient,
        notifyServer: boolean,
    ): Promise<void> {
        if (this.client !== client) {
            return;
        }

        const settings = getArkLspSettings(this._metadata.notebookUri);
        await client.setTrace(toLanguageClientTrace(settings.trace.server));

        if (notifyServer && this._state === LANGUAGE_LSP_STATE.Running) {
            // Ark uses the configuration pull model. The empty notification
            // tells it to request the affected positron.r.* sections again;
            // middleware below maps those requests to ark.lsp.* values.
            await client.sendNotification(DidChangeConfigurationNotification.type, {
                settings: null,
            });
        }
    }

    private setState(state: LanguageLspState) {
        const old = this._state;
        this._state = state;
        this._stateEmitter.fire({ oldState: old, newState: state });
    }

    /**
     * Activate the language server; returns a promise that resolves when the LSP is
     * activated.
     *
     * @param port The port on which the language server is listening.
     */
    public async activate(port: number): Promise<void> {
        this._inputBoundaryProvider = undefined;
        this.activationDisposables.forEach(disposable => disposable.dispose());
        this.activationDisposables = [];

        const consoleBridge = this.consoleLspBridge;
        const serverOptions = async (): Promise<MessageTransports> => {
            const out = new PromiseHandles<MessageTransports>();
            const socket = new Socket();

            socket.on('ready', () => {
                out.resolve(consoleBridge.createTransports(socket));
            });
            socket.on('error', (error) => {
                out.reject(error);
            });
            socket.connect(port);

            return out.promise;
        };

        const { notebookUri } = this._metadata;

        const clientOptions: LanguageClientOptions = {
            documentSelector: getDocumentSelectorForSession(notebookUri),
            synchronize: notebookUri
                ? undefined
                : {
                    fileEvents: vscode.workspace.createFileSystemWatcher('**/*.R'),
                },
            outputChannel: getLspOutputChannel(),
            revealOutputChannelOn: RevealOutputChannelOn.Never,
            errorHandler: new RErrorHandler(this._version, port, this._logChannel),
            middleware: {
                ...consoleBridge.middleware,
                handleDiagnostics(uri, diagnostics, next) {
                    if ((uri.scheme === 'inmemory' && uri.authority === 'console') || !shouldHandleLspDiagnostics(uri)) {
                        return undefined;
                    }

                    return next(uri, diagnostics);
                },
                provideCompletionItem(document, position, context, token, next) {
                    if (!shouldProvideCompletionForDocument(document.uri, notebookUri)) {
                        return undefined;
                    }

                    return next(document, position, context, token);
                },
                workspace: {
                    ...consoleBridge.middleware.workspace,
                    async configuration(params, token, next) {
                        const fallback = await next(params, token);
                        if (!Array.isArray(fallback)) {
                            return fallback;
                        }

                        return params.items.map((item, index) => {
                            const resource = item.scopeUri
                                ? vscode.Uri.parse(item.scopeUri)
                                : undefined;
                            return mapArkLspConfiguration(
                                item.section ?? undefined,
                                fallback[index],
                                getArkLspSettings(resource),
                            );
                        });
                    },
                },
            },
        };

        // With a `.` rather than a `-` so vscode-languageserver can look up related options correctly
        const id = 'positron.r';

        const message =
            `Creating language client ${this._dynState.sessionName} ` +
            `for session ${this._metadata.sessionId} on port ${port}`;

        this.log(message);
        getLspOutputChannel().appendLine(
            `\n=== R Language Server session ${this._metadata.sessionId} ` +
            `(${this._dynState.sessionName}), port ${port}, ${new Date().toISOString()} ===`,
        );

        this.client = new LanguageClient(id, this.languageClientName, serverOptions, clientOptions);
        const client = this.client;

        this.activationDisposables.push(vscode.workspace.onDidChangeConfiguration((event) => {
            const canonicalChanged = event.affectsConfiguration('ark.lsp');
            const compatibilityChanged = [
                'positron.r.diagnostics',
                'positron.r.symbols',
                'positron.r.workspaceSymbols',
                'positron.r.trace.server',
            ].some((section) => event.affectsConfiguration(section));
            if (!canonicalChanged && !compatibilityChanged) {
                return;
            }

            this.scheduleConfigurationRefresh(client, true);
        }));

        const out = new PromiseHandles<void>();
        this._initializing = out.promise;

        this.activationDisposables.push(this.client.onDidChangeState((event) => {
            const oldState = this._state;
            switch (event.newState) {
                case State.Starting:
                    this.setState(LANGUAGE_LSP_STATE.Starting);
                    break;
                case State.Running:
                    if (this._initializing) {
                        this.log(`${this.languageClientName} init successful`, vscode.LogLevel.Debug);
                        this._initializing = undefined;
                        if (this.client) {
                            this.registerPositronLspExtensions(this.client);
                            this.scheduleConfigurationRefresh(this.client, false);
                        }
                        out.resolve();
                    }
                    this.setState(LANGUAGE_LSP_STATE.Running);
                    break;
                case State.Stopped:
                    if (this._initializing) {
                        this.log(`${this.languageClientName} init failed`, vscode.LogLevel.Error);
                        out.reject('R language client stopped before initialization');
                    }
                    this.setState(LANGUAGE_LSP_STATE.Stopped);
                    break;
            }

            this.log(
                `${this.languageClientName} state changed ${oldState} => ${this._state}`,
                vscode.LogLevel.Debug,
            );
        }));

        this.client.start();
        await out.promise;
    }

    /**
     * Registers additional Positron-specific LSP methods. These programmatic
     * language features are not part of the LSP specification, and are
     * consequently not covered by vscode-languageserver, but are used by
     * Positron to provide additional functionality.
     *
     * In Supervisor, editor-facing callers explicitly choose the correct
     * session and then access the providers from that session.
     *
     * @param client The language client instance
     */
    private registerPositronLspExtensions(client: LanguageClient): void {
        this.log('Registering Positron LSP extensions', vscode.LogLevel.Debug);

        this._virtualDocumentProvider = new VirtualDocumentProvider(client, this._logChannel);
        const vdocDisposable = vscode.workspace.registerTextDocumentContentProvider(
            'ark',
            this._virtualDocumentProvider,
        );
        this.activationDisposables.push(vdocDisposable);
        this.log('Registered VirtualDocumentProvider for ark:// URIs', vscode.LogLevel.Debug);

        this._statementRangeProvider = new RStatementRangeProvider(client);
        this._inputBoundaryProvider = new RInputBoundaryProvider(client);
        this.log('Registered RStatementRangeProvider', vscode.LogLevel.Debug);

        this._helpTopicProvider = new RHelpTopicProvider(client);
        this.log('Registered RHelpTopicProvider', vscode.LogLevel.Debug);
    }

    /**
     * Gets the statement range provider for this LSP session.
     * Can be used to detect R statement ranges at a given position.
     */
    public get statementRangeProvider(): RStatementRangeProvider | undefined {
        return this._statementRangeProvider;
    }

    public get inputBoundaryProvider(): RInputBoundaryProvider | undefined {
        return this._inputBoundaryProvider;
    }

    /**
     * Gets the help topic provider for this LSP session.
     * Can be used to look up R help topics at a given position.
     */
    public get helpTopicProvider(): RHelpTopicProvider | undefined {
        return this._helpTopicProvider;
    }

    /**
     * Stops the client instance.
     *
     * @returns A promise that resolves when the client has been stopped.
     */
    public async deactivate() {
        this._inputBoundaryProvider = undefined;
        if (!this.client) {
            return;
        }

        if (!this.client.needsStop()) {
            return;
        }

        this.log(`${this.languageClientName} is stopping`, vscode.LogLevel.Debug);

        await this._initializing;
        this._inputBoundaryProvider = undefined;

        const stopped = new Promise<void>((resolve) => {
            const disposable = this.client!.onDidChangeState((event) => {
                if (event.newState === State.Stopped) {
                    this.log(`${this.languageClientName} is stopped`, vscode.LogLevel.Debug);
                    resolve();
                    disposable.dispose();
                }
            });
        });

        this.client.stop();

        await Promise.race([stopped, timeout(2000, 'waiting for client to stop')]);
    }

    /**
     * Gets the current state of the client.
     */
    get state(): LanguageLspState {
        return this._state;
    }

    /**
     * Wait for the LSP to be connected.
     *
     * Resolves to `true` once the LSP is connected. Resolves to `false` if the
     * LSP has been stopped. Rejects if the LSP fails to start.
     */
    async wait(): Promise<boolean> {
        switch (this.state) {
            case LANGUAGE_LSP_STATE.Running:
                return true;
            case LANGUAGE_LSP_STATE.Stopped:
                return false;
            case LANGUAGE_LSP_STATE.Starting:
                await this._initializing;
                return true;
            case LANGUAGE_LSP_STATE.Uninitialized: {
                const handles = new PromiseHandles<boolean>();

                const cleanup = this.onDidChangeState(() => {
                    let out: boolean | undefined;
                    switch (this.state) {
                        case LANGUAGE_LSP_STATE.Running:
                            out = true;
                            break;
                        case LANGUAGE_LSP_STATE.Stopped:
                            out = false;
                            break;
                        case LANGUAGE_LSP_STATE.Uninitialized:
                            return;
                        case LANGUAGE_LSP_STATE.Starting:
                            if (this._initializing) {
                                cleanup.dispose();
                                this._initializing
                                    .then(() => handles.resolve(true))
                                    .catch((err) => handles.reject(err));
                            }
                            return;
                    }

                    if (out === undefined) {
                        return;
                    }

                    cleanup.dispose();
                    handles.resolve(out);
                });

                return await handles.promise;
            }
        }

        throw new Error(`Unexpected LSP state: ${this.state}`);
    }

    /**
     * Dispose of the client instance.
     */
    async dispose() {
        this.activationDisposables.forEach(disposable => disposable.dispose());
        await this.deactivate();
        this.consoleLspBridge.dispose();
    }

    public showOutput() {
        getLspOutputChannel().show();
    }
}
