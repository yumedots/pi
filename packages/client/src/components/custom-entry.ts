import type { EntryRenderer } from "@earendil-works/pi-coding-agent/core/extensions/types";
import type { CustomEntry } from "@earendil-works/pi-coding-agent/core/session-manager";
import type { Component } from "@earendil-works/pi-tui";
import { Box, Container, Spacer, Text } from "@earendil-works/pi-tui";
import { theme } from "../client-theme.ts";
import { getServerRenderProvider } from "../session-facade.ts";

/**
 * Component that renders a custom session entry from extensions.
 * The host owns transcript spacing; renderer output should provide only its content.
 *
 * An entry of an extension that lives in the server's process is drawn by the server: the
 * renderer runs there, so the client asks for the lines and shows them.
 */
export class CustomEntryComponent extends Container {
	private entry: CustomEntry<unknown>;
	private renderer?: EntryRenderer;
	private customComponent?: Component;
	private _expanded = false;
	private outputPad: number;
	/** The lines the server rendered for this entry. */
	private serverLines?: string[];
	/** Whether the server rendering was asked for already. */
	private serverRequested = false;
	/** Asks the terminal to redraw, so an answer that arrives late shows up. */
	private readonly requestRender?: () => void;

	constructor(
		entry: CustomEntry<unknown>,
		renderer: EntryRenderer | undefined,
		outputPad = 1,
		requestRender?: () => void,
	) {
		super();
		this.entry = entry;
		this.renderer = renderer;
		this.outputPad = outputPad;
		this.requestRender = requestRender;
		this.rebuild();
	}

	hasContent(): boolean {
		return this.customComponent !== undefined;
	}

	setExpanded(expanded: boolean): void {
		if (this._expanded !== expanded) {
			this._expanded = expanded;
			this.rebuild();
		}
	}

	setOutputPad(outputPad: number): void {
		this.outputPad = outputPad;
		this.rebuild();
	}

	override invalidate(): void {
		super.invalidate();
		this.rebuild();
	}

	private rebuild(): void {
		this.clear();
		this.customComponent = undefined;

		let component: Component | undefined;
		if (this.renderer) {
			try {
				// The renderer of an extension draws with the theme it is given. The client
				// has the theme of the server, the extension knows the theme of the coding
				// agent: the tokens are the same, so the theme of the server is the one it
				// gets.
				component = this.renderer(this.entry, { expanded: this._expanded }, theme as never);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const box = new Box(this.outputPad, 1, (text) => theme.bg("customMessageBg", text));
				box.addChild(new Text(theme.fg("error", `[${this.entry.customType}] renderer failed: ${message}`), 0, 0));
				component = box;
			}
		} else {
			// The client has no renderer for this custom type: the server may have one.
			this.requestServerRender();
			if (this.serverLines) {
				component = new Text(this.serverLines.join("\n"), 0, 0);
			}
		}

		if (!component) {
			return;
		}

		this.customComponent = component;
		this.addChild(new Spacer(1));
		this.addChild(component);
	}

	/**
	 * Ask the server to draw the entry.
	 *
	 * The renderer of an extension that lives in the server's process runs there, so the
	 * client cannot draw the entry itself. The request runs in the background: the entry
	 * shows nothing until the answer arrives.
	 */
	private requestServerRender(): void {
		if (this.serverRequested) return;
		const provider = getServerRenderProvider();
		if (!provider) return;
		this.serverRequested = true;
		void provider
			.render({ kind: "entry", customType: this.entry.customType, entry: this.entry })
			.then((response) => {
				if (response.lines.length === 0) return;
				this.serverLines = response.lines;
				this.invalidate();
				this.requestRender?.();
			})
			.catch(() => {
				// The server cannot draw the entry: the entry stays undrawn.
			});
	}
}
