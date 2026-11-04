// The page the quick pass screenshots: the store's KeyboardMock, and its icon
// and sticker pack previews, and nothing else.
import { render } from 'preact';
import { ICON_SLOT_IDS } from '@store/lib/icon-slots';
import { readIconPack, readStickerPack } from '@store/lib/payloads';
import { KeyboardMock } from '@store/ui/previews/KeyboardMock';
import { IconPackPreview, StickerPreview } from '@store/ui/previews/Media';

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

// Read here rather than in node: the previews draw from blob: URLs, which only
// mean something in the page that made them.
window.renderPack = (type, base64) => {
	const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
	const root = document.getElementById('root')!;
	if (type === 'icon_pack') {
		render(<div class="st-pack-shot"><IconPackPreview read={readIconPack(bytes, ICON_SLOT_IDS)} /></div>, root);
	} else {
		const read = readStickerPack(bytes);
		render(<div class="st-pack-shot"><StickerPreview read={{ ...read, stickers: read.stickers.slice(0, MAX_STICKERS) }} /></div>, root);
	}
};
