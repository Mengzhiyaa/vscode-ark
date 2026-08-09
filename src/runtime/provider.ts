import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';
import * as vscode from 'vscode';
import type { RuntimeRootEntry, RuntimeRootSignature } from '../types/supervisor-api';
import { discoverRetInstallations, getBestRetInstallation, hasNativeRFinder } from './provider-ret';
import {
    friendlyReason,
    formatRuntimeName,
    probeRInstallation,
    ReasonDiscovered,
    isModuleMetadata,
    isPixiMetadata,
    type PackagerMetadata,
    type RInstallation,
} from './r-installation';

const R_SERVER_ROOTS_POSIX: readonly string[] = [
    '/usr/lib/R',
    '/usr/lib64/R',
    '/usr/local/lib/R',
    '/usr/local/lib64/R',
    '/opt/local/lib/R',
    '/opt/local/lib64/R',
    '/opt/local/R',
];

const R_AD_HOC_BINARIES: readonly string[] = [
    '/usr/bin/R',
    '/usr/local/bin/R',
    '/opt/local/bin/R',
    '/opt/homebrew/bin/R',
];

const NON_CACHEABLE_REASONS: ReadonlySet<ReasonDiscovered> = new Set([
    ReasonDiscovered.PIXI,
    ReasonDiscovered.MODULE,
]);

const SYSTEM_REASONS: ReadonlySet<ReasonDiscovered> = new Set(
    Object.values(ReasonDiscovered).filter(reason => !NON_CACHEABLE_REASONS.has(reason)),
);

function rHeadquarters(): string[] {
    switch (process.platform) {
        case 'darwin':
            return ['/Library/Frameworks/R.framework/Versions'];
        case 'linux':
            return ['/opt/R'];
        case 'win32': {
            const programFiles = new Set<string>();
            const configuredProgramFiles = process.env.PROGRAMFILES ?? process.env.ProgramFiles;
            if (configuredProgramFiles) {
                programFiles.add(configuredProgramFiles);
            }
            if (process.env.ProgramW6432) {
                programFiles.add(process.env.ProgramW6432);
            }
            if (programFiles.size === 0) {
                programFiles.add('C:\\Program Files');
            }
            const roots = [...programFiles].flatMap(base => [
                path.join(base, 'R'),
                ...(process.arch === 'arm64' ? [path.join(base, 'R-aarch64')] : []),
            ]);
            if (process.env.LOCALAPPDATA) {
                roots.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'R'));
                if (process.arch === 'arm64') {
                    roots.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'R-aarch64'));
                }
            }
            return [...new Set(roots)];
        }
        default:
            return [];
    }
}

function rCurrentSymlinks(headquarters: readonly string[]): string[] {
    if (process.platform === 'win32') {
        return [];
    }
    const currentName = process.platform === 'darwin' ? 'Current' : 'current';
    return headquarters.map(root => path.join(root, currentName));
}

export function computeRootSignatureEntries(candidates: readonly string[]): RuntimeRootEntry[] {
    const seen = new Set<string>();
    const entries: RuntimeRootEntry[] = [];
    for (const candidate of candidates) {
        let resolved = candidate;
        let exists = false;
        let mtimeMs = 0;
        try {
            const stat = fs.statSync(candidate);
            try {
                resolved = fs.realpathSync(candidate);
            } catch {
                resolved = candidate;
            }
            exists = true;
            mtimeMs = stat.mtimeMs;
        } catch {
            // Keep absent roots in the signature so creating one invalidates it.
        }
        if (!seen.has(resolved)) {
            seen.add(resolved);
            entries.push({ path: resolved, exists, mtimeMs });
        }
    }
    return entries;
}

export async function getRDiscoveryRootSignature(): Promise<RuntimeRootSignature> {
    const headquarters = rHeadquarters();
    const config = vscode.workspace.getConfiguration('ark');
    const configuredRPath = config.get<string>('r.path') || undefined;
    const candidates = [
        ...headquarters,
        ...rCurrentSymlinks(headquarters),
        ...(process.platform === 'win32' ? [] : R_SERVER_ROOTS_POSIX),
        ...R_AD_HOC_BINARIES,
        ...(configuredRPath ? [configuredRPath] : []),
    ];
    return {
        entries: computeRootSignatureEntries(candidates),
        opaque: getRFilterSettingsDigest(),
    };
}

function getRFilterSettingsDigest(): string {
    const config = vscode.workspace.getConfiguration('ark');
    const payload = {
        rPath: config.get<string>('r.path') ?? '',
    };
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function isRRuntimeCacheable(installation: RInstallation): boolean {
    if (!installation.binpath || !installation.reasonDiscovered?.length) {
        return false;
    }
    if (
        installation.packagerMetadata &&
        (isModuleMetadata(installation.packagerMetadata) || isPixiMetadata(installation.packagerMetadata))
    ) {
        return false;
    }
    if (installation.reasonDiscovered.some(reason => NON_CACHEABLE_REASONS.has(reason))) {
        return false;
    }
    if (!installation.reasonDiscovered.some(reason => SYSTEM_REASONS.has(reason))) {
        return false;
    }

    const runtimePath = normalizePathForComparison(installation.binpath);
    return !(vscode.workspace.workspaceFolders ?? []).some(folder => {
        const workspacePath = normalizePathForComparison(folder.uri.fsPath);
        const relative = path.relative(workspacePath, runtimePath);
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    });
}

function normalizePathForComparison(value: string): string {
    const normalized = path.resolve(value);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export interface RBinary {
    path: string;
    reasons: ReasonDiscovered[];
    packagerMetadata?: PackagerMetadata;
}

export interface RInstallationPromptOptions {
    forcePick?: boolean;
    allowBrowse?: boolean;
    persistSelection?: boolean;
    title?: string;
    placeHolder?: string;
    preselectBinPath?: string;
}

interface RInstallationQuickPickItem extends vscode.QuickPickItem {
    installation?: RInstallation;
    action?: 'browse';
}

export async function discoverRInstallations(
    log: vscode.LogOutputChannel,
): Promise<RInstallation[]> {
    const installations: RInstallation[] = [];

    for await (const installation of discoverInstallations(log)) {
        installations.push(installation);
    }

    sortInstallations(installations);

    if (installations.length === 0) {
        log.warn('No R installations found. Configure ark.r.path or make sure RET is available.');
        log.info('You can set ark.r.path in VS Code settings to point to your R binary');
    } else {
        log.debug(`Discovered ${installations.length} R installation(s)`);
    }

    return installations;
}

export async function* rRuntimeDiscoverer(
    log: vscode.LogOutputChannel,
): AsyncGenerator<RInstallation> {
    yield* discoverInstallations(log);
}

export async function getBestRInstallation(
    log: vscode.LogOutputChannel,
): Promise<RInstallation | undefined> {
    const configuredInstallation = await getConfiguredInstallation(log);
    if (configuredInstallation) {
        configuredInstallation.current = true;
        configuredInstallation.source = 'configured';
        return configuredInstallation;
    }

    if (hasNativeRFinder()) {
        try {
            const retInstallation = await getBestRetInstallation(log);
            if (retInstallation) {
                retInstallation.current = true;
                return retInstallation;
            }

            log.warn('[rRuntimeDiscoverer] RET discovery returned no usable R installations');
        } catch (error) {
            log.warn(`[rRuntimeDiscoverer] RET discovery failed during initial resolution: ${error}`);
        }
    } else {
        log.info('[rRuntimeDiscoverer] RET not available; automatic discovery disabled');
    }

    return undefined;
}

export async function promptForRPath(
    log: vscode.LogOutputChannel,
    options: RInstallationPromptOptions = {},
): Promise<RInstallation | undefined> {
    const {
        forcePick = false,
        allowBrowse = true,
        persistSelection = false,
        title = 'R Installation',
        placeHolder = 'Select R installation to use',
        preselectBinPath,
    } = options;

    const installations = await discoverRInstallations(log);
    if (installations.length === 0) {
        return promptForRPathWhenMissing(log, allowBrowse, persistSelection);
    }

    if (installations.length === 1 && !forcePick) {
        return installations[0];
    }

    const items: RInstallationQuickPickItem[] = installations.map(installation => {
        const label = formatRuntimeName(installation);
        return {
            label,
            iconPath: getRQuickPickIconPath(),
            description: getSourceLabel(installation),
            detail: installation.binpath,
            picked: preselectBinPath
                ? installation.binpath === preselectBinPath
                : installation.current,
            installation,
        };
    });

    if (allowBrowse) {
        items.push({
            label: 'Browse...',
            description: 'Select a different R binary',
            alwaysShow: true,
            action: 'browse',
        });
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder,
        title,
        canPickMany: false,
    });

    if (!selected) {
        return undefined;
    }

    if (selected.action === 'browse') {
        return selectRBinaryFromDialog(log, persistSelection);
    }

    if (selected.installation && persistSelection) {
        await persistRPath(selected.installation.binpath, log);
        selected.installation.current = true;
    }

    return selected.installation;
}

export { formatRuntimeName };

function getRQuickPickIconPath(): vscode.IconPath | undefined {
    const extension = vscode.extensions.getExtension('mengzhiya.vscode-ark');
    if (!extension) {
        return undefined;
    }

    return vscode.Uri.joinPath(extension.extensionUri, 'images', 'Rlogo.svg');
}

async function* discoverInstallations(
    log: vscode.LogOutputChannel,
): AsyncGenerator<RInstallation> {
    const yieldedPaths = new Set<string>();
    let hasCurrent = false;

    const configuredInstallation = await getConfiguredInstallation(log);
    const hasConfigured = !!configuredInstallation;
    if (configuredInstallation && shouldYieldInstallation(configuredInstallation, yieldedPaths)) {
        configuredInstallation.current = true;
        configuredInstallation.source = 'configured';
        hasCurrent = true;
        yield configuredInstallation;
    }

    if (hasNativeRFinder()) {
        try {
            let yieldedRetInstallation = false;

            for await (const installation of discoverRetInstallations(log)) {
                if (!installation.usable) {
                    log.info(`Filtering out ${installation.binpath}, reason: ${friendlyReason(installation.reasonRejected)}`);
                    continue;
                }

                if (!shouldYieldInstallation(installation, yieldedPaths)) {
                    continue;
                }

                if (!hasCurrent) {
                    installation.current = true;
                    hasCurrent = true;
                }

                yieldedRetInstallation = true;
                yield installation;
            }

            if (!yieldedRetInstallation && !hasConfigured) {
                log.warn('[rRuntimeDiscoverer] RET discovery returned no usable R installations');
            }
            return;
        } catch (error) {
            log.warn(`[rRuntimeDiscoverer] RET discovery failed: ${error}`);
            return;
        }
    } else {
        log.info('[rRuntimeDiscoverer] RET not available; automatic discovery disabled');
    }
}

function shouldYieldInstallation(
    installation: RInstallation,
    yieldedPaths: Set<string>,
): boolean {
    const normalizedPath = canonicalizeBinaryPath(installation.binpath);
    if (yieldedPaths.has(normalizedPath)) {
        return false;
    }

    yieldedPaths.add(normalizedPath);
    return true;
}

function sortInstallations(installations: RInstallation[]): void {
    installations.sort((left, right) => {
        if (left.current || right.current) {
            return Number(right.current) - Number(left.current);
        }

        return semver.compare(right.semVersion, left.semVersion) || left.arch.localeCompare(right.arch);
    });
}

async function getConfiguredInstallation(
    log: vscode.LogOutputChannel,
): Promise<RInstallation | undefined> {
    const configuredPath = vscode.workspace.getConfiguration('ark').get<string>('r.path');
    log.debug(`Configured ark.r.path: ${configuredPath || '(not set)'}`);

    if (!configuredPath) {
        return undefined;
    }

    if (!fs.existsSync(configuredPath)) {
        log.warn(`Configured R path does not exist: ${configuredPath}. This may be a path from another machine synced via Settings Sync. Consider setting ark.r.path in workspace settings instead.`);
        return undefined;
    }

    const installation = await probeRInstallation(
        configuredPath,
        log,
        [ReasonDiscovered.userSetting],
    );
    if (!installation) {
        log.warn(`Configured R path is not a valid R installation: ${configuredPath}`);
        return undefined;
    }

    if (!installation.usable) {
        log.warn(`Configured R path is not usable: ${configuredPath}. Reason: ${friendlyReason(installation.reasonRejected)}`);
        return undefined;
    }

    return installation;
}

function canonicalizeBinaryPath(binaryPath: string): string {
    try {
        return fs.realpathSync(binaryPath);
    } catch {
        return path.normalize(binaryPath);
    }
}

function getSourceLabel(installation: RInstallation): string {
    const reasonDiscovered = installation.reasonDiscovered ?? [];

    for (const reason of reasonDiscovered) {
        switch (reason) {
            case ReasonDiscovered.userSetting:
                return 'Configured';
            case ReasonDiscovered.CONDA:
                return 'Conda';
            case ReasonDiscovered.PIXI:
                return 'Pixi';
            case ReasonDiscovered.HOMEBREW:
                return 'Homebrew';
            case ReasonDiscovered.MODULE:
                return 'Module';
            case ReasonDiscovered.RIG:
                return 'Rig';
            case ReasonDiscovered.RVERSIONS:
                return 'r-versions';
            case ReasonDiscovered.NIX:
                return 'Nix';
            case ReasonDiscovered.GUIX:
                return 'Guix';
            case ReasonDiscovered.SPACK:
                return 'Spack';
            case ReasonDiscovered.MAC_PORTS:
                return 'MacPorts';
            case ReasonDiscovered.WINDOWS_REGISTRY:
                return 'Windows Registry';
            case ReasonDiscovered.SCOOP:
                return 'Scoop';
            case ReasonDiscovered.CHOCOLATEY:
                return 'Chocolatey';
            case ReasonDiscovered.PATH:
                return 'PATH';
            case ReasonDiscovered.HQ:
            case ReasonDiscovered.LINUX_GLOBAL:
            case ReasonDiscovered.MAC_FRAMEWORK:
            case ReasonDiscovered.WINDOWS_HQ:
                return 'System';
        }
    }

    switch (installation.source) {
        case 'configured':
            return 'Configured';
        case 'conda':
            return 'Conda';
        case 'pixi':
            return 'Pixi';
        case 'path':
            return 'PATH';
        case 'system':
        default:
            return 'System';
    }
}

async function promptForRPathWhenMissing(
    log: vscode.LogOutputChannel,
    allowBrowse: boolean,
    persistSelection: boolean,
): Promise<RInstallation | undefined> {
    const actions: string[] = [];
    if (allowBrowse) {
        actions.push('Configure R Path');
    }
    actions.push('Open Settings', 'Cancel');

    const action = await vscode.window.showWarningMessage(
        'No R installation found. Configure ark.r.path or install RET support.',
        ...actions,
    );

    if (action === 'Configure R Path') {
        return selectRBinaryFromDialog(log, persistSelection);
    }

    if (action === 'Open Settings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'ark.r.path');
    }

    return undefined;
}

async function selectRBinaryFromDialog(
    log: vscode.LogOutputChannel,
    persistSelection: boolean,
): Promise<RInstallation | undefined> {
    const files = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        title: 'Select R Binary',
        filters: process.platform === 'win32' ? { 'R Executable': ['exe'] } : undefined,
        openLabel: 'Select R',
    });

    if (!files || files.length === 0) {
        return undefined;
    }

    const rPath = files[0].fsPath;
    log.info(`User selected R path: ${rPath}`);

    const installation = await probeRInstallation(
        rPath,
        log,
        [ReasonDiscovered.userSetting],
    );
    if (!installation) {
        vscode.window.showErrorMessage(`Selected file is not a valid R installation: ${rPath}`);
        return undefined;
    }

    if (!installation.usable) {
        vscode.window.showErrorMessage(
            `Selected R installation is not usable: ${rPath}. Reason: ${friendlyReason(installation.reasonRejected)}`,
        );
        return undefined;
    }

    if (persistSelection) {
        await persistRPath(rPath, log);
    }

    installation.current = true;
    installation.source = 'configured';
    return installation;
}

async function persistRPath(
    rPath: string,
    log: vscode.LogOutputChannel,
): Promise<void> {
    const config = vscode.workspace.getConfiguration('ark');
    const target = vscode.env.remoteName
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : vscode.ConfigurationTarget.Global;
    await config.update('r.path', rPath, target);
    log.info(`Saved ark.r.path: ${rPath} (scope: ${vscode.env.remoteName ? 'WorkspaceFolder' : 'Global'})`);
    if (vscode.env.remoteName) {
        log.info('Using WorkspaceFolder scope to prevent Settings Sync from sharing this path across machines');
    }
}
