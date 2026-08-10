import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface PackageJsonShape {
    name?: string;
    publisher?: string;
    icon?: string;
    homepage?: string;
    bugs?: { url?: string };
    repository?: { type?: string; url?: string };
    main?: string;
    extensionDependencies?: string[];
    activationEvents?: string[];
    scripts?: Record<string, string | undefined>;
    workspaces?: string[];
    devDependencies?: Record<string, string | undefined>;
    positron?: {
        binaryDependencies?: Record<string, string | undefined>;
        binaryChecksums?: Record<string, Record<string, string | undefined> | undefined>;
    };
    supervisor?: {
        languageAssetsVersion?: number;
        languages?: Array<{
            languageId?: string;
            displayName?: string;
            assets?: {
                localResourceRoots?: string[];
                monacoSupportModule?: string;
                textMateGrammar?: { scopeName?: string; path?: string };
            };
        }>;
    };
    contributes?: {
        languages?: Array<{ id?: string }>;
        grammars?: Array<{ language?: string }>;
        customEditors?: Array<{ viewType?: string }>;
        notebookRenderer?: Array<{ id?: string; mimeTypes?: string[]; entrypoint?: string }>;
        commands?: Array<{ command?: string }>;
        keybindings?: Array<{ command?: string; key?: string; mac?: string; when?: string }>;
        menus?: Record<string, Array<{ command?: string }>>;
        viewsWelcome?: Array<{ view?: string; when?: string }>;
        configuration?: {
            properties?: Record<string, {
                type?: string;
                scope?: string;
                default?: unknown;
                enum?: unknown[];
            }>;
        };
    };
}

function readPackageJson(): PackageJsonShape {
    const repoRoot = path.resolve(__dirname, '../../..');
    const packageJsonPath = path.join(repoRoot, 'package.json');
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJsonShape;
}

function readRepoFile(relativePath: string): string {
    const repoRoot = path.resolve(__dirname, '../../..');
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

suite('[Unit] R package manifest', () => {
    test('depends on supervisor and owns R contributions', () => {
        const packageJson = readPackageJson();

        assert.strictEqual(packageJson.name, 'vscode-ark');
        assert.strictEqual(packageJson.publisher, 'mengzhiya');
        assert.strictEqual(packageJson.icon, 'images/Rlogo.png');
        assert.strictEqual(packageJson.main, './dist/extension.js');
        assert.deepStrictEqual(packageJson.extensionDependencies, ['mengzhiya.vscode-supervisor']);
        assert.strictEqual(packageJson.repository?.type, 'git');
        assert.strictEqual(packageJson.repository?.url, 'https://github.com/Mengzhiyaa/vscode-ark');
        assert.strictEqual(packageJson.homepage, 'https://github.com/Mengzhiyaa/vscode-ark#readme');
        assert.strictEqual(packageJson.bugs?.url, 'https://github.com/Mengzhiyaa/vscode-ark/issues');
        assert.deepStrictEqual(packageJson.workspaces, ['webview']);
        assert.strictEqual(packageJson.positron?.binaryDependencies?.ark, 'ark-0.1.252-486-d0569cc');
        assert.match(
            packageJson.positron?.binaryChecksums?.ark?.['linux-x64'] ?? '',
            /^sha256:[0-9a-f]{64}$/,
        );
        assert.ok(packageJson.devDependencies?.['@vscode/vsce']);
        assert.ok(packageJson.devDependencies?.ovsx);
        assert.strictEqual(packageJson.scripts?.['vsce:package'], 'vsce package');
        assert.strictEqual(packageJson.scripts?.['install:binaries'], 'node scripts/install-binaries.mjs');
        assert.strictEqual(packageJson.scripts?.['update:ark'], 'node scripts/install-binaries.mjs --latest-ark');
        assert.strictEqual(packageJson.scripts?.['build:webview'], 'npm --prefix webview run build');
        assert.strictEqual(packageJson.scripts?.['build'], 'npm run build:webview && npm run compile');
        assert.strictEqual(packageJson.scripts?.['sync:supervisor-api'], 'node scripts/sync-supervisor-api.mjs');
        assert.strictEqual(packageJson.scripts?.['verify:supervisor-api'], 'node scripts/sync-supervisor-api.mjs --check');
        assert.deepStrictEqual(packageJson.supervisor, {
            languageAssetsVersion: 1,
            languages: [{
                languageId: 'r',
                displayName: 'R',
                assets: {
                    localResourceRoots: ['./webview/dist', './syntaxes'],
                    monacoSupportModule: './webview/dist/rMonacoSupport/index.js',
                    textMateGrammar: {
                        scopeName: 'source.r',
                        path: './syntaxes/r.tmGrammar.gen.json',
                    },
                },
            }],
        });
        assert.strictEqual(
            packageJson.scripts?.['test:unit:ext'],
            'npm run test:prepare && node scripts/run-vscode-tests.mjs --label unit'
        );
        assert.deepStrictEqual(packageJson.contributes?.languages?.map((entry) => entry.id), ['r', 'rdata', 'rds']);
        assert.deepStrictEqual(packageJson.contributes?.grammars?.map((entry) => entry.language), ['r']);
        assert.deepStrictEqual(
            packageJson.contributes?.customEditors?.map((entry) => entry.viewType),
            ['vscode-ark.rdataLoader', 'vscode-ark.rdsLoader'],
        );
        assert.deepStrictEqual(
            packageJson.contributes?.notebookRenderer?.map((entry) => entry.id),
            ['vscode-ark.r.htmlwidget'],
        );
        assert.deepStrictEqual(
            packageJson.contributes?.notebookRenderer?.[0]?.mimeTypes,
            ['application/vnd.r.htmlwidget'],
        );
        assert.strictEqual(packageJson.contributes?.notebookRenderer?.[0]?.entrypoint, 'resources/js/htmlwidget.js');
        assert.strictEqual(packageJson.contributes?.configuration?.properties?.['ark.r.testing']?.default, true);

        const configuration = packageJson.contributes?.configuration?.properties ?? {};
        assert.deepStrictEqual(
            {
                diagnostics: configuration['ark.lsp.diagnostics.enable']?.default,
                blockAssignments: configuration['ark.lsp.symbols.includeAssignmentsInBlocks']?.default,
                commentSections: configuration['ark.lsp.workspaceSymbols.includeCommentSections']?.default,
                trace: configuration['ark.lsp.trace.server']?.default,
            },
            {
                diagnostics: true,
                blockAssignments: false,
                commentSections: false,
                trace: 'off',
            },
        );
        assert.strictEqual(configuration['ark.lsp.diagnostics.enable']?.type, 'boolean');
        assert.strictEqual(configuration['ark.lsp.trace.server']?.scope, 'window');
        assert.deepStrictEqual(
            configuration['ark.lsp.trace.server']?.enum,
            ['off', 'messages', 'verbose'],
        );

        const commands = new Set((packageJson.contributes?.commands ?? []).map((entry) => entry.command));
        assert.ok(commands.has('supervisor.startConsole'));
        assert.ok(commands.has('supervisor.restartKernel'));
        assert.ok(commands.has('supervisor.selectRPath'));
        assert.ok(commands.has('supervisor.runCurrentStatement'));
        assert.ok(commands.has('supervisor.insertAssignmentOperator'));
        assert.ok(commands.has('supervisor.insertPipeOperator'));
        assert.ok(commands.has('supervisor.help.showHelpAtCursor'));
        assert.ok(!commands.has('supervisor.help.find'));
        assert.ok(commands.has('r.packageLoad'));
        assert.ok(commands.has('r.packageTest'));
        assert.ok(commands.has('r.sourceCurrentFile'));
        assert.ok(commands.has('r.useTestthat'));
        assert.ok(commands.has('r.useTest'));
        assert.ok(commands.has('r.loadRDataFile'));
        assert.ok(commands.has('r.loadRdsFile'));
        assert.ok(commands.has('r.showRVersion'));

        const explorerContextCommands = new Set(
            (packageJson.contributes?.menus?.['explorer/context'] ?? []).map((entry) => entry.command),
        );
        assert.ok(explorerContextCommands.has('r.loadRDataFile'));
        assert.ok(explorerContextCommands.has('r.loadRdsFile'));

        const commandPaletteCommands = new Set(
            (packageJson.contributes?.menus?.commandPalette ?? []).map((entry) => entry.command),
        );
        assert.ok(commandPaletteCommands.has('r.useTestthat'));
        assert.ok(commandPaletteCommands.has('r.useTest'));

        const testingWelcomeStates = new Set(
            (packageJson.contributes?.viewsWelcome ?? [])
                .filter((entry) => entry.view === 'testing')
                .map((entry) => entry.when),
        );
        assert.ok(testingWelcomeStates.has('!isRPackage'));
        assert.ok(testingWelcomeStates.has('isRPackage && config.ark.r.testing && !testthatIsConfigured'));
        assert.ok(testingWelcomeStates.has('isRPackage && config.ark.r.testing && testthatIsConfigured && !testthatHasTests'));

        const keybindings = packageJson.contributes?.keybindings ?? [];
        assert.ok(!keybindings.some((entry) => entry.command === 'supervisor.help.find'));
        assert.ok(!packageJson.activationEvents?.includes('onCommand:supervisor.help.find'));
        assert.ok(keybindings.some((entry) =>
            entry.command === 'supervisor.console.executeCode' &&
            entry.key === 'ctrl+enter' &&
            entry.mac === 'cmd+enter' &&
            entry.when === 'editorTextFocus && editorLangId == r'
        ));
        assert.ok(keybindings.some((entry) =>
            entry.command === 'supervisor.console.executeCodeWithoutAdvancing' &&
            entry.key === 'alt+enter' &&
            entry.when === 'editorTextFocus && editorLangId == r'
        ));
    });

    test('keeps release files and packaging rules', () => {
        const vscodeIgnore = readRepoFile('.vscodeignore');
        const readme = readRepoFile('README.md');

        for (const file of ['README.md', 'CHANGELOG.md', 'LICENSE.txt', 'ThirdPartyNotices.txt', '.vscodeignore']) {
            assert.ok(fs.existsSync(path.join(path.resolve(__dirname, '../../..'), file)), `Expected ${file} to exist`);
        }

        assert.match(readme, /Standalone R language extension/i);
        assert.match(readme, /ark\.vscode-supervisor/);
        assert.match(readme, /VSCE_PAT/);
        assert.match(readme, /OVSX_PAT/);
        assert.match(vscodeIgnore, /!LICENSE\.txt/);
        assert.match(vscodeIgnore, /!ThirdPartyNotices\.txt/);
        assert.match(vscodeIgnore, /!README\.md/);
        assert.match(vscodeIgnore, /!CHANGELOG\.md/);
        assert.match(vscodeIgnore, /webview\/package\.json/);
        assert.match(vscodeIgnore, /webview\/src\/\*\*/);
        assert.match(vscodeIgnore, /src\/\*\*/);
        assert.match(vscodeIgnore, /out\/\*\*/);
        assert.match(vscodeIgnore, /node_modules\/\*\*/);
        assert.match(vscodeIgnore, /webview\/node_modules\/\*\*/);
        assert.ok(fs.existsSync(path.join(path.resolve(__dirname, '../../..'), 'webview/package.json')));
        assert.ok(fs.existsSync(path.join(path.resolve(__dirname, '../../..'), 'resources/js/htmlwidget.js')));
        assert.ok(fs.existsSync(path.join(path.resolve(__dirname, '../../..'), 'webview/src/lib/languages/r/rMonacoSupport.ts')));
        assert.ok(fs.existsSync(path.join(path.resolve(__dirname, '../../..'), 'scripts/sync-supervisor-api.mjs')));
        assert.ok(fs.existsSync(path.join(path.resolve(__dirname, '../../..'), 'scripts/install-binaries.mjs')));
        assert.ok(fs.existsSync(path.join(path.resolve(__dirname, '../../..'), 'scripts/run-vscode-tests.mjs')));
        assert.ok(fs.existsSync(path.join(path.resolve(__dirname, '../../..'), '.github/workflows/ci.yml')));
        assert.ok(fs.existsSync(path.join(path.resolve(__dirname, '../../..'), '.github/workflows/release.yml')));
    });
});
