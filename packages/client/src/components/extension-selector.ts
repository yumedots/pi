/**
 * Generic selector component for extensions.
 * Displays a list of string options with keyboard navigation.
 */

import { getKeybindings, type TUI } from "@earendil-works/pi-tui";
import { keyHint, rawKeyHint } from "../client-support/keybinding-hints.ts";
import { CountdownTimer } from "./countdown-timer.ts";
import { MenuComponent, type MenuItem, type MenuOptions } from "./menu.ts";

export interface ExtensionSelectorOptions {
	tui?: TUI;
	timeout?: number;
	onToggleToolsExpanded?: () => void;
	description?: string;
}

export class ExtensionSelectorComponent extends MenuComponent<string> {
	private countdown: CountdownTimer | undefined;
	private readonly onToggleToolsExpanded: (() => void) | undefined;

	constructor(
		title: string,
		options: string[],
		onSelect: (option: string) => void,
		onCancel: () => void,
		opts?: ExtensionSelectorOptions,
	) {
		const items: MenuItem<string>[] = options.map((option) => ({ title: option, value: option }));
		let titleText = title;
		const menuOptions: MenuOptions<string> = {
			get title() {
				return titleText;
			},
			items,
			placeholder: "Search",
		};
		super(menuOptions, onSelect, onCancel);
		this.onToggleToolsExpanded = opts?.onToggleToolsExpanded;
		if (opts?.description) this.setFooterText(opts.description);
		if (opts?.timeout && opts.timeout > 0 && opts.tui) {
			this.countdown = new CountdownTimer(
				opts.timeout,
				opts.tui,
				(seconds) => {
					titleText = `${title} (${seconds}s)`;
				},
				() => this.cancel(),
			);
		}
	}

	protected override hintLine(): string {
		return (
			rawKeyHint("↑↓", "navigate") +
			"  " +
			keyHint("tui.select.confirm", "select") +
			"  " +
			keyHint("tui.select.cancel", "cancel")
		);
	}

	/** The selector keeps its vim-style navigation keys. */
	override handleInput(keyData: string): void {
		if (keyData === "j") keyData = "\x1b[B";
		else if (keyData === "k") keyData = "\x1b[A";
		else if (keyData === "\n") keyData = "\r";
		super.handleInput(keyData);
	}

	protected override handleExtraKey(keyData: string): boolean {
		if (!getKeybindings().matches(keyData, "app.tools.expand")) return false;
		this.onToggleToolsExpanded?.();
		return true;
	}

	dispose(): void {
		this.countdown?.dispose();
	}
}
