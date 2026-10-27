/** Maintainer commands in issue comments. Only the first line is read. */
import { ID_PATTERN } from './constants.ts';
import { cleanText } from './text.ts';

export type Command =
	| { kind: 'approve' }
	| { kind: 'reject'; reason: string }
	| { kind: 'rename'; id: string }
	| { kind: 'invalid'; message: string };

/** The command a comment gives, or null for an ordinary comment. */
export function parseCommand(body: string): Command | null {
	const text = body.replace(/\r\n?/g, '\n').trimStart();
	const m = /^\/(approve|reject|rename)\b[ \t]*([^\n]*)/.exec(text);
	if (!m) return null;
	const [, verb, rest] = m;
	const arg = rest!.trim();
	switch (verb) {
		case 'approve':
			return { kind: 'approve' };
		case 'reject': {
			// The reason may run on to further lines; it is shown, quoted, to the submitter.
			const reason = cleanText(arg + text.slice(m[0].length)).slice(0, 1000);
			return { kind: 'reject', reason };
		}
		default:
			return ID_PATTERN.test(arg)
				? { kind: 'rename', id: arg }
				: { kind: 'invalid', message: '`/rename` takes an id: lowercase letters, digits and dashes, 2-48 characters, for example `/rename midnight-garden`.' };
	}
}
