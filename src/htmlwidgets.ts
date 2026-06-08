import * as vscode from 'vscode';

export interface RHtmlDependency {
    all_files: boolean;
    head: string | null;
    meta: string | null;
    name: string | null;
    script: string | string[] | null;
    src: {
        file: string;
    };
    stylesheet: string | string[] | null;
    version: string | null;
}

export interface WidgetSizingPolicy {
    defaultHeight: string | null;
    defaultWidth: string | null;
    fill: boolean | null;
    padding: number | null;
}

export interface ViewerSizingPolicy extends WidgetSizingPolicy {
    paneHeight: number | null;
    suppress: boolean | null;
}

export interface BrowserSizingPolicy extends WidgetSizingPolicy {
    external: boolean | null;
}

export interface KnitrSizingPolicy extends WidgetSizingPolicy {
    figure: boolean | null;
}

export interface HtmlWidgetSizingPolicy extends WidgetSizingPolicy {
    viewer: ViewerSizingPolicy;
    browser: BrowserSizingPolicy;
    knitr: KnitrSizingPolicy;
}

export interface RHtmlWidget {
    dependencies: RHtmlDependency[];
    sizing_policy: HtmlWidgetSizingPolicy;
    tags: string;
}

export function getResourceRoots(widget: RHtmlWidget): vscode.Uri[] {
    const roots = widget.dependencies
        .map(dep => dep.src?.file)
        .filter((file): file is string => !!file)
        .map(file => vscode.Uri.file(file));

    return Array.from(new Map(roots.map(uri => [uri.toString(), uri])).values());
}
