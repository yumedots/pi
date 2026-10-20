# TUI library — what the port now matches, and what it does not

Port: `/Users/gabriel/pi-native/rpi/crates/rpi-tui/src/…`
Original: `/Users/gabriel/pi/packages/tui/src/…` (read only)

This is the porter's own notes for the TUI library area. The audit with the
file:line evidence is `TUI-LIBRARY.md`; this file records what was changed and
what still differs.

---

## 1. Word wrapping — DONE

| | |
|---|---|
| Original | `packages/tui/src/utils.ts:900` `wrapTextWithAnsi` (token based), `packages/tui/src/components/editor.ts:126` `wordWrapLine` (word aware, breaks between CJK graphemes) |
| Port | `rpi/crates/rpi-tui/src/utils.rs` `wrap_text_with_ansi`, `rpi/crates/rpi-tui/src/editor.rs` `wrap_line_ranges` |

The port now tokenises the text into words and spaces (a CJK grapheme is a
token of its own), keeps a word whole when it does not fit, breaks only a word
wider than the row, trims trailing whitespace and never starts a row with
whitespace. The active ANSI state is tracked and re-opened on the continuation
row, so a coloured run stays coloured.

The ANSI tracker, the tokeniser and `break_long_word` live in `utils.rs`.
`line_diff.rs`'s row isolation is gone: the original's wrap does not close a
row with a full reset, and the port's helper did, so the port's rows ended
with `\x1b[0m` where the original's end with the style that is still open. The
style is re-opened on every continuation row instead, and a patched row is
closed by `line_diff::patch`.

**Checks** (`cargo test -p rpi-tui --lib`):
`test_wrap_text` (changed to ["Hello","World"]), `the_wrap_breaks_at_word_boundaries`,
`a_word_longer_than_the_row_is_broken`, `a_cjk_run_breaks_between_characters`,
`trailing_whitespace_never_starts_a_line`, `the_ansi_state_carries_across_the_wrap`,
`the_underline_starts_on_the_row_that_carries_the_styled_text`,
`the_underline_reset_does_not_follow_a_space`,
`an_underlined_row_ends_with_the_underline_reset_and_not_a_full_reset`,
`a_background_colour_survives_the_wrap_without_a_full_reset`,
`a_underline_inside_a_background_resets_only_the_underline`,
`a_plain_text_row_never_exceeds_the_width`,
`the_line_endings_are_all_a_break`, `the_ansi_state_survives_every_line_ending`,
`a_cjk_run_breaks_after_latin_text`,
`the_editor_wrap_breaks_at_word_boundaries`,
`the_editor_wrap_matches_the_original_at_every_width`,
`the_editor_wrap_breaks_a_word_wider_than_the_row`,
`the_editor_wrap_breaks_between_cjk_characters`,
`the_editor_renders_the_draft_broken_at_word_boundaries`.

The ANSI cases are the original's own test file
(`packages/tui/test/wrap-ansi.test.ts`), verbatim.

## 2. Grapheme-accurate width — DONE (audit finding 23)

| | |
|---|---|
| Original | `packages/tui/src/utils.ts:250` `visibleWidth` measures grapheme clusters |
| Port | `rpi/crates/rpi-tui/src/ansi.rs` `visible_width`, `rpi/crates/rpi-tui/src/utils.rs` `visible_width` |

`utils::visible_width` used to sum the width of every code point, so
`👨‍👩‍👧` measured 6 columns and `❤️` measured 1. It now measures the whole
string, and `unicode-width` does the cluster work. `slice_by_column` and
`truncate_to_width` walk graphemes too, so they cannot cut a cluster in half.

**Checks**: `an_emoji_cluster_measures_two_columns`,
`a_truncation_never_cuts_an_emoji_cluster`, `a_slice_never_cuts_an_emoji_cluster`.

## 3. The input box height cap — DONE

| | |
|---|---|
| Original | `packages/tui/src/components/editor.ts:255-284` `EditorOptions.contentHeight`, `maxContentHeight`, `showScrollHints`; app values `packages/coding-agent/src/modes/interactive/interactive-mode.ts:376` (12) and `:677` (`showScrollHints: false`) |
| Port | `rpi/crates/rpi-tui/src/editor.rs` `EditorOptions.content_height`, `max_content_height`, `show_scroll_hints`; app wiring `rpi/crates/rpi-cli/src/interactive_tui.rs` |

The box keeps a fixed height, the overflow scrolls inside it, and the caret
follows the scroll unless the wheel pinned the view. The hidden-line report
(` ↑ N more` / ` ↓ N more`) is drawn on the card's top and bottom rows, the
same rows the original uses for it; the app ships it off.

**Checks**: `the_input_box_caps_its_content_and_scrolls_inside`,
`the_input_box_reports_the_hidden_lines`.

## 4. The caret (fake cursor) — DONE

| | |
|---|---|
| Original | `packages/tui/src/components/editor.ts:721-737` `renderFakeCursor`, `packages/tui/src/tui.ts:219-227` the markers, `:1583-1585` the resolution |
| Port | `rpi/crates/rpi-tui/src/ansi.rs` `FAKE_CURSOR_START`/`FAKE_CURSOR_END`, `rpi/crates/rpi-tui/src/editor.rs` `caret_decoration`, `rpi/crates/rpi-tui/src/tui_alt_screen.rs` `resolve_fake_cursors` |

The editor emits the hardware cursor marker followed by the fake cursor around
the grapheme under the caret (a trailing space when the caret is at the end of
the row). The alt screen turns the markers into `\x1b[7m` … `\x1b[27m` when
the hardware cursor is hidden, and drops the fake cursor of the focused caret
when the hardware cursor is shown.

**Checks**: `the_caret_is_drawn_with_the_fake_cursor_markers`,
`the_caret_at_the_end_of_the_line_is_a_reversed_space`.

## 5. The mouse — DONE for the input box and the settings list

| | |
|---|---|
| Original | `packages/tui/src/components/editor.ts:813-850` (click places the caret, the wheel scrolls the text), `packages/tui/src/components/settings-list.ts:187-233` (hover, wheel, press, click) |
| Port | `rpi/crates/rpi-tui/src/editor.rs` `handle_click`/`handle_wheel`, `rpi/crates/rpi-tui/src/settings_list.rs` `handle_mouse` |

A click in the input puts the caret on the clicked cell, the wheel over an
overflowing input scrolls the input (and pins the view until the next key
press), and hovering a settings row moves the selection without scrolling the
list out from under the pointer.

**Checks**: `a_click_in_the_input_moves_the_caret`,
`the_wheel_scrolls_the_overflowing_input`,
`hovering_a_row_moves_the_selection`, `a_drag_does_not_move_the_selection`,
`a_click_on_a_row_activates_it`.

---

## 6. The caret placement after `set_text` — DONE

| | |
|---|---|
| Original | `packages/tui/src/components/editor.ts:1325` `setText` → `setTextInternal(text)` with the default placement `"end"` (`:1355-1359`); the history recall uses `"start"` |
| Port | `rpi/crates/rpi-tui/src/editor.rs` `set_text` (the end) and `set_text_at_start` (the start) |

`set_text` now leaves the caret at the end of the last line, and the scroll
goes back to the top of the box (the original's `setTextInternal` resets the
scroll too). The history recall has its own placement, `set_text_at_start`.

The CLI still compensates in
`rpi/crates/rpi-cli/src/interactive_tui/events.rs:46-51`
(`set_editor_text_caret_at_end`) — that helper is now redundant, and the
history recall in `rpi/crates/rpi-cli/src/interactive_tui/state.rs:962-971`
should call `set_text_at_start` (the original's up-arrow placement). Both are
in the interactive mode's files, so I did not touch them.

**Checks**: `setting_the_text_leaves_the_caret_at_the_end`,
`the_history_recall_keeps_its_own_placement`.

## Still open

* The single-line `Input` has no yank-pop (Alt+Y) — the original binds it at
  `packages/tui/src/components/input.ts:169-170`.
* The port's `Editor` has no paste-marker-aware segmentation for the *caret
  movement* beyond what it already had; the wrap keeps a folded-paste marker
  whole (`editor_line_segments`), but the caret can still land inside one.
* `crate::ansi::slice_by_column` (the one the layout and the alt screen use)
  still strips the ANSI codes instead of preserving them; it has a `TODO` in
  the file. `utils::slice_by_column` preserves them and is grapheme-aware.
* The original's `wordWrapLine` recurses forever on a grapheme wider than the
  row; the port breaks the row instead (a crash is not a behaviour to copy).
