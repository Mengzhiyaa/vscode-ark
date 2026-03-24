import * as vscode from 'vscode';
import type { ISupervisorFrameworkApi } from './types/supervisor-api';
import { RLanguageContribution } from './rLanguageContribution';

const SUPERVISOR_EXTENSION_ID = 'ark.vscode-supervisor';

export async function activate(_context: vscode.ExtensionContext): Promise<void> {
    const supervisorExtension = vscode.extensions.getExtension<ISupervisorFrameworkApi>(SUPERVISOR_EXTENSION_ID);
    if (!supervisorExtension) {
        throw new Error(`Required extension '${SUPERVISOR_EXTENSION_ID}' is not installed`);
    }

    const api = await supervisorExtension.activate();
    const contribution = new RLanguageContribution(_context);
    await api.registerLanguageSupport({
        runtimeProvider: contribution.runtimeProvider,
        binaryProvider: contribution.binaryProvider,
        languageContribution: contribution,
        webviewAssets: {
            localResourceRoots: [
                vscode.Uri.joinPath(_context.extensionUri, 'webview', 'dist'),
                vscode.Uri.joinPath(_context.extensionUri, 'syntaxes'),
            ],
            monacoSupportModule: vscode.Uri.joinPath(
                _context.extensionUri,
                'webview',
                'dist',
                'rMonacoSupport',
                'index.js',
            ),
            textMateGrammar: {
                scopeName: 'source.r',
                grammarUri: vscode.Uri.joinPath(
                    _context.extensionUri,
                    'syntaxes',
                    'r.tmGrammar.gen.json',
                ),
            },
        },
    });
}

export function deactivate(): void {
    return;
}
