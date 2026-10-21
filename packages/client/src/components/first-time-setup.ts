import { APP_NAME } from "@earendil-works/pi-coding-agent/config";
import { SYSTEM_THEME_NAME, theme } from "@earendil-works/pi-coding-agent/core/theme/theme";
import { DynamicBorder } from "@earendil-works/pi-coding-agent/core/ui/dynamic-border";
import { keyHint, rawKeyHint } from "@earendil-works/pi-coding-agent/core/ui/keybinding-hints";
import { Spacer } from "@earendil-works/pi-tui/components/spacer";
import { Text } from "@earendil-works/pi-tui/components/text";
import { getKeybindings } from "@earendil-works/pi-tui/keybindings";
import { Container } from "@earendil-works/pi-tui/tui";

export interface FirstTimeSetupResult {
	theme: string;
}

export interface FirstTimeSetupOptions {
	onThemePreview: (themeName: string) => void;
	onSubmit: (result: FirstTimeSetupResult) => void;
	onCancel: () => void;
}

const THEME_OPTIONS: Array<{ value: string; label: string }> = [
	{ value: SYSTEM_THEME_NAME, label: "System (follows the terminal's light or dark mode)" },
	{ value: "dark", label: "Dark" },
	{ value: "light", label: "Light" },
];

const SETUP_LOGO_LINES = ["██████", "██  ██", "████  ██", "██    ██"];

/** First-time setup dialog: theme choice. */
export class FirstTimeSetupComponent extends Container {
	private themeIndex: number;
	private readonly options: FirstTimeSetupOptions;

	constructor(options: FirstTimeSetupOptions) {
		super();
		this.options = options;
		this.themeIndex = 0;
		this.update();
	}

	/** Rebuild on theme changes, e.g. when the system theme switches between light and dark. */
	override invalidate(): void {
		this.update();
		super.invalidate();
	}

	// Rebuild the whole dialog on every change so theme previews recolor all text.
	private update(): void {
		this.clear();
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", SETUP_LOGO_LINES.join("\n")), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(theme.fg("accent", theme.bold(`Welcome to ${APP_NAME}, the minimal coding agent.`)), 1, 0),
		);
		this.addChild(new Spacer(1));

		this.addChild(new Text(theme.fg("text", "Pick a theme."), 1, 0));
		this.addChild(new Spacer(1));
		this.addOptionList(
			THEME_OPTIONS.map((option) => option.label),
			this.themeIndex,
		);

		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				rawKeyHint("↑↓", "navigate") +
					"  " +
					keyHint("tui.select.confirm", "continue") +
					"  " +
					keyHint("tui.select.cancel", "skip setup"),
				1,
				0,
			),
		);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
	}

	private addOptionList(labels: string[], selectedIndex: number): void {
		for (let i = 0; i < labels.length; i++) {
			const isSelected = i === selectedIndex;
			const prefix = isSelected ? theme.fg("accent", "→ ") : "  ";
			const label = isSelected ? theme.fg("accent", labels[i]) : theme.fg("text", labels[i]);
			this.addChild(new Text(`${prefix}${label}`, 1, 0));
		}
	}

	private moveSelection(delta: number): void {
		const next = Math.max(0, Math.min(THEME_OPTIONS.length - 1, this.themeIndex + delta));
		if (next !== this.themeIndex) {
			this.themeIndex = next;
			this.options.onThemePreview(THEME_OPTIONS[this.themeIndex].value);
		}
		this.update();
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
			this.moveSelection(-1);
		} else if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
			this.moveSelection(1);
		} else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
			this.options.onSubmit({
				theme: THEME_OPTIONS[this.themeIndex].value,
			});
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			this.options.onCancel();
		}
	}
}
