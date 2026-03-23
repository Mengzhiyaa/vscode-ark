/*---------------------------------------------------------------------------------------------
 *  Tab Completion for R Editor
 *  Implements RStudio-style Tab completion with AI suggestion priority
 *
 *  Uses a reactive context variable (supervisor.shouldTabComplete) to control keybinding
 *  matching. When the context is false, VS Code's native Tab behavior runs with
 *  zero overhead — no async command handler is involved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const SHOULD_TAB_COMPLETE_CONTEXT_KEY = 'supervisor.shouldTabComplete';

/**
 * Registers Tab completion context tracking for R files in the editor.
 *
 * Instead of intercepting every Tab press through a custom command, this approach
 * maintains a context variable `supervisor.shouldTabComplete` that is updated reactively
 * on cursor movement. The keybinding in package.json uses this context in its
 * `when` clause to decide whether to trigger suggest or fall through to native Tab.
 *
 * Benefits:
 * - When Tab should NOT trigger completion, native Tab runs with zero delay
 * - No async command wrapper in the hot path
 * - Selection/indentation behavior is preserved natively by VS Code
 *
 * @param context Extension context for disposable management
 */
export function registerTabCompletion(context: vscode.ExtensionContext): void {
    // Update context on cursor movement / selection change
    const onSelectionChange = vscode.window.onDidChangeTextEditorSelection(e => {
        updateTabCompletionContext(e.textEditor);
    });

    // Update context when the active editor changes
    const onEditorChange = vscode.window.onDidChangeActiveTextEditor(editor => {
        updateTabCompletionContext(editor);
    });

    // Initialize context for the current active editor
    updateTabCompletionContext(vscode.window.activeTextEditor);

    context.subscriptions.push(onSelectionChange, onEditorChange);
}

/**
 * Updates the `supervisor.shouldTabComplete` context variable based on the current
 * editor state. This is evaluated by VS Code's keybinding resolver to decide
 * whether Tab should trigger LSP suggest or fall through to native behavior.
 */
function updateTabCompletionContext(editor: vscode.TextEditor | undefined): void {
    const shouldComplete = editor !== undefined
        && editor.document.languageId === 'r'
        && shouldTriggerSuggestOnTab(editor);

    vscode.commands.executeCommand('setContext', SHOULD_TAB_COMPLETE_CONTEXT_KEY, shouldComplete);
}

/**
 * Determines whether the current cursor position(s) warrant triggering
 * the LSP suggest widget on Tab press.
 *
 * Returns false (= native Tab) when:
 * - There is a non-empty selection (Tab should indent)
 * - Cursor is at the start of a line
 * - Character to the left is whitespace, `(`, or `)`
 * - Character to the left is a single `:` (not `::`)
 * - Character to the left is neither an R token char nor a path separator (`/`)
 */
function shouldTriggerSuggestOnTab(editor: vscode.TextEditor): boolean {
    const selections = editor.selections;
    const document = editor.document;

    for (const selection of selections) {
        if (!selection.isEmpty) {
            return false;
        }

        const position = selection.active;
        if (position.character <= 0) {
            return false;
        }

        const lineText = document.lineAt(position.line).text;
        const leftChar = lineText.charAt(position.character - 1);
        if (!leftChar || /\s/.test(leftChar)) {
            return false;
        }

        if (leftChar === '(' || leftChar === ')') {
            return false;
        }

        if (leftChar === ':') {
            const prevChar = position.character >= 2 ? lineText.charAt(position.character - 2) : '';
            if (prevChar !== ':') {
                return false;
            }
            continue;
        }

        if (!/[A-Za-z0-9_.@$/]/.test(leftChar)) {
            return false;
        }
    }

    return true;
}
