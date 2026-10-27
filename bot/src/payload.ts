/**
 * Getting the addon's JSON out of the `payload` box.
 *
 * Three shapes reach it: the app's encoded string (`wmkb:1:` + base64url, no
 * padding, of zlib-wrapped DEFLATE of the UTF-8 JSON), a link to a `.zip` the
 * submitter dragged in, or JSON pasted as it is. Encoders may produce
 * different bytes for the same JSON, so everything downstream compares decoded
 * JSON, never encoded strings.
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
export function encodePayload(json: string): string {
	return PAYLOAD_PREFIX + deflateSync(Buffer.from(json, 'utf8'), { level: 9 }).toString('base64url');
}

/**
 * Inflates one `wmkb:1:` string, refusing anything that would decode to more
 * than [maxBytes] rather than finding out after it has.
 */
export function decodeEncoded(token: string, maxBytes: number): string {
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
	return utf8(inflated);
}

function utf8(bytes: Uint8Array): string {
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

const PAYLOAD_NAME = /(^|\/)[^/]*\.(wmtheme|wmlayout)\.json$/i;

/**
 * The one theme or layout file in a submitted zip. Only that entry is
 * inflated, and only when its declared size is within the type's cap.
 */
export function extractFromZip(bytes: Uint8Array): { name: string; text: string } {
	let entries = 0;
	const candidates: { name: string; size: number }[] = [];
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes, {
			filter: (file) => {
				entries++;
				if (entries > LIMITS.zipEntries) throw new PayloadError(`The zip has more than ${LIMITS.zipEntries} files; it should hold one.`);
				if (file.name.startsWith('__MACOSX/') || !PAYLOAD_NAME.test(file.name)) return false;
				candidates.push({ name: file.name, size: file.originalSize });
				const max = /wmtheme/i.test(file.name) ? TYPES.theme.maxBytes : TYPES.layout.maxBytes;
				return file.originalSize <= max;
			},
		});
	} catch (e) {
		if (e instanceof PayloadError) throw e;
		throw new PayloadError(`The attachment is not a zip file the bot can read (${(e as Error).message}).`);
	}
	if (!candidates.length) throw new PayloadError('The zip holds no theme.wmtheme.json or layout.wmlayout.json.');
	if (candidates.length > 1) throw new PayloadError(`The zip holds ${candidates.length} addon files; send one per issue.`);
	const only = candidates[0]!;
	const data = files[only.name];
	if (!data) throw new PayloadError(`${only.name} is ${Math.round(only.size / 1024 / 1024)} MB unpacked, more than WM Keyboard installs.`);
	return { name: only.name, text: utf8(data) };
}

/** What the decoded JSON is, from its content rather than the form it came in. */
export type Classified =
	| { type: 'theme'; json: Record<string, unknown> }
	| { type: 'layout'; shape: 'envelope' | 'layer' | 'bare'; json: Record<string, unknown> };

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
	if (typeof format === 'string') throw new PayloadError(`"format": "${format.slice(0, 40)}" is not a theme or a layout.`);
	if (o.layers && typeof o.layers === 'object' && typeof o.id === 'string') return { type: 'layout', shape: 'bare', json: o };
	if (typeof o.id === 'string' && typeof o.name === 'string') return { type: 'theme', json: o };
	throw new PayloadError('The payload is neither a WM Keyboard theme nor a layout.');
}

/** Largest decoded size any type accepts; the per-type cap is checked after classifying. */
export const MAX_DECODED = Math.max(...Object.values(TYPES).map((t) => t.maxBytes));

export function checkSize(type: AddonType, text: string): void {
	const bytes = Buffer.byteLength(text, 'utf8');
	if (bytes > TYPES[type].maxBytes) {
		throw new PayloadError(`The ${type} is ${Math.round(bytes / 1024 / 1024)} MB; WM Keyboard installs at most ${TYPES[type].maxBytes / 1024 / 1024} MB.`);
	}
}
