/**
 * The plugin part of the sticky comment: what a maintainer reads before
 * `/approve`. Built in the stage job from the payload, the published version
 * (for an update) and the wmpy job's report, and rewritten whole on every pass.
 *
 * Everything submitted goes through [md], or into a code span only when it is
 * made of characters that cannot end one, or into a fenced block longer than
 * any run of backticks inside it.
 */
import { PENDING_BRANCH } from './constants.ts';
import { pluginChanges, pluginFacts, readPluginArchive, size, type PermissionInfo, type PluginChanges, type PluginFacts, type PluginFileKind, type WmpyProblem, type WmpyReport } from './plugin.ts';
import type { Check } from './submission.ts';
import { md } from './text.ts';

export interface PluginReview {
	facts: PluginFacts;
	files: { name: string; kind: PluginFileKind; size: number; text?: string }[];
	/** The .wmplugin's own size. */
	bytes: number;
	/** For an update: what changed since the published version. */
	changes?: PluginChanges | null;
	/** Undefined until the wmpy job ran; null when it left no report. */
	wmpy?: WmpyReport | null;
}

export function buildReview(payload: Uint8Array, previous?: Uint8Array | null, wmpy?: WmpyReport | null): PluginReview {
	const archive = readPluginArchive(payload);
	return {
		facts: pluginFacts(archive.manifest),
		files: archive.files.map(({ name, kind, size: s, text }) => ({ name, kind, size: s, ...(text !== undefined ? { text } : {}) })),
		bytes: payload.byteLength,
		changes: previous ? pluginChanges(readPluginArchive(previous), archive) : null,
		...(wmpy !== undefined ? { wmpy } : {}),
	};
}

/** Where stage.ts puts a plugin's unpacked text files and its diff on the pending branch. */
export const SOURCE_DIR = 'source';
export const DIFF_FILE = 'changes.diff';

export function pendingBlob(repo: string, issue: number, path: string): string {
	return `https://github.com/${repo}/blob/${PENDING_BRANCH}/pending/${issue}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** A code span when [s] is plain enough for one, else escaped text. */
function code(s: string): string {
	return /^[A-Za-z0-9 ._:/@*+=#-]{1,120}$/.test(s) ? `\`${s}\`` : md(s.slice(0, 120));
}

/** A fence that no run of backticks in [body] can close. */
export function fence(body: string, lang: string): string {
	const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
	const ticks = '`'.repeat(Math.max(3, longest + 1));
	return `${ticks}${lang}\n${body.endsWith('\n') ? body : `${body}\n`}${ticks}`;
}

function language(name: string): string {
	if (name.endsWith('.py')) return 'python';
	if (name.endsWith('.json')) return 'json';
	if (name.endsWith('.svg')) return 'xml';
	if (name.endsWith('.md')) return 'markdown';
	return 'text';
}

const KIND: Record<PluginFileKind, string> = {
	manifest: 'manifest',
	entry: 'script',
	module: 'module',
	test: 'test',
	locale: 'translation',
	asset: 'asset',
	other: 'left out by the app',
};

const lineCount = (s: string) => (s ? s.split('\n').length - (s.endsWith('\n') ? 1 : 0) : 0);
const linesOf = (s: string) => `${lineCount(s)} line${lineCount(s) === 1 ? '' : 's'}`;

function problemLine(p: WmpyProblem): string {
	const place = p.file ? `${p.file}${p.line ? `:${p.line}${p.col ? `:${p.col}` : ''}` : ''}: ` : '';
	return md(`${place}${p.message}${p.code ? ` [${p.code}]` : ''}`.slice(0, 300));
}

function listProblems(problems: WmpyProblem[], max = 8): string {
	const shown = problems.slice(0, max).map(problemLine);
	if (problems.length > max) shown.push(`and ${problems.length - max} more`);
	return shown.join('; ');
}

/** The checklist lines for wmpy's verdict. */
export function wmpyChecks(report: WmpyReport | null | undefined): Check[] {
	if (!report) {
		return [{ title: 'wmpy check', ok: false, detail: 'The wmpy job left no report. Nothing for you to fix; a maintainer will run it again.' }];
	}
	if (report.error) {
		return [{ title: 'wmpy check', ok: false, detail: `wmpy could not run: ${md(report.error.slice(0, 300))}. Nothing for you to fix; a maintainer will run it again.` }];
	}
	const out: Check[] = [];
	const c = report.check;
	if (c) {
		const errors = c.problems.filter((p) => p.severity === 'error');
		const warnings = c.problems.filter((p) => p.severity === 'warning');
		out.push(
			c.ok
				? { title: 'wmpy check', ok: true, detail: warnings.length ? `${c.warnings} warning${c.warnings === 1 ? '' : 's'}: ${listProblems(warnings, 4)}` : 'No problems.' }
				: { title: 'wmpy check', ok: false, detail: `${c.errors} error${c.errors === 1 ? '' : 's'}: ${listProblems(errors.length ? errors : c.problems)}. Run \`wmpy check\` in the plugin's folder to see them with the code around them.` },
		);
	}
	const t = report.test;
	if (!t) out.push({ title: 'wmpy test', ok: true, detail: 'The plugin has no tests (test.py), so there was nothing to run.' });
	else if (t.ok) out.push({ title: 'wmpy test', ok: true, detail: `${t.passed} passed.` });
	else out.push({ title: 'wmpy test', ok: false, detail: `${t.failed} failed${t.passed ? `, ${t.passed} passed` : ''}${t.problems.length ? `: ${listProblems(t.problems, 4)}` : ''}. Run \`wmpy test\` to see them.` });
	return out;
}

function permission(p: PermissionInfo, risky: boolean): string {
	return `- ${risky ? '⚠️ ' : ''}\`${p.wire}\`: ${p.label}${p.api >= 5 ? ' (API 5)' : ''}`;
}

/** "What it asks for": every declaration a maintainer has to hold the code to. */
export function renderAsks(f: PluginFacts): string {
	const out: string[] = [];
	out.push(
		`${code(f.id)} ${code(f.version || '?')}${f.author ? ` by ${md(f.author.slice(0, 64))}` : ''}, API ${f.api}, script ${code(f.entry)}${f.panel ? '' : ', no panel (selection actions only)'}.`,
	);
	if (!f.listed.length && !f.risky.length && !f.unknown.length) {
		out.push('No permissions: it draws in its own panel and keeps nothing.');
	}
	if (f.listed.length) out.push(`**Applies on install** (listed):\n${f.listed.map((p) => permission(p, false)).join('\n')}`);
	if (f.risky.length) {
		out.push(`**Off until the user grants it** (risky):\n${f.risky.map((p) => permission(p, true)).join('\n')}`);
	}
	if (f.unknown.length) out.push(`**Unknown to this bot**, so the app refuses them or this bot is out of date: ${f.unknown.map(code).join(', ')}`);
	if (f.combinationRisk) {
		const reads = [...f.listed, ...f.risky].filter((p) => p.reads).map((p) => `\`${p.wire}\``);
		const egress = f.risky.filter((p) => p.egress).map((p) => `\`${p.wire}\``);
		out.push(
			`> [!WARNING]\n> It can read what the user has (${reads.join(', ')}) and send data off the phone (${egress.join(', ')}). The app shows its stronger warning for this pair. Check where everything it reads goes.`,
		);
	}
	const facts: string[] = [];
	if (f.hosts.length || f.hostSettings.length) {
		const typed = f.hostSettings.length ? `${f.hosts.length ? ', plus ' : ''}the server the user types in ${f.hostSettings.map(code).join(', ')}` : '';
		facts.push(`**Hosts** \`http\` may reach: ${f.hosts.map(code).join(', ')}${typed}`);
	}
	if (f.providers.length) facts.push(`**Providers:** ${f.providers.map((p) => `${code(`${p.tool}/${p.id}`)}${p.name ? ` ${md(p.name.slice(0, 60))}` : ''}`).join(', ')}`);
	if (f.actions.length) {
		facts.push(
			`**Selection actions:** ${f.actions.map((a) => `${code(a.id)}${a.name ? ` ${md(a.name.slice(0, 40))}` : ''} (${a.input === 'none' ? 'gets no text, ' : ''}${a.replaces ? 'replaces the selection' : 'adds after it'})`).join(', ')}`,
		);
	}
	if (f.keyword) facts.push(`**Keyword:** ${code(`@${f.keyword}`)}${f.chip ? ', with a chip in the suggestion strip while typing' : ''}`);
	if (f.settings.length) facts.push(`**Settings:** ${f.settings.map((s) => `${code(s.key)} (${md(s.type)})${s.label ? ` ${md(s.label.slice(0, 60))}` : ''}`).join(', ')}`);
	const placement = [f.tile ? 'joins the toolbox as a tool' : '', f.float ? 'may open in a floating box' : ''].filter(Boolean);
	if (placement.length) facts.push(`**Placement:** ${placement.join(', ')}`);
	if (f.fileTypes.length || f.fileNames.length) facts.push(`**File types it opens:** ${[...f.fileTypes.map((t) => `.${t}`), ...f.fileNames].map(code).join(', ')}`);
	if (facts.length) out.push(facts.join('  \n'));
	return out.join('\n\n');
}

export interface ReviewLinks {
	repo: string;
	issue: number;
}

/**
 * The review sections: what it asks for, the files, the code and the diff.
 * Code is inlined, one collapsed block per file, while it fits [budget]
 * characters; the rest links to the file on the pending branch.
 */
export function renderReview(r: PluginReview, links: ReviewLinks, budget = 40_000): string[] {
	const out: string[] = ['### What it asks for', renderAsks(r.facts)];

	const table = r.files.map((f) => `| ${code(f.name)} | ${KIND[f.kind]} | ${size(f.size)} |`);
	out.push(`### Files\n\n${r.files.length} files, ${size(r.bytes)} packed.\n\n| File | What | Size |\n|---|---|---|\n${table.join('\n')}`);

	// An update's diff is what a reviewer reads first, so it gets the budget first.
	let left = budget;
	const c = r.changes;
	if (c) {
		const head = [`### Changes since ${md(c.from || 'the published version')}`];
		const notes: string[] = [];
		if (c.newPermissions.length) notes.push(`New permissions: ${c.newPermissions.map((p) => `${p.tier === 'risky' ? '⚠️ ' : ''}\`${p.wire}\``).join(', ')}.`);
		if (c.newHosts.length) notes.push(`New hosts: ${c.newHosts.map(code).join(', ')}.`);
		if (!c.files.length) notes.push('No file changed.');
		else notes.push(`${c.files.length} file${c.files.length === 1 ? '' : 's'} changed: ${c.files.map((f) => `${code(f.name)} (${f.change})`).join(', ')}.`);
		head.push(notes.join(' '));
		if (c.diff) {
			const block = `<details open><summary>Diff, +${c.added} −${c.removed}</summary>\n\n${fence(c.diff, 'diff')}\n</details>`;
			if (block.length <= Math.min(25_000, left)) {
				head.push(block);
				left -= block.length;
			} else {
				head.push(`[The whole diff](${pendingBlob(links.repo, links.issue, DIFF_FILE)}), +${c.added} −${c.removed}: too long to show here.`);
			}
		}
		out.push(head.join('\n\n'));
	}

	const blocks: string[] = [];
	const linked: string[] = [];
	for (const f of r.files) {
		if (f.text === undefined) continue;
		const block = `<details><summary><code>${f.name}</code>, ${linesOf(f.text)}</summary>\n\n${fence(f.text, language(f.name))}\n</details>`;
		if (block.length <= Math.min(15_000, left)) {
			blocks.push(block);
			left -= block.length;
		} else {
			linked.push(`- [${code(f.name)}](${pendingBlob(links.repo, links.issue, `${SOURCE_DIR}/${f.name}`)}), ${linesOf(f.text)}: too long to show here`);
		}
	}
	const pictures = r.files.filter((f) => f.text === undefined).map((f) => `[${code(f.name)}](${pendingBlob(links.repo, links.issue, `${SOURCE_DIR}/${f.name}`)})`);
	const codeParts = [...blocks];
	if (linked.length) codeParts.push(linked.join('\n'));
	if (pictures.length) codeParts.push(`Not text: ${pictures.join(', ')}`);
	out.push('### Code', codeParts.join('\n\n') || 'No text files.');
	return out;
}
