/**
 * Shared Language Services for Monaco Editor
 *
 * Provides a global, singleton registration of R language providers
 * (completion, hover, signature help) that are shared across all
 * console editor instances.
 *
 * Each console registers its ITextModel with a sessionId and connection,
 * allowing providers to route requests to the correct session.
 */
import type { MessageConnection } from "vscode-jsonrpc/browser";
import type * as MonacoTypes from "monaco-editor";
import {
    getInjectedMonaco,
} from "../../../monaco/monacoContext";

// ---------------------------------------------------------------------------
// Model Registry — maps ITextModel → session context
// ---------------------------------------------------------------------------

interface ModelContext {
    sessionId: string;
    connection: MessageConnection;
}

const modelRegistry = new Map<MonacoTypes.editor.ITextModel, ModelContext>();

/**
 * Register a model with its session context.
 * Call this when a ConsoleInput editor is created.
 */
export function registerModel(
    model: MonacoTypes.editor.ITextModel,
    sessionId: string,
    connection: MessageConnection,
): void {
    modelRegistry.set(model, { sessionId, connection });
}

/**
 * Update the connection for a model (e.g. when reconnecting).
 */
export function updateModelConnection(
    model: MonacoTypes.editor.ITextModel,
    connection: MessageConnection,
): void {
    const ctx = modelRegistry.get(model);
    if (ctx) {
        ctx.connection = connection;
    }
}

/**
 * Unregister a model when its editor is destroyed.
 */
export function unregisterModel(model: MonacoTypes.editor.ITextModel): void {
    modelRegistry.delete(model);
}

// ---------------------------------------------------------------------------
// LSP types (used only inside providers)
// ---------------------------------------------------------------------------

interface LspCompletionItem {
    label: string;
    kind?: number;
    detail?: string;
    documentation?: string | { kind: string; value: string };
    insertText?: string;
    filterText?: string;
    sortText?: string;
}

interface CompletionItem {
    label: string;
    kind?: string;
    detail?: string;
    insertText?: string;
}

interface LspHoverResult {
    contents: string | { kind: string; value: string };
    range?: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
}

interface LspSignatureHelpResult {
    signatures: Array<{
        label: string;
        documentation?: string | { kind: string; value: string };
        parameters?: Array<{
            label: string | [number, number];
            documentation?: string | { kind: string; value: string };
        }>;
    }>;
    activeSignature?: number;
    activeParameter?: number;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function formatDocumentation(
    doc?: string | { kind: string; value: string },
): string | MonacoTypes.IMarkdownString | undefined {
    if (!doc) return undefined;
    if (typeof doc === "string") return doc;
    if (doc.kind === "markdown") {
        return { value: doc.value, isTrusted: true };
    }
    return doc.value;
}

function mapLspCompletionKind(
    kind?: number,
): MonacoTypes.languages.CompletionItemKind {
    const monaco = getInjectedMonaco();

    switch (kind) {
        case 1:
            return monaco.languages.CompletionItemKind.Text;
        case 2:
            return monaco.languages.CompletionItemKind.Method;
        case 3:
            return monaco.languages.CompletionItemKind.Function;
        case 4:
            return monaco.languages.CompletionItemKind.Constructor;
        case 5:
            return monaco.languages.CompletionItemKind.Field;
        case 6:
            return monaco.languages.CompletionItemKind.Variable;
        case 7:
            return monaco.languages.CompletionItemKind.Class;
        case 8:
            return monaco.languages.CompletionItemKind.Interface;
        case 9:
            return monaco.languages.CompletionItemKind.Module;
        case 10:
            return monaco.languages.CompletionItemKind.Property;
        case 11:
            return monaco.languages.CompletionItemKind.Unit;
        case 12:
            return monaco.languages.CompletionItemKind.Value;
        case 13:
            return monaco.languages.CompletionItemKind.Enum;
        case 14:
            return monaco.languages.CompletionItemKind.Keyword;
        case 15:
            return monaco.languages.CompletionItemKind.Snippet;
        case 16:
            return monaco.languages.CompletionItemKind.Color;
        case 17:
            return monaco.languages.CompletionItemKind.File;
        case 18:
            return monaco.languages.CompletionItemKind.Reference;
        case 19:
            return monaco.languages.CompletionItemKind.Folder;
        case 21:
            return monaco.languages.CompletionItemKind.Constant;
        case 24:
            return monaco.languages.CompletionItemKind.Operator;
        default:
            return monaco.languages.CompletionItemKind.Text;
    }
}

function mapCompletionKind(
    kind?: string,
): MonacoTypes.languages.CompletionItemKind {
    const monaco = getInjectedMonaco();

    switch (kind) {
        case "function":
            return monaco.languages.CompletionItemKind.Function;
        case "variable":
            return monaco.languages.CompletionItemKind.Variable;
        case "constant":
            return monaco.languages.CompletionItemKind.Constant;
        case "keyword":
            return monaco.languages.CompletionItemKind.Keyword;
        case "field":
            return monaco.languages.CompletionItemKind.Field;
        case "method":
            return monaco.languages.CompletionItemKind.Method;
        case "class":
            return monaco.languages.CompletionItemKind.Class;
        case "module":
            return monaco.languages.CompletionItemKind.Module;
        default:
            return monaco.languages.CompletionItemKind.Text;
    }
}

function getWordRangeAtPosition(
    model: MonacoTypes.editor.ITextModel,
    position: MonacoTypes.Position,
): MonacoTypes.IRange {
    const lineContent = model.getLineContent(position.lineNumber);
    const column = position.column - 1; // Convert to 0-based

    let startColumn = column;
    const endColumn = column;

    // Move left to find start of word
    // R identifier characters: letters, digits, underscores, periods
    while (startColumn > 0) {
        const char = lineContent[startColumn - 1];
        if (/[a-zA-Z0-9_.]/.test(char)) {
            startColumn--;
        } else {
            break;
        }
    }

    // DO NOT extend to the right - only replace up to cursor position
    // This preserves any trailing characters like closing parentheses

    // Convert back to 1-based columns for Monaco
    return {
        startLineNumber: position.lineNumber,
        startColumn: startColumn + 1,
        endLineNumber: position.lineNumber,
        endColumn: endColumn + 1,
    };
}

// ---------------------------------------------------------------------------
// Singleton provider registration
// ---------------------------------------------------------------------------

let providersRegistered = false;

/**
 * Ensure the R language providers are registered exactly once.
 * Safe to call from every ConsoleInput mount — only the first call registers.
 */
export function ensureProviders(): void {
    if (providersRegistered) {
        return;
    }
    providersRegistered = true;

    const monaco = getInjectedMonaco();

    // ---- Completion provider ----
    monaco.languages.registerCompletionItemProvider("r", {
        triggerCharacters: ["$", ":", "@", ".", "/"],
        provideCompletionItems: async (
            model: MonacoTypes.editor.ITextModel,
            position: MonacoTypes.Position,
        ) => {
            const ctx = modelRegistry.get(model);
            if (!ctx) {
                return { suggestions: [] };
            }

            const { sessionId, connection } = ctx;
            const code = model.getValue();
            const lspPosition = {
                line: position.lineNumber - 1,
                character: position.column - 1,
            };

            try {
                // Try LSP-based completion first
                const result = (await connection.sendRequest(
                    "lsp/completion",
                    { code, position: lspPosition, sessionId },
                )) as {
                    items: LspCompletionItem[];
                    isIncomplete?: boolean;
                };

                if (result.items && result.items.length > 0) {
                    const suggestions: MonacoTypes.languages.CompletionItem[] =
                        result.items.map((item) => {
                            const insertText =
                                item.insertText || item.label;
                            const hasSnippetSyntax = /\$\d|\$\{/.test(
                                insertText,
                            );
                            return {
                                label: item.label,
                                kind: mapLspCompletionKind(item.kind),
                                detail: item.detail,
                                documentation: formatDocumentation(
                                    item.documentation,
                                ),
                                insertText: insertText,
                                insertTextRules: hasSnippetSyntax
                                    ? monaco.languages
                                        .CompletionItemInsertTextRule
                                        .InsertAsSnippet
                                    : undefined,
                                filterText: item.filterText,
                                sortText: item.sortText,
                                range: getWordRangeAtPosition(
                                    model,
                                    position,
                                ),
                            };
                        });

                    return {
                        suggestions,
                        incomplete: result.isIncomplete,
                    };
                }

                // Fallback to kernel-based completion if LSP returns no results
                const offset = model.getOffsetAt(position);
                const kernelResult = (await connection.sendRequest(
                    "console/complete",
                    { code, cursorPos: offset, sessionId },
                )) as { items: CompletionItem[] };

                const suggestions: MonacoTypes.languages.CompletionItem[] = (
                    kernelResult.items || []
                ).map((item) => ({
                    label: item.label,
                    kind: mapCompletionKind(item.kind),
                    detail: item.detail,
                    insertText: item.insertText || item.label,
                    range: getWordRangeAtPosition(model, position),
                }));

                return { suggestions };
            } catch (e) {
                console.error("Completion request failed:", e);
                return { suggestions: [] };
            }
        },
    });

    // ---- Hover provider ----
    monaco.languages.registerHoverProvider("r", {
        provideHover: async (
            model: MonacoTypes.editor.ITextModel,
            position: MonacoTypes.Position,
        ) => {
            const ctx = modelRegistry.get(model);
            if (!ctx) {
                return null;
            }

            const { sessionId, connection } = ctx;
            const code = model.getValue();
            const lspPosition = {
                line: position.lineNumber - 1,
                character: position.column - 1,
            };

            try {
                const result = (await connection.sendRequest("lsp/hover", {
                    code,
                    position: lspPosition,
                    sessionId,
                })) as LspHoverResult | null;

                if (!result) {
                    return null;
                }

                const contents: MonacoTypes.IMarkdownString[] = [];
                if (typeof result.contents === "string") {
                    contents.push({ value: result.contents });
                } else if (result.contents && "value" in result.contents) {
                    contents.push({
                        value: result.contents.value,
                        isTrusted: true,
                    });
                }

                let range: MonacoTypes.IRange | undefined;
                if (result.range) {
                    range = {
                        startLineNumber: result.range.start.line + 1,
                        startColumn: result.range.start.character + 1,
                        endLineNumber: result.range.end.line + 1,
                        endColumn: result.range.end.character + 1,
                    };
                }

                return { contents, range };
            } catch (e) {
                console.error("Hover request failed:", e);
                return null;
            }
        },
    });

    // ---- Signature help provider ----
    monaco.languages.registerSignatureHelpProvider("r", {
        signatureHelpTriggerCharacters: ["(", ",", ")"],
        signatureHelpRetriggerCharacters: [",", ")"],
        provideSignatureHelp: async (
            model: MonacoTypes.editor.ITextModel,
            position: MonacoTypes.Position,
        ) => {
            const ctx = modelRegistry.get(model);
            if (!ctx) {
                return null;
            }

            const { sessionId, connection } = ctx;
            const code = model.getValue();
            const lspPosition = {
                line: position.lineNumber - 1,
                character: position.column - 1,
            };

            try {
                const result = (await connection.sendRequest(
                    "lsp/signatureHelp",
                    { code, position: lspPosition, sessionId },
                )) as LspSignatureHelpResult | null;

                if (
                    !result ||
                    !result.signatures ||
                    result.signatures.length === 0
                ) {
                    return null;
                }

                const signatures: MonacoTypes.languages.SignatureInformation[] =
                    result.signatures.map((sig) => ({
                        label: sig.label,
                        documentation: formatDocumentation(
                            sig.documentation,
                        ),
                        parameters: (sig.parameters || []).map((p) => ({
                            label: p.label,
                            documentation: formatDocumentation(
                                p.documentation,
                            ),
                        })),
                    }));

                return {
                    value: {
                        signatures,
                        activeSignature: result.activeSignature ?? 0,
                        activeParameter: result.activeParameter ?? 0,
                    },
                    dispose: () => { },
                };
            } catch (e) {
                console.error("Signature help request failed:", e);
                return null;
            }
        },
    });
}
