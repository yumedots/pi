import { getKeybindings } from "../keybindings.ts";
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "../tui.ts";
import { applyBackgroundToLine, truncateToWidth, visibleWidth } from "../utils.ts";
import { applyHover, type HoverableList } from "./list-hover.ts";

export interface BlockListTheme {
	block: (text: string) => string;
	selection: (text: string) => string;
	track: (text: string) => string;
	thumb: (text: string) => string;
}

export interface BlockListOptions<T> {
	draw: (item: T, selected: boolean, width: number) => string;
}

const SCROLLBAR_COLUMNS = 2;
const MIN_THUMB_ROWS = 2;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

/**
 * Keyboard-driven list where every row is a full-width block and the right
 * column is a scrollbar that tracks the selection.
 */
export class BlockList<T> implements Component, HoverableList {
	private items: T[];
	private selectedIndex = 0;
	private scrollOffset = 0;
	private maxVisible: number;
	private theme: BlockListTheme;
	private draw: (item: T, selected: boolean, width: number) => string;
	private mousePressedIndex: number | undefined;

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

		const contents: string[] = [];
		const selectedFlags: boolean[] = [];
		for (let row = 0; row < visibleRows; row++) {
			const index = this.scrollOffset + row;
			const item = this.items[index];
			if (item === undefined) {
				contents.push("");
				selectedFlags.push(false);
				continue;
			}
			const selected = index === this.selectedIndex;
			contents.push(truncateToWidth(this.draw(item, selected, contentWidth), contentWidth, "…"));
			selectedFlags.push(selected);
		}

		let thumbTop = 0;
		let thumbHeight = 0;
		if (scrollbar) {
			thumbHeight = Math.max(
				Math.min(MIN_THUMB_ROWS, visibleRows),
				Math.round((visibleRows * visibleRows) / this.items.length),
			);
			const maxScrollTop = this.items.length - this.maxVisible;
			thumbTop = maxScrollTop > 0 ? Math.round((this.scrollOffset / maxScrollTop) * (visibleRows - thumbHeight)) : 0;
		}

		return contents.map((content, row) => {
			const isThumb = scrollbar && row >= thumbTop && row < thumbTop + thumbHeight;
			const gutter = scrollbar ? ` ${isThumb ? this.theme.thumb("█") : this.theme.track("│")}` : "";
			// Pad the content before the gutter so the scrollbar stays at the right edge.
			const padded = content + " ".repeat(Math.max(0, contentWidth - visibleWidth(content)));
			// The row background covers the scrollbar gutter too, so a panel behind
			// the list does not show through next to the selected row.
			const bg = selectedFlags[row] ? this.theme.selection : this.theme.block;
			return applyBackgroundToLine(`${padded}${gutter}`, width, bg);
		});
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
		// Hovering a row moves the keyboard highlight to it.
		if (applyHover(event, this)) {
			this.notifySelectionChange();
			return { handled: true, render: true };
		}
		if (event.button !== "left" || (event.type !== "press" && event.type !== "click")) return undefined;

		const index = this.scrollOffset + event.y;
		if (event.y < 0 || event.y >= Math.min(this.maxVisible, this.items.length) || index >= this.items.length) {
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

	/** Index of the item on the given row, or undefined when the row holds no item. */
	indexAtRow(row: number): number | undefined {
		if (row < 0 || row >= Math.min(this.maxVisible, this.items.length)) return undefined;
		const index = this.scrollOffset + row;
		return index < this.items.length ? index : undefined;
	}

	/**
	 * Move the selection. The window keeps the selected row in view, which a
	 * hover stays inside anyway, so the row under the pointer does not move.
	 */
	select(index: number): boolean {
		if (index === this.selectedIndex) return false;
		this.setSelectedIndex(index);
		return true;
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
