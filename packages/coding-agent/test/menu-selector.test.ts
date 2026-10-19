import { setCapabilities, setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { MenuSelectorComponent } from "../src/modes/interactive/components/menu-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const renderBody = (menu: MenuSelectorComponent<string>): string => stripAnsi(menu.render(60).join("\n"));

describe("menu selector", () => {
	beforeAll(() => {
		// The assertions look for truecolor escapes. The terminal the suite runs in decides
		// the color mode, and a terminal without truecolor support would fail them.
		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	it("renders the title and description of each item", () => {
		const menu = new MenuSelectorComponent<string>(
			{ title: "Skills", items: [{ title: "commit", description: "Write a commit", value: "commit" }] },
			() => {},
			() => {},
		);

		const body = renderBody(menu);
		expect(body).toContain("commit");
		expect(body).toContain("Write a commit");
	});

	it("renders the description on the same line as the title", () => {
		const menu = new MenuSelectorComponent<string>(
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

		const body = renderBody(menu);
		const entry = body.split("\n").find((line) => line.includes("add-llm-provider"));
		expect(entry).toBeDefined();
		expect(entry).toContain("Checklist for adding a new LLM provider");
	});

	it("keeps the panel background across a truncated row", () => {
		const menu = new MenuSelectorComponent<string>(
			{
				title: "Sessions",
				items: [
					{
						title: "a".repeat(120),
						description: "a description that also runs past the width of the panel",
						value: "a",
					},
				],
			},
			() => {},
			() => {},
		);

		const line = menu.render(40).find((row) => row.includes("…"))!;
		// The row is cut with an ellipsis, which inserts a reset that clears the background.
		// The background must be re-applied, or the rest of the row shows the terminal's own.
		const afterReset = line.slice(line.indexOf("\x1b[0m"));
		expect(afterReset).toMatch(/\x1b\[48;2;\d+;\d+;\d+m/);
	});

	it("selects the highlighted item on confirm", () => {
		const onSelect = vi.fn();
		const menu = new MenuSelectorComponent<string>(
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
		const menu = new MenuSelectorComponent<string>(
			{ title: "Skills", items: [{ title: "commit", value: "commit" }] },
			() => {},
			onCancel,
		);

		menu.handleInput("\x1b");
		expect(onCancel).toHaveBeenCalled();
	});

	it("filters items by the search query", () => {
		const menu = new MenuSelectorComponent<string>(
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
});
