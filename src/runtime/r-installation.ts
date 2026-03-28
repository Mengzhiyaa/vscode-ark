import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import * as semver from 'semver';
import * as vscode from 'vscode';
import type { NativeREnvInfo } from './native-r-finder';

export type RInstallationSource = 'configured' | 'system' | 'conda' | 'path' | 'pixi';

export interface RMetadataExtra {
    homepath: string;
    binpath: string;
    scriptpath: string;
    arch?: string;
    current: boolean;
    default: boolean;
    reasonDiscovered?: ReasonDiscovered[] | null;
    packagerMetadata?: PackagerMetadata;
    condaEnvPath?: string;
    envName?: string;
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

export type PackagerMetadata = CondaMetadata | PixiMetadata;

export function isCondaMetadata(metadata: PackagerMetadata): metadata is CondaMetadata {
    return metadata.kind === 'conda';
}

export function isPixiMetadata(metadata: PackagerMetadata): metadata is PixiMetadata {
    return metadata.kind === 'pixi';
}

export interface RInstallationOptions {
    binpath: string;
    homepath: string;
    version: string;
    arch?: string;
    current?: boolean;
    source?: RInstallationSource;
    reasonDiscovered?: ReasonDiscovered[] | null;
    packagerMetadata?: PackagerMetadata;
    supported?: boolean;
    usable?: boolean;
    reasonRejected?: ReasonRejected | null;
}

export class RInstallation {
    public usable = true;
    public supported = true;
    public reasonDiscovered: ReasonDiscovered[] | null = null;
    public reasonRejected: ReasonRejected | null = null;

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
    public packagerMetadata: PackagerMetadata | undefined = undefined;

    constructor(options: RInstallationOptions) {
        this.binpath = options.binpath;
        this.homepath = options.homepath;
        this.scriptpath = inferRScriptPath(options.binpath);
        this.semVersion = semver.coerce(options.version) ?? new semver.SemVer('0.0.1');
        this.version = this.semVersion.format();
        this.arch = options.arch ?? '';
        this.current = options.current ?? false;
        this.source = options.source ?? 'system';
        this.reasonDiscovered = options.reasonDiscovered ?? null;
        this.packagerMetadata = options.packagerMetadata;
        this.default = isConfiguredDefaultRPath(options.binpath);
        this.orthogonal = computeOrthogonality(options.homepath);
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

export function getReasonDiscoveredFromRetKind(kind?: string): ReasonDiscovered {
    return RET_KIND_TO_DISCOVERY_REASON[kind ?? ''] ?? ReasonDiscovered.HQ;
}

export function formatRuntimeName(installation: RInstallation): string {
    let name = `R ${installation.version}`;

    if (installation.packagerMetadata) {
        if (isPixiMetadata(installation.packagerMetadata)) {
            const environmentName =
                installation.packagerMetadata.environmentName ??
                path.basename(installation.packagerMetadata.environmentPath);
            if (environmentName) {
                name += ` (Pixi: ${environmentName})`;
            }
        } else {
            name += ` (Conda: ${path.basename(installation.packagerMetadata.environmentPath)})`;
        }
    } else if (installation.reasonDiscovered?.includes(ReasonDiscovered.HOMEBREW)) {
        name += ' (Homebrew)';
    }

    return name;
}

export function getMetadataExtra(installation: RInstallation): RMetadataExtra {
    const metadata: RMetadataExtra = {
        homepath: installation.homepath,
        binpath: installation.binpath,
        scriptpath: installation.scriptpath,
        arch: installation.arch || undefined,
        current: installation.current,
        default: installation.default,
        reasonDiscovered: installation.reasonDiscovered ?? null,
        packagerMetadata: installation.packagerMetadata,
    };

    if (installation.packagerMetadata && isCondaMetadata(installation.packagerMetadata)) {
        metadata.condaEnvPath = installation.packagerMetadata.environmentPath;
        metadata.envName = path.basename(installation.packagerMetadata.environmentPath);
    }

    return metadata;
}

export function restorePackagerMetadata(extraRuntimeData: {
    packagerMetadata?: PackagerMetadata | {
        environmentPath: string;
        manifestPath?: string;
        environmentName?: string;
    };
    condaEnvPath?: string;
    envName?: string;
    binpath?: string;
}): PackagerMetadata | undefined {
    if (extraRuntimeData.packagerMetadata) {
        if ('kind' in extraRuntimeData.packagerMetadata) {
            return extraRuntimeData.packagerMetadata;
        }

        if ('manifestPath' in extraRuntimeData.packagerMetadata) {
            return {
                kind: 'pixi',
                environmentPath: extraRuntimeData.packagerMetadata.environmentPath,
                manifestPath: extraRuntimeData.packagerMetadata.manifestPath,
                environmentName: extraRuntimeData.packagerMetadata.environmentName,
            };
        }

        return {
            kind: 'conda',
            environmentPath: extraRuntimeData.packagerMetadata.environmentPath,
        };
    }

    if (extraRuntimeData.condaEnvPath) {
        return { kind: 'conda', environmentPath: extraRuntimeData.condaEnvPath };
    }

    if (extraRuntimeData.binpath) {
        return inferPackagerMetadataFromRBinary(extraRuntimeData.binpath);
    }

    return undefined;
}

export function convertNativeEnvToRInstallation(env: NativeREnvInfo): RInstallation | undefined {
    if (!env.executable || !env.home || !env.version) {
        return undefined;
    }

    const reasonDiscovered = getReasonDiscoveredFromRetKind(env.kind);
    const packagerMetadata = getPackagerMetadataFromNativeEnv(env);

    return new RInstallation({
        binpath: env.executable,
        homepath: env.home,
        version: env.version,
        arch: normalizeArch(env.arch),
        current: false,
        source: getSourceFromDiscoveryReason(reasonDiscovered),
        reasonDiscovered: [reasonDiscovered],
        packagerMetadata,
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
        source: getSourceFromDiscoveryReason(resolvedReasonDiscovered?.[0]),
        reasonDiscovered: resolvedReasonDiscovered,
        packagerMetadata: resolvedPackagerMetadata,
    });
}

export function inferPackagerMetadataFromRBinary(rBinPath: string): PackagerMetadata | undefined {
    const condaEnvironmentPath = inferCondaEnvironmentPathFromRBinary(rBinPath);
    if (condaEnvironmentPath) {
        return { kind: 'conda', environmentPath: condaEnvironmentPath };
    }

    return undefined;
}

export function inferCondaEnvironmentFromRBinary(rBinPath: string): {
    condaEnvPath?: string;
    envName?: string;
} {
    const condaEnvPath = inferCondaEnvironmentPathFromRBinary(rBinPath);
    if (!condaEnvPath) {
        return {};
    }

    return {
        condaEnvPath,
        envName: path.basename(condaEnvPath),
    };
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

export function getPackagerMetadataFromNativeEnv(env: NativeREnvInfo): PackagerMetadata | undefined {
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
        return [isPixiMetadata(packagerMetadata) ? ReasonDiscovered.PIXI : ReasonDiscovered.CONDA];
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
