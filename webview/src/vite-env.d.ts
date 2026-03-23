/// <reference types="svelte" />
/// <reference types="vite/client" />

declare module '*.svelte' {
    import { Component } from 'svelte';
    const component: Component;
    export default component;
}

declare function $state<T>(value: T): T;
declare function $state<T>(): T | undefined;
declare function $derived<T>(fn: () => T): T;
declare function $effect(fn: () => void | (() => void)): void;
declare function $props(): any;
declare function $inspect<T>(...values: T[]): void;

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

declare global {
    var __arkVsCodeApi:
        | {
              postMessage(message: unknown): void;
              getState(): unknown;
              setState(state: unknown): void;
          }
        | undefined;
    var __arkLanguageMonacoSupportModules:
        | Record<string, string>
        | undefined;
}
