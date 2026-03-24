import * as vscode from 'vscode';
import type { LanguageRuntimeExit } from './internal/runtimeTypes';
import { RuntimeState } from './internal/runtimeTypes';
export type { LanguageRuntimeExit } from './internal/runtimeTypes';
export { RuntimeState } from './internal/runtimeTypes';
export declare enum LanguageRuntimeSessionMode {
    Console = "console",
    Notebook = "notebook",
    Background = "background"
}
export declare enum LanguageRuntimeSessionLocation {
    Machine = "machine",
    Workspace = "workspace",
    Browser = "browser"
}
export declare enum LanguageRuntimeStartupBehavior {
    Immediate = "immediate",
    Implicit = "implicit",
    Explicit = "explicit",
    Manual = "manual"
}
export interface LanguageRuntimeMetadata {
    runtimeId: string;
    runtimeName: string;
    runtimePath: string;
    runtimeVersion: string;
    runtimeShortName: string;
    runtimeSource: string;
    languageId: string;
    languageName: string;
    languageVersion: string;
    base64EncodedIconSvg?: string;
    sessionLocation?: LanguageRuntimeSessionLocation;
    startupBehavior?: LanguageRuntimeStartupBehavior;
    extraRuntimeData?: unknown;
}
export interface IRuntimeSessionMetadata {
    sessionId: string;
    sessionName: string;
    sessionMode: LanguageRuntimeSessionMode;
    notebookUri?: vscode.Uri;
    workingDirectory?: string;
}
export interface LanguageRuntimeDynState {
    sessionName: string;
    inputPrompt: string;
    continuationPrompt: string;
    busy?: boolean;
    currentWorkingDirectory?: string;
}
export interface JupyterKernelSpec {
    argv: Array<string>;
    display_name: string;
    language: string;
    interrupt_mode?: 'signal' | 'message';
    env?: NodeJS.ProcessEnv;
    kernel_protocol_version: string;
    startup_command?: string;
}
export interface ILanguageInstallation {
    readonly languageId: string;
    readonly languageName: string;
    readonly runtimePath: string;
    readonly runtimeVersion: string;
    readonly runtimeSource: string;
    readonly base64EncodedIconSvg?: string;
    readonly startupBehavior?: LanguageRuntimeMetadata['startupBehavior'];
    readonly extraRuntimeData?: Record<string, unknown>;
}
export interface ILanguageInstallationPickerOptions {
    forcePick?: boolean;
    allowBrowse?: boolean;
    persistSelection?: boolean;
    title?: string;
    placeHolder?: string;
    preselectRuntimePath?: string;
}
export interface ILanguageStatementRangeProvider {
    provideStatementRange(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<{
        range: vscode.Range;
        code?: string;
    } | null | undefined>;
}
export interface ILanguageHelpTopicProvider {
    provideHelpTopic(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<string | null | undefined>;
}
export declare enum LanguageLspState {
    Uninitialized = "uninitialized",
    Starting = "starting",
    Stopped = "stopped",
    Running = "running"
}
export interface ILanguageLspStateChangeEvent {
    oldState: LanguageLspState;
    newState: LanguageLspState;
}
export interface ILanguageLsp extends vscode.Disposable {
    readonly state: LanguageLspState;
    readonly onDidChangeState?: vscode.Event<ILanguageLspStateChangeEvent>;
    readonly statementRangeProvider?: ILanguageStatementRangeProvider;
    readonly helpTopicProvider?: ILanguageHelpTopicProvider;
    activate(port: number): Promise<void>;
    deactivate(): Promise<void>;
    wait(): Promise<boolean>;
    showOutput(): void;
    requestCompletion(code: string, position: {
        line: number;
        character: number;
    }): Promise<any[]>;
    requestHover(code: string, position: {
        line: number;
        character: number;
    }): Promise<any | null>;
    requestSignatureHelp(code: string, position: {
        line: number;
        character: number;
    }): Promise<any | null>;
}
export interface ILanguageLspFactory {
    readonly languageId: string;
    create(runtimeMetadata: LanguageRuntimeMetadata, sessionMetadata: IRuntimeSessionMetadata, dynState: LanguageRuntimeDynState, logChannel: vscode.LogOutputChannel): ILanguageLsp;
}
export type LanguageSessionMode = 'console' | 'notebook' | 'background';
export interface ILanguageRuntimeProvider<TInstallation = unknown> {
    readonly languageId: string;
    readonly languageName: string;
    readonly lspFactory?: ILanguageLspFactory;
    discoverInstallations(logChannel: vscode.LogOutputChannel): AsyncGenerator<TInstallation>;
    resolveInitialInstallation(logChannel: vscode.LogOutputChannel): Promise<TInstallation | undefined>;
    promptForInstallation(logChannel: vscode.LogOutputChannel, options?: ILanguageInstallationPickerOptions): Promise<TInstallation | undefined>;
    formatRuntimeName(installation: TInstallation): string;
    getRuntimePath(installation: TInstallation): string;
    getRuntimeSource(installation: TInstallation): string;
    createRuntimeMetadata(context: vscode.ExtensionContext, installation: TInstallation, logChannel: vscode.LogOutputChannel): LanguageRuntimeMetadata;
    createKernelSpec(context: vscode.ExtensionContext, installation: TInstallation, sessionMode: LanguageSessionMode, logChannel: vscode.LogOutputChannel): Promise<JupyterKernelSpec>;
    validateMetadata?(metadata: LanguageRuntimeMetadata): Promise<LanguageRuntimeMetadata>;
    validateSession?(sessionId: string): Promise<boolean>;
    restoreInstallationFromMetadata?(metadata: LanguageRuntimeMetadata): TInstallation | undefined;
    shouldRecommendForWorkspace?(): Promise<boolean>;
    getSessionIdPrefix?(sessionMode: LanguageSessionMode): string;
}
export interface BinaryDefinition {
    repo: string;
    version?: string;
    binaryName: string;
    archivePattern: (version: string, platform: string) => string;
    installDir: string;
    platformOverride?: (platform: string) => string;
}
export interface IBinaryProvider {
    readonly ownerId: string;
    getBinaryDefinitions(): Readonly<Record<string, BinaryDefinition>>;
}
export interface ICodeExecutionAttribution {
    source: string;
    fileUri?: vscode.Uri;
    lineNumber?: number;
    metadata?: Record<string, unknown>;
}
export declare enum LanguageRuntimeClientType {
    Variables = "positron.variables",
    Lsp = "positron.lsp",
    Plot = "positron.plot",
    DataExplorer = "positron.dataExplorer",
    Ui = "positron.ui",
    Help = "positron.help",
    Connection = "positron.connection",
    Reticulate = "positron.reticulate",
    IPyWidget = "jupyter.widget",
    IPyWidgetControl = "jupyter.widget.control"
}
export interface ILanguageRuntimeClientInstance extends vscode.Disposable {
    getClientId(): string;
    getClientType(): LanguageRuntimeClientType;
}
export interface ILanguageRuntimeSession {
    readonly sessionId: string;
    readonly state: RuntimeState;
    readonly isForeground: boolean;
    readonly workingDirectory: string | undefined;
    readonly created: number;
    readonly dynState: LanguageRuntimeDynState;
    readonly runtimeMetadata: LanguageRuntimeMetadata;
    readonly sessionMetadata: IRuntimeSessionMetadata;
    readonly lsp: ILanguageLsp;
    readonly onDidChangeRuntimeState: vscode.Event<RuntimeState>;
    readonly onDidEndSession: vscode.Event<LanguageRuntimeExit>;
    readonly onDidChangeWorkingDirectory: vscode.Event<string>;
    activateLsp(): Promise<void>;
    deactivateLsp(): Promise<void>;
    startDap(targetName: string, debugType: string, debugName: string): Promise<void>;
    connectDap(): Promise<boolean>;
    disconnectDap(): Promise<void>;
    setConsoleWidth(widthInChars: number): Promise<void>;
    watchRuntimeClient(clientType: LanguageRuntimeClientType, handler: (client: ILanguageRuntimeClientInstance) => void): vscode.Disposable;
    waitLsp(): Promise<ILanguageLsp | undefined>;
    interrupt(): Promise<void>;
}
export interface IRuntimeSessionService {
    readonly activeSession: ILanguageRuntimeSession | undefined;
    readonly foregroundSession: ILanguageRuntimeSession | undefined;
    readonly sessions: readonly ILanguageRuntimeSession[];
    readonly onDidCreateSession: vscode.Event<ILanguageRuntimeSession>;
    readonly onDidDeleteSession: vscode.Event<string>;
    readonly onDidChangeActiveSession: vscode.Event<ILanguageRuntimeSession | undefined>;
    readonly onDidChangeForegroundSession: vscode.Event<ILanguageRuntimeSession | undefined>;
    getSession(sessionId: string): ILanguageRuntimeSession | undefined;
    ensureSessionForLanguage(languageId: string, sessionName?: string): Promise<ILanguageRuntimeSession>;
    restartSession(sessionId: string): Promise<void>;
    selectInstallation<TInstallation = unknown>(languageId: string, options?: ILanguageInstallationPickerOptions): Promise<TInstallation | undefined>;
}
export interface IPositronConsoleService {
    readonly onDidChangeConsoleWidth: vscode.Event<number>;
    showConsole(): void;
    getConsoleWidth(): number;
    executeCode(languageId: string, sessionId: string | undefined, code: string, attribution: ICodeExecutionAttribution, focus: boolean): Promise<string>;
}
export interface IPositronHelpService {
    showHelpTopic(languageId: string, topic: string): Promise<boolean>;
    find(): Promise<void>;
    showWelcomePage(): void;
}
export interface ISessionRestoreFailedEvent {
    sessionId: string;
    error: Error;
}
export declare enum RuntimeStartupPhase {
    Initializing = "initializing",
    AwaitingTrust = "awaitingTrust",
    Reconnecting = "reconnecting",
    Starting = "starting",
    Discovering = "discovering",
    Complete = "complete"
}
export interface IRuntimeAutoStartEvent {
    runtimeName: string;
    languageName: string;
    base64EncodedIconSvg?: string;
    newSession: boolean;
}
export interface SerializedSessionMetadata {
    sessionName: string;
    runtimeMetadata: LanguageRuntimeMetadata;
    metadata: IRuntimeSessionMetadata;
    sessionState: RuntimeState;
    workingDirectory?: string;
    hasConsole?: boolean;
    lastUsed: number;
    localWindowId?: string;
}
export interface IRuntimeStartupService {
    readonly startupPhase: RuntimeStartupPhase;
    readonly discoveredRuntimeCount: number;
    readonly onDidChangeRuntimeStartupPhase: vscode.Event<RuntimeStartupPhase>;
    readonly onWillAutoStartRuntime: vscode.Event<IRuntimeAutoStartEvent>;
    readonly onSessionRestoreFailure: vscode.Event<ISessionRestoreFailedEvent>;
    startup(): Promise<void>;
    hasAffiliatedRuntime(): boolean;
    getAffiliatedRuntimeMetadata(languageId: string): LanguageRuntimeMetadata | undefined;
    getAffiliatedRuntimes(): LanguageRuntimeMetadata[];
    clearAffiliatedRuntime(languageId: string): void;
    getPreferredRuntime(languageId: string): LanguageRuntimeMetadata | undefined;
    getRestoredSessions(): SerializedSessionMetadata[];
    rediscoverAllRuntimes(): Promise<void>;
}
export interface ILanguageContributionServices {
    readonly logChannel: vscode.LogOutputChannel;
    readonly runtimeSessionService: IRuntimeSessionService;
    readonly positronConsoleService: IPositronConsoleService;
    readonly positronHelpService: IPositronHelpService;
}
export type LanguageContributionRegistrationResult = void | vscode.Disposable | readonly vscode.Disposable[];
export interface ILanguageExtensionContribution {
    registerContributions(services: ILanguageContributionServices): LanguageContributionRegistrationResult | Promise<LanguageContributionRegistrationResult>;
}
export interface ILanguageTextMateGrammarContribution {
    readonly scopeName: string;
    readonly grammarUri: vscode.Uri;
}
export interface ILanguageWebviewAssets {
    readonly localResourceRoots?: readonly vscode.Uri[];
    readonly monacoSupportModule?: vscode.Uri;
    readonly textMateGrammar?: ILanguageTextMateGrammarContribution;
}
export interface ILanguageSupportRegistration<TInstallation = unknown> {
    readonly runtimeProvider: ILanguageRuntimeProvider<TInstallation>;
    readonly binaryProvider?: IBinaryProvider;
    readonly languageContribution?: ILanguageExtensionContribution;
    readonly webviewAssets?: ILanguageWebviewAssets;
}
export interface ILanguageRuntimeRegistration<TInstallation = unknown> {
    readonly provider: ILanguageRuntimeProvider<TInstallation>;
}
export interface ISupervisorFrameworkApi {
    readonly runtimeSessionService: IRuntimeSessionService;
    readonly runtimeStartupService: IRuntimeStartupService;
    readonly version: string;
    registerLanguageSupport<TInstallation = unknown>(registration: ILanguageSupportRegistration<TInstallation>): Promise<void>;
    registerLanguageRuntime<TInstallation = unknown>(registration: ILanguageRuntimeRegistration<TInstallation> | ILanguageSupportRegistration<TInstallation> | ILanguageRuntimeProvider<TInstallation>): Promise<void>;
    registerLspFactory(factory: ILanguageLspFactory): Promise<void>;
    registerBinaryProvider(provider: IBinaryProvider): Promise<void>;
}
export interface IDiscoveredLanguageRuntime<TInstallation = unknown> {
    readonly provider: ILanguageRuntimeProvider<TInstallation>;
    readonly installation: TInstallation;
    readonly metadata: LanguageRuntimeMetadata;
}
