import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import type {
    EvaluateCodeResult,
    ICodeExecutionAttribution,
    ILanguageContributionServices,
    ILanguageRuntimeSession,
    RuntimeCodeExecutionMode,
    RuntimeErrorBehavior,
} from './types/supervisor-api';
import { R_LANGUAGE_ID } from './languageIds';

const READY_STATES = new Set(['ready', 'idle', 'busy']);
export const RuntimeCodeExecutionModeValue = {
    Interactive: 'interactive' as RuntimeCodeExecutionMode,
    NonInteractive: 'non-interactive' as RuntimeCodeExecutionMode,
    Silent: 'silent' as RuntimeCodeExecutionMode,
    Transient: 'transient' as RuntimeCodeExecutionMode,
} as const;
export const RuntimeErrorBehaviorValue = {
    Stop: 'stop' as RuntimeErrorBehavior,
    Continue: 'continue' as RuntimeErrorBehavior,
} as const;

export function getActiveRSession(
    services: ILanguageContributionServices,
): ILanguageRuntimeSession | undefined {
    const foreground = services.runtimeSessionService.foregroundSession;
    if (foreground?.runtimeMetadata.languageId === R_LANGUAGE_ID && READY_STATES.has(foreground.state)) {
        return foreground;
    }

    const consoleSession = services.runtimeSessionService.getConsoleSessionForLanguage(R_LANGUAGE_ID);
    if (consoleSession && READY_STATES.has(consoleSession.state)) {
        return consoleSession;
    }

    return services.runtimeSessionService.activeSessions.find(session => {
        return session.runtimeMetadata.languageId === R_LANGUAGE_ID && READY_STATES.has(session.state);
    });
}

export async function executeRCode(
    services: ILanguageContributionServices,
    code: string,
    options: {
        focus?: boolean;
        source?: string;
        fileUri?: vscode.Uri;
        lineNumber?: number;
        allowIncomplete?: boolean;
        mode?: RuntimeCodeExecutionMode;
        errorBehavior?: RuntimeErrorBehavior;
        executionId?: string;
        executionMetadata?: Record<string, unknown>;
        direct?: boolean;
    } = {},
): Promise<string | undefined> {
    const attribution: ICodeExecutionAttribution = {
        source: options.source ?? 'r.command',
        fileUri: options.fileUri,
        lineNumber: options.lineNumber,
    };

    if (options.direct) {
        const session = getActiveRSession(services);
        if (!session) {
            vscode.window.showWarningMessage('No active R session');
            return undefined;
        }

        const id = crypto.randomUUID();
        session.execute(
            code,
            id,
            options.mode ?? RuntimeCodeExecutionModeValue.Interactive,
            options.errorBehavior ?? RuntimeErrorBehaviorValue.Continue,
            attribution,
        );
        return session.sessionId;
    }

    const sessionId = getActiveRSession(services)?.sessionId;
    return services.positronConsoleService.executeCode(
        R_LANGUAGE_ID,
        sessionId,
        code,
        attribution,
        options.focus ?? true,
        options.allowIncomplete,
        options.mode,
        options.errorBehavior,
        options.executionId,
        options.fileUri,
        options.executionMetadata,
    );
}

export async function evaluateRCode(
    services: ILanguageContributionServices,
    code: string,
): Promise<EvaluateCodeResult | undefined> {
    const session = getActiveRSession(services);
    if (!session) {
        vscode.window.showWarningMessage('No active R session');
        return undefined;
    }

    return session.evaluate(code);
}

export function quoteRString(value: string): string {
    return JSON.stringify(value.replace(/\\/g, '/'));
}

export async function getFilePathForCommand(resource?: vscode.Uri): Promise<string | undefined> {
    const uri = resource ?? vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file') {
        return undefined;
    }

    try {
        await vscode.workspace.fs.stat(uri);
    } catch {
        return undefined;
    }

    return uri.fsPath.replace(/\\/g, '/');
}

export function defaultRVariableName(filePath: string): string {
    const baseName = path.basename(filePath, path.extname(filePath));
    const sanitized = baseName.replace(/[^a-zA-Z0-9_.]/g, '_');
    if (!sanitized) {
        return 'r_object';
    }
    return /^[0-9]/.test(sanitized) ? `_${sanitized}` : sanitized;
}
