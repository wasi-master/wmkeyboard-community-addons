import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { recordedRename, renderSticky, renameComment, verdict } from '../src/comment.ts';
import { BOT_LOGIN } from '../src/github.ts';
import { buildManifest, entryFor, sha256 } from '../src/manifest.ts';
import { encodePayload } from '../src/payload.ts';
import { metaFor, pendingManifest, writePluginSource, type Summary } from '../src/pending.ts';
import { compareVersions, pluginFacts, readPluginArchive, unifiedDiff, type WmpyReport } from '../src/plugin.ts';
import { readPublished } from '../src/repo.ts';
import { buildReview, fence, renderAsks } from '../src/review.ts';
import { checkWithWmpy, hasTests, quickReport, unpackPlugin, type Runner } from '../src/wmpy.ts';
import { adoptedType, parseIssueForm } from '../src/form.ts';
import { ALICE, BOB, body, byteVectors, evaluate, fixture, LABELS, meta, pluginManifest, pluginZip, tree } from './helpers.ts';

const failing = (r: { checks: { title: string; ok: boolean; detail?: string }[] }) => r.checks.filter((c) => !c.ok).map((c) => c.title);
const detail = (r: { checks: { title: string; detail?: string }[] }, title: string) => r.checks.find((c) => c.title === title)?.detail ?? '';
const refuses = (bytes: Uint8Array, pattern: RegExp) => assert.throws(() => readPluginArchive(bytes), (e: unknown) => e instanceof Error && pattern.test(e.message));

describe('reading a .wmplugin', () => {
	it('reads the shared vector', () => {
		const archive = readPluginArchive(Buffer.from(byteVectors()[0]!.bytes, 'base64'));
		assert.equal(archive.manifest.id, 'com.example.echo');
		assert.deepEqual(archive.files.map((f) => [f.name, f.kind]), [['plugin.json', 'manifest'], ['main.py', 'entry']]);
	});

	it('sorts and names every kind of file', () => {
		const archive = readPluginArchive(
			pluginZip(pluginManifest(), {
				'lib/__init__.py': '',
				'helpers.py': 'X = 1\n',
				'test.py': 'pass\n',
				'locales/de.json': '{"Type it": "Tippen"}',
				'assets/logo.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
				'README.md': '# Echo\n',
				'__MACOSX/._main.py': 'junk',
				'.DS_Store': 'junk',
			}),
		);
		assert.deepEqual(
			archive.files.map((f) => `${f.kind}:${f.name}`),
			['manifest:plugin.json', 'entry:main.py', 'module:helpers.py', 'module:lib/__init__.py', 'test:test.py', 'locale:locales/de.json', 'asset:assets/logo.png', 'other:README.md'],
		);
		assert.equal(archive.files.find((f) => f.name === 'assets/logo.png')!.text, undefined);
		assert.equal(archive.files.find((f) => f.name === 'helpers.py')!.text, 'X = 1\n');
	});

	it('finds the entry by its last part, as the app does', () => {
		const zip = zipSync({ 'plugin.json': strToU8(JSON.stringify(pluginManifest({ entry: 'src/main.py' }))), 'main.py': strToU8('pass\n') });
		assert.equal(readPluginArchive(zip).files.find((f) => f.kind === 'entry')!.name, 'main.py');
	});

	it('refuses what the app refuses', () => {
		refuses(zipSync({ 'main.py': strToU8('pass') }), /no plugin\.json/);
		refuses(zipSync({ 'plugin.json': strToU8('{"format":"wmkeyboard-icons"}') }), /"format": "wmkeyboard-plugin"/);
		refuses(zipSync({ 'plugin.json': strToU8(JSON.stringify(pluginManifest())) }), /no such file/);
		refuses(pluginZip(pluginManifest(), { 'main.py': '' }), /empty/);
		refuses(pluginZip(pluginManifest(), { 'my helpers.py': 'x' }), /file named/);
		refuses(pluginZip(pluginManifest(), { 'a/../b.py': 'x' }), /file named/);
		refuses(pluginZip(pluginManifest(), { '2fast.py': 'x' }), /not a module name/);
		refuses(pluginZip(pluginManifest(), { 'assets/Logo.PNG': 'x' }), /an asset is one lowercase file/);
		refuses(pluginZip(pluginManifest(), { 'assets/big.png': new Uint8Array(512 * 1024 + 1) }), /over 512 KB/);
		refuses(pluginZip(pluginManifest(), { 'helpers.py': new Uint8Array([0xff, 0xfe]) }), /not UTF-8/);
		refuses(pluginZip(pluginManifest(), { 'helpers.py': 'x'.repeat(256 * 1024 + 1) }), /over 256 KB/);
		refuses(pluginZip(pluginManifest(), { 'locales/english.json': '{}' }), /not a translation/);
		refuses(pluginZip(pluginManifest(), { 'locales/de.json': '[1]' }), /not a translation/);
		const many: Record<string, string> = {};
		for (let i = 0; i < 64; i++) many[`m${i}.py`] = '';
		refuses(pluginZip(pluginManifest(), many), /more than 64 files/);
	});
});

describe('what a plugin asks for', () => {
	it('groups permissions by tier and flags reading beside sending', () => {
		const f = pluginFacts(
			pluginManifest({
				permissions: ['network', 'storage', 'field.read', 'teleport', 'storage'],
				hosts: ['API.example.com', '*.example.org'],
				settings: [{ key: 'server', type: 'host', label: 'Your server' }, { key: 'token', type: 'secret', label: 'Token' }],
				actions: [{ id: 'upper', name: 'Upper case' }],
				tool: { keyword: 'echo', chip: true, tile: true },
				providers: [{ tool: 'translate', name: 'Echo translate' }],
				previews: [{ id: 'md', extensions: ['.MD', 'markdown'], names: ['README'] }],
				syntax: [{ extensions: ['md', 'mdx'] }],
			}),
		);
		assert.deepEqual(f.listed.map((p) => p.wire), ['storage']);
		assert.deepEqual(f.risky.map((p) => p.wire), ['network', 'field.read']);
		assert.deepEqual(f.unknown, ['teleport']);
		assert.equal(f.combinationRisk, true);
		assert.deepEqual(f.hosts, ['api.example.com', '*.example.org']);
		assert.deepEqual(f.hostSettings, ['server']);
		assert.deepEqual(f.fileTypes, ['md', 'markdown', 'mdx']);
		assert.deepEqual(f.fileNames, ['README']);
		assert.deepEqual(f.providers, [{ tool: 'translate', id: 'translate', name: 'Echo translate' }]);
		const text = renderAsks(f);
		assert.match(text, /\*\*Applies on install\*\* \(listed\):\n- `storage`/);
		assert.match(text, /\*\*Off until the user grants it\*\* \(risky\):\n- ⚠️ `network`.*\n- ⚠️ `field\.read`/);
		assert.match(text, /\[!WARNING\]/);
		assert.match(text, /`teleport`/);
		assert.match(text, /`api\.example\.com`, `\*\.example\.org`, plus the server the user types in `server`/);
		assert.match(text, /`@echo`, with a chip/);
		assert.match(text, /`upper` Upper case \(replaces the selection\)/);
	});

	it('says so when it asks for nothing', () => {
		assert.match(renderAsks(pluginFacts(pluginManifest({ permissions: [] }))), /No permissions/);
		assert.equal(pluginFacts(pluginManifest({ permissions: ['storage', 'network'] })).combinationRisk, false);
	});

	it('compares versions by number', () => {
		assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
		assert.ok(compareVersions('2.0.0', '2.0.0') === 0);
		assert.ok(compareVersions('0.9.0', '1.0.0') < 0);
	});
});

/** Applies a unified diff to [before], for checking the diff says what changed. */
function patch(before: string, diff: string): string {
	const src = before ? before.replace(/\n$/, '').split('\n') : [];
	const out: string[] = [];
	let at = 0;
	const lines = diff.split('\n');
	for (let i = 2; i < lines.length; i++) {
		const h = /^@@ -(\d+),(\d+) \+\d+,\d+ @@$/.exec(lines[i]!);
		if (!h) continue;
		const start = Number(h[2]) === 0 ? Number(h[1]) : Number(h[1]) - 1;
		while (at < start) out.push(src[at++]!);
		for (i++; i < lines.length && /^[ +-]/.test(lines[i]!) && !lines[i]!.startsWith('@@'); i++) {
			const l = lines[i]!;
			if (l[0] === ' ') {
				assert.equal(src[at], l.slice(1));
				out.push(src[at++]!);
			} else if (l[0] === '-') {
				assert.equal(src[at], l.slice(1));
				at++;
			} else out.push(l.slice(1));
		}
		i--;
	}
	while (at < src.length) out.push(src[at++]!);
	return out.length ? out.join('\n') + '\n' : '';
}

describe('unifiedDiff', () => {
	it('writes diff -u hunks with three lines of context', () => {
		const a = 'a\nb\nc\nd\ne\nf\ng\nh\n';
		const b = 'a\nb\nc\nD\ne\nf\ng\nh\n';
		assert.equal(unifiedDiff('x.py', a, b), '--- a/x.py\n+++ b/x.py\n@@ -1,7 +1,7 @@\n a\n b\n c\n-d\n+D\n e\n f\n g\n');
		assert.equal(unifiedDiff('x.py', a, a), '');
		assert.equal(unifiedDiff('new.py', null, 'one\n'), '--- /dev/null\n+++ b/new.py\n@@ -0,0 +1,1 @@\n+one\n');
		assert.equal(unifiedDiff('old.py', 'one\n', null), '--- a/old.py\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-one\n');
	});

	it('keeps far-apart changes in separate hunks', () => {
		const a = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') + '\n';
		const b = a.replace('line 2\n', 'line two\n').replace('line 25\n', 'line twenty-five\n');
		const d = unifiedDiff('x.py', a, b);
		assert.equal((d.match(/^@@/gm) ?? []).length, 2);
		assert.equal(patch(a, d), b);
	});

	it('says what changed, for any edit', () => {
		let seed = 7;
		const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
		for (let round = 0; round < 200; round++) {
			const a = Array.from({ length: rand(40) }, () => `l${rand(6)}`);
			const b = a.filter(() => rand(4) !== 0).flatMap((l) => (rand(5) === 0 ? [l, `n${rand(6)}`] : [l]));
			const before = a.length ? a.join('\n') + '\n' : '';
			const after = b.length ? b.join('\n') + '\n' : '';
			assert.equal(patch(before, unifiedDiff('f', before, after)), after, `round ${round}`);
		}
	});
});

describe('a plugin submission', () => {
	const PLUGIN = pluginZip();
	const submit = (payload: Uint8Array | string, over: Parameters<typeof body>[0] = {}, opts: Parameters<typeof evaluate>[1] = {}) =>
		evaluate(body({ name: 'Echo', license: 'MIT', payload: typeof payload === 'string' ? payload : encodePayload(payload), ...over }, 'Plugin'), { type: 'plugin', ...opts });

	it('passes, keeps the bytes and publishes under its own version', async () => {
		const r = await submit(pluginZip(pluginManifest({ pluginVersion: '2.3.0' })));
		assert.deepEqual(failing(r), []);
		assert.equal(r.type, 'plugin');
		assert.equal(r.id, 'echo');
		assert.equal(r.version, '2.3.0');
		assert.equal(detail(r, 'Plugin id'), '`com.example.echo`');
		assert.equal(metaFor(r, [], 'now').version, '2.3.0');
	});

	it('reads the payload byte for byte', async () => {
		const r = await submit(PLUGIN);
		assert.ok(Buffer.from(r.payload!).equals(Buffer.from(PLUGIN)));
	});

	it('takes the .wmplugin renamed .zip, or zipped', async () => {
		for (const zip of [PLUGIN, zipSync({ 'Echo-1.0.0.wmplugin': PLUGIN })]) {
			const fetchImpl = (async () => new Response(new Uint8Array(zip))) as unknown as typeof fetch;
			const r = await submit('[echo.zip](https://github.com/user-attachments/files/9/echo.zip)', {}, { fetchImpl });
			assert.deepEqual(failing(r), []);
			assert.ok(Buffer.from(r.payload!).equals(Buffer.from(PLUGIN)));
		}
	});

	it('takes code licences only', async () => {
		const r = await submit(PLUGIN, { license: 'CC-BY-4.0' });
		assert.deepEqual(failing(r), ['License']);
		assert.match(detail(r, 'License'), /MIT, Apache-2\.0/);
	});

	it('refuses plugin.json alone, and a plugin on another form', async () => {
		const r = await submit(JSON.stringify(pluginManifest()));
		assert.match(detail(r, 'Payload'), /only the plugin\.json/);
		const theme = await evaluate(body({ name: 'Echo', payload: encodePayload(PLUGIN) }), { type: 'theme' });
		assert.ok(failing(theme).includes('Form type'));
	});

	it('needs a three-number version and a plugin id', async () => {
		const r = await submit(pluginZip(pluginManifest({ pluginVersion: '1.0' })));
		assert.deepEqual(failing(r), ['Plugin version']);
		const id = await submit(pluginZip(pluginManifest({ id: 'X' })));
		assert.deepEqual(failing(id), ['Plugin id']);
	});

	it('refuses a plugin id someone else published', async () => {
		const root = tree([{ meta: meta({ id: 'other-echo', type: 'plugin', submitter: BOB }), payload: PLUGIN }]);
		const r = await submit(PLUGIN, {}, { root });
		assert.deepEqual(failing(r), ['Plugin id']);
		assert.match(detail(r, 'Plugin id'), /overwrite each other/);
		const mine = await submit(PLUGIN, {}, { root, user: BOB });
		assert.match(detail(mine, 'Plugin id'), /put `other-echo` in "Updates"/);
	});

	it('takes an update from its owner with the same plugin id and a higher version', async () => {
		const root = tree([{ meta: meta({ id: 'echo', type: 'plugin', version: '1.0.0' }), payload: PLUGIN }]);
		const r = await submit(pluginZip(pluginManifest({ pluginVersion: '1.1.0' })), { updates: 'echo' }, { root });
		assert.deepEqual(failing(r), []);
		assert.equal(r.isUpdate, true);
		assert.equal(r.version, '1.1.0');
		const same = await submit(PLUGIN, { updates: 'echo' }, { root });
		assert.deepEqual(failing(same), ['Plugin version']);
		const moved = await submit(pluginZip(pluginManifest({ id: 'com.example.echo2', pluginVersion: '1.1.0' })), { updates: 'echo' }, { root });
		assert.deepEqual(failing(moved), ['Plugin id']);
		const stranger = await submit(pluginZip(pluginManifest({ pluginVersion: '1.1.0' })), { updates: 'echo' }, { root, user: BOB });
		assert.ok(failing(stranger).includes('Addon id'));
	});

	it('notes a form name that differs from plugin.json', async () => {
		const r = await submit(PLUGIN, { name: 'Echo Echo' });
		assert.match(r.warnings.join(), /plugin\.json "Echo"/);
	});
});

describe('publishing a plugin', () => {
	const PLUGIN = pluginZip(pluginManifest({ previews: [{ id: 'md', extensions: ['md'] }], permissions: ['previews'] }));

	it('writes the entry the app installs a plugin from', () => {
		const root = tree([{ meta: meta({ id: 'echo', type: 'plugin', version: '1.2.0', previews: [] }), payload: PLUGIN }]);
		const manifest = buildManifest(root, readPublished(root));
		const entry = manifest.addons[0]!;
		assert.deepEqual(Object.keys(entry), ['id', 'type', 'name', 'version', 'author', 'description', 'tags', 'path', 'sha256', 'sizeBytes', 'previews', 'license', 'fileTypes']);
		assert.equal(entry.type, 'plugin');
		assert.equal(entry.path, 'addons/plugins/echo/plugin.wmplugin');
		// AddonDownloadManager refuses a plugin without a checksum.
		assert.equal(entry.sha256, sha256(PLUGIN));
		assert.equal(entry.sizeBytes, PLUGIN.byteLength);
		assert.deepEqual(entry.fileTypes, ['md']);
		// AddonRepoCodec drops an entry whose id holds the variant separator.
		assert.ok(!entry.id.includes('@'));
	});

	it('stages a trial copy, the code and the diff', () => {
		const target = mkdtempSync(join(tmpdir(), 'pending-'));
		const before = pluginZip(pluginManifest(), { 'helpers.py': 'A = 1\n' });
		const after = pluginZip(pluginManifest({ pluginVersion: '1.1.0' }), { 'helpers.py': 'A = 2\n', 'assets/a.png': new Uint8Array([1, 2]) });
		writePluginSource(target, after, before);
		assert.equal(readFileSync(join(target, 'source', 'helpers.py'), 'utf8'), 'A = 2\n');
		assert.ok(existsSync(join(target, 'source', 'assets', 'a.png')));
		const diff = readFileSync(join(target, 'changes.diff'), 'utf8');
		assert.match(diff, /^-A = 1$/m);
		assert.match(diff, /^\+A = 2$/m);
		assert.match(diff, /Binary file assets\/a\.png added/);
		writePluginSource(target, before, null);
		assert.ok(!existsSync(join(target, 'source', 'assets')));
		assert.ok(!existsSync(join(target, 'changes.diff')));

		const s: Summary = { ok: true, checks: [], warnings: [], type: 'plugin', id: 'echo', isUpdate: false, name: 'Echo', description: 'd', tags: [], license: 'MIT', basedOn: null, submitter: ALICE, issue: 3, version: '1.1.0' };
		const pm = pendingManifest(metaFor(s, [], 'now'), after, 3);
		assert.equal(pm.addons[0]!.path, 'plugin.wmplugin');
		assert.equal(pm.addons[0]!.version, '1.1.0');
		assert.equal(pm.addons[0]!.sha256, sha256(after));
	});
});

const OK_REPORT: WmpyReport = { version: 'wmpy 0.1.0', check: { ok: true, errors: 0, warnings: 0, problems: [] }, test: { ok: true, passed: 4, failed: 0, problems: [] } };

describe('the sticky comment for a plugin', () => {
	const summary: Summary = { ok: true, checks: [{ title: 'Name', ok: true }], warnings: [], type: 'plugin', id: 'echo', isUpdate: false, name: 'Echo', description: 'd', tags: [], license: 'MIT', basedOn: null, submitter: ALICE, issue: 7, version: '1.0.0' };
	const sticky = (plugin: ReturnType<typeof buildReview>, over: Partial<Summary> = {}) =>
		renderSticky({ stage: 'quick', submission: { ...summary, ...over }, quick: quickReport(plugin.wmpy ?? OK_REPORT), fullDisabled: true, repo: 'o/r', runId: '5', plugin });

	it('shows the permissions, hosts, files, code and wmpy verdict', () => {
		const zip = pluginZip(pluginManifest({ permissions: ['network', 'clipboard.read'], hosts: ['api.example.com'] }), { 'helpers.py': 'X = "```"\n' });
		const c = sticky(buildReview(zip, null, OK_REPORT));
		assert.match(c, /✅ Ready for review/);
		assert.match(c, /✅ \*\*wmpy check\*\*: No problems\./);
		assert.match(c, /✅ \*\*wmpy test\*\*: 4 passed\./);
		assert.match(c, /### What it asks for/);
		assert.match(c, /⚠️ `network`/);
		assert.match(c, /⚠️ `clipboard\.read`/);
		assert.match(c, /\[!WARNING\]/);
		assert.match(c, /`api\.example\.com`/);
		assert.match(c, /\| `helpers\.py` \| module \|/);
		assert.match(c, /<details><summary><code>main\.py<\/code>, 6 lines<\/summary>/);
		// The code's own backticks cannot close the block around it.
		assert.match(c, /````python\nX = "```"\n````/);
		assert.match(c, /\[!CAUTION\]/);
		assert.match(c, /read every file above/);
		assert.equal(verdict({ submission: summary, quick: quickReport(OK_REPORT), fullDisabled: true }), 'ready');
	});

	it('fails on wmpy check errors and failed tests', () => {
		const bad: WmpyReport = {
			check: { ok: false, errors: 1, warnings: 0, problems: [{ severity: 'error', code: 'undefined-name', message: "name 'cunt' is not defined", file: 'main.py', line: 12, col: 9 }] },
			test: { ok: false, passed: 3, failed: 1, problems: [{ severity: 'error', message: 'ValueError: case 7 gave 8', file: 'test.py', line: 2 }] },
		};
		const c = sticky(buildReview(pluginZip(), null, bad));
		assert.match(c, /❌ Needs a fix/);
		assert.match(c, /❌ \*\*wmpy check\*\*: 1 error: main\.py:12:9: name 'cunt' is not defined \\\[undefined-name\\\]/);
		assert.match(c, /❌ \*\*wmpy test\*\*: 1 failed, 3 passed: test\.py:2: ValueError/);
		assert.equal(verdict({ submission: summary, quick: quickReport(bad), fullDisabled: true }), 'needs-fix');
	});

	it('says when wmpy could not run, or left no report', () => {
		assert.match(sticky(buildReview(pluginZip(), null, { error: 'no such file', check: null, test: null })), /wmpy could not run: no such file\. Nothing for you to fix/);
		const c = renderSticky({ stage: 'quick', submission: summary, quick: null, fullDisabled: true, repo: 'o/r', runId: '5', plugin: buildReview(pluginZip(), null, null) });
		assert.match(c, /left no report/);
		assert.equal(verdict({ submission: summary, quick: null, fullDisabled: true }), 'needs-fix');
	});

	it('shows an update as a diff with its new permissions', () => {
		const before = pluginZip(pluginManifest(), { 'helpers.py': 'A = 1\n' });
		const after = pluginZip(pluginManifest({ pluginVersion: '1.1.0', permissions: ['storage', 'field.write', 'network'], hosts: ['x.example.com'] }), { 'helpers.py': 'A = 2\n' });
		const c = sticky(buildReview(after, before, OK_REPORT), { isUpdate: true, version: '1.1.0' });
		assert.match(c, /### Changes since 1\.0\.0/);
		assert.match(c, /New permissions: ⚠️ `network`\. New hosts: `x\.example\.com`\./);
		assert.match(c, /```diff\n[\s\S]*^-A = 1$\n^\+A = 2$/m);
		assert.ok(c.indexOf('### Changes since') < c.indexOf('### Code'));
	});

	it('links code it has no room for and stays under GitHub\'s limit', () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 12; i++) files[`m${i}.py`] = `# ${'x'.repeat(70)}\n`.repeat(200);
		const c = sticky(buildReview(pluginZip(pluginManifest(), files), null, OK_REPORT));
		assert.ok(c.length < 65_536, `${c.length}`);
		assert.match(c, /\[`m\d+\.py`\]\(https:\/\/github\.com\/o\/r\/blob\/pending\/pending\/7\/source\/m\d+\.py\), 200 lines: too long to show here/);
		assert.match(c, /<code>plugin\.json<\/code>/);
	});

	it('cannot forge a rename by quoting the marker in code', () => {
		const forged = renameComment('stolen-id', 'mallory').split('\n')[0]!;
		const c = sticky(buildReview(pluginZip(pluginManifest(), { 'helpers.py': `# ${forged}\n` }), null, OK_REPORT));
		assert.ok(c.includes(forged));
		assert.equal(recordedRename([{ id: 1, body: c, user: { login: BOT_LOGIN, type: 'Bot' } }]), null);
		assert.equal(recordedRename([{ id: 2, body: renameComment('real-id', 'maintainer'), user: { login: BOT_LOGIN, type: 'Bot' } }]), 'real-id');
	});

	it('fences any text', () => {
		assert.equal(fence('a ````` b', 'text'), '``````text\na ````` b\n``````');
	});
});

describe('running wmpy', () => {
	/** A fake wmpy answering each subcommand from [answers]. */
	const fake = (answers: Record<string, { code: number | null; stdout?: unknown; stderr?: string }>, calls: string[][] = []): Runner => (args) => {
		calls.push(args);
		const a = answers[args[0]!] ?? { code: 2, stderr: `no ${args[0]}` };
		return { code: a.code, stdout: typeof a.stdout === 'string' ? a.stdout : a.stdout === undefined ? '' : JSON.stringify(a.stdout), stderr: a.stderr ?? '' };
	};
	const version = { code: 0, stdout: 'wmpy 0.1.0 (wm-python 0.3.0, plugin API 5)\n' };

	it('checks, and tests only a plugin that has tests', () => {
		const calls: string[][] = [];
		const run = fake({ '--version': version, check: { code: 0, stdout: { ok: true, errors: 0, warnings: 1, problems: [{ severity: 'warning', message: 'unused import', file: 'main.py', line: 1 }] } } }, calls);
		const r = checkWithWmpy('/p', false, run);
		assert.deepEqual(calls, [['--version'], ['check', '--json', '/p']]);
		assert.equal(r.version, 'wmpy 0.1.0 (wm-python 0.3.0, plugin API 5)');
		assert.equal(r.check!.ok, true);
		assert.equal(r.test, null);
		assert.deepEqual(quickReport(r), { ok: true, problems: [], notes: [], images: [] });
	});

	it('reports failing tests', () => {
		const run = fake({
			'--version': version,
			check: { code: 0, stdout: { ok: true, errors: 0, warnings: 0, problems: [] } },
			test: { code: 1, stdout: { ok: false, passed: 2, failed: 1, problems: [{ severity: 'error', message: 'boom' }] } },
		});
		const r = checkWithWmpy('/p', true, run);
		assert.deepEqual(r.test, { ok: false, passed: 2, failed: 1, problems: [{ severity: 'error', message: 'boom' }] });
		assert.equal(quickReport(r).ok, false);
	});

	it('reads the failures out of wmpy test --json', () => {
		const tests = [
			{ file: 'test.py', name: 'test_upper', ok: false, durationMs: 1, output: '', error: { severity: 'error', code: 'AssertionError', message: "'A' != 'a'", file: 'test.py', line: 7, col: null } },
			{ file: 'tests/test_more.py', name: '<module>', ok: false, error: null },
			{ file: 'test.py', name: 'test_lower', ok: true, error: null },
		];
		const r = checkWithWmpy('/p', true, fake({ '--version': version, check: { code: 0, stdout: { ok: true, errors: 0, warnings: 0, problems: [] } }, test: { code: 1, stdout: { ok: false, passed: 1, failed: 2, durationMs: 3, tests } } }));
		assert.deepEqual(r.test!.problems, [
			{ severity: 'error', code: 'AssertionError', message: "test.py::test_upper: 'A' != 'a'", file: 'test.py', line: 7 },
			{ severity: 'error', message: 'tests/test_more.py failed' },
		]);
	});

	it('treats a run that never answered as wmpy failing, not the plugin', () => {
		assert.match(checkWithWmpy('/p', true, fake({ '--version': { code: null, stderr: 'spawn wmpy ENOENT' } })).error!, /ENOENT/);
		const r = checkWithWmpy('/p', true, fake({ '--version': version, check: { code: 2, stderr: 'wmpy check: not built yet' } }));
		assert.match(r.error!, /not built yet/);
		assert.equal(quickReport(r).ok, false);
		const timeout = checkWithWmpy('/p', true, fake({ '--version': version, check: { code: 0, stdout: { ok: true, errors: 0, warnings: 0, problems: [] } }, test: { code: null } }));
		assert.match(timeout.test!.problems[0]!.message, /stopped/);
	});

	it('unpacks the plugin with its tests and fixtures, and nothing outside the folder', () => {
		const dir = mkdtempSync(join(tmpdir(), 'unpack-'));
		const archive = readPluginArchive(pluginZip(pluginManifest(), { 'test.py': 'pass\n', 'cases.txt': 'a\nb\n', 'tests/test_more.py': 'pass\n' }));
		assert.equal(hasTests(archive), true);
		unpackPlugin(archive, dir);
		assert.equal(readFileSync(join(dir, 'cases.txt'), 'utf8'), 'a\nb\n');
		assert.ok(existsSync(join(dir, 'tests', 'test_more.py')));
		const forged = { ...archive, files: [{ ...archive.files[0]!, name: '../escape.txt' }] };
		assert.throws(() => unpackPlugin(forged, dir), /outside the plugin folder/);
		assert.equal(hasTests(readPluginArchive(pluginZip())), false);
		assert.equal(hasTests(readPluginArchive(pluginZip(pluginManifest(), { 'tests/helpers.py': 'pass\n' }))), false);
		assert.equal(hasTests(readPluginArchive(pluginZip(pluginManifest(), { 'tests/test_x.py': 'pass\n' }))), true);
	});
});

describe('the pending entry', () => {
	it('is a plugin entry with a checksum', () => {
		const zip = pluginZip();
		const m = metaFor({ ok: true, checks: [], warnings: [], type: 'plugin', id: 'echo', isUpdate: false, name: 'Echo', description: 'd', tags: [], license: 'MIT', basedOn: null, submitter: ALICE, issue: 1, version: '1.0.0' }, [], 'now');
		const e = entryFor(m, '', zip);
		assert.equal(e.type, 'plugin');
		assert.match(e.sha256, /^[0-9a-f]{64}$/);
		assert.equal(e.fileTypes, undefined);
	});
});

describe('an issue wmpy publish filed', () => {
	// The body `wmpy publish --dry-run --tags text` printed for a small API 5
	// plugin, packed by the real `wmpy pack`. Keeps wmpy's form and this bot's
	// reading of it from drifting apart.
	const filed = fixture('plugin-wmpy.md');

	it('is adopted as a plugin submission and passes', async () => {
		assert.equal(adoptedType(filed, parseIssueForm(filed, LABELS)), 'plugin');
		const r = await evaluate(filed, { type: 'plugin' });
		assert.deepEqual(failing(r), []);
		assert.equal(r.id, 'echo');
		assert.equal(r.version, '1.0.0');
		assert.equal(r.license, 'MIT');
		assert.deepEqual(r.tags, ['text']);
		const archive = readPluginArchive(r.payload!);
		assert.equal(archive.manifest.id, 'com.example.echo');
		// wmpy pack leaves the tests out of what is published.
		assert.deepEqual(archive.files.map((f) => f.name), ['plugin.json', 'main.py']);
		assert.equal(hasTests(archive), false);
	});
});
