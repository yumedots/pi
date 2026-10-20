# TUI library parity — TypeScript original vs. Rust port

Area: the TUI library only.

* Original: `/Users/gabriel/pi/packages/tui/src/` (branch `perf/lightweight-harness`)
* Port: `/Users/gabriel/pi-native/rpi/crates/rpi-tui/src/` (branch `feat/rpi-native`)

Every row carries the `file:line` on both sides, how it was observed, and the check
that settles it. Ranked by what a user notices first.

Reading the port: `rpi/crates/rpi-tui/src/…` below means the path relative to
`/Users/gabriel/pi-native/`. Reading the original: `packages/tui/src/…` below means the
path relative to `/Users/gabriel/pi`.

---

## 1. Word wrapping is character-wise in the port, word-aware in the original

**What the user sees.** Every wrapped line in the app is different: the port fills each
line to the exact column and breaks words in the middle, the original keeps a word whole
and moves it to the next line. It shows in the transcript, in tool output, in the bash
panel and in the input box.

| | |
|---|---|
| Original | `packages/tui/src/utils.ts:900` (`wrapTextWithAnsi`, token based) and `packages/tui/src/components/editor.ts:126` (`wordWrapLine`, breaks at whitespace and between CJK graphemes) |
| Port | `rpi/crates/rpi-tui/src/utils.rs:693` (`wrap_text_with_ansi`, per character) and `rpi/crates/rpi-tui/src/editor.rs:227` (`wrap_line_ranges`, per character) |

**Observed.**

```
node -e "require('/Users/gabriel/pi/packages/tui/dist/utils.js').wrapTextWithAnsi('Hello World',5)"
→ ["Hello","World"]
node -e "...wrapTextWithAnsi('The quick brown fox jumps over the lazy dog',12)"
→ ["The quick","brown fox","jumps over","the lazy dog"]
```

The port's own test pins the wrong behaviour and has to change with the fix:

```
cargo test -p rpi-tui --lib utils::tests::test_wrap_text     # passes today
rpi/crates/rpi-tui/src/utils.rs:479
assert_eq!(lines, vec!["Hello", " Worl", "d"]);                // must become ["Hello", "World"]
```

The port's `wrap_text_with_ansi` is what the tool panels, the bash panel, the `Text`
component and the mermaid renderer use (`rpi/crates/rpi-tui/src/tool_execution.rs:390`,
`rpi/crates/rpi-tui/src/bash_execution.rs:359`, `rpi/crates/rpi-tui/src/text.rs:86`), so
fixing the one function fixes all of them.

**Check.**
* Rust: a test in `utils.rs` pinning `wrap_text_with_ansi("Hello World", 5) == ["Hello", "World"]`
  and `wrap_text_with_ansi("The quick brown fox jumps over the lazy dog", 12) == ["The quick","brown fox","jumps over","the lazy dog"]`;
  the same for `wordWrapLine`/`wrap_line_ranges` in the editor (a long word moves to the next
  line; a word longer than the width is broken; a CJK run breaks between characters).
* Parity: the `tool` and `markdown` scenarios in `scripts/parity/drive.mjs` show the
  wrapped text; the mock server's tool output is the fixture to compare.

**Status.** Fixed (2026-10-20). `rpi/crates/rpi-tui/src/utils.rs` `wrap_text_with_ansi` is
token-based with an ANSI tracker, and `rpi/crates/rpi-tui/src/editor.rs:227`
`wrap_line_ranges` is a faithful port of the original's `wordWrapLine` (the same
backtrack condition, the same conservative break, the trailing space kept on the row,
the CJK break opportunity). The crate's tests pin the original's exact output:
`["Hello","World"]`, `["The quick","brown fox","jumps over","the lazy dog"]`, the broken
over-long word, no leading whitespace on a row, the ANSI state across the wrap, the CJK
run, and the editor's rows at the original's widths.

The original's editor width is `layoutWidth = textWidth - (paddingX ? 0 : 1)`
(`packages/tui/src/components/editor.ts:648`); the port computes the same
(`rpi/crates/rpi-tui/src/editor.rs:1745`).

## 2. The input box has no height cap and no internal scrolling

**What the user sees.** A long draft makes the prompt box grow without limit and push
the transcript off the screen. The original caps the input at 12 content lines and
scrolls inside the box.

| | |
|---|---|
| Original | `packages/tui/src/components/editor.ts:255-284` (`EditorOptions.contentHeight`, `maxContentHeight`, `showScrollHints`); app values `packages/coding-agent/src/modes/interactive/interactive-mode.ts:376` (`EDITOR_MAX_CONTENT_HEIGHT = 12`) and `:676-677` |
| Port | `rpi/crates/rpi-tui/src/editor.rs:38-58` — `EditorOptions` has only `padding_x`, `autocomplete_max_visible`, `placeholder`, `initial_text`; no cap anywhere, and `rpi/crates/rpi-cli/src/interactive_tui.rs:1425-1428` makes the editor `shrink(0).min_size(3)` so it keeps growing |

**Observed.** `grep -n "max_content_height\|scroll_hint" rpi/crates/rpi-tui/src/editor.rs`
→ no hits.

**Check.**
* Rust: a test that renders a 30-line draft at width 40 and asserts the box is at most
  12 content lines plus the frame, and that the hidden-line report says how many lines
  are above/below.
* Parity: the `startup` scenario with a long multi-line draft.

**Status.** Fixed (2026-10-20): `EditorOptions` has `content_height`, `max_content_height`
and `show_scroll_hints` (`rpi/crates/rpi-tui/src/editor.rs:49-52`), the box keeps a fixed
height, the overflow scrolls inside it, the caret follows the scroll unless the wheel
pinned the view, and the hidden-line report is drawn on the card's top and bottom rows
(the original draws it in the border row; the port's card has no rule to sit in, and the
app sets `show_scroll_hints: false` like the original, so the user sees neither). The app
sets `max_content_height: 12` at the editor construction, like the original.

One thing to watch: the port's `height_limit()` clamped `max_content_height` with
`min(rows / 2)`, which the original does not do — the original's cap is absolute
(`packages/tui/src/components/editor.ts:269-273`). At 12 the clamp bites in a terminal
shorter than 24 rows. Reported to the porter.

## 3. The caret is invisible in the multi-line input

**What the user sees.** The prompt has no visible caret when the terminal's hardware
cursor is hidden (or while an overlay has the focus). The original draws a reverse-video
block over the character under the caret.

| | |
|---|---|
| Original | `packages/tui/src/components/editor.ts:731,736` (`renderFakeCursor(...)` over the grapheme under the caret, or a trailing space); markers and resolution `packages/tui/src/tui.ts:219-227` and `:1583-1585` (the fake cursor becomes `\x1b[7m` when the hardware cursor is hidden) |
| Port | `rpi/crates/rpi-tui/src/editor.rs:1790` — only `insert_cursor_marker(...)` (the APC hardware-cursor marker). No `FAKE_CURSOR_START` / `FAKE_CURSOR_END` / `renderFakeCursor` anywhere in the tree |

**Observed.** `grep -rn "FAKE_CURSOR\|renderFakeCursor" rpi/crates/rpi-tui/src/` → no hits.
(The single-line `Input` does invert the caret — `rpi/crates/rpi-tui/src/input.rs:675` —
so only the multi-line editor is affected.)

**Check.**
* Rust: a test that the editor's rendered content line contains the fake-cursor
  markers around the caret grapheme, and that the alt screen turns them into `\x1b[7m`
  when the hardware cursor is off (and drops them when it is on).
* Parity: none directly (the harness pane has a visible hardware cursor) — a unit test
  is the check.

**Status.** Fixed (2026-10-20): `FAKE_CURSOR_START` / `FAKE_CURSOR_END` are in
`rpi/crates/rpi-tui/src/ansi.rs`, the editor emits the hardware marker followed by the
fake cursor around the grapheme under the caret (a trailing space at the end of the row),
and `rpi/crates/rpi-tui/src/tui_alt_screen.rs:171` `resolve_fake_cursors` turns the
markers into `\x1b[7m`…`\x1b[27m` when the hardware cursor is hidden and drops the
focused fake cursor when it is shown — the same rule as the original
(`packages/tui/src/tui.ts:1583-1585`).

## 4. The mouse reaches only the select list

**What the user sees.** Clicking in the prompt does not move the caret; the wheel over
the prompt scrolls the transcript instead of the overflowing draft; the settings/menu
lists cannot be hover-selected; the autocomplete list is not clickable.

| | |
|---|---|
| Original | `packages/tui/src/components/editor.ts:813-850` (click positions the caret, the wheel scrolls the text inside the box, the autocomplete list is clickable), `packages/tui/src/components/input.ts:234`, `packages/tui/src/components/settings-list.ts:187,211` (hover-to-select via `applyHover`), `packages/tui/src/components/box.ts:80` (forwards the event to its children), `packages/tui/src/components/mouse-region.ts:25` |
| Port | the trait has the hook (`rpi/crates/rpi-tui/src/component.rs:130`, `handle_mouse`) and the alt screen dispatches clicks (`rpi/crates/rpi-tui/src/tui_alt_screen.rs:1381-1401`), but only `rpi/crates/rpi-tui/src/select_list.rs:697` implements it. `grep -n "mouse" rpi/crates/rpi-tui/src/{editor,input,settings_list,box_component}.rs` → no hits |

**Check.**
* Rust: a test that sends a `MouseEventKind::Click` to the editor at a column and asserts
  the caret moved; a test that a wheel event over an overflowing editor scrolls the editor
  and not the transcript; a test that a `move` event over a settings row moves the
  selection.
* Parity: the `panels` scenario (mouse is not in the harness, so unit tests are the check).

**Status.** Fixed (2026-10-20): the editor takes a click (the caret lands on the clicked
cell) and the wheel (the input scrolls and the view stays pinned until the next key
press); the settings list takes the mouse in the original's order — the submenu first,
the search input on row 0, the wheel moves the selection, the hover through
`crate::list_hover::apply_hover`, the press selects and the click activates. The tests
in the crate cover the click, the wheel, the hover, that a drag does not move the
selection, and that a click activates a row.

## 5. Transcript search finds matches but never highlights or jumps to them

**What the user sees.** The search bar counts the matches, but the transcript does not
highlight them and the view does not move to the match. The original draws the matches
underlined in the transcript, the current one in another colour, and scrolls it into view.

| | |
|---|---|
| Original | `packages/tui/src/tui-alt-screen.ts:176,178` (`searchMatchStyle`, `searchCurrentMatchStyle`), `:1525` (paints the match), `:600-680` (`refreshSearch` scrolls the selected match into view), `packages/tui/src/alt-screen-search.ts:197` (overlay with next/previous buttons) |
| Port | `rpi/crates/rpi-tui/src/alt_screen_search.rs:302` has a `highlight_line` helper that **is never called** (`grep -rn "highlight_line" rpi/crates/` finds only the definition); the `on_match` callback (`:219-222`) is never wired, so the view never scrolls to the match; the port shows a flat bar (`rpi/crates/rpi-tui/src/search_bar.rs:10`, `rpi/crates/rpi-cli/src/interactive_tui.rs:2740-2790`) |

**Check.**
* Rust: a test that renders a transcript with a match and asserts the match is highlighted
  in the painted line, and that `next_match` scrolls the primary scroll view.
* Parity: a scenario with `Ctrl+Shift+F` and a query.

## 6. Clicking a link does nothing

**What the user sees.** An OSC 8 link in the transcript cannot be opened with the mouse.

| | |
|---|---|
| Original | `packages/tui/src/tui-alt-screen.ts:192` (`openUrl`), wired at `:265` |
| Port | the hook exists (`rpi/crates/rpi-tui/src/tui_alt_screen.rs:1310`, `set_url_opener`) but the CLI never calls it — `grep -rn "set_url_opener" rpi/crates/rpi-cli/` → no hits |

**Check.** Rust: a test that clicks a link and asserts the opener callback ran. The CLI
must call `set_url_opener`.

## 7. Wheel scrolling: 3 lines per notch, no acceleration, no Alt multiplier

**What the user sees.** The transcript jumps three lines per wheel notch and never speeds
up. The original moves one line per notch and accelerates a fast spin to six, and Alt+wheel
moves five times as far.

| | |
|---|---|
| Original | `packages/tui/src/wheel-scroll.ts:35` (`WheelScrollAccelerator`: 1 line at rest, up to 6 for a fast spin, 200 ms gesture gap), `packages/tui/src/tui-alt-screen.ts:169-172,286,735-739` (default `"auto"`, app passes `"auto"` at `packages/coding-agent/src/modes/interactive/tui-renderer.ts:34`; Alt+wheel ×5) |
| Port | `rpi/crates/rpi-tui/src/tui_alt_screen.rs:380` — `wheel_scroll_lines: AtomicI32::new(3)`, fixed per event (`:1437`), no accelerator, no Alt handling; the CLI never calls `set_wheel_scroll_lines` |

**Check.** Rust: a test for the accelerator (one notch → 1 line; a fast spin → up to 6;
Alt → ×5). Parity: not covered by the harness.

## 8. The colour algebra is missing (and truecolour is never downgraded)

**What the user sees.** On a 256-colour terminal the port emits 24-bit colour sequences
that the original downgrades to the 256-colour cube. The theme colours are also
hand-approximated instead of derived in oklch, and there is no way to mix or parse colours.

| | |
|---|---|
| Original | `packages/tui/src/colors.ts` — `parseColor:121`, `mixColors:241`, `colorToRgb:218`, `colorToOklch:229`, `colorToHex:235`, `oklchColor:81`, `okhslColor:107`, `indexedColor:62`, `styleText:317` / `styleTextWithAnsi:330` (bold, dim, italic, underline, inverse, **strikethrough**), plus the whole `packages/tui/src/oklab.ts` |
| Port | `rpi/crates/rpi-tui/src/theme.rs:274` — `enum Color { Default, Ansi16, Ansi256, Rgb }`, `to_fg:287`, `to_bg:295`; no parsing, no mixing, no oklch/okhsl, no strikethrough helper (`rpi/crates/rpi-tui/src/ansi.rs` has bold/italic/underline/inverse/dim only) |

The downgrade the original does: `packages/tui/src/colors.ts:299-307` (`colorAnsi` picks
`38;5;N` when the mode is not truecolour) driven by `getTerminalColorMode`
(`packages/tui/src/terminal-capabilities.ts:144`). The port's `Color::Rgb` always emits
`38;2;r;g;b`, and the port's theme uses `Color::Rgb` for real tokens
(`rpi/crates/rpi-tui/src/theme.rs:141-145,155-170`).

**Check.** Rust: a test that a `Color::Rgb` theme token renders as `38;5;N` when the
terminal reports 256 colours. Parity: not covered (the harness pane is truecolour).

## 9. The program never reports its status to the terminal (OSC 7501)

**What the user sees.** Terminals that show the program's state (the "busy" indicator in
Ghostty and iTerm) never see it.

| | |
|---|---|
| Original | `packages/tui/src/program-status.ts:20,46` (`PROGRAM_STATUS_QUERY`, `formatProgramStatus`), wired at `packages/tui/src/terminal.ts:239` (support query at start) and `:578,583` (idle/working/blocked/done/error) |
| Port | **missing** — `grep -rn "7501" rpi/crates/` → 0 hits |

**Check.** Rust: a test that the terminal writes the OSC 7501 sequence for a status
change.

## 10. Terminal capabilities: no `trueColor`, no `hyperlinks`, no env overrides

**What the user sees.** On a terminal the detector mis-classifies, the user cannot force
the image protocol, truecolour or hyperlinks.

| | |
|---|---|
| Original | `packages/tui/src/terminal-capabilities.ts:6` — `{ images, trueColor, hyperlinks }`; `:112-133` — `PI_IMAGE_PROTOCOL`, `PI_TRUE_COLOR`, `PI_HYPERLINKS`; `:153` `setCapabilityOverrides`; `:144` `getTerminalColorMode` |
| Port | `rpi/crates/rpi-tui/src/terminal_image.rs:20-27` — `TerminalCapabilities { protocol, cell_width, cell_height, columns, rows }`; `:115` `detect_capabilities`; no `set_capability_overrides` |

The hyperlink probe was re-implemented, but inside the markdown renderer
(`rpi/crates/rpi-tui/src/markdown.rs:2019-2090`, including the tmux `client_termfeatures`
probe) instead of the capability module.

**Check.** Rust: a test that `PI_IMAGE_PROTOCOL=kitty` is honoured.

## 11. The `Terminal` contract lost several capabilities

**What the user sees.** After quitting over a slow SSH connection, Kitty key-release
sequences can leak into the shell (the original drains stdin first). Escape sequences are
resolved with the terminal's own timing rather than the original's 10 ms / 100 ms-over-SSH
rule.

| | |
|---|---|
| Original | `packages/tui/src/terminal.ts:78-135` — `drainInput`, `moveBy`, `clearLine`, `clearFromCursor`, `setProgramStatus`, `kittyProtocolActive`; `:136` `resolveEscapeTimeoutMs` (10 ms, 100 ms over SSH, `PI_TUI_ESC_TIMEOUT`); `:23-27` keyboard-protocol negotiation; `:44,71` Apple Terminal detection and normalisation |
| Port | `rpi/crates/rpi-tui/src/terminal.rs:99-170` — the trait has `clear_screen`, `move_cursor`, `set_progress`, `set_title` but no `drain_input`, no `clear_line`/`clear_from_cursor`, no `set_program_status`; the keyboard protocol is env-gated (`rpi/crates/rpi-tui/src/terminal.rs:60-69`, `RPI_KITTY_KEYBOARD`) instead of negotiated |

`grep -rn "drain_input\|clear_line\|escape_timeout" rpi/crates/` → 0 hits.

**Check.** Rust: a test for the escape timeout (10 ms, 100 ms over SSH).

## 12. Image rendering: no PNG transcoding, no Kitty placement bookkeeping, different fallback text

**What the user sees.** A pasted JPEG is announced to Kitty as PNG and does not render.
Scrolling a partially visible image does not crop it. The fallback text is a block box
instead of `[Image: file.jpg image/jpeg 800x600]`.

| | |
|---|---|
| Original | `packages/tui/src/components/image.ts:40-56` (`toPng` + `setImageTranscoder`; non-PNG is converted for Kitty and the PNG's own dimensions are re-read because of EXIF rotation), `packages/tui/src/terminal-image.ts:202-330` (per-image placement registry: `registerKittyImageMetadata`, `getKittyImagePlacement`, `cropKittyImageLine`, `calculateImageCellSize`, `deleteAllKittyPlacements` — the image is transmitted once and only re-placed/cropped while scrolling), `packages/tui/src/terminal-image.ts:603-616` (`imageFallback`) |
| Port | `rpi/crates/rpi-tui/src/terminal_image.rs:179` — `encode_kitty` hardcodes `a=T,f=100` (declares PNG) but sends the raw bytes; no transcoder in `rpi/crates/rpi-tui/src/image.rs`; no placement registry in `rpi/crates/rpi-tui/src/terminal_image.rs:429`; `image_fallback(_alt_text, width)` (`:448`) ignores the alt text, the mime type and the dimensions |

**Check.** Rust: a test that a JPEG payload is transcoded to PNG before `encode_kitty`,
and that `image_fallback` renders the mime type and the dimensions.

## 13. The autocomplete provider contract is much smaller, and the file search is shallower

**What the user sees.** `@` completes only the current directory (the original walks the
tree with `fd` and honours `.gitignore`), `~` is not expanded, and a slash command cannot
complete its own arguments.

| | |
|---|---|
| Original | `packages/tui/src/autocomplete.ts:271-300` — `AutocompleteProvider` is async, cancellable (`AbortSignal`), works on `lines[] + cursorLine + cursorCol`, and has `applyCompletion(...)` and `shouldTriggerFileCompletion(...)`; `:257` `SlashCommand.getArgumentCompletions?(prefix)`; `:292` `triggerCharacters` (default `["@","#"]`, `packages/tui/src/components/editor.ts:292`); `:565` `expandHomePath` (`~`); `:787` `getFuzzyFileSuggestions` (walks the tree with `fd`, honours `.gitignore`); `:512` mention items; `:119-146` quoted paths |
| Port | `rpi/crates/rpi-tui/src/autocomplete.rs:107-113` — `trait AutocompleteProvider { fn get_suggestions(&self, input: &str, cursor: usize) -> Option<AutocompleteSuggestions>; fn name(&self) -> &str; }`: synchronous, single-line string, no cancellation, no `applyCompletion`, no `triggerCharacters`, no `shouldTriggerFileCompletion`; `:117-122` `SlashCommand { name, description }` — no argument completions; `:154-181` `extract_path_prefix` handles `@` and a leading `"` but not `~`; `:184-227` `get_path_completions` lists one directory with a prefix filter |

**Check.** Rust: a test that `~` expands to the home directory, and that the file provider
finds a file in a subdirectory.

## 14. Key-table differences inside the TUI key table — **RESOLVED 2026-10-20**

All 46 `tui.*` ids of the original exist in the port; three defaults differed and the
port added two bindings of its own.

| id | original | port (before the fix) |
|---|---|---|
| `tui.altScreen.bottom` | `ctrl+e` (`packages/tui/src/keybindings.ts:207`) | `end` |
| `tui.altScreen.previousPrompt` | `["ctrl+shift+up","ctrl+up"]` (`packages/tui/src/keybindings.ts:190`) | `["ctrl+shift+up"]` |
| `tui.altScreen.nextPrompt` | `["ctrl+shift+down","ctrl+down"]` (`packages/tui/src/keybindings.ts:196`) | `["ctrl+shift+down"]` |
| `tui.altScreen.top` | unbound | `home` (port only) |
| `tui.editor.cursorLineStart` | `["home","ctrl+a"]` | `["home","ctrl+home","ctrl+a"]` (extra `ctrl+home`) |
| `tui.editor.cursorLineEnd` | — | `end`, `ctrl+end`, `ctrl+e` (port only) |

**Status.** The keybindings port landed the fix on 2026-10-20: the port now binds
`ctrl+e` for `tui.altScreen.bottom` (`rpi/crates/rpi-tui/src/keybindings.rs:894`), leaves
`tui.altScreen.top` unbound (`:887`), and binds `ctrl+up`/`ctrl+down` next to
`ctrl+shift+up`/`ctrl+shift+down` (`:821`, `:837`). `node scripts/parity/audit.mjs keys`
now reports **identical: every id, every default key** (89 ids on both sides).

The audit script had to be fixed first — see the note at the end of this file.

## 15. Component option and theme gaps

| what | original | port |
|---|---|---|
| custom row renderer in a select list | `packages/tui/src/components/select-list.ts:35` (`SelectListLayoutOptions.renderItem`) | missing (`rpi/crates/rpi-tui/src/select_list.rs:100`) |
| search field inside the settings list | `packages/tui/src/components/settings-list.ts` (`SettingsListOptions.enableSearch`) | missing (no `SettingsListOptions` in `rpi/crates/rpi-tui/src/settings_list.rs:95`) |
| settings list theme tokens | `label` / `cursor` / `hint` | `key` / `selected` / `selected_prefix` (`rpi/crates/rpi-tui/src/settings_list.rs:95`) |
| themed scrollbar track and thumb | `packages/tui/src/components/scroll-view.ts:6` (`scrollbarTrackStyle`, `scrollbarThumbStyle`) | missing (`rpi/crates/rpi-tui/src/scroll_view.rs:48`; the port paints a hard-coded thumb) |
| markdown source transform | `packages/tui/src/components/markdown.ts:226` (`MarkdownOptions.transform`) | missing (`rpi/crates/rpi-tui/src/markdown.rs:22`) |
| markdown LaTeX toggle | `packages/tui/src/components/markdown.ts:228` (`renderLatex`, default on) | missing (always rendered) |
| markdown theme | 16 per-element style callbacks (`packages/tui/src/components/markdown.ts:200-218`) | a fixed `TextStyle` enum over theme tokens (`rpi/crates/rpi-tui/src/markdown.rs:713-731`) |
| scroll view overscroll | `packages/tui/src/components/scroll-view.ts:10` (`overscroll: "chain" \| "contain"`, default `chain`), honoured at `packages/tui/src/tui-alt-screen.ts:1028` (the chain stops at a `contain` view) | declared but never read: `rpi/crates/rpi-tui/src/scroll_view.rs:58` (`OverscrollMode`), and the alt screen always chains the leftover wheel delta to the primary view (`rpi/crates/rpi-tui/src/tui_alt_screen.rs:1467-1479`). Nothing in the original sets `contain` today, so the gap is latent, not visible |

**Check.** Rust: one test per option that the option changes the rendered output.

## 16. Word navigation uses an ASCII punctuation list, not `Intl.Segmenter`

**What the user sees.** `ctrl+left` / `ctrl+right` jump over em dashes, ellipses and CJK
in the port; the original stops at them.

| | |
|---|---|
| Original | `packages/tui/src/word-navigation.ts:1-56` + `packages/tui/src/utils.ts:17` (`getWordSegmenter`, `Intl.Segmenter` word granularity), `packages/tui/src/utils.ts:1006` (`PUNCTUATION_REGEX`) |
| Port | `rpi/crates/rpi-tui/src/word_navigation.rs:6-21` — a hard-coded ASCII list (`- _ . / : \ ( ) [ ] { } < > = + * & \| ! @ # $ % ^ ~ ` , ; " '`) |

**Check.** Rust: a test that `find_word_backward` stops at an em dash.

## 17. The terminal's own light/dark report is not parsed

**What the user sees.** The port decides light or dark from the background luminance
instead of the terminal's declared appearance.

| | |
|---|---|
| Original | `packages/tui/src/terminal-colors.ts:85` (`parseTerminalColorSchemeReport`, CSI `?997;1n/2n`), `packages/tui/src/tui.ts:596-598` (`onTerminalColorSchemeChange`, `setTerminalColorSchemeNotifications`) |
| Port | `rpi/crates/rpi-tui/src/terminal_colors.rs:53-60` — light/dark from the luminance. The colour query itself is wired (`rpi/crates/rpi-tui/src/tui_alt_screen.rs:2078,2209-2214`) |

**Check.** Rust: a test that a `?997;2n` reply flips the theme to light.

## 18. The native-clipboard module has no counterpart in the library

| | |
|---|---|
| Original | `packages/tui/src/native-platform.ts:61` (`getNativeClipboard`), `native-modifiers.ts:5`, `native-module-path.ts:14`; used by `packages/coding-agent/src/utils/clipboard.ts:74,82,94` and `packages/coding-agent/src/utils/clipboard-image.ts:194` |
| Port | missing from `rpi-tui`; the CLI implements the clipboard with arboard (`rpi/crates/rpi-cli/src/interactive_tui/run.rs:372-428`, including image paste) |

Not a user-visible gap for the app, but an extension host cannot use it.

## 19. The TUI has no input-listener API

| | |
|---|---|
| Original | `packages/tui/src/tui.ts:164-165,588` (`TuiInputListener`, `addInputListener` / `removeInputListener`), used at `packages/coding-agent/src/modes/interactive/interactive-mode.ts:2354,2365` |
| Port | missing — `rpi/crates/rpi-tui/src/tui.rs:128-192` has no listener registration; `grep -rn "input_listener" rpi/crates/` → 0 hits |

## 20. The module with the same name has a different role: the stdin buffer

**What the user sees.** The port never reproduces the original's rule for a lone ESC
(a key press 10 ms after the ESC, 100 ms over SSH), and the module that carries the name
is not the one that does the work.

| | |
|---|---|
| Original | `packages/tui/src/stdin-buffer.ts:281-296` — `StdinBufferOptions { timeout (50 ms), escapeTimeout (10 ms) }`; the buffer **reassembles escape sequences split across chunks**, holds back a lone ESC until the escape timeout, and handles bracketed paste; events `data` / `paste` |
| Port | `rpi/crates/rpi-tui/src/stdin_buffer.rs:18-48` — `StdinBufferOptions { batch_timeout_ms, max_buffer_size, handle_bracketed_paste }`; events `Data` / `PasteStart` / `PasteEnd` / `Batch`. It is a **batcher**, and nothing uses it: `grep -rn "StdinBuffer" rpi/crates/` finds only the re-export in `rpi/crates/rpi-tui/src/lib.rs:147`. The sequence reassembly is left to crossterm's event reader |

**Check.** Rust: a test that a lone ESC is dispatched after the escape timeout, and that
the timeout grows over SSH (this is the same rule as finding 11 — the escape timeout
belongs to the terminal, not to the buffer).

## 21. No custom-editor slot: an extension cannot replace the input

**What the user sees.** An extension cannot provide its own editor (a vim or emacs mode
for the prompt) the way the original allows.

| | |
|---|---|
| Original | `packages/tui/src/editor-component.ts:12` — `EditorComponent` (`getText`, `setText`, `handleInput`, `onSubmit`, `onChange`, plus the optional `addToHistory`, `insertTextAtCursor`, `getExpandedText`, `setAutocompleteProvider`, `setAutocompletePosition`, …) |
| Port | missing — the extension host only offers `setEditorText` / `getEditorText` / `pasteToEditor` (`rpi/crates/rpi-js/js/extension-host.ts:302-304`); no `EditorComponent` equivalent exists in `rpi-tui` |

**Check.** Rust: an extension test that registers a custom editor and sees it used.

## 22. The autocomplete list pushes the transcript instead of floating over it

**What the user sees.** When the completion list opens (typing `/` or `@`), the original
draws it over the transcript — the transcript does not move and does not resize. The port
adds the list as a row of the dock, so the transcript shrinks and jumps while the list is
open.

| | |
|---|---|
| Original | `packages/tui/src/tui.ts:117-145` — `Component.renderOverlayAbove?(width)`, `getOverlayRow?()`, `getOverlayAboveRows?()`: "lines painted directly above the component's box, overlapping whatever is above it. They take up no layout height"; the layout paints them at `packages/tui/src/layout.ts:129-145` and `:327-360` (`paintOverlayAbove`), and they take part in the hit test through `overlayRect` (`packages/tui/src/layout.ts:474-487`) |
| Original use | `packages/tui/src/components/editor.ts:786-793` — the editor's autocomplete list floats above the input; also `packages/coding-agent/src/modes/interactive/components/centered.ts:33-38`, `components/menu.ts:122`, `components/empty-session-screen.ts:37-41` |
| Port | the trait has no overlay-above member (`rpi/crates/rpi-tui/src/component.rs:105-160`); `LayoutBox` has no `overlayLines` / `overlayRect` (`rpi/crates/rpi-tui/src/layout.rs:60-81`); the list is a dock row (`rpi/crates/rpi-cli/src/interactive_tui.rs:1441`, `autocomplete_container` as an auto-sized `VStack` child) |

The port also has no "below" option to fall back to: the original's
`autocompletePosition` setting (`packages/coding-agent/src/core/settings-schema.ts:380`,
default `above`) has no counterpart in the port — and the port *does* read and offer the
setting without honouring it: `rpi/crates/rpi-cli/src/settings.rs:427`
(`autocomplete_position`), the settings menu row at
`rpi/crates/rpi-cli/src/interactive_tui/settings_menu.rs:607`, and the setter at
`rpi/crates/rpi-cli/src/interactive_tui/settings.rs:314`. Nothing reads it when the
list is placed, so setting `"below"` changes nothing.

**Check.**
* Rust: a test that the editor emits its autocomplete rows through an overlay-above hook
  and that the layout paints them over the rows above without changing the layout height.
* Parity: a scenario that types `/` and captures the pane — the transcript must not move.

## 23. Emoji are measured per character, so the layout drifts in the port

**What the user sees.** A line with an emoji is measured wider than the terminal draws
it: the port wraps early and the right-hand padding drifts. The same emoji measures
differently depending on whether the line carries ANSI codes.

| | |
|---|---|
| Original | `packages/tui/src/utils.ts:182-240` — `graphemeWidth` works on a grapheme cluster: an RGI emoji is 2 columns, a regional indicator is 2, a zero-width cluster is 0; `visibleWidth:250` sums the clusters |
| Port | `rpi/crates/rpi-tui/src/utils.rs:9-65` — `visible_width` sums `UnicodeWidthStr::width(char)` **per character**, so a ZWJ sequence counts every member; it only delegates to `rpi/crates/rpi-tui/src/ansi.rs:15` (which measures the whole string and is correct) when the string carries an OSC/APC sequence. The same per-character walk is in `slice_by_column` (`rpi/crates/rpi-tui/src/utils.rs:79-160`, the comment says "grapheme width" but it measures one char at a time, so it can cut a cluster in half) and `truncate_to_width` (`:159-221`) |

**Observed.**

```
node -e "const {visibleWidth}=require('/Users/gabriel/pi/packages/tui/dist/utils.js');
for (const c of ['👨‍👩‍👧','👍🏽','❤️']) console.log(JSON.stringify(c), visibleWidth(c));"
→ "👨‍👩‍👧" 2   "👍🏽" 2   "❤️" 2
```

The same strings measured by the port's own dependency (`unicode-width 0.1`):

```
per character:  "👨‍👩‍👧" 6   "👍🏽" 4   "❤️" 1
whole string:   "👨‍👩‍👧" 2   "👍🏽" 2   "❤️" 2
```

The port's per-character path is the one `utils::visible_width` uses, and it is what
`image.rs:13` and `alt_screen_search.rs:7` import. `unicode-width` already returns the
right answer for the whole string, so the fix is to stop splitting the string.

**Check.** Rust: a test that `visible_width("👨‍👩‍👧") == 2`, `visible_width("👍🏽") == 2`,
`visible_width("❤️") == 2`, and that a styled and an unstyled line with the same emoji
measure the same. This matters for the wrapping work in step 1: the wrap must measure
graphemes, not characters.

**Status.** Fixed (2026-10-20): `utils::visible_width` measures the whole text
(`rpi/crates/rpi-tui/src/utils.rs:12`), and `slice_by_column` and `truncate_to_width` walk
graphemes, so they cannot cut a cluster in half. The crate's tests pin the emoji widths
(styled and unstyled) and that a truncation and a slice never cut a cluster.

## 24. The regular (main) screen re-prints the whole transcript on every repaint

**What the user sees.** In regular mode the terminal scrollback fills with copies of the
transcript: every repaint (the spinner ticking while the agent works, the footer
updating) writes the whole transcript again. The original repaints only the lines that
changed, so the scrollback stays clean. This matters twice over, because the port
defaults to regular mode on macOS (see the note on the TUI mode default below).

| | |
|---|---|
| Original | `packages/tui/src/tui-main-screen.ts:125-165` — `previousLines`, `maxLinesRendered`, `previousViewportTop`; `:372-405` finds `firstChanged` / `lastChanged` and repaints only that range; a full redraw happens only on the first render, a width or height change, or `clearOnShrink` (`:367`) |
| Port | `rpi/crates/rpi-tui/src/tui_main_screen.rs:160-188` — `render_now` writes **every** line of the container on every render, and `request_render` calls it directly; there is no `previousLines`, no diffing and no `clearOnShrink` |

**Observed.** `grep -n "previous_lines\|max_lines_rendered" rpi/crates/rpi-tui/src/tui_main_screen.rs`
→ no hits. The port's main screen also has no `captureRenderState` / `restoreRenderState`
(the original has them at `packages/tui/src/tui-main-screen.ts:136-157` for the mode
switch), and no Kitty-image bookkeeping (`previousKittyImageIds`,
`packages/tui/src/tui-main-screen.ts:128`).

**Check.**
* Rust: a test that renders twice with a changed last line and asserts that only the
  changed range is written (the writer must see the new line, not the whole transcript);
  and a test that the scrollback does not grow when nothing changed.
* Parity: the captures of the regular mode (the default on macOS) — the pane must not
  show the transcript twice.

---

## 25. The single-line input has no yank-pop (Alt+Y)

**What the user sees.** In a search field (the transcript search, the session search, the
settings search) the killed text can be yanked back once (Ctrl+Y) but not cycled
(Alt+Y), while the multi-line editor supports both.

| | |
|---|---|
| Original | `packages/tui/src/components/input.ts:169-170` — `tui.editor.yankPop` (Alt+Y) → `yankPop()`; the kill ring is at `:53` and the undo stack at `:57` |
| Port | `rpi/crates/rpi-tui/src/input.rs` — the kill ring and the undo stack are there (`:11`, `:70`), and Ctrl+Y yanks, but the Alt arm of `handle_key` (`:578-583`) handles only `b`, `f` and `d`, so Alt+Y is not bound. The multi-line editor does have it (`rpi/crates/rpi-tui/src/editor.rs`, `yank_pop`) |

**Check.** Rust: a test that kills a word, yanks it, then presses Alt+Y and sees the
previous kill come back.

## 26. The window title uses OSC 2, the original uses OSC 0

**What the user sees.** The terminal title is set with a different escape sequence:
OSC 2 sets only the window title, OSC 0 sets the icon name and the window title, so in
terminals that show the icon name (iTerm2 and others) the title renders differently.

| | |
|---|---|
| Original | `packages/tui/src/terminal.ts:571-573` — `setTitle` writes `\x1b]0;{title}\x07` (OSC 0) |
| Port | `rpi/crates/rpi-tui/src/terminal.rs:327-329` — `set_title` writes `\x1b]2;{title}\x07` (OSC 2) |

The **text** is a different file: the original writes
`${APP_TITLE} - ${sessionName} - ${cwdBasename}` (or `${APP_TITLE} - ${cwdBasename}`
without a session name) at `packages/coding-agent/src/modes/interactive/interactive-mode.ts:1233-1235`,
with `APP_TITLE = "π"` (`packages/coding-agent/src/config.ts:588`); the port's
`rpi/crates/rpi-cli/src/brand.rs:76` builds `"▃ ▅ ▂ rpi · 🦀 …"` instead. That file belongs
to the branding agent, not to the TUI library.

**Check.** Rust: a test that `set_title` writes `\x1b]0;` and not `\x1b]2;`.

**Status.** Fixed (2026-10-20): `rpi/crates/rpi-tui/src/terminal.rs` writes OSC 0 and the
crate has the test `the_window_title_is_written_with_osc_zero`. The *text* is the
branding agent's file (`rpi/crates/rpi-cli/src/brand.rs`): the original's title is
`${APP_TITLE} - ${sessionName} - ${cwdBasename}` (`APP_TITLE` = "π",
`packages/coding-agent/src/config.ts:588`).

## 27. `set_text` leaves the caret at the start, the original's `setText` leaves it at the end

**What the user sees.** When a draft is restored programmatically (an extension setting
the editor text, a restored session draft), the original leaves the caret at the end of
the text and the port leaves it at the beginning.

| | |
|---|---|
| Original | `packages/tui/src/components/editor.ts:1325` — `setText` → `setTextInternal(normalized)`, whose default is `cursorPlacement = "end"` (`packages/tui/src/components/editor.ts:1355-1359`: the caret goes to the last line, at its end). The "start" placement is used only for the history recall (up-arrow → "start", down-arrow → "end") |
| Port | `rpi/crates/rpi-tui/src/editor.rs` — `set_text` sets `cursor_row = 0; cursor_col = 0;`. The CLI compensates with a helper (`rpi/crates/rpi-cli/src/interactive_tui/events.rs:46-51`, "Place the caret at the END of `text` after `set_text`") |

**Observed.** Rendering the same draft on both sides: the original's caret is after the
last character, the port's is on the first one.

**Check.** Rust: a test that `set_text("ab")` leaves the caret at the end (row 0, column
2), and that the history recall keeps its own placement.

**Status.** Fixed (2026-10-20): `Editor::set_text` puts the caret on the last line, at
its end, and the new `Editor::set_text_at_start` covers the history recall (the
original's "start" placement). The crate's tests pin both. Two call sites in the CLI
still use the old shape and belong to the interactive mode port:
`rpi/crates/rpi-cli/src/interactive_tui/events.rs:46-51` (a now-redundant
"put the caret at the end" helper) and
`rpi/crates/rpi-cli/src/interactive_tui/state.rs:962-971` (the history recall should use
`set_text_at_start`).

## 28. The `Text` component pads on one side only and wraps one column late

**What the user sees.** A padded text row in the port is one column wider than the
original's, so long text breaks at a different place: the tmux warning, for example, is
one row shorter in the port than in the original.

| | |
|---|---|
| Original | `packages/tui/src/components/text.ts:69-93` — `paddingX = Math.min(this.paddingX, Math.max(0, Math.floor((width - 1) / 2)))`, `contentWidth = Math.max(1, width - paddingX * 2)`, the text is wrapped at `contentWidth`, and every row is `leftMargin + line + rightMargin` (a margin on **both** sides), then padded to the full width |
| Port | `rpi/crates/rpi-tui/src/text.rs:83-94` — `content_width = width.saturating_sub(self.padding_x)` (one column less inset) and the row is `pad + wl`: the right margin is missing and the row is not padded to the width |

**Observed.** The parity capture of the `prompt` scenario: the original's tmux warning
row is 96 columns and wraps after "…`set -g extended-keys"; the port's is 100 columns and
fits "…`set -g extended-keys on`" on one line. The warning is rendered with
`Text::new(text, 1, 0)` (`rpi/crates/rpi-cli/src/interactive_tui/rendering.rs:74`) and the
original renders the same warning with `new ThemedText(() => theme.fg(color, message), 1, 0)`
(`packages/coding-agent/src/modes/interactive/interactive-mode.ts:3664`) — the same padding,
but the original's `Text` insets both sides, so it wraps at 98 and the port at 99.

The original's `Text` also has a background (`customBgFn` / `setCustomBgFn`,
`packages/tui/src/components/text.ts:26,53`); the port's has no background function (the
port paints its panels with a `Box` instead, so nothing is broken today, but the library's
`Text` is not the original's `Text`).

**Check.** Rust: a test that `Text::new("…", 1, 0)` at width 100 wraps at 98 and the row
is 100 columns with a trailing margin. Parity: the `prompt` scenario — the tmux warning
row must become 96 columns and wrap after "…`set -g extended-keys".

**Status.** Fixed (2026-10-20): `rpi/crates/rpi-tui/src/text.rs` now insets both sides
(`padding_x = min(padding_x, (width - 1) / 2)`, `content_width = width - padding_x * 2`),
pads every row to the full width, turns tabs into three spaces, draws nothing for a blank
text and supports a background (`set_background`, the original's `setCustomBgFn`). Two
consequences had to be fixed in the same change: the `HStack` child's intrinsic width (it
claimed the whole row because the rows are padded now) and two `visual_truncate`
expectations. The crate's tests pin it, and the capture shows the tmux warning wrapping
at 98 exactly like the golden.

## 29. The tool result is drawn twice in the transcript

**What the user sees.** After a tool runs, the tool's output appears twice in the
transcript: once in the tool panel and once as the assistant's message. The original draws
it once.

**Observed.** The `tool` scenario's pane, with the mock sending a `read` call and then the
text "The fixture file says hello." (`scripts/parity/drive.mjs:31-36`; the fixture file
contains the same sentence, so the tool result and the assistant's message are identical):
* golden: `[12]=" read the fixture"`, `[16]=" read tool-input.txt"`, `[17]=""`, `[18]=""`, `[19]=" The fixture file says hello."`
* port: `[12]=" read the fixture"`, `[17]=" read tool-input.txt"`, `[18]=""`, `[19]=" The fixture file says hello."`, `[20]=""`, `[21]=" The fixture file says hello."`

Everything before row 12 matches the golden exactly.

The original's tool panel always adds the result renderer when there is a result
(`packages/coding-agent/src/modes/interactive/components/tool-execution.ts:317-343`) and the
read renderer returns the file's output with a leading newline
(`packages/coding-agent/src/core/tools/renderers/read.ts:127-136`), so the text appears
once, inside the panel.

**Where the extra row comes from.** It is the **tool panel's own result renderer**, printed
inline while the panel is collapsed — not a second transcript row and not the dispatch:
* `tool_result_message_text` (`rpi/crates/rpi-cli/src/interactive_tui.rs:838`) has exactly
  one call site in the tree, the restored-session renderer
  (`rpi/crates/rpi-cli/src/interactive_tui/sessions.rs:372`), where the panel is rebuilt
  from the session file; there is no live-path caller;
* the live path does not render a tool-result text row either:
  `rpi/crates/rpi-cli/src/interactive_tui/events.rs:311-313` ignores the `ToolResult` arm
  of `MessageStart` ("ToolResult / other starts are echoed via the tool-execution
  components; ignore the dupes") and `MessageUpdate` only drives the assistant message.

So the panel in `rpi/crates/rpi-tui/src/tool_execution.rs` (the collapsed rendering of the
result region, next to the reserved height) prints the result text where the original
prints only the call row until the output is expanded (Ctrl+O).

**The decisive check.** The `tool` golden is stale on the TypeScript side (captured
against `cb87143e`, the current original is `108b350c`), so re-capture it first
(`node scripts/parity/drive.mjs ts tool`) and compare the rows: the original shows the call
row and then blanks, with the single "The fixture file says hello." being the assistant's
own reply.

**Check.** Parity: the `tool` scenario — the text must appear once. (The golden for that
scenario is stale on the TypeScript side and has to be re-captured first.)

**Status.** The panel half is fixed (2026-10-20): the read renderer was already right
(`rpi/crates/rpi-tui/src/tool_renderers.rs:509-512` returns nothing for a collapsed,
non-error result, exactly like `packages/coding-agent/src/core/tools/renderers/read.ts:126-128`)
— the panel was dropping the *empty* result region, and it now keeps the row
(`rpi/crates/rpi-tui/src/tool_execution.rs`, `render_with_renderer`), with the check
`a_collapsed_read_panel_keeps_the_empty_result_region`. The rule stays "the renderer
decides, the panel keeps whatever rows the renderer produced", so bash's collapsed preview
is untouched.

**Correction.** My first report of this said the port showed the tool result *twice*. That
was measured against a stale binary: the port's panel was right and the transcript was
one row *short*. The remaining row is the user message's trailing spacer (the language
lead's `add_user_message`), reported to them.

## 30. The assistant message has no leading spacer, so the transcript is one row short

**What the user sees.** With a long assistant message the visible window starts one row
lower than the original's: the first line of the reply is cut off above the viewport.

**Observed.** The `markdown` scenario, with the mock's markdown reply: the golden's rows
0-24 are the port's rows 1-25 — the port's " - first item" is above the viewport. The
markdown renderer itself is identical (I rendered the same reply with both
implementations: the rows match exactly, "- first item" included), so this is the spacing.

| | |
|---|---|
| Original | `packages/coding-agent/src/modes/interactive/components/assistant-message.ts:154-156` — a `Spacer(1)` before the content when there is visible content; the host's spacer goes **before** each entry (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:848-849`) → two blank rows between the previous entry and the assistant's text |
| Port | `rpi/crates/rpi-tui/src/assistant_message.rs:310-313` — the leading spacer is deliberately omitted ("the host adds a Spacer(1) after each transcript entry"), but the host's spacer goes **after** each entry (`rpi/crates/rpi-cli/src/transcript_view.rs:320,340`, `set_trailing_spacing(1)`) → one blank row, and the transcript is one row short per assistant message |

**Check.** Rust: a test that an assistant message with visible content renders a blank
row before its text. Parity: the `markdown` scenario — the body must start at the
original's row 0 with " - first item". The component half is the TUI library's
(`assistant_message.rs:304-313`, where `has_visible` is already computed); the host half
(`set_trailing_spacing(1)`) is the interactive mode's. The two land together.

**Status.** Fixed (2026-10-20): the component adds the leading spacer
(`rpi/crates/rpi-tui/src/assistant_message.rs`, `rebuild_content`, with the test
`an_assistant_message_starts_with_a_blank_row`) and the interactive mode port dropped the
host's `set_trailing_spacing(1)` in the live and the restored-session paths. The
`markdown` scenario is byte-identical to pi's golden trace.

## 31. The thinking duration is measured with the animation clock, so it is always 0.0 s

**What the user sees.** The collapsed thinking summary reads `+ Thought · 0.0s` where the
original reads the real duration (`+ Thought · 0.1s` in the parity capture).

**Observed.** The `thinking` scenario: the golden's row is `+ Thought · 0.1s`, the port's
is `+ Thought · 0.0s`.

| | |
|---|---|
| Original | `packages/coding-agent/src/modes/interactive/components/assistant-message.ts:100-108` — `trackThinkingRun` times the run with the **wall clock**: `timing.startedAt ??= Date.now(); timing.endedAt = Date.now();`. The harness freezes only `performance.now()` (`scripts/parity/clock-preload.mjs`), so `Date.now()` is real |
| Port | `rpi/crates/rpi-tui/src/assistant_message.rs:443` — `track_thinking_run` reads `crate::clock::now_ms()`, and `rpi/crates/rpi-tui/src/clock.rs:12-20` returns the **frozen** `PI_PARITY_CLOCK` value when the harness sets it, so every reading in a parity run is the same millisecond and the measured span is 0 |

The port's `track_thinking_run` is otherwise a faithful port of the original's
`trackThinkingRun` (including the `isStreaming` guard, so a restored message shows no
duration) — the clock it reads is the difference, and that also explains why the run looks
like it "arrives in a single update": with the clock frozen, every update lands on the
same millisecond.

**Check.** Rust: a wall-clock reading next to `now_ms()` in
`rpi/crates/rpi-tui/src/clock.rs` (ignoring `PI_PARITY_CLOCK`), used only by the thinking
timing — the logo3d animation and the loader stay on the frozen clock. A test that a run
tracked across two updates separated by a real delay reports a non-zero duration, also
with `PI_PARITY_CLOCK` set to a fixed value. The capture's row will then be
`+ Thought · <a real duration>`; it is not a byte-identical row, because the number is the
wall-clock time between the mock's chunks.

## Verification baseline (2026-10-20, 20:05)

`cargo build --workspace` was green at 19:40, and the port's default is now fullscreen on
every platform (the original's default is `tuiMode: "fullscreen"`,
`packages/coding-agent/src/core/settings-defaults.ts:64`), so the captures compare with the
goldens directly, without a flag:

```
# The agents build in their own target directory, so a developer running
# `cargo run` in the same tree is never blocked by an agent's build.
cd /Users/gabriel/pi-native
scripts/agent-cargo.sh build --workspace
export PI_PARITY_RUST_BIN=/Users/gabriel/pi-native/rpi/target-agents/debug/rpi
node scripts/parity/drive.mjs rust <scenario>
cd scripts/parity && node compare.mjs rust <scenario>
```

Do not run bare `cargo` from the agents: it uses the developer's target directory and
serialises against their `cargo run`. If a build fails with an unresolved import that the
source plainly has, it is a stale artifact, not a source error — `cargo clean -p rpi-ai
-p rpi-agent -p rpi-harness` and rebuild before editing anything.

(`scripts/parity/out/` is gitignored, so the captures do not dirty the tree.)

| scenario | result |
|---|---|
| startup | **identical** to the golden |
| panels | **identical** to the golden |
| prompt | **identical** to the golden |
| markdown | **identical** to the golden |
| tool | 2 steps differ by **one blank row**: the port's reply sits one row lower — the user message's trailing spacer (the original's echo has none; the Markdown's own `paddingY: 1` supplies the blank row under the text, packages/coding-agent/src/modes/interactive/components/user-message.ts:43-48). The language lead's `add_user_message`. The panel's half is fixed (the empty result region is kept) |
| thinking | 1 step differs: the `+ Thought · 0.0s` duration against the original's `+ Thought · 0.1s` — the port times the run with the frozen animation clock (finding 31, the TUI library's) |

What closed during this session, in the TUI library: the wrap (the shared one and the
editor's), the grapheme width, the input box cap and the hidden-line report, the fake
cursor, the click-to-place-the-caret and the wheel over the input, the settings list
hover, the `Text` padding and background, the window title escape (OSC 0), `set_text`'s
caret placement, the collapsed tool panel keeping the empty result region (finding 29) and
the assistant message's leading spacer (finding 30). What closed outside it: the header
block's leading and trailing Spacer (the language lead), the user message's leading
spacer, the host's trailing spacing (the interactive mode port) and the TUI mode default
(fullscreen on every platform).

`scripts/agent-cargo.sh test -p rpi-tui --lib` → **527 passed, 0 failed**;
`scripts/agent-cargo.sh build --workspace` → green.

Any **new** difference in these panes after a TUI library change is a regression.

## Verified as parity (do not redo)

Component contract (`packages/tui/src/tui.ts:117` / `rpi/crates/rpi-tui/src/component.rs:105`),
container, VStack/HStack sizing, layout frame and hit testing
(`packages/tui/src/layout.ts:437,474` / `rpi/crates/rpi-tui/src/layout.rs:635`), overlay
compositing and anchors, differential rendering with the 16 ms cap
(`packages/tui/src/tui.ts:609,704` / `rpi/crates/rpi-tui/src/tui_alt_screen.rs:35,260`),
the hardware-cursor APC marker, Kitty key-release filtering, main screen vs. alt screen
modes, the keybinding registry shape and conflict detection, the kill ring, the undo/redo
stack, the character-jump mode, the paste-marker folding, the prompt history,
`fuzzyMatch` / `fuzzyFilter` (a faithful port), the LaTeX renderer, the markdown basics
(40 fixtures per `FEATURES.md`), the loader and the cancellable loader, the select list,
the settings list, the scroll view, the alt-screen mouse pipeline, `MouseRegion`
(`rpi/crates/rpi-tui/src/mouse.rs:67`) and `list_hover`
(`rpi/crates/rpi-tui/src/list_hover.rs:8,23`) — the last two landed after `FEATURES.md`
was written, so that file understates the port.

## The audit script (fixed 2026-10-20)

`scripts/parity/audit.mjs` misread the key tables: the Rust extractor stopped at the
first `)` inside `Char('b')` and lost the modifiers, and the TypeScript extractor only
matched definitions whose `{` ended the line, so single-line definitions were dropped.
Both are fixed (balanced-paren scan, block-bounded body, modifier normalisation, the
`pageUp`/`pageDown` spelling). The platform conditionals are now resolved for the host
(macOS, not Windows) on both sides: `process.platform === "win32" ? … : …`,
`windowsKeybindings ? … : …` and `process.platform === "darwin" ? … : …` on the
TypeScript side, `if cfg!(windows) { … } else { … }` and
`if cfg!(target_os = "macos") { … } else { … }` on the Rust side. The comparison of the
keys of one id is a set comparison, so the order inside a list does not count as a
difference. The settings section was also fixed: it looked only for
`#[serde(rename = …)]` and reported zero port keys, while the port's plain struct fields
are the keys; the comparison is now case- and underscore-insensitive.

`node scripts/parity/audit.mjs keys` now reports **identical: every id, every default
key** (89 ids on both sides), and the settings section reports 60 keys on both sides.
