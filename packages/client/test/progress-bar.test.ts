import type { TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initTheme } from "../../coding-agent/src/core/theme/theme.ts";
import { stripAnsi } from "../../coding-agent/src/utils/ansi.ts";
import { Text } from "../../tui/src/components/text.ts";
import { renderLayoutFrame } from "../../tui/src/layout.ts";
import { createChatViewport } from "../src/chat-viewport.ts";
import { AgentProgressBar } from "../src/components/progress-bar.ts";

function createBar(): { bar: AgentProgressBar; renders: number } {
	const state = { renders: 0 };
	const ui = {
		requestRender: () => {
			state.renders += 1;
		},
	} as unknown as TUI;
	return { bar: new AgentProgressBar(ui), renders: state.renders };
}

/** The number of cells the progress line covers. */
function filledCells(line: string): number {
	return (stripAnsi(line).match(/\u2594/g) ?? []).length;
}

describe("AgentProgressBar", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("renders nothing while it is idle or disabled", () => {
		const { bar } = createBar();
		expect(bar.render(40)).toEqual([]);

		bar.setEnabled(true);
		expect(bar.render(40)).toEqual([]);

		bar.start();
		expect(bar.render(40)).toHaveLength(1);
	});

	it("grows at most one cell per tick", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		const { bar } = createBar();
		bar.setEnabled(true);
		bar.start();
		// The first render learns how wide the bar is.
		bar.render(40);

		// Long past the estimate the target is the whole width, but the bar still
		// moves one cell per tick instead of jumping.
		vi.setSystemTime(new Date("2026-01-01T00:10:00Z"));
		vi.advanceTimersByTime(100);
		expect(filledCells(bar.render(40)[0] ?? "")).toBe(1);
		vi.advanceTimersByTime(100);
		expect(filledCells(bar.render(40)[0] ?? "")).toBe(2);
	});

	it("never claims to be done while the run is going", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		const { bar } = createBar();
		bar.setEnabled(true);
		bar.start();
		bar.render(40);

		// Far past the estimate the bar creeps, but it stays short of the end.
		vi.setSystemTime(new Date("2026-01-01T00:10:00Z"));
		vi.advanceTimersByTime(100);
		expect(filledCells(bar.render(40)[0] ?? "")).toBeLessThan(40);
	});

	it("shows a full bar when the run ends and hides it afterwards", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		const { bar } = createBar();
		bar.setEnabled(true);
		bar.start();
		bar.render(40);
		vi.setSystemTime(new Date("2026-01-01T00:00:02Z"));
		bar.complete();

		expect(filledCells(bar.render(40)[0] ?? "")).toBe(40);

		// The finished bar goes away on its own.
		vi.advanceTimersByTime(1000);
		expect(bar.render(40)).toEqual([]);
	});

	it("keeps the progress of a run that is already going", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		const { bar } = createBar();
		bar.setEnabled(true);
		bar.start();
		bar.render(40);
		vi.advanceTimersByTime(500);
		const before = filledCells(bar.render(40)[0] ?? "");
		bar.start();
		expect(filledCells(bar.render(40)[0] ?? "")).toBe(before);
	});

	it("sits on the first row of the screen", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		const { bar } = createBar();
		bar.setEnabled(true);
		bar.start();
		bar.render(40);
		vi.advanceTimersByTime(300);
		const viewport = createChatViewport({
			document: new Text("transcript", 0, 0),
			pendingMessages: new Text("", 0, 0),
			status: new Text("", 0, 0),
			editor: new Text("> input", 0, 0),
			footer: new Text("footer", 0, 0),
			progress: bar,
		});

		const frame = renderLayoutFrame(viewport.root, 40, 10, () => {});

		expect(stripAnsi(frame.lines[0] ?? "")).toContain("\u2594");
		expect(stripAnsi(frame.lines[1] ?? "")).toContain("transcript");
	});
});
