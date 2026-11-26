/**
 * The plugin job of submission.yml: unpack the plugin and run `wmpy check`
 * and `wmpy test` on it. Runs submitted code (the tests, in wm-python's
 * sandbox), so its job holds no write permission and no token, and what it
 * writes is only a report the stage job reads.
 *
 * Env: RENDER_DIR (request.json + plugin.wmplugin from the parse job),
 * OUT_DIR (report.json and wmpy.json for the stage job), WMPY (the binary;
 * `wmpy` on PATH when unset).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TYPES } from '../constants.ts';
import { readPluginArchive } from '../plugin.ts';
import { checkWithWmpy, hasTests, spawnRunner, unpackPlugin, writeReports } from '../wmpy.ts';
import { checkedId, checkedType, env, main } from './io.ts';

main(async () => {
	const input = resolve(env('RENDER_DIR'));
	const out = resolve(env('OUT_DIR'));
	const request = JSON.parse(readFileSync(join(input, 'request.json'), 'utf8')) as { type: unknown; id: unknown; file: unknown };
	const type = checkedType(request.type);
	checkedId(request.id);
	if (type !== 'plugin' || request.file !== TYPES.plugin.file) throw new Error('request.json is not for a plugin');
	const archive = readPluginArchive(readFileSync(join(input, TYPES.plugin.file)));

	const dir = mkdtempSync(join(tmpdir(), 'plugin-'));
	try {
		unpackPlugin(archive, dir);
		const report = checkWithWmpy(dir, hasTests(archive), spawnRunner(process.env.WMPY || 'wmpy'));
		writeReports(out, report);
		console.log(JSON.stringify(report, null, 2));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
