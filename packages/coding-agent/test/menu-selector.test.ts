import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { MenuSelectorComponent } from "../src/modes/interactive/components/menu-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const renderBody = (menu: MenuSelectorComponent<string>): string => stripAnsi(menu.render(60).join("\n"));

describe("menu selector", () => {
	beforeAll(() => {
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

	it("wraps the description to at most two lines when wrapLines is set", () => {
		const menu = new MenuSelectorComponent<string>(
			{
				title: "Skills",
				wrapLines: 2,
				items: [
					{
						title: "add-llm-provider",
						description: "Checklist for adding a new LLM provider to packages/ai with full coverage",
						value: "add-llm-provider",
					},
				],
			},
			() => {},
			() => {},
		);

		const body = renderBody(menu);
		const lines = body.split("\n");
		const entry = lines.filter((line) => line.includes("add-llm-provider") || line.includes("Checklist"));
		expect(entry.length).toBeLessThanOrEqual(2);
		expect(body).toContain("Checklist");
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
