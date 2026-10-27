import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { parse as parseYaml } from 'yaml';
import { LICENSES } from '../src/constants.ts';
import { FIELD_IDS, isTicked, parseIssueForm, splitTags, TEMPLATE_FILES, templateFields } from '../src/form.ts';
import { fixture, LABELS, TEMPLATES } from './helpers.ts';

describe('issue form templates', () => {
	for (const file of TEMPLATE_FILES) {
		const text = readFileSync(join(TEMPLATES, file), 'utf8');
		const fields = templateFields(text);
		const byId = Object.fromEntries(fields.map((f) => [f.id, f]));

		it(`${file} has exactly the field ids the app pre-fills`, () => {
			assert.deepEqual(fields.map((f) => f.id).sort(), [...FIELD_IDS].sort());
		});

		it(`${file} uses the agreed field types`, () => {
			assert.equal(byId.payload!.type, 'textarea');
			assert.equal(byId.license!.type, 'dropdown');
			assert.equal(byId.rights!.type, 'checkboxes');
			for (const id of ['name', 'tags', 'updates', 'based_on']) assert.equal(byId[id]!.type, 'input', id);
		});

		it(`${file} offers the three licences and adds the submission label`, () => {
			const doc = parseYaml(text) as { labels: string[]; body: { id?: string; attributes: { options?: unknown[] } }[] };
			const license = doc.body.find((b) => b.id === 'license')!;
			assert.deepEqual(license.attributes.options, [...LICENSES]);
			assert.ok(doc.labels.includes('submission'));
		});
	}

	it('blank issues are off', () => {
		const config = parseYaml(readFileSync(join(TEMPLATES, 'config.yml'), 'utf8')) as { blank_issues_enabled: boolean };
		assert.equal(config.blank_issues_enabled, false);
	});
});

describe('parseIssueForm', () => {
	it('reads a rendered form back into field ids', () => {
		const { fields, problems } = parseIssueForm(fixture('theme-encoded.md'), LABELS);
		assert.deepEqual(problems, []);
		assert.equal(fields.name, 'Midnight Typewriter');
		assert.equal(fields.license, 'CC0-1.0');
		assert.equal(fields.updates, '');
		assert.equal(fields.based_on, '');
		assert.ok(fields.payload!.startsWith('wmkb:1:'));
		assert.ok(isTicked(fields.rights));
	});

	it('maps both templates\' payload labels to payload', () => {
		assert.equal(LABELS.get('Theme'), 'payload');
		assert.equal(LABELS.get('Layout'), 'payload');
	});

	it('refuses a heading typed twice', () => {
		const body = fixture('theme-encoded.md').replace('### Tags', '### License\n\nCC0-1.0\n\n### Tags');
		assert.match(parseIssueForm(body, LABELS).problems.join(), /more than once/);
	});

	it('refuses a body that is not a form', () => {
		assert.match(parseIssueForm('hello, please add my theme', LABELS).problems.join(), /not opened from the submission form/);
	});

	it('keeps unknown ### headings inside the answer they sit in', () => {
		const body = fixture('theme-encoded.md').replace('Cream keys', '### Inspiration\n\nCream keys');
		const { fields, problems } = parseIssueForm(body, LABELS);
		assert.deepEqual(problems, []);
		assert.match(fields.description!, /### Inspiration/);
	});

	it('handles Windows line endings', () => {
		assert.equal(parseIssueForm(fixture('theme-encoded.md').replace(/\n/g, '\r\n'), LABELS).fields.name, 'Midnight Typewriter');
	});
});

describe('field helpers', () => {
	it('reads a ticked or unticked box', () => {
		assert.equal(isTicked('- [x] I made this'), true);
		assert.equal(isTicked('- [ ] I made this'), false);
		assert.equal(isTicked(''), false);
	});
	it('splits, trims, lowercases and dedupes tags', () => {
		assert.deepEqual(splitTags('Dark, #retro,dark,\nMono '), ['dark', 'retro', 'mono']);
		assert.deepEqual(splitTags(''), []);
	});
});
