/*---------------------------------------------------------------------------------------------
 *  Help Topic Provider for Ark LSP
 *  Based on positron-r/src/help.ts
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { LanguageClient, Position, RequestType, VersionedTextDocumentIdentifier } from 'vscode-languageclient/node';

interface HelpTopicParams {
    textDocument: VersionedTextDocumentIdentifier;
    position: Position;
}

interface HelpTopicResponse {
    topic: string;
}

export namespace HelpTopicRequest {
    export const type: RequestType<HelpTopicParams, HelpTopicResponse | undefined, any> =
        new RequestType('positron/textDocument/helpTopic');
}

/**
 * A HelpTopicProvider implementation for R.
 * 
 * This provider retrieves help topic information for symbols at a given position,
 * enabling users to quickly access R documentation for functions and objects.
 * 
 * Note: In standard VS Code, there's no built-in HelpTopicProvider interface,
 * so this implementation provides a method that can be called directly.
 */
export class RHelpTopicProvider {

    /** The language client instance */
    private readonly _client: LanguageClient;

    constructor(
        readonly client: LanguageClient,
    ) {
        this._client = client;
    }

    /**
     * Provides the help topic for the symbol at the given position.
     * 
     * @param document The text document
     * @param position The position within the document
     * @param token Cancellation token
     * @returns The help topic string, or undefined if not available
     */
    async provideHelpTopic(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<string | undefined> {

        const params: HelpTopicParams = {
            textDocument: this._client.code2ProtocolConverter.asVersionedTextDocumentIdentifier(document),
            position: this._client.code2ProtocolConverter.asPosition(position)
        };

        const response = await this._client.sendRequest(HelpTopicRequest.type, params, token);
        return response?.topic;
    }
}
