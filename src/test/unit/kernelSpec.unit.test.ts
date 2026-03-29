import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import * as condaModule from '../../runtime/conda';
import * as kernelModule from '../../runtime/kernel';
import { createJupyterKernelSpec } from '../../runtime/kernel-spec';
import { RInstallation } from '../../runtime/r-installation';

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

suite('[Unit] kernel-spec', () => {
    const originalGetArkKernelPath = kernelModule.getArkKernelPath;
    const originalResolveCondaCommand = condaModule.resolveCondaCommand;
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    let restoreConfiguration: (() => void) | undefined;

    setup(() => {
        restoreConfiguration = stubArkConfiguration({
            'kernel.logLevel': 'warn',
            'kernel.logLevelExternal': 'warn',
            'kernel.env': {
                USER_FLAG: '1',
            },
            saveAndRestoreWorkspace: false,
            extraArguments: [],
            quietMode: false,
        });
        (kernelModule as { getArkKernelPath: typeof kernelModule.getArkKernelPath }).getArkKernelPath =
            (() => '/tmp/ark') as typeof kernelModule.getArkKernelPath;
    });

    teardown(() => {
        restoreConfiguration?.();
        restoreConfiguration = undefined;
        (kernelModule as { getArkKernelPath: typeof kernelModule.getArkKernelPath }).getArkKernelPath =
            originalGetArkKernelPath;
        (condaModule as { resolveCondaCommand: typeof condaModule.resolveCondaCommand }).resolveCondaCommand =
            originalResolveCondaCommand;

        if (originalPlatform) {
            Object.defineProperty(process, 'platform', originalPlatform);
        }
    });

    test('prefers RET startup command and environment variables', async () => {
        const installation = new RInstallation({
            binpath: '/opt/conda/envs/r/bin/R',
            homepath: '/opt/conda/envs/r/lib/R',
            version: '4.4.1',
            packagerMetadata: {
                kind: 'conda',
                environmentPath: '/opt/conda/envs/r',
            },
            startupCommand: 'conda activate /opt/conda/envs/r',
            environmentVariables: {
                R_LIBS: '/opt/R-libs',
            },
        });

        const spec = await createJupyterKernelSpec(makeContext(), installation, 'console', makeLogChannel());

        assert.strictEqual(spec.startup_command, 'conda activate /opt/conda/envs/r');
        assert.strictEqual(spec.env?.R_LIBS, '/opt/R-libs');
        assert.strictEqual(spec.env?.USER_FLAG, '1');
    });

    test('falls back to conda activation on Unix when RET launch metadata is absent', async () => {
        const installation = new RInstallation({
            binpath: '/opt/conda/envs/r/bin/R',
            homepath: '/opt/conda/envs/r/lib/R',
            version: '4.4.1',
            packagerMetadata: {
                kind: 'conda',
                environmentPath: '/opt/conda/envs/r',
            },
        });

        const spec = await createJupyterKernelSpec(makeContext(), installation, 'console', makeLogChannel());

        if (process.platform !== 'win32') {
            assert.strictEqual(spec.startup_command, 'conda activate /opt/conda/envs/r');
        }
    });

    test('falls back to PATH-based pixi activation when RET launch metadata is absent', async () => {
        const installation = new RInstallation({
            binpath: '/workspace/.pixi/envs/default/bin/R',
            homepath: '/workspace/.pixi/envs/default/lib/R',
            version: '4.3.3',
            packagerMetadata: {
                kind: 'pixi',
                environmentPath: '/workspace/.pixi/envs/default',
                manifestPath: '/workspace/pixi.toml',
                environmentName: 'default',
            },
        });

        const spec = await createJupyterKernelSpec(makeContext(), installation, 'console', makeLogChannel());

        assert.strictEqual(spec.startup_command, undefined);
        assert.strictEqual(spec.env?.PIXI_ENVIRONMENT_PATH, '/workspace/.pixi/envs/default');
        assert.ok(spec.env?.PATH?.startsWith('/workspace/.pixi/envs/default/bin'));
    });

    test('keeps Windows conda fallback when RET launch metadata is absent', async () => {
        Object.defineProperty(process, 'platform', {
            configurable: true,
            value: 'win32',
        });
        (condaModule as { resolveCondaCommand: typeof condaModule.resolveCondaCommand }).resolveCondaCommand =
            (() => undefined) as typeof condaModule.resolveCondaCommand;

        const installation = new RInstallation({
            binpath: 'C:/miniconda/envs/r/Lib/R/bin/x64/R.exe',
            homepath: 'C:/miniconda/envs/r/Lib/R',
            version: '4.4.1',
            packagerMetadata: {
                kind: 'conda',
                environmentPath: 'C:/miniconda/envs/r',
            },
        });

        const spec = await createJupyterKernelSpec(makeContext(), installation, 'console', makeLogChannel());

        assert.strictEqual(spec.startup_command, undefined);
        assert.strictEqual(spec.env?.CONDA_PREFIX, 'C:/miniconda/envs/r');
        assert.strictEqual(spec.env?.CONDA_DEFAULT_ENV, 'r');
        assert.ok(spec.argv.includes('--standard-dll-search-order'));
    });

    test('uses manager executable as the conda command on Windows', async () => {
        Object.defineProperty(process, 'platform', {
            configurable: true,
            value: 'win32',
        });

        const installation = new RInstallation({
            binpath: 'C:/miniconda/envs/r/Lib/R/bin/x64/R.exe',
            homepath: 'C:/miniconda/envs/r/Lib/R',
            version: '4.4.1',
            manager: {
                tool: 'Conda',
                executable: 'C:/miniconda/Scripts/conda.exe',
            },
            packagerMetadata: {
                kind: 'conda',
                environmentPath: 'C:/miniconda/envs/r',
            },
        });

        const spec = await createJupyterKernelSpec(makeContext(), installation, 'console', makeLogChannel());

        assert.strictEqual(spec.startup_command, undefined);
        assert.strictEqual(spec.env?.CONDA_PREFIX, 'C:/miniconda/envs/r');
        assert.strictEqual(spec.env?.CONDA_EXE, 'C:/miniconda/Scripts/conda.exe');
        assert.ok(spec.env?.PATH?.includes('C:/miniconda/Scripts'));
    });
});
