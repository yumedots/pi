/**
 * A piece of the terminal UI the server drew.
 *
 * The extensions live in the server, so it draws what they draw: the header, the
 * footer, the widgets and the custom dialogs. The client shows the lines and takes
 * the key that closes the piece.
 */

import { Container, type Focusable, Text } from "@earendil-works/pi-tui";

/**
 * The lines of a piece the server drew, in the slot of the editor.
 */
export class ServerDrawnComponent extends Container implements Focusable {
	focused = false;
	private readonly onClose: () => void;

	/**
	 * @param lines The lines the server drew.
	 * @param onClose Called when the user closes the piece.
	 */
	constructor(lines: readonly string[], onClose: () => void) {
		super();
		this.onClose = onClose;
		for (const line of lines) {
			this.addChild(new Text(line, 0, 0));
		}
	}

	focus(): void {
		this.focused = true;
	}

	blur(): void {
		this.focused = false;
	}

	handleInput(): void {
		this.onClose();
	}
}
