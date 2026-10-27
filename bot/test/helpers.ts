import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TYPES, type AddonType } from '../src/constants.ts';
import { labelMap, parseIssueForm } from '../src/form.ts';
import { readPublished, type Meta } from '../src/repo.ts';
import { evaluateSubmission, type SubmissionInput } from '../src/submission.ts';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..');
export const TEMPLATES = join(ROOT, '.github', 'ISSUE_TEMPLATE');
export const LABELS = labelMap(TEMPLATES);

export function fixture(name: string): string {
	return readFileSync(join(HERE, 'fixtures', name), 'utf8');
}

export interface Vector {
	name: string;
	json: string;
	encoded: string;
}

export function vectors(): Vector[] {
	return (JSON.parse(readFileSync(join(HERE, 'community-submission-vectors.json'), 'utf8')) as { vectors: Vector[] }).vectors;
}

export const ALICE = { login: 'alice', id: 1001 };
export const BOB = { login: 'bob', id: 2002 };

export function meta(over: Partial<Meta> & Pick<Meta, 'id' | 'type'>): Meta {
	return {
		name: over.id,
		description: 'A test addon.',
		tags: [],
		license: 'CC0-1.0',
		basedOn: null,
		version: '1.0.0',
		submitter: ALICE,
		issues: [1],
		createdAt: '2026-10-01T00:00:00.000Z',
		updatedAt: '2026-10-01T00:00:00.000Z',
		previews: ['preview.png'],
		...over,
	};
}

/** A throwaway repo root holding [addons], each with its payload and a 1x1 preview. */
export function tree(addons: { meta: Meta; payload: string }[]): string {
	const root = mkdtempSync(join(tmpdir(), 'wmkb-community-'));
	for (const { meta: m, payload } of addons) {
		const dir = join(root, 'addons', TYPES[m.type].dir, m.id);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, TYPES[m.type].file), payload);
		writeFileSync(join(dir, 'meta.json'), JSON.stringify(m, null, 2) + '\n');
		writeFileSync(join(dir, 'preview.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
	}
	return root;
}

/** Runs the whole form-level pass on an issue body, as parse.ts does. */
export async function evaluate(
	body: string,
	opts: { root?: string; user?: { login: string; id: number }; type?: AddonType; rename?: string; fetchImpl?: typeof fetch; blocklist?: string[] } = {},
) {
	const form = parseIssueForm(body, LABELS);
	const root = opts.root ?? tree([]);
	const input: SubmissionInput = {
		fields: form.fields,
		formProblems: form.problems,
		issue: { number: 42, user: opts.user ?? ALICE, labels: ['submission', `type:${opts.type ?? 'theme'}`] },
		rename: opts.rename ?? null,
		published: readPublished(root),
		blocklist: opts.blocklist ?? ['casino', 'official'],
		root,
		fetchImpl: opts.fetchImpl,
	};
	return evaluateSubmission(input);
}

/** An issue body in the shape GitHub renders a submitted form. */
export function body(fields: Partial<Record<'name' | 'description' | 'tags' | 'license' | 'updates' | 'based_on' | 'payload' | 'rights', string>>, payloadLabel = 'Theme'): string {
	const v = (s: string | undefined, fallback = '_No response_') => (s === undefined ? fallback : s || '_No response_');
	return [
		['Name', v(fields.name, 'Test')],
		['Description', v(fields.description, 'A test.')],
		['Tags', v(fields.tags)],
		['License', v(fields.license, 'CC0-1.0')],
		['Updates', v(fields.updates)],
		['Based on', v(fields.based_on)],
		[payloadLabel, v(fields.payload)],
		['Rights', v(fields.rights, '- [X] I made this, or I have the right to share every image and name in it.')],
	]
		.map(([h, x]) => `### ${h}\n\n${x}`)
		.join('\n\n');
}
