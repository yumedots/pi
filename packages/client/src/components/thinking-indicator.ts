import { Text } from "@earendil-works/pi-tui";
import { theme } from "../client-theme.ts";
import { spinnerFrame } from "./spinner-sign.ts";

/**
 * Collapsed thinking label with a braille sign in front of it.
 *
 * While the message streams, the sign advances with the terminal's redraws: the frame comes from
 * the clock, so the label needs no timer of its own and cannot leak one when the message is
 * rebuilt. A finished message keeps the first frame.
 */
export class ThinkingIndicator extends Text {
	private readonly label: string;
	private readonly spinning: boolean;
	private readonly now: () => number;

	constructor(label: string, outputPad: number, spinning: boolean, now: () => number = Date.now) {
		super("", outputPad, 0);
		this.label = label;
		this.spinning = spinning;
		this.now = now;
	}

	override render(width: number): string[] {
		const frame = this.spinning ? spinnerFrame(this.now()) : spinnerFrame(0);
		this.setText(`${theme.fg("accent", frame)} ${theme.italic(theme.fg("thinkingText", this.label))}`);
		return super.render(width);
	}
}
