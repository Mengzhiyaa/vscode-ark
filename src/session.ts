import * as vscode from 'vscode';
import PQueue from 'p-queue';
import type {
    IPositronConsoleService,
    ILanguageLsp,
    ILanguageRuntimeClientInstance,
    ILanguageRuntimeSession,
    LanguageRuntimeClientType,
    LanguageRuntimeExit,
    IRuntimeSessionMetadata,
    LanguageRuntimeMetadata,
    RuntimeState,
} from './types/supervisor-api';

const ARK_DAP_TARGET_NAME = 'ark_dap';
const ARK_DEBUG_TYPE = 'ark';
const ARK_DEBUG_NAME = 'Ark Positron R';
const RUNTIME_STATE_READY = 'ready';
const RUNTIME_STATE_IDLE = 'idle';
const RUNTIME_STATE_BUSY = 'busy';
const RUNTIME_STATE_EXITED = 'exited';

export class RSession implements vscode.Disposable {
    private readonly _servicesQueue = new PQueue({ concurrency: 1 });
    private readonly _disposables: vscode.Disposable[] = [];
    private _dapStarted = false;
    private _dapAutoAttachDisabled = false;

    readonly onDidChangeRuntimeState: vscode.Event<RuntimeState>;
    readonly onDidEndSession: vscode.Event<LanguageRuntimeExit>;
    readonly onDidChangeWorkingDirectory: vscode.Event<string>;

    constructor(
        private readonly _session: ILanguageRuntimeSession,
        private readonly _positronConsoleService: IPositronConsoleService,
        private readonly _logChannel: vscode.LogOutputChannel,
    ) {
        this.onDidChangeRuntimeState = _session.onDidChangeRuntimeState;
        this.onDidEndSession = _session.onDidEndSession;
        this.onDidChangeWorkingDirectory = _session.onDidChangeWorkingDirectory;

        this.register(this._positronConsoleService.onDidChangeConsoleWidth((newWidth) => {
            void this.onConsoleWidthChange(newWidth);
        }));
        this.register(this.onDidChangeRuntimeState(async (state) => {
            await this.onStateChange(state);
        }));
    }

    get sessionId(): string {
        return this._session.sessionId;
    }

    get metadata(): IRuntimeSessionMetadata {
        return this._session.metadata;
    }

    get runtimeMetadata(): LanguageRuntimeMetadata {
        return this._session.runtimeMetadata;
    }

    get state(): RuntimeState {
        return this._session.state;
    }

    get created(): number {
        return this._session.created;
    }

    get lsp(): ILanguageLsp {
        return this._session.lsp;
    }

    register<T extends vscode.Disposable>(disposable: T): T {
        this._disposables.push(disposable);
        return disposable;
    }

    async activateServices(reason: string): Promise<void> {
        this.log(
            `Queueing services activation. Reason: ${reason}. ` +
            `Queue size: ${this._servicesQueue.size}, ` +
            `pending: ${this._servicesQueue.pending}`,
            vscode.LogLevel.Debug,
        );

        return this._servicesQueue.add(async () => {
            this.log(
                `Services activation started. Reason: ${reason}. ` +
                `Queue size: ${this._servicesQueue.size}, ` +
                `pending: ${this._servicesQueue.pending}`,
                vscode.LogLevel.Debug,
            );

            if (!this.canActivateServices()) {
                this.log(
                    `Skipping services activation (${reason}): session state is '${this.state}'`,
                    vscode.LogLevel.Debug,
                );
                return;
            }

            const connectDap = async () => {
                if (!this._dapStarted || this._dapAutoAttachDisabled) {
                    return;
                }

                const connected = await this._session.connectDap();
                if (!connected) {
                    this._dapAutoAttachDisabled = true;
                    this.log(
                        `DAP auto-attach disabled for session ${this.sessionId}`,
                        vscode.LogLevel.Debug,
                    );
                }
            };

            await Promise.all([
                this._session.activateLsp(),
                connectDap(),
            ]);

            this.log(`Services activation completed. Reason: ${reason}`, vscode.LogLevel.Debug);
        });
    }

    async deactivateServices(reason: string): Promise<void> {
        this.log(
            `Queueing services deactivation. Reason: ${reason}. ` +
            `Queue size: ${this._servicesQueue.size}, ` +
            `pending: ${this._servicesQueue.pending}`,
            vscode.LogLevel.Debug,
        );

        return this._servicesQueue.add(async () => {
            this.log(
                `Services deactivation started. Reason: ${reason}. ` +
                `Queue size: ${this._servicesQueue.size}, ` +
                `pending: ${this._servicesQueue.pending}`,
                vscode.LogLevel.Debug,
            );

            await Promise.all([
                this._session.deactivateLsp(),
                this._session.disconnectDap(),
            ]);

            this.log(`Services deactivation completed. Reason: ${reason}`, vscode.LogLevel.Debug);
        });
    }

    waitLsp(): Promise<ILanguageLsp | undefined> {
        return this._session.waitLsp();
    }

    watchRuntimeClient(
        clientType: LanguageRuntimeClientType,
        handler: (client: ILanguageRuntimeClientInstance) => void,
    ): vscode.Disposable {
        return this._session.watchRuntimeClient(clientType, handler);
    }

    private async startDap(): Promise<void> {
        if (this._dapStarted) {
            return;
        }

        await this._session.startDap(
            ARK_DAP_TARGET_NAME,
            ARK_DEBUG_TYPE,
            ARK_DEBUG_NAME,
        );
        this._dapStarted = true;
        this._dapAutoAttachDisabled = false;
    }

    private async setConsoleWidth(): Promise<void> {
        try {
            await this._session.setConsoleWidth(this._positronConsoleService.getConsoleWidth());
        } catch (error) {
            this.log(`Failed to set initial console width: ${error}`, vscode.LogLevel.Debug);
        }
    }

    private async onConsoleWidthChange(newWidth: number): Promise<void> {
        if (this.state === RUNTIME_STATE_EXITED) {
            return;
        }

        try {
            await this._session.setConsoleWidth(newWidth);
        } catch (error) {
            this.log(`Failed to set console width: ${error}`, vscode.LogLevel.Debug);
        }
    }

    private async onStateChange(state: RuntimeState): Promise<void> {
        if (state === RUNTIME_STATE_READY) {
            try {
                await Promise.all([
                    this.startDap(),
                    this.setConsoleWidth(),
                ]);
            } catch (error) {
                this.log(`Error preparing session services: ${error}`, vscode.LogLevel.Error);
            }
            return;
        }

        if (state === RUNTIME_STATE_EXITED) {
            this._dapStarted = false;
            this._dapAutoAttachDisabled = false;

            try {
                await this.deactivateServices('session exited');
            } catch (error) {
                this.log(`Failed to deactivate services after exit: ${error}`, vscode.LogLevel.Warning);
            }
        }
    }

    private canActivateServices(): boolean {
        return this.state === RUNTIME_STATE_READY ||
            this.state === RUNTIME_STATE_IDLE ||
            this.state === RUNTIME_STATE_BUSY;
    }

    private log(message: string, level: vscode.LogLevel = vscode.LogLevel.Info): void {
        const formattedMessage = `${this.sessionId} ${message}`;
        switch (level) {
            case vscode.LogLevel.Error:
                this._logChannel.error(formattedMessage);
                break;
            case vscode.LogLevel.Warning:
                this._logChannel.warn(formattedMessage);
                break;
            case vscode.LogLevel.Debug:
                this._logChannel.debug(formattedMessage);
                break;
            default:
                this._logChannel.info(formattedMessage);
                break;
        }
    }

    dispose(): void {
        this._disposables.forEach((disposable) => disposable.dispose());
    }
}
