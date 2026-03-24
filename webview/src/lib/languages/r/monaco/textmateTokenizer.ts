/**
 * TextMate Grammar Integration for Monaco Editor
 *
 * Uses vscode-textmate + vscode-oniguruma to replace the basic Monarch tokenizer
 * with the same TextMate grammar that Positron uses for R syntax highlighting.
 *
 * The tokenizer registers itself with Monaco's TokenizationRegistry, so both
 * the console editor and history colorizer (activityInputColorizer.ts) benefit
 * automatically.
 */
import {
    createOnigScanner,
    createOnigString,
    loadWASM,
} from "vscode-oniguruma";
import {
    INITIAL,
    Registry,
    type IGrammar,
    type IRawGrammar,
    type StateStack,
} from "vscode-textmate";
import type * as MonacoTypes from "monaco-editor";
import {
    getInjectedMonaco,
} from "../../../monaco/monacoContext";
import type {
    ConsoleThemeData,
} from "../../../monaco/languageSupport";

// Import the R grammar as a JSON module
import rGrammarJson from "../../../../../../syntaxes/r.tmGrammar.gen.json";

// Import onig.wasm as a URL — Vite emits it to the assets directory
import onigWasmUrl from "vscode-oniguruma/release/onig.wasm?url";

let initialized = false;
let initPromise: Promise<void> | undefined;
let currentThemeRules: MonacoTypes.editor.ITokenThemeRule[] = [];

/**
 * Update TextMate theme rules for Monaco from extension-provided token colors.
 */
export function updateTextMateThemeRules(theme: ConsoleThemeData): void {
    currentThemeRules = theme.rules.map((rule) => ({
        token: rule.token,
        foreground: normalizeHexColor(rule.foreground),
        background: normalizeHexColor(rule.background),
        fontStyle: rule.fontStyle,
    }));
}

export function getTextMateThemeRules(): MonacoTypes.editor.ITokenThemeRule[] {
    return currentThemeRules;
}

function normalizeHexColor(color?: string): string | undefined {
    if (!color) {
        return undefined;
    }
    const trimmed = color.trim();
    if (!trimmed) {
        return undefined;
    }
    return trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
}

/**
 * Initialize the TextMate tokenizer for the R language in Monaco.
 *
 * This loads the Oniguruma WASM, creates a TextMate Registry with the
 * R grammar, and registers a custom tokens provider with Monaco that
 * uses TextMate scopes instead of Monarch tokens.
 */
export async function initializeTextMateTokenizer(): Promise<void> {
    if (initialized) return;
    if (initPromise) return initPromise;

    initPromise = doInitialize();
    return initPromise;
}

/**
 * Load the Oniguruma WASM file as an ArrayBuffer.
 *
 * In VS Code webviews, standard `fetch()` may be blocked by CSP.
 * We try multiple loading strategies:
 * 1. fetch() — works in dev server mode and if CSP allows connect-src
 * 2. XMLHttpRequest — may work as a fallback in some webview contexts
 */
async function loadOnigWasm(): Promise<ArrayBuffer> {
    // Try fetch first (works in dev mode and when CSP allows it)
    try {
        const response = await fetch(onigWasmUrl);
        if (response.ok) {
            return await response.arrayBuffer();
        }
    } catch {
        // fetch failed (likely CSP), try XHR
    }

    // Try synchronous XMLHttpRequest as fallback
    return new Promise<ArrayBuffer>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", onigWasmUrl, true);
        xhr.responseType = "arraybuffer";
        xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 0) {
                resolve(xhr.response as ArrayBuffer);
            } else {
                reject(
                    new Error(
                        `Failed to load onig.wasm: HTTP ${xhr.status}`,
                    ),
                );
            }
        };
        xhr.onerror = () =>
            reject(new Error("Failed to load onig.wasm via XHR"));
        xhr.send();
    });
}

async function doInitialize(): Promise<void> {
    try {
        // 1. Load Oniguruma WASM
        const wasmArrayBuffer = await loadOnigWasm();
        await loadWASM({ data: wasmArrayBuffer });

        // 2. Create TextMate Registry
        const registry = new Registry({
            onigLib: Promise.resolve({
                createOnigScanner,
                createOnigString,
            }),
            loadGrammar: async (
                scopeName: string,
            ): Promise<IRawGrammar | null> => {
                if (scopeName === "source.r") {
                    return rGrammarJson as unknown as IRawGrammar;
                }
                return null;
            },
        });

        // 3. Load the R grammar
        const grammar = await registry.loadGrammar("source.r");
        if (!grammar) {
            console.warn(
                "[TextMate] Failed to load R grammar, falling back to Monarch",
            );
            return;
        }

        // 4. Register as Monaco tokens provider
        registerTextMateTokensProvider(grammar);

        initialized = true;
        console.log("[TextMate] R grammar tokenizer initialized successfully");
    } catch (error) {
        console.error("[TextMate] Failed to initialize:", error);
        initPromise = undefined;
        // No fallback — Monaco will show unhighlighted text
    }
}

/**
 * Register a Monaco TokensProvider that delegates to the TextMate grammar.
 * This replaces the Monarch tokenizer for the 'r' language.
 */
function registerTextMateTokensProvider(grammar: IGrammar): void {
    const monaco = getInjectedMonaco();

    monaco.languages.setTokensProvider("r", {
        getInitialState(): MonacoTypes.languages.IState {
            return new TextMateState(INITIAL);
        },

        tokenize(
            line: string,
            state: MonacoTypes.languages.IState,
        ): MonacoTypes.languages.ILineTokens {
            const tmState = state as TextMateState;
            const result = grammar.tokenizeLine(line, tmState.ruleStack);

            const tokens: MonacoTypes.languages.IToken[] = result.tokens.map(
                (token) => ({
                    startIndex: token.startIndex,
                    // Convert TextMate scope list to a dotted Monaco token string.
                    // Monaco uses the most specific (last) scope for rule matching.
                    scopes: scopesToMonacoToken(token.scopes),
                }),
            );

            return {
                tokens,
                endState: new TextMateState(result.ruleStack),
            };
        },
    });
}

/**
 * Convert TextMate scope list to a Monaco token string.
 *
 * TextMate produces scopes like:
 *   ["source.r", "support.function.r"]
 *
 * Monaco expects a dotted token name that matches theme rules:
 *   "support.function.r"
 *
 * We use the most specific scope (last non-root scope) for best theme matching.
 */
function scopesToMonacoToken(scopes: string[]): string {
    // Skip "source.r" root scope, use the most specific scope
    for (let i = scopes.length - 1; i >= 0; i--) {
        if (scopes[i] !== "source.r") {
            return scopes[i];
        }
    }
    return "";
}

/**
 * Adapter class that wraps TextMate's StateStack as a Monaco IState.
 */
class TextMateState implements MonacoTypes.languages.IState {
    constructor(public readonly ruleStack: StateStack) { }

    clone(): TextMateState {
        return new TextMateState(this.ruleStack.clone());
    }

    equals(other: MonacoTypes.languages.IState): boolean {
        if (!(other instanceof TextMateState)) return false;
        return this.ruleStack.equals(other.ruleStack);
    }
}
