import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import type {
    IRuntimeSessionService,
    IRuntimeStartupService,
    ISupervisorFrameworkApi,
    LanguageRuntimeMetadata,
    RuntimeStartupPhase,
} from '../../types/supervisor-api';
import { RCommandIds } from '../../rCommandIds';
import { RLanguageContribution } from '../../rLanguageContribution';
import type { RInstallation } from '../../runtime/rDiscovery';

type RegisteredCommandHandler = (...args: any[]) => unknown;

function createMemento(): vscode.Memento {
    const store = new Map<string, unknown>();
    return {
        get: <T>(key: string, defaultValue?: T) => {
            return (store.has(key) ? store.get(key) : defaultValue) as T;
        },
        update: async (key: string, value: unknown) => {
            store.set(key, value);
        },
        keys: () => Array.from(store.keys()),
    };
}

function makeContext(): vscode.ExtensionContext {
    const extensionPath = path.resolve(__dirname, '../../..');
    return {
        extensionPath,
        extensionUri: vscode.Uri.file(extensionPath),
        subscriptions: [],
        globalState: createMemento(),
        workspaceState: createMemento(),
        asAbsolutePath: (relativePath: string) => path.join(extensionPath, relativePath),
    } as unknown as vscode.ExtensionContext;
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

suite('[Unit] RLanguageContribution', () => {
    const originalRegisterCommand = vscode.commands.registerCommand.bind(vscode.commands);
    const originalExecuteCommand = vscode.commands.executeCommand.bind(vscode.commands);

    teardown(() => {
        (vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }).registerCommand = originalRegisterCommand;
        (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = originalExecuteCommand;
    });

    test('registers RRuntimeManager and uses framework startRuntime for preferred runtimes', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();
        const registerSessionManagerCalls: unknown[] = [];
        const registerRuntimeManagerCalls: unknown[] = [];
        const registerExternalDiscoveryManagerCalls: string[] = [];
        const startRuntimeCalls: LanguageRuntimeMetadata[] = [];
        let consoleShown = false;

        (vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }).registerCommand =
            ((command: string, callback: RegisteredCommandHandler) => {
                registeredCommands.set(command, callback);
                return new vscode.Disposable(() => {});
            }) as typeof vscode.commands.registerCommand;
        (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
            (async () => undefined) as typeof vscode.commands.executeCommand;

        const preferredRuntime = makeRuntimeMetadata();
        const api: Partial<ISupervisorFrameworkApi> = {
            startRuntime: async (metadata) => {
                startRuntimeCalls.push(metadata);
                return 'r-session-1';
            },
        };
        const onWillStartSession = new vscode.EventEmitter<any>();
        const onDidDeleteRuntimeSession = new vscode.EventEmitter<string>();
        const onDidChangeForegroundSession = new vscode.EventEmitter<any>();
        const services = {
            logChannel: makeLogChannel(),
            runtimeSessionService: {
                activeSessions: [],
                activeSession: undefined,
                foregroundSession: undefined,
                onWillStartSession: onWillStartSession.event,
                onDidDeleteRuntimeSession: onDidDeleteRuntimeSession.event,
                onDidChangeForegroundSession: onDidChangeForegroundSession.event,
                registerSessionManager: (manager: unknown) => {
                    registerSessionManagerCalls.push(manager);
                    return new vscode.Disposable(() => {});
                },
                getSession: () => undefined,
                getConsoleSessionForLanguage: () => undefined,
                restartSession: async () => undefined,
                selectInstallation: async () => undefined,
            } as unknown as IRuntimeSessionService,
            runtimeStartupService: {
                startupPhase: 'complete' as RuntimeStartupPhase,
                getRestoredSessions: async () => [],
                getPreferredRuntime: () => preferredRuntime,
                registerRuntimeManager: (manager: unknown) => {
                    registerRuntimeManagerCalls.push(manager);
                    return new vscode.Disposable(() => {});
                },
            } as unknown as IRuntimeStartupService,
            runtimeManager: {
                registerExternalDiscoveryManager: (languageId: string) => {
                    registerExternalDiscoveryManagerCalls.push(languageId);
                    return new vscode.Disposable(() => {});
                },
            } as any,
            positronConsoleService: {
                showConsole: () => {
                    consoleShown = true;
                },
            } as any,
            positronHelpService: {
                showHelpTopic: async () => false,
                find: async () => undefined,
                showWelcomePage: () => undefined,
            },
        };

        const contribution = new RLanguageContribution(makeContext(), api as ISupervisorFrameworkApi);
        contribution.registerContributions(services);

        assert.strictEqual(registerSessionManagerCalls.length, 1);
        assert.strictEqual(registerRuntimeManagerCalls.length, 1);
        assert.deepStrictEqual(registerExternalDiscoveryManagerCalls, ['r']);

        const startConsole = registeredCommands.get(RCommandIds.startConsole);
        assert.ok(startConsole, 'Expected start console command to be registered');

        await startConsole!();

        assert.strictEqual(consoleShown, true);
        assert.deepStrictEqual(startRuntimeCalls, [preferredRuntime]);
    });

    test('uses framework startRuntime after selecting an installation', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();
        const startRuntimeCalls: LanguageRuntimeMetadata[] = [];
        const installation: RInstallation = {
            binpath: '/usr/bin/R',
            homepath: '/usr/lib/R',
            version: '4.4.1',
            current: true,
            source: 'system',
        };

        (vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }).registerCommand =
            ((command: string, callback: RegisteredCommandHandler) => {
                registeredCommands.set(command, callback);
                return new vscode.Disposable(() => {});
            }) as typeof vscode.commands.registerCommand;
        (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
            (async () => undefined) as typeof vscode.commands.executeCommand;

        const api: Partial<ISupervisorFrameworkApi> = {
            startRuntime: async (metadata) => {
                startRuntimeCalls.push(metadata);
                return 'r-session-1';
            },
        };
        const onWillStartSession = new vscode.EventEmitter<any>();
        const onDidDeleteRuntimeSession = new vscode.EventEmitter<string>();
        const onDidChangeForegroundSession = new vscode.EventEmitter<any>();
        const services = {
            logChannel: makeLogChannel(),
            runtimeSessionService: {
                activeSessions: [],
                activeSession: undefined,
                foregroundSession: undefined,
                onWillStartSession: onWillStartSession.event,
                onDidDeleteRuntimeSession: onDidDeleteRuntimeSession.event,
                onDidChangeForegroundSession: onDidChangeForegroundSession.event,
                registerSessionManager: () => new vscode.Disposable(() => {}),
                getSession: () => undefined,
                getConsoleSessionForLanguage: () => undefined,
                restartSession: async () => undefined,
                selectInstallation: async () => installation,
            } as unknown as IRuntimeSessionService,
            runtimeStartupService: {
                startupPhase: 'complete' as RuntimeStartupPhase,
                getRestoredSessions: async () => [],
                getPreferredRuntime: () => undefined,
                registerRuntimeManager: () => new vscode.Disposable(() => {}),
            } as unknown as IRuntimeStartupService,
            runtimeManager: {
                registerExternalDiscoveryManager: () => new vscode.Disposable(() => {}),
            } as any,
            positronConsoleService: {
                showConsole: () => undefined,
            } as any,
            positronHelpService: {
                showHelpTopic: async () => false,
                find: async () => undefined,
                showWelcomePage: () => undefined,
            },
        };

        const contribution = new RLanguageContribution(makeContext(), api as ISupervisorFrameworkApi);
        contribution.registerContributions(services);

        const startConsole = registeredCommands.get(RCommandIds.startConsole);
        assert.ok(startConsole, 'Expected start console command to be registered');

        await startConsole!();

        assert.strictEqual(startRuntimeCalls.length, 1);
        assert.strictEqual(startRuntimeCalls[0].runtimePath, installation.binpath);
        assert.strictEqual(startRuntimeCalls[0].languageId, 'r');
    });

    test('reuses restored console placeholder while runtime startup is still reconnecting', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();
        let selectInstallationCalls = 0;
        let startRuntimeCalls = 0;

        (vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }).registerCommand =
            ((command: string, callback: RegisteredCommandHandler) => {
                registeredCommands.set(command, callback);
                return new vscode.Disposable(() => {});
            }) as typeof vscode.commands.registerCommand;
        (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
            (async () => undefined) as typeof vscode.commands.executeCommand;

        const api: Partial<ISupervisorFrameworkApi> = {
            startRuntime: async () => {
                startRuntimeCalls += 1;
                return 'r-session-1';
            },
        };
        const onWillStartSession = new vscode.EventEmitter<any>();
        const onDidDeleteRuntimeSession = new vscode.EventEmitter<string>();
        const onDidChangeForegroundSession = new vscode.EventEmitter<any>();
        const services = {
            logChannel: makeLogChannel(),
            runtimeSessionService: {
                activeSessions: [],
                activeSession: undefined,
                foregroundSession: undefined,
                onWillStartSession: onWillStartSession.event,
                onDidDeleteRuntimeSession: onDidDeleteRuntimeSession.event,
                onDidChangeForegroundSession: onDidChangeForegroundSession.event,
                registerSessionManager: () => new vscode.Disposable(() => {}),
                getSession: () => undefined,
                getConsoleSessionForLanguage: () => undefined,
                restartSession: async () => undefined,
                selectInstallation: async () => {
                    selectInstallationCalls += 1;
                    return undefined;
                },
            } as unknown as IRuntimeSessionService,
            runtimeStartupService: {
                startupPhase: 'reconnecting' as RuntimeStartupPhase,
                getRestoredSessions: async () => [{
                    sessionName: 'Restored R',
                    runtimeMetadata: makeRuntimeMetadata(),
                    metadata: {
                        sessionId: 'restored-r-session',
                        sessionName: 'Restored R',
                        sessionMode: 'console',
                    },
                    sessionState: 'ready',
                    hasConsole: true,
                    lastUsed: Date.now(),
                }],
                getPreferredRuntime: () => makeRuntimeMetadata(),
                registerRuntimeManager: () => new vscode.Disposable(() => {}),
            } as unknown as IRuntimeStartupService,
            runtimeManager: {
                registerExternalDiscoveryManager: () => new vscode.Disposable(() => {}),
            } as any,
            positronConsoleService: {
                showConsole: () => undefined,
            } as any,
            positronHelpService: {
                showHelpTopic: async () => false,
                find: async () => undefined,
                showWelcomePage: () => undefined,
            },
        };

        const contribution = new RLanguageContribution(makeContext(), api as ISupervisorFrameworkApi);
        contribution.registerContributions(services);

        const startConsole = registeredCommands.get(RCommandIds.startConsole);
        assert.ok(startConsole, 'Expected start console command to be registered');

        await startConsole!();

        assert.strictEqual(startRuntimeCalls, 0);
        assert.strictEqual(selectInstallationCalls, 0);
    });
});
