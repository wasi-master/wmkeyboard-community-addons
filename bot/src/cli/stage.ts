/**
 * The write side of submission.yml, run only in jobs that hold
 * `contents: write`, on files the parse and render jobs produced.
 *
 *   stage.ts files    fill <PENDING_CHECKOUT>/pending/<issue>/ (the workflow commits it)
 *   stage.ts comment  rewrite the sticky comment and the labels
 *
 * Env: ISSUE_NUMBER, WORK_DIR (parse artifact), QUICK_DIR (quick artifact),
 * FULL_DIR (full artifact, absent until the JVM pass ran), PENDING_CHECKOUT,
 * FULL_RENDER (`off` when the JVM pass is switched off).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LABELS, TYPES } from '../constants.ts';
import { renderSticky, verdict, type FullReport, type QuickReport, type Stage } from '../comment.ts';
import { GitHub, labelNames } from '../github.ts';
import { manifestText } from '../manifest.ts';
import { collectImages, metaFor, pendingManifest, writeAddonFolder, type Summary } from '../pending.ts';
import { readPublished } from '../repo.ts';
import { checkedId, checkedType, env, issueNumber, main, readJson, REPO_ROOT } from './io.ts';

function readSummary(work: string, issue: number): Summary {
	const s = readJson<Summary>(join(work, 'submission.json'));
	if (s.issue !== issue) throw new Error(`submission.json is for #${s.issue}, not #${issue}`);
	checkedId(s.id);
	checkedType(s.type);
	return s;
}

/** A report a renderer wrote, reduced to the fields the bot uses and checked for shape. */
function readFullReport(dir: string | undefined, id: string): FullReport | null {
	if (!dir) return null;
	const path = join(dir, `${id}.report.json`);
	if (!existsSync(path)) return null;
	const raw = readJson<Record<string, unknown>>(path);
	const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.slice(0, 500)).slice(0, 20) : []);
	return {
		ok: raw.ok === true,
		refusal: typeof raw.refusal === 'string' ? raw.refusal.slice(0, 1000) : undefined,
		warnings: strings(raw.warnings),
		images: collectImages(dir, id).map((i) => i.name),
	};
}

function readQuickReport(dir: string | undefined, id: string): QuickReport | null {
	if (!dir || !existsSync(join(dir, 'report.json'))) return null;
	const raw = readJson<Record<string, unknown>>(join(dir, 'report.json'));
	return {
		ok: raw.ok === true,
		problems: Array.isArray(raw.problems) ? raw.problems.filter((x): x is string => typeof x === 'string').slice(0, 20) : [],
		images: collectImages(dir, id).map((i) => i.name),
	};
}

function files(issue: number) {
	const work = env('WORK_DIR');
	const s = readSummary(work, issue);
	const id = s.id!;
	const type = s.type!;
	const payload = readFileSync(join(work, 'render', TYPES[type].file));
	const full = readFullReport(process.env.FULL_DIR, id);
	// The JVM render replaces the web one only when the app accepted the addon.
	const imagesDir = full?.ok && full.images.length ? env('FULL_DIR') : env('QUICK_DIR');
	const images = collectImages(imagesDir, id);
	const previous = s.isUpdate ? readPublished(REPO_ROOT).find((p) => p.meta.id === id)?.meta : undefined;
	const meta = metaFor(s, images.map((i) => i.name), new Date().toISOString(), previous);
	const target = join(env('PENDING_CHECKOUT'), 'pending', String(issue));
	writeAddonFolder(target, meta, payload, images);
	writeFileSync(join(target, 'submission.json'), JSON.stringify(s, null, 2) + '\n');
	writeFileSync(join(target, 'wmkeyboard-repo.json'), manifestText(pendingManifest(meta, payload, issue)));
	console.log(`staged pending/${issue}: ${type} ${id} with ${images.map((i) => i.name).join(', ') || 'no preview'}`);
}

async function comment(issue: number, stage: Stage) {
	const gh = GitHub.fromEnv();
	const s = readSummary(env('WORK_DIR'), issue);
	const fullDisabled = process.env.FULL_RENDER === 'off';
	const quick = readQuickReport(process.env.QUICK_DIR, s.id!);
	const full = stage === 'final' && !fullDisabled ? readFullReport(process.env.FULL_DIR, s.id!) : undefined;
	const input = { stage, submission: s, quick, full, fullDisabled, repo: gh.repo, runId: env('GITHUB_RUN_ID') };
	await gh.upsertSticky(issue, renderSticky(input));

	const state = verdict(input);
	const current = labelNames(await gh.getIssue(issue));
	const wanted = state === 'rendering' ? LABELS.rendering : state === 'ready' ? LABELS.ready : LABELS.needsFix;
	await gh.addLabels(issue, [wanted, LABELS.type(s.type!)]);
	await gh.removeLabels(issue, [LABELS.rendering, LABELS.ready, LABELS.needsFix].filter((l) => l !== wanted), current);
}

main(async () => {
	const [command, ...rest] = process.argv.slice(2);
	const issue = issueNumber(process.env.ISSUE_NUMBER);
	if (command === 'files') return files(issue);
	if (command === 'comment') {
		const stage = rest[rest.indexOf('--stage') + 1] as Stage;
		if (stage !== 'quick' && stage !== 'final') throw new Error('--stage quick|final');
		return comment(issue, stage);
	}
	throw new Error('usage: stage.ts files | comment --stage quick|final');
});
