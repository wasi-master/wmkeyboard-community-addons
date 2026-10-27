// The page the quick pass screenshots: the store's KeyboardMock and nothing else.
import { render } from 'preact';
import { KeyboardMock } from '@store/ui/previews/KeyboardMock';

declare global {
	interface Window {
		renderMock(spec: unknown, layout: unknown): void;
	}
}

window.renderMock = (spec, layout) => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	render(<KeyboardMock spec={spec as any} layout={(layout ?? null) as any} interactive={false} />, document.getElementById('root')!);
};
