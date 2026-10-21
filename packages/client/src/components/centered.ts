import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";

/**
 * Renders a child at a fixed maximum width, centered in the available width.
 * The child's overlay and mouse events are forwarded with the coordinates translated
 * into the child's own box.
 */
export class Centered implements Component {
	private readonly child: Component;
	private readonly maxWidth: number;
	private renderedHeight = 0;

	constructor(child: Component, maxWidth: number) {
		this.child = child;
		this.maxWidth = maxWidth;
	}

	/** Width the child is rendered at. */
	innerWidth(width: number): number {
		return Math.max(1, Math.min(width, this.maxWidth));
	}

	/** Empty columns in front of the child. */
	padLeft(width: number): number {
		return Math.floor((width - this.innerWidth(width)) / 2);
	}

	render(width: number): string[] {
		const inner = this.innerWidth(width);
		const pad = " ".repeat(this.padLeft(width));
		const lines = this.child.render(inner).map((line) => pad + line);
		this.renderedHeight = lines.length;
		return lines;
	}

	getBoxHeight(): number {
		return this.child.getBoxHeight?.() ?? this.renderedHeight;
	}

	renderOverlayAbove(width: number): string[] {
		return this.child.renderOverlayAbove?.(this.innerWidth(width)) ?? [];
	}

	getOverlayRow(): number {
		return this.child.getOverlayRow?.() ?? 0;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const result = this.child.handleMouse?.({
			...event,
			x: event.x - this.padLeft(event.width),
			width: this.innerWidth(event.width),
		});
		// The child owns the keyboard focus, so a click must not move it to this wrapper.
		return result ? { ...result, focus: false } : undefined;
	}

	invalidate(): void {
		this.child.invalidate();
	}
}
