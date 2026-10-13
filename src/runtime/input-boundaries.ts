import * as vscode from 'vscode';
import { LanguageClient, RequestType } from 'vscode-languageclient/node';
import type { ILanguageInputBoundaryProvider, InputBoundary } from '../types/supervisor-api';

interface InputBoundariesParams {
    text: string;
}

interface InputBoundariesResponse {
    boundaries: InputBoundary[];
}

export namespace InputBoundariesRequest {
    export const type = new RequestType<InputBoundariesParams, InputBoundariesResponse, void>('positron/inputBoundaries');
}

/** Uses Ark's native line boundaries instead of guessing R statement completeness. */
export class RInputBoundaryProvider implements ILanguageInputBoundaryProvider {
    constructor(private readonly _client: LanguageClient) {}

    async provideInputBoundaries(
        document: vscode.TextDocument,
        range: vscode.Range,
        token: vscode.CancellationToken,
    ): Promise<InputBoundary[]> {
        const response = await this._client.sendRequest(InputBoundariesRequest.type, { text: document.getText(range) }, token);
        return response.boundaries;
    }
}
