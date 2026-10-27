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
	'Themes and layouts made by WM Keyboard users, submitted through GitHub issues and checked by a bot before a maintainer publishes them.';
export const DEFAULT_REPO_SLUG = 'wasi-master/wmkeyboard-community-addons';
export const SCHEMA_URL =
	'https://raw.githubusercontent.com/wasi-master/wmkeyboard-addon-repository/main/docs/addons/wmkeyboard-repo.schema.json';
export const STORE_SITE = 'https://wmkeyboard.pages.dev';
export const PENDING_BRANCH = 'pending';

/** The prefix of an encoded payload; the digit is the encoding version. */
export const PAYLOAD_PREFIX = 'wmkb:1:';

export const LICENSES = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0'] as const;
export type License = (typeof LICENSES)[number];

export const ADDON_TYPES = ['theme', 'layout'] as const;
export type AddonType = (typeof ADDON_TYPES)[number];

export interface TypeInfo {
	/** Folder under addons/. */
	dir: string;
	/** Payload file name inside the addon's folder and inside a submitted zip. */
	file: string;
	/** Largest decoded JSON the bot accepts; the app's own install cap. */
	maxBytes: number;
}

const MB = 1024 * 1024;

export const TYPES: Record<AddonType, TypeInfo> = {
	theme: { dir: 'themes', file: 'theme.wmtheme.json', maxBytes: 16 * MB },
	layout: { dir: 'layouts', file: 'layout.wmlayout.json', maxBytes: 4 * MB },
};

/** Limits on the form fields, shown in the form's own descriptions. */
export const LIMITS = {
	name: 60,
	description: 500,
	tags: 8,
	tag: 24,
	/** Largest attached zip the bot downloads. */
	zipBytes: 24 * MB,
	/** Entries in an attached zip; a payload zip holds one file. */
	zipEntries: 16,
	/** An encoded payload longer than a whole issue body is not a real one. */
	encodedChars: 65_536,
};

/** An addon id: lowercase, starts with a letter or digit, 2-48 characters. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/;

/** `based_on`: `<repoId>/<addonId>`, both in the manifest schema's id alphabet. */
export const BASED_ON_PATTERN = /^[A-Za-z0-9._-]{1,128}\/[A-Za-z0-9._-]{1,128}$/;

/** Marks the bot's one sticky comment so both passes edit the same one. */
export const STICKY_MARKER = '<!-- wmkb-community-bot:sticky -->';

/** Marks a maintainer's `/rename`, recorded by the bot so nobody else can forge it. */
export const RENAME_MARKER = 'wmkb-community-bot:rename';

export const LABELS = {
	submission: 'submission',
	rendering: 'rendering',
	ready: 'ready',
	needsFix: 'needs-fix',
	published: 'published',
	rejected: 'rejected',
	type: (t: AddonType) => `type:${t}`,
} as const;
