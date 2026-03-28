import * as vscode from 'vscode';
import type { NativeRFinder } from './native-r-finder';
import { convertNativeEnvToRInstallation, type RInstallation } from './r-installation';

let nativeRFinder: NativeRFinder | undefined;

export function setNativeRFinder(finder: NativeRFinder | undefined): void {
    nativeRFinder = finder;
}

export function hasNativeRFinder(): boolean {
    return !!nativeRFinder?.available;
}

export async function* discoverRetInstallations(
    log: vscode.LogOutputChannel,
): AsyncGenerator<RInstallation> {
    if (!nativeRFinder?.available) {
        return;
    }

    log.info('[rRuntimeDiscoverer] Using native RET discovery');

    for await (const env of nativeRFinder.refresh()) {
        const installation = convertNativeEnvToRInstallation(env);
        if (!installation) {
            if (env.error) {
                log.warn(`[rRuntimeDiscoverer] Ignoring RET result: ${env.error}`);
            }
            continue;
        }

        log.debug(
            `[rRuntimeDiscoverer] Yielding RET R ${installation.version} ` +
            `(${env.kind ?? 'unknown'}) at ${installation.binpath}`
        );
        yield installation;
    }
}

export async function getBestRetInstallation(
    log: vscode.LogOutputChannel,
): Promise<RInstallation | undefined> {
    for await (const installation of discoverRetInstallations(log)) {
        if (installation.usable) {
            return installation;
        }
    }

    return undefined;
}
