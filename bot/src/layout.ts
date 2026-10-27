/**
 * Turns whatever layout shape was submitted into the one file the app
 * installs: a `wmkeyboard-layout` envelope.
 *
 * Two repairs, both what used to be done by hand for community layouts:
 * a single copied layer (`wmkeyboard-layer`, the layout editor's clipboard
 * format) is wrapped into a layout whose letters layer it becomes, and every
 * `themeId` is dropped, because it names a theme on the submitter's phone that
 * nobody installing the layout has.
 */
import type { Classified } from './payload.ts';

export interface NormalisedLayout {
	envelope: Record<string, unknown>;
	warnings: string[];
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

export function normaliseLayout(input: Extract<Classified, { type: 'layout' }>, id: string, name: string): NormalisedLayout {
	const warnings: string[] = [];
	let envelope: Json;
	if (input.shape === 'layer') {
		const spec = input.json.spec;
		if (!isObject(spec)) throw new Error('The copied layer has no "spec".');
		const from = typeof input.json.layer === 'string' ? input.json.layer : '';
		envelope = {
			format: 'wmkeyboard-layout',
			version: 1,
			...pick(input.json, ['appVersion', 'appVersionName']),
			layout: { id, name, layers: { letters: { ...spec } } },
		};
		warnings.push(
			from && from !== 'letters'
				? `A single layer copied from "${from}" became the letters layer of a new layout. The other layers use WM Keyboard's defaults.`
				: 'A single copied layer became the letters layer of a new layout. The other layers use WM Keyboard\'s defaults.',
		);
	} else if (input.shape === 'bare') {
		envelope = { format: 'wmkeyboard-layout', version: 1, layout: { ...input.json } };
		warnings.push('The layout had no file envelope; the bot added one.');
	} else {
		envelope = { ...input.json };
		if (!isObject(envelope.layout)) throw new Error('"layout" is missing from the layout file.');
		envelope.layout = { ...envelope.layout };
	}
	const layout = envelope.layout as Json;
	let dropped = false;
	if ('themeId' in layout) {
		dropped ||= layout.themeId != null;
		delete layout.themeId;
	}
	if (isObject(layout.layers)) {
		const layers: Json = {};
		for (const [key, layer] of Object.entries(layout.layers)) {
			if (isObject(layer) && 'themeId' in layer) {
				const { themeId, ...rest } = layer;
				dropped ||= themeId != null;
				layers[key] = rest;
			} else {
				layers[key] = layer;
			}
		}
		layout.layers = layers;
	}
	if (dropped) warnings.push('The layout named a theme from your phone; that link was removed, so it uses whichever theme the person installing it has.');
	return { envelope, warnings };
}

function pick(o: Json, keys: string[]): Json {
	const out: Json = {};
	for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
	return out;
}
