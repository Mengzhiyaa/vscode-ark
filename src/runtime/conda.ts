import * as path from 'path';
import type { RInstallation } from './r-installation';

function looksLikeCondaCommand(executable: string): boolean {
    const basename = path.basename(executable).toLowerCase();
    return basename === 'conda' || basename === 'conda.exe' || basename === 'mamba' || basename === 'mamba.exe';
}

export function resolveCondaCommand(installation: RInstallation): string | undefined {
    const managerExecutable = installation.manager?.executable;
    if (managerExecutable && looksLikeCondaCommand(managerExecutable)) {
        return managerExecutable;
    }

    const condaExeFromEnv = installation.environmentVariables?.CONDA_EXE;
    if (condaExeFromEnv) {
        return condaExeFromEnv;
    }

    return undefined;
}
