/**
 * The layout of the session sidebar.
 *
 * In a wide terminal the sidebar is a column beside the conversation. When the
 * terminal is too narrow for a column, the sessions collapse into a single row
 * of chips above the conversation.
 */

import { theme } from "@earendil-works/pi-coding-agent/core/theme/theme";
import {
	type Component,
	HStack,
	spinnerFrame,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	VStack,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { getLayoutNode, LAYOUT_NODE, type LayoutNode, type StackLayoutNode } from "@earendil-works/pi-tui/layout-node";
import { NEW_SESSION_ROW_LABEL, type SessionSidebar, type SessionSidebarRow } from "./components/session-sidebar.ts";

/** The narrowest terminal that still shows the sidebar as a column. */
export const SIDEBAR_MIN_WIDTH = 100;

/** The width of the sidebar column. */
export const SIDEBAR_WIDTH = 34;

/** The separator between the chips of the collapsed bar. */
const CHIP_SEPARATOR = " · ";

/** The options of {@link SessionSidebarLayout}. */
export interface SessionSidebarLayoutOptions {
	/** The list of sessions, shown beside the conversation. */
	readonly sidebar: SessionSidebar;
	/** The conversation area. */
	readonly main: Component;
	/** The clock the spinner reads. Defaults to the wall clock. */
	readonly now?: () => number;
}

/**
 * The sessions as a single row of chips, used when the terminal is too narrow
 * for the sidebar column.
 */
class CollapsedSessionBar implements Component {
	private readonly sidebar: SessionSidebar;
	private readonly now: () => number;
	private chips: { start: number; end: number }[] = [];

	constructor(sidebar: SessionSidebar, now: () => number) {
		this.sidebar = sidebar;
		this.now = now;
	}

	render(width: number): string[] {
		const now = this.now();
		const chips: string[] = [];
		const ranges: { start: number; end: number }[] = [];
		let offset = 0;
		const sessions = this.sidebar.sessions;
		for (let index = 0; index < sessions.length; index++) {
			const chip = this.renderChip(sessions[index]!, index, now);
			chips.push(chip);
			ranges.push({ start: offset, end: offset + visibleWidth(chip) });
			offset += visibleWidth(chip) + visibleWidth(CHIP_SEPARATOR);
		}
		const newChip = this.renderNewSessionChip();
		chips.push(newChip);
		ranges.push({ start: offset, end: offset + visibleWidth(newChip) });
		this.chips = ranges;
		return [truncateToWidth(chips.join(CHIP_SEPARATOR), width)];
	}

	/** Picks the chip under the cursor and lets the sidebar handle the row. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const index = this.chips.findIndex((chip) => event.x >= chip.start && event.x < chip.end);
		if (index === -1) return undefined;
		return this.sidebar.handleMouse?.({ ...event, y: index });
	}

	invalidate(): void {}

	/** A working session shows the spinner, an idle one only its title. */
	private renderChip(row: SessionSidebarRow, index: number, now: number): string {
		const title = index === this.sidebar.selectedIndex ? theme.bold(row.title) : theme.fg("muted", row.title);
		if (!row.busy) return title;
		return `${theme.fg("accent", spinnerFrame(now))} ${title}`;
	}

	/** The trailing chip that starts a new session. */
	private renderNewSessionChip(): string {
		const focused = this.sidebar.selectedIndex === this.sidebar.sessions.length;
		return focused ? theme.bold(NEW_SESSION_ROW_LABEL) : theme.fg("muted", NEW_SESSION_ROW_LABEL);
	}
}

/**
 * Stands in for the conversation area in the layout tree.
 *
 * The tree measures every child of a row to size it, and measuring the
 * conversation would render the whole transcript a second time per frame. The
 * proxy keeps the layout node of the conversation and reports no height.
 *
 * A target without a layout node, e.g. the intro screen, is drawn by the proxy
 * itself, so the proxy also passes on its mouse events and its overlay.
 */
class ConversationArea implements Component {
	private readonly target: Component;

	constructor(target: Component) {
		this.target = target;
	}

	render(width: number): string[] {
		return getLayoutNode(this.target) === undefined ? this.target.render(width) : [];
	}

	/** The target draws itself, so it also gets the mouse events of its box. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (getLayoutNode(this.target) !== undefined) return undefined;
		return this.target.handleMouse?.(event);
	}

	/** The overlay of a target without a layout node, e.g. the autocomplete list. */
	renderOverlayAbove(width: number): string[] {
		if (getLayoutNode(this.target) !== undefined) return [];
		return this.target.renderOverlayAbove?.(width) ?? [];
	}

	/** The row the overlay of the target is anchored to. */
	getOverlayRow(): number {
		if (getLayoutNode(this.target) !== undefined) return 0;
		return this.target.getOverlayRow?.() ?? 0;
	}

	invalidate(): void {
		this.target.invalidate();
	}

	[LAYOUT_NODE](): LayoutNode | undefined {
		return getLayoutNode(this.target);
	}
}

/**
 * Lays the session sidebar out beside the conversation.
 *
 * The layout follows the width of the terminal: from {@link SIDEBAR_MIN_WIDTH}
 * columns on the sidebar is a column on the left, narrower terminals collapse
 * it into a single row of chips above the conversation.
 */
export class SessionSidebarLayout implements Component {
	private readonly sidebar: SessionSidebar;
	private readonly main: Component;
	private readonly collapsed: CollapsedSessionBar;
	private readonly narrow: VStack;
	private readonly plainRow: HStack;
	private readonly plainNarrow: VStack;

	constructor(options: SessionSidebarLayoutOptions) {
		const collapsed = new CollapsedSessionBar(options.sidebar, options.now ?? (() => Date.now()));
		const row = new HStack([
			{
				component: options.sidebar,
				basis: SIDEBAR_WIDTH,
				grow: 0,
				shrink: 0,
				maxSize: SIDEBAR_WIDTH,
				visible: (viewport) => viewport.width >= SIDEBAR_MIN_WIDTH,
			},
			{ component: new ConversationArea(options.main), basis: 0, grow: 1, shrink: 1, minSize: 30 },
		]);
		const narrow = new VStack([
			{
				component: collapsed,
				basis: "auto",
				grow: 0,
				shrink: 0,
				visible: (viewport) => viewport.width < SIDEBAR_MIN_WIDTH,
			},
			{ component: row, basis: 0, grow: 1, shrink: 1, minSize: 0 },
		]);
		const plainRow = new HStack([
			{
				component: options.sidebar,
				basis: SIDEBAR_WIDTH,
				grow: 0,
				shrink: 0,
				maxSize: SIDEBAR_WIDTH,
				visible: (viewport) => viewport.width >= SIDEBAR_MIN_WIDTH,
			},
			{ component: options.main, basis: 0, grow: 1, shrink: 1, minSize: 30 },
		]);
		const plainNarrow = new VStack([
			{
				component: collapsed,
				basis: "auto",
				grow: 0,
				shrink: 0,
				visible: (viewport) => viewport.width < SIDEBAR_MIN_WIDTH,
			},
			{ component: options.main, basis: "auto", grow: 0, shrink: 0 },
		]);
		this.sidebar = options.sidebar;
		this.main = options.main;
		this.collapsed = collapsed;
		this.narrow = narrow;
		this.plainRow = plainRow;
		this.plainNarrow = plainNarrow;
	}

	/**
	 * The layout of the given width: the sidebar beside the conversation, or the
	 * collapsed bar above it.
	 */
	render(width: number): string[] {
		if (width >= SIDEBAR_MIN_WIDTH) return this.plainRow.render(width);
		return this.plainNarrow.render(width);
	}

	invalidate(): void {
		this.sidebar.invalidate();
		this.collapsed.invalidate();
		this.main.invalidate();
	}

	[LAYOUT_NODE](): StackLayoutNode {
		return this.narrow[LAYOUT_NODE]();
	}
}
