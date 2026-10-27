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

/** Render outputs and the names they are published under, the main one first. */
export const IMAGE_SLOTS = [
	{ suffix: '', name: 'preview.png' },
	{ suffix: '-landscape', name: 'preview-landscape.png' },
	{ suffix: '-dark', name: 'preview-dark.png' },
] as const;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_IMAGE = 6 * 1024 * 1024;

export function isPng(bytes: Uint8Array): boolean {
	return PNG.every((b, i) => bytes[i] === b);
}

/** The renderer's `<id>.png`, `<id>-landscape.png`, `<id>-dark.png` in [dir], checked and renamed. */
export function collectImages(dir: string, id: string): { from: string; name: string }[] {
	const out: { from: string; name: string }[] = [];
	for (const slot of IMAGE_SLOTS) {
		const from = join(dir, `${id}${slot.suffix}.png`);
		if (!existsSync(from)) continue;
		const size = statSync(from).size;
		if (size > MAX_IMAGE || !isPng(readFileSync(from).subarray(0, 8))) throw new Error(`${from}: not a PNG under ${MAX_IMAGE} bytes`);
		out.push({ from, name: slot.name });
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
		if (/^preview(-[a-z]+)?\.png$/.test(name) && !images.some((i) => i.name === name)) rmSync(join(target, name));
	}
	writeFileSync(join(target, TYPES[meta.type].file), payload);
	for (const image of images) copyFileSync(image.from, join(target, image.name));
	writeFileSync(join(target, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
}
