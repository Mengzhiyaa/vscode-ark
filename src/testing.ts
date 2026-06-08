import * as path from 'path';
import * as vscode from 'vscode';
import type { ILanguageContributionServices } from './types/supervisor-api';
import { executeRCode, quoteRString } from './rExecution';
import {
    detectRPackage,
    refreshRTestthatContexts,
    TESTTHAT_TEST_FILE_GLOB,
} from './contexts';

interface TestItemData {
    uri: vscode.Uri;
    packageRoot: vscode.Uri | undefined;
}

export async function setupRTestExplorer(
    context: vscode.ExtensionContext,
    services: ILanguageContributionServices,
): Promise<vscode.Disposable | undefined> {
    if (!isRTestingEnabled() || !await detectRPackage()) {
        await refreshRTestthatContexts(false);
        return undefined;
    }

    const controller = vscode.tests.createTestController(
        'rPackageTests',
        'R Package Test Explorer',
    );
    const itemData = new WeakMap<vscode.TestItem, TestItemData>();

    const discover = async () => {
        controller.items.replace([]);
        const files = await vscode.workspace.findFiles(TESTTHAT_TEST_FILE_GLOB, '**/node_modules/**');
        for (const file of files) {
            const item = controller.createTestItem(file.toString(), path.basename(file.fsPath), file);
            itemData.set(item, {
                uri: file,
                packageRoot: vscode.workspace.getWorkspaceFolder(file)?.uri,
            });
            controller.items.add(item);
        }
        await refreshRTestthatContexts(true);
    };

    controller.resolveHandler = async () => {
        await discover();
    };

    controller.createRunProfile(
        'Run',
        vscode.TestRunProfileKind.Run,
        async (request, token) => {
            const run = controller.createTestRun(request);
            const queue: vscode.TestItem[] = [];

            if (request.include) {
                queue.push(...request.include);
            } else {
                controller.items.forEach(item => queue.push(item));
            }

            for (const item of queue) {
                if (token.isCancellationRequested) {
                    run.skipped(item);
                    continue;
                }

                const data = itemData.get(item);
                if (!data) {
                    run.skipped(item);
                    continue;
                }

                run.started(item);
                try {
                    await executeRCode(
                        services,
                        [
                            'if (!requireNamespace("testthat", quietly = TRUE)) {',
                            '  stop("Package testthat is required. Install it with install.packages(\\"testthat\\").")',
                            '}',
                            testFileCode(data),
                        ].join('\n'),
                        {
                            focus: true,
                            source: 'r.testthat',
                            fileUri: data.uri,
                        },
                    );
                    run.passed(item);
                } catch (error) {
                    run.failed(
                        item,
                        new vscode.TestMessage(error instanceof Error ? error.message : String(error)),
                    );
                }
            }

            run.end();
        },
        true,
    );

    const watcher = vscode.workspace.createFileSystemWatcher(TESTTHAT_TEST_FILE_GLOB);
    context.subscriptions.push(
        watcher.onDidCreate(() => { void discover(); }),
        watcher.onDidDelete(() => { void discover(); }),
        watcher.onDidChange(() => { void discover(); }),
    );

    await discover();
    return new vscode.Disposable(() => {
        watcher.dispose();
        controller.dispose();
    });
}

function isRTestingEnabled(): boolean {
    return vscode.workspace.getConfiguration('ark.r').get<boolean>('testing', true);
}

function testFileCode(data: TestItemData): string {
    const filePath = quoteRString(data.uri.fsPath);
    const packageRoot = data.packageRoot ? quoteRString(data.packageRoot.fsPath) : undefined;
    if (!packageRoot) {
        return `testthat::test_file(${filePath})`;
    }

    return [
        'local({',
        '  oldwd <- setwd(' + packageRoot + ')',
        '  on.exit(setwd(oldwd), add = TRUE)',
        `  testthat::test_file(${filePath})`,
        '})',
    ].join('\n');
}
