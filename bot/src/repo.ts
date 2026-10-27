/**
 * The published tree: `addons/<type dir>/<id>/` with the payload, a
 * `meta.json` and the previews. One folder per addon, so two approvals never
 * touch the same file; the manifest and README are generated from it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADDON_TYPES, ID_PATTERN, TYPES, type AddonType, type License } from './constants.ts';

export interface Meta {
	id: string;
	type: AddonType;
	name: string;
	description: string;
	tags: string[];
	license: License;
	/** `<repoId>/<addonId>` of the addon this one was remixed from. */
	basedOn: string | null;
	version: string;
	/** The numeric id is what proves ownership for updates; logins can be renamed. */
	submitter: { login: string; id: number };
	/** Every issue that published or updated it, oldest first. */
	issues: number[];
	createdAt: string;
	updatedAt: string;
	/** Preview files in the addon's folder, the main one first. */
	previews: string[];
}

export interface Published {
	meta: Meta;
	/** Folder relative to the repo root, with forward slashes. */
	dir: string;
}

export function addonDir(type: AddonType, id: string): string {
	return `addons/${TYPES[type].dir}/${id}`;
}

/** Every published addon, sorted by type then id. Folders without a readable meta.json are skipped. */
export function readPublished(root: string): Published[] {
	const out: Published[] = [];
	for (const type of ADDON_TYPES) {
		const base = join(root, 'addons', TYPES[type].dir);
		if (!existsSync(base)) continue;
		for (const id of readdirSync(base).sort()) {
			if (!ID_PATTERN.test(id)) continue;
			const metaPath = join(base, id, 'meta.json');
			if (!existsSync(metaPath)) continue;
			const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Meta;
			if (meta.id !== id || meta.type !== type) throw new Error(`${metaPath}: id/type do not match the folder`);
			out.push({ meta, dir: addonDir(type, id) });
		}
	}
	return out;
}

/** `1.4.0` → `1.5.0`: an update from the community is a minor bump. */
export function bumpMinor(version: string): string {
	const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
	if (!m) return '1.0.0';
	return `${m[1]}.${Number(m[2]) + 1}.0`;
}
