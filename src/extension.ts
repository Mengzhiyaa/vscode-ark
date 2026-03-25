import * as vscode from 'vscode';
import type { ISupervisorFrameworkApi } from './types/supervisor-api';
import { registerArkDebugAdapterFactory } from './debugger';
import { RLanguageContribution } from './rLanguageContribution';

const SUPERVISOR_EXTENSION_ID = 'ark.vscode-supervisor';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const supervisorExtension = vscode.extensions.getExtension<ISupervisorFrameworkApi>(SUPERVISOR_EXTENSION_ID);
    if (!supervisorExtension) {
        throw new Error(`Required extension '${SUPERVISOR_EXTENSION_ID}' is not installed`);
    }

    const api = await supervisorExtension.activate();
    const logChannel = vscode.window.createOutputChannel('Ark R', { log: true });
    context.subscriptions.push(logChannel);
    context.subscriptions.push(registerArkDebugAdapterFactory());

    const contribution = new RLanguageContribution(context, api);
    await api.registerLanguageSupport({
        runtimeProvider: contribution.runtimeProvider,
        binaryProvider: contribution.binaryProvider,
        languageContribution: contribution,
        webviewAssets: {
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, 'webview', 'dist'),
                vscode.Uri.joinPath(context.extensionUri, 'syntaxes'),
            ],
            monacoSupportModule: vscode.Uri.joinPath(
                context.extensionUri,
                'webview',
                'dist',
                'rMonacoSupport',
                'index.js',
            ),
            textMateGrammar: {
                scopeName: 'source.r',
                grammarUri: vscode.Uri.joinPath(
                    context.extensionUri,
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
