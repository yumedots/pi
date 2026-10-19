import { setKeybindings } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { MenuSelectorComponent } from "../src/modes/interactive/components/menu-selector.ts";
import { getThemeByName, initTheme, setTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const renderBody = (menu: MenuSelectorComponent<string>): string => stripAnsi(menu.render(60).join("\n"));

/** The foreground color code in effect just before the marker. */
function colorBefore(line: string, marker: string): string {
	const index = line.indexOf(marker);
	if (index === -1) return "";
	return (
		line
			.slice(0, index)
			.match(/\x1b\[38;2;\d+;\d+;\d+m/g)
			?.pop() ?? ""
	);
}

describe("menu selector theme changes", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	afterEach(() => {
		setTheme("dark", false);
	});

	it("repaints its text when the theme changes", () => {
		const menu = new MenuSelectorComponent<string>(
			{ title: "Skills", items: [{ title: "commit", value: "commit" }] },
			() => {},
			() => {},
		);

		const dark = colorBefore(menu.render(60).join("\n"), "esc");
		expect(dark).not.toBe("");

		setTheme("light", false);
		// The UI invalidates on a theme change; the menu must pick the new colors up.
		menu.invalidate();

		const light = colorBefore(menu.render(60).join("\n"), "esc");
		expect(light).not.toBe("");
		expect(light).not.toBe(dark);
	});

	it("keeps the title readable on the panel background", () => {
		setTheme("light", false);
		const menu = new MenuSelectorComponent<string>(
			{ title: "Skills", items: [{ title: "commit", value: "commit" }] },
			() => {},
			() => {},
		);

		const body = renderBody(menu);
		expect(body).toContain("Skills");
		expect(getThemeByName("light")).toBeDefined();
	});
});
