import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

type GrammarPattern = {
    include?: string;
};

type GrammarRule = {
    match?: string;
    captures?: Record<string, { name?: string }>;
    patterns?: GrammarPattern[];
};

type RGrammar = {
    repository?: Record<string, GrammarRule>;
};

function readRGrammar(): RGrammar {
    const repoRoot = path.resolve(__dirname, '../../..');
    const grammarPath = path.join(
        repoRoot,
        'syntaxes',
        'r.tmGrammar.gen.json',
    );
    return JSON.parse(fs.readFileSync(grammarPath, 'utf8')) as RGrammar;
}

suite('[Unit] R syntax grammar', () => {
    test('highlights package prefixes in namespace calls', () => {
        const grammar = readRGrammar();
        const expressionPatterns =
            grammar.repository?.expression?.patterns ?? [];
        const namespaceIndex = expressionPatterns.findIndex(
            (pattern) => pattern.include === '#namespace-call',
        );
        const functionCallIndex = expressionPatterns.findIndex(
            (pattern) => pattern.include === '#function-call',
        );
        const namespaceRule = grammar.repository?.['namespace-call'];

        assert.ok(
            namespaceIndex >= 0,
            'Expected expression parsing to include namespace calls',
        );
        assert.ok(
            namespaceIndex < functionCallIndex,
            'Namespace calls must be recognized before ordinary function calls',
        );
        assert.strictEqual(
            namespaceRule?.match,
            '(?<![A-Za-z0-9._])([A-Za-z._][A-Za-z0-9._]*)(:::?)',
        );
        assert.strictEqual(
            namespaceRule?.captures?.['1']?.name,
            'entity.name.namespace.r',
        );
        assert.strictEqual(
            namespaceRule?.captures?.['2']?.name,
            'keyword.operator',
        );
    });
});
