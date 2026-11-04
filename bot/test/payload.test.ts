import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { describe, it } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { PAYLOAD_PREFIX, TYPES } from '../src/constants.ts';
import { classify, classifyBytes, decodeEncoded, downloadZip, encodePayload, extractFromZip, findPayload, MAX_DECODED, PayloadError } from '../src/payload.ts';

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');
import { vectors } from './helpers.ts';

describe('shared vectors', () => {
	const all = vectors();

	it('holds two themes and a layout', () => {
		assert.equal(all.length >= 3, true);
		assert.deepEqual(
			all.map((v) => classify(v.json).type),
			['theme', 'theme', 'layout'],
		);
	});

	for (const v of all) {
		it(`decodes ${v.name} to its JSON`, () => {
			assert.ok(v.encoded.startsWith(PAYLOAD_PREFIX));
			assert.ok(!v.encoded.includes('='), 'no base64 padding');
			const decoded = text(decodeEncoded(v.encoded, MAX_DECODED));
			assert.deepEqual(JSON.parse(decoded), JSON.parse(v.json));
		});

		it(`round-trips ${v.name} through the reference encoder`, () => {
			// Compared as JSON: another encoder may pick other deflate bytes.
			assert.deepEqual(JSON.parse(text(decodeEncoded(encodePayload(v.json), MAX_DECODED))), JSON.parse(v.json));
		});
	}

	it('decodes what a different deflate level produced', () => {
		const json = all[0]!.json;
		const fast = PAYLOAD_PREFIX + deflateSync(Buffer.from(json), { level: 1 }).toString('base64url');
		assert.notEqual(fast, all[0]!.encoded);
		assert.deepEqual(JSON.parse(text(decodeEncoded(fast, MAX_DECODED))), JSON.parse(json));
	});
});

describe('decodeEncoded', () => {
	const fails = (token: string, pattern: RegExp, max = MAX_DECODED) =>
		assert.throws(() => decodeEncoded(token, max), (e: unknown) => e instanceof PayloadError && pattern.test(e.message));

	it('refuses another encoding version by name', () => fails('wmkb:2:abc', /version 2/));
	it('refuses a missing prefix', () => fails('eJyrVg', /does not start/));
	it('refuses non-base64url characters', () => fails('wmkb:1:ab+c/d', /base64url/));
	it('refuses a truncated string', () => fails(encodePayload('{"id":"a","name":"b"}').slice(0, -6), /cut short|unpack/));
	it('stops inflating at the cap', () => fails(encodePayload(`{"x":"${'a'.repeat(5000)}"}`), /unpacks to more than/, 1000));
	it('refuses raw DEFLATE without the zlib wrapper', () => {
		const raw = PAYLOAD_PREFIX + deflateSync(Buffer.from('{}'), { level: 9 }).subarray(2).toString('base64url');
		fails(raw, /unpack/);
	});
	it('refuses text that is not UTF-8', () => {
		const token = PAYLOAD_PREFIX + deflateSync(Buffer.from([0xff, 0xfe, 0x00])).toString('base64url');
		assert.throws(() => classifyBytes(decodeEncoded(token, MAX_DECODED)), (e: unknown) => e instanceof PayloadError && /UTF-8/.test(e.message));
	});
});

describe('findPayload', () => {
	it('finds an encoded string among other text and fences', () => {
		assert.deepEqual(findPayload('here you go:\n```\nwmkb:1:eJyrVkrLzClJLVKyUkpKLFKqBQA\n```'), { kind: 'encoded', token: 'wmkb:1:eJyrVkrLzClJLVKyUkpKLFKqBQA' });
	});
	it('finds a dragged-in zip', () => {
		const url = 'https://github.com/user-attachments/files/123456/my-theme.zip';
		assert.deepEqual(findPayload(`[my-theme.zip](${url})`), { kind: 'zip', url });
	});
	it('ignores links to anything but issue attachments', () => {
		assert.deepEqual(findPayload('[x.zip](https://evil.example/x.zip)'), { kind: 'none' });
	});
	it('takes pasted JSON', () => assert.equal(findPayload('```json\n{"id":"a"}\n```').kind, 'json'));
	it('reports an empty box', () => assert.deepEqual(findPayload(''), { kind: 'none' }));
});

describe('zip attachments', () => {
	const theme = '{"id":"t","name":"T","keyBackground":4294967295}';

	it('reads the one theme in a zip', () => {
		const zip = zipSync({ 'theme.wmtheme.json': strToU8(theme), '__MACOSX/._theme.wmtheme.json': strToU8('junk') });
		assert.equal(text(extractFromZip(zip).bytes), theme);
	});
	it('refuses two addons in one zip', () => {
		const zip = zipSync({ 'a.wmtheme.json': strToU8(theme), 'b.wmlayout.json': strToU8('{}') });
		assert.throws(() => extractFromZip(zip), /holds 2 addon files/);
	});
	it('refuses a zip with no addon', () => {
		assert.throws(() => extractFromZip(zipSync({ 'readme.txt': strToU8('hi') })), /holds no theme/);
	});
	it('refuses a zip of many files', () => {
		const files: Record<string, Uint8Array> = {};
		for (let i = 0; i < 40; i++) files[`f${i}.txt`] = strToU8('x');
		assert.throws(() => extractFromZip(zipSync(files)), /more than 16 files/);
	});
	it('refuses what is not a zip', () => assert.throws(() => extractFromZip(strToU8('not a zip')), PayloadError));
	it('refuses a layout over the cap without inflating it', () => {
		const big = strToU8(`{"format":"wmkeyboard-layout","pad":"${' '.repeat(TYPES.layout.maxBytes)}"}`);
		assert.throws(() => extractFromZip(zipSync({ 'layout.wmlayout.json': big }, { level: 9 })), /more than WM Keyboard installs/);
	});

	it('downloads only from issue attachments, with a size cap', async () => {
		await assert.rejects(downloadZip('https://evil.example/x.zip', (async () => new Response('x')) as typeof fetch), /attached to this issue/);
		const huge = (async () => new Response('x', { headers: { 'content-length': String(100 * 1024 * 1024) } })) as typeof fetch;
		await assert.rejects(downloadZip('https://github.com/user-attachments/files/1/a.zip', huge), /limit is/);
		const ok = (async () => new Response(new Uint8Array([1, 2, 3]))) as typeof fetch;
		assert.deepEqual([...(await downloadZip('https://github.com/user-attachments/files/1/a.zip', ok))], [1, 2, 3]);
	});
});

describe('classify', () => {
	it('tells layouts by format and themes by shape', () => {
		assert.equal(classify('{"format":"wmkeyboard-layout","layout":{}}').type, 'layout');
		assert.deepEqual(classify('{"format":"wmkeyboard-layer","spec":{}}'), { type: 'layout', shape: 'layer', json: { format: 'wmkeyboard-layer', spec: {} } });
		assert.equal(classify('{"id":"x","layers":{}}').type, 'layout');
		assert.equal(classify('{"id":"x","name":"X"}').type, 'theme');
	});
	it('refuses a settings backup, a layout bundle and junk', () => {
		assert.throws(() => classify('{"format":"wmkeyboard-backup"}'), /not an addon this repository takes/);
		assert.throws(() => classify('{"format":"wmkeyboard-layouts"}'), /several layouts/);
		assert.throws(() => classify('[1,2]'), /not a JSON object/);
		assert.throws(() => classify('{nope'), /not valid JSON/);
	});
});

/** A minimal pack archive: pack.json plus [files]. */
function pack(format: string, files: Record<string, string> = { 'icons/tool.clipboard.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' }): Uint8Array {
	const entries: Record<string, Uint8Array> = { 'pack.json': strToU8(JSON.stringify({ format, version: 1, pack: { id: 'p', name: 'P' } })) };
	for (const [name, body] of Object.entries(files)) entries[name] = strToU8(body);
	return zipSync(entries);
}

describe('packs', () => {
	it('tells icon, sticker and sound packs apart by their pack.json', () => {
		assert.equal(classifyBytes(pack('wmkeyboard-icons')).type, 'icon_pack');
		assert.equal(classifyBytes(pack('wmkeyboard-stickers', { 'stickers/a.webp': 'x' })).type, 'stickers');
		assert.equal(classifyBytes(pack('wmkeyboard-sound-pack', { 'press.ogg': 'x' })).type, 'sound_pack');
	});
	it('takes a snippet file as JSON', () => {
		assert.equal(classify('{"format":"wmkeyboard-snippets","version":2,"snippets":[]}').type, 'snippets');
	});
	it('reads a pack renamed to .zip as the pack itself, even with many files', () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 40; i++) files[`icons/x${i}.svg`] = '<svg/>';
		const zip = pack('wmkeyboard-icons', files);
		const out = extractFromZip(zip);
		assert.equal(out.bytes, zip);
		assert.equal(classifyBytes(out.bytes).type, 'icon_pack');
	});
	it('unwraps a pack saved under its own extension inside a zip', () => {
		const inner = pack('wmkeyboard-stickers', { 'stickers/a.webp': 'x' });
		const out = extractFromZip(zipSync({ 'Cats.wmstickers': inner }));
		assert.equal(classifyBytes(out.bytes).type, 'stickers');
	});
	it('refuses a zip that is no pack, and a pack.json alone', () => {
		assert.throws(() => classifyBytes(zipSync({ 'a.svg': strToU8('<svg/>') })), /no pack.json/);
		assert.throws(() => classifyBytes(pack('wmkeyboard-plugin')), /not an icon, sticker or sound pack/);
		assert.throws(() => classifyBytes(zipSync({ 'pack.json': strToU8('{"format":"wmkeyboard-icons"}') })), /nothing but its pack.json/);
		assert.throws(() => classify('{"format":"wmkeyboard-icons","pack":{}}'), /only the pack.json of a icon pack|only the pack.json of an? icon pack/);
	});
	it('round-trips a pack through the encoded form', () => {
		const zip = pack('wmkeyboard-icons');
		assert.equal(classifyBytes(decodeEncoded(encodePayload(zip), MAX_DECODED)).type, 'icon_pack');
	});
});
