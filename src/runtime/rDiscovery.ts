/**
 * R Installation Discovery
 *
 * Simplified R installation detection for vscode-ark.
 * This is a minimal version of positron-r's provider.ts
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { discoverCondaRBinaries } from './condaDiscovery';

/**
 * Represents a discovered R installation
 */
/** Source type for R installation */
export type RInstallationSource = 'configured' | 'system' | 'conda' | 'path';

export interface RInstallation {
    /** Path to R binary (e.g., /usr/local/bin/R) */
    binpath: string;

    /** R_HOME path (e.g., /Library/Frameworks/R.framework/Resources) */
    homepath: string;

    /** R version string (e.g., "4.3.2") */
    version: string;

    /** Architecture (e.g., "x86_64", "aarch64") */
    arch?: string;

    /** Whether this is the "current" R on the system */
    current: boolean;

    /** Conda environment path if R is from conda (e.g., /path/to/envs/R) */
    condaEnvPath?: string;

    /** Conda environment name (extracted from condaEnvPath) */
    envName?: string;

    /** Source of this R installation */
    source: RInstallationSource;
}

/**
 * Formats runtime display name from an R installation (Positron pattern).
 * Examples:
 *   - "R 4.3.2"
 *   - "R 4.3.2 (Conda: my_env)"
 */
export function formatRuntimeName(installation: RInstallation): string {
    let name = `R ${installation.version}`;
    if (installation.source === 'conda' && installation.envName) {
        name += ` (Conda: ${installation.envName})`;
    }
    return name;
}

export interface RInstallationPromptOptions {
    /**
     * Force showing the picker even if only one installation is available.
     */
    forcePick?: boolean;

    /**
     * Allow browsing for a custom R binary.
     */
    allowBrowse?: boolean;

    /**
     * Persist the selection to ark.r.path.
     */
    persistSelection?: boolean;

    /**
     * Picker title override.
     */
    title?: string;

    /**
     * Picker placeholder override.
     */
    placeHolder?: string;

    /**
     * Preselect a specific R binary path in the picker.
     */
    preselectBinPath?: string;
}

interface RInstallationQuickPickItem extends vscode.QuickPickItem {
    installation?: RInstallation;
    action?: 'browse';
}

/**
 * Discovers R installations on the system.
 * Returns the list of usable R installations, sorted by preference.
 */
export async function discoverRInstallations(
    log: vscode.LogOutputChannel
): Promise<RInstallation[]> {
    const installations: RInstallation[] = [];
    const addInstallation = (installation: RInstallation) => {
        if (!installations.some(existing => existing.binpath === installation.binpath)) {
            installations.push(installation);
        }
    };

    // Check for configured R path first
    const config = vscode.workspace.getConfiguration('ark');
    const configuredPath = config.get<string>('r.path');
    log.debug(`Configured ark.r.path: ${configuredPath || '(not set)'}`);
    let hasConfigured = false;

    if (configuredPath && fs.existsSync(configuredPath)) {
        log.debug(`Checking configured R path: ${configuredPath}`);
        const inst = await probeRInstallation(configuredPath, log);
        if (inst) {
            inst.current = true;
            inst.source = 'configured';
            addInstallation(inst);
            hasConfigured = true;
            log.debug(`Using configured R ${inst.version} at ${configuredPath}`);
        } else {
            log.warn(`Configured R path is not a valid R installation: ${configuredPath}`);
        }
    } else if (configuredPath) {
        log.warn(`Configured R path does not exist: ${configuredPath}. ` +
            `This may be a path from another machine synced via Settings Sync. ` +
            `Consider setting ark.r.path in workspace settings instead.`);
    }

    // Try to find R on PATH
    log.debug('Searching for R on PATH...');
    const rOnPath = findROnPath();
    if (rOnPath) {
        log.debug(`Found R binary on PATH: ${rOnPath}`);
        const inst = await probeRInstallation(rOnPath, log);
        if (inst) {
            inst.current = !hasConfigured;
            inst.source = 'path';
            addInstallation(inst);
            log.debug(`Validated R on PATH: ${inst.version}`);
        }
    } else {
        log.debug('R not found on PATH');
    }

    // Discover R in standard locations
    log.debug('Checking standard R installation locations...');
    const standardPaths = getStandardRLocations();
    log.debug(`Standard paths to check: ${standardPaths.join(', ') || '(none found)'}`);

    for (const rPath of standardPaths) {
        if (installations.some(i => i.binpath === rPath)) {
            continue; // Already added
        }
        const inst = await probeRInstallation(rPath, log);
        if (inst) {
            inst.source = 'system';
            addInstallation(inst);
            log.debug(`Found R ${inst.version} at ${rPath}`);
        }
    }

    // Discover R in Conda environments (Positron pattern)
    const condaBinaries = await discoverCondaRBinaries(log);
    for (const { envPath, rPath } of condaBinaries) {
        if (installations.some(i => i.binpath === rPath)) {
            continue;
        }
        const inst = await probeRInstallation(rPath, log);
        if (inst) {
            if (!inst.condaEnvPath) {
                inst.condaEnvPath = envPath;
            }
            // Extract env name from path
            inst.envName = path.basename(envPath);
            inst.source = 'conda';
            addInstallation(inst);
            log.debug(`Found R ${inst.version} in Conda env at ${envPath}`);
        }
    }

    if (installations.length === 0) {
        log.warn('No R installations found. Please install R or configure ark.r.path');
        log.info('You can set ark.r.path in VS Code settings to point to your R binary');
    } else {
        log.debug(`Discovered ${installations.length} R installation(s)`);
    }

    return installations;
}

/**
 * Async generator for incremental R runtime discovery (Positron pattern).
 * Yields R installations as they are discovered, allowing for progressive UI updates.
 * 
 * Discovery order:
 * 1. Configured path (immediate - highest priority)
 * 2. R on PATH (fast)
 * 3. Standard system locations (medium)
 * 4. Conda environments (slow - discovered last)
 */
export async function* rRuntimeDiscoverer(
    log: vscode.LogOutputChannel
): AsyncGenerator<RInstallation> {
    const yieldedPaths = new Set<string>();

    // Helper to avoid duplicates
    const shouldYield = (installation: RInstallation): boolean => {
        if (yieldedPaths.has(installation.binpath)) {
            return false;
        }
        yieldedPaths.add(installation.binpath);
        return true;
    };

    // Phase 1: Check configured R path (immediate, highest priority)
    const config = vscode.workspace.getConfiguration('ark');
    const configuredPath = config.get<string>('r.path');

    if (configuredPath && fs.existsSync(configuredPath)) {
        log.debug(`Checking configured R path: ${configuredPath}`);
        const inst = await probeRInstallation(configuredPath, log);
        if (inst) {
            inst.current = true;
            inst.source = 'configured';
            if (shouldYield(inst)) {
                log.debug(`[rRuntimeDiscoverer] Yielding configured R ${inst.version}`);
                yield inst;
            }
        }
    }

    // Phase 2: Check R on PATH (fast)
    log.debug('[rRuntimeDiscoverer] Checking R on PATH...');
    const rOnPath = findROnPath();
    if (rOnPath) {
        const inst = await probeRInstallation(rOnPath, log);
        if (inst) {
            inst.source = 'path';
            if (shouldYield(inst)) {
                log.debug(`[rRuntimeDiscoverer] Yielding R on PATH: ${inst.version}`);
                yield inst;
            }
        }
    }

    // Phase 3: Check standard system locations
    log.debug('[rRuntimeDiscoverer] Checking standard locations...');
    const standardPaths = getStandardRLocations();
    for (const rPath of standardPaths) {
        const inst = await probeRInstallation(rPath, log);
        if (inst) {
            inst.source = 'system';
            if (shouldYield(inst)) {
                log.debug(`[rRuntimeDiscoverer] Yielding system R ${inst.version} at ${rPath}`);
                yield inst;
            }
        }
    }

    // Phase 4: Discover Conda environments (slow, done last)
    log.debug('[rRuntimeDiscoverer] Checking Conda environments...');
    try {
        const condaBinaries = await discoverCondaRBinaries(log);
        for (const { envPath, rPath } of condaBinaries) {
            const inst = await probeRInstallation(rPath, log);
            if (inst) {
                if (!inst.condaEnvPath) {
                    inst.condaEnvPath = envPath;
                }
                inst.envName = path.basename(envPath);
                inst.source = 'conda';
                if (shouldYield(inst)) {
                    log.debug(`[rRuntimeDiscoverer] Yielding Conda R ${inst.version} in ${inst.envName}`);
                    yield inst;
                }
            }
        }
    } catch (error) {
        log.warn(`[rRuntimeDiscoverer] Error discovering Conda R: ${error}`);
    }

    log.debug(`[rRuntimeDiscoverer] Discovery complete. Found ${yieldedPaths.size} R installation(s)`);
}

/**
 * Get the best available R installation
 */
export async function getBestRInstallation(
    log: vscode.LogOutputChannel
): Promise<RInstallation | undefined> {
    const installations = await discoverRInstallations(log);
    return installations[0];
}

/**
 * Prompts user to select or configure R path
 */
export async function promptForRPath(
    log: vscode.LogOutputChannel,
    options: RInstallationPromptOptions = {}
): Promise<RInstallation | undefined> {
    const {
        forcePick = false,
        allowBrowse = true,
        persistSelection = false,
        title = 'R Installation',
        placeHolder = 'Select R installation to use',
        preselectBinPath
    } = options;

    const installations = await discoverRInstallations(log);

    if (installations.length === 0) {
        // No R found - offer to configure
        const actions: string[] = [];
        if (allowBrowse) {
            actions.push('Configure R Path');
        }
        actions.push('Open Settings', 'Cancel');

        const action = await vscode.window.showWarningMessage(
            'No R installation found on your system.',
            ...actions
        );

        if (action === 'Configure R Path') {
            const files = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                title: 'Select R Binary',
                filters: process.platform === 'win32'
                    ? { 'R Executable': ['exe'] }
                    : undefined,
                openLabel: 'Select R'
            });

            if (files && files.length > 0) {
                const rPath = files[0].fsPath;
                log.info(`User selected R path: ${rPath}`);

                // Validate the selected path
                const inst = await probeRInstallation(rPath, log);
                if (inst) {
                    if (persistSelection) {
                        // Save to settings - use WorkspaceFolder scope in remote
                        // to avoid syncing local paths via Settings Sync
                        const config = vscode.workspace.getConfiguration('ark');
                        const target = vscode.env.remoteName
                            ? vscode.ConfigurationTarget.WorkspaceFolder
                            : vscode.ConfigurationTarget.Global;
                        await config.update('r.path', rPath, target);
                        log.info(`Saved ark.r.path: ${rPath} (scope: ${vscode.env.remoteName ? 'WorkspaceFolder' : 'Global'})`);
                        if (vscode.env.remoteName) {
                            log.info(`Using WorkspaceFolder scope to prevent Settings Sync from sharing this path across machines`);
                        }
                    }
                    inst.current = true;
                    return inst;
                } else {
                    vscode.window.showErrorMessage(
                        `Selected file is not a valid R installation: ${rPath}`
                    );
                }
            }
        } else if (action === 'Open Settings') {
            await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'ark.r.path'
            );
        }

        return undefined;
    }

    if (installations.length === 1) {
        if (!forcePick) {
            return installations[0];
        }
    }

    // Helper to get source label
    const getSourceLabel = (inst: RInstallation): string => {
        switch (inst.source) {
            case 'configured': return 'Configured';
            case 'conda': return 'Conda';
            case 'path': return 'PATH';
            case 'system': return 'System';
            default: return '';
        }
    };

    // Helper to build label with conda env info
    const buildLabel = (inst: RInstallation): string => {
        return `$(symbol-misc) ${formatRuntimeName(inst)}`;
    };

    // Multiple R installations - let user choose (Python picker style)
    const items: RInstallationQuickPickItem[] = installations.map(inst => ({
        label: buildLabel(inst),
        description: getSourceLabel(inst),
        detail: inst.binpath,
        picked: preselectBinPath
            ? inst.binpath === preselectBinPath
            : inst.current,
        installation: inst
    }));

    if (allowBrowse) {
        items.push({
            label: 'Browse...',
            description: 'Select a different R binary',
            action: 'browse'
        });
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder,
        title,
        canPickMany: false
    });

    if (!selected) {
        return undefined;
    }

    if (selected.action === 'browse') {
        const files = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            title: 'Select R Binary',
            filters: process.platform === 'win32'
                ? { 'R Executable': ['exe'] }
                : undefined,
            openLabel: 'Select R'
        });

        if (files && files.length > 0) {
            const rPath = files[0].fsPath;
            log.info(`User selected R path: ${rPath}`);

            const inst = await probeRInstallation(rPath, log);
            if (inst) {
                if (persistSelection) {
                    const config = vscode.workspace.getConfiguration('ark');
                    const target = vscode.env.remoteName
                        ? vscode.ConfigurationTarget.WorkspaceFolder
                        : vscode.ConfigurationTarget.Global;
                    await config.update('r.path', rPath, target);
                    log.info(`Saved ark.r.path: ${rPath} (scope: ${vscode.env.remoteName ? 'WorkspaceFolder' : 'Global'})`);
                }
                inst.current = true;
                return inst;
            }

            vscode.window.showErrorMessage(
                `Selected file is not a valid R installation: ${rPath}`
            );
        }

        return undefined;
    }

    if (selected.installation && persistSelection) {
        const config = vscode.workspace.getConfiguration('ark');
        const target = vscode.env.remoteName
            ? vscode.ConfigurationTarget.WorkspaceFolder
            : vscode.ConfigurationTarget.Global;
        await config.update('r.path', selected.installation.binpath, target);
        log.info(`Saved ark.r.path: ${selected.installation.binpath} (scope: ${vscode.env.remoteName ? 'WorkspaceFolder' : 'Global'})`);
        selected.installation.current = true;
    }

    return selected.installation;
}

/**
 * Find R binary on PATH
 */
function findROnPath(): string | undefined {
    try {
        if (os.platform() === 'win32') {
            const result = execSync('where R', { encoding: 'utf8', timeout: 5000 });
            const lines = result.trim().split('\n');
            return lines[0]?.trim();
        } else {
            const result = execSync('which R', { encoding: 'utf8', timeout: 5000 });
            return result.trim();
        }
    } catch {
        return undefined;
    }
}

/**
 * Get R_HOME from an R binary
 */
function getRHome(rBinPath: string): string | undefined {
    try {
        const result = execSync(`"${rBinPath}" RHOME`, { encoding: 'utf8', timeout: 5000 });
        const rhome = result.trim();
        if (fs.existsSync(rhome)) {
            return rhome;
        }
    } catch {
        // Fallback: try to derive from binary path
        if (os.platform() === 'darwin') {
            // macOS: /Library/Frameworks/R.framework/Resources/bin/R -> .../Resources
            const match = rBinPath.match(/(.*)\/bin\/R$/);
            if (match && fs.existsSync(match[1])) {
                return match[1];
            }
        } else if (os.platform() === 'linux') {
            // Linux: /usr/lib/R/bin/R -> /usr/lib/R
            const match = rBinPath.match(/(.*)\/bin\/R$/);
            if (match && fs.existsSync(match[1])) {
                return match[1];
            }
        }
    }
    return undefined;
}

/**
 * Get R version from R binary
 */
function getRVersion(rBinPath: string): string | undefined {
    try {
        const result = execSync(`"${rBinPath}" --version 2>&1`, { encoding: 'utf8', timeout: 5000 });
        const match = result.match(/R version (\d+\.\d+\.\d+)/);
        return match?.[1];
    } catch {
        return undefined;
    }
}

/**
 * Infers Conda environment metadata from an R binary path.
 *
 * Returns undefined values when the path does not look like a Conda environment.
 */
export function inferCondaEnvironmentFromRBinary(rBinPath: string): {
    condaEnvPath?: string;
    envName?: string;
} {
    let condaEnvPath: string | undefined;

    if (os.platform() === 'win32') {
        const winMatch = rBinPath.match(/^(.*)\\Lib\\R\\bin\\(?:x64\\)?R\.exe$/i);
        if (winMatch) {
            condaEnvPath = winMatch[1];
        }
    } else {
        const condaMatch = rBinPath.match(/^(.+\/(?:envs|miniconda3|miniforge3|anaconda3)\/[^/]+)\/bin\/R$/);
        if (condaMatch) {
            condaEnvPath = condaMatch[1];
        }
    }

    if (!condaEnvPath) {
        return {};
    }

    return {
        condaEnvPath,
        envName: path.basename(condaEnvPath),
    };
}

/**
 * Probe an R installation to gather details
 */
async function probeRInstallation(
    rBinPath: string,
    log: vscode.LogOutputChannel
): Promise<RInstallation | undefined> {
    // Resolve symlinks
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

    const homepath = getRHome(realPath);
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

    // Try to determine architecture
    let arch: string | undefined;
    if (os.platform() === 'darwin') {
        try {
            const result = execSync(`file "${realPath}"`, { encoding: 'utf8' });
            if (result.includes('arm64')) {
                arch = 'aarch64';
            } else if (result.includes('x86_64')) {
                arch = 'x86_64';
            }
            log.debug(`  Architecture: ${arch || 'unknown'}`);
        } catch { }
    }
    const { condaEnvPath, envName } = inferCondaEnvironmentFromRBinary(realPath);
    if (condaEnvPath) {
        log.debug(`  Detected conda environment: ${condaEnvPath}`);
    }


    return {
        binpath: realPath,
        homepath,
        version,
        arch,
        current: false,
        condaEnvPath,
        envName,
        source: condaEnvPath ? 'conda' : 'system'
    };
}

/**
 * Get standard R installation locations based on platform
 */
function getStandardRLocations(): string[] {
    const locations: string[] = [];

    switch (os.platform()) {
        case 'darwin':
            // macOS Framework installation
            const frameworkBase = '/Library/Frameworks/R.framework/Versions';
            if (fs.existsSync(frameworkBase)) {
                try {
                    const versions = fs.readdirSync(frameworkBase)
                        .filter(v => !v.toLowerCase().includes('current'))
                        .map(v => path.join(frameworkBase, v, 'Resources', 'bin', 'R'))
                        .filter(p => fs.existsSync(p));
                    locations.push(...versions);
                } catch { }
            }

            // Homebrew
            locations.push('/opt/homebrew/bin/R');
            locations.push('/usr/local/bin/R');
            break;

        case 'linux':
            locations.push('/usr/bin/R');
            locations.push('/usr/local/bin/R');

            // rig installations
            const optR = '/opt/R';
            if (fs.existsSync(optR)) {
                try {
                    const versions = fs.readdirSync(optR)
                        .filter(v => !v.toLowerCase().includes('current'))
                        .map(v => path.join(optR, v, 'bin', 'R'))
                        .filter(p => fs.existsSync(p));
                    locations.push(...versions);
                } catch { }
            }
            break;

        case 'win32':
            // Common Windows R locations
            const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
            const rBase = path.join(programFiles, 'R');
            if (fs.existsSync(rBase)) {
                try {
                    const versions = fs.readdirSync(rBase)
                        .filter(v => v.startsWith('R-'))
                        .map(v => {
                            // Prefer bin/x64/R.exe if it exists
                            const x64Path = path.join(rBase, v, 'bin', 'x64', 'R.exe');
                            if (fs.existsSync(x64Path)) {
                                return x64Path;
                            }
                            return path.join(rBase, v, 'bin', 'R.exe');
                        })
                        .filter(p => fs.existsSync(p));
                    locations.push(...versions);
                } catch { }
            }
            break;
    }

    return locations.filter(p => fs.existsSync(p));
}
