/** Plumbing shared by the CLI entry points the workflows run. */
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADDON_TYPES, ID_PATTERN, type AddonType } from '../constants.ts';

/** The repository root: bot/src/cli → ../../.. */
export const REPO_ROOT = resolve(process.env.REPO_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'));

export function env(name: string): string {
	const v = process.env[name];
	if (!v) throw new Error(`${name} is not set`);
	return v;
}

export function issueNumber(raw: string | undefined): number {
	if (!raw || !/^\d{1,9}$/.test(raw)) throw new Error(`not an issue number: ${JSON.stringify(raw)}`);
	return Number(raw);
}

export function checkedId(raw: unknown): string {
	if (typeof raw !== 'string' || !ID_PATTERN.test(raw)) throw new Error(`not an addon id: ${JSON.stringify(raw)}`);
	return raw;
}

export function checkedType(raw: unknown): AddonType {
	if (!(ADDON_TYPES as readonly unknown[]).includes(raw)) throw new Error(`not an addon type: ${JSON.stringify(raw)}`);
	return raw as AddonType;
}

/**
 * Step outputs. Values are restricted to a safe alphabet, so nothing a
 * submitter typed can reach a later step's expression through here.
 */
export function output(values: Record<string, string | number | boolean>): void {
	const file = process.env.GITHUB_OUTPUT;
	const lines = Object.entries(values).map(([k, v]) => {
		const s = String(v);
		if (!/^[A-Za-z0-9._:/-]*$/.test(s) || s.includes('..')) throw new Error(`refusing unsafe output ${k}=${JSON.stringify(s)}`);
		return `${k}=${s}`;
	});
	if (file) appendFileSync(file, lines.join('\n') + '\n');
	else console.log(lines.join('\n'));
}

export function readEvent<T>(): T {
	return JSON.parse(readFileSync(env('GITHUB_EVENT_PATH'), 'utf8')) as T;
}

export function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function main(fn: () => Promise<void>): void {
	fn().catch((e) => {
		console.error(e instanceof Error ? e.stack : e);
		process.exit(1);
	});
}
