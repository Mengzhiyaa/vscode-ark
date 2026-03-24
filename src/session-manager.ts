import * as vscode from 'vscode';
import PQueue from 'p-queue';
import {
    IConsoleContributionService,
    ILanguageSession,
    ILanguageSessionService,
    LanguageRuntimeClientType,
    RuntimeState,
} from './types/supervisor-api';
import { R_LANGUAGE_ID } from './languageIds';
import { RSession } from './session';

const LAST_FOREGROUND_SESSION_ID_KEY = 'ark.r.lastForegroundSessionId';
const SESSION_MODE_CONSOLE = 'console';
const SESSION_MODE_NOTEBOOK = 'notebook';
const SESSION_MODE_BACKGROUND = 'background';
const RUNTIME_STATE_READY = 'ready';
const RUNTIME_STATE_UNINITIALIZED = 'uninitialized';
const RUNTIME_STATE_EXITED = 'exited';

export class RSessionManager implements vscode.Disposable {
    private readonly _sessions = new Map<string, RSession>();
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _activationQueue = new PQueue({ concurrency: 1 });
    private readonly _unsupportedReticulateNotifiedSessionIds = new Set<string>();

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _sessionService: ILanguageSessionService,
        private readonly _consoleService: IConsoleContributionService,
        private readonly _logChannel: vscode.LogOutputChannel,
    ) {
        for (const session of _sessionService.sessions) {
            this.setSession(session);
        }

        this._disposables.push(
            _sessionService.onDidCreateSession((session) => {
                this.setSession(session);
            }),
            _sessionService.onDidDeleteSession((sessionId) => {
                this.deleteSession(sessionId);
            }),
            _sessionService.onDidChangeForegroundSession((session) => {
                void this.enqueueActivation(() => this.didChangeForegroundSession(session?.sessionId));
            }),
        );
    }

    private getLastForegroundSessionId(): string | null {
        return this._context.workspaceState.get<string>(LAST_FOREGROUND_SESSION_ID_KEY) ?? null;
    }

    private async setLastForegroundSessionId(sessionId: string | null): Promise<void> {
        await this._context.workspaceState.update(LAST_FOREGROUND_SESSION_ID_KEY, sessionId);
    }

    setSession(session: ILanguageSession): void {
        if (!this.isRSession(session) || this._sessions.has(session.sessionId)) {
            return;
        }

        const rSession = new RSession(session, this._consoleService, this._logChannel);
        this._sessions.set(session.sessionId, rSession);

        rSession.register(
            rSession.onDidChangeRuntimeState(async (state) => {
                await this.enqueueActivation(() => this.didChangeSessionRuntimeState(rSession, state));
            }),
        );
        rSession.register(
            rSession.watchRuntimeClient(LanguageRuntimeClientType.Reticulate, (client) => {
                if (!this._unsupportedReticulateNotifiedSessionIds.has(rSession.sessionId)) {
                    this._unsupportedReticulateNotifiedSessionIds.add(rSession.sessionId);
                    this._logChannel.warn(
                        `[RSessionManager] Closing unsupported reticulate client ` +
                        `'${client.getClientId()}' for session ${rSession.sessionId}`
                    );
                    void vscode.window.showWarningMessage('Reticulate is not supported in Ark.');
                } else {
                    this._logChannel.debug(
                        `[RSessionManager] Closing unsupported reticulate client ` +
                        `'${client.getClientId()}' for session ${rSession.sessionId}`
                    );
                }

                client.dispose();
            }),
        );
    }

    private deleteSession(sessionId: string): void {
        const session = this._sessions.get(sessionId);
        if (!session) {
            return;
        }

        this._sessions.delete(sessionId);
        this._unsupportedReticulateNotifiedSessionIds.delete(sessionId);
        session.dispose();
    }

    private async didChangeSessionRuntimeState(session: RSession, state: RuntimeState): Promise<void> {
        // Three `Ready` states to keep in mind:
        // - Fresh console sessions are activated after the foreground change is observed.
        // - Restarted or restored console sessions are activated here if they were the last
        //   foreground R session before restart, because no new foreground event is guaranteed.
        // - Notebook sessions can own their own services immediately; background sessions cannot.
        if (state !== RUNTIME_STATE_READY) {
            return;
        }

        if (session.metadata.sessionMode === SESSION_MODE_CONSOLE) {
            const lastForegroundSessionId = this.getLastForegroundSessionId();
            if (lastForegroundSessionId === session.metadata.sessionId) {
                await this.activateConsoleSession(session, 'foreground session is ready');
            }
            return;
        }

        if (session.metadata.sessionMode === SESSION_MODE_NOTEBOOK) {
            await this.activateSession(session, 'notebook session is ready');
        }
    }

    private async didChangeForegroundSession(sessionId: string | undefined): Promise<void> {
        if (!sessionId) {
            return;
        }

        const lastForegroundSessionId = this.getLastForegroundSessionId();
        if (lastForegroundSessionId === sessionId) {
            return;
        }

        const session = this._sessions.get(sessionId);
        if (!session) {
            return;
        }

        if (session.metadata.sessionMode === SESSION_MODE_BACKGROUND) {
            throw new Error(`Foreground session with ID ${sessionId} must not be a background session.`);
        }

        // Only console sessions should own the editor-facing LSP/DAP pair.
        if (session.metadata.sessionMode !== SESSION_MODE_CONSOLE) {
            return;
        }

        await this.setLastForegroundSessionId(session.metadata.sessionId);
        await this.activateConsoleSession(session, 'foreground session changed');
    }

    private async activateConsoleSession(session: RSession, reason: string): Promise<void> {
        await Promise.all(
            this.getActiveRSessions()
                .filter((candidate) => {
                    return candidate.metadata.sessionId !== session.metadata.sessionId &&
                        candidate.metadata.sessionMode === SESSION_MODE_CONSOLE;
                })
                .map((candidate) => this.deactivateSession(candidate, reason)),
        );

        await this.activateSession(session, reason);
    }

    private async activateSession(session: RSession, reason: string): Promise<void> {
        await session.activateServices(reason);
    }

    private async deactivateSession(session: RSession, reason: string): Promise<void> {
        await session.deactivateServices(reason);
    }

    getActiveRSessions(): RSession[] {
        return Array.from(this._sessions.values());
    }

    async getConsoleSession(): Promise<RSession | undefined> {
        const sessions = this.getActiveRSessions().sort((left, right) => right.created - left.created);
        const consoleSessions = sessions.filter((session) => {
            return session.metadata.sessionMode === SESSION_MODE_CONSOLE &&
                session.state !== RUNTIME_STATE_UNINITIALIZED &&
                session.state !== RUNTIME_STATE_EXITED;
        });

        return consoleSessions[0];
    }

    async getSessionById(sessionId: string): Promise<RSession | undefined> {
        return this._sessions.get(sessionId);
    }

    private enqueueActivation(task: () => Promise<void>): Promise<void> {
        return this._activationQueue.add(task);
    }

    private isRSession(session: ILanguageSession): boolean {
        return session.runtimeMetadata.languageId === R_LANGUAGE_ID;
    }

    dispose(): void {
        this._sessions.forEach((session) => session.dispose());
        this._disposables.forEach((disposable) => disposable.dispose());
    }
}
