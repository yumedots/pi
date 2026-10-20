import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";
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
		const greeting = [theme.fg("muted", this.greeting)];
		const editorLines = this.editor.render(width);
		const content = [...this.logoLines, "", ...greeting, "", ...editorLines];
		const height = Math.max(content.length, this.availableHeight());
		const top = Math.max(0, Math.floor((height - content.length) / 2));
		this.editorTop = top + this.logoLines.length + greeting.length + 2;
		return [...new Array<string>(top).fill(""), ...content];
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
