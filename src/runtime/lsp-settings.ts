import * as vscode from 'vscode';
import { Trace } from 'vscode-languageclient/node';

export type ArkLspTraceLevel = 'off' | 'messages' | 'verbose';

export interface ArkLspSettings {
    diagnostics: {
        enable: boolean;
    };
    symbols: {
        includeAssignmentsInBlocks: boolean;
    };
    workspaceSymbols: {
        includeCommentSections: boolean;
    };
    trace: {
        server: ArkLspTraceLevel;
    };
}

export interface ArkLspSettingOverrides {
    diagnosticsEnable?: unknown;
    includeAssignmentsInBlocks?: unknown;
    includeCommentSections?: unknown;
    traceServer?: unknown;
}

export const DEFAULT_ARK_LSP_SETTINGS: ArkLspSettings = {
    diagnostics: {
        enable: true,
    },
    symbols: {
        includeAssignmentsInBlocks: false,
    },
    workspaceSymbols: {
        includeCommentSections: false,
    },
    trace: {
        server: 'off',
    },
};

const CANONICAL_CONFIGURATION_SECTION = 'ark.lsp';
const LEGACY_CONFIGURATION_SECTION = 'positron.r';

function booleanSetting(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function traceSetting(value: unknown, fallback: ArkLspTraceLevel): ArkLspTraceLevel {
    return value === 'off' || value === 'messages' || value === 'verbose'
        ? value
        : fallback;
}

/**
 * Merge canonical Ark settings with Positron-compatible settings.
 *
 * Canonical settings always win when explicitly supplied. Legacy values are
 * retained so existing workspaces can migrate without changing behavior.
 */
export function mergeArkLspSettings(
    canonical: ArkLspSettingOverrides,
    legacy: ArkLspSettingOverrides = {},
): ArkLspSettings {
    return {
        diagnostics: {
            enable: booleanSetting(
                canonical.diagnosticsEnable ?? legacy.diagnosticsEnable,
                DEFAULT_ARK_LSP_SETTINGS.diagnostics.enable,
            ),
        },
        symbols: {
            includeAssignmentsInBlocks: booleanSetting(
                canonical.includeAssignmentsInBlocks ?? legacy.includeAssignmentsInBlocks,
                DEFAULT_ARK_LSP_SETTINGS.symbols.includeAssignmentsInBlocks,
            ),
        },
        workspaceSymbols: {
            includeCommentSections: booleanSetting(
                canonical.includeCommentSections ?? legacy.includeCommentSections,
                DEFAULT_ARK_LSP_SETTINGS.workspaceSymbols.includeCommentSections,
            ),
        },
        trace: {
            server: traceSetting(
                canonical.traceServer ?? legacy.traceServer,
                DEFAULT_ARK_LSP_SETTINGS.trace.server,
            ),
        },
    };
}

function hasExplicitValue<T>(inspection: ReturnType<vscode.WorkspaceConfiguration['inspect']>): boolean {
    if (!inspection) {
        return false;
    }

    return Object.entries(inspection).some(([key, value]) =>
        key !== 'key' && key !== 'defaultValue' && value !== undefined,
    );
}

function explicitSetting<T>(
    section: string,
    key: string,
    resource?: vscode.Uri,
): T | undefined {
    const configuration = vscode.workspace.getConfiguration(section, resource);
    const inspection = configuration.inspect<T>(key);
    return hasExplicitValue<T>(inspection) ? configuration.get<T>(key) : undefined;
}

function readOverrides(section: string, resource?: vscode.Uri): ArkLspSettingOverrides {
    return {
        diagnosticsEnable: explicitSetting<boolean>(section, 'diagnostics.enable', resource),
        includeAssignmentsInBlocks: explicitSetting<boolean>(
            section,
            'symbols.includeAssignmentsInBlocks',
            resource,
        ),
        includeCommentSections: explicitSetting<boolean>(
            section,
            'workspaceSymbols.includeCommentSections',
            resource,
        ),
        traceServer: explicitSetting<ArkLspTraceLevel>(section, 'trace.server', resource),
    };
}

/** Resolve effective LSP settings for a resource, preferring `ark.lsp.*`. */
export function getArkLspSettings(resource?: vscode.Uri): ArkLspSettings {
    return mergeArkLspSettings(
        readOverrides(CANONICAL_CONFIGURATION_SECTION, resource),
        readOverrides(LEGACY_CONFIGURATION_SECTION, resource),
    );
}

function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

/**
 * Overlay Ark's canonical settings onto configuration values requested by the
 * Ark language server. The server currently asks for `positron.r.*` sections,
 * so both the legacy and canonical prefixes are recognized.
 */
export function mapArkLspConfiguration(
    section: string | undefined,
    fallback: unknown,
    settings: ArkLspSettings,
): unknown {
    const prefix = section === CANONICAL_CONFIGURATION_SECTION || section?.startsWith(`${CANONICAL_CONFIGURATION_SECTION}.`)
        ? CANONICAL_CONFIGURATION_SECTION
        : section === LEGACY_CONFIGURATION_SECTION || section?.startsWith(`${LEGACY_CONFIGURATION_SECTION}.`)
            ? LEGACY_CONFIGURATION_SECTION
            : undefined;

    if (!prefix) {
        return fallback;
    }

    const relativeSection = section === prefix ? '' : section!.slice(prefix.length + 1);
    switch (relativeSection) {
        case 'diagnostics.enable':
            return settings.diagnostics.enable;
        case 'symbols.includeAssignmentsInBlocks':
            return settings.symbols.includeAssignmentsInBlocks;
        case 'workspaceSymbols.includeCommentSections':
            return settings.workspaceSymbols.includeCommentSections;
        case 'trace.server':
            return settings.trace.server;
        case 'diagnostics':
            return {
                ...asRecord(fallback),
                ...settings.diagnostics,
            };
        case 'symbols':
            return {
                ...asRecord(fallback),
                ...settings.symbols,
            };
        case 'workspaceSymbols':
            return {
                ...asRecord(fallback),
                ...settings.workspaceSymbols,
            };
        case 'trace':
            return {
                ...asRecord(fallback),
                ...settings.trace,
            };
        case '': {
            const root = asRecord(fallback);
            return {
                ...root,
                diagnostics: {
                    ...asRecord(root.diagnostics),
                    ...settings.diagnostics,
                },
                symbols: {
                    ...asRecord(root.symbols),
                    ...settings.symbols,
                },
                workspaceSymbols: {
                    ...asRecord(root.workspaceSymbols),
                    ...settings.workspaceSymbols,
                },
                trace: {
                    ...asRecord(root.trace),
                    ...settings.trace,
                },
            };
        }
        default:
            return fallback;
    }
}

export function toLanguageClientTrace(level: ArkLspTraceLevel): Trace {
    switch (level) {
        case 'messages':
            return Trace.Messages;
        case 'verbose':
            return Trace.Verbose;
        case 'off':
        default:
            return Trace.Off;
    }
}
