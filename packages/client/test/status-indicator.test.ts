import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../../coding-agent/src/core/keybindings.ts";
import { stripAnsi } from "../../coding-agent/src/utils/ansi.ts";
import { getEditorTheme, theme } from "../src/client-theme.ts";
import { CustomEditor } from "../src/components/custom-editor.ts";
import {
	BranchSummaryStatusIndicator,
	CompactionStatusIndicator,
	IdleStatus,
	RetryStatusIndicator,
	WorkingStatusIndicator,
} from "../src/components/status-indicator.ts";
import { initDarkTheme } from "./theme-fixture.ts";

describe("status indicators", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("keeps idle status at the same height as standalone status indicators", () => {
		const idleStatus = new IdleStatus();

		const lines = idleStatus.render(20);
		expect(lines).toHaveLength(1);
		expect(lines).toEqual([" ".repeat(20)]);
	});

	it("keeps the editor's top row free of the status", () => {
		initDarkTheme();
		const tui = {
			requestRender: vi.fn(),
			terminal: { rows: 10 },
		} as unknown as TUI;
		const editor = new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create());

		expect(stripAnsi(editor.render(20)[0]!)).toBe(" ".repeat(20));
	});

	it("paints the editor box in the color of the sent messages", () => {
		initDarkTheme();
		const tui = {
			requestRender: vi.fn(),
			terminal: { rows: 10 },
		} as unknown as TUI;
		const editor = new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create());
		for (const row of editor.render(20)) {
			expect(row).toContain(theme.getBgAnsi("userMessageBg"));
		}
	});

	it("renders the working indicator on its own row", () => {
		initDarkTheme();
		const tui = {
			requestRender: vi.fn(),
			terminal: { rows: 10 },
		} as unknown as TUI;
		const indicator = new WorkingStatusIndicator(tui, "Working");

		const lines = indicator.render(20);
		expect(lines).toHaveLength(1);
		expect(stripAnsi(lines[0]!).trimEnd()).toBe(" ⠋ Working");
		expect(visibleWidth(lines[0]!)).toBe(20);
		expect(lines[0]).toContain(theme.getFgAnsi("accent"));
		expect(lines[0]).toContain(theme.getFgAnsi("muted"));
		indicator.dispose();
	});

	it("renders compaction, summary, and retry labels on the status row", () => {
		initDarkTheme();
		vi.useFakeTimers();
		const tui = { requestRender: vi.fn(), terminal: { rows: 10 } } as unknown as TUI;
		const indicators = [
			{ indicator: new CompactionStatusIndicator(tui, "manual"), label: "Compacting context..." },
			{ indicator: new CompactionStatusIndicator(tui, "threshold"), label: "Auto-compacting..." },
			{ indicator: new CompactionStatusIndicator(tui, "overflow"), label: "Context overflow detected," },
			{ indicator: new BranchSummaryStatusIndicator(tui), label: "Summarizing branch..." },
			{ indicator: new RetryStatusIndicator(tui, 1, 3, 3000), label: "Retrying (1/3) in 3s" },
		];
		try {
			for (const { indicator, label } of indicators) {
				const lines = indicator.render(120);
				expect(lines).toHaveLength(1);
				expect(stripAnsi(lines[0]!)).toContain(label);
				expect(visibleWidth(lines[0]!)).toBe(120);
			}
			vi.advanceTimersByTime(1000);
			expect(stripAnsi(indicators[4]!.indicator.render(120)[0]!)).toContain("Retrying (1/3) in 2s");
		} finally {
			for (const { indicator } of indicators) indicator.dispose();
		}
	});

	it("disposes retry countdown updates", () => {
		initDarkTheme();
		vi.useFakeTimers();
		const requestRender = vi.fn();
		const tui = { requestRender } as unknown as TUI;
		const indicator = new RetryStatusIndicator(tui, 1, 3, 1000);
		const callsBeforeDispose = requestRender.mock.calls.length;

		indicator.dispose();
		vi.advanceTimersByTime(2000);

		expect(requestRender).toHaveBeenCalledTimes(callsBeforeDispose);
	});
});
