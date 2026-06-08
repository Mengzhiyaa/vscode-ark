import * as path from 'path';
import * as vscode from 'vscode';
import type { ILanguageContributionServices } from './types/supervisor-api';
import { RCommandIds } from './rCommandIds';
import {
    defaultRVariableName,
    evaluateRCode,
    executeRCode,
    getFilePathForCommand,
    quoteRString,
    RuntimeCodeExecutionModeValue,
} from './rExecution';
import { refreshRTestthatContexts } from './contexts';

export function registerRCommands(
    context: vscode.ExtensionContext,
    services: ILanguageContributionServices,
): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand(RCommandIds.createNewFile, async () => {
            const document = await vscode.workspace.openTextDocument({ language: 'r' });
            await vscode.window.showTextDocument(document);
        }),
        vscode.commands.registerCommand(RCommandIds.insertSection, async () => {
            await insertSection();
        }),
        vscode.commands.registerCommand(RCommandIds.packageLoad, async () => {
            await executePackageCommand(services, 'devtools', 'devtools::load_all()');
        }),
        vscode.commands.registerCommand(RCommandIds.packageBuild, async () => {
            await executePackageCommand(services, 'devtools', 'devtools::build()');
        }),
        vscode.commands.registerCommand(RCommandIds.packageInstall, async () => {
            await executePackageCommand(services, 'devtools', 'devtools::install(build = FALSE)');
        }),
        vscode.commands.registerCommand(RCommandIds.packageTest, async () => {
            await executePackageCommand(services, 'devtools', 'devtools::test()');
        }),
        vscode.commands.registerCommand(RCommandIds.packageTestExplorer, async () => {
            await vscode.commands.executeCommand('workbench.view.testing.focus');
            await vscode.commands.executeCommand('testing.runAll');
        }),
        vscode.commands.registerCommand(RCommandIds.useTestthat, async () => {
            await executePackageCommand(services, 'usethis', 'usethis::use_testthat()');
            await refreshRTestthatContexts(true);
        }),
        vscode.commands.registerCommand(RCommandIds.useTest, async () => {
            await executePackageCommand(services, 'usethis', 'usethis::use_test("rename-me")');
            await refreshRTestthatContexts(true);
        }),
        vscode.commands.registerCommand(RCommandIds.packageCheck, async () => {
            await executePackageCommand(services, 'devtools', 'devtools::check()');
        }),
        vscode.commands.registerCommand(RCommandIds.packageDocument, async () => {
            await executePackageCommand(services, 'devtools', 'devtools::document()');
        }),
        vscode.commands.registerCommand(RCommandIds.sourceCurrentFile, async (resource?: vscode.Uri) => {
            await sourceCurrentFile(services, false, resource);
        }),
        vscode.commands.registerCommand(RCommandIds.sourceCurrentFileWithEcho, async (resource?: vscode.Uri) => {
            await sourceCurrentFile(services, true, resource);
        }),
        vscode.commands.registerCommand(RCommandIds.rmarkdownRender, async (resource?: vscode.Uri) => {
            await renderRMarkdown(services, resource);
        }),
        vscode.commands.registerCommand(RCommandIds.loadRDataFile, async (resource?: vscode.Uri) => {
            if (resource) {
                await loadRDataFile(services, resource);
            }
        }),
        vscode.commands.registerCommand(RCommandIds.loadRdsFile, async (resource?: vscode.Uri) => {
            if (resource) {
                await vscode.commands.executeCommand('vscode.openWith', resource, 'vscode-ark.rdsLoader');
            }
        }),
        vscode.commands.registerCommand(RCommandIds.loadRDataFileWithPicker, async () => {
            await loadRDataFileWithPicker(services);
        }),
        vscode.commands.registerCommand(RCommandIds.showRVersion, async () => {
            await showRVersion(services);
        }),
        new vscode.Disposable(() => {
            void context.workspaceState.update('ark.r.commandsDisposedAt', Date.now());
        }),
    ];
}

export async function loadRDataFile(
    services: ILanguageContributionServices,
    resource: vscode.Uri,
): Promise<void> {
    const filePath = await getFilePathForCommand(resource);
    if (!filePath) {
        throw new Error(`File not found or invalid path: ${resource.toString()}`);
    }

    await executeRCode(services, `load(${quoteRString(filePath)})`, {
        focus: true,
        source: 'r.loadRDataFile',
        fileUri: resource,
    });
}

export async function loadRdsFileWithVariable(
    services: ILanguageContributionServices,
    resource: vscode.Uri,
    variableName?: string,
): Promise<string> {
    const filePath = await getFilePathForCommand(resource);
    if (!filePath) {
        throw new Error(`File not found or invalid path: ${resource.toString()}`);
    }

    const name = variableName || defaultRVariableName(filePath);
    await executeRCode(services, `${name} <- readRDS(${quoteRString(filePath)})`, {
        focus: true,
        source: 'r.loadRdsFile',
        fileUri: resource,
    });
    return name;
}

async function executePackageCommand(
    services: ILanguageContributionServices,
    requiredPackage: string,
    code: string,
): Promise<void> {
    const guardedCode = [
        `if (!requireNamespace(${quoteRString(requiredPackage)}, quietly = TRUE)) {`,
        `  stop("Package ${requiredPackage} is required. Install it with install.packages(\\"${requiredPackage}\\").")`,
        '}',
        code,
    ].join('\n');

    await executeRCode(services, guardedCode, {
        focus: true,
        source: 'r.packageCommand',
        mode: RuntimeCodeExecutionModeValue.NonInteractive,
    });
}

async function sourceCurrentFile(
    services: ILanguageContributionServices,
    echo: boolean,
    resource?: vscode.Uri,
): Promise<void> {
    const filePath = await getFilePathForCommand(resource);
    if (!filePath) {
        vscode.window.showWarningMessage('Cannot source a file that has not been saved.');
        return;
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    if (document.isDirty) {
        await document.save();
    }

    await executeRCode(
        services,
        `source(${quoteRString(filePath)}${echo ? ', echo = TRUE' : ''})`,
        {
            focus: false,
            source: echo ? 'r.sourceCurrentFileWithEcho' : 'r.sourceCurrentFile',
            fileUri: vscode.Uri.file(filePath),
        },
    );
}

async function renderRMarkdown(
    services: ILanguageContributionServices,
    resource?: vscode.Uri,
): Promise<void> {
    const filePath = await getFilePathForCommand(resource);
    if (!filePath) {
        vscode.window.showWarningMessage('Cannot render a file that has not been saved.');
        return;
    }

    const code = [
        'if (!requireNamespace("rmarkdown", quietly = TRUE)) {',
        '  stop("Package rmarkdown is required. Install it with install.packages(\\"rmarkdown\\").")',
        '}',
        `rmarkdown::render(${quoteRString(filePath)})`,
    ].join('\n');

    await executeRCode(services, code, {
        focus: true,
        source: 'r.rmarkdownRender',
        fileUri: vscode.Uri.file(filePath),
    });
}

async function loadRDataFileWithPicker(services: ILanguageContributionServices): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Load',
        title: 'Select R Data File to Load',
        filters: {
            'R Data Files': ['RData', 'Rdata', 'rdata', 'rda', 'rds', 'RDS'],
        },
    });

    const uri = selected?.[0];
    if (!uri) {
        return;
    }

    if (path.extname(uri.fsPath).toLowerCase() === '.rds') {
        await vscode.commands.executeCommand('vscode.openWith', uri, 'vscode-ark.rdsLoader');
    } else {
        await loadRDataFile(services, uri);
    }
}

async function showRVersion(services: ILanguageContributionServices): Promise<void> {
    const result = await evaluateRCode(services, 'as.list(R.version)');
    if (!result) {
        return;
    }

    const version = result.result as Record<string, string>;
    const lines = [
        version['version.string'],
        version.platform ? `Platform: ${version.platform}` : undefined,
        version.arch ? `Architecture: ${version.arch}` : undefined,
        version.os ? `OS: ${version.os}` : undefined,
        version.nickname ? `Nickname: "${version.nickname}"` : undefined,
    ].filter((line): line is string => !!line);

    await vscode.window.showInformationMessage(lines.join('\n'), { modal: true });
}

async function insertSection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    const sectionName = await vscode.window.showInputBox({
        placeHolder: 'Section label',
        prompt: 'Enter the name of the section to insert',
    });
    if (!sectionName) {
        return;
    }

    const rulers = vscode.workspace.getConfiguration('editor').get<Array<number>>('rulers');
    const targetWidth = rulers && rulers.length > 0 ? rulers[0] - 5 : 75;
    let section = `\n# ${sectionName} `;
    section += '-'.repeat(Math.max(4, targetWidth - section.length));
    section += '\n\n';

    await editor.edit(editBuilder => {
        editBuilder.replace(editor.selection, editor.document.getText(editor.selection) + section);
    });
}
