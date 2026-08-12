import * as assert from 'assert';
import * as vscode from 'vscode';
import { RSession } from '../../session';
import type { ILanguageRuntimeSession, IPositronConsoleService } from '../../types/supervisor-api';

function noopEvent<T>(): vscode.Event<T> {
    return () => new vscode.Disposable(() => undefined);
}

function makeLanguageLog(messages: string[]): vscode.LogOutputChannel {
    const noop = () => undefined;
    return {
        name: 'R Language Pack Test',
        logLevel: vscode.LogLevel.Trace,
        onDidChangeLogLevel: noopEvent(),
        trace: noop,
        debug: (message: string) => messages.push(message),
        info: (message: string) => messages.push(message),
        warn: (message: string) => messages.push(message),
        error: (message: string | Error) => messages.push(String(message)),
        append: noop,
        appendLine: noop,
        replace: noop,
        clear: noop,
        show: noop,
        hide: noop,
        dispose: noop,
    };
}

function makeSession(emitLog?: (message: string, level?: vscode.LogLevel) => void): ILanguageRuntimeSession {
    return {
        sessionId: 'r-session-1',
        state: 'idle',
        created: Date.now(),
        metadata: { sessionId: 'r-session-1' },
        runtimeMetadata: { languageId: 'r' },
        onDidChangeRuntimeState: noopEvent(),
        onDidEndSession: noopEvent(),
        onDidChangeWorkingDirectory: noopEvent(),
        emitLog,
    } as unknown as ILanguageRuntimeSession;
}

const consoleService = {
    onDidChangeConsoleWidth: noopEvent<number>(),
} as unknown as IPositronConsoleService;

suite('[Unit] R session logging', () => {
    test('routes lifecycle messages to the session supervisor capability', () => {
        const sessionMessages: string[] = [];
        const languageMessages: string[] = [];
        const session = new RSession(
            makeSession((message) => sessionMessages.push(message)),
            consoleService,
            makeLanguageLog(languageMessages),
        );

        (session as any).log('Starting LSP client', vscode.LogLevel.Debug);

        assert.deepStrictEqual(sessionMessages, ['Starting LSP client']);
        assert.deepStrictEqual(languageMessages, []);
        session.dispose();
    });

    test('falls back to the Language Pack for an older supervisor', () => {
        const languageMessages: string[] = [];
        const session = new RSession(
            makeSession(),
            consoleService,
            makeLanguageLog(languageMessages),
        );

        (session as any).log('Starting LSP client', vscode.LogLevel.Debug);

        assert.deepStrictEqual(languageMessages, ['r-session-1 Starting LSP client']);
        session.dispose();
    });
});

