/**
 * The form-level pass: everything the bot can decide from the issue alone,
 * before anything is rendered. Pure apart from the zip download, which is
 * injected so tests can run it offline.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASED_ON_PATTERN, ID_PATTERN, LICENSES, LIMITS, TYPES, type AddonType, type License } from './constants.ts';
import { isTicked, splitTags, type FieldId } from './form.ts';
import { normaliseLayout } from './layout.ts';
import { nearDuplicates } from './palette.ts';
import { classify, checkSize, decodeEncoded, downloadZip, extractFromZip, findPayload, MAX_DECODED, PayloadError } from './payload.ts';
import type { Published } from './repo.ts';
import { blockedWord, cleanLine, cleanText, md, slugify } from './text.ts';

/** One line of the checklist in the sticky comment. */
export interface Check {
	title: string;
	ok: boolean;
	/** What is wrong and how to fix it, when not ok; a note when ok. */
	detail?: string;
}

export interface SubmissionInput {
	fields: Partial<Record<FieldId, string>>;
	/** Problems from reading the body as a form at all. */
	formProblems: string[];
	issue: { number: number; user: { login: string; id: number }; labels: string[] };
	/** A maintainer's `/rename`, already checked to come from the bot. */
	rename?: string | null;
	published: Published[];
	blocklist: readonly string[];
	/** Repo root, for reading published themes to compare palettes. */
	root?: string;
	fetchImpl?: typeof fetch;
}

export interface SubmissionResult {
	ok: boolean;
	checks: Check[];
	warnings: string[];
	type: AddonType | null;
	id: string | null;
	/** True when this publishes a new version of an addon the submitter owns. */
	isUpdate: boolean;
	name: string;
	description: string;
	tags: string[];
	license: License | null;
	basedOn: string | null;
	submitter: { login: string; id: number };
	issue: number;
	/** The payload as it will be published: pretty JSON, layouts normalised. */
	payload: string | null;
}

export async function evaluateSubmission(input: SubmissionInput): Promise<SubmissionResult> {
	const { fields, issue } = input;
	const checks: Check[] = [];
	const warnings: string[] = [];
	const fail = (title: string, detail: string) => checks.push({ title, ok: false, detail });
	const pass = (title: string, detail?: string) => checks.push({ title, ok: true, ...(detail ? { detail } : {}) });

	if (input.formProblems.length) fail('Submission form', input.formProblems.join(' '));
	else pass('Submission form');

	if (isTicked(fields.rights)) pass('Rights confirmed');
	else fail('Rights confirmed', 'Tick "I made this, or I have the right to share…". Only share what you made or may pass on.');

	const name = cleanLine(fields.name);
	const description = cleanText(fields.description);
	const tags = splitTags(fields.tags).map(cleanLine).filter(Boolean);

	const nameProblem = !name
		? 'Give it a name.'
		: name.length > LIMITS.name
			? `The name is ${name.length} characters; keep it to ${LIMITS.name}.`
			: blockedWord(name, input.blocklist)
				? 'The name has a word this repository does not accept. Pick another name.'
				: null;
	if (nameProblem) fail('Name', nameProblem);
	else pass('Name');

	const descriptionProblem = !description
		? 'Add a sentence on what it looks like or who it is for.'
		: description.length > LIMITS.description
			? `The description is ${description.length} characters; keep it to ${LIMITS.description}.`
			: blockedWord(description, input.blocklist)
				? 'The description has a word this repository does not accept.'
				: null;
	if (descriptionProblem) fail('Description', descriptionProblem);
	else pass('Description');

	const tagProblem =
		tags.length > LIMITS.tags
			? `${tags.length} tags; keep it to ${LIMITS.tags}.`
			: tags.find((t) => t.length > LIMITS.tag)
				? `Keep each tag to ${LIMITS.tag} characters.`
				: tags.some((t) => blockedWord(t, input.blocklist))
					? 'A tag has a word this repository does not accept.'
					: null;
	if (tagProblem) fail('Tags', tagProblem);
	else if (tags.length) pass('Tags');

	const licenseAnswer = cleanLine(fields.license);
	const license = (LICENSES as readonly string[]).includes(licenseAnswer) ? (licenseAnswer as License) : null;
	if (license) pass('License', license);
	else fail('License', `Pick one of ${LICENSES.join(', ')}.`);

	const basedOnAnswer = cleanLine(fields.based_on);
	let basedOn: string | null = null;
	if (basedOnAnswer) {
		if (BASED_ON_PATTERN.test(basedOnAnswer)) {
			basedOn = basedOnAnswer;
			pass('Remix credit', `Based on \`${basedOn}\`.`);
		} else {
			fail('Remix credit', '"Based on" should look like `repo-id/addon-id`, as the app fills it in. Clear it if you are unsure.');
		}
	}

	// Payload.
	let type: AddonType | null = null;
	let payload: string | null = null;
	let classified: ReturnType<typeof classify> | null = null;
	try {
		const source = findPayload(fields.payload);
		let text: string;
		switch (source.kind) {
			case 'none':
				throw new PayloadError('The payload box is empty. Paste the `wmkb:1:…` text from the app, or drag the .zip it saved into the box.');
			case 'encoded':
				text = decodeEncoded(source.token, MAX_DECODED);
				break;
			case 'zip':
				text = extractFromZip(await downloadZip(source.url, input.fetchImpl)).text;
				break;
			case 'json':
				if (source.text.length > LIMITS.encodedChars) throw new PayloadError('The pasted JSON is longer than an issue can hold. Attach a .zip instead.');
				text = source.text;
				break;
		}
		classified = classify(text);
		type = classified.type;
		checkSize(type, text);
		pass('Payload', source.kind === 'zip' ? 'Read from the attached zip.' : undefined);
	} catch (e) {
		if (!(e instanceof PayloadError)) throw e;
		fail('Payload', e.message);
	}

	const formType = (['theme', 'layout'] as const).find((t) => issue.labels.includes(`type:${t}`)) ?? null;
	if (type && formType && type !== formType) {
		fail('Form type', `This is a ${type}, sent with the ${formType} form. Open a new issue with "Submit a ${type}".`);
	}

	// Id: free, or an update the submitter owns.
	let id: string | null = null;
	let isUpdate = false;
	const updates = cleanLine(fields.updates);
	if (updates) {
		const owned = input.published.find((p) => p.meta.id === updates);
		if (!ID_PATTERN.test(updates) || !owned) {
			fail('Addon id', `"Updates" names ${md(updates.slice(0, 48))}, which is not published here. Leave it empty for a new addon.`);
		} else if (owned.meta.submitter.id !== issue.user.id) {
			fail('Addon id', `\`${updates}\` was published by someone else. Only its author can update it; share yours as a new addon instead.`);
		} else if (type && owned.meta.type !== type) {
			fail('Addon id', `\`${updates}\` is a ${owned.meta.type}, and this is a ${type}.`);
		} else {
			id = updates;
			isUpdate = true;
			pass('Addon id', `Updates \`${id}\` (now ${owned.meta.version}).`);
			if (input.rename) warnings.push(`A rename to \`${input.rename}\` was ignored: an update keeps the id it was published under.`);
		}
	} else {
		const wanted = input.rename || slugify(name);
		const taken = input.published.find((p) => p.meta.id === wanted);
		if (!wanted || !ID_PATTERN.test(wanted)) {
			fail('Addon id', 'The name gives no usable id. Use a name with some letters or digits in it.');
		} else if (taken) {
			fail(
				'Addon id',
				taken.meta.submitter.id === issue.user.id
					? `You already published \`${wanted}\`. To update it, put \`${wanted}\` in "Updates"; to share a separate addon, change the name.`
					: `\`${wanted}\` is taken. Change the name so it gives a different id.`,
			);
		} else {
			id = wanted;
			pass('Addon id', input.rename ? `\`${id}\`, renamed by a maintainer.` : `\`${id}\``);
		}
	}

	if (classified && id) {
		if (classified.type === 'layout') {
			try {
				const normalised = normaliseLayout(classified, id, name || id);
				warnings.push(...normalised.warnings);
				payload = JSON.stringify(normalised.envelope, null, 2) + '\n';
			} catch (e) {
				fail('Payload', (e as Error).message);
			}
		} else {
			payload = JSON.stringify(classified.json, null, 2) + '\n';
			if (input.root) {
				const others = input.published
					.filter((p) => p.meta.type === 'theme' && p.meta.id !== id)
					.map((p) => ({ id: p.meta.id, theme: JSON.parse(readFileSync(join(input.root!, p.dir, TYPES.theme.file), 'utf8')) as Record<string, unknown> }));
				for (const near of nearDuplicates(classified.json, others).slice(0, 3)) {
					warnings.push(`The colours are very close to \`${near.id}\`. Fine for a remix (the "Based on" line credits it); a maintainer will take a look.`);
				}
			}
		}
	}

	const ok = checks.every((c) => c.ok) && payload != null;
	return {
		ok,
		checks,
		warnings,
		type,
		id,
		isUpdate,
		name,
		description,
		tags,
		license,
		basedOn,
		submitter: issue.user,
		issue: issue.number,
		payload,
	};
}

/** The render input the quick and full passes read: `request.json` names the payload beside it. */
export function renderRequest(result: SubmissionResult): { type: AddonType; id: string; file: string } {
	if (!result.type || !result.id) throw new Error('no render request for a failed submission');
	return { type: result.type, id: result.id, file: TYPES[result.type].file };
}
