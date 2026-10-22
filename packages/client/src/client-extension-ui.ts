/**
 * The dialogs of the extensions.
 *
 * The extensions live in the server: it loads them and it draws what they draw. The
 * client draws the transcript, and it shows the dialogs the server asks for.
 *
 * The context is the client's own: only the parts that travel over the wire are here.
 * A part that needs a terminal component (a custom header, a custom editor) cannot
 * travel, so the server draws it and sends the lines.
 */

import type { ExtensionUIDialogOptions } from "@earendil-works/pi-coding-agent/core/extensions/types";

/** Where a widget sits. */
export type ClientWidgetPlacement = "above" | "below";

/** The options of a widget. */
export interface ClientWidgetOptions {
	/** Where the widget sits. */
	placement?: ClientWidgetPlacement;
}

/** The frames of the working row. */
export interface ClientWorkingIndicatorOptions {
	/** The frames of the row. An empty array hides the row. */
	frames?: string[];
	/** How long a frame shows, in milliseconds. */
	intervalMs?: number;
}

/** The dialogs and the widgets the server drives. */
export interface ClientExtensionUIContext {
	/** Show a selector and return the choice of the user. */
	select(title: string, options: string[], opts?: ExtensionUIDialogOptions): Promise<string | undefined>;

	/** Show a confirmation and return the answer of the user. */
	confirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean>;

	/** Show a text input and return the text of the user. */
	input(title: string, placeholder?: string, opts?: ExtensionUIDialogOptions): Promise<string | undefined>;

	/** Show a notification. */
	notify(message: string, type?: "info" | "warning" | "error"): void;

	/** Listen to the raw terminal input. */
	onTerminalInput(handler: (data: string) => { consume?: boolean; data?: string } | undefined): () => void;

	/** Set the status text of the footer. */
	setStatus(key: string, text: string | undefined): void;

	/** Set the message of the working row. */
	setWorkingMessage(message?: string): void;

	/** Show or hide the working row. */
	setWorkingVisible(visible: boolean): void;

	/** Set the frames of the working row. */
	setWorkingIndicator(options?: ClientWorkingIndicatorOptions): void;

	/** Set the label of the hidden thinking blocks. */
	setHiddenThinkingLabel(label?: string): void;

	/** Set the lines of a widget above or below the editor. */
	setWidget(key: string, content: string[] | undefined, options?: ClientWidgetOptions): void;

	/** Set the title of the terminal. */
	setTitle(title: string): void;

	/** Put the text in the editor as if it was pasted. */
	pasteToEditor(text: string): void;

	/** Replace the text of the editor. */
	setEditorText(text: string): void;

	/** The text of the editor. */
	getEditorText(): string;

	/** Show an editor and return the text of the user. */
	editor(title: string, prefill?: string): Promise<string | undefined>;

	/**
	 * The server drew a new header or a new footer.
	 *
	 * The extensions live in the server, so it draws them. The client asks for the lines
	 * and draws them.
	 */
	extensionChromeChanged(): void;

	/**
	 * The server drew a custom dialog.
	 *
	 * The extensions live in the server, so it draws the dialog. The client shows the
	 * lines.
	 */
	extensionCustomDialog(): void;
}
