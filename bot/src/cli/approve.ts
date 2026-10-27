/**
 * `/approve`, in the one job that may push to `main` (concurrency
 * `publish-main`, so approvals queue rather than race).
 *
 *   approve.ts publish    copy PENDING_DIR into addons/<type>/<id>/, regenerate manifest + README
 *   approve.ts announce   comment "Live", label and close (after the workflow pushed)
 *
 * Everything is checked again here rather than trusted from the pending
 * branch: the issue's labels and author, the id's owner on today's `main`,
 * and that the payload still parses as the type it claims.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LABELS, TYPES } from '../constants.ts';
import { liveComment } from '../comment.ts';
import { GitHub, labelNames } from '../github.ts';
import { buildManifest, buildReadme, manifestText } from '../manifest.ts';
import { collectImages, metaFor, writeAddonFolder, type Summary } from '../pending.ts';
import { classify } from '../payload.ts';
import { addonDir, readPublished } from '../repo.ts';
import { checkedId, checkedType, env, issueNumber, main, output, readJson, REPO_ROOT } from './io.ts';

async function publish(issueNo: number) {
	const gh = GitHub.fromEnv();
	const issue = await gh.getIssue(issueNo);
	const labels = labelNames(issue);
	if (issue.state !== 'open' || !labels.includes(LABELS.ready) || labels.includes(LABELS.rendering)) {
		throw new Error(`#${issueNo} is not open and ready (labels: ${labels.join(', ')})`);
	}

	const pending = env('PENDING_DIR');
	const s = readJson<Summary>(join(pending, 'submission.json'));
	const id = checkedId(s.id);
	const type = checkedType(s.type);
	if (s.issue !== issueNo || s.submitter.id !== issue.user.id) throw new Error('pending/submission.json does not belong to this issue');
	const payload = readFileSync(join(pending, TYPES[type].file));
	if (classify(payload.toString('utf8')).type !== type) throw new Error(`pending payload is not a ${type}`);

	const published = readPublished(REPO_ROOT);
	const existing = published.find((p) => p.meta.id === id);
	if (existing && (!s.isUpdate || existing.meta.submitter.id !== s.submitter.id || existing.meta.type !== type)) {
		await gh.comment(issueNo, `\`${id}\` was published by another submission since this one was checked. \`/rename <new-id>\` it and approve again.`);
		throw new Error(`${id} is taken`);
	}
	if (!existing && s.isUpdate) throw new Error(`${id} is an update of an addon that is no longer published`);

	// Pending previews already carry their published names: preview.png is the
	// renderer's "<id>.png" with the id "preview".
	const images = collectImages(pending, 'preview');
	const meta = metaFor(s, images.map((i) => i.name), new Date().toISOString(), existing?.meta);
	writeAddonFolder(join(REPO_ROOT, addonDir(type, id)), meta, payload, images);

	const all = readPublished(REPO_ROOT);
	writeFileSync(join(REPO_ROOT, 'wmkeyboard-repo.json'), manifestText(buildManifest(REPO_ROOT, all, gh.repo)));
	writeFileSync(join(REPO_ROOT, 'README.md'), buildReadme(all, gh.repo));
	output({ id, type, version: meta.version, dir: addonDir(type, id) });
}

async function announce(issueNo: number) {
	const gh = GitHub.fromEnv();
	const id = checkedId(env('ADDON_ID'));
	const type = checkedType(env('ADDON_TYPE'));
	const version = env('ADDON_VERSION');
	if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('bad version');
	const labels = labelNames(await gh.getIssue(issueNo));
	await gh.comment(issueNo, liveComment(type, id, version, gh.repo));
	await gh.addLabels(issueNo, [LABELS.published]);
	await gh.removeLabels(issueNo, [LABELS.ready, LABELS.needsFix, LABELS.rendering], labels);
	await gh.close(issueNo, 'completed');
}

main(async () => {
	const command = process.argv[2];
	const issue = issueNumber(process.env.ISSUE_NUMBER);
	if (command === 'publish') return publish(issue);
	if (command === 'announce') return announce(issue);
	throw new Error('usage: approve.ts publish | announce');
});
