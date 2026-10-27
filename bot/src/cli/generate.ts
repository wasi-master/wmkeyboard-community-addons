/**
 * Regenerates wmkeyboard-repo.json and README.md from addons/*\/*\/meta.json.
 *
 *   tsx src/cli/generate.ts           rewrite both
 *   tsx src/cli/generate.ts --check   exit 1 if either is stale (CI)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_REPO_SLUG } from '../constants.ts';
import { buildManifest, buildReadme, manifestText } from '../manifest.ts';
import { readPublished } from '../repo.ts';
import { main, REPO_ROOT } from './io.ts';

main(async () => {
	const check = process.argv.includes('--check');
	const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO_SLUG;
	const published = readPublished(REPO_ROOT);
	const files = {
		'wmkeyboard-repo.json': manifestText(buildManifest(REPO_ROOT, published, repo)),
		'README.md': buildReadme(published, repo),
	};
	let stale = false;
	for (const [name, text] of Object.entries(files)) {
		const path = join(REPO_ROOT, name);
		const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
		if (current === text) continue;
		stale = true;
		if (check) console.error(`${name} is stale: run npm run generate in bot/`);
		else writeFileSync(path, text);
	}
	console.log(`${published.length} addons${stale ? (check ? ', stale' : ', regenerated') : ', up to date'}`);
	if (check && stale) process.exit(1);
});
