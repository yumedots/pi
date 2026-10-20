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
| Port | `rpi/crates/rpi-tui/src/utils.rs:276` (`wrap_text_with_ansi`, per character) and `rpi/crates/rpi-tui/src/editor.rs:194` (`wrap_line_ranges`, per character) |

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

**Status.** The shared wrap is fixed (2026-10-20): `rpi/crates/rpi-tui/src/utils.rs:695`
`wrap_text_with_ansi` is token-based with an ANSI tracker, and the crate's tests pin
`["Hello","World"]`, `["The quick","brown fox","jumps over","the lazy dog"]`, a broken
over-long word, no leading whitespace on a line and the ANSI state across the wrap. The
editor's own wrap (`rpi/crates/rpi-tui/src/editor.rs:194`, `wrap_line_ranges`) was still
per character at the time of writing — the port must break the input box at word
boundaries too.

## 2. The input box has no height cap and no internal scrolling

**What the user sees.** A long draft makes the prompt box grow without limit and push
the transcript off the screen. The original caps the input at 12 content lines and
scrolls inside the box.

| | |
|---|---|
| Original | `packages/tui/src/components/editor.ts:255-284` (`EditorOptions.contentHeight`, `maxContentHeight`, `showScrollHints`); app values `packages/coding-agent/src/modes/interactive/interactive-mode.ts:376` (`EDITOR_MAX_CONTENT_HEIGHT = 12`) and `:676-677` |
| Port | `rpi/crates/rpi-tui/src/editor.rs:37-46` — `EditorOptions` has only `padding_x`, `autocomplete_max_visible`, `placeholder`, `initial_text`; no cap anywhere, and `rpi/crates/rpi-cli/src/interactive_tui.rs:1425-1428` makes the editor `shrink(0).min_size(3)` so it keeps growing |

**Observed.** `grep -n "max_content_height\|scroll_hint" rpi/crates/rpi-tui/src/editor.rs`
→ no hits.

**Check.**
* Rust: a test that renders a 30-line draft at width 40 and asserts the box is at most
  12 content lines plus the frame, and that the hidden-line report says how many lines
  are above/below.
* Parity: the `startup` scenario with a long multi-line draft.

## 3. The caret is invisible in the multi-line input

**What the user sees.** The prompt has no visible caret when the terminal's hardware
cursor is hidden (or while an overlay has the focus). The original draws a reverse-video
block over the character under the caret.

| | |
|---|---|
| Original | `packages/tui/src/components/editor.ts:731,736` (`renderFakeCursor(...)` over the grapheme under the caret, or a trailing space); markers and resolution `packages/tui/src/tui.ts:219-227` and `:1583-1585` (the fake cursor becomes `\x1b[7m` when the hardware cursor is hidden) |
| Port | `rpi/crates/rpi-tui/src/editor.rs:1483` — only `insert_cursor_marker(...)` (the APC hardware-cursor marker). No `FAKE_CURSOR_START` / `FAKE_CURSOR_END` / `renderFakeCursor` anywhere in the tree |

**Observed.** `grep -rn "FAKE_CURSOR\|renderFakeCursor" rpi/crates/rpi-tui/src/` → no hits.
(The single-line `Input` does invert the caret — `rpi/crates/rpi-tui/src/input.rs:675` —
so only the multi-line editor is affected.)

**Check.**
* Rust: a test asserting the editor's rendered content line contains the fake-cursor
  markers around the caret grapheme, and that the alt screen turns them into `\x1b[7m`
  when the hardware cursor is off (and drops them when it is on).
* Parity: none directly (the harness pane has a visible hardware cursor) — a unit test
  is the check.

## 4. The mouse reaches only the select list

**What the user sees.** Clicking in the prompt does not move the caret; the wheel over
the prompt scrolls the transcript instead of the overflowing draft; the settings/menu
lists cannot be hover-selected; the autocomplete list is not clickable.

| | |
|---|---|
| Original | `packages/tui/src/components/editor.ts:813-850` (click positions the caret, the wheel scrolls the text inside the box, the autocomplete list is clickable), `packages/tui/src/components/input.ts:234`, `packages/tui/src/components/settings-list.ts:187,211` (hover-to-select via `applyHover`), `packages/tui/src/components/box.ts:80` (forwards the event to its children), `packages/tui/src/components/mouse-region.ts:25` |
| Port | the trait has the hook (`rpi/crates/rpi-tui/src/component.rs:130`, `handle_mouse`) and the alt screen dispatches clicks (`rpi/crates/rpi-tui/src/tui_alt_screen.rs:1381-1401`), but only `rpi/crates/rpi-tui/src/select_list.rs:675` implements it. `grep -n "mouse" rpi/crates/rpi-tui/src/{editor,input,settings_list,box_component}.rs` → no hits |

**Check.**
* Rust: a test that sends a `MouseEventKind::Click` to the editor at a column and asserts
  the caret moved; a test that a wheel event over an overflowing editor scrolls the editor
  and not the transcript; a test that a `move` event over a settings row moves the
  selection.
* Parity: the `panels` scenario (mouse is not in the harness, so unit tests are the check).

## 5. Transcript search finds matches but never highlights or jumps to them

**What the user sees.** The search bar counts the matches, but the transcript does not
highlight them and the view does not move to the match. The original draws the matches
underlined in the transcript, the current one in another colour, and scrolls it into view.

| | |
|---|---|
| Original | `packages/tui/src/tui-alt-screen.ts:176,178` (`searchMatchStyle`, `searchCurrentMatchStyle`), `:1525` (paints the match), `:600-680` (`refreshSearch` scrolls the selected match into view), `packages/tui/src/alt-screen-search.ts:197` (overlay with next/previous buttons) |
| Port | `rpi/crates/rpi-tui/src/alt_screen_search.rs:300` has a `highlight_line` helper that **is never called** (`grep -rn "highlight_line" rpi/crates/` finds only the definition); the `on_match` callback (`:219-222`) is never wired, so the view never scrolls to the match; the port shows a flat bar (`rpi/crates/rpi-tui/src/search_bar.rs:10`, `rpi/crates/rpi-cli/src/interactive_tui.rs:2740-2790`) |

**Check.**
* Rust: a test that renders a transcript with a match and asserts the match is highlighted
  in the painted line, and that `next_match` scrolls the primary scroll view.
* Parity: a scenario with `Ctrl+Shift+F` and a query.

## 6. Clicking a link does nothing

**What the user sees.** An OSC 8 link in the transcript cannot be opened with the mouse.

| | |
|---|---|
| Original | `packages/tui/src/tui-alt-screen.ts:192` (`openUrl`), wired at `:265` |
| Port | the hook exists (`rpi/crates/rpi-tui/src/tui_alt_screen.rs:1282`, `set_url_opener`) but the CLI never calls it — `grep -rn "set_url_opener" rpi/crates/rpi-cli/` → no hits |

**Check.** Rust: a test that clicks a link and asserts the opener callback ran. The CLI
must call `set_url_opener`.

## 7. Wheel scrolling: 3 lines per notch, no acceleration, no Alt multiplier

**What the user sees.** The transcript jumps three lines per wheel notch and never speeds
up. The original moves one line per notch and accelerates a fast spin to six, and Alt+wheel
moves five times as far.

| | |
|---|---|
| Original | `packages/tui/src/wheel-scroll.ts:35` (`WheelScrollAccelerator`: 1 line at rest, up to 6 for a fast spin, 200 ms gesture gap), `packages/tui/src/tui-alt-screen.ts:169-172,286,735-739` (default `"auto"`, app passes `"auto"` at `packages/coding-agent/src/modes/interactive/tui-renderer.ts:34`; Alt+wheel ×5) |
| Port | `rpi/crates/rpi-tui/src/tui_alt_screen.rs:403` — `wheel_scroll_lines: AtomicI32::new(3)`, fixed per event (`:1437`), no accelerator, no Alt handling; the CLI never calls `set_wheel_scroll_lines` |

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
| scroll view overscroll | `packages/tui/src/components/scroll-view.ts:10` (`overscroll: "chain" \| "contain"`, default `chain`), honoured at `packages/tui/src/tui-alt-screen.ts:1028` (the chain stops at a `contain` view) | declared but never read: `rpi/crates/rpi-tui/src/scroll_view.rs:58` (`OverscrollMode`), and the alt screen always chains the leftover wheel delta to the primary view (`rpi/crates/rpi-tui/src/tui_alt_screen.rs:1439-1451`). Nothing in the original sets `contain` today, so the gap is latent, not visible |

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
| Port | `rpi/crates/rpi-tui/src/utils.rs:9-65` — `visible_width` sums `UnicodeWidthStr::width(char)` **per character**, so a ZWJ sequence counts every member; it only delegates to `rpi/crates/rpi-tui/src/ansi.rs:15` (which measures the whole string and is correct) when the string carries an OSC/APC sequence. The same per-character walk is in `slice_by_column` (`rpi/crates/rpi-tui/src/utils.rs:71-152`, the comment says "grapheme width" but it measures one char at a time, so it can cut a cluster in half) and `truncate_to_width` (`:159-221`) |

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

**Status.** The width part is fixed (2026-10-20): `utils::visible_width` now measures the
whole text (`rpi/crates/rpi-tui/src/utils.rs:12`) and the emoji test is in the crate. The
cluster-safe `slice_by_column` and `truncate_to_width` are still open — they still walk
character by character, so they can cut an emoji cluster in half.

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

## Verification baseline (2026-10-20, after the wrap and width fix)

The captures only compare with the goldens when the port runs in **fullscreen** mode: the
original's default is `tuiMode: "fullscreen"`
(`packages/coding-agent/src/core/settings-defaults.ts:64`), the port's default is regular
on macOS (`rpi/crates/rpi-cli/src/args.rs:90`). With a wrapper that appends
`--tui-mode fullscreen`:

| scenario | golden (lines per step) | port (lines per step) | difference |
|---|---|---|---|
| startup | 25, 25 | 25, 25 | **identical** |
| panels | 25 × 5 | 25 × 5 | **identical** |
| prompt | 25, 30 | 25, 30 | 1 (the content starts one row lower in the original; the tmux warning is wrapped at 96 columns in the original and at 100 in the port) |
| tool | 25, 30, 30 | 30, 30, 30 | 3 (the footer format, the booted height, the one-row offset) |
| thinking | 25, 30 | 30, 30 | 2 (the footer format, the one-row offset) |
| markdown | 25, 30 | 30, 30 | 2 (the footer format, the one-row offset) |

The footer difference is the interactive-mode footer, not the TUI library. Any **new**
difference in these panes after a TUI library change is a regression.

How to reproduce:

```
cd /Users/gabriel/pi-native/rpi && cargo build -p rpi-cli
cd /Users/gabriel/pi-native
PI_PARITY_RUST_BIN=/tmp/rpi-fullscreen.sh node scripts/parity/drive.mjs rust <scenario>
node scripts/parity/compare.mjs rust <scenario>
```

(`scripts/parity/out/` is gitignored, so the captures do not dirty the tree.)

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
