import fs from 'fs';
import crypto from 'crypto';
import http from 'http';
import https from 'https';
import os from 'os';
import path from 'path';
import process from 'process';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const packageJsonPath = path.join(repoRoot, 'package.json');
const ARK_RELEASES_API = 'https://api.github.com/repos/posit-dev/positron-ark/releases?per_page=100';
const ARK_CHECKSUM_PLATFORMS = [
    'darwin-universal',
    'linux-arm64',
    'linux-x64',
    'windows-arm64',
    'windows-x64',
];

function parseArgs() {
    let latestArk = false;
    let retries = 1;
    let platform;

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--latest-ark') {
            latestArk = true;
        } else if (arg === '--retry') {
            retries = Number.parseInt(args[index + 1] ?? '1', 10) || 1;
            index += 1;
        } else if (arg === '--platform') {
            platform = args[index + 1];
            index += 1;
        }
    }

    return { latestArk, retries, platform };
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

function readPackageManifest() {
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

function readBinaryManifest(pkg = readPackageManifest()) {
    const deps = pkg?.positron?.binaryDependencies;
    if (!deps || typeof deps !== 'object') {
        throw new Error('Missing positron.binaryDependencies in package.json');
    }
    return {
        versions: deps,
        checksums: pkg?.positron?.binaryChecksums ?? {},
    };
}

function updateArkManifest(pkg, version, checksums) {
    if (!pkg?.positron?.binaryDependencies || !pkg?.positron?.binaryChecksums) {
        throw new Error('Missing positron binary metadata in package.json');
    }

    pkg.positron.binaryDependencies.ark = version;
    pkg.positron.binaryChecksums.ark = checksums;
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`Updated package.json to Ark ${version}`);
}

function verifyChecksum(filePath, expectedDigest) {
    if (!expectedDigest) {
        return;
    }

    const [algorithm, expected] = expectedDigest.split(':', 2);
    if (algorithm !== 'sha256' || !expected) {
        throw new Error(`Unsupported checksum '${expectedDigest}' for ${path.basename(filePath)}`);
    }

    const actual = crypto.createHash(algorithm).update(fs.readFileSync(filePath)).digest('hex');
    if (actual !== expected.toLowerCase()) {
        throw new Error(
            `Checksum mismatch for ${path.basename(filePath)}: expected ${expected}, got ${actual}`,
        );
    }

    console.log(`Verified ${algorithm} checksum for ${path.basename(filePath)}`);
}

// Binary configuration: repo, naming conventions, etc.
const BINARY_CONFIGS = {
    ark: {
        repo: 'posit-dev/positron-ark',
        binaryName: (platform) => platform.startsWith('windows') ? 'ark.exe' : 'ark',
        archivePattern: (version, platform) => {
            const assetVersion = version.replace(/^ark-/, '');
            return `ark-${assetVersion}-${platform}.zip`;
        },
        archiveType: 'zip',
        installDir: 'resources/ark',
        platformOverride: (platform) => platform.startsWith('darwin') ? 'darwin-universal' : platform,
    },
    ret: {
        repo: 'Mengzhiyaa/r-environment-tools',
        binaryName: (platform) => platform.startsWith('windows') ? 'ret.exe' : 'ret',
        staleBinaryNames: (platform) => platform.startsWith('windows') ? ['ret'] : ['ret.exe'],
        archivePattern: (version, platform) => `ret-${version}-${platform}.tar.gz`,
        archiveType: 'tar.gz',
        installDir: 'resources/ret',
        platformOverride: undefined,
    },
};

function requestJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': 'vscode-ark-binary-installer',
                'X-GitHub-Api-Version': '2022-11-28',
            },
        }, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => {
                body += chunk;
            });
            response.on('end', () => {
                if (response.statusCode !== 200) {
                    reject(new Error(
                        `GitHub releases request failed: HTTP ${response.statusCode}: ${body.slice(0, 200)}`,
                    ));
                    return;
                }

                try {
                    resolve({
                        body: JSON.parse(body),
                        link: response.headers.link,
                    });
                } catch (error) {
                    reject(new Error(
                        `Invalid response from GitHub releases API: ${error instanceof Error ? error.message : String(error)}`,
                    ));
                }
            });
        }).on('error', reject);
    });
}

function nextPageUrl(linkHeader) {
    if (!linkHeader) {
        return undefined;
    }

    for (const part of linkHeader.split(',')) {
        const match = part.trim().match(/^<([^>]+)>;\s*rel="([^"]+)"$/);
        if (match?.[2] === 'next') {
            return match[1];
        }
    }

    return undefined;
}

function arkReleaseChecksums(release) {
    const assets = new Map(
        release.assets.map((asset) => [asset.name, asset]),
    );
    const checksums = {};

    for (const platform of ARK_CHECKSUM_PLATFORMS) {
        const archiveName = BINARY_CONFIGS.ark.archivePattern(release.tag_name, platform);
        const asset = assets.get(archiveName);
        if (!asset || typeof asset.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(asset.digest)) {
            return undefined;
        }
        checksums[platform] = asset.digest.toLowerCase();
    }

    return checksums;
}

function parseArkReleaseVersion(tagName) {
    const match = tagName.match(
        /^ark-(\d+)\.(\d+)\.(\d+)-(\d+)(?:-[0-9a-f]+)?$/i,
    );
    if (!match) {
        return undefined;
    }

    return match.slice(1).map((part) => Number.parseInt(part, 10));
}

function compareArkReleaseVersions(left, right) {
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
            return right[index] - left[index];
        }
    }
    return 0;
}

async function resolveLatestArkRelease() {
    const releases = [];
    let nextUrl = ARK_RELEASES_API;

    while (nextUrl) {
        const response = await requestJson(nextUrl);
        if (!Array.isArray(response.body)) {
            throw new Error('GitHub releases API returned an unexpected response');
        }
        releases.push(...response.body);
        nextUrl = nextPageUrl(response.link);
    }

    const candidates = releases
        .filter((release) =>
            !release.draft &&
            typeof release.tag_name === 'string' &&
            typeof release.published_at === 'string' &&
            Array.isArray(release.assets)
        )
        .map((release) => ({
            release,
            checksums: arkReleaseChecksums(release),
            version: parseArkReleaseVersion(release.tag_name),
        }))
        .filter((candidate) => candidate.checksums && candidate.version)
        .sort((left, right) => {
            const versionOrder = compareArkReleaseVersions(left.version, right.version);
            return versionOrder || Date.parse(right.release.published_at) - Date.parse(left.release.published_at);
        });

    if (candidates.length === 0) {
        throw new Error('No published Ark release with complete checksummed assets was found');
    }

    const latest = candidates[0];
    console.log(
        `Latest Ark release is ${latest.release.tag_name} (published ${latest.release.published_at})`,
    );
    return {
        version: latest.release.tag_name,
        checksums: latest.checksums,
    };
}

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

async function installBinary(name, config, version, platform, checksums) {
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
        verifyChecksum(archivePath, checksums?.[name]?.[effectivePlatform]);
        extractArchive(archivePath, config.archiveType, extractDir);

        const extractedBinary = findFile(extractDir, executableName);
        if (!extractedBinary) {
            throw new Error(`Could not find ${executableName} in extracted archive`);
        }

        fs.mkdirSync(installDir, { recursive: true });
        const destination = path.join(installDir, executableName);
        const stagedDestination = path.join(
            installDir,
            `.${executableName}.${process.pid}.tmp`,
        );

        try {
            fs.copyFileSync(extractedBinary, stagedDestination);
            if (process.platform !== 'win32') {
                fs.chmodSync(stagedDestination, 0o755);
            }

            if (process.platform === 'win32') {
                fs.rmSync(destination, { force: true });
            }
            fs.renameSync(stagedDestination, destination);

            for (const staleBinaryName of config.staleBinaryNames?.(platform) ?? []) {
                fs.rmSync(path.join(installDir, staleBinaryName), { force: true });
            }
        } finally {
            fs.rmSync(stagedDestination, { force: true });
        }

        console.log(`Installed ${destination}`);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

async function installWithRetries(name, config, version, platform, checksums, retries) {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            await installBinary(name, config, version, platform, checksums);
            return;
        } catch (error) {
            lastError = error;
            console.error(`${name} attempt ${attempt}/${retries} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    throw lastError;
}

async function main() {
    const { latestArk, retries, platform: explicitPlatform } = parseArgs();
    const platform = detectPlatform(explicitPlatform);
    const pkg = readPackageManifest();
    const { versions, checksums } = readBinaryManifest(pkg);

    if (latestArk) {
        const latest = await resolveLatestArkRelease();
        await installWithRetries(
            'ark',
            BINARY_CONFIGS.ark,
            latest.version,
            platform,
            { ark: latest.checksums },
            retries,
        );
        updateArkManifest(pkg, latest.version, latest.checksums);
        return;
    }

    for (const [name, version] of Object.entries(versions)) {
        const config = BINARY_CONFIGS[name];
        if (!config) {
            console.warn(`Unknown binary '${name}' in binaryDependencies, skipping`);
            continue;
        }

        await installWithRetries(name, config, version, platform, checksums, retries);
    }
}

await main();
