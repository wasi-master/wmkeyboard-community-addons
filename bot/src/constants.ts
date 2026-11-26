/**
 * Fixed values the bot, the app and the web store agree on. Anything here that
 * reaches a phone (the repo id, the folder layout, the payload prefix) is a
 * contract: change it and installed addons stop matching their repository.
 */

/** The install key is `<REPO_ID>/<addonId>`. Never change it. */
export const REPO_ID = 'com.wasimaster.wmkeyboard.community';

/**
 * Repo id of the one-addon manifests on the `pending` branch. Different from
 * [REPO_ID] on purpose: a try-before-approval install must not look like the
 * published addon, whose payload may still change before it goes live.
 */
export const PENDING_REPO_ID = `${REPO_ID}.pending`;

export const REPO_NAME = 'WM Keyboard Community';
export const REPO_DESCRIPTION =
	'Themes, layouts, icon packs, sticker packs, sound packs, snippets and plugins made by WM Keyboard users, submitted through GitHub issues and checked by a bot before a maintainer publishes them.';
export const DEFAULT_REPO_SLUG = 'wasi-master/wmkeyboard-community-addons';
export const SCHEMA_URL =
	'https://raw.githubusercontent.com/wasi-master/wmkeyboard-addon-repository/main/docs/addons/wmkeyboard-repo.schema.json';
export const STORE_SITE = 'https://wmkeyboard.pages.dev';
/**
 * The docs site's /open/ page. The app claims it as an App Link, so on a phone
 * with WM Keyboard a link to it opens the screen it names; anywhere else the
 * page loads and offers an "Open in WM Keyboard" button.
 */
export const OPEN_PAGE = 'https://wmkeyboard.app/open/';
/** The "Add repository to WM Keyboard" badge, drawn to the size of the store badges. */
export const ADD_REPO_BADGE = 'https://wmkeyboard.app/badges/add-repository.png';
export const PENDING_BRANCH = 'pending';

/** The prefix of an encoded payload; the digit is the encoding version. */
export const PAYLOAD_PREFIX = 'wmkb:1:';

/** The licences the forms for pictures, layouts and text offer. */
export const LICENSES = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0'] as const;

/**
 * The licences the plugin form offers: SPDX ids of code licences. Creative
 * Commons licences other than CC0 are not meant for code, so they are not
 * offered for plugins.
 */
export const CODE_LICENSES = [
	'MIT',
	'Apache-2.0',
	'BSD-2-Clause',
	'BSD-3-Clause',
	'ISC',
	'MPL-2.0',
	'LGPL-3.0-or-later',
	'GPL-3.0-or-later',
	'AGPL-3.0-or-later',
	'Unlicense',
	'CC0-1.0',
] as const;

export type License = (typeof LICENSES)[number] | (typeof CODE_LICENSES)[number];

/** The licences the form for [type] offers. */
export function licensesFor(type: AddonType | null): readonly License[] {
	return type === 'plugin' ? CODE_LICENSES : LICENSES;
}

/**
 * The addon types the repository takes, in the order the manifest and README
 * list them. New types go on the end, so a published manifest keeps its bytes.
 * Wire names are the app's `AddonType` serial names.
 */
export const ADDON_TYPES = ['theme', 'layout', 'icon_pack', 'stickers', 'sound_pack', 'snippets', 'plugin'] as const;
export type AddonType = (typeof ADDON_TYPES)[number];

export interface TypeInfo {
	/** Folder under addons/. */
	dir: string;
	/** Payload file name inside the addon's folder and inside a submitted zip. */
	file: string;
	/**
	 * Largest payload the bot accepts: the app's own install cap, or the
	 * attachment cap where that is lower.
	 */
	maxBytes: number;
	/** A zip archive of its own (pack.json or plugin.json + files) rather than one JSON document. */
	binary: boolean;
	/** `format` in the JSON document, or in a binary type's `pack.json` (a plugin's `plugin.json`). */
	format: string;
	/** Singular, lowercase, for sentences: "This is a sticker pack". */
	noun: string;
	/** README section heading. */
	title: string;
	/** The issue form in .github/ISSUE_TEMPLATE. */
	template: string;
}

const MB = 1024 * 1024;

export const TYPES: Record<AddonType, TypeInfo> = {
	theme: { dir: 'themes', file: 'theme.wmtheme.json', maxBytes: 16 * MB, binary: false, format: '', noun: 'theme', title: 'Themes', template: 'submit-theme.yml' },
	layout: { dir: 'layouts', file: 'layout.wmlayout.json', maxBytes: 4 * MB, binary: false, format: 'wmkeyboard-layout', noun: 'layout', title: 'Layouts', template: 'submit-layout.yml' },
	icon_pack: { dir: 'icon-packs', file: 'pack.wmicons', maxBytes: 8 * MB, binary: true, format: 'wmkeyboard-icons', noun: 'icon pack', title: 'Icon packs', template: 'submit-icon-pack.yml' },
	// The app installs up to 64 MB; an issue attachment stops at 24.
	stickers: { dir: 'stickers', file: 'pack.wmstickers', maxBytes: 24 * MB, binary: true, format: 'wmkeyboard-stickers', noun: 'sticker pack', title: 'Sticker packs', template: 'submit-stickers.yml' },
	sound_pack: { dir: 'sound-packs', file: 'pack.wmsoundpack', maxBytes: 16 * MB, binary: true, format: 'wmkeyboard-sound-pack', noun: 'sound pack', title: 'Sound packs', template: 'submit-sound-pack.yml' },
	snippets: { dir: 'snippets', file: 'snippets.wmsnippets.json', maxBytes: 4 * MB, binary: false, format: 'wmkeyboard-snippets', noun: 'snippet pack', title: 'Snippets', template: 'submit-snippets.yml' },
	// The app downloads at most 1 MB for a plugin (AddonType.Plugin.maxBytes),
	// though it unpacks up to 4 MB from that.
	plugin: { dir: 'plugins', file: 'plugin.wmplugin', maxBytes: 1 * MB, binary: true, format: 'wmkeyboard-plugin', noun: 'plugin', title: 'Plugins', template: 'submit-plugin.yml' },
};

/**
 * Types the full (JVM) pass is run for, unless the FULL_RENDER_TYPES
 * repository variable says otherwise. A WM Keyboard release whose AddonShots
 * predates a type refuses it as unknown, so a type joins this list once the
 * release the bot checks against draws it.
 */
export const DEFAULT_FULL_RENDER_TYPES = 'theme,layout';

export function fullRenderTypes(value = process.env.FULL_RENDER_TYPES): Set<string> {
	return new Set((value || DEFAULT_FULL_RENDER_TYPES).split(',').map((t) => t.trim()).filter(Boolean));
}

/** Limits on the form fields, shown in the form's own descriptions. */
export const LIMITS = {
	name: 60,
	description: 500,
	tags: 8,
	tag: 24,
	/** Largest attached zip the bot downloads. */
	zipBytes: 24 * MB,
	/** Entries in an attached zip that wraps one addon file. */
	zipEntries: 16,
	/** Entries in an icon, sticker or sound pack: the most any of the app's importers reads. */
	archiveEntries: 1024,
	/** A pack's pack.json; the app reads at most 256 KB of it. */
	packManifestBytes: 256 * 1024,
	/** An encoded payload longer than a whole issue body is not a real one. */
	encodedChars: 65_536,
	/** A .wmplugin, as PluginFile reads it: entries, unpacked total, plugin.json, one module, one asset. */
	pluginEntries: 64,
	pluginTotalBytes: 4 * MB,
	pluginManifestBytes: 64 * 1024,
	pluginModuleBytes: 256 * 1024,
	pluginAssetBytes: 512 * 1024,
	pluginLocaleBytes: 64 * 1024,
};

/** An addon id: lowercase, starts with a letter or digit, 2-48 characters. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/;

/** `based_on`: `<repoId>/<addonId>`, both in the manifest schema's id alphabet. */
export const BASED_ON_PATTERN = /^[A-Za-z0-9._-]{1,128}\/[A-Za-z0-9._-]{1,128}$/;

/** Marks the bot's one sticky comment so both passes edit the same one. */
export const STICKY_MARKER = '<!-- wmkb-community-bot:sticky -->';

/**
 * Opens an issue body that a tool filed through the REST API rather than the
 * form (`wmpy publish`): `<!-- wmkb-submit:plugin -->`. The API drops the
 * labels a submitter without push access asks for, so the form's
 * `submission` and `type:…` labels never arrive; the bot adds them itself when
 * a body carries this line and reads as a form. Never trusted for anything
 * else: the body is checked like any other.
 */
export const SUBMIT_MARKER = /^<!-- wmkb-submit:([a-z_]+) -->/;

export function submitMarker(type: AddonType): string {
	return `<!-- wmkb-submit:${type} -->`;
}

/** Marks a maintainer's `/rename`, recorded by the bot so nobody else can forge it. */
export const RENAME_MARKER = 'wmkb-community-bot:rename';

export const LABELS = {
	submission: 'submission',
	rendering: 'rendering',
	ready: 'ready',
	needsFix: 'needs-fix',
	published: 'published',
	rejected: 'rejected',
	/** A plugin that declares a permission the user has to grant: a maintainer reads its code with that in mind. */
	risky: 'risky-permissions',
	type: (t: AddonType) => `type:${t}`,
} as const;
