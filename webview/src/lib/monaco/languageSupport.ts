import type { monaco } from "./setup";
import type { MessageConnection } from "vscode-jsonrpc/browser";

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
    registerLanguage(): void;
    ensureTokenizerReady(): Promise<void>;
    ensureProviders?(): void;
    registerModel?(
        model: monaco.editor.ITextModel,
        sessionId: string,
        connection: MessageConnection,
    ): void;
    unregisterModel?(model: monaco.editor.ITextModel): void;
    getTextMateThemeRules?(): monaco.editor.ITokenThemeRule[];
    updateTextMateThemeRules?(theme: ConsoleThemeData): void;
}

const moduleCache = new Map<string, Promise<LanguageMonacoSupportModule | undefined>>();

function normalizeLanguageId(languageId: string): string {
    return languageId.trim().toLowerCase();
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
        await import(
            /* @vite-ignore */ moduleUrl
        ) as LanguageMonacoSupportModule)();

    moduleCache.set(normalizedLanguageId, loadPromise);
    return loadPromise;
}
