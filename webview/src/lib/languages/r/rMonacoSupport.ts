import type { MonacoApi } from "../../monaco/monacoContext";
import { setInjectedMonaco } from "../../monaco/monacoContext";
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

