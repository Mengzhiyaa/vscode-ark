import * as ch from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PassThrough } from 'stream';
import * as vscode from 'vscode';
import * as rpc from 'vscode-jsonrpc/node';

const isWindows = process.platform === 'win32';

function getRetBinaryName(): string {
    return isWindows ? 'ret.exe' : 'ret';
}

function resolveRetPath(extensionPath: string): string | undefined {
    const configuredPath = vscode.workspace.getConfiguration('ark').get<string>('ret.path');
    if (configuredPath && fs.existsSync(configuredPath)) {
        return configuredPath;
    }

    const bundledPath = path.join(extensionPath, 'resources', 'ret', getRetBinaryName());
    if (fs.existsSync(bundledPath)) {
        return bundledPath;
    }

    return undefined;
}

export interface NativeREnvInfo {
    displayName?: string;
    name?: string;
    executable?: string;
    kind?: string;
    version?: string;
    home?: string;
    manager?: NativeREnvManagerInfo;
    arch?: string;
    symlinks?: string[];
    error?: string;
}

export interface NativeREnvManagerInfo {
    tool: string;
    executable: string;
    version?: string;
}

interface NativeLog {
    level: string;
    message: string;
}

interface ConfigurationOptions {
    workspaceDirectories?: string[];
    environmentDirectories?: string[];
    searchDirectories?: string[];
    executables?: string[];
    condaExecutable?: string;
    rigExecutable?: string;
    cacheDirectory?: string;
}

export interface NativeRFinder extends vscode.Disposable {
    readonly available: boolean;
    refresh(): AsyncIterable<NativeREnvInfo>;
    resolve(executable: string): Promise<NativeREnvInfo>;
}

class NativeRFinderImpl implements NativeRFinder {
    private readonly connection: rpc.MessageConnection | undefined;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly outputChannel: vscode.LogOutputChannel;
    private lastConfiguration: string | undefined;
    private refreshRequest: Promise<NativeREnvInfo[]> | undefined;

    readonly available: boolean;

    constructor(
        extensionPath: string,
        logChannel: vscode.LogOutputChannel,
    ) {
        this.outputChannel = logChannel;

        const retPath = resolveRetPath(extensionPath);
        if (!retPath) {
            this.outputChannel.info(
                '[NativeRFinder] RET binary not found. Native R discovery unavailable; using TypeScript fallback.'
            );
            this.available = false;
            return;
        }

        try {
            this.connection = this.start(retPath);
            this.available = true;
        } catch (error) {
            this.outputChannel.error(`[NativeRFinder] Failed to start RET server: ${error}`);
            this.available = false;
        }
    }

    async resolve(executable: string): Promise<NativeREnvInfo> {
        if (!this.connection) {
            throw new Error('NativeRFinder is not available');
        }

        await this.configure();
        return this.connection.sendRequest<NativeREnvInfo>('resolve', { executable });
    }

    async *refresh(): AsyncIterable<NativeREnvInfo> {
        if (!this.connection) {
            return;
        }

        await this.configure();

        const environments = await this.collectRefreshResults();
        for (const environment of environments) {
            yield environment;
        }
    }

    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
    }

    private start(retPath: string): rpc.MessageConnection {
        this.outputChannel.info(`[NativeRFinder] Starting RET server: ${retPath}`);

        const readable = new PassThrough();
        const writable = new PassThrough();
        const proc = ch.spawn(retPath, ['server'], { env: process.env });

        proc.stdout.pipe(readable, { end: false });
        proc.stderr.on('data', data => {
            this.outputChannel.error(`[RET stderr] ${data.toString()}`);
        });
        writable.pipe(proc.stdin, { end: false });

        proc.on('error', error => {
            this.outputChannel.error(`[NativeRFinder] RET process error: ${error.message}`);
        });

        let hasStarted = false;
        setTimeout(() => {
            hasStarted = true;
        }, 2000);

        proc.on('exit', (code, signal) => {
            if (!hasStarted && code !== null && code !== 0) {
                this.outputChannel.error(
                    `[NativeRFinder] RET process exited immediately with code ${code}` +
                    (signal ? ` (signal: ${signal})` : '')
                );
            }
        });

        this.disposables.push(new vscode.Disposable(() => {
            try {
                if (proc.exitCode === null) {
                    proc.kill();
                }
            } catch (error) {
                this.outputChannel.error(`[NativeRFinder] Error killing RET process: ${error}`);
            }
        }));

        const disposeStreams = new vscode.Disposable(() => {
            readable.end();
            writable.end();
        });

        const connection = rpc.createMessageConnection(
            new rpc.StreamMessageReader(readable),
            new rpc.StreamMessageWriter(writable),
        );

        this.disposables.push(
            connection,
            disposeStreams,
            connection.onError(error => {
                disposeStreams.dispose();
                this.outputChannel.error(`[NativeRFinder] Connection error: ${error}`);
            }),
            connection.onNotification('log', (data: NativeLog) => {
                switch (data.level) {
                    case 'info':
                        this.outputChannel.info(`[RET] ${data.message}`);
                        break;
                    case 'warning':
                        this.outputChannel.warn(`[RET] ${data.message}`);
                        break;
                    case 'error':
                        this.outputChannel.error(`[RET] ${data.message}`);
                        break;
                    case 'debug':
                        this.outputChannel.debug(`[RET] ${data.message}`);
                        break;
                    default:
                        this.outputChannel.trace(`[RET] ${data.message}`);
                }
            }),
            connection.onNotification('telemetry', (data: unknown) => {
                this.outputChannel.debug(`[RET telemetry] ${JSON.stringify(data)}`);
            }),
            connection.onNotification('manager', (data: unknown) => {
                this.outputChannel.debug(`[RET manager] ${JSON.stringify(data)}`);
            }),
            connection.onClose(() => {
                this.outputChannel.info('[NativeRFinder] RET connection closed');
            }),
        );

        connection.listen();
        return connection;
    }

    private async configure(): Promise<void> {
        if (!this.connection) {
            return;
        }

        const workspaceDirectories = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [];
        const arkConfig = vscode.workspace.getConfiguration('ark');
        const condaExecutable = arkConfig.get<string>('conda.path');
        const configuredRPath = arkConfig.get<string>('r.path');
        const executables = configuredRPath && fs.existsSync(configuredRPath)
            ? [configuredRPath]
            : undefined;

        const options: ConfigurationOptions = {
            workspaceDirectories,
            executables,
            condaExecutable: condaExecutable || undefined,
        };

        const serializedOptions = JSON.stringify(options);
        if (serializedOptions === this.lastConfiguration) {
            return;
        }

        try {
            await this.connection.sendRequest('configure', options);
            this.lastConfiguration = serializedOptions;
            this.outputChannel.debug('[NativeRFinder] Configuration sent');
        } catch (error) {
            this.outputChannel.error(`[NativeRFinder] Configure error: ${error}`);
            throw error;
        }
    }

    private async collectRefreshResults(): Promise<NativeREnvInfo[]> {
        if (!this.connection) {
            return [];
        }

        if (!this.refreshRequest) {
            this.refreshRequest = this.doCollectRefreshResults().finally(() => {
                this.refreshRequest = undefined;
            });
        }

        return this.refreshRequest;
    }

    private async doCollectRefreshResults(): Promise<NativeREnvInfo[]> {
        if (!this.connection) {
            return [];
        }

        const environments: NativeREnvInfo[] = [];
        const disposable = this.connection.onNotification(
            'installation',
            (data: NativeREnvInfo) => {
                this.outputChannel.info(
                    `[NativeRFinder] Discovered: ${data.executable || data.home || '(unknown)'}`
                );
                environments.push(data);
            },
        );

        try {
            const { duration } = await this.connection.sendRequest<{ duration: number }>('refresh', {});
            this.outputChannel.info(`[NativeRFinder] Refresh completed in ${duration}ms`);
        } catch (error) {
            this.outputChannel.error(`[NativeRFinder] Refresh error: ${error}`);
            throw error;
        } finally {
            disposable.dispose();
        }

        return this.resolveIncompleteEnvironments(environments);
    }

    private async resolveIncompleteEnvironments(
        environments: NativeREnvInfo[],
    ): Promise<NativeREnvInfo[]> {
        if (!this.connection) {
            return [];
        }

        const resolvedEnvironments: NativeREnvInfo[] = [];
        for (const environment of environments) {
            if (environment.executable && environment.version && environment.home) {
                resolvedEnvironments.push(environment);
                continue;
            }

            if (!environment.executable) {
                continue;
            }

            try {
                const resolvedEnvironment = await this.connection.sendRequest<NativeREnvInfo>(
                    'resolve',
                    { executable: environment.executable },
                );
                if (resolvedEnvironment.executable && resolvedEnvironment.version && resolvedEnvironment.home) {
                    resolvedEnvironments.push(resolvedEnvironment);
                }
            } catch (error) {
                this.outputChannel.warn(
                    `[NativeRFinder] Failed to resolve ${environment.executable}: ${error}`
                );
            }
        }

        return resolvedEnvironments;
    }
}

let finder: NativeRFinder | undefined;

export function getNativeRFinder(
    extensionPath: string,
    logChannel: vscode.LogOutputChannel,
    context?: vscode.ExtensionContext,
): NativeRFinder {
    if (!finder) {
        finder = new NativeRFinderImpl(extensionPath, logChannel);
        if (context) {
            context.subscriptions.push(finder);
        }
    }

    return finder;
}

export function disposeNativeRFinder(): void {
    finder?.dispose();
    finder = undefined;
}
