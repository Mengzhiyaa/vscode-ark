import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import type {
    ILanguageRuntimeSession,
    IPositronConsoleService,
    IRuntimeSessionService,
    LanguageRuntimeMetadata,
    RuntimeState,
} from '../../types/supervisor-api';
import { RSessionManager } from '../../session-manager';

const LANGUAGE_LSP_STATE_STOPPED = 'stopped';
const SESSION_MODE_CONSOLE = 'console';
const RUNTIME_STATE_READY = 'ready' as RuntimeState;
const RUNTIME_STATE_IDLE = 'idle' as RuntimeState;

function createMemento(initialEntries: Record<string, unknown> = {}): vscode.Memento {
    const store = new Map<string, unknown>(Object.entries(initialEntries));
    return {
        get: <T>(key: string, defaultValue?: T) => {
            return (store.has(key) ? store.get(key) : defaultValue) as T;
        },
        update: async (key: string, value: unknown) => {
            if (value === undefined) {
                store.delete(key);
            } else {
                store.set(key, value);
            }
        },
        keys: () => Array.from(store.keys()),
    };
}

function makeContext(workspaceStateEntries: Record<string, unknown> = {}): vscode.ExtensionContext {
    const extensionPath = path.resolve(__dirname, '../../..');
    return {
        extensionPath,
        extensionUri: vscode.Uri.file(extensionPath),
        subscriptions: [],
        globalState: createMemento(),
        workspaceState: createMemento(workspaceStateEntries),
        asAbsolutePath: (relativePath: string) => path.join(extensionPath, relativePath),
    } as unknown as vscode.ExtensionContext;
}

function makeNoopLogChannel(): vscode.LogOutputChannel {
    const noop = () => undefined;
    const event: vscode.Event<vscode.LogLevel> = () => ({ dispose: noop });

    return {
        name: 'session-manager-unit-test',
        logLevel: vscode.LogLevel.Trace,
        onDidChangeLogLevel: event,
        trace: noop,
        debug: noop,
        info: noop,
        warn: noop,
        error: noop,
        append: noop,
        appendLine: noop,
        replace: noop,
        clear: noop,
        show: noop,
        hide: noop,
        dispose: noop,
    };
}

function createEventStub<T>(): vscode.Event<T> {
    return () => ({ dispose: () => undefined });
}

function makeRuntimeMetadata(): LanguageRuntimeMetadata {
    return {
        runtimeId: 'r-4.4.1-test',
        runtimeName: 'R 4.4.1',
        runtimePath: '/usr/bin/R',
        runtimeVersion: '4.4.1',
        runtimeShortName: '4.4.1',
        runtimeSource: 'system',
        languageId: 'r',
        languageName: 'R',
        languageVersion: '4.4.1',
    };
}

function makeConsoleService(): IPositronConsoleService {
    return {
        onDidChangeConsoleWidth: createEventStub(),
        revealConsole: async () => undefined,
        focusConsole: async () => undefined,
        showConsole: async () => undefined,
        getConsoleWidth: () => 120,
        executeCode: async () => 'execution-1',
    };
}

function makeRuntimeSession(
    sessionId: string,
    created: number,
    state: RuntimeState,
    counters: {
        activateLsp: number;
        startDap: number;
        connectDap: number;
        setConsoleWidth: number;
    },
): ILanguageRuntimeSession {
    const metadata = {
        sessionId,
        sessionName: sessionId,
        sessionMode: SESSION_MODE_CONSOLE as any,
        createdTimestamp: created,
        startReason: 'unit-test',
    } as any;

    return {
        sessionId,
        state,
        isForeground: true,
        workingDirectory: undefined,
        created,
        dynState: {
            sessionName: sessionId,
            inputPrompt: '>',
            continuationPrompt: '+',
            busy: false,
        },
        runtimeMetadata: makeRuntimeMetadata(),
        metadata,
        sessionMetadata: metadata,
        lsp: {
            state: LANGUAGE_LSP_STATE_STOPPED as any,
            activate: async () => undefined,
            deactivate: async () => undefined,
            wait: async () => false,
            showOutput: () => undefined,
            requestCompletion: async () => [],
            requestHover: async () => null,
            requestSignatureHelp: async () => null,
            dispose: () => undefined,
        },
        onDidChangeRuntimeState: createEventStub(),
        onDidEndSession: createEventStub(),
        onDidChangeWorkingDirectory: createEventStub(),
        activateLsp: async () => {
            counters.activateLsp += 1;
        },
        deactivateLsp: async () => undefined,
        startDap: async () => {
            counters.startDap += 1;
        },
        connectDap: async () => {
            counters.connectDap += 1;
            return true;
        },
        disconnectDap: async () => undefined,
        setConsoleWidth: async () => {
            counters.setConsoleWidth += 1;
        },
        watchRuntimeClient: () => new vscode.Disposable(() => undefined),
        waitLsp: async () => undefined,
        getRuntimeState: () => state,
        interrupt: async () => undefined,
    };
}

async function waitFor(predicate: () => boolean, timeoutMs: number = 1000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error('Timed out waiting for predicate');
        }

        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

suite('[Unit] R session manager restore activation', () => {
    test('reconciles an already restored foreground console session on startup', async () => {
        const context = makeContext();
        const counters = {
            activateLsp: 0,
            startDap: 0,
            connectDap: 0,
            setConsoleWidth: 0,
        };
        const session = makeRuntimeSession('restored-r-session', 10, RUNTIME_STATE_READY, counters);

        const runtimeSessionService = {
            activeSessions: [session],
            foregroundSession: session,
            onWillStartSession: createEventStub(),
            onDidDeleteRuntimeSession: createEventStub(),
            onDidChangeForegroundSession: createEventStub(),
            watchUiClient: () => new vscode.Disposable(() => undefined),
        } as unknown as IRuntimeSessionService;

        const manager = new RSessionManager(
            context,
            runtimeSessionService,
            makeConsoleService(),
            makeNoopLogChannel(),
        );

        await waitFor(() => counters.activateLsp === 1);

        assert.strictEqual(counters.startDap, 1);
        assert.strictEqual(counters.connectDap, 1);
        assert.strictEqual(counters.setConsoleWidth, 1);
        assert.strictEqual(
            context.workspaceState.get<string>('ark.r.lastForegroundSessionId'),
            session.sessionId,
        );

        manager.dispose();
    });

    test('falls back to the newest restorable console session when foreground state is unavailable', async () => {
        const context = makeContext();
        const staleCounters = {
            activateLsp: 0,
            startDap: 0,
            connectDap: 0,
            setConsoleWidth: 0,
        };
        const newestCounters = {
            activateLsp: 0,
            startDap: 0,
            connectDap: 0,
            setConsoleWidth: 0,
        };
        const olderSession = makeRuntimeSession('older-r-session', 5, RUNTIME_STATE_READY, staleCounters);
        const newestSession = makeRuntimeSession('newest-r-session', 15, RUNTIME_STATE_IDLE, newestCounters);

        const runtimeSessionService = {
            activeSessions: [olderSession, newestSession],
            foregroundSession: undefined,
            onWillStartSession: createEventStub(),
            onDidDeleteRuntimeSession: createEventStub(),
            onDidChangeForegroundSession: createEventStub(),
            watchUiClient: () => new vscode.Disposable(() => undefined),
        } as unknown as IRuntimeSessionService;

        const manager = new RSessionManager(
            context,
            runtimeSessionService,
            makeConsoleService(),
            makeNoopLogChannel(),
        );

        await waitFor(() => newestCounters.activateLsp === 1);

        assert.strictEqual(staleCounters.activateLsp, 0);
        assert.strictEqual(newestCounters.startDap, 1);
        assert.strictEqual(newestCounters.connectDap, 1);
        assert.strictEqual(newestCounters.setConsoleWidth, 1);
        assert.strictEqual(
            context.workspaceState.get<string>('ark.r.lastForegroundSessionId'),
            newestSession.sessionId,
        );

        manager.dispose();
    });
});
