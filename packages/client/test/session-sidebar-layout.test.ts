import type { Component } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it } from "vitest";
import { initTheme, theme } from "../../coding-agent/src/core/theme/theme.ts";
import { stripAnsi } from "../../coding-agent/src/utils/ansi.ts";
import { NEW_SESSION_ROW_LABEL, SessionSidebar, type SessionSidebarRow } from "../src/components/session-sidebar.ts";
import { SessionSidebarLayout, SIDEBAR_MIN_WIDTH, SIDEBAR_WIDTH } from "../src/session-sidebar-layout.ts";

/** Stands in for the conversation area. */
class Conversation implements Component {
	render(_width: number): string[] {
		return ["conversation"];
	}

	invalidate(): void {}
}

/** Stands in for the intro screen, which has no layout node of its own. */
class Intro implements Component {
	render(_width: number): string[] {
		return ["intro"];
	}

	invalidate(): void {}
}

function rows(): SessionSidebarRow[] {
	return [
		{ id: "one", title: "First session", directory: "/tmp/one", busy: true },
		{ id: "two", title: "Second session", directory: "/tmp/two", busy: false },
	];
}

function layout(main: Component = new Conversation()): SessionSidebarLayout {
	const sidebar = new SessionSidebar();
	sidebar.setSessions(rows());
	return new SessionSidebarLayout({ sidebar, main, now: () => 0 });
}

describe("session sidebar layout", () => {
	beforeEach(() => {
		initTheme("dark");
	});

	it("shows the sessions in a column beside the conversation", () => {
		const lines = layout().render(SIDEBAR_MIN_WIDTH + 20);
		const first = stripAnsi(lines[0] ?? "");
		const second = stripAnsi(lines[1] ?? "");
		expect(first.slice(0, SIDEBAR_WIDTH)).toContain("First session");
		expect(second.slice(0, SIDEBAR_WIDTH)).toContain("Second session");
		expect(first.slice(SIDEBAR_WIDTH)).toContain("conversation");
	});

	it("shows a screen without a layout node beside the sidebar", () => {
		const lines = layout(new Intro()).render(SIDEBAR_MIN_WIDTH + 20);
		const first = stripAnsi(lines[0] ?? "");
		expect(first.slice(0, SIDEBAR_WIDTH)).toContain("First session");
		expect(first.slice(SIDEBAR_WIDTH)).toContain("intro");
	});

	it("collapses the sessions into a single bar above the conversation", () => {
		const lines = layout().render(SIDEBAR_MIN_WIDTH - 20);
		expect(stripAnsi(lines[0] ?? "")).toBe(`⠋ First session · Second session · ${NEW_SESSION_ROW_LABEL}`);
		expect(stripAnsi(lines[1] ?? "")).toBe("conversation");
	});

	it("truncates the collapsed bar to the width", () => {
		const lines = layout().render(20);
		const first = stripAnsi(lines[0] ?? "");
		expect(first.length).toBeLessThanOrEqual(20);
		expect(first).toContain("First session");
	});

	it("dims the rows the user is not on and leaves the one they are on in the default color", () => {
		const sidebar = new SessionSidebar();
		sidebar.setSessions(rows());
		sidebar.selectedIndex = 1;
		const lines = sidebar.render(40);
		expect(lines[0]).toContain(theme.fg("muted", "First session"));
		expect(lines[1]).toContain("Second session");
		expect(lines[1]).not.toContain(theme.fg("muted", "Second session"));
	});

	it("gives no row a background color", () => {
		const sidebar = new SessionSidebar();
		sidebar.setSessions(rows());
		sidebar.selectedIndex = 0;
		const lines = sidebar.render(40);
		const background = theme.bg("selectedBg", "x").slice(0, theme.bg("selectedBg", "x").indexOf("x"));
		for (const line of lines) {
			expect(line).not.toContain(background);
		}
	});
});
