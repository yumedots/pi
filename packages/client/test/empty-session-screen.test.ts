import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Component, Container, CURSOR_MARKER, Editor, TuiMainScreen } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../../coding-agent/src/core/settings-manager.ts";
import { getEditorTheme, initTheme } from "../../coding-agent/src/core/theme/theme.ts";
import { stripAnsi } from "../../coding-agent/src/utils/ansi.ts";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { Centered } from "../src/components/centered.ts";
import { EmptySessionScreen } from "../src/components/empty-session-screen.ts";
import { MenuComponent } from "../src/components/menu.ts";

/** A component that renders one line per line of text. */
class Text implements Component {
	private readonly lines: string[];

	constructor(lines: string[]) {
		this.lines = lines;
	}

	render(): string[] {
		return this.lines;
	}

	invalidate(): void {}
}

describe("empty session screen", () => {
	beforeEach(() => {
		initTheme("dark");
	});

	it("centers the input box in the available width", () => {
		const centered = new Centered(new Text(["abc"]), 10);
		expect(centered.render(20)).toEqual(["     abc"]);
		expect(centered.innerWidth(20)).toBe(10);
		expect(centered.padLeft(20)).toBe(5);
	});

	it("renders the logo above the greeting and the input box, centered in the height", () => {
		const screen = new EmptySessionScreen(
			new Text(["logo"]),
			"Hi there",
			new Centered(new Text(["input"]), 10),
			() => 12,
		);
		const lines = screen.render(20);
		// 1 logo line, 1 blank, 1 greeting, 1 blank, 1 input line. The bottom third
		// of the screen is left for the menus that open under the input box.
		expect(lines.length).toBe(6);
		expect(lines[1]).toBe("logo");
		// The greeting is centered in the width.
		expect(stripAnsi(lines[3])).toBe("      Hi there");
		expect(lines[5]).toBe("     input");
	});

	it("forwards the mouse event to the input box", () => {
		let received: { x: number; y: number } | undefined;
		const child: Component = {
			render: () => ["input"],
			invalidate: () => {},
			handleMouse: (event) => {
				received = { x: event.x, y: event.y };
				return { handled: true, focus: true };
			},
		};
		const screen = new EmptySessionScreen(new Text(["logo"]), "Hi there", new Centered(child, 10), () => 12);
		const lines = screen.render(20);
		const inputRow = lines.findIndex((line) => line.includes("input"));
		screen.handleMouse({
			type: "click",
			button: "left",
			x: 7,
			y: inputRow,
			screenX: 7,
			screenY: inputRow,
			width: 20,
			height: 12,
			shift: false,
			alt: false,
			ctrl: false,
		});
		// The input box sits five columns to the right of the click.
		expect(received).toEqual({ x: 2, y: 0 });
	});

	it("keeps the input box in place when the autocomplete opens", async () => {
		const tui = new TuiMainScreen(new VirtualTerminal(40, 24));
		const editor = new Editor(tui, getEditorTheme(), { autocompletePosition: "below" });
		editor.setAutocompleteProvider({
			getSuggestions: async () => ({
				prefix: "/",
				items: [
					{ value: "/help", label: "/help" },
					{ value: "/theme", label: "/theme" },
				],
			}),
			applyCompletion: (lines, line, col, item, prefix) => {
				const next = [...lines];
				next[line] = next[line]!.slice(0, col - prefix.length) + item.value + next[line]!.slice(col);
				return { lines: next, cursorLine: line, cursorCol: col - prefix.length + item.value.length };
			},
		});
		tui.setFocus(editor);

		const screen = new EmptySessionScreen(new Text(["logo"]), "Hi there", new Centered(editor, 30), () => 24);
		const inputRow = (lines: string[]): number => lines.findIndex((line) => line.includes(CURSOR_MARKER));

		const before = screen.render(40);
		const rowBefore = inputRow(before);

		editor.handleInput("/");
		await new Promise((resolve) => setImmediate(resolve));
		await new Promise((resolve) => setImmediate(resolve));

		const after = screen.render(40);
		expect(inputRow(after)).toBe(rowBefore);
	});

	it("keeps the input box in place when a menu opens under it", () => {
		const tui = new TuiMainScreen(new VirtualTerminal(40, 24));
		const editor = new Editor(tui, getEditorTheme(), { autocompletePosition: "below" });
		tui.setFocus(editor);
		const editorContainer = new Container();
		editorContainer.addChild(editor);
		const screen = new EmptySessionScreen(
			new Text(["logo"]),
			"Hi there",
			new Centered(editorContainer, 30),
			() => 24,
		);
		const inputRow = (lines: string[]): number => lines.findIndex((line) => line.includes(CURSOR_MARKER));

		const rowBefore = inputRow(screen.render(40));

		const menu = new MenuComponent<string>(
			{ title: "Sessions", items: [{ title: "one", value: "one" }] },
			() => {},
			() => {},
		);
		menu.setFloating(false);
		editorContainer.addChild(menu);

		const after = screen.render(40);
		expect(inputRow(after)).toBe(rowBefore);
		expect(after.some((line) => line.includes("one"))).toBe(true);
	});

	it("never grows past the screen", () => {
		const tui = new TuiMainScreen(new VirtualTerminal(40, 24));
		const editor = new Editor(tui, getEditorTheme(), { autocompletePosition: "below" });
		tui.setFocus(editor);
		const editorContainer = new Container();
		editorContainer.addChild(editor);
		const screen = new EmptySessionScreen(
			new Text(["logo"]),
			"Hi there",
			new Centered(editorContainer, 30),
			() => 24,
		);
		const menu = new MenuComponent<string>(
			{
				title: "Sessions",
				items: Array.from({ length: 50 }, (_, index) => ({ title: `session ${index}`, value: `s${index}` })),
			},
			() => {},
			() => {},
		);
		menu.setFloating(false);
		editorContainer.addChild(menu);

		expect(screen.render(40).length).toBeLessThanOrEqual(24);
	});
});

describe("threeDEmptySession setting", () => {
	let directory: string;

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "pi-empty-session-"));
	});

	afterEach(() => {
		rmSync(directory, { recursive: true, force: true });
	});

	it("is off by default and can be turned on", () => {
		const manager = SettingsManager.create(directory, directory);
		expect(manager.getThreeDEmptySession()).toBe(false);
		manager.setThreeDEmptySession(true);
		expect(manager.getThreeDEmptySession()).toBe(true);
	});
});
