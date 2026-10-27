/**
 * Bundles the web store's own code from a WMKeyboard checkout (STORE_DIR =
 * <checkout>/docs/src/store) so the quick pass reads and draws an addon with
 * exactly what the store ships:
 *
 *   dist/store-readers.mjs   readTheme, readLayout, decodeManifestObject (node)
 *   dist/page.js             KeyboardMock mounted on window.renderMock (browser)
 *
 * The store's imports resolve against this package's node_modules, so a
 * sparse checkout with no node_modules of its own is enough.
 */
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const store = resolve(process.env.STORE_DIR ?? '');
if (!process.env.STORE_DIR || !existsSync(join(store, 'lib', 'payloads.ts'))) {
	console.error('STORE_DIR must point at docs/src/store in a WMKeyboard checkout');
	process.exit(1);
}

const common = {
	bundle: true,
	// One preact for the page and the mock, even where the checkout has its own
	// node_modules: two copies break hooks.
	alias: { '@store': store, preact: join(here, '..', 'node_modules', 'preact'), fflate: join(here, '..', 'node_modules', 'fflate') },
	nodePaths: [join(here, '..', 'node_modules')],
	jsx: 'automatic',
	jsxImportSource: 'preact',
	logLevel: 'warning',
	legalComments: 'none',
};

// The mock's only UI dependency outside itself is the problems box, which a
// screenshot never shows.
const stubPreview = {
	name: 'stub-preview',
	setup(b) {
		b.onResolve({ filter: /^\.\/Preview$/ }, (args) => (/KeyboardMock\.tsx$/.test(args.importer) ? { path: join(here, 'preview-stub.ts') } : undefined));
	},
};

await build({
	...common,
	entryPoints: [join(here, 'readers-entry.ts')],
	outfile: join(here, 'dist', 'store-readers.mjs'),
	platform: 'node',
	format: 'esm',
});

await build({
	...common,
	entryPoints: [join(here, 'page-entry.tsx')],
	outfile: join(here, 'dist', 'page.js'),
	platform: 'browser',
	format: 'iife',
	plugins: [stubPreview],
});

console.log(`bundled the store from ${store}`);
