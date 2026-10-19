import type { Component } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

/** Braille dots frames, the same set the TUI spinner uses. */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_INTERVAL_MS = 80;
/** The sign and the space behind it. */
const SIGN_WIDTH = 2;

/** The braille frame for a point in time. */
export function spinnerFrame(now: number): string {
	return SPINNER_FRAMES[Math.floor(now / FRAME_INTERVAL_MS) % SPINNER_FRAMES.length]!;
}

/**
 * A component with an animated braille sign in front of it.
 *
 * The frame comes from the clock at render time, so the sign moves with the terminal's redraws
 * and needs no timer of its own. That matters for rows that are rebuilt on every stream chunk:
 * a timer-owning sign would be recreated constantly and leave intervals behind.
 */
export class SignedRow implements Component {
	private readonly child: Component;

	constructor(child: Component) {
		this.child = child;
	}

	render(width: number): string[] {
		const sign = theme.fg("accent", spinnerFrame(Date.now()));
		const lines = this.child.render(Math.max(1, width - SIGN_WIDTH));
		return lines.map((line, index) => (index === 0 ? `${sign} ${line}` : `  ${line}`));
	}

	invalidate(): void {
		this.child.invalidate();
	}
}
