import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import type {
    ILanguageRuntimeSession,
    ILanguageRuntimeProvider,
    IRuntimeSessionMetadata,
    ISupervisorFrameworkApi,
    JupyterKernelSpec,
    LanguageRuntimeMetadata,
} from '../../types/supervisor-api';
import { RRuntimeManager } from '../../runtime-manager';

function makeContext(): vscode.ExtensionContext {
    const extensionPath = path.resolve(__dirname, '../../..');
    return {
        extensionPath,
        extensionUri: vscode.Uri.file(extensionPath),
        subscriptions: [],
        globalState: {} as vscode.Memento,
        workspaceState: {} as vscode.Memento,
        asAbsolutePath: (relativePath: string) => path.join(extensionPath, relativePath),
    } as unknown as vscode.ExtensionContext;
}

function makeRuntimeMetadata(): LanguageRuntimeMetadata {
    return {
        runtimeId: 'r-4.4.1-test',
        runtimeName: 'R 4.4.1',
        runtimePath: '/usr/bin/R',
        runtimeVersion: '0.0.1',
        runtimeShortName: '4.4.1',
        runtimeSource: 'system',
        languageId: 'r',
        languageName: 'R',
        languageVersion: '4.4.1',
        extraRuntimeData: {
            homepath: '/usr/lib/R',
            binpath: '/usr/bin/R',
        },
    };
}

function makeSessionMetadata(): IRuntimeSessionMetadata {
    return {
        sessionId: 'r-session-1',
        sessionName: 'R 4.4.1',
        sessionMode: 'console' as IRuntimeSessionMetadata['sessionMode'],
        createdTimestamp: Date.now(),
        startReason: 'unit test',
    };
}

function makeLogChannel(): vscode.LogOutputChannel {
    return {
        trace() { return; },
        debug() { return; },
        info() { return; },
        warn() { return; },
        error() { return; },
        append() { return; },
        appendLine() { return; },
        replace() { return; },
        clear() { return; },
        show() { return; },
        hide() { return; },
        dispose() { return; },
        name: 'test',
        logLevel: vscode.LogLevel.Info,
        onDidChangeLogLevel: (() => new vscode.Disposable(() => {})) as vscode.Event<vscode.LogLevel>,
    } as unknown as vscode.LogOutputChannel;
}

suite('[Unit] RRuntimeManager', () => {
    test('createSession delegates to framework createSession with normalized dynState', async () => {
        const runtimeMetadata = makeRuntimeMetadata();
        const sessionMetadata = makeSessionMetadata();
        const kernelSpec: JupyterKernelSpec = {
            argv: ['ark'],
            display_name: 'R',
            language: 'R',
            kernel_protocol_version: '5.3',
        };
        let capturedSessionMetadata: IRuntimeSessionMetadata | undefined;
        let capturedKernelSpec: JupyterKernelSpec | undefined;
        let capturedDynState: unknown;

        const api: Partial<ISupervisorFrameworkApi> = {
            createSession: async (_runtimeMetadata, metadata, spec, dynState) => {
                capturedSessionMetadata = metadata;
                capturedKernelSpec = spec;
                capturedDynState = dynState;
                return { sessionId: metadata.sessionId } as unknown as ILanguageRuntimeSession;
            },
        };
        const runtimeProvider = {
            restoreInstallationFromMetadata: () => ({ binpath: '/usr/bin/R', homepath: '/usr/lib/R' }),
            createKernelSpec: async () => kernelSpec,
            validateMetadata: async (metadata: LanguageRuntimeMetadata) => metadata,
        } as unknown as ILanguageRuntimeProvider<unknown>;

        const manager = new RRuntimeManager(
            makeContext(),
            api as ISupervisorFrameworkApi,
            runtimeProvider,
            makeLogChannel(),
        );

        await manager.createSession(runtimeMetadata, sessionMetadata, 'renamed-session');

        assert.strictEqual(capturedSessionMetadata?.sessionName, 'renamed-session');
        assert.deepStrictEqual(capturedKernelSpec, kernelSpec);
        assert.deepStrictEqual(capturedDynState, {
            sessionName: 'renamed-session',
            inputPrompt: '>',
            continuationPrompt: '+',
            busy: false,
            currentWorkingDirectory: undefined,
            currentNotebookUri: undefined,
        });
    });

    test('restoreSession and validateSession delegate to framework API', async () => {
        const runtimeMetadata = makeRuntimeMetadata();
        const sessionMetadata = makeSessionMetadata();
        let restoredDynState: unknown;
        let validatedSessionId: string | undefined;

        const api: Partial<ISupervisorFrameworkApi> = {
            restoreSession: async (_runtimeMetadata, _sessionMetadata, dynState) => {
                restoredDynState = dynState;
                return { sessionId: 'r-session-1' } as unknown as ILanguageRuntimeSession;
            },
            validateSession: async (sessionId) => {
                validatedSessionId = sessionId;
                return true;
            },
        };

        const manager = new RRuntimeManager(
            makeContext(),
            api as ISupervisorFrameworkApi,
            {} as ILanguageRuntimeProvider<unknown>,
            makeLogChannel(),
        );

        await manager.restoreSession(runtimeMetadata, sessionMetadata, 'restored-session');
        const isValid = await manager.validateSession(runtimeMetadata, 'r-session-1');

        assert.deepStrictEqual(restoredDynState, {
            sessionName: 'restored-session',
            inputPrompt: '>',
            continuationPrompt: '+',
            busy: false,
            currentWorkingDirectory: undefined,
            currentNotebookUri: undefined,
        });
        assert.strictEqual(validatedSessionId, 'r-session-1');
        assert.strictEqual(isValid, true);
    });
});
