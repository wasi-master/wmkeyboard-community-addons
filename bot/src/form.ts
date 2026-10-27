/**
 * Reads a submitted issue form back into field ids.
 *
 * GitHub renders an issue form as Markdown: one `### <label>` heading per
 * field, then the answer, with `_No response_` for an empty optional field and
 * `- [X] <option>` for a ticked checkbox. The labels come from the templates in
 * .github/ISSUE_TEMPLATE, so the label-to-id map is read from those files and
 * the ids stay the only thing the app and the bot share.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/** The ids the app pre-fills. A contract: the app writes them into URLs. */
export const FIELD_IDS = ['name', 'description', 'tags', 'license', 'updates', 'based_on', 'payload', 'rights'] as const;
export type FieldId = (typeof FIELD_IDS)[number];

export const TEMPLATE_FILES = ['submit-theme.yml', 'submit-layout.yml'];

export interface TemplateField {
	id: string;
	type: string;
	label: string;
}

/** The labelled fields of one issue-form template, in form order. */
export function templateFields(yamlText: string): TemplateField[] {
	const doc = parseYaml(yamlText) as { body?: { type: string; id?: string; attributes?: { label?: string } }[] };
	return (doc.body ?? [])
		.filter((item) => item.type !== 'markdown' && item.id && item.attributes?.label)
		.map((item) => ({ id: item.id!, type: item.type, label: item.attributes!.label!.trim() }));
}

/**
 * Label to id across every template. Two templates may label one id
 * differently ("Theme", "Layout"), but one label must never mean two ids.
 */
export function labelMap(templateDir: string): Map<string, FieldId> {
	const map = new Map<string, FieldId>();
	for (const file of TEMPLATE_FILES) {
		for (const field of templateFields(readFileSync(join(templateDir, file), 'utf8'))) {
			if (!(FIELD_IDS as readonly string[]).includes(field.id)) {
				throw new Error(`${file}: field id "${field.id}" is not one the app knows`);
			}
			const known = map.get(field.label);
			if (known && known !== field.id) {
				throw new Error(`label "${field.label}" means both ${known} and ${field.id}`);
			}
			map.set(field.label, field.id as FieldId);
		}
	}
	return map;
}

export interface ParsedForm {
	/** Raw answer per field id, trimmed; empty string for `_No response_`. */
	fields: Partial<Record<FieldId, string>>;
	/** Reasons the body cannot be read as one of our forms. */
	problems: string[];
}

const NO_RESPONSE = '_No response_';

/**
 * Splits [body] on the `### ` headings that are labels of a known field.
 *
 * A heading that repeats is refused outright rather than resolved: the
 * submitter typed it into a text box, and there is no reading of the body that
 * is more right than asking them to remove it.
 */
export function parseIssueForm(body: string, labels: Map<string, FieldId>): ParsedForm {
	const lines = body.replace(/\r\n?/g, '\n').split('\n');
	const fields: Partial<Record<FieldId, string>> = {};
	const problems: string[] = [];
	const seen = new Set<FieldId>();
	let current: FieldId | null = null;
	let buffer: string[] = [];
	const flush = () => {
		if (current) {
			const text = buffer.join('\n').trim();
			fields[current] = text === NO_RESPONSE ? '' : text;
		}
		buffer = [];
	};
	for (const line of lines) {
		const heading = /^###\s+(.+?)\s*$/.exec(line);
		const id = heading ? labels.get(heading[1]!) : undefined;
		if (id) {
			flush();
			if (seen.has(id)) {
				problems.push(`The heading "### ${heading![1]}" appears more than once. Remove the copy you typed into another box.`);
			}
			seen.add(id);
			current = id;
			continue;
		}
		if (current) buffer.push(line);
	}
	flush();
	if (!seen.size) problems.push('This issue was not opened from the submission form. Open a new one from "Submit a theme" or "Submit a layout".');
	return { fields, problems };
}

/** True when the checkbox section has its one option ticked. */
export function isTicked(answer: string | undefined): boolean {
	return !!answer && /^\s*-\s*\[[xX]\]/m.test(answer);
}

/** The comma list in `tags`, trimmed, lowercased, deduplicated. */
export function splitTags(answer: string | undefined): string[] {
	if (!answer) return [];
	const out: string[] = [];
	for (const raw of answer.split(/[,\n]/)) {
		const tag = raw.trim().replace(/^#/, '').toLowerCase();
		if (tag && !out.includes(tag)) out.push(tag);
	}
	return out;
}
