import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as util from 'util';
import * as vscode from 'vscode';
import { exec } from 'child_process';

const execPromise = util.promisify(exec);

export interface CondaRBinary {
    envPath: string;
    rPath: string;
}

function getCondaEnvironmentsFromFile(log: vscode.LogOutputChannel): string[] {
    try {
        const environmentsFile = path.join(os.homedir(), '.conda', 'environments.txt');
        if (!fs.existsSync(environmentsFile)) {
            log.debug(`Conda environments.txt file not found at: ${environmentsFile}`);
            return [];
        }

        const content = fs.readFileSync(environmentsFile, 'utf-8');
        const envs = content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0 && fs.existsSync(line));

        log.info(`Found ${envs.length} Conda environment(s) from environments.txt`);
        return envs;
    } catch (error) {
        log.error(`Failed to read Conda environments.txt: ${error}`);
        return [];
    }
}

export async function getCondaEnvironments(
    log: vscode.LogOutputChannel
): Promise<string[]> {
    try {
        const { stdout } = await execPromise('conda env list --json');
        const envs = JSON.parse(stdout).envs as string[];
        log.info(`Found ${envs.length} Conda environment(s) using conda command`);
        return envs;
    } catch (error) {
        log.debug(`conda command not available, falling back to environments.txt: ${error}`);
        return getCondaEnvironmentsFromFile(log);
    }
}

export function getCondaRPaths(envPath: string): string[] {
    const paths: string[] = [];
    if (process.platform !== 'win32') {
        paths.push(path.join(envPath, 'bin', 'R'));
    } else {
        paths.push(path.join(envPath, 'Lib', 'R', 'bin', 'x64', 'R.exe'));
        paths.push(path.join(envPath, 'Lib', 'R', 'bin', 'R.exe'));
    }
    return paths;
}

export async function discoverCondaRBinaries(
    log: vscode.LogOutputChannel
): Promise<CondaRBinary[]> {
    const enabled = vscode.workspace.getConfiguration('ark').get<boolean>('r.condaDiscovery', true);
    if (!enabled) {
        return [];
    }

    const condaEnvs = await getCondaEnvironments(log);
    if (condaEnvs.length === 0) {
        log.info('No Conda environments found.');
        return [];
    }

    const binaries: CondaRBinary[] = [];
    for (const envPath of condaEnvs) {
        const rPaths = getCondaRPaths(envPath);
        for (const rPath of rPaths) {
            if (fs.existsSync(rPath)) {
                log.info(`Detected R in Conda environment: ${rPath}`);
                binaries.push({ envPath, rPath });
                break;
            }
        }
    }

    return binaries;
}
