/**
 * publish.yml's first job: who said what. Reads the comment from the event
 * file, checks the commenter's permission through the API, and either acts
 * (reject, rename) or hands `/approve` to the job that may write to `main`.
 *
 * Outputs: command (approve, reject once done, or empty), issue.
 */
import { LABELS } from '../constants.ts';
import { renameComment } from '../comment.ts';
import { parseCommand } from '../commands.ts';
import { canWrite, GitHub, labelNames, type Issue } from '../github.ts';
import { md } from '../text.ts';
import { main, output, readEvent } from './io.ts';

interface CommentEvent {
	issue: Issue;
	comment: { body: string; user: { login: string; type: string } };
}

main(async () => {
	const event = readEvent<CommentEvent>();
	const { issue, comment } = event;
	output({ command: '', issue: issue.number });
	const command = parseCommand(comment.body);
	const labels = labelNames(issue);
	if (!command || issue.pull_request || !labels.includes(LABELS.submission) || comment.user.type === 'Bot') return;

	const gh = GitHub.fromEnv();
	const who = comment.user.login;
	if (!canWrite(await gh.permission(who))) {
		await gh.comment(issue.number, `Only maintainers can use \`/${command.kind === 'invalid' ? 'rename' : command.kind}\`, ${md(who)}.`);
		return;
	}
	if (issue.state !== 'open' || labels.includes(LABELS.published)) {
		await gh.comment(issue.number, 'This submission is already closed.');
		return;
	}

	switch (command.kind) {
		case 'invalid':
			await gh.comment(issue.number, command.message);
			return;
		case 'approve':
			if (labels.includes(LABELS.rendering)) {
				await gh.comment(issue.number, 'Still rendering. `/approve` again once the comment above says it is ready.');
			} else if (!labels.includes(LABELS.ready)) {
				await gh.comment(issue.number, 'Not ready: the checks above have to pass first.');
			} else {
				output({ command: 'approve', issue: issue.number });
			}
			return;
		case 'reject': {
			const reason = command.reason ? `\n\n> ${md(command.reason)}` : '';
			await gh.comment(issue.number, `Closed by ${md(who)}.${reason}\n\nThanks for sharing it all the same.`);
			await gh.addLabels(issue.number, [LABELS.rejected]);
			await gh.removeLabels(issue.number, [LABELS.ready, LABELS.needsFix, LABELS.rendering], labels);
			await gh.close(issue.number, 'not_planned');
			output({ command: 'reject', issue: issue.number });
			return;
		}
		case 'rename':
			await gh.comment(issue.number, renameComment(command.id, who));
			// A token-made comment starts no workflow; a dispatch does.
			await gh.dispatch('submission.yml', process.env.DEFAULT_BRANCH || 'main', { issue: String(issue.number) });
			return;
	}
});
