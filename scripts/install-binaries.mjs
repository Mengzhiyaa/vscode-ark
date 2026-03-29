import fs from 'fs';
import http from 'http';
import https from 'https';
import os from 'os';
import path from 'path';
import process from 'process';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function parseArgs() {
    let retries = 1;
    let platform;

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--retry') {
            retries = Number.parseInt(args[index + 1] ?? '1', 10) || 1;
            index += 1;
        } else if (arg === '--platform') {
            platform = args[index + 1];
            index += 1;
        }
    }

    return { retries, platform };
}

function normalizeOs(osName) {
    switch (osName) {
        case 'darwin':
        case 'macos':
            return 'darwin';
        case 'win32':
        case 'windows':
            return 'windows';
        default:
            return osName;
    }
}

function normalizeArch(arch) {
    switch (arch) {
        case 'amd64':
        case 'x86_64':
            return 'x64';
        case 'aarch64':
            return 'arm64';
        default:
            return arch;
    }
}

function detectPlatform(explicitPlatform) {
    if (explicitPlatform) {
        return explicitPlatform;
    }

    const targetOs = process.env.TARGET_OS;
    const targetArch = process.env.TARGET_ARCH;
    if (targetOs && targetArch) {
        return `${normalizeOs(targetOs)}-${normalizeArch(targetArch)}`;
    }

    return `${normalizeOs(os.platform())}-${normalizeArch(os.arch())}`;
}

function readBinaryVersions() {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const deps = pkg?.positron?.binaryDependencies;
    if (!deps || typeof deps !== 'object') {
        throw new Error('Missing positron.binaryDependencies in package.json');
    }
    return deps;
}

// Binary configuration: repo, naming conventions, etc.
const BINARY_CONFIGS = {
    ark: {
        repo: 'posit-dev/ark',
        binaryName: (platform) => platform.startsWith('windows') ? 'ark.exe' : 'ark',
        archivePattern: (version, platform) => `ark-${version}-${platform}.zip`,
        archiveType: 'zip',
        installDir: 'resources/ark',
        platformOverride: (platform) => platform.startsWith('darwin') ? 'darwin-universal' : platform,
    },
    ret: {
        repo: 'Mengzhiyaa/r-environment-tools',
        binaryName: (platform) => platform.startsWith('windows') ? 'ret.exe' : 'ret',
        archivePattern: (version, platform) => `ret-${version}-${platform}.tar.gz`,
        archiveType: 'tar.gz',
        installDir: 'resources/ret',
        platformOverride: undefined,
    },
};

function download(url, destination) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(destination);

        const request = (currentUrl, redirectCount) => {
            if (redirectCount > 5) {
                reject(new Error(`Too many redirects for ${url}`));
                return;
            }

            const protocol = currentUrl.startsWith('https') ? https : http;
            protocol.get(currentUrl, (response) => {
                if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    response.resume();
                    request(response.headers.location, redirectCount + 1);
                    return;
                }

                if (response.statusCode !== 200) {
                    response.resume();
                    reject(new Error(`Download failed for ${currentUrl}: HTTP ${response.statusCode}`));
                    return;
                }

                response.pipe(output);
                output.on('finish', () => {
                    output.close();
                    resolve();
                });
            }).on('error', reject);
        };

        request(url, 0);
    });
}

function extractArchive(archivePath, archiveType, destination) {
    fs.mkdirSync(destination, { recursive: true });

    switch (archiveType) {
        case 'zip':
            if (process.platform === 'win32') {
                execSync(
                    `powershell -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destination}' -Force"`,
                    { stdio: 'pipe' },
                );
                return;
            }

            execSync(`unzip -o -q "${archivePath}" -d "${destination}"`, { stdio: 'pipe' });
            return;
        case 'tar.gz':
            execSync(`tar -xzf "${archivePath}" -C "${destination}"`, { stdio: 'pipe' });
            return;
        default:
            throw new Error(`Unsupported archive type: ${archiveType}`);
    }
}

function findFile(rootDir, filename) {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = path.join(rootDir, entry.name);
        if (entry.isFile() && entry.name === filename) {
            return entryPath;
        }

        if (entry.isDirectory()) {
            const nested = findFile(entryPath, filename);
            if (nested) {
                return nested;
            }
        }
    }

    return undefined;
}

async function installBinary(name, config, version, platform) {
    const effectivePlatform = config.platformOverride ? config.platformOverride(platform) : platform;
    const executableName = config.binaryName(platform);
    const archiveFile = config.archivePattern(version, effectivePlatform);
    const downloadUrl = `https://github.com/${config.repo}/releases/download/${version}/${archiveFile}`;
    const installDir = path.join(repoRoot, config.installDir);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `vscode-ark-${name}-`));

    try {
        const archivePath = path.join(tempDir, archiveFile);
        const extractDir = path.join(tempDir, 'extract');

        console.log(`Installing ${name} ${version} for ${platform}`);
        console.log(`Downloading ${downloadUrl}`);
        await download(downloadUrl, archivePath);
        extractArchive(archivePath, config.archiveType, extractDir);

        const extractedBinary = findFile(extractDir, executableName);
        if (!extractedBinary) {
            throw new Error(`Could not find ${executableName} in extracted archive`);
        }

        fs.mkdirSync(installDir, { recursive: true });
        const destination = path.join(installDir, executableName);
        fs.copyFileSync(extractedBinary, destination);

        if (process.platform !== 'win32') {
            fs.chmodSync(destination, 0o755);
        }

        console.log(`Installed ${destination}`);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

async function main() {
    const { retries, platform: explicitPlatform } = parseArgs();
    const platform = detectPlatform(explicitPlatform);
    const versions = readBinaryVersions();

    for (const [name, version] of Object.entries(versions)) {
        const config = BINARY_CONFIGS[name];
        if (!config) {
            console.warn(`Unknown binary '${name}' in binaryDependencies, skipping`);
            continue;
        }

        let lastError;
        for (let attempt = 1; attempt <= retries; attempt += 1) {
            try {
                await installBinary(name, config, version, platform);
                lastError = undefined;
                break;
            } catch (error) {
                lastError = error;
                console.error(`${name} attempt ${attempt}/${retries} failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        if (lastError) {
            throw lastError;
        }
    }
}

await main();
