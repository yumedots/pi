import type { TuiMouseEvent } from "../tui.ts";

/**
 * A list whose selection can be moved with the mouse pointer.
 *
 * Implementations map a rendered row to the item on it, and move the
 * selection. Lists differ in how rows map to items: rows can span several
 * lines, and a list can put a search box above its items.
 */
export interface HoverableList {
	/** Index of the item on the given row, or undefined when the row holds no item. */
	indexAtRow(row: number): number | undefined;
	/** Move the selection to an index. Returns true when the selection changed. */
	select(index: number): boolean;
}

/**
 * Move a list's selection to the item under the mouse pointer.
 *
 * Only pointer motion with no button held counts as a hover. A drag carries a
 * button and belongs to the component that captured the press, so it must not
 * move the selection here.
 *
 * Returns true when the selection changed, so the caller can repaint.
 */
export function applyHover(event: TuiMouseEvent, list: HoverableList): boolean {
	if (event.type !== "move") return false;
	const index = list.indexAtRow(event.y);
	if (index === undefined) return false;
	return list.select(index);
}
