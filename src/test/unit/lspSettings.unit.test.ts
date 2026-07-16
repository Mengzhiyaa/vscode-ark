import * as assert from 'assert';
import { Trace } from 'vscode-languageclient/node';
import {
    DEFAULT_ARK_LSP_SETTINGS,
    mapArkLspConfiguration,
    mergeArkLspSettings,
    toLanguageClientTrace,
} from '../../runtime/lsp-settings';

suite('[Unit] Ark LSP settings', () => {
    test('uses Positron-compatible defaults', () => {
        assert.deepStrictEqual(mergeArkLspSettings({}), DEFAULT_ARK_LSP_SETTINGS);
    });

    test('prefers canonical Ark values over compatibility values', () => {
        const settings = mergeArkLspSettings(
            {
                diagnosticsEnable: false,
                includeAssignmentsInBlocks: true,
                includeCommentSections: true,
                traceServer: 'verbose',
            },
            {
                diagnosticsEnable: true,
                includeAssignmentsInBlocks: false,
                includeCommentSections: false,
                traceServer: 'messages',
            },
        );

        assert.deepStrictEqual(settings, {
            diagnostics: { enable: false },
            symbols: { includeAssignmentsInBlocks: true },
            workspaceSymbols: { includeCommentSections: true },
            trace: { server: 'verbose' },
        });
    });

    test('uses explicit compatibility values when Ark values are absent', () => {
        assert.deepStrictEqual(
            mergeArkLspSettings({}, {
                diagnosticsEnable: false,
                includeAssignmentsInBlocks: true,
                includeCommentSections: true,
                traceServer: 'messages',
            }),
            {
                diagnostics: { enable: false },
                symbols: { includeAssignmentsInBlocks: true },
                workspaceSymbols: { includeCommentSections: true },
                trace: { server: 'messages' },
            },
        );
    });

    test('maps Ark values onto positron.r configuration requests', () => {
        const settings = mergeArkLspSettings({
            diagnosticsEnable: false,
            includeAssignmentsInBlocks: true,
            includeCommentSections: true,
            traceServer: 'messages',
        });

        assert.strictEqual(
            mapArkLspConfiguration('positron.r.diagnostics.enable', true, settings),
            false,
        );
        assert.deepStrictEqual(
            mapArkLspConfiguration('positron.r.symbols', { existing: 'value' }, settings),
            { existing: 'value', includeAssignmentsInBlocks: true },
        );
        assert.deepStrictEqual(
            mapArkLspConfiguration('positron.r', { pipe: 'native' }, settings),
            {
                pipe: 'native',
                diagnostics: { enable: false },
                symbols: { includeAssignmentsInBlocks: true },
                workspaceSymbols: { includeCommentSections: true },
                trace: { server: 'messages' },
            },
        );
    });

    test('leaves unrelated and unknown configuration requests unchanged', () => {
        const settings = mergeArkLspSettings({});
        const fallback = { value: 1 };

        assert.strictEqual(
            mapArkLspConfiguration('editor.formatOnSave', fallback, settings),
            fallback,
        );
        assert.strictEqual(
            mapArkLspConfiguration('positron.r.unknown', fallback, settings),
            fallback,
        );
    });

    test('maps trace names to LanguageClient trace levels', () => {
        assert.strictEqual(toLanguageClientTrace('off'), Trace.Off);
        assert.strictEqual(toLanguageClientTrace('messages'), Trace.Messages);
        assert.strictEqual(toLanguageClientTrace('verbose'), Trace.Verbose);
    });
});
