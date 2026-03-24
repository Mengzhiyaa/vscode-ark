import * as vscode from 'vscode';

const ARK_DEBUG_TYPE = 'ark';
const DEFAULT_DEBUG_HOST = '127.0.0.1';

export function registerArkDebugAdapterFactory(): vscode.Disposable {
    return vscode.debug.registerDebugAdapterDescriptorFactory(ARK_DEBUG_TYPE, {
        createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
            const debugServer = (session.configuration as vscode.DebugConfiguration | undefined)?.debugServer;
            if (typeof debugServer !== 'number') {
                return undefined;
            }

            const host = typeof session.configuration.host === 'string'
                ? session.configuration.host
                : DEFAULT_DEBUG_HOST;
            return new vscode.DebugAdapterServer(debugServer, host);
        },
    });
}
