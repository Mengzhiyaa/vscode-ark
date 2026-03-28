import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type {
    BinaryDefinition,
    IBinaryProvider,
    ILanguageExtensionContribution,
    ILanguageContributionServices,
    ILanguageInstallationPickerOptions,
    ILanguageLsp,
    ILanguageLspFactory,
    ILanguageRuntimeProvider,
    LanguageRuntimeDynState,
    LanguageRuntimeMetadata,
    LanguageRuntimeSessionLocation,
    LanguageRuntimeStartupBehavior,
    LanguageSessionMode,
    IRuntimeSessionMetadata,
    ISupervisorFrameworkApi,
} from './types/supervisor-api';
import { RCommandIds } from './rCommandIds';
import { registerTabCompletion } from './editor/tabCompletion';
import { registerHelpActions } from './services/help/helpActions';
import { R_LANGUAGE_ID } from './languageIds';
import { createJupyterKernelSpec } from './runtime/kernel-spec';
import { RLanguageLsp } from './runtime/lsp';
import { RRuntimeManager } from './runtime-manager';
import { RRuntimeStartupManager } from './runtime-startup-manager';
import { RSessionManager } from './session-manager';
import {
    formatRuntimeName,
    getBestRInstallation,
    promptForRPath,
    rRuntimeDiscoverer,
} from './runtime/provider';
import { setNativeRFinder } from './runtime/provider-ret';
import {
    getMetadataExtra,
    isPixiMetadata,
    RInstallation,
    restorePackagerMetadata,
    type RInstallationSource,
} from './runtime/r-installation';
import { getNativeRFinder } from './runtime/native-r-finder';

const RUNTIME_STARTUP_BEHAVIOR = {
    Immediate: 'immediate' as LanguageRuntimeStartupBehavior,
    Implicit: 'implicit' as LanguageRuntimeStartupBehavior,
} as const;

const RUNTIME_SESSION_LOCATION = {
    Workspace: 'workspace' as LanguageRuntimeSessionLocation,
} as const;

function loadDefaultRIconBase64(
    context: vscode.ExtensionContext,
    logChannel?: vscode.LogOutputChannel
): string | undefined {
    try {
        const iconPath = path.join(context.extensionPath, 'images', 'Rlogo.svg');
        const iconSvg = fs.readFileSync(iconPath, 'utf8');
        return Buffer.from(iconSvg, 'utf8').toString('base64');
    } catch (error) {
        logChannel?.debug(`Unable to load default R icon: ${error}`);
        return undefined;
    }
}

function createRuntimeId(binpath: string, version: string): string {
    const digest = crypto.createHash('sha256');
    digest.update(binpath);
    digest.update(version);
    return digest.digest('hex').substring(0, 32);
}

export function restoreRInstallationFromMetadata(
    metadata: LanguageRuntimeMetadata
): RInstallation | undefined {
    const extraRuntimeData = metadata.extraRuntimeData as {
        homepath?: string;
        binpath?: string;
        scriptpath?: string;
        arch?: string;
        current?: boolean;
        default?: boolean;
        reasonDiscovered?: RInstallation['reasonDiscovered'];
        packagerMetadata?: RInstallation['packagerMetadata'];
        condaEnvPath?: string;
        envName?: string;
    } | undefined;

    const homepath = extraRuntimeData?.homepath;
    if (!homepath) {
        return undefined;
    }

    const binpath = extraRuntimeData?.binpath ?? metadata.runtimePath;
    const source = metadata.runtimeSource;
    const normalizedSource: RInstallationSource =
        source === 'configured' || source === 'conda' || source === 'path' || source === 'system' || source === 'pixi'
            ? source
            : 'system';
    const packagerMetadata = restorePackagerMetadata({
        packagerMetadata: extraRuntimeData?.packagerMetadata,
        condaEnvPath: extraRuntimeData?.condaEnvPath,
        envName: extraRuntimeData?.envName,
        binpath,
    });
    const sourceFromMetadata = packagerMetadata
        ? (isPixiMetadata(packagerMetadata) ? 'pixi' : 'conda')
        : normalizedSource;

    return new RInstallation({
        binpath,
        homepath,
        version: metadata.languageVersion,
        arch: extraRuntimeData?.arch,
        current: metadata.startupBehavior === RUNTIME_STARTUP_BEHAVIOR.Immediate,
        source: sourceFromMetadata,
        reasonDiscovered: extraRuntimeData?.reasonDiscovered ?? null,
        packagerMetadata,
    });
}

export class RLanguageLspFactory implements ILanguageLspFactory {
    readonly languageId = R_LANGUAGE_ID;

    create(
        runtimeMetadata: LanguageRuntimeMetadata,
        sessionMetadata: IRuntimeSessionMetadata,
        dynState: LanguageRuntimeDynState,
        logChannel: vscode.LogOutputChannel
    ): ILanguageLsp {
        return new RLanguageLsp(
            runtimeMetadata.languageVersion,
            sessionMetadata,
            dynState,
            logChannel
        );
    }
}

export class RLanguageRuntimeProvider implements ILanguageRuntimeProvider<RInstallation> {
    readonly languageId = R_LANGUAGE_ID;
    readonly languageName = 'R';
    readonly lspFactory = new RLanguageLspFactory();

    constructor(private readonly _extensionContext: vscode.ExtensionContext) {}

    /**
     * Initializes the NativeRFinder for RET-based discovery.
     * Must be called once with the extension context to wire up RET.
     */
    initializeNativeDiscovery(
        context: vscode.ExtensionContext,
        logChannel: vscode.LogOutputChannel
    ): void {
        const finder = getNativeRFinder(
            context.extensionPath,
            logChannel,
            context
        );
        setNativeRFinder(finder);
        if (finder.available) {
            logChannel.info('[R] Native R Environment Tools (RET) discovery initialized');
        } else {
            logChannel.info('[R] RET binary not available, using TypeScript discovery fallback');
        }
    }

    private _toRuntimeMetadata(
        installation: RInstallation,
        logChannel?: vscode.LogOutputChannel
    ): LanguageRuntimeMetadata {
        return {
            runtimeId: createRuntimeId(installation.binpath, installation.version),
            runtimeName: this.formatRuntimeName(installation),
            runtimeShortName: installation.version,
            runtimePath: installation.binpath,
            runtimeVersion: '0.0.1',
            runtimeSource: installation.source,
            languageId: this.languageId,
            languageName: this.languageName,
            languageVersion: installation.version,
            base64EncodedIconSvg: loadDefaultRIconBase64(this._extensionContext, logChannel),
            startupBehavior: installation.current
                ? RUNTIME_STARTUP_BEHAVIOR.Immediate
                : RUNTIME_STARTUP_BEHAVIOR.Implicit,
            sessionLocation: RUNTIME_SESSION_LOCATION.Workspace,
            extraRuntimeData: getMetadataExtra(installation),
        };
    }

    discoverInstallations(logChannel: vscode.LogOutputChannel): AsyncGenerator<RInstallation> {
        return rRuntimeDiscoverer(logChannel);
    }

    resolveInitialInstallation(logChannel: vscode.LogOutputChannel): Promise<RInstallation | undefined> {
        return getBestRInstallation(logChannel);
    }

    promptForInstallation(
        logChannel: vscode.LogOutputChannel,
        options: ILanguageInstallationPickerOptions = {}
    ): Promise<RInstallation | undefined> {
        return promptForRPath(logChannel, {
            forcePick: options.forcePick,
            allowBrowse: options.allowBrowse,
            persistSelection: options.persistSelection,
            preselectBinPath: options.preselectRuntimePath,
            title: options.title,
            placeHolder: options.placeHolder,
        });
    }

    formatRuntimeName(installation: RInstallation): string {
        return formatRuntimeName(installation);
    }

    getRuntimePath(installation: RInstallation): string {
        return installation.binpath;
    }

    getRuntimeSource(installation: RInstallation): string {
        return installation.source;
    }

    createRuntimeMetadata(
        _context: vscode.ExtensionContext,
        installation: RInstallation,
        logChannel: vscode.LogOutputChannel
    ): LanguageRuntimeMetadata {
        return this._toRuntimeMetadata(installation, logChannel);
    }

    createKernelSpec(
        _context: vscode.ExtensionContext,
        installation: RInstallation,
        sessionMode: LanguageSessionMode,
        logChannel: vscode.LogOutputChannel
    ) {
        return createJupyterKernelSpec(
            this._extensionContext,
            installation,
            sessionMode,
            logChannel,
        );
    }

    restoreInstallationFromMetadata(metadata: LanguageRuntimeMetadata): RInstallation | undefined {
        return restoreRInstallationFromMetadata(metadata);
    }

    async validateMetadata(metadata: LanguageRuntimeMetadata): Promise<LanguageRuntimeMetadata> {
        const installation = restoreRInstallationFromMetadata(metadata);
        if (!installation) {
            throw new Error('R metadata is missing installation information');
        }

        if (!fs.existsSync(installation.binpath)) {
            throw new Error(`R binary does not exist: ${installation.binpath}`);
        }

        if (!fs.existsSync(installation.homepath)) {
            throw new Error(`R home does not exist: ${installation.homepath}`);
        }

        return this._toRuntimeMetadata(installation);
    }

    async shouldRecommendForWorkspace(): Promise<boolean> {
        const globs = [
            '**/*.R',
            '**/*.Rmd',
            '.Rprofile',
            'renv.lock',
            '.Rbuildignore',
            '.Renviron',
            '*.Rproj',
        ];

        const glob = `{${globs.join(',')}}`;
        return (await vscode.workspace.findFiles(glob, '**/node_modules/**', 1)).length > 0;
    }

    getSessionIdPrefix(): string {
        return 'r';
    }
}

export class RBinaryProvider implements IBinaryProvider {
    readonly ownerId = R_LANGUAGE_ID;

    constructor(private readonly _extensionContext: vscode.ExtensionContext) {}

    getBinaryDefinitions(): Readonly<Record<string, BinaryDefinition>> {
        const arkVersion = this._extensionContext.extension.packageJSON?.positron?.binaryDependencies?.ark;
        if (typeof arkVersion !== 'string' || !arkVersion) {
            throw new Error('Missing positron.binaryDependencies.ark in vscode-ark package.json');
        }

        const retVersion = this._extensionContext.extension.packageJSON?.positron?.binaryDependencies?.ret;

        const defs: Record<string, BinaryDefinition> = {
            ark: {
                repo: 'posit-dev/ark',
                version: arkVersion,
                binaryName: process.platform === 'win32' ? 'ark.exe' : 'ark',
                archivePattern: (version, platform) => `ark-${version}-${platform}.zip`,
                installDir: path.join(
                    this._extensionContext.extensionPath,
                    'resources',
                    'ark',
                ),
                platformOverride: (platform) => platform.startsWith('darwin') ? 'darwin-universal' : platform,
            },
        };

        if (typeof retVersion === 'string' && retVersion) {
            defs.ret = {
                repo: 'Mengzhiyaa/r-environment-tools',
                version: retVersion,
                binaryName: process.platform === 'win32' ? 'ret.exe' : 'ret',
                archivePattern: (version, platform) => `ret-${version}-${platform}.zip`,
                installDir: path.join(
                    this._extensionContext.extensionPath,
                    'resources',
                    'ret',
                ),
            };
        }

        return defs;
    }
}

export class RLanguageContribution implements ILanguageExtensionContribution {
    readonly runtimeProvider: RLanguageRuntimeProvider;
    readonly binaryProvider: RBinaryProvider;

    constructor(
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _api: ISupervisorFrameworkApi,
    ) {
        this.runtimeProvider = new RLanguageRuntimeProvider(_extensionContext);
        this.binaryProvider = new RBinaryProvider(_extensionContext);
    }

    registerContributions(
        services: ILanguageContributionServices,
    ): vscode.Disposable[] {
        registerTabCompletion(this._extensionContext);
        const runtimeManager = new RRuntimeManager(
            this._extensionContext,
            this._api,
            this.runtimeProvider,
            services.logChannel,
        );
        const runtimeStartupManager = new RRuntimeStartupManager(
            this._extensionContext,
            this.runtimeProvider,
            services.runtimeManager,
            services.runtimeStartupService,
            services.logChannel,
        );
        const runtimeSessionManager = new RSessionManager(
            this._extensionContext,
            services.runtimeSessionService,
            services.positronConsoleService,
            services.logChannel,
        );
        return [
            services.runtimeManager.registerExternalDiscoveryManager?.(this.runtimeProvider.languageId) ??
                new vscode.Disposable(() => undefined),
            services.runtimeStartupService.registerRuntimeManager(runtimeStartupManager),
            services.runtimeSessionService.registerSessionManager(runtimeManager),
            runtimeStartupManager,
            runtimeSessionManager,
            ...registerHelpActions(
                this.runtimeProvider.languageId,
                this.runtimeProvider.languageName,
                services
            ),
            vscode.commands.registerCommand('positron.reticulate.isAutoEnabled', () => {
                return false;
            }),
            vscode.commands.registerCommand('positron.reticulate.setAutoEnabled', async () => {
                return null;
            }),
            vscode.commands.registerCommand('positron.reticulate.resetAutoEnabled', async () => {
                return null;
            }),
            vscode.commands.registerCommand(RCommandIds.startConsole, async () => {
                try {
                    // Match Positron: reveal the console so runtime startup is visible,
                    // but preserve editor focus unless a caller explicitly requests input focus.
                    await services.positronConsoleService.revealConsole(true);

                    const preferredRuntime =
                        services.runtimeStartupService.getPreferredRuntime(R_LANGUAGE_ID);
                    if (preferredRuntime) {
                        await this._api.startRuntime(
                            preferredRuntime,
                            'positron.r.startConsole command',
                            true,
                        );
                        return;
                    }

                    const installation = await services.runtimeSessionService.selectInstallation<RInstallation>(
                        R_LANGUAGE_ID,
                        {
                            allowBrowse: true,
                            persistSelection: true,
                            title: 'Start R Console',
                            placeHolder: 'Select R installation to start',
                        },
                    );
                    if (!installation) {
                        return;
                    }

                    const runtimeMetadata = this.runtimeProvider.createRuntimeMetadata(
                        this._extensionContext,
                        installation,
                        services.logChannel,
                    );
                    await this._api.startRuntime(
                        runtimeMetadata,
                        'positron.r.startConsole command',
                        true,
                    );
                } catch (error) {
                    services.logChannel.error(`[R] Failed to start console session: ${error}`);
                    vscode.window.showErrorMessage(`Failed to start R session: ${error}`);
                }
            }),
            vscode.commands.registerCommand(RCommandIds.restartKernel, async () => {
                const session = services.runtimeSessionService.foregroundSession;
                if (!session || session.runtimeMetadata.languageId !== R_LANGUAGE_ID) {
                    vscode.window.showWarningMessage('No active R session');
                    return;
                }

                await services.runtimeSessionService.restartSession(
                    session.sessionId,
                    'positron.r.restartKernel command',
                );
            }),
            vscode.commands.registerCommand(RCommandIds.selectRPath, async () => {
                const activeSession = services.runtimeSessionService.activeSession;
                const installation = await services.runtimeSessionService.selectInstallation<RInstallation>(
                    R_LANGUAGE_ID,
                    {
                        forcePick: true,
                        allowBrowse: true,
                        persistSelection: true,
                        preselectRuntimePath: activeSession?.runtimeMetadata.languageId === R_LANGUAGE_ID
                            ? activeSession.runtimeMetadata.runtimePath
                            : undefined,
                        title: 'Select R Installation',
                        placeHolder: 'Select R installation to use',
                    }
                );
                if (installation) {
                    vscode.window.showInformationMessage(
                        `Using ${this.runtimeProvider.formatRuntimeName(installation)} at ${this.runtimeProvider.getRuntimePath(installation)}`
                    );
                }
            }),
            vscode.commands.registerCommand(RCommandIds.runCurrentStatement, async () => {
                return vscode.commands.executeCommand('supervisor.console.executeCode');
            }),
            vscode.commands.registerCommand(RCommandIds.insertAssignmentOperator, async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document.languageId !== R_LANGUAGE_ID) {
                    return;
                }

                await editor.edit(editBuilder => {
                    for (const selection of editor.selections) {
                        editBuilder.replace(selection, ' <- ');
                    }
                });
            }),
            vscode.commands.registerCommand(RCommandIds.insertPipeOperator, async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document.languageId !== R_LANGUAGE_ID) {
                    return;
                }

                await editor.edit(editBuilder => {
                    for (const selection of editor.selections) {
                        editBuilder.replace(selection, ' |> ');
                    }
                });
            }),
        ];
    }
}
