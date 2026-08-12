import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ISupervisorFrameworkApi } from '../../types/supervisor-api';
import * as rExtension from '../../extension';

function makeContext(): vscode.ExtensionContext {
    const extensionPath = path.resolve(__dirname, '../../..');
    return {
        extensionPath,
        extensionUri: vscode.Uri.file(extensionPath),
        extension: {
            id: 'mengzhiya.vscode-ark',
            packageJSON: {
                positron: { binaryDependencies: { ark: 'ark-0.1.0-1-deadbeef' } },
            },
        },
        subscriptions: [],
        globalState: {} as vscode.Memento,
        workspaceState: {} as vscode.Memento,
        asAbsolutePath: (relativePath: string) => path.join(extensionPath, relativePath),
    } as unknown as vscode.ExtensionContext;
}

suite('[Unit] Split R extension entry', () => {
    const originalGetExtension = vscode.extensions.getExtension.bind(vscode.extensions);
    const originalRegisterDebugAdapterDescriptorFactory =
        vscode.debug.registerDebugAdapterDescriptorFactory.bind(vscode.debug);
    const activeContexts: vscode.ExtensionContext[] = [];

    teardown(() => {
        (vscode.extensions as { getExtension: typeof vscode.extensions.getExtension }).getExtension = originalGetExtension;
        (vscode.debug as {
            registerDebugAdapterDescriptorFactory: typeof vscode.debug.registerDebugAdapterDescriptorFactory
        }).registerDebugAdapterDescriptorFactory = originalRegisterDebugAdapterDescriptorFactory;
        for (const context of activeContexts.splice(0)) {
            for (const disposable of context.subscriptions) {
                disposable.dispose();
            }
        }
    });

    test('throws when the supervisor dependency is unavailable', async () => {
        (vscode.extensions as { getExtension: typeof vscode.extensions.getExtension }).getExtension = (() => undefined) as typeof vscode.extensions.getExtension;

        await assert.rejects(
            () => rExtension.activate(makeContext()),
            /Required extension 'mengzhiya\.vscode-supervisor' is not installed/
        );
    });

    test('reports an incompatible supervisor API before registering local resources', async () => {
        const supervisorExtension = { activate: async () => ({}) };
        (vscode.extensions as { getExtension: typeof vscode.extensions.getExtension }).getExtension = ((id: string) =>
            id === 'mengzhiya.vscode-supervisor'
                ? supervisorExtension as unknown as vscode.Extension<unknown>
                : undefined
        ) as typeof vscode.extensions.getExtension;

        await assert.rejects(
            () => rExtension.activate(makeContext()),
            /does not expose the required Supervisor Language API/,
        );
    });

    test('commits independent R capabilities through the language registry', async () => {
        const calls: Array<{ method: string; value?: unknown }> = [];
        const handle = new vscode.Disposable(() => { });
        const builder = {
            setLogChannel(value: unknown) {
                calls.push({ method: 'setLogChannel', value });
                return this;
            },
            setRuntimeProvider(value: unknown) {
                calls.push({ method: 'setRuntimeProvider', value });
                return this;
            },
            setSessionManager(value: unknown) {
                calls.push({ method: 'setSessionManager', value });
                return this;
            },
            setLspFactory(value: unknown) {
                calls.push({ method: 'setLspFactory', value });
                return this;
            },
            setBinaryProvider(value: unknown) {
                calls.push({ method: 'setBinaryProvider', value });
                return this;
            },
            addOptionalCapability(value: unknown) {
                calls.push({ method: 'addOptionalCapability', value });
                return this;
            },
            commit() {
                calls.push({ method: 'commit' });
                return handle;
            },
        };
        const api = {
            apiVersion: 2,
            protocolVersion: { major: 2, minor: 0 },
            capabilities: ['languageCapabilityRegistry'],
            services: { logChannel: vscode.window.createOutputChannel('Ark R Registry Test', { log: true }) },
            languages: {
                forExtension: (ownerExtensionId: string) => {
                    calls.push({ method: 'forExtension', value: ownerExtensionId });
                    return {
                        ownerExtensionId,
                        begin: (identity: unknown) => {
                            calls.push({ method: 'begin', value: identity });
                            return builder;
                        },
                    };
                },
            },
        } as unknown as ISupervisorFrameworkApi;
        const supervisorExtension = { activate: async () => api };

        (vscode.debug as {
            registerDebugAdapterDescriptorFactory: typeof vscode.debug.registerDebugAdapterDescriptorFactory
        }).registerDebugAdapterDescriptorFactory = (() => new vscode.Disposable(() => { })) as
            typeof vscode.debug.registerDebugAdapterDescriptorFactory;
        (vscode.extensions as { getExtension: typeof vscode.extensions.getExtension }).getExtension = ((id: string) =>
            id === 'mengzhiya.vscode-supervisor'
                ? supervisorExtension as unknown as vscode.Extension<unknown>
                : undefined
        ) as typeof vscode.extensions.getExtension;

        const context = makeContext();
        activeContexts.push(context);
        context.subscriptions.push(api.services.logChannel);
        await rExtension.activate(context);

        assert.strictEqual(calls[0].method, 'forExtension');
        assert.strictEqual(calls[0].value, 'mengzhiya.vscode-ark');
        assert.deepStrictEqual(calls.find((call) => call.method === 'begin')?.value, {
            languageId: 'r',
            registrationId: 'core',
            revision: 1,
        });
        assert.strictEqual(
            (calls.find((call) => call.method === 'setLogChannel')?.value as vscode.OutputChannel).name,
            'R Language Pack',
        );
        assert.strictEqual(
            (calls.find((call) => call.method === 'setRuntimeProvider')?.value as { languageId?: string }).languageId,
            'r',
        );
        assert.strictEqual(
            (calls.find((call) => call.method === 'setLspFactory')?.value as { languageId?: string }).languageId,
            'r',
        );
        assert.strictEqual(
            typeof (calls.find((call) => call.method === 'setBinaryProvider')?.value as {
                getBinaryDefinitions?: unknown;
            }).getBinaryDefinitions,
            'function',
        );
        assert.strictEqual(
            typeof (calls.find((call) => call.method === 'setSessionManager')?.value as {
                managesRuntime?: unknown;
            }).managesRuntime,
            'function',
        );
        assert.deepStrictEqual(
            calls
                .filter((call) => call.method === 'addOptionalCapability')
                .map((call) => (call.value as { id: string }).id),
            ['r.sessionActions', 'r.contexts', 'r.testExplorer', 'r.packages', 'r.help', 'r.commands', 'r.dataEditors'],
        );
        assert.strictEqual(calls.filter((call) => call.method === 'commit').length, 1);
        assert.ok(context.subscriptions.includes(handle));
    });
});
