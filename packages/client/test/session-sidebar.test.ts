import { type TuiMouseEvent, visibleWidth } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it } from "vitest";
import { initTheme, theme } from "../../coding-agent/src/core/theme/theme.ts";
import { stripAnsi } from "../../coding-agent/src/utils/ansi.ts";
import {
	NEW_SESSION_ROW_LABEL,
	SessionSidebar,
	type SessionSidebarRow,
	type SessionSidebarSelection,
} from "../src/components/session-sidebar.ts";

function click(y: number): TuiMouseEvent {
	return {
		type: "click",
		button: "left",
		x: 0,
		y,
		screenX: 0,
		screenY: y,
		width: 40,
		height: 10,
		shift: false,
		alt: false,
		ctrl: false,
	};
}

function rows(): SessionSidebarRow[] {
	return [
		{ id: "a", title: "First session", directory: "/tmp/project-a", busy: true },
		{ id: "b", title: "Second session", directory: "/tmp/project-b", busy: false },
	];
}

describe("session sidebar", () => {
	beforeEach(() => {
		initTheme("dark");
	});

	it("renders the braille spinner on a working row", () => {
		const sidebar = new SessionSidebar({ now: () => 0 });
		sidebar.setSessions(rows());
		const lines = sidebar.render(40);
		expect(stripAnsi(lines[0]!).trimStart().startsWith("⠋")).toBe(true);
	});

	it("renders a dim dot on an idle row", () => {
		const sidebar = new SessionSidebar({ now: () => 0 });
		sidebar.setSessions(rows());
		const lines = sidebar.render(40);
		expect(stripAnsi(lines[1]!).trimStart().startsWith("·")).toBe(true);
	});

	it("renders the trailing new session row", () => {
		const sidebar = new SessionSidebar();
		sidebar.setSessions(rows());
		const lines = sidebar.render(40);
		expect(lines).toHaveLength(3);
		expect(stripAnsi(lines[2]!)).toContain(NEW_SESSION_ROW_LABEL);
	});

	it("highlights the selected row with the text, not with a background", () => {
		const sidebar = new SessionSidebar({ now: () => 0 });
		sidebar.setSessions(rows());
		sidebar.selectedIndex = 1;
		const lines = sidebar.render(40);
		expect(lines[1]!).toContain("Second session");
		expect(lines[1]!).not.toContain(theme.fg("muted", "Second session"));
		expect(lines[0]!).toContain(theme.fg("muted", "First session"));
	});

	it("truncates the title to the width", () => {
		const sidebar = new SessionSidebar({ now: () => 0 });
		sidebar.setSessions([{ id: "a", title: "a".repeat(200), directory: "/tmp/project-a", busy: false }]);
		const lines = sidebar.render(20);
		expect(visibleWidth(lines[0]!)).toBeLessThanOrEqual(20);
		expect(stripAnsi(lines[0]!)).toContain("...");
	});

	it("reports the clicked row", () => {
		const picks: SessionSidebarSelection[] = [];
		const sidebar = new SessionSidebar({ onSelect: (selection) => picks.push(selection) });
		sidebar.setSessions(rows());
		sidebar.handleMouse(click(1));
		expect(picks).toEqual(["b"]);
		expect(sidebar.selectedIndex).toBe(1);
		expect(sidebar.selectedSessionId).toBe("b");
	});

	it("reports the new session row", () => {
		const picks: SessionSidebarSelection[] = [];
		const sidebar = new SessionSidebar({ onSelect: (selection) => picks.push(selection) });
		sidebar.setSessions(rows());
		sidebar.handleMouse(click(2));
		expect(picks).toEqual(["new"]);
		expect(sidebar.selectedSessionId).toBe("new");
	});

	it("ignores clicks outside the rows", () => {
		const picks: SessionSidebarSelection[] = [];
		const sidebar = new SessionSidebar({ onSelect: (selection) => picks.push(selection) });
		sidebar.setSessions(rows());
		sidebar.handleMouse(click(5));
		expect(picks).toEqual([]);
	});
});
