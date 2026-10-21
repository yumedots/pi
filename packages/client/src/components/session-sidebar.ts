import * as os from "node:os";
import { theme } from "@earendil-works/pi-coding-agent/core/theme/theme";
import {
	type Component,
	spinnerFrame,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

/** One row of the sidebar: a session the server knows about. */
export interface SessionSidebarRow {
	/** The session id, as the server knows it. */
	id: string;
	/** The title shown in the row. */
	title: string;
	/** The project directory of the session. */
	directory: string;
	/** True while the session is working. */
	busy: boolean;
}

/** The label of the trailing row that starts a new session. */
export const NEW_SESSION_ROW_LABEL = "+ New session";

/** What the caller gets when a row is picked: a session id, or "new" for the trailing row. */
export type SessionSidebarSelection = string | "new";

export interface SessionSidebarOptions {
	/** Called when a row is picked with the mouse. */
	onSelect?: (selection: SessionSidebarSelection) => void;
	/** The clock used for the spinner frame. Defaults to the wall clock. */
	now?: () => number;
}

/** Width of the state marker column plus the space after it. */
const MARKER_WIDTH = 2;

/** Minimum width the directory needs before it is shown next to the title. */
const MIN_DIRECTORY_WIDTH = 4;

/** Shortens the home directory to `~`, the same way the session menu does. */
function shortenPath(path: string): string {
	const home = os.homedir();
	if (!path) return path;
	if (path.startsWith(home)) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}

/**
 * The session sidebar: a panel beside the conversation that lists the sessions
 * the server knows about. Every row shows the session title, the project
 * directory and a state marker: a braille spinner while the session works, a
 * dim dot when it is idle.
 *
 * The component owns no data. The caller pushes the sessions in with
 * `setSessions` and reacts to the picks through `onSelect`.
 */
export class SessionSidebar implements Component {
	private rows: SessionSidebarRow[] = [];
	private index = 0;
	private readonly onSelect?: (selection: SessionSidebarSelection) => void;
	private readonly now: () => number;

	constructor(options: SessionSidebarOptions = {}) {
		this.onSelect = options.onSelect;
		this.now = options.now ?? (() => Date.now());
	}

	/** Replaces the listed sessions. The selection is kept inside the new list. */
	setSessions(sessions: SessionSidebarRow[]): void {
		this.rows = [...sessions];
		if (this.index > this.rows.length) this.index = this.rows.length;
	}

	/** The listed sessions, without the trailing "new session" row. */
	get sessions(): readonly SessionSidebarRow[] {
		return this.rows;
	}

	/** The index of the selected row. The trailing "new session" row counts as a row. */
	get selectedIndex(): number {
		return this.index;
	}

	set selectedIndex(index: number) {
		const last = this.rows.length;
		this.index = Math.max(0, Math.min(index, last));
	}

	/** The id of the selected session, "new" for the trailing row, undefined when there is none. */
	get selectedSessionId(): SessionSidebarSelection | undefined {
		if (this.index < this.rows.length) return this.rows[this.index]!.id;
		if (this.index === this.rows.length) return "new";
		return undefined;
	}

	render(width: number): string[] {
		const now = this.now();
		const lines: string[] = [];
		for (let i = 0; i < this.rows.length; i++) {
			lines.push(this.renderSessionRow(this.rows[i]!, i === this.index, width, now));
		}
		lines.push(this.renderNewSessionRow(this.index === this.rows.length, width));
		return lines;
	}

	/** Picks the clicked row and reports it to the caller. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.button !== "left") return undefined;
		if (event.type !== "click" && event.type !== "press") return undefined;
		const row = event.y;
		if (row < 0 || row > this.rows.length) return undefined;
		this.selectedIndex = row;
		this.onSelect?.(row < this.rows.length ? this.rows[row]!.id : "new");
		return { handled: true };
	}

	invalidate(): void {}

	private renderSessionRow(row: SessionSidebarRow, selected: boolean, width: number, now: number): string {
		const marker = row.busy ? theme.fg("accent", spinnerFrame(now)) : theme.fg("muted", "·");
		const body = this.renderBody(row.title, row.directory, selected, width - MARKER_WIDTH);
		const line = `${marker} ${body}`;
		return selected ? theme.bg("selectedBg", line) : line;
	}

	private renderNewSessionRow(selected: boolean, width: number): string {
		const label = truncateToWidth(NEW_SESSION_ROW_LABEL, Math.max(0, width - MARKER_WIDTH));
		const body = selected ? theme.bold(label) : theme.fg("accent", label);
		const line = `  ${body}`;
		return selected ? theme.bg("selectedBg", line) : line;
	}

	/** The title, and the directory next to it when there is room for both. */
	private renderBody(title: string, directory: string, selected: boolean, available: number): string {
		if (available <= 0) return "";
		const dir = shortenPath(directory);
		const dirWidth = dir ? Math.min(dir.length, Math.floor(available * 0.4)) : 0;
		const showDir = dirWidth >= MIN_DIRECTORY_WIDTH;
		const separator = showDir ? " · " : "";
		const titleWidth = Math.max(0, available - (showDir ? dirWidth + visibleWidth(separator) : 0));
		const styledTitle = truncateToWidth(title, titleWidth);
		const text = selected ? theme.bold(styledTitle) : styledTitle;
		if (!showDir) return text;
		return `${text}${theme.fg("muted", separator)}${theme.fg("muted", truncateToWidth(dir, dirWidth))}`;
	}
}
