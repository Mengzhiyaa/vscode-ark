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

    test('registers R language support through the supervisor API', async () => {
        const registrations: unknown[] = [];
        (vscode.debug as {
            registerDebugAdapterDescriptorFactory: typeof vscode.debug.registerDebugAdapterDescriptorFactory
        }).registerDebugAdapterDescriptorFactory = (() => {
            return new vscode.Disposable(() => { });
        }) as typeof vscode.debug.registerDebugAdapterDescriptorFactory;
        const api: Partial<ISupervisorFrameworkApi> = {
            registerLanguageSupport: async (registration) => {
                registrations.push(registration);
            },
        };

        const supervisorExtension = {
            activate: async () => api,
        };

        (vscode.extensions as { getExtension: typeof vscode.extensions.getExtension }).getExtension = ((id: string) => {
            return id === 'mengzhiya.vscode-supervisor'
                ? supervisorExtension as unknown as vscode.Extension<unknown>
                : undefined;
        }) as typeof vscode.extensions.getExtension;

        const context = makeContext();
        activeContexts.push(context);

        await rExtension.activate(context);

        assert.strictEqual(registrations.length, 1, 'Expected one language registration');
        const registration = registrations[0] as {
            runtimeProvider?: { languageId?: string };
            binaryProvider?: { ownerId?: string };
            languageContribution?: unknown;
            webviewAssets?: {
                localResourceRoots?: readonly vscode.Uri[];
                monacoSupportModule?: vscode.Uri;
                textMateGrammar?: {
                    scopeName?: string;
                    grammarUri?: vscode.Uri;
                };
            };
        };

        assert.strictEqual(registration.runtimeProvider?.languageId, 'r');
        assert.strictEqual(registration.binaryProvider?.ownerId, 'r');
        assert.ok(registration.languageContribution, 'Expected an R language contribution instance');
        assert.ok(
            registration.webviewAssets?.monacoSupportModule?.path.endsWith(
                '/webview/dist/rMonacoSupport/index.js'
            )
        );
        assert.strictEqual(
            registration.webviewAssets?.textMateGrammar?.scopeName,
            'source.r'
        );
        assert.ok(
            registration.webviewAssets?.textMateGrammar?.grammarUri?.path.endsWith(
                '/syntaxes/r.tmGrammar.gen.json'
            )
        );
        assert.deepStrictEqual(
            registration.webviewAssets?.localResourceRoots?.map((uri) =>
                uri.path.endsWith('/webview/dist') ||
                uri.path.endsWith('/syntaxes')
            ),
            [true, true]
        );
    });
});
