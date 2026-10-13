import * as fs from 'fs';
import * as vscode from 'vscode';
import { findReposConf } from './runtime/kernel-spec';
import type { PersistedRMetadataExtra } from './runtime/r-installation';

const PUBLIC_PPM_CRAN_REPO = 'https://packagemanager.posit.co/cran/latest';

function parseReposConf(filePath: string): string {
    const contents = fs.readFileSync(filePath, 'utf8');
    let firstUrl: string | undefined;
    for (const line of contents.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) { continue; }
        const separator = trimmed.indexOf('=');
        if (separator < 0) { continue; }
        const name = trimmed.slice(0, separator).trim();
        const url = trimmed.slice(separator + 1).trim();
        if (!/^https?:\/\//.test(url)) { continue; }
        const normalized = url.replace(/\/+$/, '');
        if (name.toUpperCase() === 'CRAN') { return normalized; }
        firstUrl ??= normalized;
    }
    if (firstUrl) { return firstUrl; }
    // An unreadable or unrecognized configured repository is not the public default.
    throw new Error('Could not resolve an HTTP repository from the configured repos.conf.');
}

/** Matches the launch precedence in createJupyterKernelSpec. */
export function resolveRRepositoryUrl(metadata?: PersistedRMetadataExtra): string | undefined {
    const repo = metadata?.retPayload?.rversionsOverlay?.repo;
    if (repo) {
        if (/^https?:\/\//.test(repo)) { return repo.replace(/\/+$/, ''); }
        if (fs.existsSync(repo) && fs.statSync(repo).isFile()) { return parseReposConf(repo); }
    }

    const config = vscode.workspace.getConfiguration('ark');
    const defaults = config.get<string>('defaultRepositories') ?? 'auto';
    if (defaults === 'posit-ppm') { return PUBLIC_PPM_CRAN_REPO; }
    if (defaults !== 'auto') { return undefined; }

    const reposConf = findReposConf();
    if (reposConf) { return parseReposConf(reposConf); }
    const configured = config.get<string>('packageManagerRepository')?.trim();
    if (configured) { return configured.replace(/\/+$/, ''); }
    return vscode.env.uiKind === vscode.UIKind.Web ? PUBLIC_PPM_CRAN_REPO : undefined;
}
