/**
 * Jupyter Kernel Spec Creation
 * 
 * Creates the kernel specification for starting ARK.
 * Simplified version of positron-r's kernel-spec.ts
 */

import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { execSync } from 'child_process';
import type { JupyterKernelSpec } from '../types/supervisor-api';
import { getArkKernelPath } from './kernel';
import { RInstallation } from './rDiscovery';

function setSpeculativeCondaEnvVars(env: Record<string, string>, envPath: string, condaExe?: string): void {
    env['CONDA_PREFIX'] = envPath;
    env['CONDA_DEFAULT_ENV'] = path.basename(envPath);
    env['CONDA_SHLVL'] = '1';
    env['CONDA_CHANGEPS1'] = 'no';
    env['CONDA_PROMPT_MODIFIER'] = '';
    const pathParts: string[] = [];
    if (condaExe) {
        env['CONDA_EXE'] = condaExe;
        const condaRoot = path.dirname(path.dirname(condaExe));
        env['CONDA_PYTHON_EXE'] = path.join(condaRoot, 'python.exe');
        pathParts.push(
            path.join(condaRoot, 'Scripts'),
            condaRoot,
            path.join(condaRoot, 'Library', 'bin')
        );
    }
    pathParts.push(
        path.join(envPath, 'Scripts'),
        envPath,
        path.join(envPath, 'Library', 'bin'),
        path.join(envPath, 'Lib', 'R', 'bin', 'x64')
    );
    const currentPath = process.env.PATH || '';
    env['PATH'] = pathParts.join(';') + ';' + currentPath;
}

function findCondaExe(envPath: string): string | undefined {
    if (process.platform !== 'win32') {
        return undefined;
    }

    const pathParts = envPath.split(path.sep);
    const envsIndex = pathParts.indexOf('envs');

    let condaRoot: string;
    if (envsIndex !== -1) {
        condaRoot = pathParts.slice(0, envsIndex).join(path.sep);
    } else {
        condaRoot = path.dirname(envPath);
    }

    const condaExePath = path.join(condaRoot, 'Scripts', 'conda.exe');
    if (fs.existsSync(condaExePath)) {
        return condaExePath;
    }

    const condabinCondaExePath = path.join(condaRoot, 'condabin', 'conda.exe');
    if (fs.existsSync(condabinCondaExePath)) {
        return condabinCondaExePath;
    }

    return undefined;
}

async function captureCondaEnvVarsWindows(
    env: Record<string, string>,
    rBinaryPath: string,
    envPath: string,
    envName: string,
    log: vscode.LogOutputChannel
): Promise<void> {
    const condaExe = findCondaExe(envPath);
    if (!condaExe) {
        log.error(`Could not find conda.exe for environment: ${envPath}`);
        setSpeculativeCondaEnvVars(env, envPath);
        return;
    }

    let cancelled = false;

    const doActivation = (): void => {
        try {
            const command = `"${condaExe}" shell.cmd.exe activate ${envName}`;
            log.debug(`Running to capture Conda variables: ${command}`);
            const scriptPath = execSync(command, { encoding: 'utf8', timeout: 10000 }).trim();
            if (fs.existsSync(scriptPath)) {
                const scriptContent = fs.readFileSync(scriptPath, 'utf8');
                try {
                    fs.unlinkSync(scriptPath);
                } catch (e) {
                    log.warn(`Failed to delete temp conda script file: ${e}`);
                }
                if (cancelled) {
                    throw new Error('Conda activation cancelled by user');
                }
                const lines = scriptContent.split('\n');
                if (lines.length === 0) {
                    throw new Error('Conda activation script is empty');
                }
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.includes('=')) {
                        continue;
                    }
                    const eqIndex = trimmed.indexOf('=');
                    if (eqIndex === -1) {
                        continue;
                    }
                    let envKey = trimmed.substring(0, eqIndex).trim();
                    let envValue = trimmed.substring(eqIndex + 1).trim();
                    if (process.platform === 'win32') {
                        envKey = envKey.toUpperCase();
                        if (rBinaryPath &&
                            envKey === 'PATH' &&
                            !envValue.includes(path.dirname(rBinaryPath))) {
                            envValue = path.dirname(rBinaryPath) + ';' + envValue;
                        }
                    }
                    env[envKey] = envValue;
                }
            } else {
                throw new Error(`Activation script not found at ${scriptPath}`);
            }
        } catch (e: any) {
            log.error(`Failed to capture conda environment variables: ${e?.message || e}`);
            if (e?.stdout) {
                log.error(`stdout: ${e.stdout}`);
            }
            if (e?.stderr) {
                log.error(`stderr: ${e.stderr}`);
            }
            setSpeculativeCondaEnvVars(env, envPath, condaExe);
        }
    };

    const activationPromise = new Promise<void>((resolve) => {
        doActivation();
        resolve();
    });

    const progressDelay = 2000;
    let showProgress = true;

    const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
            if (showProgress) {
                vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: vscode.l10n.t("Activating Conda environment '{0}'...", envName),
                        cancellable: true
                    },
                    async (_progress, token) => {
                        token.onCancellationRequested(() => {
                            cancelled = true;
                            log.info('User cancelled conda activation');
                        });
                        await activationPromise;
                    }
                );
            }
            resolve();
        }, progressDelay);
    });

    await Promise.race([activationPromise, timeoutPromise]);
    showProgress = false;
    await activationPromise;
}

/**
 * Session mode for the kernel
 */
export type SessionMode = 'console' | 'notebook' | 'background';

/**
 * Create a Jupyter kernel specification for starting ARK.
 *
 * @param context The extension context
 * @param rInstallation The R installation to use
 * @param sessionMode The session mode (console, notebook, background)
 * @param log Output channel for logging
 * @returns A JupyterKernelSpec for the kernel
 */
export async function createJupyterKernelSpec(
    context: vscode.ExtensionContext,
    rInstallation: RInstallation,
    sessionMode: SessionMode,
    log: vscode.LogOutputChannel
): Promise<JupyterKernelSpec> {
    // Get the path to the ARK kernel
    const kernelPath = getArkKernelPath(context, {
        rBinaryPath: rInstallation.binpath,
        rHomePath: rInstallation.homepath,
        rArch: rInstallation.arch
    });

    if (!kernelPath) {
        throw new Error('Unable to find ARK kernel binary. Please run "npm run install:ark"');
    }

    log.info(`Using ARK kernel at: ${kernelPath}`);

    // Read log level from configuration
    const config = vscode.workspace.getConfiguration('ark');
    const logLevel = config.get<string>('kernel.logLevel') ?? 'warn';
    const logLevelForeign = config.get<string>('kernel.logLevelExternal') ?? 'warn';
    const userEnv = config.get<object>('kernel.env') ?? {};

    // Build environment variables
    const env: Record<string, string> = {
        'RUST_BACKTRACE': '1',
        'RUST_LOG': `${logLevelForeign},ark=${logLevel}`,
        'R_HOME': rInstallation.homepath,
        ...userEnv as Record<string, string>
    };

    // Platform-specific library path settings
    if (process.platform === 'linux') {
        env['LD_LIBRARY_PATH'] = rInstallation.homepath + '/lib';
    } else if (process.platform === 'darwin') {
        env['DYLD_LIBRARY_PATH'] = rInstallation.homepath + '/lib';
    }

    // Build startup command for conda activation (required for macOS due to DYLD_LIBRARY_PATH stripping)
    let startup_command: string | undefined;
    if (rInstallation.condaEnvPath) {
        const envPath = rInstallation.condaEnvPath;
        const envName = path.basename(envPath);
        if (process.platform === 'win32') {
            await captureCondaEnvVarsWindows(env, rInstallation.binpath, envPath, envName, log);
        } else {
            startup_command = `conda activate ${envPath}`;
            log.info(`Using conda activation: ${startup_command}`);
        }
    }

    // R startup script (sets cli options for colors, hyperlinks, dynamic updates)
    const startupFile = path.join(context.extensionPath, 'resources', 'scripts', 'startup.R');

    // Build command line arguments
    const argv = [
        kernelPath,
        '--connection_file', '{connection_file}',
        '--log', '{log_file}',
        '--startup-file', startupFile,
        '--session-mode', sessionMode,
    ];

    if (process.platform === 'win32' && rInstallation.condaEnvPath) {
        argv.push('--standard-dll-search-order');
    }

    // R arguments (passed after --)
    argv.push('--', '--interactive');

    // Handle workspace saving preferences
    const saveWorkspace = config.get<boolean>('saveAndRestoreWorkspace', false);
    if (saveWorkspace) {
        argv.push('--restore-data', '--save');
    } else {
        argv.push('--no-restore-data', '--no-save');
    }

    // Extra R arguments from config
    const extraArgs = config.get<string[]>('extraArguments');
    if (extraArgs && extraArgs.length > 0) {
        argv.push(...extraArgs);
    }

    // Quiet mode
    const quietMode = config.get<boolean>('quietMode', false);
    if (quietMode && !argv.includes('--quiet')) {
        argv.push('--quiet');
    }

    const kernelSpec: JupyterKernelSpec = {
        argv,
        display_name: `R ${rInstallation.version}`,
        language: 'R',
        env,
        kernel_protocol_version: '5.5',
        startup_command
    };

    log.debug(`Kernel spec created: ${JSON.stringify(kernelSpec, null, 2)}`);

    return kernelSpec;
}
