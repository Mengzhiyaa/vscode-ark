/*---------------------------------------------------------------------------------------------
 *  Help Actions
 *  Replicates Positron help commands for editor integration.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { ILanguageContributionServices } from '../../types/supervisor-api';
import { RCommandIds } from '../../rCommandIds';

export function registerHelpActions(
    languageId: string,
    languageName: string,
    services: ILanguageContributionServices
): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];
    const {
        positronHelpService,
        logChannel,
        runtimeSessionService,
    } = services;

    disposables.push(
        vscode.commands.registerCommand(RCommandIds.helpShowHelpAtCursor, async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showInformationMessage(
                    'No help is available here. Place the cursor on the item you want help with.'
                );
                return;
            }

            const position = editor.selection.active;
            const document = editor.document;
            if (document.languageId !== languageId) {
                vscode.window.showInformationMessage(
                    `No ${languageName} help is available here. Place the cursor on the item you want help with.`
                );
                return;
            }

            const session = runtimeSessionService.getConsoleSessionForLanguage(languageId);
            if (!session || session.runtimeMetadata.languageId !== languageId) {
                vscode.window.showInformationMessage(`No active ${languageName} session. Start a session to view help.`);
                return;
            }

            try {
                const lsp = await session.waitLsp();
                const provider = lsp?.helpTopicProvider;
                if (!provider) {
                    vscode.window.showInformationMessage('Help topic provider is not available yet.');
                    return;
                }

                const tokenSource = new vscode.CancellationTokenSource();
                let topic: string | null | undefined;
                try {
                    topic = await provider.provideHelpTopic(
                        document,
                        position,
                        tokenSource.token
                    );
                } finally {
                    tokenSource.dispose();
                }

                if (typeof topic === 'string' && topic.length > 0) {
                    const found = await positronHelpService.showHelpTopic(languageId, topic);
                    if (!found) {
                        vscode.window.showInformationMessage(`No help available for '${topic}'.`);
                    }
                } else {
                    vscode.window.showInformationMessage('No help is available at this location.');
                }
            } catch (error: any) {
                logChannel.warn(`[HelpActions] Failed to show help: ${error}`);
                vscode.window.showWarningMessage(`An error occurred while looking up help: ${error?.message ?? error}`);
            }
        })
    );

    disposables.push(
        vscode.commands.registerCommand(RCommandIds.helpLookupHelpTopic, async () => {
            const session = runtimeSessionService.getConsoleSessionForLanguage(languageId);
            if (!session || session.runtimeMetadata.languageId !== languageId) {
                vscode.window.showInformationMessage(`No active ${languageName} session. Start a session to view help.`);
                return;
            }

            const topic = await vscode.window.showInputBox({
                prompt: `Enter ${languageName} help topic`,
                value: '',
                ignoreFocusOut: true,
                validateInput: (value) => {
                    if (value.trim().length === 0) {
                        return 'No help topic provided.';
                    }
                    return undefined;
                }
            });

            if (!topic) {
                return;
            }

            try {
                const found = await positronHelpService.showHelpTopic(session.runtimeMetadata.languageId, topic);
                if (!found) {
                    vscode.window.showInformationMessage(`No help found for '${topic}'.`);
                }
            } catch (error: any) {
                logChannel.warn(`[HelpActions] Failed to look up help: ${error}`);
                vscode.window.showWarningMessage(`Error finding help on '${topic}': ${error?.message ?? error}`);
            }
        })
    );

    disposables.push(
        vscode.commands.registerCommand(RCommandIds.helpShowWelcome, () => {
            positronHelpService.showWelcomePage();
        })
    );

    disposables.push(
        vscode.commands.registerCommand(RCommandIds.helpFind, async () => {
            await positronHelpService.find();
        })
    );

    return disposables;
}
