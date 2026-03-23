/**
 * R Language Registration for Monaco Editor
 *
 * This module registers the R language with Monaco editor,
 * providing language configuration and TextMate grammar-based
 * syntax highlighting (replacing the old Monarch tokenizer).
 */
import { monaco } from "../../../monaco/setup";
import { initializeTextMateTokenizer } from "./textmateTokenizer";

// Track if language has been registered
let isRegistered = false;
let tokenizerReadyPromise: Promise<void> | undefined;

/**
 * Register the R language with Monaco.
 * Safe to call multiple times - will only register once.
 */
export function registerRLanguage(): void {
    if (isRegistered) {
        return;
    }

    // Register the R language
    monaco.languages.register({
        id: 'r',
        extensions: ['.R', '.r', '.Rmd'],
        aliases: ['R', 'r'],
        mimetypes: ['text/r', 'text/x-r']
    });

    // Set language configuration
    monaco.languages.setLanguageConfiguration('r', {
        comments: {
            lineComment: '#'
        },
        brackets: [
            ['{', '}'],
            ['[', ']'],
            ['(', ')']
        ],
        autoClosingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: '`', close: '`' },
            { open: '"', close: '"', notIn: ['string'] },
            { open: "'", close: "'", notIn: ['string', 'comment'] },
            { open: '%', close: '%', notIn: ['string', 'comment'] }
        ],
        surroundingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: '`', close: '`' },
            { open: '"', close: '"' },
            { open: "'", close: "'" }
        ],
        wordPattern: /(-?\d*\.\d\w*)|([^`~!@#%^&*()\-=+[{\]}\\|;:'",.<>\/?\s]+)/g
    });

    // Initialize TextMate grammar tokenizer (async, replaces Monarch)
    // The tokenizer will register itself with Monaco when ready.
    // Until it loads, Monaco will use basic mode (no highlighting).
    tokenizerReadyPromise = initializeTextMateTokenizer().catch((error) => {
        console.error("[rLanguage] TextMate tokenizer initialization failed:", error);
    });

    isRegistered = true;
}

/**
 * Ensures R language registration and waits for tokenizer initialization.
 */
export async function ensureRLanguageTokenizerReady(): Promise<void> {
    registerRLanguage();
    await tokenizerReadyPromise;
}
