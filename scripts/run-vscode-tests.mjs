import { spawnSync } from 'child_process';
import process from 'process';

function hasHeadlessXvfbSupport() {
    if (process.platform !== 'linux' || process.env.DISPLAY) {
        return false;
    }

    const probe = spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' });
    return !probe.error && probe.status === 0;
}

const cliArgs = process.argv.slice(2);
const command = hasHeadlessXvfbSupport() ? 'xvfb-run' : 'vscode-test';
const commandArgs = command === 'xvfb-run'
    ? ['-a', 'vscode-test', ...cliArgs]
    : cliArgs;

const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    env: process.env,
});

if (result.error) {
    throw result.error;
}

process.exit(result.status ?? 1);
