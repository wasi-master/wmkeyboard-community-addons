import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { recordedRename, renameComment, renderSticky, tryLinks, verdict, type StickyInput } from '../src/comment.ts';
import { parseCommand } from '../src/commands.ts';
import { STICKY_MARKER } from '../src/constants.ts';
import { BOT_LOGIN, findSticky, GitHub } from '../src/github.ts';
import { nearDuplicates } from '../src/palette.ts';
import type { Summary } from '../src/pending.ts';
import { ALICE } from './helpers.ts';

const submission: Summary = {
	ok: true,
	checks: [{ title: 'Name', ok: true }],
	warnings: [],
	type: 'theme',
	id: 'neon',
	isUpdate: false,
	name: 'Neon',
	description: 'Bright.',
	tags: [],
	license: 'CC0-1.0',
	basedOn: null,
	submitter: ALICE,
	issue: 7,
};

const sticky = (over: Partial<StickyInput>) => renderSticky({ stage: 'quick', submission, repo: 'o/r', runId: '5', ...over });

describe('verdict', () => {
	const quickOk = { ok: true, problems: [], images: ['preview.png'] };
	const quickBad = { ok: false, problems: ['bad'], images: [] };
	const fullOk = { ok: true, warnings: [], images: ['preview.png'] };
	const fullBad = { ok: false, refusal: 'unknown keyShape', warnings: [], images: [] };

	it('waits for the JVM pass', () => assert.equal(verdict({ submission, quick: quickOk }), 'rendering'));
	it('lets the JVM verdict win both ways', () => {
		assert.equal(verdict({ submission, quick: quickOk, full: fullBad }), 'needs-fix');
		assert.equal(verdict({ submission, quick: quickBad, full: fullOk }), 'ready');
	});
	it('falls back to the quick verdict when the JVM pass is off', () => {
		assert.equal(verdict({ submission, quick: quickOk, fullDisabled: true }), 'ready');
		assert.equal(verdict({ submission, quick: quickBad, fullDisabled: true }), 'needs-fix');
	});
	it('never calls a failed form ready', () => assert.equal(verdict({ submission: { ...submission, ok: false }, quick: quickOk, full: fullOk }), 'needs-fix'));
});

describe('sticky comment', () => {
	it('carries the marker, the preview and both try links', () => {
		const c = sticky({ quick: { ok: true, problems: [], images: ['preview.png'] } });
		assert.ok(c.startsWith(STICKY_MARKER));
		assert.match(c, /Quick preview/);
		assert.match(c, /raw\.githubusercontent\.com\/o\/r\/pending\/pending\/7\/preview\.png\?v=5/);
		const links = tryLinks('https://raw.githubusercontent.com/o/r/pending/pending/7/wmkeyboard-repo.json', 'neon');
		assert.ok(c.includes(links.web));
		assert.ok(c.includes(links.app));
		assert.match(links.app, /^wmkeyboard:\/\/addon\?repo=https%3A%2F%2F.*&id=neon$/);
	});

	it('says the JVM refused it and why', () => {
		const c = sticky({ stage: 'final', quick: { ok: true, problems: [], images: [] }, full: { ok: false, refusal: 'keyShape "BLOB" is unknown', warnings: [], images: [] } });
		assert.match(c, /Needs a fix/);
		assert.match(c, /The app refuses it: keyShape "BLOB" is unknown/);
	});

	it('does not blame the submitter for a render that never finished', () => {
		const c = sticky({ stage: 'final', quick: { ok: true, problems: [], images: [] }, full: null });
		assert.match(c, /Nothing for you to fix/);
		assert.doesNotMatch(c, /Edit the issue to fix it/);
	});

	it('is found again only when the bot wrote it', () => {
		const forged = { id: 1, body: `${STICKY_MARKER} hi`, user: { login: 'mallory', type: 'User' } };
		const real = { id: 2, body: `${STICKY_MARKER} hi`, user: { login: BOT_LOGIN, type: 'Bot' } };
		assert.equal(findSticky([forged]), undefined);
		assert.equal(findSticky([forged, real])?.id, 2);
	});

	it('is edited in place rather than posted twice', async () => {
		const calls: string[] = [];
		const fetchImpl = (async (url: string, init?: RequestInit) => {
			calls.push(`${init?.method} ${url.replace('https://api.github.com', '')}`);
			if (init?.method === 'GET') return Response.json([{ id: 77, body: `${STICKY_MARKER}\nold`, user: { login: BOT_LOGIN, type: 'Bot' } }]);
			return Response.json({});
		}) as typeof fetch;
		await new GitHub('t', 'o/r', fetchImpl).upsertSticky(7, 'new');
		assert.deepEqual(calls, ['GET /repos/o/r/issues/7/comments?per_page=100&page=1', 'PATCH /repos/o/r/issues/comments/77']);
	});
});

describe('rename record', () => {
	it('reads only the bot\'s own rename notes, latest wins', () => {
		const comments = [
			{ id: 1, body: renameComment('first-id', 'maint'), user: { login: BOT_LOGIN, type: 'Bot' } },
			{ id: 2, body: renameComment('second-id', 'maint'), user: { login: BOT_LOGIN, type: 'Bot' } },
			{ id: 3, body: renameComment('stolen-id', 'mallory'), user: { login: 'mallory', type: 'User' } },
		];
		assert.equal(recordedRename(comments), 'second-id');
		assert.equal(recordedRename([]), null);
	});
});

describe('commands', () => {
	it('reads approve, reject with a reason, and rename', () => {
		assert.deepEqual(parseCommand('/approve'), { kind: 'approve' });
		assert.deepEqual(parseCommand('  /approve thanks!'), { kind: 'approve' });
		assert.deepEqual(parseCommand('/reject Uses a logo it may not.\nSorry!'), { kind: 'reject', reason: 'Uses a logo it may not.\nSorry!' });
		assert.deepEqual(parseCommand('/rename neon-nights'), { kind: 'rename', id: 'neon-nights' });
	});
	it('refuses a rename to anything but an id', () => {
		assert.equal(parseCommand('/rename ../../etc')?.kind, 'invalid');
		assert.equal(parseCommand('/rename $(id)')?.kind, 'invalid');
		assert.equal(parseCommand('/rename')?.kind, 'invalid');
	});
	it('ignores ordinary comments and look-alikes', () => {
		assert.equal(parseCommand('Looks great, please /approve'), null);
		assert.equal(parseCommand('/approved'), null);
	});
});

describe('palette', () => {
	const base = { boardBackground: 0xff101010, keyBackground: 0xff202020, keyText: 0xffffffff, modifierKeyBackground: 0xff303030, enterKeyBackground: 0xff00aaff, accent: 0xff00aaff };
	it('flags a near-identical palette and ignores a different one', () => {
		const tweak = { ...base, keyBackground: 0xff222222 };
		const other = { ...base, boardBackground: 0xfff0f0f0, keyBackground: 0xffffffff, keyText: 0xff000000, enterKeyBackground: 0xffff0000 };
		assert.deepEqual(nearDuplicates(tweak, [{ id: 'a', theme: base }, { id: 'b', theme: other }]).map((d) => d.id), ['a']);
	});
	it('needs four shared slots before it says anything', () => {
		assert.deepEqual(nearDuplicates({ keyText: 0xffffffff }, [{ id: 'a', theme: base }]), []);
	});
});
