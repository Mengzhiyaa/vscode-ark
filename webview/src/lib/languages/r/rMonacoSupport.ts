import type * as MonacoTypes from "monaco-editor";
import type { MonacoApi } from "../../monaco/monacoContext";
import { setInjectedMonaco } from "../../monaco/monacoContext";
import {
    ensureProviders as ensureProvidersImpl,
    registerModel as registerModelImpl,
    unregisterModel as unregisterModelImpl,
} from "./monaco/languageServices";
import {
    ensureRLanguageTokenizerReady,
    registerRLanguage,
} from "./monaco/rLanguage";

export function registerLanguage(monaco: MonacoApi): void {
    setInjectedMonaco(monaco);
    registerRLanguage();
}

export async function ensureTokenizerReady(monaco: MonacoApi): Promise<void> {
    setInjectedMonaco(monaco);
    await ensureRLanguageTokenizerReady();
}

export function ensureProviders(monaco: MonacoApi): void {
    setInjectedMonaco(monaco);
    ensureProvidersImpl();
}

export function registerModel(
    monaco: MonacoApi,
    model: MonacoTypes.editor.ITextModel,
    sessionId: string,
    connection: import("vscode-jsonrpc/browser").MessageConnection,
): void {
    setInjectedMonaco(monaco);
    registerModelImpl(model, sessionId, connection);
}

export function unregisterModel(
    monaco: MonacoApi,
    model: MonacoTypes.editor.ITextModel,
): void {
    setInjectedMonaco(monaco);
    unregisterModelImpl(model);
}
