/**
 * Cleaning and escaping for the text a submitter typed. Nothing here is
 * about shells (no submitted text ever reaches one); it is about keeping a
 * name from breaking the bot's comment, the README table or a file path.
 */

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g;

/** One line: NFC, no control or direction-override characters, single spaces. */
export function cleanLine(s: string | undefined): string {
	return (s ?? '').normalize('NFC').replace(CONTROL, '').replace(/\s+/g, ' ').trim();
}

/** A paragraph or two: like [cleanLine] but keeps single line breaks. */
export function cleanText(s: string | undefined): string {
	return (s ?? '')
		.normalize('NFC')
		.replace(/\r\n?/g, '\n')
		.replace(CONTROL, '')
		.replace(/[ \t]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** The addon id a name gives: ASCII letters and digits joined by dashes. */
export function slugify(name: string): string {
	return name
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48)
		.replace(/-+$/, '');
}

/**
 * Inline Markdown that renders as the literal text: no links, images, HTML,
 * code spans, table breaks or @-mentions.
 */
export function md(s: string): string {
	return s
		.replace(/[\\`*_{}[\]()#+!|~>]/g, (c) => `\\${c}`)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/@/g, '@​')
		.replace(/\n+/g, ' ');
}

/** True when any blocklisted word or phrase appears as whole words in [s]. */
export function blockedWord(s: string, blocklist: readonly string[]): string | null {
	const hay = ` ${s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ')} `;
	for (const entry of blocklist) {
		const needle = entry.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
		if (needle && hay.includes(` ${needle} `)) return entry;
	}
	return null;
}

/** Lines of a blocklist file, without comments and blanks. */
export function parseBlocklist(text: string): string[] {
	return text
		.split('\n')
		.map((l) => l.replace(/#.*/, '').trim())
		.filter(Boolean);
}
