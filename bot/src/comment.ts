/**
 * The bot's one comment per submission. Every pass rewrites it whole from
 * what it knows, so the comment never carries state the next pass depends on.
 * Submitted text goes through [md]; ids are validated slugs.
 */
import { ID_PATTERN, PENDING_BRANCH, RENAME_MARKER, REPO_NAME, STICKY_MARKER, STORE_SITE, type AddonType } from './constants.ts';
import { BOT_LOGIN, type IssueComment } from './github.ts';
import type { Check, SubmissionResult } from './submission.ts';
import { md } from './text.ts';

/**
 * What the quick (web) pass reports, written by quick/run.ts. By the time a
 * comment is drawn, [images] holds the staged names (preview.png,
 * preview-dark.png…), not the renderer's <id>.png.
 */
export interface QuickReport {
	ok: boolean;
	problems: string[];
	images: string[];
}

/** What the full (JVM) pass reports: `<id>.report.json` from AddonShots. */
export interface FullReport {
	ok: boolean;
	refusal?: string;
	warnings: string[];
	images: string[];
}

export type Stage = 'form' | 'quick' | 'final';

export interface StickyInput {
	stage: Stage;
	submission: Omit<SubmissionResult, 'payload'>;
	quick?: QuickReport | null;
	/** Undefined while the full pass is still running; null when it did not produce a report. */
	full?: FullReport | null;
	/** True when the full pass is switched off for this repository. */
	fullDisabled?: boolean;
	repo: string;
	/** Cache-buster for the raw preview URL; the run id. */
	runId: string;
}

export function pendingUrls(repo: string, issue: number, file = '') {
	const base = `https://raw.githubusercontent.com/${repo}/${PENDING_BRANCH}/pending/${issue}`;
	const manifest = `${base}/wmkeyboard-repo.json`;
	return { base, manifest, file: file ? `${base}/${file}` : base };
}

export function tryLinks(manifestUrl: string, id: string) {
	return {
		app: `wmkeyboard://addon?repo=${encodeURIComponent(manifestUrl)}&id=${encodeURIComponent(id)}`,
		web: `${STORE_SITE}/addons/?repo=${encodeURIComponent(manifestUrl)}&id=${encodeURIComponent(id)}`,
	};
}

/** The verdict the labels follow: the JVM's when it ran, else the web pass's. */
export function verdict(input: Pick<StickyInput, 'submission' | 'quick' | 'full' | 'fullDisabled'>): 'ready' | 'needs-fix' | 'rendering' {
	if (!input.submission.ok) return 'needs-fix';
	if (input.full) return input.full.ok ? 'ready' : 'needs-fix';
	if (input.full === undefined && !input.fullDisabled) return 'rendering';
	if (input.full === null && !input.fullDisabled) return 'needs-fix';
	return input.quick?.ok ? 'ready' : 'needs-fix';
}

function line(c: Check): string {
	return `- ${c.ok ? '✅' : '❌'} **${c.title}**${c.detail ? `: ${c.detail}` : ''}`;
}

export function renderSticky(input: StickyInput): string {
	const s = input.submission;
	const state = input.stage === 'form' ? 'needs-fix' : verdict(input);
	const kind = s.type ?? 'submission';
	const out: string[] = [STICKY_MARKER];

	const heading = { ready: `✅ Ready for review`, 'needs-fix': `❌ Needs a fix`, rendering: `⏳ Quick preview` }[state];
	out.push(`## ${heading}`);
	if (state === 'rendering') {
		out.push('> Quick preview from the web renderer. The real keyboard render is on its way; this comment updates when it lands.');
	}
	const who = `by ${md(s.submitter.login)}`;
	if (s.id) out.push(`**${md(s.name || s.id)}**, ${kind} \`${s.id}\`${s.isUpdate ? ' (update)' : ''} ${who}${s.license ? `, ${s.license}` : ''}`);

	const checks: Check[] = [...s.checks];
	if (input.quick) {
		checks.push(
			input.quick.ok
				? { title: 'Web reader', ok: true }
				: { title: 'Web reader', ok: input.full?.ok ?? false, detail: input.quick.problems.map(md).join(' ') },
		);
	}
	if (input.full) {
		checks.push(
			input.full.ok
				? { title: 'WM Keyboard importer', ok: true, detail: input.quick && !input.quick.ok ? 'The app reads it, so the web reader\'s complaint above does not block it.' : undefined }
				: { title: 'WM Keyboard importer', ok: false, detail: `The app refuses it: ${md(input.full.refusal ?? 'no reason given')}` },
		);
	} else if (input.full === null && !input.fullDisabled && input.stage === 'final') {
		checks.push({ title: 'WM Keyboard importer', ok: false, detail: 'The keyboard render did not finish. Nothing for you to fix; a maintainer will re-run it.' });
	}
	out.push('### Checks', checks.map(line).join('\n'));

	const warnings = [...s.warnings, ...(input.full?.warnings ?? []).map(md)];
	if (warnings.length) out.push('### Notes', warnings.map((w) => `- ${w}`).join('\n'));

	if (s.ok && s.id && input.stage !== 'form') {
		const images = input.full?.ok ? input.full.images : (input.quick?.images ?? []);
		if (images.length) {
			const urls = pendingUrls(input.repo, s.issue);
			out.push(
				'### Preview',
				images.map((img) => `<img src="${urls.base}/${img}?v=${encodeURIComponent(input.runId)}" width="360" alt="" />`).join(' '),
			);
		}
		const links = tryLinks(pendingUrls(input.repo, s.issue).manifest, s.id);
		out.push(
			'### Try it before it is published',
			[
				`- [Open it in the web store](${links.web}), then **Open in WM Keyboard** on your phone.`,
				`- Or paste this into your phone's browser: \`${links.app}\``,
			].join('\n'),
			'A trial install comes from a separate pending repository, so it does not turn into the published version by itself.',
		);
	}

	if (state === 'needs-fix' && input.full !== null) {
		out.push('Edit the issue to fix it (the pencil on your first post). The bot checks it again on every edit.');
	}
	out.push(
		'<details><summary>For maintainers</summary>\n\n`/approve` publishes it once it is ready · `/reject <reason>` closes it · `/rename <new-id>` changes its id and checks it again.\n</details>',
	);
	return out.join('\n\n') + '\n';
}

/** The latest `/rename` the bot recorded on this issue, or null. Only the bot's own comments count. */
export function recordedRename(comments: IssueComment[]): string | null {
	let found: string | null = null;
	const re = new RegExp(`<!-- ${RENAME_MARKER} ([a-z0-9-]+) -->`);
	for (const c of comments) {
		if (c.user?.login !== BOT_LOGIN) continue;
		const id = re.exec(c.body)?.[1];
		if (id && ID_PATTERN.test(id)) found = id;
	}
	return found;
}

export function renameComment(id: string, by: string): string {
	return `<!-- ${RENAME_MARKER} ${id} -->\nRenamed to \`${id}\` by ${md(by)}. Checking it again under the new id.`;
}

export function liveComment(type: AddonType, id: string, version: string, repo: string): string {
	const noun = type === 'theme' ? 'theme' : 'layout';
	const manifest = `https://raw.githubusercontent.com/${repo}/main/wmkeyboard-repo.json`;
	const links = tryLinks(`https://github.com/${repo}`, id);
	return [
		`**Live.** The ${noun} \`${id}\` ${version} is published in the community repository.`,
		`- [Its page in the web store](${links.web})`,
		`- In WM Keyboard: **Settings → Addons → ${REPO_NAME}**, or open \`${links.app}\` on your phone.`,
		`- Manifest: \`${manifest}\``,
		`To publish a new version later, submit again with \`${id}\` in "Updates".`,
	].join('\n');
}
