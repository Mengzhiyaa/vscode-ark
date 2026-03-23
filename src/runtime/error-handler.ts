/*---------------------------------------------------------------------------------------------
 *  Custom Error Handler for Ark LSP Client
 *  Based on positron-r/src/error-handler.ts
 *--------------------------------------------------------------------------------------------*/

import {
    CloseAction,
    CloseHandlerResult,
    ErrorAction,
    ErrorHandler,
    ErrorHandlerResult,
    Message
} from 'vscode-languageclient/node';

import * as vscode from 'vscode';

/**
 * Custom error handler for the Ark (R) language client.
 * 
 * The DefaultErrorHandler adds restarts on close, which we don't want. We want to be fully in
 * control over restarting the client side of the LSP, both because we have our own runtime restart
 * behavior, and because we have state that relies on client status changes being accurate.
 * 
 * Additionally, we set `handled: true` to avoid a toast notification that is
 * inactionable from the user's point of view.
 */
export class RErrorHandler implements ErrorHandler {
    constructor(
        private readonly _version: string,
        private readonly _port: number,
        private readonly _logChannel: vscode.LogOutputChannel
    ) {
    }

    public error(error: Error, _message: Message, count: number): ErrorHandlerResult {
        this._logChannel.warn(
            `[LSP] ARK (R ${this._version}) language client error occurred (port ${this._port}). ` +
            `'${error.name}' with message: ${error.message}. This is error number ${count}.`
        );
        return { action: ErrorAction.Shutdown, handled: true };
    }

    public closed(): CloseHandlerResult {
        this._logChannel.warn(
            `[LSP] ARK (R ${this._version}) language client was closed unexpectedly (port ${this._port}).`
        );
        return { action: CloseAction.DoNotRestart, handled: true };
    }
}
