/**
 * A near-duplicate hint for themes: a flag for the maintainer, never a block.
 *
 * Two themes "look the same" when the colours a user sees first are close,
 * slot by slot. A recolour of a published theme is allowed (that is what
 * `based_on` credits); the flag only makes sure someone looks.
 */

/** The slots that decide how a theme reads at a glance. */
export const FINGERPRINT_SLOTS = ['boardBackground', 'keyBackground', 'keyText', 'modifierKeyBackground', 'enterKeyBackground', 'accent'] as const;

export type Fingerprint = Partial<Record<(typeof FINGERPRINT_SLOTS)[number], [number, number, number]>>;

function rgb(v: unknown): [number, number, number] | undefined {
	if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
	const n = v >>> 0;
	return [(n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

export function fingerprint(theme: Record<string, unknown>): Fingerprint {
	const out: Fingerprint = {};
	for (const slot of FINGERPRINT_SLOTS) {
		const c = rgb(theme[slot]);
		if (c) out[slot] = c;
	}
	return out;
}

/** Mean RGB distance over the slots both themes set, or null when too few overlap. */
export function distance(a: Fingerprint, b: Fingerprint): number | null {
	let sum = 0;
	let n = 0;
	for (const slot of FINGERPRINT_SLOTS) {
		const x = a[slot];
		const y = b[slot];
		if (!x || !y) continue;
		sum += Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
		n++;
	}
	return n >= 4 ? sum / n : null;
}

/** Below this mean distance (of 441) two themes are hard to tell apart. */
export const NEAR_DUPLICATE = 18;

export function nearDuplicates(theme: Record<string, unknown>, others: { id: string; theme: Record<string, unknown> }[]): { id: string; distance: number }[] {
	const mine = fingerprint(theme);
	return others
		.map((o) => ({ id: o.id, distance: distance(mine, fingerprint(o.theme)) }))
		.filter((o): o is { id: string; distance: number } => o.distance != null && o.distance < NEAR_DUPLICATE)
		.sort((a, b) => a.distance - b.distance);
}
