import {
	type Component,
	spinnerFrame,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import { theme } from "../client-theme.ts";

/** One row of the sidebar: a session of the current directory. */
export interface SessionSidebarRow {
	/** The session id, as the server knows it. */
	id: string;
	/** The title shown in the row. */
	title: string;
	/** The directory the session belongs to. The sidebar only lists one directory. */
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

/**
 * The session sidebar: a panel beside the conversation that lists the sessions
 * of the current directory. Every row shows the session title and a state
 * marker: a braille spinner while the session works, a dim dot when it is idle.
 *
 * The row the user is on is written in bold in the default foreground color,
 * the other rows are dimmed. No row gets a background color, so the sidebar
 * stays a quiet list next to the conversation.
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

	private renderSessionRow(row: SessionSidebarRow, focused: boolean, width: number, now: number): string {
		const marker = row.busy ? theme.fg("accent", spinnerFrame(now)) : theme.fg("muted", "·");
		const title = this.renderTitle(row.title, focused, width - MARKER_WIDTH);
		return `${marker} ${title}`;
	}

	private renderNewSessionRow(focused: boolean, width: number): string {
		return `  ${this.renderTitle(NEW_SESSION_ROW_LABEL, focused, width - MARKER_WIDTH)}`;
	}

	/**
	 * The title of a row.
	 *
	 * The focused row is bold and keeps the default foreground color, the other
	 * rows are dimmed. No row gets a background color.
	 */
	private renderTitle(title: string, focused: boolean, available: number): string {
		if (available <= 0) return "";
		const text = truncateToWidth(title, available);
		return focused ? theme.bold(text) : theme.fg("muted", text);
	}
}
