/**
 * Activity input colorizer (Positron 1:1 approach).
 *
 * This mirrors Positron's activity input rendering path:
 * - acquire tokenization support from TokenizationRegistry
 * - tokenize lines with carried state (multi-line aware)
 * - render each line with renderViewLine2
 */
import { TokenizationRegistry } from "monaco-editor/esm/vs/editor/common/languages.js";
import { ILanguageService } from "monaco-editor/esm/vs/editor/common/languages/language.js";
import { LineTokens } from "monaco-editor/esm/vs/editor/common/tokens/lineTokens.js";
import {
    RenderLineInput,
    renderViewLine2,
} from "monaco-editor/esm/vs/editor/common/viewLayout/viewLineRenderer.js";
import { ViewLineRenderingData } from "monaco-editor/esm/vs/editor/common/viewModel.js";
import { StandaloneServices } from "monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js";

type EncodedTokenizeResult = {
    tokens: Uint32Array;
    endState: unknown;
};

type TokenizationSupport = {
    getInitialState(): unknown;
    tokenizeEncoded(
        line: string,
        hasEOL: boolean,
        state: unknown,
    ): EncodedTokenizeResult;
};

/**
 * Colorizes plain code lines for activity input history.
 * Returns one HTML line per input line, or [] when colorization is unavailable.
 */
export async function colorizeActivityInputLines(
    codeOutputLines: string[],
    languageId: string,
): Promise<string[]> {
    const languageService = StandaloneServices.get(ILanguageService);

    if (!languageService?.isRegisteredLanguageId(languageId)) {
        return [];
    }

    const tokenizationSupport =
        (await TokenizationRegistry.getOrCreate(
            languageId,
        )) as TokenizationSupport | null;

    if (!tokenizationSupport) {
        return [];
    }

    const colorizedOutputLines: string[] = [];
    let state = tokenizationSupport.getInitialState();

    for (const codeOutputLine of codeOutputLines) {
        const tokenizeResult = tokenizationSupport.tokenizeEncoded(
            codeOutputLine,
            true,
            state,
        );
        LineTokens.convertToEndOffset(tokenizeResult.tokens, codeOutputLine.length);

        const lineTokens = new LineTokens(
            tokenizeResult.tokens,
            codeOutputLine,
            languageService.languageIdCodec,
        );

        const isBasicASCII = ViewLineRenderingData.isBasicASCII(
            codeOutputLine,
            true,
        );
        const containsRTL = ViewLineRenderingData.containsRTL(
            codeOutputLine,
            isBasicASCII,
            true,
        );

        const renderLineOutput = renderViewLine2(
            new RenderLineInput(
                false,
                true,
                codeOutputLine,
                false,
                isBasicASCII,
                containsRTL,
                0,
                lineTokens.inflate(),
                [],
                4,
                0,
                0,
                0,
                0,
                -1,
                "none",
                false,
                false,
                null,
                null,
                0,
            ),
        );

        colorizedOutputLines.push(renderLineOutput.html);
        state = tokenizeResult.endState;
    }

    return colorizedOutputLines;
}
