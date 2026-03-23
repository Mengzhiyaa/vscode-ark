import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export { closeAllEditors, openTextDocument } from './kit-vscode';
export { pollForSuccess, assertSelectedEditor } from './kit-assertions';
export { toDisposable, disposeAll, withDisposables, makeTempDir, retryRm } from './kit-disposables';

export function mock<T>(obj: Partial<T>): T {
    return obj as T;
}

export function createUniqueId(): string {
    return Math.floor(Math.random() * 0x100000000).toString(16);
}

/**
 * Normalize a file path for robust comparison (realpath, normalize, lower-case).
 */
export function normalizePath(p: string): string {
    const normalized = path.normalize(p);
    const real = fs.existsSync(normalized) ? fs.realpathSync.native(normalized) : normalized;
    return process.platform === 'win32' ? real.toLowerCase() : real;
}

/**
 * Normalize a vscode.Uri for robust comparison.
 */
export function normalizeUri(uri: vscode.Uri): string {
    return uri.scheme === 'file'
        ? normalizePath(uri.fsPath)
        : uri.toString();
}
