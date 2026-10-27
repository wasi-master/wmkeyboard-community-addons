/**
 * The quick pass: validate with the web store's readers, then screenshot the
 * store's KeyboardMock. About a minute on a runner, against several for the
 * JVM render, so the submitter sees something straight away.
 *
 * Env: STORE_DIR (docs/src/store), RENDER_DIR (request.json + payload from the
 * parse job), OUT_DIR. Writes OUT_DIR/report.json {ok, problems, images} and
 * OUT_DIR/<id>.png (layouts also <id>-dark.png). Run `node build.mjs` first.
 *
 * The page gets the payload as a value through page.evaluate, never as HTML
 * source, and every network request is refused: a theme cannot load anything.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ID_PATTERN, TYPES } from '../src/constants.ts';
import { pendingManifest } from '../src/pending.ts';
import type { Meta } from '../src/repo.ts';
import { checkedId, checkedType, env } from '../src/cli/io.ts';

const here = dirname(fileURLToPath(import.meta.url));

/** Light and dark board for drawing a layout, close to WM Keyboard's defaults. */
export const LAYOUT_THEMES = {
	light: {
		id: 'preview-light', name: 'Light', dark: false,
		boardBackground: 0xffe8eaed, keyBackground: 0xffffffff, keyText: 0xff202124,
		modifierKeyBackground: 0xffd2d6dc, modifierKeyText: 0xff202124, enterKeyBackground: 0xff1a73e8,
		enterKeyText: 0xffffffff, accent: 0xff1a73e8, keyShape: 'ROUNDED',
	},
	dark: {
		id: 'preview-dark', name: 'Dark', dark: true,
		boardBackground: 0xff202124, keyBackground: 0xff3c4043, keyText: 0xffe8eaed,
		modifierKeyBackground: 0xff2d2f33, modifierKeyText: 0xffe8eaed, enterKeyBackground: 0xff8ab4f8,
		enterKeyText: 0xff202124, accent: 0xff8ab4f8, keyShape: 'ROUNDED',
	},
};

interface Readers {
	readTheme(text: string): { problems: string[]; spec: unknown };
	readLayout(text: string): { problems: string[]; layout: unknown };
	decodeManifestObject(raw: unknown): { manifest: { addons: { id: string }[] }; dropped: { reason: string }[] };
}

async function main() {
	const store = resolve(env('STORE_DIR'));
	const input = resolve(env('RENDER_DIR'));
	const out = resolve(env('OUT_DIR'));
	mkdirSync(out, { recursive: true });

	const request = JSON.parse(readFileSync(join(input, 'request.json'), 'utf8')) as { type: unknown; id: unknown; file: unknown };
	const type = checkedType(request.type);
	const id = checkedId(request.id);
	if (request.file !== TYPES[type].file) throw new Error('request.json names an unexpected file');
	const text = readFileSync(join(input, TYPES[type].file), 'utf8');

	const readers = (await import(pathToFileURL(join(here, 'dist', 'store-readers.mjs')).href)) as Readers;
	const problems: string[] = [];
	const shots: { spec: unknown; layout: unknown; file: string }[] = [];
	try {
		if (type === 'theme') {
			const read = readers.readTheme(text);
			problems.push(...read.problems);
			shots.push({ spec: read.spec, layout: null, file: `${id}.png` });
		} else {
			const read = readers.readLayout(text);
			problems.push(...read.problems);
			shots.push({ spec: LAYOUT_THEMES.light, layout: read.layout, file: `${id}.png` });
			shots.push({ spec: LAYOUT_THEMES.dark, layout: read.layout, file: `${id}-dark.png` });
		}
	} catch (e) {
		problems.push(`The web store cannot read it: ${(e as Error).message}`);
	}

	// The manifest the pending branch will carry has to decode in the store too.
	const meta: Meta = { id, type, name: id, description: '', tags: [], license: 'CC0-1.0', basedOn: null, version: '1.0.0', submitter: { login: 'pending', id: 0 }, issues: [], createdAt: '', updatedAt: '', previews: ['preview.png'] };
	const decoded = readers.decodeManifestObject(pendingManifest(meta, Buffer.from(text), 0));
	for (const d of decoded.dropped) problems.push(`The store would drop the manifest entry: ${d.reason}`);
	if (!decoded.manifest.addons.some((a) => a.id === id && ID_PATTERN.test(a.id))) problems.push('The store does not list the addon from its manifest.');

	const images: string[] = [];
	if (shots.length) {
		const css = readFileSync(join(store, 'store.css'), 'utf8');
		const script = readFileSync(join(here, 'dist', 'page.js'), 'utf8');
		const browser = await chromium.launch();
		try {
			const page = await browser.newPage({ viewport: { width: 480, height: 900 }, deviceScaleFactor: 2, javaScriptEnabled: true });
			await page.route('**/*', (route) => route.abort());
			await page.setContent(
				`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>
				:root{--st-radius:0;--st-card-border:transparent;--sl-font:system-ui,sans-serif}
				body{margin:0;background:#fff}.st-kb{max-width:none;border:0}
				*,*::before,*::after{animation:none!important;transition:none!important}
				</style></head><body><div id="root"></div></body></html>`,
			);
			await page.addScriptTag({ content: script });
			for (const shot of shots) {
				try {
					await page.evaluate(([spec, layout]) => window.renderMock(spec, layout), [shot.spec, shot.layout] as const);
					const board = page.locator('.st-kb').first();
					await board.waitFor({ timeout: 5000 });
					await page.waitForTimeout(250);
					await board.screenshot({ path: join(out, shot.file) });
					images.push(shot.file);
				} catch (e) {
					problems.push(`The web preview did not draw: ${(e as Error).message.split('\n')[0]}`);
				}
			}
		} finally {
			await browser.close();
		}
	}

	const report = { ok: problems.length === 0 && images.length > 0, problems, images };
	writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
	console.log(JSON.stringify(report));
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});

declare global {
	interface Window {
		renderMock(spec: unknown, layout: unknown): void;
	}
}
