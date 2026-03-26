/*---------------------------------------------------------------------------------------------
 *  Statement Range Provider for Ark LSP
 *  Based on positron-r/src/statement-range.ts
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { LanguageClient, Position, Range, RequestType, VersionedTextDocumentIdentifier } from 'vscode-languageclient/node';

enum StatementRangeKind {
    Success = 'success',
    Rejection = 'rejection',
}

enum StatementRangeRejectionKind {
    Syntax = 'syntax',
}

interface StatementRangeParams {
    textDocument: VersionedTextDocumentIdentifier;
    position: Position;
}

interface StatementRangeLegacyResponse {
    range: Range;
    code?: string;
}

interface StatementRangeSuccessResponse {
    kind: StatementRangeKind.Success;
    range: Range;
    code?: string;
}

interface StatementRangeSyntaxRejectionResponse {
    kind: StatementRangeKind.Rejection;
    rejectionKind: StatementRangeRejectionKind.Syntax;
    line?: number;
}

type StatementRangeResponse =
    | StatementRangeLegacyResponse
    | StatementRangeSuccessResponse
    | StatementRangeSyntaxRejectionResponse;

export namespace StatementRangeRequest {
    export const type: RequestType<StatementRangeParams, StatementRangeResponse | undefined, any> =
        new RequestType('positron/textDocument/statementRange');
}

export class StatementRangeSyntaxError extends Error {
    constructor(readonly line?: number) {
        super(
            line === undefined
                ? 'Cannot execute code due to a syntax error.'
                : `Cannot execute code due to a syntax error near line ${line + 1}.`,
        );
        this.name = 'StatementRangeSyntaxError';
    }
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

        if (!('kind' in response)) {
            const range = this._client.protocol2CodeConverter.asRange(response.range);
            const code = typeof response.code === 'string' ? response.code : undefined;
            return { range, code };
        }

        switch (response.kind) {
            case StatementRangeKind.Success: {
                const range = this._client.protocol2CodeConverter.asRange(response.range);
                const code = typeof response.code === 'string' ? response.code : undefined;
                return { range, code };
            }
            case StatementRangeKind.Rejection: {
                switch (response.rejectionKind) {
                    case StatementRangeRejectionKind.Syntax:
                        throw new StatementRangeSyntaxError(response.line);
                    default:
                        throw new Error(`Unrecognized 'StatementRangeRejectionKind': ${response.rejectionKind}`);
                }
            }
            default:
                throw new Error(`Unrecognized 'StatementRangeKind': ${String((response as { kind?: unknown }).kind)}`);
        }
    }
}
