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
    type RVersionsOverlay,
} from './r-installation';

function prependPathEntry(env: Record<string, string>, entries: string[]): void {
    const currentPath = env.PATH ?? process.env.PATH ?? '';
    env.PATH = [...entries, currentPath].filter(Boolean).join(path.delimiter);
}

function quoteShellArgument(argument: string): string {
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(argument)) {
        return argument;
    }

    return `'${argument.replace(/'/g, `'"'"'`)}'`;
}

function getCliHyperlinkEnvironment(): Record<string, string> {
    const extensionUriBase = `${vscode.env.uriScheme}://mengzhiya.vscode-ark`;
    return {
        R_CLI_HYPERLINKS: 'TRUE',
        R_CLI_HYPERLINK_FILE_URL_FORMAT: `${vscode.env.uriScheme}://file{path}:{line}:{column}`,
        R_CLI_HYPERLINK_RUN: 'TRUE',
        R_CLI_HYPERLINK_RUN_URL_FORMAT: `${extensionUriBase}/cli?command=x-r-run:{code}`,
        R_CLI_HYPERLINK_HELP: 'TRUE',
        R_CLI_HYPERLINK_HELP_URL_FORMAT: `${extensionUriBase}/cli?command=x-r-help:{topic}`,
        R_CLI_HYPERLINK_VIGNETTE: 'TRUE',
        R_CLI_HYPERLINK_VIGNETTE_URL_FORMAT: `${extensionUriBase}/cli?command=x-r-vignette:{vignette}`,
    };
}

function findReposConf(): string | undefined {
    const configDirs: string[] = [];
    const userConfigDir = process.env.XDG_CONFIG_HOME ??
        (process.platform === 'win32'
            ? process.env.APPDATA
            : process.env.HOME ? path.join(process.env.HOME, '.config') : undefined);
    if (userConfigDir) {
        configDirs.push(userConfigDir);
    }

    const systemConfigDirs = process.env.XDG_CONFIG_DIRS?.split(path.delimiter).filter(Boolean) ??
        (process.platform === 'win32' ? [] : ['/etc/xdg']);
    configDirs.push(...systemConfigDirs);
    if (process.platform !== 'win32') {
        configDirs.push('/etc');
    }

    for (const product of ['rstudio', 'positron']) {
        for (const configDir of configDirs) {
            const reposConf = path.join(configDir, product, 'repos.conf');
            if (fs.existsSync(reposConf)) {
                return reposConf;
            }
        }
    }

    return undefined;
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
    const profile = config.get<string>('kernel.profile')?.trim();

    const env: Record<string, string> = {
        RUST_BACKTRACE: '1',
        RUST_LOG: `${logLevelForeign},ark=${logLevel}`,
        ...getArkEnvironmentVariables(rInstallation.homepath),
        ...getCliHyperlinkEnvironment(),
        ...userEnv,
    };

    if (profile) {
        env.ARK_PROFILE = profile;
    }

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
            startup_command = `conda activate ${quoteShellArgument(environmentPath)}`;
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

    if (profile) {
        argv.push('--profile', '{profile_file}');
    }

    if (process.platform === 'win32' && rInstallation.packagerMetadata) {
        argv.push('--standard-dll-search-order');
    }

    const rVersionsRepoArgs = getRVersionsRepoArgs(rInstallation.rversionsOverlay, log);
    if (rVersionsRepoArgs) {
        argv.push(...rVersionsRepoArgs);
    }

    const defaultRepositories = config.get<string>('defaultRepositories') ?? 'auto';
    const packageManagerRepository = config.get<string>('packageManagerRepository')?.replace(/\/+$/, '');
    if (!rVersionsRepoArgs && defaultRepositories === 'auto') {
        const reposConf = findReposConf();
        if (reposConf) {
            argv.push('--repos-conf', reposConf);
        } else if (packageManagerRepository) {
            argv.push('--default-ppm-repo', packageManagerRepository);
        } else if (vscode.env.uiKind === vscode.UIKind.Web) {
            argv.push('--default-repos', 'posit-ppm');
        }
    } else if (!rVersionsRepoArgs) {
        if (packageManagerRepository) {
            log.warn('ark.packageManagerRepository is ignored unless ark.defaultRepositories is set to auto');
        }
        argv.push('--default-repos', defaultRepositories);
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

/**
 * Get repository configuration args from r-versions metadata.
 *
 * The Repo field can be either a file path to a repos.conf file or a URL.
 * For URLs, use ark's --default-cran-repo.
 * For file paths, use ark's --repos-conf.
 * Returns the appropriate argv entries, or `undefined` if no repo is specified.
 */
function getRVersionsRepoArgs(
    packagerMetadata: RVersionsOverlay | undefined,
    log: vscode.LogOutputChannel,
): string[] | undefined {
    if (!packagerMetadata?.repo) {
        return undefined;
    }

    const repo = packagerMetadata.repo;

    if (repo.startsWith('http://') || repo.startsWith('https://')) {
        log.info(`Using r-versions repo URL: ${repo}`);
        return ['--default-cran-repo', repo];
    }

    if (fs.existsSync(repo) && fs.statSync(repo).isFile()) {
        log.info(`Using r-versions repos.conf: ${repo}`);
        return ['--repos-conf', repo];
    }

    log.warn(`r-versions Repo field is not a valid URL or file path: ${repo}`);
    return undefined;
}
