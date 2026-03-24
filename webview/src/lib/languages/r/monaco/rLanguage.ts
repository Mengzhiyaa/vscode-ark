/**
 * R Language Registration for Monaco Editor
 *
 * This module registers the R language with Monaco editor,
 * providing language configuration. TextMate tokenization is
 * hosted by vscode-supervisor using grammar metadata registered
 * by the language extension.
 */
import { getInjectedMonaco } from "../../../monaco/monacoContext";

// Track if language has been registered
let isRegistered = false;

/**
 * Register the R language with Monaco.
 * Safe to call multiple times - will only register once.
 */
export function registerRLanguage(): void {
    if (isRegistered) {
        return;
    }

    const monaco = getInjectedMonaco();

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

    isRegistered = true;
}

/**
 * Ensures R language registration. Tokenizer initialization is
 * handled by the supervisor-hosted TextMate runtime.
 */
export async function ensureRLanguageTokenizerReady(): Promise<void> {
    registerRLanguage();
}
