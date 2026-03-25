import * as vscode from 'vscode';
import type {
    ILanguageRuntimeProvider,
    ILanguageRuntimeSession,
    ILanguageRuntimeSessionManager,
    IRuntimeSessionMetadata,
    ISupervisorFrameworkApi,
    LanguageRuntimeDynState,
    LanguageRuntimeMetadata,
    LanguageSessionMode,
} from './types/supervisor-api';
import { R_LANGUAGE_ID } from './languageIds';

function createDynState(
    sessionMetadata: IRuntimeSessionMetadata,
    sessionName: string,
): LanguageRuntimeDynState {
    return {
        sessionName,
        inputPrompt: '>',
        continuationPrompt: '+',
        busy: false,
        currentWorkingDirectory: sessionMetadata.workingDirectory,
        currentNotebookUri: sessionMetadata.notebookUri,
    };
}

function toLanguageSessionMode(
    sessionMode: IRuntimeSessionMetadata['sessionMode'],
): LanguageSessionMode {
    return sessionMode === 'notebook'
        ? 'notebook'
        : sessionMode === 'background'
            ? 'background'
            : 'console';
}

export class RRuntimeManager implements ILanguageRuntimeSessionManager {
    constructor(
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _api: ISupervisorFrameworkApi,
        private readonly _runtimeProvider: ILanguageRuntimeProvider<unknown>,
        private readonly _logChannel: vscode.LogOutputChannel,
    ) {}

    async managesRuntime(runtimeMetadata: LanguageRuntimeMetadata): Promise<boolean> {
        return runtimeMetadata.languageId === R_LANGUAGE_ID;
    }

    async createSession(
        runtimeMetadata: LanguageRuntimeMetadata,
        sessionMetadata: IRuntimeSessionMetadata,
        sessionName: string,
    ): Promise<ILanguageRuntimeSession> {
        const installation = this._runtimeProvider.restoreInstallationFromMetadata?.(runtimeMetadata);
        if (!installation) {
            throw new Error('R metadata is missing installation information');
        }

        const normalizedSessionMetadata: IRuntimeSessionMetadata = {
            ...sessionMetadata,
            sessionName,
        };
        const kernelSpec = await this._runtimeProvider.createKernelSpec(
            this._extensionContext,
            installation,
            toLanguageSessionMode(normalizedSessionMetadata.sessionMode),
            this._logChannel,
        );
        const dynState = createDynState(normalizedSessionMetadata, sessionName);

        return this._api.createSession(
            runtimeMetadata,
            normalizedSessionMetadata,
            kernelSpec,
            dynState,
        );
    }

    async validateSession(
        runtimeMetadata: LanguageRuntimeMetadata,
        sessionId: string,
    ): Promise<boolean> {
        if (runtimeMetadata.languageId !== R_LANGUAGE_ID) {
            return false;
        }

        return this._api.validateSession(sessionId);
    }

    async restoreSession(
        runtimeMetadata: LanguageRuntimeMetadata,
        sessionMetadata: IRuntimeSessionMetadata,
        sessionName: string,
    ): Promise<ILanguageRuntimeSession> {
        const normalizedSessionMetadata: IRuntimeSessionMetadata = {
            ...sessionMetadata,
            sessionName,
        };
        const dynState = createDynState(normalizedSessionMetadata, sessionName);

        return this._api.restoreSession(
            runtimeMetadata,
            normalizedSessionMetadata,
            dynState,
        );
    }

    async validateMetadata(metadata: LanguageRuntimeMetadata): Promise<LanguageRuntimeMetadata> {
        return this._runtimeProvider.validateMetadata
            ? this._runtimeProvider.validateMetadata(metadata)
            : metadata;
    }
}
