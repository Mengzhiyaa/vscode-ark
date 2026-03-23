import * as assert from 'assert';
import * as vscode from 'vscode';
import { delay } from './kit-util';
import { normalizeUri } from './kit';

/**
 * Waits for the given predicate to succeed (not throw an assertion error) within the timeout.
 * Retries on assertion errors, throws immediately on other errors.
 */
export async function pollForSuccess(
    predicate: () => void | Promise<void>,
    intervalMs = 10,
    timeoutMs = 60000,
): Promise<void> {
    const start = Date.now();

    while (Date.now() - start <= timeoutMs) {
        try {
            return await predicate();
        } catch (err) {
            if (!(err instanceof assert.AssertionError)) {
                throw err;
            }
        }

        await delay(intervalMs);
    }

    // One last attempt, letting any assertion errors escape
    return await predicate();
}

/**
 * Asserts that the currently active text editor matches the given URI and its
 * contents match the provided regex string. Retries until success or timeout.
 */
export async function assertSelectedEditor(uri: vscode.Uri, text: string) {
    await pollForSuccess(() => {
        const editor = vscode.window.activeTextEditor;
        const expectedPath = normalizeUri(uri);
        const actualPath = editor ? normalizeUri(editor.document.uri) : undefined;

        if (!editor || actualPath !== expectedPath) {
            assert.fail(`Expected active editor for ${expectedPath}, but got ${actualPath ?? 'undefined'}`);
        }

        assert.match(
            editor.document.getText(),
            new RegExp(text),
            `Unexpected editor contents for ${uri.fsPath}:\n${editor.document.getText()}\n\nExpected:\n${text}`
        );
    });
}
