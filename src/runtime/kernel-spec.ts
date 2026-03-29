import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import type { JupyterKernelSpec } from '../types/supervisor-api';
import { resolveCondaCommand } from './conda';
import { getArkEnvironmentVariables, getArkKernelPath } from './kernel';
import {
    formatRuntimeName,
    isCondaMetadata,
    isPixiMetadata,
    type RInstallation,
} from './r-installation';

function prependPathEntry(env: Record<string, string>, entries: string[]): void {
    const currentPath = env.PATH ?? process.env.PATH ?? '';
    env.PATH = [...entries, currentPath].filter(Boolean).join(path.delimiter);
}

function setPixiEnvironmentVariables(
    env: Record<string, string>,
    environmentPath: string,
): void {
    prependPathEntry(env, [path.join(environmentPath, 'bin')]);
    env.PIXI_ENVIRONMENT_PATH = environmentPath;
}

function setSpeculativeCondaEnvVars(
    env: Record<string, string>,
    environmentPath: string,
    condaExe?: string,
): void {
    env.CONDA_PREFIX = environmentPath;
    env.CONDA_DEFAULT_ENV = path.basename(environmentPath);
    env.CONDA_SHLVL = '1';
    env.CONDA_CHANGEPS1 = 'no';
    env.CONDA_PROMPT_MODIFIER = '';

    const pathParts: string[] = [];
    if (condaExe) {
        env.CONDA_EXE = condaExe;
        const condaRoot = path.dirname(path.dirname(condaExe));
        env.CONDA_PYTHON_EXE = path.join(condaRoot, 'python.exe');
        pathParts.push(
            path.join(condaRoot, 'Scripts'),
            condaRoot,
            path.join(condaRoot, 'Library', 'bin'),
        );
    }

    pathParts.push(
        path.join(environmentPath, 'Scripts'),
        environmentPath,
        path.join(environmentPath, 'Library', 'bin'),
        path.join(environmentPath, 'Lib', 'R', 'bin', 'x64'),
    );

    prependPathEntry(env, pathParts);
}

async function captureCondaEnvVarsWindows(
    env: Record<string, string>,
    rBinaryPath: string,
    environmentPath: string,
    environmentName: string,
    condaCommand: string | undefined,
    log: vscode.LogOutputChannel,
): Promise<void> {
    if (!condaCommand) {
        log.error(`Could not resolve a conda command for environment: ${environmentPath}`);
        setSpeculativeCondaEnvVars(env, environmentPath);
        return;
    }

    let cancelled = false;
    const activationPromise = new Promise<void>((resolve) => {
        try {
            const command = `"${condaCommand}" shell.cmd.exe activate ${environmentName}`;
            log.debug(`Running to capture Conda variables: ${command}`);
            const scriptPath = execSync(command, { encoding: 'utf8', timeout: 10000 }).trim();

            if (!fs.existsSync(scriptPath)) {
                throw new Error(`Activation script not found at ${scriptPath}`);
            }

            const scriptContent = fs.readFileSync(scriptPath, 'utf8');
            try {
                fs.unlinkSync(scriptPath);
            } catch (error) {
                log.warn(`Failed to delete temp conda script file: ${error}`);
            }

            if (cancelled) {
                throw new Error('Conda activation cancelled by user');
            }

            for (const line of scriptContent.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.includes('=')) {
                    continue;
                }

                const separatorIndex = trimmed.indexOf('=');
                let envKey = trimmed.slice(0, separatorIndex).trim().toUpperCase();
                let envValue = trimmed.slice(separatorIndex + 1).trim();
                if (envKey === 'PATH' && !envValue.includes(path.dirname(rBinaryPath))) {
                    envValue = `${path.dirname(rBinaryPath)};${envValue}`;
                }

                env[envKey] = envValue;
            }
        } catch (error: any) {
            log.error(`Failed to capture conda environment variables: ${error?.message || error}`);
            if (error?.stdout) {
                log.error(`stdout: ${error.stdout}`);
            }
            if (error?.stderr) {
                log.error(`stderr: ${error.stderr}`);
            }
            setSpeculativeCondaEnvVars(env, environmentPath, condaCommand);
        } finally {
            resolve();
        }
    });

    const progressDelay = 2000;
    let showProgress = true;
    const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
            if (showProgress) {
                void vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: vscode.l10n.t("Activating Conda environment '{0}'...", environmentName),
                        cancellable: true,
                    },
                    async (_progress, token) => {
                        token.onCancellationRequested(() => {
                            cancelled = true;
                            log.info('User cancelled conda activation');
                        });
                        await activationPromise;
                    },
                );
            }
            resolve();
        }, progressDelay);
    });

    await Promise.race([activationPromise, timeoutPromise]);
    showProgress = false;
    await activationPromise;
}

export type SessionMode = 'console' | 'notebook' | 'background';

export async function createJupyterKernelSpec(
    context: vscode.ExtensionContext,
    rInstallation: RInstallation,
    sessionMode: SessionMode,
    log: vscode.LogOutputChannel,
): Promise<JupyterKernelSpec> {
    const kernelPath = getArkKernelPath(context, {
        rBinaryPath: rInstallation.binpath,
        rHomePath: rInstallation.homepath,
        rArch: rInstallation.arch,
    });

    if (!kernelPath) {
        throw new Error('Unable to find ARK kernel binary. Please run "npm run install:ark"');
    }

    log.info(`Using ARK kernel at: ${kernelPath}`);

    const config = vscode.workspace.getConfiguration('ark');
    const logLevel = config.get<string>('kernel.logLevel') ?? 'warn';
    const logLevelForeign = config.get<string>('kernel.logLevelExternal') ?? 'warn';
    const userEnv = config.get<Record<string, string>>('kernel.env') ?? {};

    const env: Record<string, string> = {
        RUST_BACKTRACE: '1',
        RUST_LOG: `${logLevelForeign},ark=${logLevel}`,
        ...getArkEnvironmentVariables(rInstallation.homepath),
        ...userEnv,
    };

    if (rInstallation.environmentVariables) {
        Object.assign(env, rInstallation.environmentVariables);
        log.info('Using RET-provided environment variables');
    }

    const hasRetEnvironmentVariables = !!rInstallation.environmentVariables &&
        Object.keys(rInstallation.environmentVariables).length > 0;
    let startup_command: string | undefined = rInstallation.startupCommand;

    if (startup_command) {
        log.info(`Using RET startup command: ${startup_command}`);
    }

    if (
        !startup_command &&
        !hasRetEnvironmentVariables &&
        rInstallation.packagerMetadata &&
        isCondaMetadata(rInstallation.packagerMetadata)
    ) {
        const environmentPath = rInstallation.packagerMetadata.environmentPath;
        const environmentName = path.basename(environmentPath);
        const condaCommand = resolveCondaCommand(rInstallation);

        if (process.platform === 'win32') {
            await captureCondaEnvVarsWindows(
                env,
                rInstallation.binpath,
                environmentPath,
                environmentName,
                condaCommand,
                log,
            );
        } else {
            startup_command = `conda activate ${environmentPath}`;
            log.info(`Using conda activation: ${startup_command}`);
        }
    } else if (
        !startup_command &&
        !hasRetEnvironmentVariables &&
        rInstallation.packagerMetadata &&
        isPixiMetadata(rInstallation.packagerMetadata)
    ) {
        setPixiEnvironmentVariables(env, rInstallation.packagerMetadata.environmentPath);
        log.info(`Using direct Pixi environment variables: ${rInstallation.packagerMetadata.environmentPath}`);
    }

    const startupFile = path.join(context.extensionPath, 'resources', 'scripts', 'startup.R');
    const argv = [
        kernelPath,
        '--connection_file', '{connection_file}',
        '--log', '{log_file}',
        '--startup-file', startupFile,
        '--session-mode', sessionMode,
    ];

    if (process.platform === 'win32' && rInstallation.packagerMetadata && isCondaMetadata(rInstallation.packagerMetadata)) {
        argv.push('--standard-dll-search-order');
    }

    argv.push('--', '--interactive');

    const saveWorkspace = config.get<boolean>('saveAndRestoreWorkspace', false);
    if (saveWorkspace) {
        argv.push('--restore-data', '--save');
    } else {
        argv.push('--no-restore-data', '--no-save');
    }

    const extraArgs = config.get<string[]>('extraArguments');
    if (extraArgs?.length) {
        argv.push(...extraArgs);
    }

    const quietMode = config.get<boolean>('quietMode', false);
    if (quietMode && !argv.includes('--quiet')) {
        argv.push('--quiet');
    }

    const kernelSpec: JupyterKernelSpec = {
        argv,
        display_name: formatRuntimeName(rInstallation),
        language: 'R',
        env,
        kernel_protocol_version: '5.5',
        startup_command,
    };

    log.debug(`Kernel spec created: ${JSON.stringify(kernelSpec, null, 2)}`);
    return kernelSpec;
}
