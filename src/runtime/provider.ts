import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as semver from 'semver';
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { discoverCondaBinaries } from './provider-conda';
import { discoverRetInstallations, getBestRetInstallation, hasNativeRFinder } from './provider-ret';
import {
    friendlyReason,
    formatRuntimeName,
    probeRInstallation,
    ReasonDiscovered,
    type PackagerMetadata,
    type RInstallation,
} from './r-installation';

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
        log.warn('No R installations found. Please install R or configure ark.r.path');
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

            log.warn('[rRuntimeDiscoverer] RET discovery returned no usable R installations, falling back to TypeScript');
        } catch (error) {
            log.warn(`[rRuntimeDiscoverer] RET discovery failed during initial resolution: ${error}`);
        }
    } else {
        log.info('[rRuntimeDiscoverer] RET not available, using TypeScript discovery');
    }

    return getBestTypeScriptInstallation(log);
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

    const items: RInstallationQuickPickItem[] = installations.map(installation => ({
        label: `$(symbol-misc) ${formatRuntimeName(installation)}`,
        description: getSourceLabel(installation),
        detail: installation.binpath,
        picked: preselectBinPath
            ? installation.binpath === preselectBinPath
            : installation.current,
        installation,
    }));

    if (allowBrowse) {
        items.push({
            label: 'Browse...',
            description: 'Select a different R binary',
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

            if (yieldedRetInstallation || hasConfigured) {
                return;
            }

            log.warn('[rRuntimeDiscoverer] RET discovery returned no usable R installations, falling back to TypeScript');
        } catch (error) {
            log.warn(`[rRuntimeDiscoverer] RET discovery failed, falling back to TypeScript: ${error}`);
        }
    } else {
        log.info('[rRuntimeDiscoverer] RET not available, using TypeScript discovery');
    }

    yield* rRuntimeDiscovererTypescript(log, yieldedPaths, hasCurrent);
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

async function getBestTypeScriptInstallation(
    log: vscode.LogOutputChannel,
): Promise<RInstallation | undefined> {
    for await (const installation of rRuntimeDiscovererTypescript(log, new Set<string>(), false)) {
        return installation;
    }

    return undefined;
}

async function* rRuntimeDiscovererTypescript(
    log: vscode.LogOutputChannel,
    yieldedPaths: Set<string>,
    hasCurrent: boolean,
): AsyncGenerator<RInstallation> {
    log.debug('[rRuntimeDiscoverer] Checking R on PATH...');
    const pathBinary = findROnPath();
    if (pathBinary) {
        const installation = await probeRInstallation(
            pathBinary,
            log,
            [ReasonDiscovered.PATH],
        );
        if (installation) {
            installation.source = 'path';
            if (!installation.usable) {
                log.info(`Filtering out ${installation.binpath}, reason: ${friendlyReason(installation.reasonRejected)}`);
            } else if (shouldYieldInstallation(installation, yieldedPaths)) {
                if (!hasCurrent) {
                    installation.current = true;
                    hasCurrent = true;
                }
                log.debug(`[rRuntimeDiscoverer] Yielding R on PATH: ${installation.version}`);
                yield installation;
            }
        }
    }

    log.debug('[rRuntimeDiscoverer] Checking standard locations...');
    for (const rPath of getStandardRLocations()) {
        const installation = await probeRInstallation(
            rPath,
            log,
            [ReasonDiscovered.HQ],
        );
        if (!installation) {
            continue;
        }

        installation.source = 'system';
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

        log.debug(`[rRuntimeDiscoverer] Yielding system R ${installation.version} at ${rPath}`);
        yield installation;
    }

    log.debug('[rRuntimeDiscoverer] Checking Conda environments...');
    try {
        const condaBinaries = await discoverCondaBinaries(log);
        for (const binary of condaBinaries) {
            const installation = await probeRInstallation(
                binary.path,
                log,
                binary.reasons,
                binary.packagerMetadata,
            );
            if (!installation) {
                continue;
            }

            installation.source = 'conda';
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

            log.debug(`[rRuntimeDiscoverer] Yielding Conda R ${installation.version} at ${installation.binpath}`);
            yield installation;
        }
    } catch (error) {
        log.warn(`[rRuntimeDiscoverer] Error discovering Conda R: ${error}`);
    }

    log.debug(`[rRuntimeDiscoverer] Discovery complete. Found ${yieldedPaths.size} R installation(s)`);
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

function findROnPath(): string | undefined {
    try {
        if (os.platform() === 'win32') {
            const result = execSync('where R', { encoding: 'utf8', timeout: 5000 });
            return result.trim().split('\n')[0]?.trim();
        }

        return execSync('which R', { encoding: 'utf8', timeout: 5000 }).trim();
    } catch {
        return undefined;
    }
}

function getStandardRLocations(): string[] {
    const locations: string[] = [];

    switch (os.platform()) {
        case 'darwin': {
            const frameworkBase = '/Library/Frameworks/R.framework/Versions';
            if (fs.existsSync(frameworkBase)) {
                try {
                    const versions = fs.readdirSync(frameworkBase)
                        .filter(version => !version.toLowerCase().includes('current'))
                        .map(version => path.join(frameworkBase, version, 'Resources', 'bin', 'R'))
                        .filter(versionPath => fs.existsSync(versionPath));
                    locations.push(...versions);
                } catch {
                    return locations;
                }
            }

            locations.push('/opt/homebrew/bin/R');
            locations.push('/usr/local/bin/R');
            break;
        }
        case 'linux': {
            locations.push('/usr/bin/R');
            locations.push('/usr/local/bin/R');

            const optR = '/opt/R';
            if (fs.existsSync(optR)) {
                try {
                    const versions = fs.readdirSync(optR)
                        .filter(version => !version.toLowerCase().includes('current'))
                        .map(version => path.join(optR, version, 'bin', 'R'))
                        .filter(versionPath => fs.existsSync(versionPath));
                    locations.push(...versions);
                } catch {
                    return locations;
                }
            }
            break;
        }
        case 'win32': {
            const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
            const rBase = path.join(programFiles, 'R');
            if (fs.existsSync(rBase)) {
                try {
                    const versions = fs.readdirSync(rBase)
                        .filter(version => version.startsWith('R-'))
                        .map(version => {
                            const x64Path = path.join(rBase, version, 'bin', 'x64', 'R.exe');
                            if (fs.existsSync(x64Path)) {
                                return x64Path;
                            }
                            return path.join(rBase, version, 'bin', 'R.exe');
                        })
                        .filter(versionPath => fs.existsSync(versionPath));
                    locations.push(...versions);
                } catch {
                    return locations;
                }
            }
            break;
        }
    }

    return Array.from(new Set(locations.filter(location => fs.existsSync(location))));
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
        'No R installation found on your system.',
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
