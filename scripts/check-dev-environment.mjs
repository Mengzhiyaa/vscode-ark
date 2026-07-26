import fs from 'fs';
import path from 'path';
import process from 'process';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const supervisorRoot = path.resolve(repoRoot, '../vscode-supervisor');
const executableSuffix = process.platform === 'win32' ? '.exe' : '';

const failures = [];
const versions = [];

function requirePath(targetPath, recoveryCommand) {
    if (fs.existsSync(targetPath)) {
        return;
    }

    failures.push(`${targetPath} is missing. ${recoveryCommand}`);
}

function checkBinary(label, binaryPath, recoveryCommand) {
    if (!fs.existsSync(binaryPath)) {
        failures.push(`${label} binary is missing: ${binaryPath}. ${recoveryCommand}`);
        return;
    }

    if (process.platform !== 'win32') {
        try {
            fs.accessSync(binaryPath, fs.constants.X_OK);
        } catch {
            failures.push(`${label} binary is not executable: ${binaryPath}. ${recoveryCommand}`);
            return;
        }
    }

    const result = spawnSync(binaryPath, ['--version'], {
        encoding: 'utf8',
        timeout: 10000,
    });

    if (result.error || result.status !== 0) {
        const reason = result.error?.message
            ?? result.stderr?.trim()
            ?? `process exited with code ${result.status}`;
        failures.push(
            `${label} binary cannot run on ${process.platform}-${process.arch}: `
            + `${binaryPath}. ${reason}. ${recoveryCommand}`,
        );
        return;
    }

    versions.push(`${label}: ${result.stdout.trim() || result.stderr.trim() || binaryPath}`);
}

requirePath(
    path.join(supervisorRoot, 'package.json'),
    'Set SUPERVISOR_DEV_EXTENSION_PATH to a local vscode-supervisor checkout.',
);
requirePath(
    path.join(repoRoot, 'node_modules'),
    `Run \`npm install\` in ${repoRoot}.`,
);
requirePath(
    path.join(repoRoot, 'webview', 'node_modules'),
    `Run \`npm install\` in ${repoRoot}.`,
);
requirePath(
    path.join(supervisorRoot, 'node_modules'),
    `Run \`npm install\` in ${supervisorRoot}.`,
);
requirePath(
    path.join(supervisorRoot, 'webview', 'node_modules'),
    `Run \`npm install\` in ${supervisorRoot}.`,
);

checkBinary(
    'Ark',
    path.join(repoRoot, 'resources', 'ark', `ark${executableSuffix}`),
    `Run \`npm run install:binaries\` in ${repoRoot}.`,
);
checkBinary(
    'RET',
    path.join(repoRoot, 'resources', 'ret', `ret${executableSuffix}`),
    `Run \`npm run install:binaries\` in ${repoRoot}.`,
);
checkBinary(
    'Kallichore',
    path.join(supervisorRoot, 'resources', 'kallichore', `kcserver${executableSuffix}`),
    `Run \`npm run install:binaries\` in ${supervisorRoot}.`,
);

if (failures.length > 0) {
    throw new Error([
        'The Ark extension development environment is not ready:',
        ...failures.map(failure => `- ${failure}`),
    ].join('\n'));
}

console.log([
    `Ark development environment is ready for ${process.platform}-${process.arch}.`,
    `Supervisor: ${supervisorRoot}`,
    ...versions,
].join('\n'));
