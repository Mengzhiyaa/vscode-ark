import { existsSync } from 'fs';
import path from 'path';
import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'url';

const mocha = {
    ui: 'tdd',
    require: './out/test/mocha-setup.js',
    timeout: 60000,
};

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const configuredSupervisorPath = process.env.SUPERVISOR_DEV_EXTENSION_PATH;
const siblingSupervisorPath = configuredSupervisorPath
    ? path.resolve(repoRoot, configuredSupervisorPath)
    : path.resolve(repoRoot, '../vscode-supervisor');
const hasLocalSupervisorRepo = existsSync(path.join(siblingSupervisorPath, 'package.json'));
const localSupervisorOptions = hasLocalSupervisorRepo ? {
    extensionDevelopmentPath: configuredSupervisorPath
        ? ['.', configuredSupervisorPath]
        : ['.', '../vscode-supervisor'],
    skipExtensionDependencies: true,
} : {};

export default defineConfig([
    {
        label: 'all',
        files: 'out/test/**/*.test.js',
        mocha,
        ...localSupervisorOptions,
    },
    {
        label: 'unit',
        files: 'out/test/unit/**/*.test.js',
        mocha,
        ...localSupervisorOptions,
    },
]);
