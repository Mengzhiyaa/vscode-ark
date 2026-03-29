import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const sourceRootArg = args.find((arg) => !arg.startsWith('--'));
const sourceRepoRoot = path.resolve(
    repoRoot,
    sourceRootArg ?? process.env.RET_REPO_PATH ?? '../../../python-environment-tools/r-environment-tools',
);

const targetDir = path.join(repoRoot, 'src', 'generated', 'ret-protocol');

function generateProtocol(outputDir) {
    execFileSync(
        'cargo',
        ['run', '-q', '-p', 'ret-core', '--example', 'export-protocol-ts', '--', outputDir],
        {
            cwd: sourceRepoRoot,
            stdio: 'inherit',
        },
    );
}

function listFiles(dir) {
    if (!fs.existsSync(dir)) {
        return [];
    }

    return fs.readdirSync(dir)
        .filter((entry) => fs.statSync(path.join(dir, entry)).isFile())
        .sort();
}

function readNormalized(filePath) {
    return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function compareDirectories(leftDir, rightDir) {
    const leftFiles = listFiles(leftDir);
    const rightFiles = listFiles(rightDir);

    if (leftFiles.length !== rightFiles.length) {
        return false;
    }

    for (const [index, fileName] of leftFiles.entries()) {
        if (fileName !== rightFiles[index]) {
            return false;
        }

        if (
            readNormalized(path.join(leftDir, fileName)) !==
            readNormalized(path.join(rightDir, fileName))
        ) {
            return false;
        }
    }

    return true;
}

if (!fs.existsSync(sourceRepoRoot)) {
    throw new Error(`RET repository not found: ${sourceRepoRoot}`);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ret-protocol-'));
const generatedDir = path.join(tempRoot, 'ret-protocol');

try {
    fs.mkdirSync(generatedDir, { recursive: true });
    generateProtocol(generatedDir);

    if (checkOnly) {
        if (!compareDirectories(generatedDir, targetDir)) {
            throw new Error(
                [
                    'src/generated/ret-protocol is out of sync with RET protocol types.',
                    `Source: ${sourceRepoRoot}`,
                    `Target: ${targetDir}`,
                    'Run `npm run sync:ret-protocol -- ../../../python-environment-tools/r-environment-tools` to update it.',
                ].join('\n'),
            );
        }

        console.log(`RET protocol types are in sync: ${targetDir}`);
        process.exit(0);
    }

    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.cpSync(generatedDir, targetDir, { recursive: true });
    console.log(`Copied generated RET protocol types -> ${targetDir}`);
} finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
}
