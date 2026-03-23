import * as assert from 'assert';
import { R_DOCUMENT_SELECTORS } from '../../runtime/lsp';

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
});
