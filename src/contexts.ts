import * as vscode from 'vscode';

const DESCRIPTION_GLOB = '**/DESCRIPTION';
const TESTTHAT_CONFIG_GLOB = '**/tests/testthat.[Rr]';
export const TESTTHAT_TEST_FILE_GLOB = '**/tests/testthat/test*.[Rr]';

export async function detectRPackage(): Promise<boolean> {
    const lines = await readDescriptionLines();
    const packageLine = lines.find(line => /^Package\s*:/i.test(line));
    const typeLine = lines.find(line => /^Type\s*:/i.test(line));
    const typeIsPackage = typeLine ? /package/i.test(typeLine) : true;
    return !!packageLine && typeIsPackage;
}

export async function getRPackageName(): Promise<string | undefined> {
    const lines = await readDescriptionLines();
    const packageLine = lines.find(line => /^Package\s*:/i.test(line));
    return packageLine?.replace(/^Package\s*:\s*/i, '').trim() || undefined;
}

export async function refreshRContexts(): Promise<void> {
    const isRPackage = await detectRPackage();
    await vscode.commands.executeCommand('setContext', 'isRPackage', isRPackage);
    await refreshRTestthatContexts(isRPackage);
}

export async function refreshRTestthatContexts(isRPackage = false): Promise<void> {
    let testthatIsConfigured = false;
    let testthatHasTests = false;

    try {
        if (!isRPackage && !await detectRPackage()) {
            return;
        }

        testthatIsConfigured = await hasWorkspaceFile(TESTTHAT_CONFIG_GLOB);
        if (!testthatIsConfigured) {
            return;
        }

        testthatHasTests = await hasWorkspaceFile(TESTTHAT_TEST_FILE_GLOB);
    } finally {
        await vscode.commands.executeCommand('setContext', 'testthatIsConfigured', testthatIsConfigured);
        await vscode.commands.executeCommand('setContext', 'testthatHasTests', testthatHasTests);
    }
}

export async function setRContexts(context: vscode.ExtensionContext): Promise<vscode.Disposable> {
    await refreshRContexts();

    const disposables: vscode.Disposable[] = [];
    for (const pattern of [DESCRIPTION_GLOB, TESTTHAT_CONFIG_GLOB, TESTTHAT_TEST_FILE_GLOB]) {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        disposables.push(
            watcher,
            watcher.onDidCreate(() => { void refreshRContexts(); }),
            watcher.onDidChange(() => { void refreshRContexts(); }),
            watcher.onDidDelete(() => { void refreshRContexts(); }),
        );
    }

    const disposable = new vscode.Disposable(() => {
        for (const item of disposables) {
            item.dispose();
        }
    });
    context.subscriptions.push(disposable);
    return disposable;
}

async function readDescriptionLines(): Promise<string[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return [];
    }

    try {
        const uri = vscode.Uri.joinPath(workspaceFolder.uri, 'DESCRIPTION');
        const bytes = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(bytes).toString('utf8').split(/\r?\n/);
    } catch {
        return [];
    }
}

async function hasWorkspaceFile(glob: string): Promise<boolean> {
    return (await vscode.workspace.findFiles(glob, '**/node_modules/**', 1)).length > 0;
}
