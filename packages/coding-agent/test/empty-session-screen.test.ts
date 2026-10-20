import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { Centered } from "../src/modes/interactive/components/centered.ts";
import { EmptySessionScreen } from "../src/modes/interactive/components/empty-session-screen.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

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
		// 1 logo line, 1 blank, 1 greeting, 1 blank, 1 input line, centered in 12 rows.
		expect(lines.length).toBe(8);
		expect(lines[3]).toBe("logo");
		// The greeting is centered in the width.
		expect(stripAnsi(lines[5])).toBe("      Hi there");
		expect(lines[7]).toBe("     input");
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
		const screen = new EmptySessionScreen(new Text(["logo"]), "Hi there", new Centered(child, 10), () => 6);
		screen.render(20);
		screen.handleMouse({
			type: "click",
			button: "left",
			x: 7,
			y: 4,
			screenX: 7,
			screenY: 4,
			width: 20,
			height: 6,
			shift: false,
			alt: false,
			ctrl: false,
		});
		// The input box sits four rows below the top and five columns to the right.
		expect(received).toEqual({ x: 2, y: 0 });
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
