import * as vscode from 'vscode';
import type {
    ISupervisorFrameworkApi,
} from './types/supervisor-api';
import { registerArkDebugAdapterFactory } from './debugger';
import { RLanguageContribution } from './rLanguageContribution';
import { disposeLspOutputChannel } from './runtime/lsp';
import { RedactingLogOutputChannel } from './logging';

const SUPERVISOR_EXTENSION_ID = 'mengzhiya.vscode-supervisor';

function ensureCompatibleSupervisorApi(api: ISupervisorFrameworkApi): void {
    if (api.apiVersion !== 2 ||
        api.protocolVersion?.major !== 2 ||
        !api.capabilities?.includes('languageCapabilityRegistry') ||
        typeof api.languages?.forExtension !== 'function') {
        throw new Error(
            `Extension '${SUPERVISOR_EXTENSION_ID}' does not expose the required Supervisor Language API. ` +
            'Update vscode-supervisor and retry.',
        );
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const supervisorExtension = vscode.extensions.getExtension<ISupervisorFrameworkApi>(SUPERVISOR_EXTENSION_ID);
    if (!supervisorExtension) {
        throw new Error(`Required extension '${SUPERVISOR_EXTENSION_ID}' is not installed`);
    }

    const api = await supervisorExtension.activate();
    ensureCompatibleSupervisorApi(api);
    const logChannel = new RedactingLogOutputChannel(
        vscode.window.createOutputChannel('R Language Pack', { log: true }),
    );
    context.subscriptions.push(logChannel);
    context.subscriptions.push(new vscode.Disposable(disposeLspOutputChannel));
    logChannel.info(`Log level: ${vscode.LogLevel[logChannel.logLevel]}`);
    context.subscriptions.push(logChannel.onDidChangeLogLevel((level) => {
        logChannel.info(`Log level changed to: ${vscode.LogLevel[level]}`);
    }));
    context.subscriptions.push(registerArkDebugAdapterFactory());

    const contribution = new RLanguageContribution(context, api, logChannel);
    contribution.runtimeProvider.initializeNativeDiscovery(context, logChannel);

    const builder = api.languages
        .forExtension(context.extension.id)
        .begin({
            languageId: contribution.runtimeProvider.languageId,
            registrationId: 'core',
            revision: 1,
        })
        .setLogChannel(logChannel)
        .setRuntimeProvider(contribution.runtimeProvider)
        .setSessionManager(contribution.getRuntimeSessionManager())
        .setLspFactory(contribution.runtimeProvider.lspFactory)
        .setBinaryProvider(contribution.binaryProvider);
    for (const descriptor of contribution.getOptionalCapabilities()) {
        builder.addOptionalCapability(descriptor);
    }
    context.subscriptions.push(builder.commit());
}

export function deactivate(): void {
    return;
}
