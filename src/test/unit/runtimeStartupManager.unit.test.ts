import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import type {
    ILanguageRuntimeProvider,
    IRuntimeManager,
    JupyterKernelSpec,
    LanguageRuntimeMetadata,
} from '../../types/supervisor-api';
import { RRuntimeStartupManager } from '../../runtime-startup-manager';
import type { RInstallation } from '../../runtime/rDiscovery';

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

function makeInstallation(binpath: string): RInstallation {
    return {
        binpath,
        homepath: path.dirname(path.dirname(binpath)),
        version: '4.4.1',
        current: true,
        source: 'system',
    };
}

function makeRuntimeMetadata(installation: RInstallation): LanguageRuntimeMetadata {
    return {
        runtimeId: `r-${Buffer.from(installation.binpath).toString('base64').slice(0, 8)}`,
        runtimeName: `R ${installation.version}`,
        runtimePath: installation.binpath,
        runtimeVersion: '0.0.1',
        runtimeShortName: installation.version,
        runtimeSource: installation.source,
        languageId: 'r',
        languageName: 'R',
        languageVersion: installation.version,
        extraRuntimeData: {
            homepath: installation.homepath,
            binpath: installation.binpath,
        },
    };
}

function makeRuntimeProvider(
    installations: RInstallation[],
    initialInstallation: RInstallation | undefined = installations[0],
): ILanguageRuntimeProvider<RInstallation> {
    return {
        languageId: 'r',
        languageName: 'R',
        discoverInstallations: async function* () {
            for (const installation of installations) {
                yield installation;
            }
        },
        resolveInitialInstallation: async () => initialInstallation,
        promptForInstallation: async () => undefined,
        formatRuntimeName: (installation) => `R ${installation.version}`,
        getRuntimePath: (installation) => installation.binpath,
        getRuntimeSource: (installation) => installation.source,
        createRuntimeMetadata: (_context, installation) => makeRuntimeMetadata(installation),
        createKernelSpec: async (): Promise<JupyterKernelSpec> => ({
            argv: ['ark'],
            display_name: 'R',
            language: 'R',
            kernel_protocol_version: '5.3',
        }),
        shouldRecommendForWorkspace: async () => true,
    };
}

suite('[Unit] RRuntimeStartupManager', () => {
    test('registers discovered runtimes in the shared runtime cache', async () => {
        const installations = [
            makeInstallation('/usr/bin/R'),
            makeInstallation('/opt/R/bin/R'),
        ];
        const registerCalls: Array<{
            languageId: string;
            installation: RInstallation;
            metadata: LanguageRuntimeMetadata;
        }> = [];
        const sharedRuntimeManager = {
            registerDiscoveredRuntime: (languageId: string, installation: RInstallation, metadata: LanguageRuntimeMetadata) => {
                registerCalls.push({ languageId, installation, metadata });
                return true;
            },
        } as unknown as IRuntimeManager;

        const manager = new RRuntimeStartupManager(
            makeContext(),
            makeRuntimeProvider(installations),
            sharedRuntimeManager,
            makeLogChannel(),
        );

        const discoveredRuntimePaths: string[] = [];
        let finishCount = 0;
        manager.onDidDiscoverRuntime((event) => {
            discoveredRuntimePaths.push(event.metadata.runtimePath);
        });
        manager.onDidFinishDiscovery(() => {
            finishCount += 1;
        });

        await manager.discoverAllRuntimes([]);

        assert.deepStrictEqual(
            registerCalls.map((call) => call.languageId),
            ['r', 'r'],
        );
        assert.deepStrictEqual(
            registerCalls.map((call) => call.installation.binpath),
            installations.map((installation) => installation.binpath),
        );
        assert.deepStrictEqual(
            discoveredRuntimePaths,
            installations.map((installation) => installation.binpath),
        );
        assert.strictEqual(finishCount, 1);

        manager.dispose();
    });

    test('recommends and registers the initial runtime in the shared runtime cache', async () => {
        const installation = makeInstallation('/usr/local/bin/R');
        const registerCalls: Array<{
            languageId: string;
            installation: RInstallation;
            metadata: LanguageRuntimeMetadata;
        }> = [];
        const sharedRuntimeManager = {
            registerDiscoveredRuntime: (languageId: string, runtimeInstallation: RInstallation, metadata: LanguageRuntimeMetadata) => {
                registerCalls.push({ languageId, installation: runtimeInstallation, metadata });
                return true;
            },
        } as unknown as IRuntimeManager;

        const manager = new RRuntimeStartupManager(
            makeContext(),
            makeRuntimeProvider([installation], installation),
            sharedRuntimeManager,
            makeLogChannel(),
        );

        const recommendations = await manager.recommendWorkspaceRuntimes([]);

        assert.strictEqual(recommendations.length, 1);
        assert.strictEqual(recommendations[0].runtimePath, installation.binpath);
        assert.deepStrictEqual(
            registerCalls.map((call) => call.installation.binpath),
            [installation.binpath],
        );

        manager.dispose();
    });
});
