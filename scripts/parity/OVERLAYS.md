# Overlays & popups parity — TypeScript original vs. Rust port

Area: the panels, popups, status widgets and viewport overlays the user sees over the
chat: the models panel, the settings menu and its submenus, question/confirm dialogs,
notifications, the countdown timer, the loader, the progress bar, the flash banner, the
scrollbar, mouse-wheel scrolling and the jump-to-end indicator.

* Original: `/Users/gabriel/pi/packages/tui/src/` and
  `/Users/gabriel/pi/packages/coding-agent/src/modes/interactive/` (branch `perf/lightweight-harness`)
* Port: `/Users/gabriel/pi-native/rpi/crates/rpi-tui/src/` and
  `/Users/gabriel/pi-native/rpi/crates/rpi-cli/src/` (branch `feat/rpi-native`)

This is an **audit** — nothing was changed in either tree. Every row carries the
`file:line` on both sides, how it was observed, and the check that settles it. Ranked by
what a user notices first.

**How it was observed.** The parity harness (`scripts/parity/drive.mjs`) drives both
programs in tmux at a fixed 100×30 pane against a frozen clock and a mock model server.
For this area the harness was extended (a copy in `/tmp`, the harness itself was not
modified) with two step types that the stock driver lacks:

* `hex` — inject a raw SGR mouse sequence (`ESC [ < 64 ; col ; row M`) so the wheel and
  the click paths can be exercised;
* `once` — read the pane exactly once instead of waiting for it to stabilise, so a
  1-second transient banner can be caught.

Scenarios driven: boot, `Ctrl+L` (models panel), `/settings` + `Enter` (settings menu),
`Enter` on a submenu row, `Ctrl+S` in the models panel, `Escape` at every level, a run
with a long `bash` tool call (loader / working indicator / progress bar), `Escape` during
the run (interrupt), a 60-line reply (scrollbar / jump-to-end / wheel), `Ctrl+X` (flash),
`/copy` (notification), `/compact` (compaction).

Paths below: `rpi/crates/…` is relative to `/Users/gabriel/pi-native/`, `packages/…` is
relative to `/Users/gabriel/pi/`.

---

## Re-verification (2026-10-20, after the port's settings rewrite)

**This table is a source-level snapshot; the runtime table below it is the verdict.** The
per-row `Status` lines further down are the ones the audit wrote at the time; the port
then moved (the settings list was rewritten with a search field, a hint line, aligned
values, a description block and nested submenus, and the `rpi-tui` crate gained an
`agent_progress.rs`). The table below re-reads the source after that rewrite; the table
after it re-measures all twenty rows against a freshly relinked binary. Where the two
disagree, the runtime table wins.

| # | Finding | Status now | Where |
|---|---|---|---|
| 1 | Default TUI mode | **Fixed in source** — fullscreen on every platform, like the original | `rpi/crates/rpi-cli/src/args.rs:90-94`, test `:1181-1185` |
| 2 | `/settings` not searchable | **Fixed in source** — search field + hint line | `rpi/crates/rpi-cli/src/interactive_tui/settings.rs:127` (`.with_search()`), `rpi/crates/rpi-tui/src/settings_list.rs:306-315`, `:650-655` (hint), `:673-676` (search row) |
| 3 | Settings values unaligned / description inline | **Fixed in source** — labels padded into a column, description in a block below the list | `rpi/crates/rpi-tui/src/settings_list.rs:702-726`, `:745-752` |
| 4 | Escape in a submenu closes everything | **Fixed in source** — the list owns its submenu and restores the parent row | `rpi/crates/rpi-tui/src/settings_list.rs:127` (`with_submenu_factory`), `:259` (`close_submenu`), `:509` (`has_open_submenu`), test `:1059` |
| 5 | Submenus drop title / description / hint | **Fixed for the settings submenus** (a `SubmenuFrame` with title, description, search, list and hint). The standalone searchable panels (models / provider / login) still have no hint | `rpi/crates/rpi-cli/src/interactive_tui/settings_menu.rs:141-143`; still open at `rpi/crates/rpi-tui/src/searchable_select.rs:112-146` |
| 6 | Models panel has no footer / hint line | **Open** | `rpi/crates/rpi-tui/src/searchable_select.rs:112-146` |
| 7 | `Ctrl+S` "set as default" | **Partly** — the binding now exists; the models panel's handler is still unverified at runtime | `rpi/crates/rpi-tui/src/keybindings.rs:413-416`, const `:1056` |
| 8 | No placeholder while focused | **Partly** — the root cause is fixed (the placeholder now renders while focused), but the searchable panels build their input with `Input::new()`, so the models panel still shows a bare `>` where the original shows `> Search` | fixed: `rpi/crates/rpi-tui/src/input.rs:619-625`; still open: `rpi/crates/rpi-tui/src/searchable_select.rs:41` |
| 9 | Jump-to-end overwrites the transcript row | **Open** (needs a runtime re-check) | `rpi/crates/rpi-tui/src/jump_to_end.rs:29` |
| 10 | No transcript scrollbar | **Open** | `rpi/crates/rpi-cli/src/interactive_tui/panels.rs:574` |
| 11 | Wheel scrolls 3 lines / notch | **Open** | `rpi/crates/rpi-tui/src/tui_alt_screen.rs:429` |
| 12 | No progress bar | **Partly** — `rpi/crates/rpi-tui/src/agent_progress.rs` now exists (a port of the original's `progress-bar.ts`), but **nothing in `rpi-cli` references it**, so it is still invisible to the user | `rpi/crates/rpi-tui/src/agent_progress.rs:50` (`AgentProgressBar`), no call site in `rpi/crates/rpi-cli/src/` |
| 13 | "Terminal progress" label promises OSC 9;4 | **Fixed in source** — the row now reads `Show a progress line while the agent works`, like the original | `rpi/crates/rpi-cli/src/interactive_tui/settings_menu.rs:654-658` |
| 14 | `Working… 7s` vs `Working` | **Open** | `rpi/crates/rpi-cli/src/interactive_tui/state.rs:1146`, `rpi/crates/rpi-cli/src/interactive_tui.rs:1293` |
| 15 | Aborting a run leaves no trace | **Open** — no abort note anywhere in `rpi-cli` | `rpi/crates/rpi-cli/src/` (absence) |
| 16 | "Conversation compacted." when nothing was compacted | **Open** | `rpi/crates/rpi-cli/src/interactive_tui/run.rs:285` |
| 17 | No flash banner | **Open** — there is still no flash container in `rpi-tui` | `rpi/crates/rpi-tui/src/` (absence) |
| 18 | Empty-filter wording | **Fixed** — the generic list now says `No matching commands` and the settings list `No matching settings`, both exactly like the original | `rpi/crates/rpi-tui/src/select_list.rs:659` (test `:850`), `rpi/crates/rpi-tui/src/settings_list.rs:692` |
| 19 | `ask_user` hints hard-coded, no countdown | **Open** | `rpi/crates/rpi-cli/src/interactive_tui/extensions.rs:341`, `:449`, `:561`; `rpi/crates/rpi-cli/src/tui_shell/dialogs.rs:60`, `:122-124` |
| 20 | Settings change announced in the transcript | **Open** | `rpi/crates/rpi-cli/src/interactive_tui/settings.rs:88`, `:140` |

**What is still clearly worth a porter's time:** rows 6, 9, 10, 11, 14, 15, 16, 17, 19, 20.

---

## Runtime re-verification (fresh binary, 18:50)

Every row was re-measured against a **freshly relinked** `rpi/target/debug/rpi`
(`cargo build -p rpi-cli --bin rpi`, finished 18:50 — the previous binary predated the
settings rewrite). This is the authoritative verdict per row.

| # | Verdict on the fresh binary | Evidence |
|---|---|---|
| 1 | **Fixed** — the port is a fixed fullscreen viewport now, like the original | the pane is a 30-row viewport with the footer pinned to the bottom |
| 2 | **Fixed** — the settings panel has a search field and the hint line | `> theme` in the search field narrows the list to `Theme` + `Default thinking level per model`; `Type to search · Enter/Space to change · Esc to cancel` is printed under the list |
| 3 | **Fixed** — 35 rows, values in a column, description in a block below the list | `→ Auto-compact                      true` … `(1/35)` … blank … `  Automatically compact context when it gets too large` |
| 4 | **Fixed** — Escape in the theme submenu returns to the settings list, filter and row intact | after the submenu, the pane shows `> theme` / `→ Theme   dark` / `  Default thinking level per model  none` |
| 5 | **Fixed for the settings submenu** — title, description and hint are all there | `Theme` / `Select a theme, or choose automatic to follow terminal appearance.` / `→ ✓ dark` / `  Enter to select · Esc to go back`. The original's `system` / `automatic` rows are still missing (see `FEATURES.md`). The standalone searchable panels (models / provider / login) still have no hint line |
| 6 | **Open** — the models panel still has no footer line and no hint line | the panel ends at the last row: `Select model` / `Type to filter by name, provider, or id` / `>` / `→ ✓ mock-1   [mock]`. The original prints `Model catalogs refreshed.` and `Enter to select · Ctrl+S to set as default · Escape/Ctrl+C to cancel` |
| 7 | **Open** — `Ctrl+S` in the models panel still does nothing (the panel stays open, nothing is saved) | the pane after `Ctrl+S` is byte-identical to the pane before it |
| 8 | **Open** — the models panel's search box still shows a bare `>` where the original shows `> Search` | the port's searchable panels build their input with `Input::new()` (`rpi-tui/src/searchable_select.rs:41`) even though the placeholder rule itself is fixed (`rpi-tui/src/input.rs:619-625`) |
| 9 | **Open** — the jump-to-end label still overwrites the last transcript row and truncates the text under it | ` Line 59 of the long assistant r ↓ Jump to latest message · Ctrl+E` (the original paints `↓ Jump to latest message` on its own row below the transcript). The port's suffix also differs: `· Ctrl+E` against the original's no suffix |
| 10 | **Open** — still no scrollbar column in the transcript | `rpi/crates/rpi-cli/src/interactive_tui/panels.rs:574` (`ScrollbarMode::Hidden`) |
| 11 | **Open** — still 3 lines per wheel notch | 37 → 34 → 31 → 28 over three wheel events; the original moves 36 → 35 → 34 → 33 (1 line per notch) |
| 12 | **Fixed** — the hairline progress bar is on screen | with `terminal.showTerminalProgress` on, the port's top row is `▔▔▔▔▔▔…` during a run, exactly like the original (`rpi-tui/src/agent_progress.rs` is now wired in) |
| 13 | **Fixed** — the row reads `Show a progress line while the agent works`, like the original | `rpi/crates/rpi-cli/src/interactive_tui/settings_menu.rs:654-658` |
| 14 | **Open** — the working indicator still reads `⠴ Working… 7s` | the original prints `⠹ Working` |
| 15 | **Open** — an aborted run still leaves no trace | after `Escape` the transcript shows only `12.3s (exit 1)`; the original prints `Command aborted` and `Error: The operation was aborted.` |
| 16 | **Open** — `/compact` on an empty session still claims success | the port prints `ℹ Conversation compacted.`; the original errors `Compaction failed: Nothing to compact (session …)` |
| 17 | **Open** — there is still no flash banner; the copy feedback is a transcript note | `Ctrl+X` printed `ℹ Nothing to copy yet — no assistant reply captured.` (a note, not a banner). There is still no flash container in `rpi-tui` |
| 18 | **Fixed** | `No matching commands` (`rpi-tui/src/select_list.rs:659`), `No matching settings` (`rpi-tui/src/settings_list.rs:692`) |
| 19 | **Open** — the `ask_user` hints are still hard-coded and there is still no timeout countdown | `rpi/crates/rpi-cli/src/interactive_tui/extensions.rs:341`, `:449`, `:561`; `rpi/crates/rpi-cli/src/tui_shell/dialogs.rs:60`, `:122-124` |
| 20 | **Open** — a settings change is still announced in the transcript | `rpi/crates/rpi-cli/src/interactive_tui/settings.rs:88`, `:140` |

**Net:** rows 1, 2, 3, 4, 5 (settings submenu), 12, 13 and 18 are now closed — eight of
the twenty findings are fixed and verified on screen. **Ten are still open and worth a
porter:** 6, 7, 8, 9, 10, 11, 14, 15, 16, 17 (plus 19 and 20, which need an extension
to reach). Rows 9, 10 and 11 are the most visible of the remaining ones — they are the
viewport chrome every user sees while reading a long transcript.

**One harness note for whoever runs the captures next:** the port reads pi's config
directory, so the Rust side of the harness must be driven with `PI_CODING_AGENT_DIR`
(the repo's `scripts/parity/drive.mjs:208`/`:218` already does). A copy that still sets
`RPI_CODING_AGENT_DIR` will start the port with no model catalogue and the pane will die
immediately with `Error: Unknown provider "mock"`.

---

## 1. The port defaults to regular (scrollback) mode on macOS; the original defaults to fullscreen — **fixed and verified**

**What the user sees.** On a Mac the original is a fixed full-screen viewport: it owns
the scrollbar, the mouse wheel, the jump-to-end label, the flash banner and the
transcript search. The port prints into the terminal's normal scrollback instead, so
none of those exist at all until the user passes `--tui-mode fullscreen`.

| | |
|---|---|
| Original | `packages/coding-agent/src/core/settings-defaults.ts:64` → `tuiMode: "fullscreen"` |
| Port | `rpi/crates/rpi-cli/src/args.rs:90-101` → `default_tui_mode_for(is_macos)` = `Regular` on macOS, `Fullscreen` elsewhere — **now fixed**: `args.rs:90-94` defaults to `TuiMode::Fullscreen` on every platform, like the original (test `:1181-1185`) |

**Observed.** On this machine (darwin) the original's pane is a fixed 30-row viewport
with the footer pinned to the bottom; the port's pane is a scrolling print-out. Every
fullscreen-only row below (2, 9, 10, 11, 17) was therefore measured with
`--tui-mode fullscreen` on the port.

**Check.** `cargo test -p rpi-cli` — a test pinning the default `TuiMode` for
`cfg!(target_os = "macos")`; and the `panels` scenario in `scripts/parity/drive.mjs`
captured in fullscreen on both sides.

**Status (re-verified).** Fixed in source — `args.rs:90-94` now defaults to
`TuiMode::Fullscreen` on every platform, like the original, with a test at
`:1181-1185`. The pane capture above was taken with the older binary, so one runtime
re-check is owed; the rows that depended on this one (9, 10, 11, 17) must be
re-measured in fullscreen on the rebuilt binary.

---

## 2. The port's `/settings` menu cannot be searched — typed keys are swallowed — **fixed in source, runtime re-check owed**

**What the user sees.** The original's settings panel has a search field above the rows
and a hint line underneath. The port shows the rows only: typing letters does nothing
at all, and there is no hint telling the user what Enter/Space/Esc do.

| | |
|---|---|
| Original | `packages/tui/src/components/settings-list.ts:113` (`renderMainList`), `:361` (`addHintLine`), `:367` (hint text `Type to search · Enter/Space to change · Esc to cancel`); `packages/coding-agent/src/modes/interactive/components/settings-selector.ts:1032` (`{ enableSearch: true }`) |
| Port | `rpi/crates/rpi-cli/src/interactive_tui/settings.rs:100-140` (a bare `SettingsList` view, no `Input`), `rpi/crates/rpi-tui/src/settings_list.rs:421` (`render`: no search row, no hint line) |

**Observed** (`/settings`, then type `theme`):

```
original:  > theme                      port:  (rows unchanged, no search field)
           → Theme                             system
             Default thinking level per model  none
```

The port swallowed `theme` completely — the 15 rows are still all on screen.

**Check.**
* Rust: a test on the settings selector proving a printable key reaches the filter and
  narrows the visible rows.
* Parity: the `settings` scenario in `scripts/parity/drive.mjs` — type `theme`, compare
  the pane.

**Status (re-verified).** Fixed and verified on the fresh binary — the search field is
there (`> theme` in the pane narrows the list) and the
`Type to search · Enter/Space to change · Esc to cancel` hint is printed under the list.
`rpi/crates/rpi-cli/src/interactive_tui/settings.rs:127` builds the list with
`.with_search()`; `rpi/crates/rpi-tui/src/settings_list.rs:650-655` and `:673-676` carry
the hint and the search row.

---

## 3. The port's settings values are not column-aligned and the description is inline

**What the user sees.** The original lines the values up in a column and prints the
selected row's description as a wrapped block *below* the list. The port runs the label,
the value and the description together on one row, so the column of values is ragged and
the descriptions are cut off at the right edge.

| | |
|---|---|
| Original | `packages/tui/src/components/settings-list.ts:140` (`maxLabelWidth`), `:152` (`labelPadded`), `:310-320` (description below the list) |
| Port | `rpi/crates/rpi-tui/src/settings_list.rs:379-410` (`key_width = 20`, `value_width = 15`, no padding; description appended to the same row) |

**Observed.**

```
original:  → Hide thinking                     false      port:  → Hide thinking false  Hide thinking blocks in assistant responses
             HTTP idle timeout                 5 min
             Default thinking level per model  none

             Hide thinking blocks in assistant responses
```

The original's panel is also framed with `────` rules above and below
(`components/settings-selector.ts:906` and `:1036`, `DynamicBorder`); the port draws no
frame.

**Check.** A golden-trace comparison of the `settings` scenario: the pane must match
row for row, including the alignment of the value column.

**Status (re-verified).** Fixed and verified on the fresh binary — 35 rows in pi's order,
the values in a column (`→ Auto-compact                      true`), the counter `(1/35)` and
the selected row's description in a block below the list
(`  Automatically compact context when it gets too large`). The `────` frame is still
missing around the panel; the original draws one
(`components/settings-selector.ts:906`/`:1036`).

---

## 4. Escape inside a settings submenu closes the whole menu in the port

**What the user sees.** In the original, `Escape` in a submenu returns to the settings
list, with the search query and the selected row intact. In the port, `Escape` in a
submenu throws the entire settings menu away and drops the user back to the chat prompt.

| | |
|---|---|
| Original | `packages/tui/src/components/settings-list.ts:267-284` (the submenu component receives all input), `:338-352` (`closeSubmenu` restores the parent row) |
| Port | `rpi/crates/rpi-cli/src/interactive_tui/settings.rs:76-98` and `rpi/crates/rpi-cli/src/interactive_tui/selectors.rs:35-60` (`open_searchable_selector` **replaces** `active_selector`; `on_cancel` → `close_selector`) |

**Observed** (`/settings` → `Enter` on `Theme` → theme submenu → `Escape`):

```
original:  back in the settings list, still filtered by "theme", "Theme" row re-selected
port:      >            (empty chat prompt — the settings menu is gone)
```

**Check.** A Rust test on the selector stack: opening a submenu from the settings menu
and cancelling it must restore the parent list, not clear the slot.

**Status (re-verified).** Fixed and verified on the fresh binary — after `Escape` in the
theme submenu the pane shows the settings list again with the filter and the selected
row intact (`> theme` / `→ Theme   dark` / `  Default thinking level per model  none`).
The list now owns its submenu (`rpi/crates/rpi-tui/src/settings_list.rs:127`
`with_submenu_factory`, `:259` `close_submenu`, `:509` `has_open_submenu`, test `:1059`).

---

## 5. The port's submenus drop the title, the description and the hint line

**What the user sees.** The original's theme submenu is a titled, described, framed panel
with `Enter to select · Esc to go back` at the bottom. The port shows three bare rows.

| | |
|---|---|
| Original | `packages/coding-agent/src/modes/interactive/components/settings-submenu.ts:31`, `packages/coding-agent/src/modes/interactive/components/menu.ts:166-206` (`buildContent`, `hintLine`) |
| Port | `rpi/crates/rpi-tui/src/searchable_select.rs:106-146` (`render`: title, description, search, list — **no hint line**) |

**Observed.**

```
original:  Theme
           Select a theme, or choose automatic to follow terminal appearance.
           → ✓ system     Follows the terminal's light or dark appearance
               automatic  Use separate themes for light and dark appearance
               dark
               light

             Enter to select · Esc to go back
port:      → Dark                            Default dark theme
             Light                           Light background
             Monochrome                      No color accents
```

(The original's `system` / `automatic` rows are still missing in the port — that part is
already in `FEATURES.md`.)

**Check.** Golden trace of the `settings` → `Theme` scenario.

**Status.** Open.

---

## 6. The port's models panel has no footer line and no hint line

**What the user sees.** The original's models panel ends with a status line
(`Model catalogs refreshed.` / `Model Name: …`) and a hint line
(`Enter to select · Ctrl+S to set as default · Escape/Ctrl+C to cancel`). The port's
panel ends with the last row.

| | |
|---|---|
| Original | `packages/coding-agent/src/modes/interactive/components/model-selector.ts:129-146` (`updateFooter`), `:118-126` (`hintLine`) |
| Port | `rpi/crates/rpi-tui/src/searchable_select.rs:106-146`, `rpi/crates/rpi-cli/src/interactive_tui/selectors.rs:186-200` |

**Observed** (`Ctrl+L`):

```
original:  Only showing models from configured providers. Use /login to add providers.
           > Search
           → ✓ mock-1                        [mock]
             Model catalogs refreshed.
             Enter to select · Ctrl+S to set as default · Escape/Ctrl+C to cancel
port:      Select model
           Type to filter by name, provider, or id
           >
           → Mock Model                      mock/mock-1 (current)
```

**Check.** Golden trace of the `models` scenario.

**Status.** Open.

---

## 7. `Ctrl+S` ("set as default") does nothing in the port's models panel

**What the user sees.** In the original, `Ctrl+S` closes the models panel and confirms
`Default model: mock/mock-1`. In the port the key is swallowed by the filter box and
the panel stays open.

| | |
|---|---|
| Original | `packages/coding-agent/src/modes/interactive/components/model-selector.ts:136-143` (`app.models.save`), `packages/coding-agent/src/core/keybindings.ts` (`app.models.save` = `ctrl+s`) |
| Port | `rpi/crates/rpi-tui/src/searchable_select.rs:96-112` (`handle_key` routes `Ctrl+S` to the text input); no `app.models.save` in `rpi/crates/rpi-tui/src/keybindings.rs` |

**Observed** (`Ctrl+L`, then `Ctrl+S`):

```
original:  panel closed, transcript shows "Default model: mock/mock-1"
port:      panel unchanged
```

**Check.** A Rust test: `Ctrl+S` in the models selector persists the default model and
closes the selector.

**Status.** Open.

---

## 8. The port's search boxes show no placeholder while they are focused

**What the user sees.** The original draws the placeholder even when the box has focus
(with a fake cursor over it): `> Search`. The port's rule is "placeholder only when not
focused", so the focused search box is an empty `>` with no hint at all.

| | |
|---|---|
| Original | `packages/tui/src/components/input.ts:425-434` |
| Port | `rpi/crates/rpi-tui/src/input.rs:619-625` (`if value.is_empty() && !focused`) |

**Observed** (models panel open): original `> Search`, port `>`.

This one root cause affects every search box in the port: the models panel, `/theme`,
`/provider`, `/login`, the provider form.

**Check.** A Rust test on `Input::render` asserting the placeholder is rendered while
focused.

**Status.** Open. *(Note: `searchable_select.rs` is being edited — if the placeholder
was dropped there, the gap grows; fixing `input.rs` fixes all of them.)*

---

## 9. The port's jump-to-end label overwrites the last transcript row

**What the user sees.** The original paints `↓ Jump to latest message` on its own row
*below* the transcript, so the transcript text stays intact. The port paints
`↓ Jump to latest message · End` **on the last visible transcript row**, truncating the
text underneath it.

| | |
|---|---|
| Original | `packages/tui/src/tui-alt-screen.ts:1677-1703` (`scrollToEndIndicatorPlacement: "below-scroll-view"`), `packages/coding-agent/src/modes/interactive/tui-renderer.ts:30` (`" ↓ Jump to latest message "`) |
| Port | `rpi/crates/rpi-tui/src/jump_to_end.rs:29` (`paint` inside the transcript viewport), `rpi/crates/rpi-cli/src/transcript_navigation.rs:19-30` (extra `· End` shortcut suffix) |

**Observed** (60-line reply, then `PageUp`):

```
original:   Line 39 of the long assistant reply.
            (blank row)
                                                                    ↓ Jump to latest message
port:       Line 40 of the long assistant rep ↓ Jump to latest message · End
```

`reply.` is cut to `rep` under the port's label.

**Check.** A golden trace of a scrolled-up transcript in fullscreen mode, on both sides.

**Status.** Open.

---

## 10. The port draws no transcript scrollbar at all

**What the user sees.** The original draws a themed track + thumb column (`▂` track,
`▄` thumb) that can be dragged. The port hard-codes the transcript scrollbar off and
has no setting to turn it on.

| | |
|---|---|
| Original | `packages/tui/src/components/scroll-view.ts:76-81`, `packages/coding-agent/src/modes/interactive/chat-viewport.ts:36-43` (`scrollbar: options.scrollbar ?? "auto"`) |
| Port | `rpi/crates/rpi-cli/src/interactive_tui/panels.rs:573-576` → `scrollbar: ScrollbarMode::Hidden` |

**Observed** (`fullscreenScrollbar: "always"`, 60-line reply): the original's pane has a
`▂/▄` column at the right edge; the port's pane has none.

**Check.** Golden trace with `fullscreenScrollbar: "always"` in fullscreen mode.

**Status.** Open.

---

## 11. The port scrolls 3 lines per wheel notch; the original scrolls 1

**What the user sees.** One wheel notch moves the original's transcript by one line and
the port's by three, so the port overshoots the user's intent.

| | |
|---|---|
| Original | `packages/coding-agent/src/core/settings-defaults.ts:68` (`fullscreenWheelScrollLines: 1`), `packages/tui/src/wheel-scroll.ts` (the accelerator is opt-in via `"auto"`), `packages/coding-agent/docs/settings.md:102` (Alt+wheel moves five times as far) |
| Port | `rpi/crates/rpi-tui/src/tui_alt_screen.rs:403` (`wheel_scroll_lines: AtomicI32::new(3)`), `:1437` |

**Observed** (one SGR wheel-up per step, first visible transcript line):

```
original:  36 → 35 → 34 → 33      (1 line per notch)
port:      37 → 34 → 31 → 28      (3 lines per notch)
```

The port has no accelerator and no Alt modifier.

**Check.** A Rust test on the wheel handler, plus the `scroll` scenario in
`scripts/parity/drive.mjs` with a wheel event.

**Status.** Open.

---

## 12. The original's progress bar had no counterpart in the port — **fixed and verified**

**What the user sees.** With `terminal.showTerminalProgress` on, the original paints a
hairline `▔▔▔…` row across the top of the screen while the agent works. The port draws
nothing — its `ProgressBar` component is not wired into the running TUI at all.

| | |
|---|---|
| Original | `packages/coding-agent/src/modes/interactive/components/progress-bar.ts:84-94` (`"▔".repeat(filled)`), `packages/coding-agent/src/modes/interactive/chat-viewport.ts:44-49` (pinned to the top) |
| Port | `rpi/crates/rpi-tui/src/progress.rs:45` (`ProgressBar` — unused), `rpi/crates/rpi-cli/src/interactive_tui/state.rs:1008-1018` (the setting only gates `editor.set_working`) |

**Observed** (`terminal.showTerminalProgress: true`, run in flight): the original's pane
row 0 is `▔▔▔…` (45 cells); the port's row 0 is blank.

**Check.** Golden trace of the `run` scenario in fullscreen with the setting on.

**Status (re-verified).** Fixed and verified — the port now paints the same hairline row
(`rpi/crates/rpi-tui/src/agent_progress.rs` is wired into the running TUI). With
`terminal.showTerminalProgress` on, the port's top row during a run is a run of `▔`
exactly like the original's.

---

## 13. The port's "Terminal progress" setting promises OSC 9;4 that it never sends

**What the user sees.** The port's settings row reads
`OSC 9;4 progress in the terminal tab bar (applies on restart)`. The port never emits
OSC 9;4 — the flag actually toggles the in-editor working spinner.

| | |
|---|---|
| Original | `packages/coding-agent/src/modes/interactive/components/settings-selector.ts:887-892` (`Show a progress line while the agent works`) |
| Port | `rpi/crates/rpi-cli/src/interactive_tui/settings.rs:222-228` (the label), `rpi/crates/rpi-cli/src/interactive_tui/state.rs:1008-1018` (what the flag does) |

**Check.** A golden trace of the `settings` scenario (the row text) plus row 12's
behaviour test.

**Status.** Open.

---

## 14. The working indicator reads `Working… 7s` in the port, `Working` in the original

**What the user sees.** The original's spinner line is `⠼ Working`. The port's is
`⠧ Working… 7s` — a different word and an extra elapsed timer that the original does
not show.

| | |
|---|---|
| Original | `packages/coding-agent/src/modes/interactive/components/status-indicator.ts:38-49`, `packages/coding-agent/src/modes/interactive/interactive-mode.ts:508` (`defaultWorkingMessage = "Working"`) |
| Port | `rpi/crates/rpi-cli/src/interactive_tui/state.rs:1010-1015` (`"Working…"`), `rpi/crates/rpi-tui/src/editor.rs:1512-1538` (spinner + message + elapsed) |

**Observed** (during a `bash sleep 12`): original `⠸ Working`, port `⠴ Working… 6s`.

**Check.** A golden trace of the `run` scenario (the spinner line).

**Status.** Open.

---

## 15. Aborting a run leaves no trace in the port

**What the user sees.** After `Escape` during a run, the original prints
`Command aborted` and `Error: The operation was aborted.` in the transcript. The port
prints nothing at all — the run simply stops and the bash panel shows `7.7s (exit 1)`.

| | |
|---|---|
| Original | `packages/coding-agent/src/modes/interactive/components/bash-execution.ts:192-196` plus the abort path in `packages/coding-agent/src/modes/interactive/interactive-mode.ts` |
| Port | `rpi/crates/rpi-cli/src/interactive_tui.rs` (the `Escape` path sets `RunStatus::Aborting`, which only clears the status text; no transcript note) |

**Observed** (`bash sleep 20`, then `Escape`, checked again 5 s later):

```
original:  $ sleep 20 (timeout 40s)
           Command aborted
           Took 0.0s
           Error: The operation was aborted.
port:      $ sleep 20
           7.7s (exit 1)
```

**Check.** A golden trace of an aborted run; a Rust test asserting the abort note.

**Status.** Open.

---

## 16. The port reports a compaction that did not happen

**What the user sees.** `/compact` on an empty session: the original refuses with
`Error: Compaction failed: Nothing to compact (session …)`. The port claims success:
`ℹ Conversation compacted.`

| | |
|---|---|
| Original | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:4064` (`Session compacted N`) and its error path |
| Port | `rpi/crates/rpi-cli/src/interactive_tui/run.rs:285` (`add_note_message(&state.chat_container, "Conversation compacted.")`) |

**Check.** A golden trace of the `compact` scenario on an empty session.

**Status.** Open.

---

## 17. The flash banner is missing in the port

**What the user sees.** The original flashes an inverse-video ` Copied! ` banner in the
top-right corner for about a second. The port has no flash container at all; the same
event writes a permanent line into the transcript.

| | |
|---|---|
| Original | `packages/tui/src/components/alt-screen-flash.ts:13-46`, `packages/tui/src/tui-alt-screen.ts:685-688`, `packages/coding-agent/src/modes/interactive/interactive-mode.ts:6648` |
| Port | `rpi/crates/rpi-cli/src/interactive_tui.rs:2417-2418` (`add_note_message(..., "Copied!")`); there is no `alt_screen_flash.rs` in `rpi/crates/rpi-tui/src/` |

**Observed** (`Ctrl+X` in fullscreen, pane read 250 ms later):

```
original:  row 0 = "                    Copied!"   (gone 2 s later)
port:      a permanent transcript line "ℹ Copied last reply to the clipboard."
```

**Check.** A golden trace that reads the pane once, 250 ms after the copy, plus one
2 s later.

**Status.** Open. (`FEATURES.md` lists the flash as missing; this row pins the
observable behaviour and the exact hook.)

---

## 18. Empty-filter and notification wording

**What the user sees.** Small text differences that are still user-visible.

| Original | Port |
|---|---|
| `No matching models` (`components/model-selector.ts:124-126`) | `No matching items` (`rpi/crates/rpi-tui/src/select_list.rs:627-635`) |
| `No matching commands` (`packages/tui/src/components/select-list.ts:102`) | `No matching items` (same) |
| `No matching settings` (`packages/tui/src/components/settings-list.ts:131`) | `No settings found` (`rpi/crates/rpi-tui/src/settings_list.rs`) |
| `Copied last agent message to clipboard` | `ℹ Copied last reply to the clipboard.` (`rpi/crates/rpi-cli/src/interactive_tui/rendering.rs:513`) |

The port also prefixes every transcript note with `ℹ`, which the original does not.

**Check.** Golden traces of the `models`, `settings` and `copy` scenarios.

**Status.** Open (wording).

---

## 19. The port's `ask_user` dialog hints are hard-coded and it has no timeout countdown

**What the user sees.** The original builds the dialog hint from the keybinding registry
(so it follows the user's remaps) and, for a dialog with a timeout, shows a live
countdown in the title (`Title (5s)`) and cancels itself when it expires. The port
prints fixed strings and never counts down.

| | |
|---|---|
| Original | `packages/coding-agent/src/modes/interactive/components/extension-input.ts:65-71` (countdown title), `:81-85` (hint from the registry), `packages/coding-agent/src/modes/interactive/components/extension-selector.ts:41-48` |
| Port | `rpi/crates/rpi-cli/src/tui_shell/dialogs.rs:60` (`"Enter submit · Esc cancel"`), `:120-125` (`"Enter select · Esc cancel"`, `"Space toggle · Enter submit · Esc cancel"`), `rpi/crates/rpi-cli/src/interactive_tui/extensions.rs:853-882` (the frame, no countdown) |

**Check.** A Rust test on the dialog frame (hint text) and a timeout test (the title
counts down and the dialog cancels).

**Status.** Open. *(Not reachable from the stock harness — it needs an extension; the
comparison above is from the source on both sides.)*

---

## 20. The port announces a settings change in the transcript; the original does not

**What the user sees.** Toggling a setting in the port writes `ℹ Thinking blocks shown.`
above the still-open settings panel. The original flips the value in place and says
nothing.

| | |
|---|---|
| Original | `packages/tui/src/components/settings-list.ts:334-341` (`activateItem` → `onChange`, no note) |
| Port | `rpi/crates/rpi-cli/src/interactive_tui/settings.rs:117-130` (`on_change` → `add_note_message`) |

**Observed** (`/settings` → `Hide thinking` → `Enter`): the port adds the note line, the
original does not.

**Check.** A golden trace of the `settings` scenario after a toggle.

**Status.** Open (wording).

---

## Checked and found identical

* Models-panel list scrolling and the `(n/m)` counter with 25 models — both centre the
  window on the selection; after 12 × `Down` both show `(13/25)` and the same visible
  window (`mock-8 … mock-17`).
* `Escape` closes the models panel on both sides.
* Settings value cycling: `Enter` on a boolean row flips the value in place and the panel
  stays open, on both sides.
* Filtering in the models panel: typing `zzz` empties the list on both sides.
* The loader spinner frames and cadence (10 braille frames at 80 ms), the loader text and
  the bash panel's `Running... (escape/ctrl+c to cancel)` label
  (`packages/coding-agent/src/modes/interactive/components/bash-execution.ts:56` ↔
  `rpi/crates/rpi-tui/src/bash_execution.rs:346`).
* The countdown timer's semantics — deadline based, seconds remaining, ticking down
  (`packages/coding-agent/src/modes/interactive/components/countdown-timer.ts` ↔
  `rpi/crates/rpi-tui/src/countdown_timer.rs`).
* The retry / compaction / branch-summary status text: the port resolves `app.interrupt`
  to `escape`, matching the original's `keyText("app.interrupt")`. **The `FEATURES.md`
  row that says the port hard-codes `Ctrl+C` is stale** — the code at
  `rpi/crates/rpi-tui/src/status_indicator.rs:250-252` is correct, only the module doc
  at `:1-10` still says otherwise.
* The jump-to-end click, the mouse wheel, text selection, copy-on-select and OSC 8 link
  opening all exist in the port (`rpi/crates/rpi-tui/src/mouse.rs`,
  `rpi/crates/rpi-tui/src/tui_alt_screen.rs:1306`). **The `FEATURES.md` rows "Mouse
  click-to-select + copy-on-select" and "Hover-to-select in lists" are outdated.**
* Panel anchoring (a selector replaces the editor slot; the footer stays at the bottom),
  the `(n/m)` counter format and the `→` / `  ` selection prefixes.

## Stale rows in `scripts/parity/FEATURES.md` (this area)

| Row | Correction |
|---|---|
| "Mouse wheel scrolling of the transcript" | The original scrolls **1 line per notch** by default; the accelerator is opt-in via `fullscreenWheelScrollLines: "auto"`. The port scrolls 3. |
| "Terminal progress bar (OSC 9;4)" | The original no longer sends OSC 9;4; what it has is an in-TUI `▔` hairline row. The port has **no** progress bar at all — `progress.rs` is unused. |
| "Alt-screen flash messages" | Still missing (row 17 above) — the row's claim is right, the mechanism is a missing `AltScreenFlashContainer`. |
| "Mouse click-to-select + copy-on-select", "Hover-to-select in lists" | The port has the mouse layer now. |
| "Cancel hint in the running-status line" | The port resolves `app.interrupt` → `escape`; only its module doc is stale. |

Gaps `FEATURES.md` does not list at all: rows 1, 2, 3, 4, 7, 8 and 9 above.

## Caveat on line numbers

The `file:line` in the per-row sections were read against the tree as of 2026-10-20 and
have drifted for the files that were rewritten in parallel
(`rpi/crates/rpi-tui/src/settings_list.rs`, `rpi/crates/rpi-tui/src/searchable_select.rs`,
`rpi/crates/rpi-cli/src/interactive_tui/settings.rs`). The **Re-verification** table at
the top of this file carries the current citations for every row; use those. The
observed behaviour in each row is what the check must reproduce.

**This document is an audit.** No source file was changed to produce it; the port's
behaviour above was observed in the running binary
(`rpi/target/debug/rpi`) against the original's `packages/coding-agent/src/cli.ts`.
