/**
 * The form-level pass: everything the bot can decide from the issue alone,
 * before anything is rendered. Pure apart from the zip download, which is
 * injected so tests can run it offline.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADDON_TYPES, BASED_ON_PATTERN, ID_PATTERN, licensesFor, LIMITS, REPO_ID, TYPES, type AddonType, type License } from './constants.ts';
import { isTicked, splitTags, type FieldId } from './form.ts';
import { normaliseLayout } from './layout.ts';
import { nearDuplicates } from './palette.ts';
import { checkSize, classifyBytes, decodeEncoded, downloadZip, extractFromZip, findPayload, MAX_DECODED, PayloadError, type Classified } from './payload.ts';
import { compareVersions, PLUGIN_ID, PLUGIN_VERSION, pluginFacts, readPluginArchive } from './plugin.ts';
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
	/**
	 * The version it publishes as, for a kind that carries its own: a
	 * plugin's `pluginVersion`. Absent for the rest, which start at 1.0.0 and
	 * go up a minor version with each update.
	 */
	version?: string;
	/**
	 * The payload as it will be published: pretty JSON for a theme, layout or
	 * snippet pack (layouts normalised), the pack's own bytes for the rest.
	 */
	payload: Uint8Array | null;
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

	// The form decides the licences offered: code licences for a plugin.
	const formType = ADDON_TYPES.find((t) => issue.labels.includes(`type:${t}`)) ?? null;
	const licenses = licensesFor(formType);
	const licenseAnswer = cleanLine(fields.license);
	const license = (licenses as readonly string[]).includes(licenseAnswer) ? (licenseAnswer as License) : null;
	if (license) pass('License', license);
	else fail('License', `Pick one of ${licenses.join(', ')}.`);

	const basedOnAnswer = cleanLine(fields.based_on);
	let basedOn: string | null = null;
	// The id of an addon published here, typed by hand, names it as surely as
	// the full `repo-id/addon-id` the app fills in.
	const basedOnHere = input.published.find((p) => p.meta.id === basedOnAnswer);
	if (basedOnAnswer) {
		if (BASED_ON_PATTERN.test(basedOnAnswer)) {
			basedOn = basedOnAnswer;
			pass('Remix credit', `Based on \`${basedOn}\`.`);
		} else if (basedOnHere) {
			basedOn = `${REPO_ID}/${basedOnHere.meta.id}`;
			pass('Remix credit', `Based on \`${basedOnHere.meta.id}\` from this repository.`);
		} else {
			fail(
				'Remix credit',
				'"Based on" should look like `repo-id/addon-id`, as the app fills it in, or be the id of an addon published here. Clear it if you are unsure.',
			);
		}
	}

	// Payload.
	let type: AddonType | null = null;
	let payload: Uint8Array | null = null;
	let classified: Classified | null = null;
	try {
		const source = findPayload(fields.payload);
		let bytes: Uint8Array;
		switch (source.kind) {
			case 'none':
				throw new PayloadError('The payload box is empty. Paste the `wmkb:1:…` text from the app, or drag the .zip it saved into the box.');
			case 'encoded':
				bytes = decodeEncoded(source.token, MAX_DECODED);
				break;
			case 'zip':
				bytes = extractFromZip(await downloadZip(source.url, input.fetchImpl)).bytes;
				break;
			case 'json':
				if (source.text.length > LIMITS.encodedChars) throw new PayloadError('The pasted JSON is longer than an issue can hold. Attach a .zip instead.');
				bytes = Buffer.from(source.text, 'utf8');
				break;
		}
		classified = classifyBytes(bytes);
		type = classified.type;
		checkSize(type, bytes.byteLength);
		pass('Payload', source.kind === 'zip' ? 'Read from the attached zip.' : undefined);
	} catch (e) {
		if (!(e instanceof PayloadError)) throw e;
		fail('Payload', e.message);
	}

	if (type && formType && type !== formType) {
		fail('Form type', `This is a ${TYPES[type].noun}, sent with the ${TYPES[formType].noun} form. Open a new issue with "Submit a ${TYPES[type].noun}".`);
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
			fail('Addon id', `\`${updates}\` is a ${TYPES[owned.meta.type].noun}, and this is a ${TYPES[type].noun}.`);
		} else if (basedOnHere?.meta.id === updates || basedOn === `${REPO_ID}/${updates}`) {
			// An update replaces the addon; one built from it sits beside it.
			// Naming it in both says the second, and publishing it as the first
			// would overwrite what it was built from.
			fail(
				'Addon id',
				`\`${updates}\` is in both "Updates" and "Based on". To publish this beside \`${updates}\`, clear "Updates"; to replace \`${updates}\` with it, clear "Based on".`,
			);
		} else {
			id = updates;
			isUpdate = true;
			pass('Addon id', `Updates \`${id}\` (now ${owned.meta.version}).`);
			if (name && owned.meta.name && name.toLowerCase() !== owned.meta.name.toLowerCase()) {
				warnings.push(
					`This replaces "${md(owned.meta.name)}" and renames it "${md(name)}". To publish it as a separate addon instead, clear "Updates".`,
				);
			}
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

	let version: string | undefined;
	if (classified && id) {
		const text = (json: unknown) => Buffer.from(JSON.stringify(json, null, 2) + '\n', 'utf8');
		switch (classified.type) {
			case 'layout':
				try {
					const normalised = normaliseLayout(classified, id, name || id);
					warnings.push(...normalised.warnings);
					payload = text(normalised.envelope);
				} catch (e) {
					fail('Payload', (e as Error).message);
				}
				break;
			case 'theme':
				payload = text(classified.json);
				if (input.root) {
					const others = input.published
						.filter((p) => p.meta.type === 'theme' && p.meta.id !== id)
						.map((p) => ({ id: p.meta.id, theme: JSON.parse(readFileSync(join(input.root!, p.dir, TYPES.theme.file), 'utf8')) as Record<string, unknown> }));
					for (const near of nearDuplicates(classified.json, others).slice(0, 3)) {
						warnings.push(`The colours are very close to \`${near.id}\`. Fine for a remix (the "Based on" line credits it); a maintainer will take a look.`);
					}
				}
				break;
			case 'snippets':
				payload = text(classified.json);
				break;
			case 'plugin': {
				const checked = checkPlugin(classified.manifest, { id, name, isUpdate, published: input.published, root: input.root, submitter: issue.user });
				checks.push(...checked.checks);
				warnings.push(...checked.warnings);
				version = checked.version;
				// Byte for byte, like a pack: the sha256 in the manifest is of what was sent.
				payload = classified.bytes;
				break;
			}
			default:
				// A pack goes out byte for byte: re-zipping it would only risk
				// changing what the app's importer reads.
				payload = classified.bytes;
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
		...(version ? { version } : {}),
		payload,
	};
}

/** The plugin.json id of every published plugin, by addon id. Unreadable ones are left out. */
export function publishedPluginIds(root: string, published: Published[]): Map<string, string> {
	const out = new Map<string, string>();
	for (const p of published) {
		if (p.meta.type !== 'plugin') continue;
		const file = join(root, p.dir, TYPES.plugin.file);
		if (!existsSync(file)) continue;
		try {
			const id = pluginFacts(readPluginArchive(readFileSync(file)).manifest).id;
			if (id) out.set(p.meta.id, id);
		} catch {
			// A published plugin the reader no longer takes says nothing about this one.
		}
	}
	return out;
}

/**
 * The plugin rules on top of the form's: the manifest's own id is the
 * folder the plugin installs into on a phone, so it is unique across the
 * repository and an update keeps it; the version is three numbers and an
 * update raises it.
 */
function checkPlugin(
	manifest: Record<string, unknown>,
	ctx: { id: string; name: string; isUpdate: boolean; published: Published[]; root?: string; submitter: { id: number } },
): { checks: Check[]; warnings: string[]; version?: string } {
	const checks: Check[] = [];
	const warnings: string[] = [];
	const facts = pluginFacts(manifest);
	const ids = ctx.root ? publishedPluginIds(ctx.root, ctx.published) : new Map<string, string>();

	if (!PLUGIN_ID.test(facts.id)) {
		checks.push({ title: 'Plugin id', ok: false, detail: 'plugin.json needs an "id" of 3 to 64 lowercase letters, digits, ".", "_" and "-", such as `com.example.cipher`.' });
	} else {
		const holder = [...ids.entries()].find(([addon, pluginId]) => pluginId === facts.id && addon !== ctx.id);
		const previous = ctx.isUpdate ? ids.get(ctx.id) : undefined;
		if (holder) {
			const owner = ctx.published.find((p) => p.meta.id === holder[0]);
			checks.push({
				title: 'Plugin id',
				ok: false,
				detail:
					owner?.meta.submitter.id === ctx.submitter.id
						? `\`${facts.id}\` is the plugin id of \`${holder[0]}\`, which you published. To update it, put \`${holder[0]}\` in "Updates".`
						: `\`${facts.id}\` is already the plugin id of \`${holder[0]}\`. Two plugins with one id overwrite each other on a phone: change "id" in plugin.json.`,
			});
		} else if (previous && previous !== facts.id) {
			checks.push({
				title: 'Plugin id',
				ok: false,
				detail: `The published version's id is \`${previous}\`. An update keeps it, or phones would install this beside the old one and lose its data: set "id" back to \`${previous}\`.`,
			});
		} else {
			checks.push({ title: 'Plugin id', ok: true, detail: `\`${facts.id}\`` });
		}
	}

	let version: string | undefined;
	if (!PLUGIN_VERSION.test(facts.version)) {
		checks.push({
			title: 'Plugin version',
			ok: false,
			detail: facts.version
				? `"pluginVersion" is ${md(facts.version.slice(0, 32))}. The community repository needs three numbers, such as \`1.0.0\`.`
				: 'plugin.json needs a "pluginVersion", such as `1.0.0`.',
		});
	} else {
		const owned = ctx.isUpdate ? ctx.published.find((p) => p.meta.id === ctx.id) : undefined;
		if (owned && PLUGIN_VERSION.test(owned.meta.version) && compareVersions(facts.version, owned.meta.version) <= 0) {
			checks.push({
				title: 'Plugin version',
				ok: false,
				detail: `The published version is ${owned.meta.version}. Raise "pluginVersion" above it, or phones will not offer the update.`,
			});
		} else {
			version = facts.version;
			checks.push({ title: 'Plugin version', ok: true, detail: facts.version });
		}
	}

	if (facts.name && ctx.name && facts.name.toLowerCase() !== ctx.name.toLowerCase()) {
		warnings.push(`The form calls it "${md(ctx.name)}" and plugin.json "${md(facts.name)}". The repository lists the form's name; the keyboard shows plugin.json's.`);
	}
	return { checks, warnings, version };
}

/** The render input the quick and full passes read: `request.json` names the payload beside it. */
export function renderRequest(result: SubmissionResult): { type: AddonType; id: string; file: string } {
	if (!result.type || !result.id) throw new Error('no render request for a failed submission');
	return { type: result.type, id: result.id, file: TYPES[result.type].file };
}
