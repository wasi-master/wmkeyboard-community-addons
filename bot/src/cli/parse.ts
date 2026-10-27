/**
 * Job 1 of submission.yml: read the issue, check the form-level rules, write
 * the render input. Reads the issue from the event file or the API, never from
 * an expression, so the body never passes through the workflow's YAML.
 *
 *   work/submission.json        what the comment and the publish step need
 *   work/render/request.json    {type, id, file}: all a renderer is given…
 *   work/render/<file>          …plus the payload itself
 *
 * Outputs: skip, ok, id, type.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LABELS } from '../constants.ts';
import { renderSticky } from '../comment.ts';
import { labelMap, parseIssueForm } from '../form.ts';
import { GitHub, labelNames, type Issue } from '../github.ts';
import { recordedRename } from '../comment.ts';
import { readPublished } from '../repo.ts';
import { evaluateSubmission, renderRequest } from '../submission.ts';
import { parseBlocklist } from '../text.ts';
import { issueNumber, main, output, readEvent, REPO_ROOT } from './io.ts';

main(async () => {
	const gh = GitHub.fromEnv();
	const work = resolve(process.env.WORK_DIR ?? join(REPO_ROOT, 'work'));
	const event = readEvent<{ issue?: Issue; inputs?: { issue?: string } }>();
	const issue = event.issue ?? (await gh.getIssue(issueNumber(event.inputs?.issue ?? process.env.ISSUE_NUMBER)));
	const labels = labelNames(issue);

	const skip =
		!!issue.pull_request ||
		issue.state !== 'open' ||
		!labels.includes(LABELS.submission) ||
		labels.includes(LABELS.published) ||
		labels.includes(LABELS.rejected);
	if (skip) {
		console.log(`issue #${issue.number}: not an open submission, nothing to do`);
		output({ skip: true, ok: false, id: '', type: '' });
		return;
	}

	const comments = await gh.listComments(issue.number);
	const form = parseIssueForm(issue.body ?? '', labelMap(join(REPO_ROOT, '.github', 'ISSUE_TEMPLATE')));
	const result = await evaluateSubmission({
		fields: form.fields,
		formProblems: form.problems,
		issue: { number: issue.number, user: { login: issue.user.login, id: issue.user.id }, labels },
		rename: recordedRename(comments),
		published: readPublished(REPO_ROOT),
		blocklist: parseBlocklist(readFileSync(join(REPO_ROOT, 'bot', 'blocklist.txt'), 'utf8')),
		root: REPO_ROOT,
	});

	mkdirSync(join(work, 'render'), { recursive: true });
	const { payload, ...summary } = result;
	writeFileSync(join(work, 'submission.json'), JSON.stringify(summary, null, 2) + '\n');
	for (const c of result.checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.title}${c.detail ? `: ${c.detail}` : ''}`);

	if (result.ok && payload) {
		const request = renderRequest(result);
		writeFileSync(join(work, 'render', 'request.json'), JSON.stringify(request, null, 2) + '\n');
		writeFileSync(join(work, 'render', request.file), payload);
		output({ skip: false, ok: true, id: request.id, type: request.type });
		return;
	}

	// Nothing to render: say what to fix now, rather than after two render jobs.
	await gh.upsertSticky(issue.number, renderSticky({ stage: 'form', submission: summary, repo: gh.repo, runId: process.env.GITHUB_RUN_ID ?? '0' }));
	if (result.type) await gh.addLabels(issue.number, [LABELS.type(result.type)]);
	await gh.addLabels(issue.number, [LABELS.needsFix]);
	await gh.removeLabels(issue.number, [LABELS.rendering, LABELS.ready], labels);
	output({ skip: false, ok: false, id: '', type: '' });
});
