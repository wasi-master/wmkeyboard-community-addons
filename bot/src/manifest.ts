/**
 * `wmkeyboard-repo.json` and `README.md`, generated from the tree and never
 * edited by hand. Deterministic: the same tree gives the same bytes, so
 * `--check` in CI catches a hand edit or a forgotten regeneration.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ADDON_TYPES, DEFAULT_REPO_SLUG, LIMITS, REPO_DESCRIPTION, REPO_ID, REPO_NAME, SCHEMA_URL, STORE_SITE, OPEN_PAGE, ADD_REPO_BADGE, TYPES, type AddonType } from './constants.ts';
import { pluginFileTypes, readPluginArchive } from './plugin.ts';
import type { Meta, Published } from './repo.ts';
import { md } from './text.ts';

export interface ManifestEntry {
	id: string;
	type: AddonType;
	name: string;
	version: string;
	author: string;
	description: string;
	tags: string[];
	path: string;
	sha256: string;
	sizeBytes: number;
	previews: string[];
	license: string;
	basedOn?: string;
	/** A plugin's: the file extensions it shows or colours in the Files tool, from its own plugin.json. */
	fileTypes?: string[];
	/** A plugin's: whole file names it shows or colours. */
	fileNames?: string[];
}

export interface RepoManifest {
	$schema: string;
	format: 'wmkeyboard-repo';
	version: 1;
	repo: { id: string; name: string; description: string; author: string; homepage: string; icon?: string; updatedAt?: string };
	addons: ManifestEntry[];
}

export function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/** One manifest entry for an addon whose files sit at [dir] (relative to the manifest; empty for beside it). */
export function entryFor(meta: Meta, dir: string, payload: Uint8Array): ManifestEntry {
	const at = (file: string) => (dir ? `${dir}/${file}` : file);
	const entry: ManifestEntry = {
		id: meta.id,
		type: meta.type,
		name: meta.name,
		version: meta.version,
		author: meta.submitter.login,
		description: meta.description,
		tags: meta.tags,
		path: at(TYPES[meta.type].file),
		sha256: sha256(payload),
		sizeBytes: payload.byteLength,
		previews: meta.previews.map(at),
		license: meta.license,
	};
	if (meta.basedOn) entry.basedOn = meta.basedOn;
	if (meta.type === 'plugin') {
		// As the official repository's build_index.py derives them, so the
		// Files tool's offers never drift from what the plugin declares.
		const { fileTypes, fileNames } = pluginFileTypes(readPluginArchive(payload).manifest);
		if (fileTypes.length) entry.fileTypes = fileTypes;
		if (fileNames.length) entry.fileNames = fileNames;
	}
	return entry;
}

export function buildManifest(root: string, published: Published[], repoSlug = DEFAULT_REPO_SLUG): RepoManifest {
	const addons = published.map((p) => entryFor(p.meta, p.dir, readFileSync(join(root, p.dir, TYPES[p.meta.type].file))));
	const updatedAt = published.map((p) => p.meta.updatedAt.slice(0, 10)).sort().at(-1);
	let icon: string | undefined;
	try {
		if (statSync(join(root, 'icon.png')).isFile()) icon = 'icon.png';
	} catch {
		icon = undefined;
	}
	return {
		$schema: SCHEMA_URL,
		format: 'wmkeyboard-repo',
		version: 1,
		repo: {
			id: REPO_ID,
			name: REPO_NAME,
			description: REPO_DESCRIPTION,
			author: 'WM Keyboard community',
			homepage: `https://github.com/${repoSlug}`,
			...(icon ? { icon } : {}),
			...(updatedAt ? { updatedAt } : {}),
		},
		addons,
	};
}

export function manifestText(manifest: RepoManifest): string {
	return JSON.stringify(manifest, null, 2) + '\n';
}

const COLUMNS = 3;

/** README with a gallery grid, newest first. Every submitted string is escaped. */
export function buildReadme(published: Published[], repoSlug = DEFAULT_REPO_SLUG): string {
	const repoUrl = `https://github.com/${repoSlug}`;
	const newest = [...published].sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt) || a.meta.id.localeCompare(b.meta.id));
	const section = (type: AddonType) => {
		const { title, template } = TYPES[type];
		const items = newest.filter((p) => p.meta.type === type);
		if (!items.length) return `## ${title}\n\nNone yet. Be the first: [submit one](${repoUrl}/issues/new?template=${template}).\n`;
		const cells = items.map((p) => {
			const preview = p.meta.previews[0];
			// Sound packs, snippet packs and plugins have nothing to draw; their card says what they are instead.
			const img = preview ? `<img src="${p.dir}/${preview}" width="240" alt="" />` : `<sub>${md(p.meta.description.slice(0, 140))}</sub>`;
			const credit = p.meta.basedOn ? `<br><sub>remix of ${md(p.meta.basedOn)}</sub>` : '';
			return `<td valign="top" width="33%"><a href="${p.dir}">${img}</a><br><b>${md(p.meta.name)}</b><br><sub>by ${md(p.meta.submitter.login)} · ${p.meta.license} · v${p.meta.version}</sub>${credit}</td>`;
		});
		const rows: string[] = [];
		for (let i = 0; i < cells.length; i += COLUMNS) rows.push(`<tr>\n${cells.slice(i, i + COLUMNS).join('\n')}\n</tr>`);
		return `## ${title}\n\n<table>\n${rows.join('\n')}\n</table>\n`;
	};
	const manifestUrl = `https://raw.githubusercontent.com/${repoSlug}/main/wmkeyboard-repo.json`;
	const openLink = (id?: string) => `${OPEN_PAGE}?repo=${encodeURIComponent(repoUrl)}${id ? `&id=${encodeURIComponent(id)}` : ''}`;
	// Every addon, one row each, linking to its page in the app. Same order as the gallery.
	const byType = ADDON_TYPES.flatMap((t) => newest.filter((p) => p.meta.type === t));
	const openTable = byType.length
		? `## Open in WM Keyboard\n\nOn a phone with WM Keyboard, these links go straight to the addon's page in the app, where you tap Install. Elsewhere they open a page with an **Open in WM Keyboard** button.\n\n| Addon | Type | By | Open in app |\n|---|---|---|---|\n${byType
				.map((p) => `| [${md(p.meta.name)}](${p.dir}) | ${TYPES[p.meta.type].noun} | ${md(p.meta.submitter.login)} | [Open](${openLink(p.meta.id)}) |`)
				.join('\n')}\n`
		: '';
	return `<!-- Generated by bot/src/cli/generate.ts from addons/*/*/meta.json. Do not edit by hand. -->
<div align="center">
  <img src="icon.png" width="96" height="96" alt="" />
  <h1>${REPO_NAME}</h1>
  <p>Themes, layouts, icon packs, sticker packs, sound packs, snippets and plugins made by people who use WM Keyboard.</p>
  <a href="${openLink()}"><img src="${ADD_REPO_BADGE}" alt="Add repository to WM Keyboard" height="72"></a>
  <p><sub>WM Keyboard lists this repository under <b>Settings → Addons</b> on its own. You only need the badge if you removed it.</sub></p>
</div>

Its address is \`${repoUrl}\`. You can also browse it in the [web store](${STORE_SITE}/addons/?repo=${encodeURIComponent(repoUrl)}).

**Share yours:** use **Share with everyone** in the app (on a theme, a layout, an icon pack, a sticker pack, a plugin or your snippets), **Submit to community** in the web store's builders and plugin editor, or \`wmpy publish\` for a plugin, or open one of the forms here: ${ADDON_TYPES.map((t) => `[${TYPES[t].noun}](${repoUrl}/issues/new?template=${TYPES[t].template})`).join(' · ')}. A bot checks it and posts a preview; a maintainer publishes it, and reads a plugin's code first. Details in [CONTRIBUTING.md](CONTRIBUTING.md).

${ADDON_TYPES.map(section).join('\n')}
${openTable ? `${openTable}\n` : ''}---

${published.length} addon${published.length === 1 ? '' : 's'}, indexed by [\`wmkeyboard-repo.json\`](wmkeyboard-repo.json) (raw: \`${manifestUrl}\`). Each addon is published under the licence on its card; the bot and tooling under \`bot/\` are MIT. Names and descriptions are limited to ${LIMITS.name} and ${LIMITS.description} characters.
`;
}
