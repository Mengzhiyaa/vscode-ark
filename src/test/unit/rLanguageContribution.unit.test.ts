import * as crypto from 'crypto';
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

function makeConsoleServiceStub(overrides: Record<string, unknown> = {}): any {
    return {
        revealConsole: async () => undefined,
        focusConsole: async () => undefined,
        showConsole: async () => undefined,
        getConsoleWidth: () => 80,
        executeCode: async () => 'execution-1',
        ...overrides,
    };
}

suite('[Unit] RLanguageContribution', () => {
    const originalRegisterCommand = vscode.commands.registerCommand.bind(vscode.commands);
    const originalExecuteCommand = vscode.commands.executeCommand.bind(vscode.commands);
    const originalActiveTextEditor = Object.getOwnPropertyDescriptor(vscode.window, 'activeTextEditor');
    const originalShowTextDocument = vscode.window.showTextDocument.bind(vscode.window);
    const originalShowInformationMessage = vscode.window.showInformationMessage.bind(vscode.window);
    const originalShowWarningMessage = vscode.window.showWarningMessage.bind(vscode.window);

    function setActiveTextEditor(editor: vscode.TextEditor | undefined): void {
        Object.defineProperty(vscode.window, 'activeTextEditor', {
            configurable: true,
            get: () => editor,
        });
    }

    teardown(() => {
        (vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }).registerCommand = originalRegisterCommand;
        (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = originalExecuteCommand;
        (vscode.window as { showTextDocument: typeof vscode.window.showTextDocument }).showTextDocument = originalShowTextDocument;
        (vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage =
            originalShowInformationMessage;
        (vscode.window as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage =
            originalShowWarningMessage;
        if (originalActiveTextEditor) {
            Object.defineProperty(vscode.window, 'activeTextEditor', originalActiveTextEditor);
        } else {
            setActiveTextEditor(undefined);
        }
    });

    test('registers RRuntimeManager and reveals console without stealing focus for preferred runtimes', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();
        const registerSessionManagerCalls: unknown[] = [];
        const registerRuntimeManagerCalls: unknown[] = [];
        const registerExternalDiscoveryManagerCalls: string[] = [];
        const startRuntimeCalls: LanguageRuntimeMetadata[] = [];
        const revealConsoleCalls: boolean[] = [];
        let focusConsoleCalls = 0;
        let showConsoleCalls = 0;

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
            positronNewFolderService: {} as any,
            runtimeManager: {
                registerExternalDiscoveryManager: (languageId: string) => {
                    registerExternalDiscoveryManagerCalls.push(languageId);
                    return new vscode.Disposable(() => {});
                },
            } as any,
            positronConsoleService: makeConsoleServiceStub({
                revealConsole: async (preserveFocus?: boolean) => {
                    revealConsoleCalls.push(preserveFocus === true);
                },
                focusConsole: async () => {
                    focusConsoleCalls += 1;
                },
                showConsole: async () => {
                    showConsoleCalls += 1;
                },
            }),
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

        assert.deepStrictEqual(revealConsoleCalls, [true]);
        assert.strictEqual(focusConsoleCalls, 0);
        assert.strictEqual(showConsoleCalls, 0);
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
            positronNewFolderService: {} as any,
            runtimeManager: {
                registerExternalDiscoveryManager: () => new vscode.Disposable(() => {}),
            } as any,
            positronConsoleService: makeConsoleServiceStub(),
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

    test('starts a new console even while runtime startup is still reconnecting', async () => {
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
            positronNewFolderService: {} as any,
            runtimeManager: {
                registerExternalDiscoveryManager: () => new vscode.Disposable(() => {}),
            } as any,
            positronConsoleService: makeConsoleServiceStub(),
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

        assert.strictEqual(startRuntimeCalls, 1);
        assert.strictEqual(selectInstallationCalls, 0);
    });

    test('uses positron-compatible runtimeId hashing', () => {
        const contribution = new RLanguageContribution(makeContext(), {} as ISupervisorFrameworkApi);
        const installation: RInstallation = {
            binpath: '/opt/R/4.4.1/bin/R',
            homepath: '/opt/R/4.4.1/lib/R',
            version: '4.4.1',
            current: true,
            source: 'system',
        };

        const metadata = contribution.runtimeProvider.createRuntimeMetadata(
            makeContext(),
            installation,
            makeLogChannel(),
        );

        const expectedRuntimeId = crypto.createHash('sha256')
            .update(installation.binpath)
            .update(installation.version)
            .digest('hex')
            .substring(0, 32);

        assert.strictEqual(metadata.runtimeId, expectedRuntimeId);
    });

    test('runCurrentStatement delegates to the shared console execute command', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();
        const executedCommands: Array<{ command: string; args: unknown[] }> = [];

        (vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }).registerCommand =
            ((command: string, callback: RegisteredCommandHandler) => {
                registeredCommands.set(command, callback);
                return new vscode.Disposable(() => {});
            }) as typeof vscode.commands.registerCommand;
        (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
            (async (command: string, ...args: unknown[]) => {
                executedCommands.push({ command, args });
                return undefined;
            }) as typeof vscode.commands.executeCommand;

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
                selectInstallation: async () => undefined,
            } as unknown as IRuntimeSessionService,
            runtimeStartupService: {
                startupPhase: 'complete' as RuntimeStartupPhase,
                getRestoredSessions: async () => [],
                getPreferredRuntime: () => undefined,
                registerRuntimeManager: () => new vscode.Disposable(() => {}),
            } as unknown as IRuntimeStartupService,
            positronNewFolderService: {} as any,
            runtimeManager: {
                registerExternalDiscoveryManager: () => new vscode.Disposable(() => {}),
            } as any,
            positronConsoleService: makeConsoleServiceStub(),
            positronHelpService: {
                showHelpTopic: async () => false,
                find: async () => undefined,
                showWelcomePage: () => undefined,
            },
        };

        const contribution = new RLanguageContribution(makeContext(), {} as ISupervisorFrameworkApi);
        contribution.registerContributions(services);

        const runCurrentStatement = registeredCommands.get(RCommandIds.runCurrentStatement);
        assert.ok(runCurrentStatement, 'Expected run current statement command to be registered');

        await runCurrentStatement!();

        assert.ok(executedCommands.some((entry) =>
            entry.command === 'supervisor.console.executeCode' &&
            entry.args.length === 0
        ));
    });

    test('helpShowHelpAtCursor uses the console-session owner for R language services', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();
        const helpRequests: Array<{ line: number; character: number }> = [];
        const helpTopicCalls: Array<{ languageId: string; topic: string }> = [];
        const informationMessages: string[] = [];

        (vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }).registerCommand =
            ((command: string, callback: RegisteredCommandHandler) => {
                registeredCommands.set(command, callback);
                return new vscode.Disposable(() => {});
            }) as typeof vscode.commands.registerCommand;
        (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
            (async () => undefined) as typeof vscode.commands.executeCommand;
        (vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage =
            ((message: string) => {
                informationMessages.push(message);
                return Promise.resolve(undefined);
            }) as typeof vscode.window.showInformationMessage;

        const editorDocument = {
            languageId: 'r',
            uri: vscode.Uri.parse('file:///workspace/test.R'),
            lineCount: 1,
            getText: () => 'mean',
            lineAt: (line: number) => ({
                text: line === 0 ? 'mean' : '',
                range: new vscode.Range(line, 0, line, line === 0 ? 4 : 0),
            }),
        } as unknown as vscode.TextDocument;
        const editor = {
            document: editorDocument,
            selection: new vscode.Selection(new vscode.Position(0, 2), new vscode.Position(0, 2)),
            selections: [new vscode.Selection(new vscode.Position(0, 2), new vscode.Position(0, 2))],
        } as unknown as vscode.TextEditor;
        setActiveTextEditor(editor);

        const consoleSession = {
            runtimeMetadata: makeRuntimeMetadata(),
            waitLsp: async () => ({
                helpTopicProvider: {
                    provideHelpTopic: async (
                        _document: vscode.TextDocument,
                        position: vscode.Position,
                    ) => {
                        helpRequests.push({
                            line: position.line,
                            character: position.character,
                        });
                        return 'mean';
                    },
                },
            }),
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
                getConsoleSessionForLanguage: (languageId: string) =>
                    languageId === 'r' ? consoleSession as any : undefined,
                restartSession: async () => undefined,
                selectInstallation: async () => undefined,
            } as unknown as IRuntimeSessionService,
            runtimeStartupService: {
                startupPhase: 'complete' as RuntimeStartupPhase,
                getRestoredSessions: async () => [],
                getPreferredRuntime: () => undefined,
                registerRuntimeManager: () => new vscode.Disposable(() => {}),
            } as unknown as IRuntimeStartupService,
            positronNewFolderService: {} as any,
            runtimeManager: {
                registerExternalDiscoveryManager: () => new vscode.Disposable(() => {}),
            } as any,
            positronConsoleService: makeConsoleServiceStub(),
            positronHelpService: {
                showHelpTopic: async (languageId: string, topic: string) => {
                    helpTopicCalls.push({ languageId, topic });
                    return true;
                },
                find: async () => undefined,
                showWelcomePage: () => undefined,
            },
        };

        const contribution = new RLanguageContribution(makeContext(), {} as ISupervisorFrameworkApi);
        contribution.registerContributions(services);

        const helpShowHelpAtCursor = registeredCommands.get(RCommandIds.helpShowHelpAtCursor);
        assert.ok(helpShowHelpAtCursor, 'Expected help at cursor command to be registered');

        await helpShowHelpAtCursor!();

        assert.deepStrictEqual(helpRequests, [{ line: 0, character: 2 }]);
        assert.deepStrictEqual(helpTopicCalls, [{ languageId: 'r', topic: 'mean' }]);
        assert.deepStrictEqual(informationMessages, []);
    });
});
