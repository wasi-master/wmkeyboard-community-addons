/**
 * Getting the addon out of the `payload` box.
 *
 * Three shapes reach it: the app's encoded string (`wmkb:1:` + base64url, no
 * padding, of zlib-wrapped DEFLATE of the file's bytes), a link to a `.zip` the
 * submitter dragged in, or JSON pasted as it is. A theme's, layout's or
 * snippet pack's file is its UTF-8 JSON; an icon, sticker or sound pack's file
 * is a zip of its own. Encoders may produce different bytes for the same file,
 * so everything downstream compares decoded content, never encoded strings.
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { LIMITS, PAYLOAD_PREFIX, TYPES, type AddonType } from './constants.ts';

export class PayloadError extends Error {}

/** What the box holds, before anything is downloaded or inflated. */
export type PayloadSource =
	| { kind: 'encoded'; token: string }
	| { kind: 'zip'; url: string }
	| { kind: 'json'; text: string }
	| { kind: 'none' };

/** Reference encoder, for tests and the shared vectors. The app has its own. */
export function encodePayload(file: string | Uint8Array): string {
	const bytes = typeof file === 'string' ? Buffer.from(file, 'utf8') : file;
	return PAYLOAD_PREFIX + deflateSync(bytes, { level: 9 }).toString('base64url');
}

/**
 * Inflates one `wmkb:1:` string, refusing anything that would decode to more
 * than [maxBytes] rather than finding out after it has.
 */
export function decodeEncoded(token: string, maxBytes: number): Uint8Array {
	if (!token.startsWith(PAYLOAD_PREFIX)) {
		const version = /^wmkb:(\d+):/.exec(token)?.[1];
		throw new PayloadError(
			version ? `This payload uses encoding version ${version}; the bot reads version 1. Update WM Keyboard and share again.` : 'The payload does not start with "wmkb:1:".',
		);
	}
	const body = token.slice(PAYLOAD_PREFIX.length);
	if (!body) throw new PayloadError('The payload is empty after "wmkb:1:".');
	if (token.length > LIMITS.encodedChars) throw new PayloadError(`The payload is ${token.length} characters, more than an issue can hold. Attach the .zip instead.`);
	if (!/^[A-Za-z0-9_-]+$/.test(body)) throw new PayloadError('The payload has characters that are not base64url. Copy it again without editing it.');
	if (body.length % 4 === 1) throw new PayloadError('The payload is cut short. Copy the whole text again.');
	let inflated: Buffer;
	try {
		inflated = inflateSync(Buffer.from(body, 'base64url'), { maxOutputLength: maxBytes });
	} catch (e) {
		const code = (e as NodeJS.ErrnoException).code;
		if (code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|Cannot create a Buffer larger/i.test(String((e as Error).message))) {
			throw new PayloadError(`The payload unpacks to more than ${Math.round(maxBytes / 1024 / 1024)} MB, the most WM Keyboard installs.`);
		}
		throw new PayloadError('The payload does not unpack. It may be cut short: copy the whole text again, or attach the .zip.');
	}
	return inflated;
}

export function utf8(bytes: Uint8Array): string {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		throw new PayloadError('The payload is not UTF-8 text.');
	}
}

const ATTACHMENT_URL = [
	// What the issue editor writes for a dragged-in file today…
	/https:\/\/github\.com\/user-attachments\/files\/\d+\/[^\s)\]<>"']+/g,
	// …and what it wrote before, still seen in older clients.
	/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/files\/\d+\/[^\s)\]<>"']+/g,
];

/** Finds what the payload box holds. Never fetches anything. */
export function findPayload(answer: string | undefined): PayloadSource {
	const text = (answer ?? '').replace(/^\s*```[^\n]*$/gm, '').trim();
	if (!text) return { kind: 'none' };
	const token = /wmkb:\d+:[A-Za-z0-9_-]*/.exec(text)?.[0];
	if (token) return { kind: 'encoded', token };
	const zips = ATTACHMENT_URL.flatMap((re) => [...text.matchAll(re)].map((m) => m[0])).filter((u) => /\.zip$/i.test(u));
	if (zips.length) return { kind: 'zip', url: zips[0]! };
	if (text.startsWith('{')) return { kind: 'json', text };
	return { kind: 'none' };
}

/** Downloads an attachment with a hard cap, counting bytes as they arrive. */
export async function downloadZip(url: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
	if (!ATTACHMENT_URL.some((re) => new RegExp(`^${re.source}$`).test(url))) {
		throw new PayloadError('Only files attached to this issue are read.');
	}
	const response = await fetchImpl(url, { redirect: 'follow' });
	if (!response.ok || !response.body) throw new PayloadError(`The attached zip could not be downloaded (HTTP ${response.status}).`);
	const declared = Number(response.headers.get('content-length') ?? 0);
	if (declared > LIMITS.zipBytes) throw new PayloadError(`The zip is ${Math.round(declared / 1024 / 1024)} MB; the limit is ${LIMITS.zipBytes / 1024 / 1024} MB.`);
	const chunks: Uint8Array[] = [];
	let total = 0;
	for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
		total += chunk.byteLength;
		if (total > LIMITS.zipBytes) throw new PayloadError(`The zip is over ${LIMITS.zipBytes / 1024 / 1024} MB.`);
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

/** Addon files a wrapping zip may hold, by extension, with the type each one is. */
const ADDON_FILES: { pattern: RegExp; type: AddonType }[] = [
	{ pattern: /(^|\/)[^/]*\.wmtheme\.json$/i, type: 'theme' },
	{ pattern: /(^|\/)[^/]*\.wmlayout\.json$/i, type: 'layout' },
	{ pattern: /(^|\/)[^/]*\.wmsnippets\.json$/i, type: 'snippets' },
	{ pattern: /(^|\/)[^/]*\.wmicons$/i, type: 'icon_pack' },
	{ pattern: /(^|\/)[^/]*\.wmstickers$/i, type: 'stickers' },
	{ pattern: /(^|\/)[^/]*\.wmsoundpack$/i, type: 'sound_pack' },
];

const PACK_TYPES = (Object.keys(TYPES) as AddonType[]).filter((t) => TYPES[t].binary);

/** The manifest at the top of an icon, sticker or sound pack. */
const PACK_MANIFEST = 'pack.json';

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export function isZip(bytes: Uint8Array): boolean {
	return ZIP_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * The addon in a submitted zip, as its file's bytes. The zip either wraps one
 * addon file (a theme's JSON, or a pack under its own extension) or is an
 * icon, sticker or sound pack itself, saved as `.zip` so GitHub takes it. A
 * wrapped file is inflated only when its declared size is within its type's cap.
 */
export function extractFromZip(bytes: Uint8Array): { name: string; bytes: Uint8Array } {
	let entries = 0;
	let isPack = false;
	const candidates: { name: string; size: number }[] = [];
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes, {
			filter: (file) => {
				entries++;
				if (entries > LIMITS.archiveEntries) throw new PayloadError(`The zip has more than ${LIMITS.archiveEntries} files, more than WM Keyboard reads.`);
				if (file.name === PACK_MANIFEST) isPack = true;
				const known = ADDON_FILES.find((f) => f.pattern.test(file.name));
				if (file.name.startsWith('__MACOSX/') || !known) return false;
				candidates.push({ name: file.name, size: file.originalSize });
				return file.originalSize <= TYPES[known.type].maxBytes;
			},
		});
	} catch (e) {
		if (e instanceof PayloadError) throw e;
		throw new PayloadError(`The attachment is not a zip file the bot can read (${(e as Error).message}).`);
	}
	// A pack's own archive: its files are the pack, not a wrapper around one.
	if (isPack) return { name: PACK_MANIFEST, bytes };
	if (entries > LIMITS.zipEntries) throw new PayloadError(`The zip has more than ${LIMITS.zipEntries} files; it should hold one.`);
	if (!candidates.length) {
		throw new PayloadError('The zip holds no theme.wmtheme.json, layout.wmlayout.json or .wmsnippets.json, and is not an icon, sticker or sound pack (no pack.json at its top level).');
	}
	if (candidates.length > 1) throw new PayloadError(`The zip holds ${candidates.length} addon files; send one per issue.`);
	const only = candidates[0]!;
	const data = files[only.name];
	if (!data) throw new PayloadError(`${only.name} is ${Math.round(only.size / 1024 / 1024)} MB unpacked, more than WM Keyboard installs.`);
	return { name: only.name, bytes: data };
}

/** What the decoded file is, from its content rather than the form it came in. */
export type Classified =
	| { type: 'theme'; json: Record<string, unknown> }
	| { type: 'layout'; shape: 'envelope' | 'layer' | 'bare'; json: Record<string, unknown> }
	| { type: 'snippets'; json: Record<string, unknown> }
	| { type: 'icon_pack' | 'stickers' | 'sound_pack'; manifest: Record<string, unknown>; bytes: Uint8Array };

/** Any addon file: a pack when it is a zip, otherwise a JSON document. */
export function classifyBytes(bytes: Uint8Array): Classified {
	return isZip(bytes) ? classifyPack(bytes) : classify(utf8(bytes));
}

/** A JSON document: a theme, a layout (three shapes) or a snippet pack. */
export function classify(text: string): Classified {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		throw new PayloadError(`The payload is not valid JSON: ${(e as Error).message}`);
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PayloadError('The payload is not a JSON object.');
	const o = raw as Record<string, unknown>;
	const format = o.format;
	if (format === 'wmkeyboard-layout') return { type: 'layout', shape: 'envelope', json: o };
	if (format === 'wmkeyboard-layer') return { type: 'layout', shape: 'layer', json: o };
	if (format === 'wmkeyboard-layouts') throw new PayloadError('This file holds several layouts. Export the one you want to share on its own.');
	if (format === TYPES.snippets.format) return { type: 'snippets', json: o };
	const pack = PACK_TYPES.find((t) => TYPES[t].format === format);
	if (pack) throw new PayloadError(`This is only the pack.json of a ${TYPES[pack].noun}. Attach the whole pack file instead, as a .zip.`);
	if (typeof format === 'string') throw new PayloadError(`"format": "${format.slice(0, 40)}" is not an addon this repository takes.`);
	if (o.layers && typeof o.layers === 'object' && typeof o.id === 'string') return { type: 'layout', shape: 'bare', json: o };
	if (typeof o.id === 'string' && typeof o.name === 'string') return { type: 'theme', json: o };
	throw new PayloadError('The payload is neither a WM Keyboard theme, a layout nor a snippet pack.');
}

/**
 * An icon, sticker or sound pack, told apart by the `format` in its
 * pack.json. Only that one entry is inflated; whether the icons, stickers or
 * sounds in it are usable is what the app's importer decides in the full pass.
 */
function classifyPack(bytes: Uint8Array): Classified {
	let entries = 0;
	let manifestSize = -1;
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes, {
			filter: (file) => {
				if (++entries > LIMITS.archiveEntries) throw new PayloadError(`The pack has more than ${LIMITS.archiveEntries} files, more than WM Keyboard reads.`);
				if (file.name !== PACK_MANIFEST) return false;
				manifestSize = file.originalSize;
				return file.originalSize <= LIMITS.packManifestBytes;
			},
		});
	} catch (e) {
		if (e instanceof PayloadError) throw e;
		throw new PayloadError(`The pack is not a zip file the bot can read (${(e as Error).message}).`);
	}
	if (manifestSize < 0) {
		throw new PayloadError('The zip has no pack.json at its top level, so it is not an icon, sticker or sound pack.');
	}
	const data = files[PACK_MANIFEST];
	if (!data) throw new PayloadError(`pack.json is ${Math.round(manifestSize / 1024)} KB; WM Keyboard reads at most ${LIMITS.packManifestBytes / 1024} KB of it.`);
	let manifest: unknown;
	try {
		manifest = JSON.parse(utf8(data));
	} catch (e) {
		if (e instanceof PayloadError) throw e;
		throw new PayloadError(`pack.json is not valid JSON: ${(e as Error).message}`);
	}
	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new PayloadError('pack.json is not a JSON object.');
	const format = (manifest as Record<string, unknown>).format;
	const type = PACK_TYPES.find((t) => TYPES[t].format === format) as 'icon_pack' | 'stickers' | 'sound_pack' | undefined;
	if (!type) {
		throw new PayloadError(
			typeof format === 'string'
				? `pack.json says "format": "${format.slice(0, 40)}", which is not an icon, sticker or sound pack.`
				: 'pack.json has no "format", so it is not a WM Keyboard pack.',
		);
	}
	if (entries < 2) throw new PayloadError(`The ${TYPES[type].noun} holds nothing but its pack.json.`);
	return { type, manifest: manifest as Record<string, unknown>, bytes };
}

/** Largest decoded size any type accepts; the per-type cap is checked after classifying. */
export const MAX_DECODED = Math.max(...Object.values(TYPES).map((t) => t.maxBytes));

export function checkSize(type: AddonType, bytes: number): void {
	if (bytes > TYPES[type].maxBytes) {
		throw new PayloadError(`The ${TYPES[type].noun} is ${Math.round(bytes / 1024 / 1024)} MB; WM Keyboard installs at most ${TYPES[type].maxBytes / 1024 / 1024} MB.`);
	}
}
