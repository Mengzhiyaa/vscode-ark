import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import * as semver from 'semver';
import * as vscode from 'vscode';
import type {
    NativeDiscoverySource,
    NativeREnvInfo,
    NativeREnvLocatorMetadata,
    NativeREnvManagerInfo,
    NativeREnvRVersionsOverlay,
} from './native-r-finder';

export type RInstallationSource = 'configured' | 'system' | 'conda' | 'path' | 'pixi';
export type LocatorMetadata = NativeREnvLocatorMetadata;
export type RVersionsOverlay = NativeREnvRVersionsOverlay;
export type REnvManagerInfo = NativeREnvManagerInfo;

export interface RMetadataExtra {
    homepath: string;
    binpath: string;
    scriptpath: string;
    arch?: string;
    current: boolean;
    default: boolean;
    retPayload: NativeREnvInfo;
    reasonDiscovered?: ReasonDiscovered[] | null;
}

export enum ReasonDiscovered {
    PATH = 'PATH',
    HQ = 'HQ',
    CONDA = 'CONDA',
    PIXI = 'PIXI',
    HOMEBREW = 'HOMEBREW',
    LINUX_GLOBAL = 'LINUX_GLOBAL',
    MAC_FRAMEWORK = 'MAC_FRAMEWORK',
    MAC_PORTS = 'MAC_PORTS',
    MODULE = 'MODULE',
    NIX = 'NIX',
    GUIX = 'GUIX',
    SPACK = 'SPACK',
    RIG = 'RIG',
    RVERSIONS = 'RVERSIONS',
    WINDOWS_HQ = 'WINDOWS_HQ',
    WINDOWS_REGISTRY = 'WINDOWS_REGISTRY',
    SCOOP = 'SCOOP',
    CHOCOLATEY = 'CHOCOLATEY',
    userSetting = 'userSetting',
}

export enum ReasonRejected {
    invalid = 'invalid',
    unsupported = 'unsupported',
    nonOrthogonal = 'nonOrthogonal',
    excluded = 'excluded',
}

export interface CondaMetadata {
    kind: 'conda';
    environmentPath: string;
}

export interface PixiMetadata {
    kind: 'pixi';
    environmentPath: string;
    manifestPath?: string;
    environmentName?: string;
}

export interface ModuleMetadata {
    kind: 'module';
    moduleName: string;
    startupCommand: string;
}

export type PackagerMetadata = CondaMetadata | PixiMetadata | ModuleMetadata;

export function isCondaMetadata(metadata: PackagerMetadata): metadata is CondaMetadata {
    return metadata.kind === 'conda';
}

export function isPixiMetadata(metadata: PackagerMetadata): metadata is PixiMetadata {
    return metadata.kind === 'pixi';
}

export function isModuleMetadata(metadata: PackagerMetadata): metadata is ModuleMetadata {
    return metadata.kind === 'module';
}

export interface RInstallationOptions {
    binpath: string;
    homepath: string;
    version: string;
    arch?: string;
    current?: boolean;
    source?: RInstallationSource;
    retPayload?: NativeREnvInfo;
    reasonDiscovered?: ReasonDiscovered[] | null;
    discoveredBy?: NativeDiscoverySource[] | null;
    packagerMetadata?: PackagerMetadata;
    locatorMetadata?: LocatorMetadata;
    displayName?: string;
    name?: string;
    manager?: REnvManagerInfo;
    knownExecutables?: string[];
    symlinks?: string[];
    rversionsOverlay?: RVersionsOverlay;
    scriptPath?: string;
    startupCommand?: string;
    environmentVariables?: Record<string, string>;
    orthogonal?: boolean;
    supported?: boolean;
    usable?: boolean;
    reasonRejected?: ReasonRejected | null;
}

export class RInstallation {
    public usable = true;
    public supported = true;
    public reasonDiscovered: ReasonDiscovered[] | null = null;
    public reasonRejected: ReasonRejected | null = null;

    public displayName: string | undefined = undefined;
    public name: string | undefined = undefined;
    public binpath = '';
    public homepath = '';
    public scriptpath = '';
    public semVersion: semver.SemVer = new semver.SemVer('0.0.1');
    public version = '';
    public arch = '';
    public current = false;
    public orthogonal = true;
    public default = false;
    public source: RInstallationSource = 'system';
    public retPayload: NativeREnvInfo | undefined = undefined;
    public manager: REnvManagerInfo | undefined = undefined;
    public knownExecutables: string[] | undefined = undefined;
    public symlinks: string[] | undefined = undefined;
    public discoveredBy: NativeDiscoverySource[] | null = null;
    public locatorMetadata: LocatorMetadata | undefined = undefined;
    public rversionsOverlay: RVersionsOverlay | undefined = undefined;
    public startupCommand: string | undefined = undefined;
    public environmentVariables: Record<string, string> | undefined = undefined;
    public packagerMetadata: PackagerMetadata | undefined = undefined;

    constructor(options: RInstallationOptions) {
        this.displayName = options.displayName;
        this.name = options.name;
        this.binpath = options.binpath;
        this.homepath = options.homepath;
        this.scriptpath = options.scriptPath ?? inferRScriptPath(options.binpath);
        this.semVersion = semver.coerce(options.version) ?? new semver.SemVer('0.0.1');
        this.version = this.semVersion.format();
        this.arch = options.arch ?? '';
        this.current = options.current ?? false;
        this.source = options.source ?? 'system';
        this.retPayload = options.retPayload;
        this.reasonDiscovered = options.reasonDiscovered ? [...options.reasonDiscovered] : null;
        this.discoveredBy = options.discoveredBy ? [...options.discoveredBy] : null;
        this.manager = options.manager;
        this.knownExecutables = options.knownExecutables ? [...options.knownExecutables] : undefined;
        this.symlinks = options.symlinks ? [...options.symlinks] : undefined;
        this.locatorMetadata = options.locatorMetadata;
        this.rversionsOverlay = options.rversionsOverlay;
        this.startupCommand = options.startupCommand;
        this.environmentVariables = options.environmentVariables
            ? { ...options.environmentVariables }
            : undefined;
        this.packagerMetadata =
            options.packagerMetadata ??
            convertLocatorMetadataToPackagerMetadata(options.locatorMetadata);
        this.default = isConfiguredDefaultRPath(options.binpath);
        this.orthogonal = options.orthogonal ?? computeOrthogonality(options.homepath);
        this.supported = options.supported ?? true;
        this.reasonRejected = options.reasonRejected ?? null;
        this.usable = options.usable ?? true;

        if (!this.supported && !this.reasonRejected) {
            this.reasonRejected = ReasonRejected.unsupported;
            this.usable = false;
        }

        if (process.platform === 'darwin' && !this.current && !this.orthogonal && !this.reasonRejected) {
            this.reasonRejected = ReasonRejected.nonOrthogonal;
            this.usable = false;
        }
    }

    toJSON() {
        return {
            ...this,
            reasonDiscovered: this.reasonDiscovered?.map(friendlyReason) ?? null,
            reasonRejected: this.reasonRejected ? friendlyReason(this.reasonRejected) : null,
        };
    }
}

export function friendlyReason(reason: ReasonDiscovered | ReasonRejected | null): string {
    switch (reason) {
        case ReasonDiscovered.PATH:
            return 'Found in PATH';
        case ReasonDiscovered.HQ:
            return 'Found in a standard system location';
        case ReasonDiscovered.CONDA:
            return 'Found in a Conda environment';
        case ReasonDiscovered.PIXI:
            return 'Found in a Pixi environment';
        case ReasonDiscovered.HOMEBREW:
            return 'Found via Homebrew';
        case ReasonDiscovered.LINUX_GLOBAL:
            return 'Found in a Linux global installation';
        case ReasonDiscovered.MAC_FRAMEWORK:
            return 'Found in a macOS framework installation';
        case ReasonDiscovered.MAC_PORTS:
            return 'Found via MacPorts';
        case ReasonDiscovered.MODULE:
            return 'Found via environment modules';
        case ReasonDiscovered.NIX:
            return 'Found via Nix';
        case ReasonDiscovered.GUIX:
            return 'Found via Guix';
        case ReasonDiscovered.SPACK:
            return 'Found via Spack';
        case ReasonDiscovered.RIG:
            return 'Found via rig';
        case ReasonDiscovered.RVERSIONS:
            return 'Matched by r-versions';
        case ReasonDiscovered.WINDOWS_HQ:
            return 'Found in the Windows R installation directory';
        case ReasonDiscovered.WINDOWS_REGISTRY:
            return 'Found in the Windows registry';
        case ReasonDiscovered.SCOOP:
            return 'Found via Scoop';
        case ReasonDiscovered.CHOCOLATEY:
            return 'Found via Chocolatey';
        case ReasonDiscovered.userSetting:
            return 'Found in ark.r.path';
        case ReasonRejected.invalid:
            return 'Invalid installation';
        case ReasonRejected.unsupported:
            return 'Unsupported installation';
        case ReasonRejected.nonOrthogonal:
            return 'Non-orthogonal installation';
        case ReasonRejected.excluded:
            return 'Excluded installation';
        default:
            return 'Unknown reason';
    }
}

const RET_KIND_TO_DISCOVERY_REASON: Record<string, ReasonDiscovered> = {
    Conda: ReasonDiscovered.CONDA,
    EnvironmentModule: ReasonDiscovered.MODULE,
    Guix: ReasonDiscovered.GUIX,
    Homebrew: ReasonDiscovered.HOMEBREW,
    LinuxGlobal: ReasonDiscovered.LINUX_GLOBAL,
    MacFramework: ReasonDiscovered.MAC_FRAMEWORK,
    MacPorts: ReasonDiscovered.MAC_PORTS,
    Nix: ReasonDiscovered.NIX,
    Pixi: ReasonDiscovered.PIXI,
    Rig: ReasonDiscovered.RIG,
    Spack: ReasonDiscovered.SPACK,
    WindowsHq: ReasonDiscovered.WINDOWS_HQ,
    WindowsRegistry: ReasonDiscovered.WINDOWS_REGISTRY,
    Scoop: ReasonDiscovered.SCOOP,
    Chocolatey: ReasonDiscovered.CHOCOLATEY,
    GlobalPaths: ReasonDiscovered.PATH,
};

const RET_DISCOVERY_SOURCE_TO_REASON: Partial<Record<NativeDiscoverySource, ReasonDiscovered>> = {
    rVersions: ReasonDiscovered.RVERSIONS,
};

export function getReasonDiscoveredFromRetKind(kind?: string): ReasonDiscovered | undefined {
    return kind ? RET_KIND_TO_DISCOVERY_REASON[kind] : undefined;
}

export function formatRuntimeName(installation: RInstallation): string {
    const preferredName = installation.rversionsOverlay?.label ?? installation.displayName;
    if (preferredName) {
        return ensureRuntimeVersionInName(preferredName, installation.version);
    }

    let name = `R ${installation.version}`;

    if (installation.packagerMetadata) {
        if (isPixiMetadata(installation.packagerMetadata)) {
            const environmentName =
                installation.packagerMetadata.environmentName ??
                path.basename(installation.packagerMetadata.environmentPath);
            if (environmentName) {
                name += ` (Pixi: ${environmentName})`;
            }
        } else if (isCondaMetadata(installation.packagerMetadata)) {
            name += ` (Conda: ${path.basename(installation.packagerMetadata.environmentPath)})`;
        }
    } else if (installation.reasonDiscovered?.includes(ReasonDiscovered.HOMEBREW)) {
        name += ' (Homebrew)';
    }

    return name;
}

function ensureRuntimeVersionInName(name: string, version: string): string {
    const lowerName = name.toLowerCase();
    const lowerVersion = version.toLowerCase();

    if (lowerName.includes(lowerVersion) || lowerName.includes(`r ${lowerVersion}`)) {
        return name;
    }

    return `${name} (R ${version})`;
}

export function convertLocatorMetadataToPackagerMetadata(
    locatorMetadata?: LocatorMetadata,
): PackagerMetadata | undefined {
    if (!locatorMetadata) {
        return undefined;
    }

    switch (locatorMetadata.type) {
        case 'conda':
            return {
                kind: 'conda',
                environmentPath: locatorMetadata.environmentPath,
            };
        case 'pixi':
            return {
                kind: 'pixi',
                environmentPath: locatorMetadata.environmentPath,
                manifestPath: locatorMetadata.manifestPath ?? undefined,
                environmentName: locatorMetadata.environmentName ?? undefined,
            };
        case 'module':
            return {
                kind: 'module',
                moduleName: locatorMetadata.moduleName,
                startupCommand: locatorMetadata.startupCommand,
            };
    }
}

export function convertPackagerMetadataToLocatorMetadata(
    packagerMetadata?: PackagerMetadata,
): LocatorMetadata | undefined {
    if (!packagerMetadata) {
        return undefined;
    }

    if (isCondaMetadata(packagerMetadata)) {
        return {
            type: 'conda',
            environmentPath: packagerMetadata.environmentPath,
        };
    }

    if (isPixiMetadata(packagerMetadata)) {
        return {
            type: 'pixi',
            environmentPath: packagerMetadata.environmentPath,
            manifestPath: packagerMetadata.manifestPath ?? null,
            environmentName: packagerMetadata.environmentName ?? null,
        };
    }

    return {
        type: 'module',
        moduleName: packagerMetadata.moduleName,
        startupCommand: packagerMetadata.startupCommand,
    };
}

function getRetKindFromPackagerMetadata(
    packagerMetadata?: PackagerMetadata,
): NativeREnvInfo['kind'] | undefined {
    if (!packagerMetadata) {
        return undefined;
    }

    if (isCondaMetadata(packagerMetadata)) {
        return 'Conda';
    }

    if (isPixiMetadata(packagerMetadata)) {
        return 'Pixi';
    }

    return 'EnvironmentModule';
}

function getRetArchitecture(arch?: string): NativeREnvInfo['arch'] | undefined {
    switch (arch) {
        case 'aarch64':
        case 'arm64':
            return 'arm64';
        case 'x86_64':
            return 'x86_64';
        case 'x86':
            return 'x86';
        default:
            return undefined;
    }
}

function createRetPayloadFromInstallation(installation: RInstallation): NativeREnvInfo {
    if (installation.retPayload) {
        return {
            ...installation.retPayload,
            manager: installation.retPayload.manager ? { ...installation.retPayload.manager } : undefined,
            knownExecutables: installation.retPayload.knownExecutables
                ? [...installation.retPayload.knownExecutables]
                : undefined,
            symlinks: installation.retPayload.symlinks
                ? [...installation.retPayload.symlinks]
                : undefined,
            discoveredBy: installation.retPayload.discoveredBy
                ? [...installation.retPayload.discoveredBy]
                : undefined,
            locatorMetadata: installation.retPayload.locatorMetadata
                ? { ...installation.retPayload.locatorMetadata }
                : undefined,
            rversionsOverlay: installation.retPayload.rversionsOverlay
                ? { ...installation.retPayload.rversionsOverlay }
                : undefined,
            environmentVariables: installation.retPayload.environmentVariables
                ? { ...installation.retPayload.environmentVariables }
                : undefined,
        };
    }

    const locatorMetadata =
        installation.locatorMetadata ??
        convertPackagerMetadataToLocatorMetadata(installation.packagerMetadata);

    return {
        displayName: installation.displayName,
        name: installation.name,
        executable: installation.binpath,
        kind: getRetKindFromPackagerMetadata(installation.packagerMetadata),
        version: installation.version,
        home: installation.homepath,
        manager: installation.manager ? { ...installation.manager } : undefined,
        arch: getRetArchitecture(installation.arch),
        knownExecutables: installation.knownExecutables ? [...installation.knownExecutables] : undefined,
        symlinks: installation.symlinks ? [...installation.symlinks] : undefined,
        discoveredBy: installation.discoveredBy ? [...installation.discoveredBy] : undefined,
        locatorMetadata,
        rversionsOverlay: installation.rversionsOverlay ? { ...installation.rversionsOverlay } : undefined,
        scriptPath: installation.scriptpath,
        startupCommand: installation.startupCommand,
        environmentVariables: installation.environmentVariables
            ? { ...installation.environmentVariables }
            : undefined,
        orthogonal: installation.orthogonal,
    };
}

export function getMetadataExtra(installation: RInstallation): RMetadataExtra {
    return {
        homepath: installation.homepath,
        binpath: installation.binpath,
        scriptpath: installation.scriptpath,
        arch: installation.arch || undefined,
        current: installation.current,
        default: installation.default,
        retPayload: createRetPayloadFromInstallation(installation),
        reasonDiscovered: installation.reasonDiscovered ?? null,
    };
}

export interface PersistedRMetadataExtra {
    homepath?: string;
    binpath?: string;
    scriptpath?: string;
    arch?: string;
    current?: boolean;
    default?: boolean;
    retPayload?: NativeREnvInfo;
    reasonDiscovered?: ReasonDiscovered[] | null;
}

export function convertNativeEnvToRInstallation(env: NativeREnvInfo): RInstallation | undefined {
    if (!env.executable || !env.home || !env.version) {
        return undefined;
    }

    const locatorMetadata = getLocatorMetadataFromNativeEnv(env);
    const packagerMetadata = getPackagerMetadataFromNativeEnv(env);
    const reasonDiscovered = getReasonsDiscoveredFromNativeEnv(env, packagerMetadata);

    return new RInstallation({
        displayName: env.displayName ?? undefined,
        name: env.name ?? undefined,
        binpath: env.executable,
        homepath: env.home,
        version: env.version,
        arch: normalizeArch(env.arch),
        current: false,
        source: getSourceFromPackagerMetadata(packagerMetadata) ?? getSourceFromDiscoveryReason(reasonDiscovered[0]),
        retPayload: {
            ...env,
            displayName: env.displayName ?? undefined,
            name: env.name ?? undefined,
            executable: env.executable,
            kind: env.kind ?? undefined,
            version: env.version,
            home: env.home,
            manager: env.manager ? { ...env.manager } : undefined,
            arch: env.arch ?? undefined,
            knownExecutables: env.knownExecutables ? [...env.knownExecutables] : undefined,
            symlinks: env.symlinks ? [...env.symlinks] : undefined,
            discoveredBy: env.discoveredBy ? [...env.discoveredBy] : undefined,
            locatorMetadata: env.locatorMetadata,
            rversionsOverlay: env.rversionsOverlay ? { ...env.rversionsOverlay } : undefined,
            scriptPath: env.scriptPath ?? undefined,
            startupCommand: env.startupCommand ?? undefined,
            environmentVariables: env.environmentVariables
                ? { ...env.environmentVariables }
                : undefined,
            orthogonal: env.orthogonal ?? undefined,
            error: env.error ?? undefined,
        },
        reasonDiscovered,
        discoveredBy: env.discoveredBy ?? null,
        manager: env.manager,
        knownExecutables: env.knownExecutables,
        symlinks: env.symlinks,
        packagerMetadata,
        locatorMetadata,
        rversionsOverlay: env.rversionsOverlay,
        scriptPath: env.scriptPath,
        startupCommand: env.startupCommand,
        environmentVariables: env.environmentVariables,
        orthogonal: env.orthogonal,
    });
}

export async function probeRInstallation(
    rBinPath: string,
    log: vscode.LogOutputChannel,
    reasonDiscovered: ReasonDiscovered[] | null = null,
    packagerMetadata?: PackagerMetadata,
): Promise<RInstallation | undefined> {
    let realPath: string;
    try {
        realPath = fs.realpathSync(rBinPath);
    } catch {
        log.debug(`Cannot resolve path: ${rBinPath}`);
        return undefined;
    }

    if (!fs.existsSync(realPath)) {
        log.debug(`Path does not exist: ${realPath}`);
        return undefined;
    }

    log.debug(`Probing R at: ${realPath}`);

    const homepath = getRHomePath(realPath);
    if (!homepath) {
        log.debug(`Could not determine R_HOME for ${realPath}`);
        return undefined;
    }
    log.debug(`  R_HOME: ${homepath}`);

    const version = getRVersion(realPath);
    if (!version) {
        log.debug(`Could not determine R version for ${realPath}`);
        return undefined;
    }
    log.debug(`  Version: ${version}`);

    const arch = getRArchitecture(realPath, log);
    if (arch) {
        log.debug(`  Architecture: ${arch}`);
    }

    const resolvedPackagerMetadata = packagerMetadata ?? inferPackagerMetadataFromRBinary(realPath);
    if (resolvedPackagerMetadata && isCondaMetadata(resolvedPackagerMetadata)) {
        log.debug(`  Detected conda environment: ${resolvedPackagerMetadata.environmentPath}`);
    }

    const resolvedReasonDiscovered =
        reasonDiscovered ??
        inferReasonDiscoveredFromRBinary(realPath, resolvedPackagerMetadata);

    return new RInstallation({
        binpath: realPath,
        homepath,
        version,
        arch,
        current: false,
        source: getSourceFromPackagerMetadata(resolvedPackagerMetadata) ?? getSourceFromDiscoveryReason(resolvedReasonDiscovered?.[0]),
        reasonDiscovered: resolvedReasonDiscovered,
        packagerMetadata: resolvedPackagerMetadata,
        locatorMetadata: convertPackagerMetadataToLocatorMetadata(resolvedPackagerMetadata),
    });
}

export function inferPackagerMetadataFromRBinary(rBinPath: string): PackagerMetadata | undefined {
    const condaEnvironmentPath = inferCondaEnvironmentPathFromRBinary(rBinPath);
    if (condaEnvironmentPath) {
        return { kind: 'conda', environmentPath: condaEnvironmentPath };
    }

    return undefined;
}

function getSourceFromDiscoveryReason(reason?: ReasonDiscovered): RInstallationSource {
    switch (reason) {
        case ReasonDiscovered.CONDA:
            return 'conda';
        case ReasonDiscovered.PIXI:
            return 'pixi';
        case ReasonDiscovered.PATH:
            return 'path';
        case ReasonDiscovered.userSetting:
            return 'configured';
        default:
            return 'system';
    }
}

function getSourceFromPackagerMetadata(
    packagerMetadata?: PackagerMetadata,
): RInstallationSource | undefined {
    if (!packagerMetadata) {
        return undefined;
    }

    if (isCondaMetadata(packagerMetadata)) {
        return 'conda';
    }

    if (isPixiMetadata(packagerMetadata)) {
        return 'pixi';
    }

    return undefined;
}

export function getPackagerMetadataFromNativeEnv(env: NativeREnvInfo): PackagerMetadata | undefined {
    const locatorMetadata = getLocatorMetadataFromNativeEnv(env);
    if (locatorMetadata) {
        return convertLocatorMetadataToPackagerMetadata(locatorMetadata);
    }

    if (!env.executable) {
        return undefined;
    }

    if (env.kind === 'Conda') {
        const environmentPath = inferCondaEnvironmentPathFromRBinary(env.executable);
        if (environmentPath) {
            return { kind: 'conda', environmentPath };
        }
    }

    if (env.kind === 'Pixi') {
        const environmentPath = inferEnvironmentPathFromRBinary(env.executable);
        if (environmentPath) {
            return {
                kind: 'pixi',
                environmentPath,
                environmentName: env.name,
            };
        }
    }

    return undefined;
}

export function getLocatorMetadataFromNativeEnv(env: NativeREnvInfo): LocatorMetadata | undefined {
    if (env.locatorMetadata) {
        return env.locatorMetadata;
    }

    if (!env.executable) {
        return undefined;
    }

    if (env.kind === 'Conda') {
        const environmentPath = inferCondaEnvironmentPathFromRBinary(env.executable);
        if (environmentPath) {
            return {
                type: 'conda',
                environmentPath,
            };
        }
    }

    if (env.kind === 'Pixi') {
        const environmentPath = inferEnvironmentPathFromRBinary(env.executable);
        if (environmentPath) {
            return {
                type: 'pixi',
                environmentPath,
                manifestPath: null,
                environmentName: env.name ?? null,
            };
        }
    }

    return undefined;
}

function getReasonsDiscoveredFromNativeEnv(
    env: NativeREnvInfo,
    _packagerMetadata?: PackagerMetadata,
): ReasonDiscovered[] {
    const reasons: ReasonDiscovered[] = [];
    const primaryReason = getReasonDiscoveredFromRetKind(env.kind);

    if (primaryReason) {
        reasons.push(primaryReason);
    }

    for (const source of env.discoveredBy ?? []) {
        const reason = RET_DISCOVERY_SOURCE_TO_REASON[source];
        if (reason && !reasons.includes(reason)) {
            reasons.push(reason);
        }
    }

    if (reasons.length === 0) {
        reasons.push(ReasonDiscovered.HQ);
    }

    return reasons;
}

function inferEnvironmentPathFromRBinary(rBinPath: string): string | undefined {
    if (os.platform() === 'win32') {
        const windowsMatch = rBinPath.match(/^(.*)\\(?:Lib\\R\\bin\\(?:x64\\)?R\.exe|bin\\R\.exe)$/i);
        return windowsMatch?.[1];
    }

    const unixMatch = rBinPath.match(/^(.*)\/bin\/R$/);
    return unixMatch?.[1];
}

function inferCondaEnvironmentPathFromRBinary(rBinPath: string): string | undefined {
    if (os.platform() === 'win32') {
        const windowsMatch = rBinPath.match(/^(.*)\\Lib\\R\\bin\\(?:x64\\)?R\.exe$/i);
        return windowsMatch?.[1];
    }

    const unixMatch = rBinPath.match(/^(.+\/(?:envs|miniconda3|miniforge3|anaconda3)\/[^/]+)\/bin\/R$/);
    return unixMatch?.[1];
}

function inferReasonDiscoveredFromRBinary(
    rBinPath: string,
    packagerMetadata?: PackagerMetadata,
): ReasonDiscovered[] | null {
    if (packagerMetadata) {
        if (isPixiMetadata(packagerMetadata)) {
            return [ReasonDiscovered.PIXI];
        }

        if (isCondaMetadata(packagerMetadata)) {
            return [ReasonDiscovered.CONDA];
        }

        return [ReasonDiscovered.MODULE];
    }

    if (isRBinaryOnPath(rBinPath)) {
        return [ReasonDiscovered.PATH];
    }

    return [ReasonDiscovered.HQ];
}

function isRBinaryOnPath(rBinPath: string): boolean {
    try {
        const resolvedPath = os.platform() === 'win32'
            ? execSync('where R', { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0]?.trim()
            : execSync('which R', { encoding: 'utf8', timeout: 5000 }).trim();
        return !!resolvedPath && fs.existsSync(resolvedPath) && fs.realpathSync(resolvedPath) === rBinPath;
    } catch {
        return false;
    }
}

function getRHomePath(rBinPath: string): string | undefined {
    try {
        const result = execSync(`"${rBinPath}" RHOME`, { encoding: 'utf8', timeout: 5000 });
        const rhome = result.trim();
        if (fs.existsSync(rhome)) {
            return rhome;
        }
    } catch {
        if (os.platform() === 'darwin' || os.platform() === 'linux') {
            const unixMatch = rBinPath.match(/(.*)\/bin\/R$/);
            if (unixMatch && fs.existsSync(unixMatch[1])) {
                return unixMatch[1];
            }
        }
    }

    return undefined;
}

function getRVersion(rBinPath: string): string | undefined {
    try {
        const result = execSync(`"${rBinPath}" --version 2>&1`, { encoding: 'utf8', timeout: 5000 });
        const match = result.match(/R version (\d+\.\d+\.\d+)/);
        return match?.[1];
    } catch {
        return undefined;
    }
}

function getRArchitecture(
    rBinPath: string,
    _log: vscode.LogOutputChannel,
): string | undefined {
    if (os.platform() !== 'darwin') {
        return undefined;
    }

    try {
        const result = execSync(`file "${rBinPath}"`, { encoding: 'utf8' });
        if (result.includes('arm64')) {
            return 'aarch64';
        }
        if (result.includes('x86_64')) {
            return 'x86_64';
        }
    } catch {
        return undefined;
    }

    return undefined;
}

function normalizeArch(arch?: string): string | undefined {
    switch (arch) {
        case 'x64':
            return 'x86_64';
        case 'arm64':
            return 'aarch64';
        default:
            return arch;
    }
}

function inferRScriptPath(rBinPath: string): string {
    const binDirectory = path.dirname(rBinPath);
    if (process.platform === 'win32') {
        return path.join(binDirectory, 'Rscript.exe');
    }

    return path.join(binDirectory, 'Rscript');
}

function isConfiguredDefaultRPath(rBinPath: string): boolean {
    const configuredPath = vscode.workspace.getConfiguration('ark').get<string>('r.path');
    if (!configuredPath) {
        return false;
    }

    return arePathsSame(configuredPath, rBinPath);
}

function computeOrthogonality(homepath: string): boolean {
    if (process.platform !== 'darwin') {
        return true;
    }

    return !/R[.]framework\/Resources$/.test(homepath);
}

function arePathsSame(left: string, right: string): boolean {
    const normalizePath = (targetPath: string): string => {
        try {
            return fs.realpathSync(targetPath);
        } catch {
            return path.resolve(targetPath);
        }
    };

    const normalizedLeft = normalizePath(left);
    const normalizedRight = normalizePath(right);

    if (process.platform === 'win32') {
        return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
    }

    return normalizedLeft === normalizedRight;
}
