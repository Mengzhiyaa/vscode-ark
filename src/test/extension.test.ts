import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as testKit from './kit';

suite('Extension Test Suite', () => {
    test('Extension is present', () => {
        const extension = vscode.extensions.getExtension('ark.vscode-ark');
        assert.ok(extension, 'Expected extension to be registered');
    });

    test('Local supervisor development dependency is present', () => {
        const extension = vscode.extensions.getExtension('ark.vscode-supervisor');
        assert.ok(extension, 'Expected local supervisor extension to be registered for tests');
    });

    test('Test kit temp dir cleanup', async () => {
        await testKit.withDisposables(async disposables => {
            const [dir, disposable] = testKit.makeTempDir('ark-test');
            disposables.push(disposable);
            assert.ok(fs.existsSync(dir), 'Expected temp directory to exist');
        });
    });
});
