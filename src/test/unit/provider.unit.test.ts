import * as assert from 'assert';
import * as vscode from 'vscode';
import * as providerRetModule from '../../runtime/provider-ret';
import {
    discoverRInstallations,
    getBestRInstallation,
} from '../../runtime/provider';
import { RInstallation } from '../../runtime/r-installation';

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

function stubArkConfiguration(values: Record<string, unknown> = {}): () => void {
    const originalGetConfiguration = vscode.workspace.getConfiguration.bind(vscode.workspace);
    (vscode.workspace as { getConfiguration: typeof vscode.workspace.getConfiguration }).getConfiguration =
        ((section?: string) => {
            if (section !== 'ark') {
                return originalGetConfiguration(section);
            }

            return {
                get: <T>(key: string, defaultValue?: T) => {
                    return (key in values ? values[key] : defaultValue) as T;
                },
            } as vscode.WorkspaceConfiguration;
        }) as typeof vscode.workspace.getConfiguration;

    return () => {
        (vscode.workspace as { getConfiguration: typeof vscode.workspace.getConfiguration }).getConfiguration =
            originalGetConfiguration;
    };
}

suite('[Unit] provider discovery', () => {
    const originalHasNativeRFinder = providerRetModule.hasNativeRFinder;
    const originalGetBestRetInstallation = providerRetModule.getBestRetInstallation;
    const originalDiscoverRetInstallations = providerRetModule.discoverRetInstallations;
    let restoreConfiguration: (() => void) | undefined;

    setup(() => {
        restoreConfiguration = stubArkConfiguration();
    });

    teardown(() => {
        restoreConfiguration?.();
        restoreConfiguration = undefined;
        (providerRetModule as { hasNativeRFinder: typeof providerRetModule.hasNativeRFinder }).hasNativeRFinder =
            originalHasNativeRFinder;
        (providerRetModule as { getBestRetInstallation: typeof providerRetModule.getBestRetInstallation }).getBestRetInstallation =
            originalGetBestRetInstallation;
        (providerRetModule as { discoverRetInstallations: typeof providerRetModule.discoverRetInstallations }).discoverRetInstallations =
            originalDiscoverRetInstallations;
    });

    test('does not fall back to legacy TypeScript discovery when RET is unavailable', async () => {
        (providerRetModule as { hasNativeRFinder: typeof providerRetModule.hasNativeRFinder }).hasNativeRFinder =
            (() => false) as typeof providerRetModule.hasNativeRFinder;

        const installation = await getBestRInstallation(makeLogChannel());
        const discovered = await discoverRInstallations(makeLogChannel());

        assert.strictEqual(installation, undefined);
        assert.deepStrictEqual(discovered, []);
    });

    test('uses RET discovery results when available', async () => {
        const retInstallation = new RInstallation({
            displayName: 'RET R',
            binpath: '/opt/R/4.4.1/bin/R',
            homepath: '/opt/R/4.4.1/lib/R',
            version: '4.4.1',
            source: 'system',
        });

        (providerRetModule as { hasNativeRFinder: typeof providerRetModule.hasNativeRFinder }).hasNativeRFinder =
            (() => true) as typeof providerRetModule.hasNativeRFinder;
        (providerRetModule as { getBestRetInstallation: typeof providerRetModule.getBestRetInstallation }).getBestRetInstallation =
            (async () => retInstallation) as typeof providerRetModule.getBestRetInstallation;
        (providerRetModule as { discoverRetInstallations: typeof providerRetModule.discoverRetInstallations }).discoverRetInstallations =
            (async function* () {
                yield retInstallation;
            }) as typeof providerRetModule.discoverRetInstallations;

        const installation = await getBestRInstallation(makeLogChannel());
        const discovered = await discoverRInstallations(makeLogChannel());

        assert.strictEqual(installation?.binpath, '/opt/R/4.4.1/bin/R');
        assert.strictEqual(installation?.current, true);
        assert.deepStrictEqual(discovered.map(item => item.binpath), ['/opt/R/4.4.1/bin/R']);
    });
});
