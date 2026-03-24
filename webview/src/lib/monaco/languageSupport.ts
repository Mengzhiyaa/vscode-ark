import type { MessageConnection } from "vscode-jsonrpc/browser";
import type * as MonacoTypes from "monaco-editor";
import type { MonacoApi } from "./monacoContext";

export interface ConsoleThemeRule {
    token: string;
    foreground?: string;
    background?: string;
    fontStyle?: string;
}

export interface ConsoleThemeData {
    base: "vs" | "vs-dark" | "hc-black" | "hc-light";
    rules: ConsoleThemeRule[];
}

export interface LanguageMonacoSupportModule {
    registerLanguage(monaco: MonacoApi): void;
    ensureTokenizerReady(monaco: MonacoApi): Promise<void>;
    ensureProviders?(monaco: MonacoApi): void;
    registerModel?(
        monaco: MonacoApi,
        model: MonacoTypes.editor.ITextModel,
        sessionId: string,
        connection: MessageConnection,
    ): void;
    unregisterModel?(monaco: MonacoApi, model: MonacoTypes.editor.ITextModel): void;
    getTextMateThemeRules?(): MonacoTypes.editor.ITokenThemeRule[];
    updateTextMateThemeRules?(theme: ConsoleThemeData): void;
}

const moduleCache = new Map<string, Promise<LanguageMonacoSupportModule | undefined>>();

function normalizeLanguageId(languageId: string): string {
    return languageId.trim().toLowerCase();
}

function isLanguageMonacoSupportModule(
    value: unknown,
): value is LanguageMonacoSupportModule {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as LanguageMonacoSupportModule).registerLanguage ===
            "function" &&
        typeof (value as LanguageMonacoSupportModule).ensureTokenizerReady ===
            "function"
    );
}

function normalizeLanguageMonacoSupportModule(
    value: unknown,
): LanguageMonacoSupportModule | undefined {
    let candidate = value;

    for (let depth = 0; depth < 3; depth += 1) {
        if (isLanguageMonacoSupportModule(candidate)) {
            return candidate;
        }

        if (
            typeof candidate !== "object" ||
            candidate === null ||
            !("default" in candidate)
        ) {
            return undefined;
        }

        candidate = (candidate as { default?: unknown }).default;
    }

    return undefined;
}

export function getLanguageMonacoSupportModuleUrl(
    languageId: string,
): string | undefined {
    const normalizedLanguageId = normalizeLanguageId(languageId);
    if (!normalizedLanguageId) {
        return undefined;
    }

    return globalThis.__arkLanguageMonacoSupportModules?.[normalizedLanguageId];
}

export function loadLanguageMonacoSupportModule(
    languageId: string,
): Promise<LanguageMonacoSupportModule | undefined> {
    const normalizedLanguageId = normalizeLanguageId(languageId);
    if (!normalizedLanguageId) {
        return Promise.resolve(undefined);
    }

    const existingPromise = moduleCache.get(normalizedLanguageId);
    if (existingPromise) {
        return existingPromise;
    }

    const moduleUrl = getLanguageMonacoSupportModuleUrl(normalizedLanguageId);
    if (!moduleUrl) {
        return Promise.resolve(undefined);
    }

    const loadPromise = (async () =>
        normalizeLanguageMonacoSupportModule(
            await import(/* @vite-ignore */ moduleUrl),
        ))();

    moduleCache.set(normalizedLanguageId, loadPromise);
    return loadPromise;
}
