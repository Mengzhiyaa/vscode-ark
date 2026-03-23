/*---------------------------------------------------------------------------------------------
 *  Virtual Document Provider for Ark LSP
 *  Based on positron-r/src/virtual-documents.ts
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RequestType } from 'vscode-languageclient';
import { LanguageClient } from 'vscode-languageclient/node';

interface VirtualDocumentParams {
    path: string;
}

type VirtualDocumentResponse = string;

const VIRTUAL_DOCUMENT_REQUEST_TYPE: RequestType<VirtualDocumentParams, VirtualDocumentResponse, any> =
    new RequestType('ark/internal/virtualDocument');

/**
 * Provides virtual document content for ark:// URIs.
 * 
 * This allows the ARK backend to dynamically generate document content,
 * commonly used for debugging, temporary code display, and other scenarios.
 */
export class VirtualDocumentProvider implements vscode.TextDocumentContentProvider {
    constructor(
        private _client: LanguageClient,
        private _logChannel?: vscode.LogOutputChannel
    ) { }

    async provideTextDocumentContent(
        uri: vscode.Uri,
        token: vscode.CancellationToken
    ): Promise<string> {
        const params: VirtualDocumentParams = {
            path: uri.path,
        };

        try {
            return await this._client.sendRequest(VIRTUAL_DOCUMENT_REQUEST_TYPE, params, token);
        } catch (err) {
            this._logChannel?.warn(`[LSP] Failed to provide document for URI '${uri}': ${err}`);
            return 'Error: This document does not exist';
        }
    }
}
