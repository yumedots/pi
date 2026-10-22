import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getKeybindings } from "@earendil-works/pi-tui";
import { keyDisplayText } from "../client-support/keybinding-hints.ts";
import { theme } from "../client-theme.ts";
import { MenuComponent, type MenuItem } from "./menu.ts";

const LEVEL_DESCRIPTIONS: Record<ThinkingLevel, string> = {
	off: "No reasoning",
	minimal: "Very brief reasoning (~1k tokens)",
	low: "Light reasoning (~2k tokens)",
	medium: "Moderate reasoning (~8k tokens)",
	high: "Deep reasoning (~16k tokens)",
	xhigh: "Extra-high reasoning (~32k tokens)",
	max: "Maximum reasoning",
};

/**
 * Component that renders a thinking level selector with borders
 */
export class ThinkingSelectorComponent extends MenuComponent<ThinkingLevel> {
	private readonly levels: ThinkingLevel[];
	private readonly onSelectAsDefault?: (level: ThinkingLevel) => void;

	constructor(
		currentLevel: ThinkingLevel,
		availableLevels: ThinkingLevel[],
		onSelect: (level: ThinkingLevel) => void,
		onCancel: () => void,
		onSelectAsDefault?: (level: ThinkingLevel) => void,
		defaultThinkingLevel?: ThinkingLevel,
	) {
		const items: MenuItem<ThinkingLevel>[] = availableLevels.map((level) => ({
			title: `${level === currentLevel ? "✓ " : "  "}${level}`,
			description:
				level === defaultThinkingLevel ? `${LEVEL_DESCRIPTIONS[level]} · default` : LEVEL_DESCRIPTIONS[level],
			value: level,
		}));
		super({ title: "Thinking Level", items, placeholder: "Search" }, onSelect, onCancel);
		this.levels = availableLevels;
		this.onSelectAsDefault = onSelectAsDefault;
		const currentIndex = availableLevels.indexOf(currentLevel);
		if (currentIndex !== -1) this.getSelectList().setSelectedIndex(currentIndex);
	}

	/** The level of the highlighted row. */
	private get selectedLevel(): ThinkingLevel | undefined {
		return this.getSelectedValue();
	}

	protected override hintLine(): string {
		const hint = theme.fg(
			"dim",
			`  ${keyDisplayText("tui.select.confirm")} to select · ${keyDisplayText("app.thinking.save")} to set as default · ${keyDisplayText("tui.select.cancel")} to cancel`,
		);
		return hint;
	}

	protected override handleExtraKey(keyData: string): boolean {
		if (!this.onSelectAsDefault) return false;
		if (!getKeybindings().matches(keyData, "app.thinking.save")) return false;
		const level = this.selectedLevel;
		if (level) this.onSelectAsDefault(level);
		return true;
	}

	/** Keeps the highlighted level while the search filters the rows. */
	protected override applyFilter(query: string): void {
		const selected = this.selectedLevel;
		super.applyFilter(query);
		if (selected === undefined) return;
		const index = this.levels.indexOf(selected);
		const visible = this.getVisibleItems();
		const visibleIndex = visible.findIndex((item) => item.value === selected);
		if (visibleIndex !== -1) this.getSelectList().setSelectedIndex(visibleIndex);
		else if (index !== -1) this.getSelectList().setSelectedIndex(Math.min(index, visible.length - 1));
	}
}
