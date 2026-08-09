import * as assert from 'assert';
import * as vscode from 'vscode';
import { executeRCode, RuntimeCodeExecutionModeValue, RuntimeErrorBehaviorValue } from '../../rExecution';

suite('[Unit] R execution', () => {
    test('forwards console execution options and document metadata', async () => {
        const calls: unknown[][] = [];
        const fileUri = vscode.Uri.file('/workspace/script.R');
        const services = {
            runtimeSessionService: {
                foregroundSession: undefined,
                getConsoleSessionForLanguage: () => undefined,
                activeSessions: [],
            },
            positronConsoleService: {
                executeCode: async (...args: unknown[]) => {
                    calls.push(args);
                    return 'execution-1';
                },
            },
        } as any;

        await executeRCode(services, '1 + 1', {
            source: 'r.test',
            fileUri,
            lineNumber: 3,
            focus: false,
            allowIncomplete: true,
            mode: RuntimeCodeExecutionModeValue.NonInteractive,
            errorBehavior: RuntimeErrorBehaviorValue.Stop,
            executionId: 'execution-1',
            executionMetadata: { executionTarget: 'file' },
        });

        assert.deepStrictEqual(calls[0], [
            'r',
            undefined,
            '1 + 1',
            { source: 'r.test', fileUri, lineNumber: 3 },
            false,
            true,
            RuntimeCodeExecutionModeValue.NonInteractive,
            RuntimeErrorBehaviorValue.Stop,
            'execution-1',
            fileUri,
            { executionTarget: 'file' },
        ]);
    });
});
