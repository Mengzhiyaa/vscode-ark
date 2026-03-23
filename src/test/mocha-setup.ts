import * as vscode from 'vscode';
import * as testKit from './kit';

export let currentTestName: string | undefined;

export const mochaHooks = {
    async beforeAll() {
        if (process.env.CI) {
            await vscode.commands.executeCommand('_extensionTests.setLogLevel', 'trace');
        }

        // Match Ark settings naming; keep noise high on CI for easier debugging.
        await vscode.workspace.getConfiguration().update('ark.kernel.logLevel', 'trace', vscode.ConfigurationTarget.Global);
        await vscode.workspace.getConfiguration().update('kernelSupervisor.logLevel', 'trace', vscode.ConfigurationTarget.Global);

        await testKit.closeAllEditors();
    },

    beforeEach(this: Mocha.Context) {
        currentTestName = this.currentTest?.title;
    },

    afterEach() {
        currentTestName = undefined;
    },
};
