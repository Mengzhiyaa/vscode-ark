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

type WindowsKernelArch = 'arm64' | 'x64';

function prependLibraryPath(directory: string, existing?: string): string {
    return existing ? `${directory}${path.delimiter}${existing}` : directory;
}

export function getArkEnvironmentVariables(rHomePath: string): Record<string, string> {
    const env: Record<string, string> = {
        R_HOME: rHomePath,
    };

    if (process.platform === 'linux') {
        env.LD_LIBRARY_PATH = prependLibraryPath(path.join(rHomePath, 'lib'), process.env.LD_LIBRARY_PATH);
    }

    if (process.platform === 'darwin') {
        env.DYLD_LIBRARY_PATH = prependLibraryPath(path.join(rHomePath, 'lib'), process.env.DYLD_LIBRARY_PATH);
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
    const preferredWindowsArch = os.platform() === 'win32'
        ? normalizeWindowsArch(options?.rArch) ??
            sniffWindowsBinaryArchitecture(options?.rBinaryPath) ??
            deriveWindowsArch([options?.rBinaryPath, options?.rHomePath]) ??
            normalizeWindowsArch(process.arch) ?? 'x64'
        : undefined;

    if (preferredWindowsArch) {
        const candidate = path.join(context.extensionPath, 'resources', 'ark', `windows-${preferredWindowsArch}`, kernelName);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
        // Keep older, single-architecture bundles usable only when they match R.
        const legacy = path.join(context.extensionPath, 'resources', 'ark', kernelName);
        if (sniffWindowsBinaryArchitecture(legacy) === preferredWindowsArch) {
            return legacy;
        }
    }

    // Check the embedded kernel location (primary for production)
    const embeddedKernel = path.join(context.extensionPath, 'resources', 'ark', kernelName);
    if (!preferredWindowsArch && fs.existsSync(embeddedKernel)) {
        return embeddedKernel;
    }

    // Look for locally built Debug or Release kernels in adjacent ark repo
    // This is for developers who have positron/vscode-ark and ark directories side-by-side
    let devKernel: string | undefined;
    const extensionParent = path.dirname(context.extensionPath);
    const devDebugKernel = path.join(extensionParent, 'ark', 'target', 'debug', kernelName);
    const devReleaseKernel = path.join(extensionParent, 'ark', 'target', 'release', kernelName);

    const debugModified = !preferredWindowsArch || sniffWindowsBinaryArchitecture(devDebugKernel) === preferredWindowsArch
        ? safeStatMtime(devDebugKernel) : undefined;
    const releaseModified = !preferredWindowsArch || sniffWindowsBinaryArchitecture(devReleaseKernel) === preferredWindowsArch
        ? safeStatMtime(devReleaseKernel) : undefined;

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

function normalizeWindowsArch(value?: string): WindowsKernelArch | undefined {
    switch (value?.toLowerCase()) {
        case 'arm64':
        case 'aarch64':
            return 'arm64';
        case 'x64':
        case 'x86_64':
        case 'amd64':
            return 'x64';
        default:
            return undefined;
    }
}

function deriveWindowsArch(paths: Array<string | undefined>): WindowsKernelArch | undefined {
    for (const candidate of paths) {
        const normalized = candidate?.toLowerCase().replace(/\\/g, '/');
        if (!normalized) {
            continue;
        }
        if (/(^|\/)(arm64|aarch64)(\/|$)/.test(normalized) || /-(arm64|aarch64)/.test(normalized)) {
            return 'arm64';
        }
        if (/(^|\/)(x64|amd64)(\/|$)/.test(normalized)) {
            return 'x64';
        }
    }
    return undefined;
}

/** Read the PE machine field without launching R or depending on the host architecture. */
function sniffWindowsBinaryArchitecture(binaryPath?: string): WindowsKernelArch | undefined {
    if (!binaryPath) {
        return undefined;
    }
    try {
        const fd = fs.openSync(binaryPath, 'r');
        try {
            const header = Buffer.alloc(64);
            if (fs.readSync(fd, header, 0, header.length, 0) !== header.length || header.toString('ascii', 0, 2) !== 'MZ') {
                return undefined;
            }
            const peHeader = Buffer.alloc(6);
            if (fs.readSync(fd, peHeader, 0, peHeader.length, header.readUInt32LE(0x3c)) !== peHeader.length ||
                peHeader.readUInt32LE(0) !== 0x00004550) {
                return undefined;
            }
            switch (peHeader.readUInt16LE(4)) {
                case 0xaa64: return 'arm64';
                case 0x8664: return 'x64';
                default: return undefined;
            }
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        return undefined;
    }
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
