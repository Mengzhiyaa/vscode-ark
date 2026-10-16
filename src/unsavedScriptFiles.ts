import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

/** Immutable snapshots survive editor closure and other queued runs. */
export class UnsavedScriptFiles implements vscode.Disposable {
    private readonly _files = new Set<string>();
    private _disposed = false;

    async write(document: vscode.TextDocument): Promise<string> {
        const source = document.getText();
        const base = path.basename(document.uri.path).replace(/[^\w.-]/g, '_').toLowerCase();
        const name = `.supervisor-${base}-${randomUUID()}.R`;
        const workspace = vscode.workspace.workspaceFolders?.find(folder => folder.uri.scheme === 'file')?.uri.fsPath;
        let file = path.join(workspace ?? os.tmpdir(), name);
        try {
            await fs.writeFile(file, source, 'utf8');
        } catch (error) {
            if (!workspace) { throw error; }
            file = path.join(os.tmpdir(), name);
            await fs.writeFile(file, source, 'utf8');
        }
        if (this._disposed) {
            await fs.rm(file, { force: true });
            throw new vscode.CancellationError();
        }
        this._files.add(file);
        return file;
    }

    async finished(file: string): Promise<void> {
        if (!this._files.delete(file)) { return; }
        try {
            await fs.rm(file, { force: true });
        } catch (error) {
            console.warn(`Cannot delete R scratch script '${file}': ${error}`);
        }
    }

    dispose(): void {
        this._disposed = true;
        for (const file of this._files) { void this.finished(file); }
    }
}
