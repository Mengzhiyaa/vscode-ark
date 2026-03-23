import * as monaco from "monaco-editor/esm/vs/editor/edcore.main";
// Note: We do NOT import "monaco-editor/min/vs/editor/editor.main.css" here.
// The ESM modules imported below bring their own CSS through side-effect imports,
// and importing the full min CSS would duplicate the codicon @font-face (~159 KB wasted).

import EditorWorkerUrl from "monaco-editor/esm/vs/editor/editor.worker?worker&url";

type MonacoEnv = {
    MonacoEnvironment?: { getWorker: (id: string, label: string) => Worker };
};

let runtimeInitialized = false;
let readyMonaco: typeof monaco | undefined;
let initPromise: Promise<typeof monaco> | undefined;

function configureMonacoEnvironment(): void {
    (globalThis as MonacoEnv).MonacoEnvironment = {
        getWorker(_: string, _label: string) {
            // Use Blob URL to work around cross-origin restrictions
            // in VS Code Remote SSH webviews where the webview origin
            // (vscode-webview://) differs from the resource origin
            // (vscode-remote+ssh://).
            const blob = new Blob(
                [`importScripts(${JSON.stringify(EditorWorkerUrl)});`],
                { type: "application/javascript" },
            );
            return new Worker(URL.createObjectURL(blob));
        },
    };
}

function exposeMonacoOnWindow(): void {
    if (typeof window !== "undefined") {
        (window as unknown as { monaco: typeof monaco }).monaco = monaco;
    }
}

function initializeMonacoRuntime(): typeof monaco {
    if (runtimeInitialized && readyMonaco) {
        return readyMonaco;
    }

    configureMonacoEnvironment();
    exposeMonacoOnWindow();

    runtimeInitialized = true;
    readyMonaco = monaco;

    return monaco;
}

export function ensureMonacoRuntime(): Promise<typeof monaco> {
    if (readyMonaco) {
        return Promise.resolve(readyMonaco);
    }

    if (!initPromise) {
        initPromise = Promise.resolve()
            .then(() => initializeMonacoRuntime())
            .catch((error) => {
                initPromise = undefined;
                throw error;
            });
    }

    return initPromise;
}

export function getMonacoIfReady(): typeof monaco | undefined {
    return readyMonaco;
}

export function isMonacoReady(): boolean {
    return readyMonaco !== undefined;
}

void ensureMonacoRuntime();

export { monaco };
