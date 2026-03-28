import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as util from 'util';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import type { RBinary } from './provider';
import { ReasonDiscovered } from './r-installation';

const execPromise = util.promisify(exec);

function getCondaEnvironmentsFromFile(log: vscode.LogOutputChannel): string[] {
    try {
        const environmentsFile = path.join(os.homedir(), '.conda', 'environments.txt');
        if (!fs.existsSync(environmentsFile)) {
            log.debug(`Conda environments.txt file not found at: ${environmentsFile}`);
            return [];
        }

        const content = fs.readFileSync(environmentsFile, 'utf-8');
        const environments = content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0 && fs.existsSync(line));

        log.info(`Found ${environments.length} Conda environment(s) from environments.txt`);
        return environments;
    } catch (error) {
        log.error(`Failed to read Conda environments.txt: ${error}`);
        return [];
    }
}

export async function getCondaEnvironments(
    log: vscode.LogOutputChannel,
): Promise<string[]> {
    try {
        const { stdout } = await execPromise('conda env list --json');
        const environments = JSON.parse(stdout).envs as string[];
        log.info(`Found ${environments.length} Conda environment(s) using conda command`);
        return environments;
    } catch (error) {
        log.debug(`conda command not available, falling back to environments.txt: ${error}`);
        return getCondaEnvironmentsFromFile(log);
    }
}

export function getCondaRPaths(environmentPath: string): string[] {
    if (process.platform !== 'win32') {
        return [path.join(environmentPath, 'bin', 'R')];
    }

    return [
        path.join(environmentPath, 'Lib', 'R', 'bin', 'x64', 'R.exe'),
        path.join(environmentPath, 'Lib', 'R', 'bin', 'R.exe'),
    ];
}

export async function discoverCondaBinaries(
    log: vscode.LogOutputChannel,
): Promise<RBinary[]> {
    const enabled = vscode.workspace.getConfiguration('ark').get<boolean>('r.condaDiscovery', true);
    if (!enabled) {
        return [];
    }

    const condaEnvironments = await getCondaEnvironments(log);
    if (condaEnvironments.length === 0) {
        log.info('No Conda environments found.');
        return [];
    }

    const binaries: RBinary[] = [];
    for (const environmentPath of condaEnvironments) {
        const rPaths = getCondaRPaths(environmentPath);
        for (const rPath of rPaths) {
            if (!fs.existsSync(rPath)) {
                continue;
            }

            log.info(`Detected R in Conda environment: ${rPath}`);
            binaries.push({
                path: rPath,
                reasons: [ReasonDiscovered.CONDA],
                packagerMetadata: { kind: 'conda', environmentPath },
            });
            break;
        }
    }

    return binaries;
}

export function findCondaExe(environmentPath: string): string | undefined {
    if (process.platform !== 'win32') {
        return undefined;
    }

    const pathParts = environmentPath.split(path.sep);
    const envsIndex = pathParts.indexOf('envs');

    const condaRoot = envsIndex !== -1
        ? pathParts.slice(0, envsIndex).join(path.sep)
        : path.dirname(environmentPath);

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
