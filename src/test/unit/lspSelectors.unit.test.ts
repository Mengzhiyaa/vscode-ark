import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    R_DOCUMENT_SELECTORS,
    getDocumentSelectorForSession,
    shouldHandleLspDiagnostics,
    shouldProvideCompletionForDocument,
} from '../../runtime/lsp';

suite('[Unit] Ark LSP selectors', () => {
    test('cover extension-contributed R file types used in the editor', () => {
        const patterns = R_DOCUMENT_SELECTORS
            .filter((selector): selector is { pattern: string } =>
                typeof selector === 'object' &&
                selector !== null &&
                'pattern' in selector &&
                typeof selector.pattern === 'string')
            .map(selector => selector.pattern);
        const schemes = R_DOCUMENT_SELECTORS
            .filter((selector): selector is { scheme: string } =>
                typeof selector === 'object' &&
                selector !== null &&
                'scheme' in selector &&
                typeof selector.scheme === 'string')
            .map(selector => selector.scheme);

        assert.ok(patterns.includes('**/*.rt'));
        assert.ok(patterns.includes('**/*.rhistory'));
        assert.ok(schemes.includes('assistant-code-confirmation-widget'));
    });

    test('builds notebook-scoped document selectors like Positron', () => {
        const notebookUri = vscode.Uri.parse('file:///workspace/notebook.qmd');
        const selector = getDocumentSelectorForSession(notebookUri);
        const selectorEntries = Array.isArray(selector) ? selector : [selector];

        assert.ok(selectorEntries.some((entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            'pattern' in entry &&
            entry.pattern === notebookUri.fsPath,
        ));
        assert.ok(selectorEntries.some((entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            'pattern' in entry &&
            entry.pattern === '**/.vdoc.*.{r,R}',
        ));
        assert.ok(selectorEntries.some((entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            'scheme' in entry &&
            entry.scheme === 'inmemory',
        ));
    });

    test('filters diagnostics for assistant widgets and quarto vdocs', () => {
        assert.strictEqual(
            shouldHandleLspDiagnostics(vscode.Uri.parse('assistant-code-confirmation-widget://session/input.R')),
            false,
        );
        assert.strictEqual(
            shouldHandleLspDiagnostics(vscode.Uri.parse('file:///workspace/.vdoc.11111111-2222-3333-4444-555555555555.r')),
            false,
        );
        assert.strictEqual(
            shouldHandleLspDiagnostics(vscode.Uri.parse('file:///workspace/script.R')),
            true,
        );
    });

    test('filters completion ownership between console and notebook sessions', () => {
        const notebookUri = vscode.Uri.parse('file:///workspace/notebook.qmd');
        const vdocUri = vscode.Uri.parse('file:///workspace/.vdoc.11111111-2222-3333-4444-555555555555.r');
        const consoleInputUri = vscode.Uri.from({ scheme: 'inmemory', path: '/console/input.R' });
        const notebookReplUri = vscode.Uri.from({ scheme: 'inmemory', path: '/notebook-repl-r-session/input.R' });

        assert.strictEqual(shouldProvideCompletionForDocument(vdocUri), false);
        assert.strictEqual(shouldProvideCompletionForDocument(consoleInputUri), true);
        assert.strictEqual(shouldProvideCompletionForDocument(notebookReplUri), false);

        assert.strictEqual(shouldProvideCompletionForDocument(consoleInputUri, notebookUri), false);
        assert.strictEqual(shouldProvideCompletionForDocument(notebookReplUri, notebookUri), true);
    });
});
