import { setCapabilities, setKeybindings } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../../coding-agent/src/core/keybindings.ts";
import { initTheme, setTheme } from "../../coding-agent/src/core/theme/theme.ts";
import { stripAnsi } from "../../coding-agent/src/utils/ansi.ts";
import { defaultMenuMaxVisible, MenuComponent } from "../src/components/menu.ts";

const renderBody = (menu: MenuComponent<string>, width = 60): string => stripAnsi(menu.render(width).join("\n"));

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

describe("menu", () => {
	beforeAll(() => {
		// The assertions look for truecolor escapes. The terminal the suite runs in decides
		// the color mode, and a terminal without truecolor support would fail them.
		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
		initTheme("dark");
	});

	it("shows fewer rows on a short screen", () => {
		expect(defaultMenuMaxVisible(30)).toBe(3);
		expect(defaultMenuMaxVisible(60)).toBe(10);
		expect(defaultMenuMaxVisible(12)).toBe(3);
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	afterEach(() => {
		setTheme("dark", false);
	});

	it("renders the title and the description of each item", () => {
		const menu = new MenuComponent<string>(
			{ title: "Skills", items: [{ title: "commit", description: "Write a commit", value: "commit" }] },
			() => {},
			() => {},
		);

		const body = renderBody(menu);
		expect(body).toContain("Skills");
		expect(body).toContain("commit");
		expect(body).toContain("Write a commit");
	});

	it("renders the description on the same line as the title", () => {
		const menu = new MenuComponent<string>(
			{
				title: "Skills",
				items: [
					{
						title: "add-llm-provider",
						description: "Checklist for adding a new LLM provider to packages/ai",
						value: "add-llm-provider",
					},
				],
			},
			() => {},
			() => {},
		);

		const body = renderBody(menu, 120);
		const entry = body.split("\n").find((line) => line.includes("add-llm-provider"));
		expect(entry).toBeDefined();
		expect(entry).toContain("Checklist for adding a new LLM provider");
	});

	it("selects the highlighted item on confirm", () => {
		const onSelect = vi.fn();
		const menu = new MenuComponent<string>(
			{
				title: "Skills",
				items: [
					{ title: "commit", value: "commit" },
					{ title: "review", value: "review" },
				],
			},
			onSelect,
			() => {},
		);

		menu.handleInput("\x1b[B");
		menu.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith("review");
	});

	it("cancels on escape", () => {
		const onCancel = vi.fn();
		const menu = new MenuComponent<string>(
			{ title: "Skills", items: [{ title: "commit", value: "commit" }] },
			() => {},
			onCancel,
		);

		menu.handleInput("\x1b");
		expect(onCancel).toHaveBeenCalled();
	});

	it("filters items by the search query", () => {
		const menu = new MenuComponent<string>(
			{
				title: "Skills",
				items: [
					{ title: "commit", value: "commit" },
					{ title: "review", value: "review" },
				],
			},
			() => {},
			() => {},
		);

		menu.handleInput("rev");
		const body = renderBody(menu);
		expect(body).toContain("review");
		expect(body).not.toContain("commit");
	});

	it("repaints its text when the theme changes", () => {
		const menu = new MenuComponent<string>(
			{ title: "Skills", items: [{ title: "commit", value: "commit" }] },
			() => {},
			() => {},
		);

		const dark = colorBefore(menu.render(60).join("\n"), "Skills");
		expect(dark).not.toBe("");

		setTheme("light", false);
		// The UI invalidates on a theme change; the menu must pick the new colors up.
		menu.invalidate();

		const light = colorBefore(menu.render(60).join("\n"), "Skills");
		expect(light).not.toBe("");
		expect(light).not.toBe(dark);
	});

	it("floats above its own box, so it does not move the chat", () => {
		const menu = new MenuComponent<string>(
			{ title: "Skills", items: [{ title: "commit", value: "commit" }], floating: true },
			() => {},
			() => {},
		);

		expect(menu.render(60)).toEqual([]);
		expect(stripAnsi(menu.renderOverlayAbove(60).join("\n"))).toContain("commit");
	});

	it("keeps its height when the items arrive", () => {
		const menu = new MenuComponent<string>(
			{ title: "Sessions", loadingText: "Loading..." },
			() => {},
			() => {},
		);
		const loading = menu.render(60).length;

		menu.setItems([{ title: "one", value: "one" }]);
		expect(menu.render(60).length).toBe(loading);

		menu.setItems(
			Array.from({ length: 30 }, (_, index) => ({ title: `session ${index}`, value: `session ${index}` })),
		);
		expect(menu.render(60).length).toBe(loading);

		menu.setFooterText("loaded 30 of 30");
		expect(menu.render(60).length).toBe(loading);
		menu.setFooterText(undefined);
		expect(menu.render(60).length).toBe(loading);
	});

	it("takes the rows above its own box as its own rows", () => {
		const onSelect = vi.fn();
		const menu = new MenuComponent<string>(
			{
				title: "Skills",
				items: [
					{ title: "commit", value: "commit" },
					{ title: "review", value: "review" },
				],
				floating: true,
			},
			onSelect,
			() => {},
		);
		menu.render(60);
		const overlay = menu.renderOverlayAbove(60);

		// The menu is painted above its box, so its rows have negative coordinates.
		// The last row of the menu sits right above the box.
		const row = overlay.findIndex((line) => line.includes("review"));
		const y = row - overlay.length;
		const click = {
			type: "click",
			button: "left",
			x: 2,
			y,
			screenX: 2,
			screenY: y,
			width: 60,
			height: overlay.length,
			shift: false,
			alt: false,
			ctrl: false,
			clickCount: 1,
		} as const;
		menu.handleMouse(click);
		expect(onSelect).toHaveBeenCalledWith("review");
	});
});
