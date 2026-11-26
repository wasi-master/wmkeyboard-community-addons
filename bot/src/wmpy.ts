/**
 * Running `wmpy check --json` and `wmpy test --json` on a submitted plugin,
 * the same checks the plugin's author ran before sending it. Used by
 * cli/wmpy.ts in a job with no write permission, because `wmpy test` runs
 * the submitted code (in wm-python's sandbox, as the keyboard would).
 *
 * The command is injected as a [Runner], so `npm test` needs no wmpy: the
 * tests hand in a fake that answers as wmpy does.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { QuickReport } from './comment.ts';
import type { PluginArchive, WmpyProblem, WmpyReport } from './plugin.ts';

export interface RunResult {
	/** Null when the process was killed or never started. */
	code: number | null;
	stdout: string;
	stderr: string;
}

export type Runner = (args: string[], timeoutMs: number) => RunResult;

/** Runs [binary] with no shell, a timeout and a cap on what it may print. */
export function spawnRunner(binary: string): Runner {
	return (args, timeoutMs) => {
		const r = spawnSync(binary, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NO_COLOR: '1' } });
		return { code: r.error ? null : r.status, stdout: r.stdout ?? '', stderr: r.error ? String(r.error.message) : (r.stderr ?? '') };
	};
}

/**
 * Writes the plugin's files into [dir]. Names were already checked by
 * readPluginArchive to be plain relative paths; each is checked again to land
 * inside [dir] before anything is written.
 */
export function unpackPlugin(archive: PluginArchive, dir: string): void {
	const root = resolve(dir);
	mkdirSync(root, { recursive: true });
	for (const f of archive.files) {
		const target = resolve(root, f.name);
		if (!target.startsWith(root + sep)) throw new Error(`refusing to unpack ${f.name} outside the plugin folder`);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, f.bytes);
	}
}

export function hasTests(archive: PluginArchive): boolean {
	return archive.files.some((f) => f.kind === 'test');
}

function json(text: string): Record<string, unknown> | null {
	try {
		const v = JSON.parse(text.trim()) as unknown;
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** One Diag as wmpy writes it, read loosely: the field names may grow. */
function problem(raw: unknown): WmpyProblem | null {
	if (!raw || typeof raw !== 'object') return null;
	const d = raw as Record<string, unknown>;
	const s = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : undefined);
	const message = s('message');
	if (!message) return null;
	const line = typeof d.line === 'number' ? d.line : undefined;
	const col = typeof d.col === 'number' ? d.col : typeof d.column === 'number' ? d.column : undefined;
	return {
		severity: s('severity') ?? s('level') ?? 'error',
		message: message.slice(0, 500),
		...(s('code') ? { code: s('code')! } : {}),
		...(s('file') ? { file: s('file')! } : {}),
		...(line !== undefined ? { line } : {}),
		...(col !== undefined ? { col } : {}),
	};
}

const problems = (v: unknown): WmpyProblem[] => (Array.isArray(v) ? v.map(problem).filter((p): p is WmpyProblem => !!p).slice(0, 50) : []);

function firstLine(s: string): string {
	return s.trim().split('\n')[0]?.slice(0, 300) ?? '';
}

/** Ten minutes for the tests, as `wmpy test`'s own budget; check is quick. */
export const TIMEOUTS = { version: 30_000, check: 120_000, test: 11 * 60_000 };

/** `wmpy check --json` and, when the plugin has tests, `wmpy test --json`, on the unpacked folder [dir]. */
export function checkWithWmpy(dir: string, withTests: boolean, run: Runner): WmpyReport {
	const version = run(['--version'], TIMEOUTS.version);
	if (version.code !== 0) return { error: `\`wmpy --version\` failed: ${firstLine(version.stderr) || 'no output'}`, check: null, test: null };
	const report: WmpyReport = { version: firstLine(version.stdout), check: null, test: null };

	const check = run(['check', '--json', dir], TIMEOUTS.check);
	const c = json(check.stdout);
	if (!c || check.code === null || check.code === 2) {
		return { ...report, error: `\`wmpy check\` gave no verdict (exit ${check.code ?? 'killed'}): ${firstLine(check.stderr) || firstLine(check.stdout) || 'no output'}` };
	}
	report.check = { ok: c.ok === true && check.code === 0, errors: num(c.errors), warnings: num(c.warnings), problems: problems(c.problems) };

	if (withTests) {
		const test = run(['test', '--json', dir], TIMEOUTS.test);
		const t = json(test.stdout);
		if (test.code === null) {
			report.test = { ok: false, passed: 0, failed: 1, problems: [{ severity: 'error', message: `The tests ran past ${TIMEOUTS.test / 60_000} minutes and were stopped.` }] };
		} else if (!t) {
			report.test = {
				ok: false,
				passed: 0,
				failed: 1,
				problems: [{ severity: 'error', message: firstLine(test.stderr) || `wmpy test exited ${test.code} without a report` }],
			};
		} else {
			const failures = [...problems(t.problems), ...problems(t.failures), ...problems(t.errors)];
			report.test = { ok: t.ok === true && test.code === 0, passed: num(t.passed), failed: num(t.failed), problems: failures };
		}
	}
	return report;
}

/** The report.json the stage job reads for every type: here, wmpy's verdict. */
export function quickReport(report: WmpyReport): QuickReport {
	const problemsOut: string[] = [];
	// Warnings are on the comment's "wmpy check" line already.
	const notes: string[] = [];
	if (report.error) problemsOut.push(`wmpy could not run: ${report.error}`);
	if (report.check && !report.check.ok) problemsOut.push(`wmpy check found ${report.check.errors || 'some'} error${report.check.errors === 1 ? '' : 's'}.`);
	if (report.test && !report.test.ok) problemsOut.push(`wmpy test: ${report.test.failed || 'some'} failed.`);
	return { ok: !problemsOut.length && !!report.check, problems: problemsOut, notes, images: [] };
}

export function writeReports(out: string, report: WmpyReport): void {
	mkdirSync(out, { recursive: true });
	writeFileSync(join(out, 'wmpy.json'), JSON.stringify(report, null, 2) + '\n');
	writeFileSync(join(out, 'report.json'), JSON.stringify(quickReport(report), null, 2) + '\n');
}
