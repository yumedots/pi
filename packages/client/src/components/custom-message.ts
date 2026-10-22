import type { TextContent } from "@earendil-works/pi-ai";
import type { MessageRenderer } from "@earendil-works/pi-coding-agent/core/extensions/types";
import type { CustomMessage } from "@earendil-works/pi-coding-agent/core/messages";
import type { Component } from "@earendil-works/pi-tui";
import { Box, Container, Markdown, type MarkdownTheme, Spacer, Text } from "@earendil-works/pi-tui";
import { getMarkdownTheme, theme } from "../client-theme.ts";
import { getServerRenderProvider } from "../session-facade.ts";

/**
 * Component that renders a custom message entry from extensions.
 * Uses distinct styling to differentiate from user messages.
 *
 * A message of an extension that lives in the server's process is drawn by the server: the
 * renderer runs there, so the client asks for the lines and shows them.
 */
export class CustomMessageComponent extends Container {
	private message: CustomMessage<unknown>;
	private customRenderer?: MessageRenderer;
	private box: Box;
	private customComponent?: Component;
	private markdownTheme: MarkdownTheme;
	private _expanded = false;
	private outputPad: number;
	/** The lines the server rendered for this message. */
	private serverLines?: string[];
	/** Whether the server rendering was asked for already. */
	private serverRequested = false;
	/** Asks the terminal to redraw, so an answer that arrives late shows up. */
	private readonly requestRender?: () => void;

	constructor(
		message: CustomMessage<unknown>,
		customRenderer?: MessageRenderer,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		outputPad = 1,
		requestRender?: () => void,
	) {
		super();
		this.message = message;
		this.customRenderer = customRenderer;
		this.markdownTheme = markdownTheme;
		this.outputPad = outputPad;
		this.requestRender = requestRender;

		this.addChild(new Spacer(1));

		// Create box with purple background (used for default rendering)
		this.box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));

		this.rebuild();
	}

	setExpanded(expanded: boolean): void {
		if (this._expanded !== expanded) {
			this._expanded = expanded;
			this.rebuild();
		}
	}

	setOutputPad(outputPad: number): void {
		if (this.outputPad !== outputPad) {
			this.outputPad = outputPad;
			this.rebuild();
		}
	}

	override invalidate(): void {
		super.invalidate();
		this.rebuild();
	}

	private rebuild(): void {
		// Remove previous content component
		if (this.customComponent) {
			this.removeChild(this.customComponent);
			this.customComponent = undefined;
		}
		this.removeChild(this.box);

		// Try custom renderer first - it handles its own styling
		if (this.customRenderer) {
			try {
				const component = this.customRenderer(
					this.message,
					{ expanded: this._expanded, outputPad: this.outputPad },
					theme as never,
				);
				if (component) {
					// Custom renderer provides its own styled component
					this.customComponent = component;
					this.addChild(component);
					return;
				}
			} catch {
				// Fall through to default rendering
			}
		}

		// The client has no renderer for this custom type: the server may have one.
		this.requestServerRender();
		if (this.serverLines) {
			this.customComponent = new Text(this.serverLines.join("\n"), 0, 0);
			this.addChild(this.customComponent);
			return;
		}

		// Default rendering uses our box
		this.addChild(this.box);
		this.box.clear();
		this.box.setPaddingX(this.outputPad);

		// Default rendering: label + content
		const label = theme.fg("customMessageLabel", `\x1b[1m[${this.message.customType}]\x1b[22m`);
		this.box.addChild(new Text(label, 0, 0));
		this.box.addChild(new Spacer(1));

		// Extract text content
		let text: string;
		if (typeof this.message.content === "string") {
			text = this.message.content;
		} else {
			text = this.message.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("\n");
		}

		this.box.addChild(
			new Markdown(text, 0, 0, this.markdownTheme, {
				color: (text: string) => theme.fg("customMessageText", text),
			}),
		);
	}

	/**
	 * Ask the server to draw the message.
	 *
	 * The renderer of an extension that lives in the server's process runs there, so the
	 * client cannot draw the message itself. The request runs in the background: the
	 * message shows the default rendering until the answer arrives.
	 */
	private requestServerRender(): void {
		if (this.serverRequested) return;
		const provider = getServerRenderProvider();
		if (!provider) return;
		this.serverRequested = true;
		void provider
			.render({ kind: "message", customType: this.message.customType, message: this.message })
			.then((response) => {
				if (response.lines.length === 0) return;
				this.serverLines = response.lines;
				this.invalidate();
				this.requestRender?.();
			})
			.catch(() => {
				// The server cannot draw the message: the default rendering stays.
			});
	}
}
