import * as path from 'path';
import * as vscode from 'vscode';
import type { ILanguageContributionServices } from './types/supervisor-api';
import { defaultRVariableName } from './rExecution';
import { loadRDataFile, loadRdsFileWithVariable } from './commands';

type RDataKind = 'workspace' | 'object';

export class RDataEditorProvider implements vscode.CustomReadonlyEditorProvider {
    static readonly viewType = 'vscode-ark.rdataLoader';

    static register(
        services: ILanguageContributionServices,
    ): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            RDataEditorProvider.viewType,
            new RDataEditorProvider(services),
            {
                webviewOptions: { retainContextWhenHidden: false },
                supportsMultipleEditorsPerDocument: false,
            },
        );
    }

    constructor(private readonly _services: ILanguageContributionServices) {}

    async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => undefined };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
    ): Promise<void> {
        webviewPanel.webview.options = { enableScripts: true };
        webviewPanel.webview.html = getConfirmHtml(path.basename(document.uri.fsPath), 'workspace');
        webviewPanel.webview.onDidReceiveMessage(async (message) => {
            if (message?.type !== 'load') {
                return;
            }

            const fileName = path.basename(document.uri.fsPath);
            webviewPanel.webview.html = getLoadingHtml(fileName, 'workspace');
            try {
                await loadRDataFile(this._services, document.uri);
                webviewPanel.webview.html = getSuccessHtml(fileName, 'workspace');
                setTimeout(() => webviewPanel.dispose(), 1200);
            } catch (error) {
                webviewPanel.webview.html = getErrorHtml(fileName, 'workspace', error);
            }
        });
    }
}

export class RdsEditorProvider implements vscode.CustomReadonlyEditorProvider {
    static readonly viewType = 'vscode-ark.rdsLoader';

    static register(
        services: ILanguageContributionServices,
    ): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            RdsEditorProvider.viewType,
            new RdsEditorProvider(services),
            {
                webviewOptions: { retainContextWhenHidden: false },
                supportsMultipleEditorsPerDocument: false,
            },
        );
    }

    constructor(private readonly _services: ILanguageContributionServices) {}

    async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => undefined };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
    ): Promise<void> {
        const fileName = path.basename(document.uri.fsPath);
        const defaultName = defaultRVariableName(document.uri.fsPath);

        webviewPanel.webview.options = { enableScripts: true };
        webviewPanel.webview.html = getConfirmHtml(fileName, 'object', defaultName);
        webviewPanel.webview.onDidReceiveMessage(async (message) => {
            if (message?.type !== 'load') {
                return;
            }

            const variableName = typeof message.varName === 'string' && message.varName.trim()
                ? message.varName.trim()
                : defaultName;
            webviewPanel.webview.html = getLoadingHtml(fileName, 'object', variableName);
            try {
                const loadedName = await loadRdsFileWithVariable(this._services, document.uri, variableName);
                webviewPanel.webview.html = getSuccessHtml(fileName, 'object', loadedName);
                setTimeout(() => webviewPanel.dispose(), 1200);
            } catch (error) {
                webviewPanel.webview.html = getErrorHtml(fileName, 'object', error, variableName);
            }
        });
    }
}

function getConfirmHtml(fileName: string, kind: RDataKind, variableName?: string): string {
    const isObject = kind === 'object';
    const heading = isObject ? 'Load R Object' : 'Load R Workspace';
    const description = isObject
        ? `Load <code>${escapeHtml(fileName)}</code> into your R session as:`
        : `Load all objects from <code>${escapeHtml(fileName)}</code> into your R session?`;
    const input = isObject ? `
        <input id="varName" value="${escapeHtml(variableName ?? 'r_object')}" spellcheck="false" />
        <div id="error"></div>
    ` : '';

    return page(heading, `
        <h2>${heading}</h2>
        <p>${description}</p>
        ${input}
        <button id="load">Load</button>
        <script>
            const vscode = acquireVsCodeApi();
            const valid = /^[a-zA-Z._][a-zA-Z0-9._]*$/;
            document.getElementById('load').addEventListener('click', () => {
                const input = document.getElementById('varName');
                if (!input) {
                    vscode.postMessage({ type: 'load' });
                    return;
                }
                const value = input.value.trim();
                if (!valid.test(value)) {
                    document.getElementById('error').textContent = 'Invalid R variable name';
                    return;
                }
                vscode.postMessage({ type: 'load', varName: value });
            });
        </script>
    `);
}

function getLoadingHtml(fileName: string, kind: RDataKind, variableName?: string): string {
    const message = kind === 'object'
        ? `Loading <code>${escapeHtml(fileName)}</code> as <code>${escapeHtml(variableName ?? '')}</code>...`
        : `Loading objects from <code>${escapeHtml(fileName)}</code>...`;
    return page('Loading R Data', `<div class="spinner"></div><p>${message}</p>`);
}

function getSuccessHtml(fileName: string, kind: RDataKind, variableName?: string): string {
    const message = kind === 'object'
        ? `Loaded <code>${escapeHtml(fileName)}</code> as <code>${escapeHtml(variableName ?? '')}</code>.`
        : `Loaded objects from <code>${escapeHtml(fileName)}</code>.`;
    return page('R Data Loaded', `<h2 class="success">Loaded</h2><p>${message}</p>`);
}

function getErrorHtml(fileName: string, kind: RDataKind, error: unknown, variableName?: string): string {
    const message = kind === 'object'
        ? `Failed to load <code>${escapeHtml(fileName)}</code> as <code>${escapeHtml(variableName ?? '')}</code>.`
        : `Failed to load <code>${escapeHtml(fileName)}</code>.`;
    return page('Error Loading R Data', `<h2 class="error">Error</h2><p>${message}</p><pre>${escapeHtml(String(error))}</pre>`);
}

function page(title: string, body: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <style>
        body {
            background: var(--vscode-editor-background);
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            padding: 24px;
        }
        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: 0;
            padding: 8px 18px;
            cursor: pointer;
        }
        input {
            display: block;
            width: 260px;
            margin: 8px 0 6px;
            padding: 6px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            font-family: var(--vscode-editor-font-family);
        }
        code {
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 5px;
        }
        pre {
            white-space: pre-wrap;
            background: var(--vscode-textCodeBlock-background);
            padding: 10px;
        }
        #error, .error { color: var(--vscode-testing-iconFailed, #f14c4c); }
        .success { color: var(--vscode-testing-iconPassed, #89d185); }
        .spinner {
            width: 28px;
            height: 28px;
            border: 3px solid var(--vscode-foreground);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
