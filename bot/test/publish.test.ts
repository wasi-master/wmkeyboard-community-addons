import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { DEFAULT_REPO_SLUG, PENDING_REPO_ID, REPO_ID } from '../src/constants.ts';
import { buildManifest, buildReadme, manifestText, sha256 } from '../src/manifest.ts';
import { collectImages, metaFor, pendingManifest, writeAddonFolder, type Summary } from '../src/pending.ts';
import { bumpMinor, readPublished } from '../src/repo.ts';
import { ALICE, meta, tree, vectors } from './helpers.ts';

const THEME = vectors()[0]!.json;
const LAYOUT = vectors()[2]!.json;
const PNG = Buffer.from('89504e470d0a1a0a0000', 'hex');

function summary(over: Partial<Summary> = {}): Summary {
	return {
		ok: true,
		checks: [],
		warnings: [],
		type: 'theme',
		id: 'neon',
		isUpdate: false,
		name: 'Neon',
		description: 'Bright.',
		tags: ['neon'],
		license: 'CC-BY-4.0',
		basedOn: null,
		submitter: ALICE,
		issue: 7,
		...over,
	};
}

describe('manifest', () => {
	const root = tree([
		{ meta: meta({ id: 'arcade', type: 'theme', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z', basedOn: 'com.wasimaster.wmkeyboard.official/arcade-cabinet' }), payload: THEME },
		{ meta: meta({ id: 'edit-row', type: 'layout', previews: ['preview.png', 'preview-dark.png'] }), payload: LAYOUT },
	]);
	const published = readPublished(root);
	const manifest = buildManifest(root, published);

	it('keeps the repo id the app installs under', () => {
		assert.equal(REPO_ID, 'com.wasimaster.wmkeyboard.community');
		assert.equal(manifest.repo.id, REPO_ID);
		assert.equal(manifest.format, 'wmkeyboard-repo');
		assert.equal(manifest.version, 1);
	});

	it('lists every addon with checksums of its payload', () => {
		assert.deepEqual(manifest.addons.map((a) => [a.type, a.id]), [['theme', 'arcade'], ['layout', 'edit-row']]);
		const theme = manifest.addons[0]!;
		assert.equal(theme.path, 'addons/themes/arcade/theme.wmtheme.json');
		assert.equal(theme.sha256, sha256(Buffer.from(THEME)));
		assert.equal(theme.sizeBytes, Buffer.byteLength(THEME));
		assert.deepEqual(theme.previews, ['addons/themes/arcade/preview.png']);
		assert.equal(theme.author, 'alice');
		assert.equal(theme.basedOn, 'com.wasimaster.wmkeyboard.official/arcade-cabinet');
		assert.equal(manifest.addons[1]!.basedOn, undefined);
		for (const a of manifest.addons) {
			assert.match(a.id, /^[A-Za-z0-9._-]+$/);
			assert.match(a.version, /^\d+\.\d+\.\d+$/);
			assert.match(a.sha256, /^[a-f0-9]{64}$/);
		}
	});

	it('dates the repo by its newest change, so regenerating is stable', () => {
		assert.equal(manifest.repo.updatedAt, '2026-10-05');
		assert.equal(manifestText(buildManifest(root, readPublished(root))), manifestText(manifest));
	});

	it('writes a README gallery with escaped text, newest first', () => {
		const evil = tree([{ meta: meta({ id: 'evil', type: 'theme', name: '<img src=x> | @everyone `x`', submitter: { login: 'mallory', id: 9 } }), payload: THEME }]);
		const readme = buildReadme(readPublished(evil));
		assert.doesNotMatch(readme, /<img src=x>/);
		assert.doesNotMatch(readme, /@everyone/);
		assert.match(readme, /addons\/themes\/evil\/preview\.png/);
		const both = buildReadme(published);
		assert.ok(both.indexOf('arcade') < both.indexOf('edit-row') || both.indexOf('## Layouts') < both.indexOf('edit-row'));
		assert.match(both, new RegExp(`issues/new\\?template=submit-theme\\.yml`));
		assert.match(buildReadme([]), /None yet/);
	});
});

describe('pending and approve', () => {
	it('makes a one-addon manifest under its own repo id', () => {
		const m = metaFor(summary(), ['preview.png'], '2026-10-27T00:00:00Z');
		const pm = pendingManifest(m, Buffer.from(THEME), 7);
		assert.equal(pm.repo.id, PENDING_REPO_ID);
		assert.notEqual(pm.repo.id, REPO_ID);
		assert.equal(pm.addons.length, 1);
		assert.equal(pm.addons[0]!.path, 'theme.wmtheme.json');
		assert.deepEqual(pm.addons[0]!.previews, ['preview.png']);
	});

	it('starts new addons at 1.0.0 and bumps updates a minor version', () => {
		const first = metaFor(summary(), [], '2026-10-01T00:00:00Z');
		assert.equal(first.version, '1.0.0');
		assert.deepEqual(first.issues, [7]);
		const second = metaFor(summary({ isUpdate: true, issue: 12, name: 'Neon 2' }), [], '2026-10-20T00:00:00Z', { ...first, version: '1.4.2' });
		assert.equal(second.version, '1.5.0');
		assert.equal(second.createdAt, '2026-10-01T00:00:00Z');
		assert.equal(second.updatedAt, '2026-10-20T00:00:00Z');
		assert.deepEqual(second.issues, [7, 12]);
		assert.equal(bumpMinor('nonsense'), '1.0.0');
	});

	it('keeps the original credit when an update leaves based_on empty', () => {
		const first = metaFor(summary({ basedOn: 'a/b' }), [], 'now');
		assert.equal(metaFor(summary({ isUpdate: true }), [], 'later', first).basedOn, 'a/b');
	});

	it('renames render output to preview files and drops stale ones', () => {
		const out = mkdtempSync(join(tmpdir(), 'render-'));
		writeFileSync(join(out, 'neon.png'), PNG);
		writeFileSync(join(out, 'neon-dark.png'), PNG);
		writeFileSync(join(out, 'neon-landscape.png'), Buffer.from('not a png'));
		assert.throws(() => collectImages(out, 'neon'), /not a PNG/);
		writeFileSync(join(out, 'neon-landscape.png'), PNG);
		writeFileSync(join(out, 'neon-clipboard.png'), PNG);
		writeFileSync(join(out, 'neon-tools.png'), PNG);
		// A layout's layers, its own pages after the known ones, and names that are not ours.
		writeFileSync(join(out, 'neon-page2.png'), PNG);
		writeFileSync(join(out, 'neon-page1.png'), PNG);
		writeFileSync(join(out, 'neon-symbols2.png'), PNG);
		writeFileSync(join(out, 'neon-shift.png'), PNG);
		writeFileSync(join(out, 'neon-Bad.png'), PNG);
		writeFileSync(join(out, 'neon-two-words.png'), PNG);
		writeFileSync(join(out, 'neonish.png'), PNG);
		const images = collectImages(out, 'neon');
		assert.deepEqual(images.map((i) => i.name), [
			'preview.png', 'preview-landscape.png', 'preview-dark.png', 'preview-tools.png', 'preview-clipboard.png',
			'preview-shift.png', 'preview-symbols2.png', 'preview-page1.png', 'preview-page2.png',
		]);

		const target = mkdtempSync(join(tmpdir(), 'addon-'));
		writeFileSync(join(target, 'preview-old.png'), PNG);
		const m = metaFor(summary(), images.map((i) => i.name), 'now');
		writeAddonFolder(target, m, Buffer.from(THEME), images.slice(0, 1));
		assert.deepEqual(readdirSync(target).sort(), ['meta.json', 'preview.png', 'theme.wmtheme.json']);
		assert.equal(readFileSync(join(target, 'theme.wmtheme.json'), 'utf8'), THEME);
	});

	it('round-trips through readPublished into a manifest', () => {
		const root = tree([]);
		const m = metaFor(summary(), ['preview.png'], '2026-10-27T10:00:00Z');
		writeAddonFolder(join(root, 'addons/themes/neon'), m, Buffer.from(THEME), []);
		const manifest = buildManifest(root, readPublished(root), DEFAULT_REPO_SLUG);
		assert.equal(manifest.addons[0]!.id, 'neon');
		assert.equal(manifest.addons[0]!.license, 'CC-BY-4.0');
	});
});
