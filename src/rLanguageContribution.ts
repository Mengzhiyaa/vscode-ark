import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type {
    BinaryDefinition,
    IBinaryProvider,
    ILanguageExtensionContribution,
    ILanguageContributionServices,
    ILanguageInstallationPickerOptions,
    ILanguageLsp,
    ILanguageLspFactory,
    ILanguageRuntimeProvider,
    LanguageRuntimeDynState,
    LanguageRuntimeMetadata,
    LanguageRuntimeSessionLocation,
    LanguageRuntimeStartupBehavior,
    LanguageSessionMode,
    RuntimeSessionMetadata,
} from './types/supervisor-api';
import { RCommandIds } from './rCommandIds';
import { registerTabCompletion } from './editor/tabCompletion';
import { registerHelpActions } from './services/help/helpActions';
import { R_LANGUAGE_ID } from './languageIds';
import { createJupyterKernelSpec } from './runtime/kernelSpec';
import { RLanguageLsp } from './runtime/lsp';
import { RSessionManager } from './session-manager';
import {
    formatRuntimeName,
    getBestRInstallation,
    inferCondaEnvironmentFromRBinary,
    promptForRPath,
    type RInstallation,
    type RInstallationSource,
    rRuntimeDiscoverer,
} from './runtime/rDiscovery';

const RUNTIME_STARTUP_BEHAVIOR = {
    Immediate: 'immediate' as LanguageRuntimeStartupBehavior,
    Implicit: 'implicit' as LanguageRuntimeStartupBehavior,
} as const;

const RUNTIME_SESSION_LOCATION = {
    Workspace: 'workspace' as LanguageRuntimeSessionLocation,
} as const;

function loadDefaultRIconBase64(
    context: vscode.ExtensionContext,
    logChannel?: vscode.LogOutputChannel
): string | undefined {
    try {
        const iconPath = path.join(context.extensionPath, 'images', 'Rlogo.svg');
        const iconSvg = fs.readFileSync(iconPath, 'utf8');
        return Buffer.from(iconSvg, 'utf8').toString('base64');
    } catch (error) {
        logChannel?.debug(`Unable to load default R icon: ${error}`);
        return undefined;
    }
}

function createRuntimeId(binpath: string, version: string): string {
    const runtimeIdSuffix = Buffer.from(binpath)
        .toString('base64')
        .replace(/=+$/, '')
        .slice(0, 8);

    return `r-${version}-${runtimeIdSuffix}`;
}

export function restoreRInstallationFromMetadata(
    metadata: LanguageRuntimeMetadata
): RInstallation | undefined {
    const extraRuntimeData = metadata.extraRuntimeData as {
        homepath?: string;
        binpath?: string;
        arch?: string;
        condaEnvPath?: string;
        envName?: string;
    } | undefined;

    const homepath = extraRuntimeData?.homepath;
    if (!homepath) {
        return undefined;
    }

    const binpath = extraRuntimeData?.binpath ?? metadata.runtimePath;
    const source = metadata.runtimeSource;
    const normalizedSource: RInstallationSource =
        source === 'configured' || source === 'conda' || source === 'path' || source === 'system'
            ? source
            : 'system';

    const inferredConda = inferCondaEnvironmentFromRBinary(binpath);
    const condaEnvPath = extraRuntimeData?.condaEnvPath ?? inferredConda.condaEnvPath;
    const envName = extraRuntimeData?.envName ?? inferredConda.envName;

    return {
        binpath,
        homepath,
        version: metadata.languageVersion,
        arch: extraRuntimeData?.arch,
        current: metadata.startupBehavior === RUNTIME_STARTUP_BEHAVIOR.Immediate,
        source: condaEnvPath ? 'conda' : normalizedSource,
        condaEnvPath,
        envName,
    };
}

export class RLanguageLspFactory implements ILanguageLspFactory {
    readonly languageId = R_LANGUAGE_ID;

    create(
        runtimeMetadata: LanguageRuntimeMetadata,
        sessionMetadata: RuntimeSessionMetadata,
        dynState: LanguageRuntimeDynState,
        logChannel: vscode.LogOutputChannel
    ): ILanguageLsp {
        return new RLanguageLsp(
            runtimeMetadata.languageVersion,
            sessionMetadata,
            dynState,
            logChannel
        );
    }
}

export class RLanguageRuntimeProvider implements ILanguageRuntimeProvider<RInstallation> {
    readonly languageId = R_LANGUAGE_ID;
    readonly languageName = 'R';
    readonly lspFactory = new RLanguageLspFactory();

    constructor(private readonly _extensionContext: vscode.ExtensionContext) {}

    private _toRuntimeMetadata(
        installation: RInstallation,
        logChannel?: vscode.LogOutputChannel
    ): LanguageRuntimeMetadata {
        return {
            runtimeId: createRuntimeId(installation.binpath, installation.version),
            runtimeName: this.formatRuntimeName(installation),
            runtimeShortName: installation.version,
            runtimePath: installation.binpath,
            runtimeVersion: '0.0.1',
            runtimeSource: installation.source,
            languageId: this.languageId,
            languageName: this.languageName,
            languageVersion: installation.version,
            base64EncodedIconSvg: loadDefaultRIconBase64(this._extensionContext, logChannel),
            startupBehavior: installation.current
                ? RUNTIME_STARTUP_BEHAVIOR.Immediate
                : RUNTIME_STARTUP_BEHAVIOR.Implicit,
            sessionLocation: RUNTIME_SESSION_LOCATION.Workspace,
            extraRuntimeData: {
                homepath: installation.homepath,
                binpath: installation.binpath,
                arch: installation.arch,
                condaEnvPath: installation.condaEnvPath,
                envName: installation.envName,
            },
        };
    }

    discoverInstallations(logChannel: vscode.LogOutputChannel): AsyncGenerator<RInstallation> {
        return rRuntimeDiscoverer(logChannel);
    }

    resolveInitialInstallation(logChannel: vscode.LogOutputChannel): Promise<RInstallation | undefined> {
        return getBestRInstallation(logChannel);
    }

    promptForInstallation(
        logChannel: vscode.LogOutputChannel,
        options: ILanguageInstallationPickerOptions = {}
    ): Promise<RInstallation | undefined> {
        return promptForRPath(logChannel, {
            forcePick: options.forcePick,
            allowBrowse: options.allowBrowse,
            persistSelection: options.persistSelection,
            preselectBinPath: options.preselectRuntimePath,
            title: options.title,
            placeHolder: options.placeHolder,
        });
    }

    formatRuntimeName(installation: RInstallation): string {
        return formatRuntimeName(installation);
    }

    getRuntimePath(installation: RInstallation): string {
        return installation.binpath;
    }

    getRuntimeSource(installation: RInstallation): string {
        return installation.source;
    }

    createRuntimeMetadata(
        _context: vscode.ExtensionContext,
        installation: RInstallation,
        logChannel: vscode.LogOutputChannel
    ): LanguageRuntimeMetadata {
        return this._toRuntimeMetadata(installation, logChannel);
    }

    createKernelSpec(
        _context: vscode.ExtensionContext,
        installation: RInstallation,
        sessionMode: LanguageSessionMode,
        logChannel: vscode.LogOutputChannel
    ) {
        return createJupyterKernelSpec(
            this._extensionContext,
            installation,
            sessionMode,
            logChannel,
        );
    }

    restoreInstallationFromMetadata(metadata: LanguageRuntimeMetadata): RInstallation | undefined {
        return restoreRInstallationFromMetadata(metadata);
    }

    async validateMetadata(metadata: LanguageRuntimeMetadata): Promise<LanguageRuntimeMetadata> {
        const installation = restoreRInstallationFromMetadata(metadata);
        if (!installation) {
            throw new Error('R metadata is missing installation information');
        }

        if (!fs.existsSync(installation.binpath)) {
            throw new Error(`R binary does not exist: ${installation.binpath}`);
        }

        if (!fs.existsSync(installation.homepath)) {
            throw new Error(`R home does not exist: ${installation.homepath}`);
        }

        return this._toRuntimeMetadata(installation);
    }

    async shouldRecommendForWorkspace(): Promise<boolean> {
        const globs = [
            '**/*.R',
            '**/*.Rmd',
            '.Rprofile',
            'renv.lock',
            '.Rbuildignore',
            '.Renviron',
            '*.Rproj',
        ];

        const glob = `{${globs.join(',')}}`;
        return (await vscode.workspace.findFiles(glob, '**/node_modules/**', 1)).length > 0;
    }

    getSessionIdPrefix(): string {
        return 'r';
    }
}

export class RBinaryProvider implements IBinaryProvider {
    readonly ownerId = R_LANGUAGE_ID;

    constructor(private readonly _extensionContext: vscode.ExtensionContext) {}

    getBinaryDefinitions(): Readonly<Record<string, BinaryDefinition>> {
        const version = this._extensionContext.extension.packageJSON?.positron?.binaryDependencies?.ark;
        if (typeof version !== 'string' || !version) {
            throw new Error('Missing positron.binaryDependencies.ark in vscode-ark package.json');
        }

        return {
            ark: {
                repo: 'posit-dev/ark',
                version,
                binaryName: process.platform === 'win32' ? 'ark.exe' : 'ark',
                archivePattern: (version, platform) => `ark-${version}-${platform}.zip`,
                installDir: path.join(
                    this._extensionContext.extensionPath,
                    'resources',
                    'ark',
                ),
                platformOverride: (platform) => platform.startsWith('darwin') ? 'darwin-universal' : platform,
            },
        };
    }
}

export class RLanguageContribution implements ILanguageExtensionContribution {
    readonly runtimeProvider: RLanguageRuntimeProvider;
    readonly binaryProvider: RBinaryProvider;

    constructor(private readonly _extensionContext: vscode.ExtensionContext) {
        this.runtimeProvider = new RLanguageRuntimeProvider(_extensionContext);
        this.binaryProvider = new RBinaryProvider(_extensionContext);
    }

    registerContributions(
        services: ILanguageContributionServices,
    ): vscode.Disposable[] {
        registerTabCompletion(this._extensionContext);
        const sessionManager = new RSessionManager(
            this._extensionContext,
            services.sessionService,
            services.consoleService,
            services.logChannel,
        );
        return [
            sessionManager,
            ...registerHelpActions(
                this.runtimeProvider.languageId,
                this.runtimeProvider.languageName,
                services
            ),
            vscode.commands.registerCommand('positron.reticulate.isAutoEnabled', () => {
                return false;
            }),
            vscode.commands.registerCommand('positron.reticulate.setAutoEnabled', async () => {
                return null;
            }),
            vscode.commands.registerCommand('positron.reticulate.resetAutoEnabled', async () => {
                return null;
            }),
            vscode.commands.registerCommand(RCommandIds.startConsole, async () => {
                try {
                    services.consoleService.showConsole();
                    await services.sessionService.ensureSessionForLanguage(R_LANGUAGE_ID);
                } catch (error) {
                    services.logChannel.error(`[R] Failed to start console session: ${error}`);
                    vscode.window.showErrorMessage(`Failed to start R session: ${error}`);
                }
            }),
            vscode.commands.registerCommand(RCommandIds.restartKernel, async () => {
                const session = services.sessionService.activeSession;
                if (!session || session.runtimeMetadata.languageId !== R_LANGUAGE_ID) {
                    vscode.window.showWarningMessage('No active R session');
                    return;
                }

                await services.sessionService.restartSession(session.sessionId);
            }),
            vscode.commands.registerCommand(RCommandIds.selectRPath, async () => {
                const activeSession = services.sessionService.activeSession;
                const installation = await services.sessionService.selectInstallation<RInstallation>(
                    R_LANGUAGE_ID,
                    {
                        forcePick: true,
                        allowBrowse: true,
                        persistSelection: true,
                        preselectRuntimePath: activeSession?.runtimeMetadata.languageId === R_LANGUAGE_ID
                            ? activeSession.runtimeMetadata.runtimePath
                            : undefined,
                        title: 'Select R Installation',
                        placeHolder: 'Select R installation to use',
                    }
                );
                if (installation) {
                    vscode.window.showInformationMessage(
                        `Using ${this.runtimeProvider.formatRuntimeName(installation)} at ${this.runtimeProvider.getRuntimePath(installation)}`
                    );
                }
            }),
            vscode.commands.registerCommand(RCommandIds.runCurrentStatement, async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document.languageId !== R_LANGUAGE_ID) {
                    vscode.window.showWarningMessage('No active R file');
                    return;
                }

                const session = services.sessionService.activeSession;
                if (!session || session.runtimeMetadata.languageId !== R_LANGUAGE_ID) {
                    vscode.window.showWarningMessage('No active R session. Start a console first.');
                    return;
                }

                let code: string;
                let rangeToHighlight: vscode.Range;

                if (!editor.selection.isEmpty) {
                    code = editor.document.getText(editor.selection);
                    rangeToHighlight = editor.selection;
                    services.logChannel.debug('Executing selected code');
                } else {
                    const lsp = session.lsp;
                    const provider = lsp.statementRangeProvider;

                    let statementResult: { range: vscode.Range; code?: string } | null | undefined;

                    if (provider) {
                        try {
                            statementResult = await provider.provideStatementRange(
                                editor.document,
                                editor.selection.active,
                                new vscode.CancellationTokenSource().token
                            );
                        } catch (error) {
                            services.logChannel.warn(`Statement range request failed: ${error}`);
                        }
                    }

                    if (statementResult) {
                        code = statementResult.code || editor.document.getText(statementResult.range);
                        rangeToHighlight = statementResult.range;
                        services.logChannel.debug('Executing statement from LSP');
                    } else {
                        const line = editor.document.lineAt(editor.selection.active.line);
                        code = line.text;
                        rangeToHighlight = line.range;
                        services.logChannel.debug('Executing current line (fallback)');
                    }
                }

                if (!code.trim()) {
                    services.logChannel.debug('Skipping empty code');
                    return;
                }

                await services.consoleService.executeCode(
                    editor.document.languageId,
                    session.sessionId,
                    code,
                    {
                        source: 'editor',
                        fileUri: editor.document.uri,
                        lineNumber: rangeToHighlight.start.line + 1
                    },
                    false
                );

                editor.selection = new vscode.Selection(rangeToHighlight.start, rangeToHighlight.end);
                editor.revealRange(rangeToHighlight);

                const nextLine = rangeToHighlight.end.line + 1;
                if (nextLine < editor.document.lineCount) {
                    const newPosition = new vscode.Position(nextLine, 0);
                    editor.selection = new vscode.Selection(newPosition, newPosition);
                    editor.revealRange(new vscode.Range(newPosition, newPosition));
                } else {
                    const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
                    if (lastLine.text.trim().length > 0) {
                        const success = await editor.edit(editBuilder => {
                            editBuilder.insert(lastLine.range.end, '\n');
                        });
                        if (!success) {
                            services.logChannel.warn('Failed to append newline after statement execution');
                        }
                    }

                    const newLineNumber = editor.document.lineCount - 1;
                    const newPosition = new vscode.Position(newLineNumber, 0);
                    editor.selection = new vscode.Selection(newPosition, newPosition);
                    editor.revealRange(new vscode.Range(newPosition, newPosition));
                }

                await vscode.window.showTextDocument(editor.document, {
                    viewColumn: editor.viewColumn,
                    preserveFocus: false
                });

                services.logChannel.debug(`Executed: ${code.substring(0, 80)}${code.length > 80 ? '...' : ''}`);
            }),
            vscode.commands.registerCommand(RCommandIds.insertAssignmentOperator, async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document.languageId !== R_LANGUAGE_ID) {
                    return;
                }

                await editor.edit(editBuilder => {
                    for (const selection of editor.selections) {
                        editBuilder.replace(selection, ' <- ');
                    }
                });
            }),
            vscode.commands.registerCommand(RCommandIds.insertPipeOperator, async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document.languageId !== R_LANGUAGE_ID) {
                    return;
                }

                await editor.edit(editBuilder => {
                    for (const selection of editor.selections) {
                        editBuilder.replace(selection, ' |> ');
                    }
                });
            }),
        ];
    }
}
