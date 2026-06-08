const toArray = (value) => {
    if (value === undefined || value === null) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
};

const asWebviewUri = (filePath) => {
    const normalized = filePath.startsWith('/') ? filePath : `/${filePath}`;
    return `https://file%2B.vscode-resource.vscode-cdn.net${normalized}`;
};

const appendScript = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.addEventListener('load', () => resolve(undefined), { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
    document.head.appendChild(script);
});

const appendStylesheet = (href) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
};

const renderDependencies = async (dependencies) => {
    for (const dependency of toArray(dependencies)) {
        const root = dependency?.src?.file;
        if (!root) {
            continue;
        }

        const webviewRoot = asWebviewUri(root);
        for (const stylesheet of toArray(dependency.stylesheet)) {
            appendStylesheet(`${webviewRoot}/${stylesheet}`);
        }
        for (const script of toArray(dependency.script)) {
            await appendScript(`${webviewRoot}/${script}`);
        }
    }
};

const parseTags = (tags) => {
    if (typeof tags !== 'string') {
        return tags;
    }

    try {
        return JSON.parse(tags);
    } catch {
        return tags;
    }
};

const renderTags = (parent, tags) => {
    if (typeof tags === 'string') {
        parent.innerHTML = tags;
        return;
    }

    for (const tag of toArray(tags)) {
        if (!tag) {
            continue;
        }
        if (!tag.name) {
            if (typeof tag === 'string') {
                parent.appendChild(document.createTextNode(tag));
            }
            continue;
        }

        const element = document.createElement(tag.name);
        for (const [name, value] of Object.entries(tag.attribs ?? {})) {
            element.setAttribute(name, Array.isArray(value) ? value.join(' ') : String(value));
        }
        for (const child of toArray(tag.children)) {
            renderTags(element, child);
        }
        parent.appendChild(element);
    }
};

export const activate = () => ({
    async renderOutputItem(data, element) {
        const widget = data.json();
        await renderDependencies(widget.dependencies);
        renderTags(element, parseTags(widget.tags));
        window.HTMLWidgets?.staticRender?.();
    },
    disposeOutputItem() {
        return undefined;
    },
});
