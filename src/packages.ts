import * as vscode from 'vscode';
import type {
    ILanguageContributionServices,
    ILanguageRuntimePackageManager,
    ILanguageRuntimeSession,
    LanguageRuntimePackage,
    PackageSpec,
    PackageRepositoryRequest,
    PackageRepositoryResponse,
} from './types/supervisor-api';
import { resolveRRepositoryUrl } from './packageRepository';
import { requestPackageRepository } from './packageRepositoryRequest';
import type { PersistedRMetadataExtra } from './runtime/r-installation';
import {
    RuntimeCodeExecutionModeValue,
    RuntimeErrorBehaviorValue,
} from './rExecution';

interface RPackageInstallation {
    packageName: string;
    packageVersion: string;
    minimumVersion: string;
    compatible: boolean;
}

export class RPackageManager implements ILanguageRuntimePackageManager {
    private _pakRecommendationShown = false;
    private _isRenvProject: boolean | undefined;
    private _renvProbe: Promise<boolean> | undefined;
    private _renvGeneration = 0;
    private readonly _runtimeSubscription: vscode.Disposable | undefined;

    constructor(
        private readonly _session: ILanguageRuntimeSession,
        private readonly _services: ILanguageContributionServices,
    ) {
        this._runtimeSubscription = _session.onDidChangeRuntimeState?.(state => {
            if (['starting', 'restarting', 'exited'].includes(String(state))) {
                this._isRenvProject = undefined;
                this._renvProbe = undefined;
                this._renvGeneration++;
            }
        });
    }

    dispose(): void {
        this._runtimeSubscription?.dispose();
        this._renvGeneration++;
    }

    async getPackages(token?: vscode.CancellationToken): Promise<LanguageRuntimePackage[]> {
        this._throwIfCancellationRequested(token);
        const method = await this._getPackageMethod();
        const result = await this._callMethod<LanguageRuntimePackage[] | null>(
            'pkg_list',
            token,
            method,
        ) ?? [];
        result.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        return result;
    }

    async getPackageDetail(name: string, token?: vscode.CancellationToken): Promise<Partial<LanguageRuntimePackage> | undefined> {
        this._throwIfCancellationRequested(token);
        if (!name.trim()) { return undefined; }
        this._validatePackageName(name);
        const detail = await this._callMethod<(Partial<LanguageRuntimePackage> & { sourceRepository?: string }) | null>(
            'pkg_detail', token, name,
        );
        if (!detail) { return undefined; }
        return {
            ...detail,
            ...(detail.sourceRepository && !detail.source ? { source: detail.sourceRepository } : {}),
        };
    }

    async packageRepositoryUrl(token?: vscode.CancellationToken): Promise<string | undefined> {
        this._throwIfCancellationRequested(token);
        return resolveRRepositoryUrl(this._session.runtimeMetadata.extraRuntimeData as PersistedRMetadataExtra | undefined);
    }

    repositoryRequest(request: PackageRepositoryRequest, token?: vscode.CancellationToken): Promise<PackageRepositoryResponse> {
        return requestPackageRepository(request, token);
    }

    async getPackageMetadata(
        packageNames: string[],
        token?: vscode.CancellationToken,
    ): Promise<Map<string, Partial<LanguageRuntimePackage>>> {
        const outdated = await this._getOutdatedVersions(token);
        const metadata = new Map<string, Partial<LanguageRuntimePackage>>();

        for (const name of packageNames) {
            const latestVersion = outdated.get(name) ?? outdated.get(name.toLowerCase());
            metadata.set(name.toLowerCase(), {
                outdated: latestVersion !== undefined,
                ...(latestVersion ? { latestVersion } : {}),
            });
        }

        return metadata;
    }

    async installPackages(packages: PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
        this._throwIfCancellationRequested(token);
        this._validatePackageSpecs(packages);

        const isRenv = await this._detectRenv();
        let code: string;

        if (isRenv) {
            const pkgVector = this._formatRVector(this._toPackageSpecStrings(packages));
            code = `renv::install(${pkgVector}, prompt = FALSE)`;
        } else {
            const installingPak = packages.some(pkg => pkg.name === 'pak');
            const method = await this._resolveMethod(!installingPak);
            if (method === 'pak') {
                const pkgVector = this._formatRVector(this._toPackageSpecStrings(packages));
                code = `pak::pkg_install(${pkgVector}, ask = FALSE)`;
            } else {
                const pkgVector = this._formatRVector(packages.map(pkg => pkg.name));
                code = `install.packages(${pkgVector})`;
            }
        }

        await this._execute(code, token);
        this._afterPackageOperation(isRenv);
        this._invalidatePackageResourceCaches();
    }

    async uninstallPackages(packageNames: string[], token?: vscode.CancellationToken): Promise<void> {
        this._throwIfCancellationRequested(token);
        for (const packageName of packageNames) {
            this._validatePackageName(packageName);
        }

        const isRenv = await this._detectRenv();
        const pkgVector = this._formatRVector(packageNames);
        let code: string;

        if (isRenv) {
            code = `renv::remove(${pkgVector})`;
        } else {
            const method = await this._resolveMethod(false);
            code = method === 'pak'
                ? `pak::pkg_remove(${pkgVector})`
                : `remove.packages(${pkgVector})`;
        }

        await this._execute(code, token);

        try {
            const unloadCode = packageNames
                .map(pkg => `try(unloadNamespace(${JSON.stringify(pkg)}), silent = TRUE)`)
                .join('; ');
            await this._executeSilently(unloadCode);
        } catch {
            // Ignore namespace unloading failures.
        }

        this._afterPackageOperation(isRenv);
        this._invalidatePackageResourceCaches();
    }

    async updatePackages(packages: PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
        this._throwIfCancellationRequested(token);
        this._validatePackageSpecs(packages);

        const isRenv = await this._detectRenv();
        let code: string;

        if (isRenv) {
            const pkgVector = this._formatRVector(this._toPackageSpecStrings(packages));
            code = `renv::install(${pkgVector}, prompt = FALSE)`;
        } else {
            const method = await this._resolveMethod(true);
            if (method === 'pak') {
                const pkgVector = this._formatRVector(this._toPackageSpecStrings(packages));
                code = `pak::pkg_install(${pkgVector}, ask = FALSE)`;
            } else {
                const pkgVector = this._formatRVector(packages.map(pkg => pkg.name));
                code = `install.packages(${pkgVector})`;
            }
        }

        await this._execute(code, token);
        this._afterPackageOperation(isRenv);
        this._invalidatePackageResourceCaches();
    }

    async updateAllPackages(token?: vscode.CancellationToken): Promise<void> {
        this._throwIfCancellationRequested(token);

        if (await this._detectRenv()) {
            await this._execute('renv::update(prompt = FALSE)', token);
            this._afterPackageOperation(true);
            this._invalidatePackageResourceCaches();
            return;
        }

        const method = await this._resolveMethod(true);
        if (method === 'pak') {
            const outdated = await this._getOutdatedPackages(token);
            if (outdated.length > 0) {
                const pkgVector = this._formatRVector(outdated.map(pkg => pkg.name));
                await this._execute(`pak::pkg_install(${pkgVector}, ask = FALSE)`, token);
            }
        } else {
            await this._execute('update.packages(ask = FALSE)', token);
        }

        this._afterPackageOperation(false);
        this._invalidatePackageResourceCaches();
    }

    async searchPackages(query: string, token?: vscode.CancellationToken): Promise<LanguageRuntimePackage[]> {
        this._throwIfCancellationRequested(token);
        const method = await this._resolveMethod(false);
        return await this._callMethod<LanguageRuntimePackage[] | null>(
            'pkg_search',
            token,
            query,
            method,
        ) ?? [];
    }

    async searchPackageVersions(name: string, token?: vscode.CancellationToken): Promise<string[]> {
        this._throwIfCancellationRequested(token);
        this._validatePackageName(name);
        return await this._callMethod<string[] | null>(
            'pkg_search_versions',
            token,
            name,
        ) ?? [];
    }

    private async _getOutdatedVersions(token?: vscode.CancellationToken): Promise<Map<string, string>> {
        try {
            const outdated = await this._getOutdatedPackages(token);
            const versions = new Map<string, string>();
            for (const pkg of outdated) {
                versions.set(pkg.name, pkg.latestVersion);
                versions.set(pkg.name.toLowerCase(), pkg.latestVersion);
            }
            return versions;
        } catch (error) {
            this._services.logChannel.warn(`[R Packages] Failed to fetch outdated package list: ${error}`);
            return new Map();
        }
    }

    private async _getOutdatedPackages(
        token?: vscode.CancellationToken,
    ): Promise<Array<{ name: string; latestVersion: string }>> {
        return await this._callMethod<Array<{ name: string; latestVersion: string }> | null>(
            'pkg_outdated',
            token,
        ) ?? [];
    }

    private async _detectPak(): Promise<boolean> {
        try {
            const pak = await this._packageVersion('pak');
            return pak?.compatible ?? false;
        } catch (error) {
            this._services.logChannel.debug(`[R Packages] Failed to detect pak: ${error}`);
            return false;
        }
    }

    private async _detectRenv(): Promise<boolean> {
        if (this._isRenvProject !== undefined) { return this._isRenvProject; }
        if (this._renvProbe) { return this._renvProbe; }
        const generation = this._renvGeneration;
        const probe: Promise<boolean> = this._session.evaluate(
            'if (requireNamespace("renv", quietly = TRUE)) !is.null(renv::project()) else FALSE',
        ).then(result => {
            const value = result.result === true;
            if (generation === this._renvGeneration) { this._isRenvProject = value; }
            return value;
        }).catch(() => false).finally(() => {
            if (this._renvProbe === probe) { this._renvProbe = undefined; }
        });
        this._renvProbe = probe;
        return probe;
    }

    private _getConfiguredInstaller(): 'auto' | 'pak' | 'base' {
        const value = vscode.workspace.getConfiguration('packages.r').get<string>('installer');
        return value === 'pak' || value === 'base' ? value : 'auto';
    }

    private async _getPackageMethod(): Promise<string> {
        if (await this._detectRenv()) {
            return 'renv';
        }
        return this._resolveMethod(false);
    }

    /** Follow-up work must never change the result of the completed operation. */
    private _afterPackageOperation(isRenv: boolean): void {
        if (isRenv) {
            if (!vscode.workspace.getConfiguration('packages.r').get<boolean>('renvAutoSnapshot', true)) {
                return;
            }
            void this._execute('renv::snapshot(prompt = FALSE)').catch(error => {
                this._services.logChannel.warn(`[R Packages] Failed to update renv.lock: ${error}`);
                void vscode.window.showWarningMessage(
                    'Failed to update the renv lockfile with renv::snapshot(). Your renv.lock file may be out of date.',
                );
            });
        } else {
            void this._maybeRecommendPak().catch(error => {
                this._services.logChannel.warn(`[R Packages] Failed to recommend or install pak: ${error}`);
            });
        }
    }

    private async _maybeRecommendPak(): Promise<void> {
        if (this._pakRecommendationShown || this._getConfiguredInstaller() !== 'auto' || await this._detectPak()) {
            return;
        }
        // Recheck after the probe so concurrent operations cannot show two prompts.
        if (this._pakRecommendationShown) {
            return;
        }
        this._pakRecommendationShown = true;
        const install = 'Install pak';
        const openSettings = 'Open Settings';
        const result = await vscode.window.showInformationMessage(
            'The pak package provides faster and more reliable package operations. Would you like to install it?',
            install,
            openSettings,
        );
        if (result === install) {
            await this._execute('install.packages("pak")');
            this._invalidatePackageResourceCaches();
        } else if (result === openSettings) {
            await vscode.commands.executeCommand('workbench.action.openSettings', '@id:packages.r.installer');
        }
    }

    private async _resolveMethod(allowInstallPak: boolean): Promise<string> {
        const setting = this._getConfiguredInstaller();
        if (setting === 'base') {
            return 'base';
        }

        if (await this._detectPak()) {
            return 'pak';
        }

        if (!allowInstallPak) {
            return 'base';
        }

        if (setting === 'pak') {
            await this._execute('install.packages("pak")');
            return (await this._detectPak()) ? 'pak' : 'base';
        }

        // Auto uses base R now; recommend pak after the operation has completed.
        return 'base';
    }

    private _validatePackageSpecs(packages: PackageSpec[]): void {
        for (const pkg of packages) {
            this._validatePackageName(pkg.name);
        }
    }

    private _validatePackageName(name: string): void {
        if (!/^[a-zA-Z]([a-zA-Z0-9.]*[a-zA-Z0-9])?$/.test(name)) {
            throw new Error(`Invalid R package name: "${name}". Package names must start with a letter, contain only letters, numbers, and periods, and cannot end with a period.`);
        }
    }

    private _toPackageSpecStrings(packages: PackageSpec[]): string[] {
        return packages.map(pkg => pkg.version ? `${pkg.name}@${pkg.version}` : pkg.name);
    }

    private _formatRVector(items: string[]): string {
        return `c(${items.map(item => JSON.stringify(item)).join(', ')})`;
    }

    private async _execute(code: string, token?: vscode.CancellationToken): Promise<void> {
        await this._session.executeAndWait(
            code,
            {
                mode: RuntimeCodeExecutionModeValue.NonInteractive,
                errorBehavior: RuntimeErrorBehaviorValue.Continue,
                attribution: { source: 'r.packages' },
            },
            token,
        );
    }

    private async _executeSilently(code: string, token?: vscode.CancellationToken): Promise<void> {
        await this._session.executeAndWait(
            code,
            {
                mode: RuntimeCodeExecutionModeValue.Silent,
                errorBehavior: RuntimeErrorBehaviorValue.Continue,
                attribution: { source: 'r.packages' },
            },
            token,
        );
    }

    private async _callMethod<T>(
        method: string,
        token: vscode.CancellationToken | undefined,
        ...args: unknown[]
    ): Promise<T> {
        this._throwIfCancellationRequested(token);
        const resultPromise = this._session.callMethod(method, ...args) as Promise<T>;

        if (!token) {
            return resultPromise;
        }

        return new Promise<T>((resolve, reject) => {
            let completed = false;
            const finish = (error?: unknown, value?: T) => {
                if (completed) {
                    return;
                }
                completed = true;
                cancellationDisposable.dispose();
                if (error) {
                    reject(error);
                } else {
                    resolve(value as T);
                }
            };

            const cancellationDisposable = token.onCancellationRequested(() => {
                void this._services.runtimeSessionService.interruptSession(this._session.sessionId)
                    .catch(error => {
                        this._services.logChannel.warn(`[R Packages] Failed to interrupt cancelled method ${method}: ${error}`);
                    });
                finish(new vscode.CancellationError());
            });

            resultPromise.then(
                result => finish(undefined, result),
                error => finish(error),
            );
        });
    }

    private async _packageVersion(
        pkgName: string,
        minimumVersion?: string,
    ): Promise<RPackageInstallation | null> {
        const pkg = await this._callMethod<{ version: string | null; compatible: boolean }>(
            'packageVersion',
            undefined,
            pkgName,
            minimumVersion ?? null,
        );

        if (pkg.version === null) {
            return null;
        }

        return {
            packageName: pkgName,
            packageVersion: pkg.version,
            minimumVersion: minimumVersion ?? '0.0.0',
            compatible: pkg.compatible,
        };
    }

    private _throwIfCancellationRequested(token?: vscode.CancellationToken): void {
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
    }

    private _invalidatePackageResourceCaches(): void {
        // Positron invalidates cached package resources here. vscode-ark does not
        // currently cache package-backed resources outside the runtime.
    }
}
