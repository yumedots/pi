import { getKeybindings } from "../keybindings.ts";
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "../tui.ts";
import { applyBackgroundToLine, truncateToWidth } from "../utils.ts";

export interface BlockListTheme {
	block: (text: string) => string;
	selection: (text: string) => string;
	track: (text: string) => string;
	thumb: (text: string) => string;
}

export interface BlockListOptions<T> {
	/**
	 * Render a row. The returned text may contain newlines to render a row
	 * across several lines; each line is truncated to the row width.
	 */
	draw: (item: T, selected: boolean, width: number) => string;
}

const SCROLLBAR_COLUMNS = 2;
const MIN_THUMB_ROWS = 2;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

/**
 * Keyboard-driven list where every row is a full-width block and the right
 * column is a scrollbar that tracks the selection.
 */
export class BlockList<T> implements Component {
	private items: T[];
	private selectedIndex = 0;
	private scrollOffset = 0;
	private maxVisible: number;
	private theme: BlockListTheme;
	private draw: (item: T, selected: boolean, width: number) => string;
	private mousePressedIndex: number | undefined;
	/** Cached line count per item, keyed by the width they were measured at. */
	private heights: number[] = [];
	private heightsWidth = -1;
	/** Maps a rendered line index to the item it belongs to. */
	private lineToItem: number[] = [];

	public onSelect?: (item: T) => void;
	public onCancel?: () => void;
	public onSelectionChange?: (item: T) => void;

	constructor(items: T[], maxVisible: number, theme: BlockListTheme, options: BlockListOptions<T>) {
		this.items = items;
		this.maxVisible = Math.max(1, maxVisible);
		this.theme = theme;
		this.draw = options.draw;
	}

	setItems(items: T[]): void {
		this.items = items;
		this.selectedIndex = clamp(this.selectedIndex, 0, Math.max(0, items.length - 1));
		this.scrollOffset = 0;
		this.heights = [];
		this.heightsWidth = -1;
	}

	setSelectedIndex(index: number): void {
		this.selectedIndex = clamp(index, 0, Math.max(0, this.items.length - 1));
	}

	getSelectedItem(): T | null {
		return this.items[this.selectedIndex] ?? null;
	}

	move(delta: number): void {
		const next = clamp(this.selectedIndex + delta, 0, Math.max(0, this.items.length - 1));
		if (next === this.selectedIndex) return;
		this.selectedIndex = next;
		this.notifySelectionChange();
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (this.items.length === 0) return [];

		const scrollbar = this.items.length > this.maxVisible;
		const contentWidth = Math.max(1, width - (scrollbar ? SCROLLBAR_COLUMNS : 0));
		const visibleRows = Math.min(this.maxVisible, this.items.length);
		this.ensureSelectedVisible();

		const heights = this.computeHeights(contentWidth);
		const lines: string[] = [];
		this.lineToItem = [];
		for (let row = 0; row < visibleRows; row++) {
			const index = this.scrollOffset + row;
			const item = this.items[index];
			if (item === undefined) {
				lines.push(" ".repeat(contentWidth));
				this.lineToItem.push(index);
				continue;
			}
			const selected = index === this.selectedIndex;
			const bg = selected ? this.theme.selection : this.theme.block;
			for (const line of this.draw(item, selected, contentWidth).split("\n")) {
				lines.push(applyBackgroundToLine(truncateToWidth(line, contentWidth, "…"), contentWidth, bg));
				this.lineToItem.push(index);
			}
		}

		if (!scrollbar) return lines;

		const totalHeight = heights.reduce((sum, height) => sum + height, 0);
		const visibleHeight = lines.length;
		const thumbHeight = Math.max(
			Math.min(MIN_THUMB_ROWS, visibleHeight),
			Math.round((visibleHeight * visibleHeight) / totalHeight),
		);
		const maxScrollTop = this.items.length - this.maxVisible;
		const thumbTop =
			maxScrollTop > 0 ? Math.round((this.scrollOffset / maxScrollTop) * (visibleHeight - thumbHeight)) : 0;

		return lines.map((line, row) => {
			const isThumb = row >= thumbTop && row < thumbTop + thumbHeight;
			return `${line} ${isThumb ? this.theme.thumb("█") : this.theme.track("│")}`;
		});
	}

	/**
	 * Line count per item, measured once per width. Selection only changes
	 * styling, so the unselected measurement is representative.
	 */
	private computeHeights(width: number): number[] {
		if (this.heightsWidth === width && this.heights.length === this.items.length) {
			return this.heights;
		}
		this.heights = this.items.map((item) => this.draw(item, false, width).split("\n").length);
		this.heightsWidth = width;
		return this.heights;
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up")) {
			this.move(-1);
		} else if (kb.matches(keyData, "tui.select.down")) {
			this.move(1);
		} else if (kb.matches(keyData, "tui.select.pageUp")) {
			this.move(-this.maxVisible);
		} else if (kb.matches(keyData, "tui.select.pageDown")) {
			this.move(this.maxVisible);
		} else if (kb.matches(keyData, "tui.select.confirm")) {
			const item = this.getSelectedItem();
			if (item !== null) this.onSelect?.(item);
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancel?.();
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (this.items.length === 0) return undefined;
		if (event.type === "wheel" && event.wheelDelta) {
			const previousIndex = this.selectedIndex;
			this.move(event.wheelDelta < 0 ? -1 : 1);
			return { handled: true, render: this.selectedIndex !== previousIndex };
		}
		if (event.button !== "left" || (event.type !== "press" && event.type !== "click")) return undefined;

		// Rows can span several lines, so map the clicked line back to its item.
		const mapped = this.lineToItem.length > 0 ? this.lineToItem[event.y] : undefined;
		const index = mapped ?? this.scrollOffset + event.y;
		if (mapped === undefined && event.y >= Math.min(this.maxVisible, this.items.length)) {
			return undefined;
		}
		if (index < 0 || index >= this.items.length) {
			return undefined;
		}

		if (event.type === "press") {
			this.mousePressedIndex = index;
			const previousIndex = this.selectedIndex;
			this.setSelectedIndex(index);
			if (this.selectedIndex !== previousIndex) this.notifySelectionChange();
			return { handled: true, focus: true };
		}

		const clickedIndex = this.mousePressedIndex ?? index;
		this.mousePressedIndex = undefined;
		const changed = this.selectedIndex !== clickedIndex;
		this.setSelectedIndex(clickedIndex);
		if (changed) this.notifySelectionChange();
		const item = this.getSelectedItem();
		if (item !== null) this.onSelect?.(item);
		return { handled: true };
	}

	private ensureSelectedVisible(): void {
		if (this.selectedIndex < this.scrollOffset) {
			this.scrollOffset = this.selectedIndex;
		} else if (this.selectedIndex >= this.scrollOffset + this.maxVisible) {
			this.scrollOffset = this.selectedIndex - this.maxVisible + 1;
		}
		this.scrollOffset = clamp(this.scrollOffset, 0, Math.max(0, this.items.length - this.maxVisible));
	}

	private notifySelectionChange(): void {
		const item = this.items[this.selectedIndex];
		if (item !== undefined) this.onSelectionChange?.(item);
	}
}
