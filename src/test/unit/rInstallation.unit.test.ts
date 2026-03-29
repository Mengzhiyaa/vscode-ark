import * as assert from 'assert';
import * as vscode from 'vscode';
import type { LanguageRuntimeMetadata } from '../../types/supervisor-api';
import { restoreRInstallationFromMetadata } from '../../rLanguageContribution';
import {
    convertNativeEnvToRInstallation,
    formatRuntimeName,
    getMetadataExtra,
    RInstallation,
    ReasonDiscovered,
} from '../../runtime/r-installation';

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

function makeRuntimeMetadata(
    installation: RInstallation,
    extraRuntimeData: LanguageRuntimeMetadata['extraRuntimeData'],
): LanguageRuntimeMetadata {
    return {
        runtimeId: 'runtime-id',
        runtimeName: installation.displayName ?? installation.version,
        runtimePath: installation.binpath,
        runtimeVersion: '0.0.1',
        runtimeShortName: installation.version,
        runtimeSource: installation.source,
        languageId: 'r',
        languageName: 'R',
        languageVersion: installation.version,
        startupBehavior: installation.current
            ? 'immediate' as LanguageRuntimeMetadata['startupBehavior']
            : 'implicit' as LanguageRuntimeMetadata['startupBehavior'],
        extraRuntimeData,
    };
}

suite('[Unit] RInstallation', () => {
    let restoreConfiguration: (() => void) | undefined;

    setup(() => {
        restoreConfiguration = stubArkConfiguration();
    });

    teardown(() => {
        restoreConfiguration?.();
        restoreConfiguration = undefined;
    });

    test('converts RET native environments while preserving startup and overlay metadata', () => {
        const installation = convertNativeEnvToRInstallation({
            displayName: 'Production R',
            name: 'r-prod',
            executable: '/opt/conda/envs/r-prod/bin/R',
            kind: 'Conda',
            version: '4.5.3',
            home: '/opt/conda/envs/r-prod/lib/R',
            manager: {
                tool: 'Conda',
                executable: '/opt/conda/bin/conda',
                version: '24.1.0',
            },
            arch: 'x86_64',
            knownExecutables: ['/opt/conda/envs/r-prod/bin/R', '/usr/local/bin/R'],
            symlinks: ['/usr/local/bin/R'],
            discoveredBy: ['locator', 'rVersions'],
            locatorMetadata: {
                type: 'conda',
                environmentPath: '/opt/conda/envs/r-prod',
            },
            rversionsOverlay: {
                label: 'Production R',
                repo: 'https://ppm.example.com/cran/latest',
                library: '/opt/R-libs/production',
            },
            scriptPath: '/opt/conda/envs/r-prod/bin/Rscript',
            startupCommand: 'conda activate /opt/conda/envs/r-prod',
            environmentVariables: {
                R_LIBS: '/opt/R-libs/production',
            },
            orthogonal: false,
        });

        assert.ok(installation);
        assert.strictEqual(installation?.displayName, 'Production R');
        assert.strictEqual(installation?.arch, 'x86_64');
        assert.deepStrictEqual(installation?.reasonDiscovered, [
            ReasonDiscovered.CONDA,
            ReasonDiscovered.RVERSIONS,
        ]);
        assert.deepStrictEqual(installation?.discoveredBy, ['locator', 'rVersions']);
        assert.deepStrictEqual(installation?.locatorMetadata, {
            type: 'conda',
            environmentPath: '/opt/conda/envs/r-prod',
        });
        assert.deepStrictEqual(installation?.packagerMetadata, {
            kind: 'conda',
            environmentPath: '/opt/conda/envs/r-prod',
        });
        assert.deepStrictEqual(installation?.rversionsOverlay, {
            label: 'Production R',
            repo: 'https://ppm.example.com/cran/latest',
            library: '/opt/R-libs/production',
        });
        assert.strictEqual(installation?.scriptpath, '/opt/conda/envs/r-prod/bin/Rscript');
        assert.strictEqual(installation?.startupCommand, 'conda activate /opt/conda/envs/r-prod');
        assert.deepStrictEqual(installation?.environmentVariables, {
            R_LIBS: '/opt/R-libs/production',
        });
        assert.strictEqual(installation?.orthogonal, false);
        assert.deepStrictEqual(installation?.knownExecutables, [
            '/opt/conda/envs/r-prod/bin/R',
            '/usr/local/bin/R',
        ]);
    });

    test('prefers r-versions labels and RET display names when formatting runtime names', () => {
        const labeled = new RInstallation({
            binpath: '/usr/bin/R',
            homepath: '/usr/lib/R',
            version: '4.4.1',
            displayName: 'Display Name',
            rversionsOverlay: {
                label: 'Overlay Label',
            },
        });
        const displayNamed = new RInstallation({
            binpath: '/usr/bin/R',
            homepath: '/usr/lib/R',
            version: '4.4.1',
            displayName: 'Display Name',
        });
        const conda = new RInstallation({
            binpath: '/opt/conda/envs/r/bin/R',
            homepath: '/opt/conda/envs/r/lib/R',
            version: '4.4.1',
            packagerMetadata: {
                kind: 'conda',
                environmentPath: '/opt/conda/envs/r',
            },
        });

        assert.strictEqual(formatRuntimeName(labeled), 'Overlay Label (R 4.4.1)');
        assert.strictEqual(formatRuntimeName(displayNamed), 'Display Name (R 4.4.1)');
        assert.strictEqual(formatRuntimeName(conda), 'R 4.4.1 (Conda: r)');
    });

    test('restores new metadata fields after round-tripping runtime metadata', () => {
        const installation = new RInstallation({
            displayName: 'Workspace R',
            name: 'r-workspace',
            binpath: '/workspace/.pixi/envs/default/bin/R',
            homepath: '/workspace/.pixi/envs/default/lib/R',
            version: '4.3.3',
            source: 'pixi',
            current: true,
            reasonDiscovered: [ReasonDiscovered.PIXI, ReasonDiscovered.RVERSIONS],
            discoveredBy: ['locator', 'rVersions'],
            knownExecutables: ['/workspace/.pixi/envs/default/bin/R'],
            symlinks: ['/usr/local/bin/R'],
            locatorMetadata: {
                type: 'pixi',
                environmentPath: '/workspace/.pixi/envs/default',
                manifestPath: '/workspace/pixi.toml',
                environmentName: 'default',
            },
            rversionsOverlay: {
                label: 'Workspace R',
                module: 'R/default',
            },
            scriptPath: '/workspace/.pixi/envs/default/bin/Rscript',
            startupCommand: 'source /tmp/activate-r.sh',
            environmentVariables: {
                R_LIBS: '/workspace/.R/library',
            },
            orthogonal: false,
        });
        const metadata = makeRuntimeMetadata(installation, getMetadataExtra(installation));

        const restored = restoreRInstallationFromMetadata(metadata);

        assert.ok(restored);
        assert.strictEqual(restored?.displayName, 'Workspace R');
        assert.strictEqual(restored?.scriptpath, '/workspace/.pixi/envs/default/bin/Rscript');
        assert.strictEqual(restored?.source, 'pixi');
        assert.deepStrictEqual(restored?.discoveredBy, ['locator', 'rVersions']);
        assert.deepStrictEqual(restored?.locatorMetadata, {
            type: 'pixi',
            environmentPath: '/workspace/.pixi/envs/default',
            manifestPath: '/workspace/pixi.toml',
            environmentName: 'default',
        });
        assert.deepStrictEqual(restored?.packagerMetadata, {
            kind: 'pixi',
            environmentPath: '/workspace/.pixi/envs/default',
            manifestPath: '/workspace/pixi.toml',
            environmentName: 'default',
        });
        assert.deepStrictEqual(restored?.rversionsOverlay, {
            label: 'Workspace R',
            module: 'R/default',
        });
        assert.strictEqual(restored?.startupCommand, 'source /tmp/activate-r.sh');
        assert.deepStrictEqual(restored?.environmentVariables, {
            R_LIBS: '/workspace/.R/library',
        });
        assert.strictEqual(restored?.orthogonal, false);
        assert.deepStrictEqual(restored?.knownExecutables, ['/workspace/.pixi/envs/default/bin/R']);
    });

    test('round-trips RET-backed metadata through retPayload without duplicating packager fields', () => {
        const installation = convertNativeEnvToRInstallation({
            displayName: 'Production R',
            name: 'r-prod',
            executable: '/opt/conda/envs/r-prod/bin/R',
            kind: 'Conda',
            version: '4.5.3',
            home: '/opt/conda/envs/r-prod/lib/R',
            manager: {
                tool: 'Conda',
                executable: '/opt/conda/bin/conda',
            },
            discoveredBy: ['locator', 'rVersions'],
            locatorMetadata: {
                type: 'conda',
                environmentPath: '/opt/conda/envs/r-prod',
            },
            rversionsOverlay: {
                label: 'Production R',
                repo: 'https://ppm.example.com/cran/latest',
            },
            scriptPath: '/opt/conda/envs/r-prod/bin/Rscript',
            startupCommand: 'conda activate /opt/conda/envs/r-prod',
            environmentVariables: {
                R_LIBS: '/opt/R-libs/production',
            },
        });

        assert.ok(installation);

        const metadata = getMetadataExtra(installation!);
        assert.ok(metadata.retPayload);
        assert.ok(!('packagerMetadata' in metadata));
        assert.ok(!('locatorMetadata' in metadata));
        assert.ok(!('condaEnvPath' in metadata));
        assert.ok(!('envName' in metadata));

        const restored = restoreRInstallationFromMetadata(makeRuntimeMetadata(installation!, metadata));

        assert.ok(restored);
        assert.strictEqual(restored?.source, 'conda');
        assert.deepStrictEqual(restored?.packagerMetadata, {
            kind: 'conda',
            environmentPath: '/opt/conda/envs/r-prod',
        });
        assert.deepStrictEqual(restored?.locatorMetadata, {
            type: 'conda',
            environmentPath: '/opt/conda/envs/r-prod',
        });
        assert.strictEqual(restored?.startupCommand, 'conda activate /opt/conda/envs/r-prod');
        assert.deepStrictEqual(restored?.environmentVariables, {
            R_LIBS: '/opt/R-libs/production',
        });
    });

    test('serializes non-RET installations through synthesized retPayload', () => {
        const installation = new RInstallation({
            binpath: '/opt/conda/envs/r/bin/R',
            homepath: '/opt/conda/envs/r/lib/R',
            version: '4.4.1',
            source: 'configured',
            current: true,
            reasonDiscovered: [ReasonDiscovered.userSetting],
            packagerMetadata: {
                kind: 'conda',
                environmentPath: '/opt/conda/envs/r',
            },
        });

        const metadata = getMetadataExtra(installation);

        assert.strictEqual(metadata.current, true);
        assert.deepStrictEqual(metadata.reasonDiscovered, [ReasonDiscovered.userSetting]);
        assert.deepStrictEqual(metadata.retPayload, {
            displayName: undefined,
            name: undefined,
            executable: '/opt/conda/envs/r/bin/R',
            kind: 'Conda',
            version: '4.4.1',
            home: '/opt/conda/envs/r/lib/R',
            manager: undefined,
            arch: undefined,
            knownExecutables: undefined,
            symlinks: undefined,
            discoveredBy: undefined,
            locatorMetadata: {
                type: 'conda',
                environmentPath: '/opt/conda/envs/r',
            },
            rversionsOverlay: undefined,
            scriptPath: '/opt/conda/envs/r/bin/Rscript',
            startupCommand: undefined,
            environmentVariables: undefined,
            orthogonal: true,
        });
    });

    test('prefers retPayload over basic persisted fields when both are present', () => {
        const restored = restoreRInstallationFromMetadata({
            runtimeId: 'runtime-id',
            runtimeName: 'R 4.3.3',
            runtimePath: '/legacy/bin/R',
            runtimeVersion: '0.0.1',
            runtimeShortName: '4.3.3',
            runtimeSource: 'system',
            languageId: 'r',
            languageName: 'R',
            languageVersion: '4.3.3',
            extraRuntimeData: {
                homepath: '/legacy/lib/R',
                binpath: '/legacy/bin/R',
                retPayload: {
                    name: 'default',
                    executable: '/workspace/.pixi/envs/default/bin/R',
                    kind: 'Pixi',
                    version: '4.3.3',
                    home: '/workspace/.pixi/envs/default/lib/R',
                    locatorMetadata: {
                        type: 'pixi',
                        environmentPath: '/workspace/.pixi/envs/default',
                        manifestPath: null,
                        environmentName: 'default',
                    },
                    scriptPath: '/workspace/.pixi/envs/default/bin/Rscript',
                },
            },
        });

        assert.ok(restored);
        assert.strictEqual(restored?.binpath, '/workspace/.pixi/envs/default/bin/R');
        assert.strictEqual(restored?.homepath, '/workspace/.pixi/envs/default/lib/R');
        assert.strictEqual(restored?.source, 'pixi');
        assert.deepStrictEqual(restored?.packagerMetadata, {
            kind: 'pixi',
            environmentPath: '/workspace/.pixi/envs/default',
            manifestPath: undefined,
            environmentName: 'default',
        });
        assert.deepStrictEqual(restored?.locatorMetadata, {
            type: 'pixi',
            environmentPath: '/workspace/.pixi/envs/default',
            manifestPath: null,
            environmentName: 'default',
        });
    });

    test('restores a basic installation when persisted retPayload is absent', () => {
        const restored = restoreRInstallationFromMetadata({
            runtimeId: 'runtime-id',
            runtimeName: 'R 4.4.1',
            runtimePath: '/usr/local/bin/R',
            runtimeVersion: '0.0.1',
            runtimeShortName: '4.4.1',
            runtimeSource: 'configured',
            languageId: 'r',
            languageName: 'R',
            languageVersion: '4.4.1',
            extraRuntimeData: {
                homepath: '/usr/local/lib/R',
                binpath: '/usr/local/bin/R',
                arch: 'x86_64',
                current: true,
                scriptpath: '/usr/local/bin/Rscript',
            },
        });

        assert.ok(restored);
        assert.strictEqual(restored?.source, 'configured');
        assert.strictEqual(restored?.binpath, '/usr/local/bin/R');
        assert.strictEqual(restored?.homepath, '/usr/local/lib/R');
        assert.strictEqual(restored?.scriptpath, '/usr/local/bin/Rscript');
        assert.strictEqual(restored?.arch, 'x86_64');
        assert.strictEqual(restored?.current, true);
        assert.strictEqual(restored?.packagerMetadata, undefined);
        assert.strictEqual(restored?.locatorMetadata, undefined);
    });
});
