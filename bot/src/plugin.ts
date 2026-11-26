/**
 * Plugins, the one kind of addon that is code.
 *
 * A `.wmplugin` is a zip: `plugin.json`, the entry script, and for API 5 other
 * modules, `assets/` and `locales/`. This reads one the way the app's
 * PluginFile does (the same limits, the same names), lists what the manifest
 * asks for, and draws the part of the sticky comment a maintainer reviews it
 * by: the permissions by tier with the risky ones flagged, the hosts, the
 * providers and actions, every file, the code, and for an update the diff.
 *
 * Nothing here runs the plugin. `wmpy check` and `wmpy test` do, in a job of
 * their own with no write permission (cli/wmpy.ts).
 */
import { unzipSync } from 'fflate';
import { LIMITS } from './constants.ts';
import { PayloadError } from './payload.ts';

export const PLUGIN_MANIFEST = 'plugin.json';
export const PLUGIN_FORMAT = 'wmkeyboard-plugin';

/** PluginManifestCodec's id: one safe, lowercase path segment, 3-64 characters. */
export const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{2,63}$/;

/** The plugin version the community repository publishes under: three numbers. */
export const PLUGIN_VERSION = /^\d+\.\d+\.\d+$/;

/** A name the bot will unpack and link to: segments of letters, digits, `_`, `.` and `-`, none starting with a dot. */
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;
const ASSET_NAME = /^[a-z0-9][a-z0-9_.-]{0,63}\.(png|webp|jpg|jpeg|svg|json|txt)$/;
const MODULE_PART = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const LOCALE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
const PICTURE = /\.(png|webp|jpe?g|gif)$/i;

export type PluginFileKind = 'manifest' | 'entry' | 'module' | 'test' | 'locale' | 'asset' | 'other';

export interface PluginFile {
	/** The entry's name in the archive, checked against [SAFE_NAME]. */
	name: string;
	kind: PluginFileKind;
	size: number;
	bytes: Uint8Array;
	/** The file as UTF-8, for everything but pictures and files that are not text. */
	text?: string;
}

export interface PluginArchive {
	manifest: Record<string, unknown>;
	/** Manifest first, then the entry, modules, tests, locales, assets and the rest, each by name. */
	files: PluginFile[];
}

/** PluginFile.isModuleName: identifiers between slashes, at most four deep, ending `.py`. */
export function isModuleName(name: string): boolean {
	if (!name.endsWith('.py')) return false;
	const parts = name.slice(0, -3).split('/');
	return parts.length <= 4 && parts.every((p) => MODULE_PART.test(p));
}

function text(bytes: Uint8Array): string | undefined {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return undefined;
	}
}

const ORDER: PluginFileKind[] = ['manifest', 'entry', 'module', 'test', 'locale', 'asset', 'other'];

/**
 * Reads a `.wmplugin`, refusing what WM Keyboard's importer refuses about the
 * archive itself: more than 64 files or 4 MB unpacked, a plugin.json over
 * 64 KB or not for a plugin, a missing entry, a module or asset under a name
 * it does not take or over its size, a locale file that is not one. What the
 * manifest says is checked by `wmpy check` with the app's own rules.
 */
export function readPluginArchive(bytes: Uint8Array): PluginArchive {
	let count = 0;
	let total = 0;
	let raw: Record<string, Uint8Array>;
	try {
		raw = unzipSync(bytes, {
			filter: (file) => {
				if (file.name.endsWith('/')) return false;
				// Left behind by macOS's Compress; the app skips them as files it does not read.
				if (file.name.startsWith('__MACOSX/') || /(^|\/)\.[^/]*$/.test(file.name)) return false;
				if (++count > LIMITS.pluginEntries) throw new PayloadError(`The plugin has more than ${LIMITS.pluginEntries} files, more than WM Keyboard reads.`);
				if (!SAFE_NAME.test(file.name) || file.name.length > 160) {
					throw new PayloadError(`The plugin holds a file named "${file.name.slice(0, 80).replace(/[^\x20-\x7e]/g, '?')}". Use letters, digits, "_", "." and "-" in file and folder names.`);
				}
				total += file.originalSize;
				if (total > LIMITS.pluginTotalBytes) throw new PayloadError(`The plugin unpacks to more than ${LIMITS.pluginTotalBytes / 1024 / 1024} MB, the most WM Keyboard reads.`);
				return true;
			},
		});
	} catch (e) {
		if (e instanceof PayloadError) throw e;
		throw new PayloadError(`The plugin is not a zip file the bot can read (${(e as Error).message}).`);
	}

	const manifestBytes = raw[PLUGIN_MANIFEST];
	if (!manifestBytes) throw new PayloadError('The zip has no plugin.json at its top level, so it is not a plugin.');
	if (manifestBytes.byteLength > LIMITS.pluginManifestBytes) throw new PayloadError(`plugin.json is over ${LIMITS.pluginManifestBytes / 1024} KB, more than WM Keyboard reads.`);
	let manifest: unknown;
	try {
		manifest = JSON.parse(text(manifestBytes) ?? '');
	} catch (e) {
		throw new PayloadError(`plugin.json is not valid JSON: ${(e as Error).message}`);
	}
	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new PayloadError('plugin.json is not a JSON object.');
	const m = manifest as Record<string, unknown>;
	if (m.format !== PLUGIN_FORMAT) throw new PayloadError(`plugin.json needs "format": "${PLUGIN_FORMAT}".`);

	// The app looks the entry up by its exact name, then by the last part of it.
	const wanted = typeof m.entry === 'string' && m.entry.trim() ? m.entry.trim() : 'main.py';
	const tail = wanted.split(/[/\\]/).pop() ?? '';
	const names = Object.keys(raw);
	const entry = raw[wanted] ? wanted : names.find((n) => n === tail) ?? names.find((n) => n.split('/').pop() === tail);
	if (!entry) throw new PayloadError(`plugin.json names \`${wanted.slice(0, 64)}\` as its script, and the plugin has no such file.`);

	const files: PluginFile[] = [];
	for (const name of names) {
		const data = raw[name]!;
		const kind: PluginFileKind =
			name === PLUGIN_MANIFEST
				? 'manifest'
				: name === entry
					? 'entry'
					: name.startsWith('assets/')
						? 'asset'
						: name.startsWith('locales/') && name.endsWith('.json')
							? 'locale'
							: name.endsWith('.py')
								? name === 'test.py' || name.startsWith('tests/')
									? 'test'
									: 'module'
								: 'other';
		const decoded = PICTURE.test(name) ? undefined : text(data);
		switch (kind) {
			case 'entry':
			case 'module':
			case 'test':
				if (kind !== 'entry' && !isModuleName(name)) throw new PayloadError(`\`${name}\` is not a module name Python can import: folders and file names are identifiers, at most four deep.`);
				if (data.byteLength > LIMITS.pluginModuleBytes) throw new PayloadError(`\`${name}\` is over ${LIMITS.pluginModuleBytes / 1024} KB, the most WM Keyboard runs.`);
				if (!data.byteLength && kind === 'entry') throw new PayloadError(`\`${name}\`, the plugin's script, is empty.`);
				if (decoded === undefined) throw new PayloadError(`\`${name}\` is not UTF-8 text.`);
				break;
			case 'asset': {
				const asset = name.slice('assets/'.length);
				if (!ASSET_NAME.test(asset) || asset.includes('..')) {
					throw new PayloadError(`\`${name}\`: an asset is one lowercase file directly in assets/, ending .png, .webp, .jpg, .svg, .json or .txt.`);
				}
				if (data.byteLength > LIMITS.pluginAssetBytes) throw new PayloadError(`\`${name}\` is over ${LIMITS.pluginAssetBytes / 1024} KB, the most WM Keyboard takes for one asset.`);
				break;
			}
			case 'locale': {
				const tag = name.slice('locales/'.length, -'.json'.length);
				let ok = LOCALE_TAG.test(tag) && data.byteLength <= LIMITS.pluginLocaleBytes && decoded !== undefined;
				if (ok) {
					try {
						const parsed = JSON.parse(decoded!) as unknown;
						ok = !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
					} catch {
						ok = false;
					}
				}
				if (!ok) throw new PayloadError(`\`${name}\` is not a translation WM Keyboard reads: locales/<language>.json, a JSON object, up to ${LIMITS.pluginLocaleBytes / 1024} KB.`);
				break;
			}
			default:
				break;
		}
		files.push({ name, kind, size: data.byteLength, bytes: data, ...(decoded !== undefined ? { text: decoded } : {}) });
	}
	files.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
	return { manifest: m, files };
}

// ---- what the manifest asks for ---------------------------------------------

export type Tier = 'listed' | 'risky';

export interface PermissionInfo {
	wire: string;
	tier: Tier;
	/** The line the app shows before install (core/plugins strings). */
	label: string;
	/** The API level that introduced it. */
	api: number;
	/** Reads something the user has. */
	reads?: boolean;
	/** Can send data off the phone. */
	egress?: boolean;
}

/**
 * PluginPermission, in the order the app lists them. Keep in step with
 * core/plugins/…/PluginPermission.kt and docs/…/plugins/permissions.mdx. A
 * permission missing here shows as unknown, which a maintainer should treat
 * as a reason to check this table against the app before approving.
 */
export const PERMISSIONS: readonly PermissionInfo[] = [
	{ wire: 'storage', tier: 'listed', api: 1, label: 'Save data on your device' },
	{ wire: 'reminders', tier: 'listed', api: 2, label: 'Show reminders at times that you set in it' },
	{ wire: 'selection', tier: 'listed', api: 3, reads: true, label: 'Change text you select, when you tap one of its actions' },
	{ wire: 'field.write', tier: 'listed', api: 5, label: 'Type, replace and delete text in the field you are typing in' },
	{ wire: 'clipboard.write', tier: 'listed', api: 5, label: 'Copy text to the clipboard' },
	{ wire: 'sensors', tier: 'listed', api: 5, label: 'Read motion and light sensors while its panel is open' },
	{ wire: 'scan', tier: 'listed', api: 5, label: "Open the keyboard's QR code and text scanners" },
	{ wire: 'device', tier: 'listed', api: 5, label: 'Vibrate, turn on the flashlight and read text aloud' },
	{ wire: 'share', tier: 'listed', api: 5, label: 'Share text and open links, after you confirm' },
	{ wire: 'notifications', tier: 'listed', api: 5, label: 'Show notifications' },
	{ wire: 'clock', tier: 'listed', api: 5, label: "Set alarms and timers in the keyboard's Clock" },
	{ wire: 'previews', tier: 'listed', api: 5, label: "Read a file you open with it in the keyboard's file manager, to show it" },
	{ wire: 'network', tier: 'risky', api: 5, egress: true, label: 'Connect to the internet, to the websites it lists' },
	{ wire: 'network.local', tier: 'risky', api: 5, egress: true, label: 'Reach the server you type in its settings on your home network' },
	{ wire: 'ai', tier: 'risky', api: 5, egress: true, label: 'Ask the AI model you set up in the keyboard' },
	{ wire: 'field.read', tier: 'risky', api: 5, reads: true, label: 'Read the text around the cursor and the text you selected, when you tap something in its panel' },
	{ wire: 'clipboard.read', tier: 'risky', api: 5, reads: true, label: 'Read the clipboard, when you tap something in its panel' },
	{ wire: 'location', tier: 'risky', api: 5, reads: true, label: 'Find out where your phone is' },
	{ wire: 'files', tier: 'risky', api: 5, reads: true, label: 'Open files you pick and photos you take, and save files where you choose' },
	{ wire: 'calendar', tier: 'risky', api: 5, reads: true, label: 'Read your calendar and add events to it' },
	{ wire: 'todo', tier: 'risky', api: 5, reads: true, label: 'Read and change your To-do list' },
];

export interface PluginFacts {
	id: string;
	name: string;
	version: string;
	author: string;
	description: string;
	api: number;
	entry: string;
	panel: boolean;
	listed: PermissionInfo[];
	risky: PermissionInfo[];
	/** Declared strings this table does not know; the app refuses those. */
	unknown: string[];
	/** Something that reads what the user has, beside something that can send it away: the app's stronger warning. */
	combinationRisk: boolean;
	hosts: string[];
	/** Settings of type `host`: a server the user types in, which joins the hosts. */
	hostSettings: string[];
	providers: { tool: string; id: string; name: string }[];
	actions: { id: string; name: string; replaces: boolean; input: string }[];
	keyword: string;
	chip: boolean;
	tile: boolean;
	float: boolean;
	settings: { key: string; type: string; label: string }[];
	fileTypes: string[];
	fileNames: string[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)) : []);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : []);

/** The extensions and whole names a plugin shows or colours, as the official repository's build_index.py derives `fileTypes` and `fileNames`. */
export function pluginFileTypes(manifest: Record<string, unknown>): { fileTypes: string[]; fileNames: string[] } {
	const fileTypes: string[] = [];
	const fileNames: string[] = [];
	for (const item of [...list(manifest.previews), ...list(manifest.syntax)]) {
		for (const ext of strings(item.extensions)) {
			const e = ext.toLowerCase().replace(/^\.+/, '');
			if (e && !fileTypes.includes(e)) fileTypes.push(e);
		}
		for (const name of strings(item.names)) if (!fileNames.includes(name)) fileNames.push(name);
	}
	return { fileTypes, fileNames };
}

export function pluginFacts(manifest: Record<string, unknown>): PluginFacts {
	const declared = [...new Set(strings(manifest.permissions))];
	const known = declared.map((w) => PERMISSIONS.find((p) => p.wire === w)).filter((p): p is PermissionInfo => !!p);
	const tool = manifest.tool && typeof manifest.tool === 'object' && !Array.isArray(manifest.tool) ? (manifest.tool as Record<string, unknown>) : {};
	const settings = list(manifest.settings).map((s) => ({ key: str(s.key), type: str(s.type) || 'text', label: str(s.label) }));
	const api = typeof manifest.apiVersion === 'number' ? manifest.apiVersion : 1;
	return {
		id: str(manifest.id),
		name: str(manifest.name),
		version: str(manifest.pluginVersion),
		author: str(manifest.author),
		description: str(manifest.description),
		api,
		entry: str(manifest.entry) || 'main.py',
		panel: manifest.panel !== false,
		listed: PERMISSIONS.filter((p) => p.tier === 'listed' && known.includes(p)),
		risky: PERMISSIONS.filter((p) => p.tier === 'risky' && known.includes(p)),
		unknown: declared.filter((w) => !PERMISSIONS.some((p) => p.wire === w)),
		combinationRisk: known.some((p) => p.egress) && known.some((p) => p.reads),
		hosts: strings(manifest.hosts).map((h) => h.toLowerCase()),
		hostSettings: settings.filter((s) => s.type === 'host').map((s) => s.key),
		providers: list(manifest.providers).map((p) => ({ tool: str(p.tool), id: str(p.id) || str(p.tool), name: str(p.name) })),
		actions: list(manifest.actions).map((a) => ({ id: str(a.id), name: str(a.name), replaces: a.replaces !== false, input: str(a.input) || 'selection' })),
		keyword: str(tool.keyword),
		chip: tool.chip === true,
		tile: tool.tile === true,
		float: tool.float === true,
		settings,
		...pluginFileTypes(manifest),
	};
}

/** Negative, zero or positive as [a] is older than, the same as or newer than [b]; both MAJOR.MINOR.PATCH. */
export function compareVersions(a: string, b: string): number {
	const pa = a.split('.').map(Number);
	const pb = b.split('.').map(Number);
	for (let i = 0; i < 3; i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d) return d;
	}
	return 0;
}

// ---- diff -------------------------------------------------------------------

/** Beyond this many differing lines, a file's diff is "every line changed" rather than a search for the shortest edit. */
const MAX_EDIT = 2000;

type Op = { op: ' ' | '-' | '+'; line: string };

/** The shortest edit between two line lists (Myers), or the whole of [a] out and [b] in when that would take too long. */
function editScript(a: string[], b: string[]): Op[] {
	const n = a.length;
	const m = b.length;
	const max = Math.min(n + m, MAX_EDIT);
	const offset = max + 1;
	let v = new Int32Array(2 * max + 3);
	const trace: Int32Array[] = [];
	let found = -1;
	for (let d = 0; d <= max && found < 0; d++) {
		trace.push(v.slice());
		const next = v.slice();
		for (let k = -d; k <= d; k += 2) {
			let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
			let y = x - k;
			while (x < n && y < m && a[x] === b[y]) {
				x++;
				y++;
			}
			next[offset + k] = x;
			if (x >= n && y >= m) {
				found = d;
				break;
			}
		}
		v = next;
	}
	if (found < 0) return [...a.map((line) => ({ op: '-' as const, line })), ...b.map((line) => ({ op: '+' as const, line }))];
	// Walk back through the saved frontiers.
	const ops: Op[] = [];
	let x = n;
	let y = m;
	for (let d = found; d > 0; d--) {
		const prev = trace[d]!;
		const k = x - y;
		const down = k === -d || (k !== d && prev[offset + k - 1]! < prev[offset + k + 1]!);
		const prevK = down ? k + 1 : k - 1;
		const prevX = prev[offset + prevK]!;
		const prevY = prevX - prevK;
		while (x > prevX && y > prevY) ops.push({ op: ' ', line: a[--x]! }), y--;
		if (down) ops.push({ op: '+', line: b[--y]! });
		else ops.push({ op: '-', line: a[--x]! });
	}
	while (x > 0 && y > 0) ops.push({ op: ' ', line: a[--x]! }), y--;
	return ops.reverse();
}

function lines(s: string): string[] {
	if (!s) return [];
	const out = s.split('\n');
	if (out[out.length - 1] === '') out.pop();
	return out;
}

/**
 * A unified diff of one file, `diff -u` style with three lines of context,
 * or '' when nothing changed. [before] or [after] is null for a file added or
 * removed.
 */
export function unifiedDiff(name: string, before: string | null, after: string | null, context = 3): string {
	if (before === after) return '';
	const ops = editScript(lines(before ?? ''), lines(after ?? ''));
	const out = [`--- ${before === null ? '/dev/null' : `a/${name}`}`, `+++ ${after === null ? '/dev/null' : `b/${name}`}`];
	let i = 0;
	let aLine = 1;
	let bLine = 1;
	while (i < ops.length) {
		// Skip to the next change, counting lines as we go.
		while (i < ops.length && ops[i]!.op === ' ') {
			i++;
			aLine++;
			bLine++;
		}
		if (i >= ops.length) break;
		const start = Math.max(0, i - context);
		const lead = i - start;
		let end = i;
		// A hunk runs on while the gap between changes is at most twice the context.
		for (;;) {
			while (end < ops.length && ops[end]!.op !== ' ') end++;
			let gap = end;
			while (gap < ops.length && ops[gap]!.op === ' ') gap++;
			if (gap < ops.length && gap - end <= context * 2) end = gap;
			else {
				end = Math.min(end + context, ops.length);
				break;
			}
		}
		const hunk = ops.slice(start, end);
		const aStart = aLine - lead;
		const bStart = bLine - lead;
		const aCount = hunk.filter((o) => o.op !== '+').length;
		const bCount = hunk.filter((o) => o.op !== '-').length;
		out.push(`@@ -${aCount ? aStart : aStart - 1},${aCount} +${bCount ? bStart : bStart - 1},${bCount} @@`);
		for (const o of hunk) out.push(o.op + o.line);
		for (let j = i; j < end; j++) {
			if (ops[j]!.op !== '+') aLine++;
			if (ops[j]!.op !== '-') bLine++;
		}
		i = end;
	}
	return out.join('\n') + '\n';
}

export interface PluginChanges {
	/** The published version's plugin version. */
	from: string;
	/** Every file's diff, text files as unified diffs and the rest as one line each. */
	diff: string;
	added: number;
	removed: number;
	files: { name: string; change: 'added' | 'removed' | 'changed' }[];
	newPermissions: PermissionInfo[];
	newHosts: string[];
}

/** What an update changes, file by file. */
export function pluginChanges(before: PluginArchive, after: PluginArchive): PluginChanges {
	const old = new Map(before.files.map((f) => [f.name, f]));
	const now = new Map(after.files.map((f) => [f.name, f]));
	const names = [...new Set([...after.files.map((f) => f.name), ...before.files.map((f) => f.name)])];
	const parts: string[] = [];
	const files: PluginChanges['files'] = [];
	let added = 0;
	let removed = 0;
	for (const name of names) {
		const a = old.get(name);
		const b = now.get(name);
		if (a && b && Buffer.from(a.bytes).equals(Buffer.from(b.bytes))) continue;
		files.push({ name, change: !a ? 'added' : !b ? 'removed' : 'changed' });
		if ((a && a.text === undefined) || (b && b.text === undefined)) {
			parts.push(`Binary file ${name} ${!a ? `added (${size(b!.size)})` : !b ? 'removed' : `changed (${size(a.size)} to ${size(b.size)})`}\n`);
			continue;
		}
		const d = unifiedDiff(name, a?.text ?? null, b?.text ?? null);
		for (const l of d.split('\n')) {
			if (l.startsWith('+') && !l.startsWith('+++')) added++;
			else if (l.startsWith('-') && !l.startsWith('---')) removed++;
		}
		parts.push(d);
	}
	const was = pluginFacts(before.manifest);
	const is = pluginFacts(after.manifest);
	const had = new Set([...was.listed, ...was.risky].map((p) => p.wire));
	return {
		from: was.version,
		diff: parts.join(''),
		added,
		removed,
		files,
		newPermissions: [...is.listed, ...is.risky].filter((p) => !had.has(p.wire)),
		newHosts: is.hosts.filter((h) => !was.hosts.includes(h)),
	};
}

// ---- wmpy's verdict -----------------------------------------------------------

export interface WmpyProblem {
	severity: string;
	message: string;
	code?: string;
	file?: string;
	line?: number;
	col?: number;
}

/** What the wmpy job found: `wmpy.json` beside its report.json. */
export interface WmpyReport {
	/** `wmpy --version`. */
	version?: string;
	/** Set when wmpy itself could not run: nothing the submitter can fix. */
	error?: string;
	check: { ok: boolean; errors: number; warnings: number; problems: WmpyProblem[] } | null;
	/** Null when the plugin has no tests. */
	test: { ok: boolean; passed: number; failed: number; problems: WmpyProblem[] } | null;
}

export function size(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
