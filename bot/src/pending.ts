/**
 * What a submission looks like as files: the `pending/<issue>/` folder the
 * try links point at, and the `addons/<type>/<id>/` folder `/approve` writes.
 * Both hold the same payload, previews and meta, so approving is a copy.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PENDING_REPO_ID, REPO_NAME, SCHEMA_URL, TYPES } from './constants.ts';
import { entryFor, type RepoManifest } from './manifest.ts';
import { bumpMinor, type Meta } from './repo.ts';
import type { SubmissionResult } from './submission.ts';

/**
 * The order render outputs are published in, by the word after the id: the
 * keyboard itself first, then a theme's tool panels, then a layout's layers.
 * Any other `<id>-<word>.png` the renderer writes (a layout's own pages,
 * `page1`…, and its panel layers) follows, sorted.
 */
export const KNOWN_SUFFIXES = ['', 'landscape', 'dark', 'tools', 'clipboard', 'editing', 'shift', 'symbols', 'symbols2', 'fn', 'number', 'phone', 'date', 'time', 'datetime'] as const;

/** The previews that show the whole keyboard; the rest are drawn smaller in the comment. */
export const MAIN_PREVIEWS: readonly string[] = ['preview.png', 'preview-landscape.png', 'preview-dark.png'];

/** More than any layout has layers for; a renderer gone wrong cannot flood the folder. */
const MAX_IMAGES = 24;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_IMAGE = 6 * 1024 * 1024;

export function isPng(bytes: Uint8Array): boolean {
	return PNG.every((b, i) => bytes[i] === b);
}

/**
 * The renderer's `<id>.png` and every `<id>-<word>.png` beside it in [dir],
 * checked and renamed to `preview.png` / `preview-<word>.png`, in
 * KNOWN_SUFFIXES order and then by name. A word is lowercase letters and
 * digits, which is what keeps the stale-preview sweep able to find them.
 */
export function collectImages(dir: string, id: string): { from: string; name: string }[] {
	if (!existsSync(dir)) return [];
	const pattern = new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:-([a-z0-9]+))?\\.png$`);
	const words: string[] = [];
	for (const file of readdirSync(dir)) {
		const m = pattern.exec(file);
		if (m) words.push(m[1] ?? '');
	}
	const rank = (w: string) => {
		const i = (KNOWN_SUFFIXES as readonly string[]).indexOf(w);
		return i < 0 ? KNOWN_SUFFIXES.length : i;
	};
	words.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
	const out: { from: string; name: string }[] = [];
	for (const word of words.slice(0, MAX_IMAGES)) {
		const from = join(dir, word ? `${id}-${word}.png` : `${id}.png`);
		const size = statSync(from).size;
		if (size > MAX_IMAGE || !isPng(readFileSync(from).subarray(0, 8))) throw new Error(`${from}: not a PNG under ${MAX_IMAGE} bytes`);
		out.push({ from, name: word ? `preview-${word}.png` : 'preview.png' });
	}
	return out;
}

export type Summary = Omit<SubmissionResult, 'payload'>;

/** The meta a submission publishes as. [previous] is the published meta for an update. */
export function metaFor(s: Summary, previews: string[], now: string, previous?: Meta): Meta {
	if (!s.id || !s.type || !s.license) throw new Error('meta for an incomplete submission');
	return {
		id: s.id,
		type: s.type,
		name: s.name,
		description: s.description,
		tags: s.tags,
		license: s.license,
		basedOn: s.basedOn ?? previous?.basedOn ?? null,
		version: previous ? bumpMinor(previous.version) : '1.0.0',
		submitter: { login: s.submitter.login, id: s.submitter.id },
		issues: [...(previous?.issues ?? []).filter((n) => n !== s.issue), s.issue],
		createdAt: previous?.createdAt ?? now,
		updatedAt: now,
		previews,
	};
}

/** The one-addon manifest beside a pending submission. Paths are relative to it. */
export function pendingManifest(meta: Meta, payload: Uint8Array, issue: number): RepoManifest {
	return {
		$schema: SCHEMA_URL,
		format: 'wmkeyboard-repo',
		version: 1,
		repo: {
			id: PENDING_REPO_ID,
			name: `${REPO_NAME}: pending #${issue}`,
			description: 'One submission waiting for review. Installs from here are trial copies; the published version comes from the community repository.',
			author: 'WM Keyboard community',
			homepage: `https://github.com/${process.env.GITHUB_REPOSITORY ?? 'wasi-master/wmkeyboard-community-addons'}/issues/${issue}`,
		},
		addons: [entryFor(meta, '', payload)],
	};
}

/**
 * Fills [target] with a submission's files. Previews left over from an
 * earlier pass are removed first, so a re-render never shows a stale one.
 */
export function writeAddonFolder(target: string, meta: Meta, payload: Uint8Array, images: { from: string; name: string }[]): void {
	mkdirSync(target, { recursive: true });
	for (const name of readdirSync(target)) {
		if (/^preview(-[a-z0-9]+)?\.png$/.test(name) && !images.some((i) => i.name === name)) rmSync(join(target, name));
	}
	writeFileSync(join(target, TYPES[meta.type].file), payload);
	for (const image of images) copyFileSync(image.from, join(target, image.name));
	writeFileSync(join(target, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
}
