import * as vscode from 'vscode';
import type { ILanguageContributionServices } from './types/supervisor-api';
import { executeRCode } from './rExecution';

export function registerUriHandler(
    services: ILanguageContributionServices,
): vscode.Disposable {
    return vscode.window.registerUriHandler({
        handleUri: async (uri) => {
            if (uri.path !== '/cli') {
                return;
            }

            const command = new URLSearchParams(uri.query).get('command');
            const match = command?.match(/^(x-r-(help|run|vignette)):(.+)$/);
            if (!match) {
                return;
            }

            const kind = match[1];
            const payload = decodeURIComponent(match[3]);

            if (kind === 'x-r-help') {
                await services.positronHelpService.showHelpTopic('r', payload);
                return;
            }

            if (kind === 'x-r-vignette') {
                await executeRCode(services, `utils::vignette(${JSON.stringify(payload)})`, {
                    focus: true,
                    source: 'r.uri.vignette',
                });
                return;
            }

            await executeRCode(services, payload, {
                focus: true,
                source: 'r.uri.run',
            });
        },
    });
}
