import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
	entryPoints: ['src/extension.ts'],
	bundle: true,
	format: 'cjs',
	minify: production,
	sourcemap: !production,
	sourcesContent: false,
	platform: 'node',
	outfile: 'dist/extension.js',
	external: ['vscode', 'bufferutil', 'utf-8-validate'],
	banner: { js: 'var navigator = undefined;' },
	logLevel: 'info',
});

if (watch) {
	await ctx.watch();
	console.log('[esbuild] watching for changes...');
} else {
	await ctx.rebuild();
	await ctx.dispose();
}
