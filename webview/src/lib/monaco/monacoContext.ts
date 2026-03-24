export type MonacoApi = typeof import("monaco-editor");

let injectedMonaco: MonacoApi | undefined;

export function setInjectedMonaco(monaco: MonacoApi): void {
    injectedMonaco = monaco;
}

export function getInjectedMonaco(): MonacoApi {
    if (!injectedMonaco) {
        throw new Error(
            "[rMonacoSupport] Monaco runtime has not been injected yet.",
        );
    }

    return injectedMonaco;
}
