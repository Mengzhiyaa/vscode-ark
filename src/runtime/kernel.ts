/**
 * ARK Kernel Path Resolution
 * 
 * Simplified version of positron-r's kernel.ts for finding the ARK binary.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Options that help locate the Ark kernel binary.
 */
interface KernelLookupOptions {
    rBinaryPath?: string;
    rHomePath?: string;
    rArch?: string;
}

export function getArkEnvironmentVariables(rHomePath: string): Record<string, string> {
    const env: Record<string, string> = {
        R_HOME: rHomePath,
    };

    if (process.platform === 'linux') {
        env.LD_LIBRARY_PATH = `${rHomePath}/lib`;
    }

    if (process.platform === 'darwin') {
        env.DYLD_LIBRARY_PATH = `${rHomePath}/lib`;
    }

    return env;
}

/**
 * Attempts to locate a copy of the Ark kernel. The kernel is searched for in the following
 * locations, in order:
 *
 * 1. The `ark.kernel.path` setting, if specified.
 * 2. The embedded kernel at resources/ark/ark (release builds).
 * 3. A locally built kernel in adjacent ark repo (development builds).
 *
 * @param context The extension context
 * @param options Additional hints for kernel resolution
 * @returns A path to the Ark kernel, or undefined if not found.
 */
export function getArkKernelPath(
    context: vscode.ExtensionContext,
    options?: KernelLookupOptions
): string | undefined {
    // First, check to see whether there is an override for the kernel path.
    const arkConfig = vscode.workspace.getConfiguration('ark');
    const kernelPath = arkConfig.get<string>('kernel.path');
    if (kernelPath && fs.existsSync(kernelPath)) {
        return kernelPath;
    }

    const kernelName = os.platform() === 'win32' ? 'ark.exe' : 'ark';

    // Check the embedded kernel location (primary for production)
    const embeddedKernel = path.join(context.extensionPath, 'resources', 'ark', kernelName);
    if (fs.existsSync(embeddedKernel)) {
        return embeddedKernel;
    }

    // Look for locally built Debug or Release kernels in adjacent ark repo
    // This is for developers who have positron/vscode-ark and ark directories side-by-side
    let devKernel: string | undefined;
    const extensionParent = path.dirname(path.dirname(context.extensionPath));
    const devDebugKernel = path.join(extensionParent, 'ark', 'target', 'debug', kernelName);
    const devReleaseKernel = path.join(extensionParent, 'ark', 'target', 'release', kernelName);

    const debugModified = safeStatMtime(devDebugKernel);
    const releaseModified = safeStatMtime(devReleaseKernel);

    if (debugModified) {
        devKernel = (releaseModified && releaseModified > debugModified)
            ? devReleaseKernel
            : devDebugKernel;
    } else if (releaseModified) {
        devKernel = devReleaseKernel;
    }

    if (devKernel) {
        return devKernel;
    }

    return undefined;
}

/**
 * Safely get the modification time of a file.
 */
function safeStatMtime(filePath: string): Date | undefined {
    try {
        return fs.statSync(filePath).mtime;
    } catch {
        return undefined;
    }
}
