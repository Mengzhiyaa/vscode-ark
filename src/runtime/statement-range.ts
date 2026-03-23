/*---------------------------------------------------------------------------------------------
 *  Statement Range Provider for Ark LSP
 *  Based on positron-r/src/statement-range.ts
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { LanguageClient, Position, Range, RequestType, VersionedTextDocumentIdentifier } from 'vscode-languageclient/node';

interface StatementRangeParams {
    textDocument: VersionedTextDocumentIdentifier;
    position: Position;
}

interface StatementRangeResponse {
    range: Range;
    code?: string;
}

export namespace StatementRangeRequest {
    export const type: RequestType<StatementRangeParams, StatementRangeResponse | undefined, any> =
        new RequestType('positron/textDocument/statementRange');
}

/**
 * Result of a statement range request
 */
export interface StatementRange {
    /** The range of the statement */
    range: vscode.Range;
    /** Optional: the code content of the statement */
    code?: string;
}

/**
 * A StatementRangeProvider implementation for R.
 * 
 * This provider detects the range of R statements at a given cursor position,
 * enabling features like "Run Current Statement" and intelligent code execution.
 * 
 * Note: In standard VS Code, there's no built-in StatementRangeProvider interface,
 * so this implementation provides a method that can be called directly.
 */
export class RStatementRangeProvider {

    /** The language client instance */
    private readonly _client: LanguageClient;

    constructor(
        readonly client: LanguageClient,
    ) {
        this._client = client;
    }

    /**
     * Provides the statement range at the given position in the document.
     * 
     * @param document The text document
     * @param position The position within the document
     * @param token Cancellation token
     * @returns The statement range and optionally the code, or undefined if not available
     */
    async provideStatementRange(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<StatementRange | undefined> {

        const params: StatementRangeParams = {
            textDocument: this._client.code2ProtocolConverter.asVersionedTextDocumentIdentifier(document),
            position: this._client.code2ProtocolConverter.asPosition(position)
        };

        const response = await this._client.sendRequest(StatementRangeRequest.type, params, token);

        if (!response) {
            return undefined;
        }

        const range = this._client.protocol2CodeConverter.asRange(response.range);
        // Explicitly normalize non-strings to `undefined` (i.e. a possible `null`)
        const code = typeof response.code === 'string' ? response.code : undefined;

        return { range, code };
    }
}
