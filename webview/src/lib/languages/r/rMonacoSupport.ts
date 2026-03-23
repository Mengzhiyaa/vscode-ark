import { ensureProviders } from "./monaco/languageServices";
import {
    registerModel,
    unregisterModel,
} from "./monaco/languageServices";
import {
    ensureRLanguageTokenizerReady,
    registerRLanguage,
} from "./monaco/rLanguage";
import {
    getTextMateThemeRules,
    updateTextMateThemeRules,
} from "./monaco/textmateTokenizer";

export function registerLanguage(): void {
    registerRLanguage();
}

export async function ensureTokenizerReady(): Promise<void> {
    await ensureRLanguageTokenizerReady();
}

export {
    ensureProviders,
    getTextMateThemeRules,
    registerModel,
    unregisterModel,
    updateTextMateThemeRules,
};
