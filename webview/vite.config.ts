import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => ({
    base: './',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: mode === 'development',
        assetsInlineLimit: 4096,
        rollupOptions: {
            input: {
                rMonacoSupport: resolve(__dirname, 'src/lib/languages/r/rMonacoSupport.ts'),
            },
            output: {
                entryFileNames: '[name]/index.js',
                chunkFileNames: 'shared/[name]-[hash].js',
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name?.endsWith('.css')) {
                        return '[name]/index.css';
                    }
                    return 'assets/[name]-[hash][extname]';
                },
            },
        },
        minify: mode === 'production' ? 'esbuild' : false,
    },
    resolve: {
        alias: {
            '$lib': resolve(__dirname, 'src/lib'),
        },
    },
    optimizeDeps: {
        include: [
            'monaco-editor/esm/vs/editor/edcore.main',
            'vscode-textmate',
            'vscode-oniguruma',
        ],
    },
    assetsInclude: ['**/*.wasm'],
}));
