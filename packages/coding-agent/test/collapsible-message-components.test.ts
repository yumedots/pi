import type { Box, TuiMouseEvent } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { BranchSummaryMessageComponent } from "../src/modes/interactive/components/branch-summary-message.ts";
import { CompactionSummaryMessageComponent } from "../src/modes/interactive/components/compaction-summary-message.ts";
import { SkillInvocationMessageComponent } from "../src/modes/interactive/components/skill-invocation-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const WIDTH = 80;

function renderText(component: Box): string {
	return stripAnsi(component.render(WIDTH).join("\n"));
}

function clickRow(component: Box, marker: string): boolean | undefined {
	const lines = component.render(WIDTH);
	const row = lines.findIndex((line) => stripAnsi(line).includes(marker));
	expect(row).toBeGreaterThanOrEqual(0);
	return clickAtRow(component, row);
}

function clickAtRow(component: Box, row: number): boolean | undefined {
	const lines = component.render(WIDTH);
	const event: TuiMouseEvent = {
		type: "click",
		button: "left",
		x: 2,
		y: row,
		screenX: 2,
		screenY: row,
		width: WIDTH,
		height: lines.length,
		shift: false,
		alt: false,
		ctrl: false,
		clickCount: 1,
	};
	return component.handleMouse(event)?.handled;
}

/** Two clicks at the same spot, as a double click. */
function doubleClickRow(component: Box, marker: string): void {
	for (let click = 0; click < 2; click++) {
		clickRow(component, marker);
	}
}

describe("collapsible message components", () => {
	beforeAll(() => initTheme("dark"));

	test("toggles a compaction summary when clicked", () => {
		const component = new CompactionSummaryMessageComponent({
			role: "compactionSummary",
			summary: "compaction details",
			tokensBefore: 1234,
			timestamp: Date.now(),
		});

		expect(renderText(component)).not.toContain("compaction details");
		expect(clickRow(component, "[compaction]")).toBe(true);
		expect(renderText(component)).toContain("compaction details");
		expect(clickRow(component, "[compaction]")).toBe(true);
		expect(renderText(component)).not.toContain("compaction details");
	});

	test("toggles a branch summary when clicked", () => {
		const component = new BranchSummaryMessageComponent({
			role: "branchSummary",
			summary: "branch details",
			fromId: "entry-1",
			timestamp: Date.now(),
		});

		expect(renderText(component)).not.toContain("branch details");
		expect(clickRow(component, "[branch]")).toBe(true);
		expect(renderText(component)).toContain("branch details");
		expect(clickRow(component, "[branch]")).toBe(true);
		expect(renderText(component)).not.toContain("branch details");
	});

	test("toggles a skill invocation on a click", () => {
		const component = new SkillInvocationMessageComponent({
			blocks: [{ name: "example-skill", location: "/tmp/example-skill.md", content: "skill details" }],
			userMessage: undefined,
		});

		expect(renderText(component)).not.toContain("skill details");
		expect(clickRow(component, "@example-skill")).toBe(true);
		expect(renderText(component)).toContain("skill details");

		// The second click of a double click must not toggle it back.
		expect(clickRow(component, "@example-skill")).toBe(true);
		expect(renderText(component)).toContain("skill details");

		// A click after the burst collapses it again.
		vi.useFakeTimers();
		try {
			vi.setSystemTime(Date.now() + 1000);
			expect(clickRow(component, "@example-skill")).toBe(true);
			expect(renderText(component)).not.toContain("skill details");
		} finally {
			vi.useRealTimers();
		}
	});

	test("toggles a skill invocation from the empty space around the mention", () => {
		const component = new SkillInvocationMessageComponent({
			blocks: [{ name: "example-skill", location: "/tmp/example-skill.md", content: "skill details" }],
			userMessage: undefined,
		});

		// The empty line above the mention belongs to the card, so a click there toggles it.
		const lines = component.render(WIDTH);
		const mentionRow = lines.findIndex((line) => stripAnsi(line).includes("@example-skill"));
		expect(mentionRow).toBeGreaterThan(0);
		expect(clickAtRow(component, mentionRow - 1)).toBe(true);
		expect(renderText(component)).toContain("skill details");
	});

	test("keeps the request that came with a skill on the mention line", () => {
		const component = new SkillInvocationMessageComponent({
			blocks: [{ name: "example-skill", location: "/tmp/example-skill.md", content: "skill details" }],
			userMessage: "extract report.pdf",
		});

		// The request stays visible while the skill content is collapsed and expanded.
		expect(renderText(component)).toContain("extract report.pdf");
		doubleClickRow(component, "@example-skill");
		const expanded = renderText(component);
		expect(expanded).toContain("skill details");
		expect(expanded).toContain("extract report.pdf");
	});
});
