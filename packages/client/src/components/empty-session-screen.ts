import { type Component, type TuiMouseEvent, type TuiMouseEventResult, visibleWidth } from "@earendil-works/pi-tui";
import { theme } from "../client-theme.ts";
import type { Centered } from "./centered.ts";

/**
 * The empty-session screen: the spinning logo above a greeting and a centered input box, all
 * centered in the screen. The block is centered in the height the caller reports, so it sits in
 * the middle of the screen instead of at the top.
 */
export class EmptySessionScreen implements Component {
	private readonly logo: Component;
	private readonly greeting: string;
	private readonly editor: Centered;
	private readonly availableHeight: () => number;
	private logoLines: string[] = [];
	private editorTop = 0;

	constructor(logo: Component, greeting: string, editor: Centered, availableHeight: () => number) {
		this.logo = logo;
		this.greeting = greeting;
		this.editor = editor;
		this.availableHeight = availableHeight;
	}

	render(width: number): string[] {
		this.logoLines = this.logo.render(width);
		const pad = " ".repeat(Math.max(0, Math.floor((width - visibleWidth(this.greeting)) / 2)));
		const greeting = [theme.fg("muted", `${pad}${this.greeting}`)];
		const editorLines = this.editor.render(width);
		const boxHeight = this.editor.getBoxHeight();
		const boxRows = boxHeight > 0 ? Math.min(boxHeight, editorLines.length) : editorLines.length;
		const available = this.availableHeight();
		const reserve = Math.min(16, Math.floor(available / 3));
		const fixed = greeting.length + 2 + boxRows;
		const logo = this.logoLines.slice(0, Math.max(0, Math.min(this.logoLines.length, available - reserve - fixed)));
		const block = [...logo, "", ...greeting, "", ...editorLines.slice(0, boxRows)];
		const top = Math.max(0, Math.floor((available - reserve - block.length) / 2));
		this.editorTop = top + logo.length + greeting.length + 2;
		const hanging = editorLines.slice(boxRows, boxRows + reserve);
		return [...new Array<string>(top).fill(""), ...block, ...hanging];
	}

	renderOverlayAbove(width: number): string[] {
		return this.editor.renderOverlayAbove(width);
	}

	getOverlayRow(): number {
		return this.editorTop + this.editor.getOverlayRow();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		return this.editor.handleMouse({ ...event, y: event.y - this.editorTop });
	}

	invalidate(): void {
		this.logo.invalidate();
		this.editor.invalidate();
	}
}
