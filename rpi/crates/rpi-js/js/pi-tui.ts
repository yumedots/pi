/**
 * The `@earendil-works/pi-tui` module the extensions import.
 *
 * It is pi's own TUI code, re-exported from the parts that render: the width
 * helpers, the text/box/select components, the key helpers, and the container.
 * The terminal driver is not part of it — the Rust host owns the terminal.
 */

export {
	applyBackgroundToLine,
	flattenLines,
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "../../../../packages/tui/src/utils.ts";
export { Text } from "../../../../packages/tui/src/components/text.ts";
export { Box } from "../../../../packages/tui/src/components/box.ts";
export { SelectList, type SelectItem } from "../../../../packages/tui/src/components/select-list.ts";
export { Container, CURSOR_MARKER, renderFakeCursor } from "../../../../packages/tui/src/tui.ts";
export { isKeyRelease, Key, matchesKey, parseKey } from "../../../../packages/tui/src/keys.ts";
export { fuzzyFilter } from "../../../../packages/tui/src/fuzzy.ts";
export type { Component, TUI } from "../../../../packages/tui/src/tui.ts";
