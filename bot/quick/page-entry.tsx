// The page the quick pass screenshots: the store's KeyboardMock, its sticker
// pack preview, and an icon pack sheet of the bot's own, nothing else.
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ICON_SLOT_IDS, ICON_SLOTS } from '@store/lib/icon-slots';
import { readIconPack, readStickerPack } from '@store/lib/payloads';
import { KeyboardMock } from '@store/ui/previews/KeyboardMock';
import { StickerPreview, sanitizeSvg } from '@store/ui/previews/Media';

/** Enough to see what a sticker pack is; a long pack would make a very tall picture. */
const MAX_STICKERS = 24;

declare global {
	interface Window {
		renderMock(spec: unknown, layout: unknown): void;
		renderPack(type: 'icon_pack' | 'stickers', base64: string): void;
	}
}

window.renderMock = (spec, layout) => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	render(<KeyboardMock spec={spec as any} layout={(layout ?? null) as any} interactive={false} />, document.getElementById('root')!);
};

/**
 * Whether a raster icon is a one-colour stencil, which the app paints in the
 * theme's key colour instead of as authored (IconResolver.looksLikeMask in
 * WMKeyboard: same 48-sample stride, same alpha cut). Packs made from Gboard
 * themes are white on transparency; drawn as authored on a white sheet they
 * are invisible, which is what the first icon pack's preview was.
 */
function looksLikeMask(img: HTMLImageElement): boolean {
	const w = img.naturalWidth;
	const h = img.naturalHeight;
	if (!w || !h) return false;
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) return false;
	ctx.drawImage(img, 0, 0);
	const data = ctx.getImageData(0, 0, w, h).data;
	const stride = Math.max(1, Math.floor(Math.max(w, h) / 48));
	let seen = -1;
	for (let y = 0; y < h; y += stride) {
		for (let x = 0; x < w; x += stride) {
			const o = (y * w + x) * 4;
			if (data[o + 3]! < 0x80) continue;
			const rgb = (data[o]! << 16) | (data[o + 1]! << 8) | data[o + 2]!;
			if (seen === -1) seen = rgb;
			else if (seen !== rgb) return false;
		}
	}
	return seen !== -1;
}

/** Marked data-pending until the stencil test has run; run.ts waits for none to be left. */
function RasterIcon({ url }: { url: string }) {
	const [mask, setMask] = useState<boolean | null>(null);
	useEffect(() => {
		const img = new Image();
		img.onload = () => {
			let m = false;
			try {
				m = looksLikeMask(img);
			} catch {
				// Drawn as authored.
			}
			setMask(m);
		};
		img.onerror = () => setMask(false);
		img.src = url;
	}, [url]);
	if (mask === null) return <span class="ip-art" data-pending="" />;
	if (!mask) return <img class="ip-art" src={url} alt="" />;
	const m = `url("${url}") center / contain no-repeat`;
	return <span class="ip-art ip-mask" style={{ WebkitMask: m, mask: m }} />;
}

/**
 * The icons the app will use, as keys on a light and a dark board: what a
 * pack looks like is the point, so no captions, filter chips or slots the
 * app would ignore. The first 40 known slots, in the pack's own order.
 */
const SHOT_ICONS = 40;

function IconSheet({ base64 }: { base64: string }) {
	const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
	const read = readIconPack(bytes, ICON_SLOT_IDS);
	const known = read.icons.filter((i) => i.known);
	const shown = known.slice(0, SHOT_ICONS);
	// A function, not one vnode: preact cannot mount the same vnode twice.
	const grid = () => (
		<div class="ip-grid">
			{shown.map((i) => (
				<div class="ip-key" key={i.slot}>
					{i.url ? <RasterIcon url={i.url} /> : <span class="ip-art ip-svg" dangerouslySetInnerHTML={{ __html: sanitizeSvg(i.svg) }} />}
				</div>
			))}
		</div>
	);
	return (
		<div class="st-pack-shot ip-sheet">
			<div class="ip-head">
				{/* The pack's own name is whatever its editor defaulted to ("My icons (2)"); the issue carries the real one. */}
				<b>{known.length} of {ICON_SLOTS.length} keyboard icons</b>
				{known.length > shown.length && <span>first {shown.length} shown</span>}
			</div>
			<div class="ip-board ip-light">{grid()}</div>
			<div class="ip-board ip-dark">{grid()}</div>
		</div>
	);
}

// Read here rather than in node: the previews draw from blob: URLs, which only
// mean something in the page that made them.
window.renderPack = (type, base64) => {
	const root = document.getElementById('root')!;
	if (type === 'icon_pack') {
		render(<IconSheet base64={base64} />, root);
	} else {
		const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
		const read = readStickerPack(bytes);
		render(<div class="st-pack-shot"><StickerPreview read={{ ...read, stickers: read.stickers.slice(0, MAX_STICKERS) }} /></div>, root);
	}
};
