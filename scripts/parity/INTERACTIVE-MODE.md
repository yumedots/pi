# Interactive-mode parity — TypeScript original vs. Rust port

Area: the interactive mode only — the original's 54 components under
`packages/coding-agent/src/modes/interactive/components/`, the interactive-mode
orchestrator, and the host that drives them.

* Original: `/Users/gabriel/pi` (branch `perf/lightweight-harness`)
* Port: `/Users/gabriel/pi-native` (branch `feat/rpi-native`)

Every row carries the `file:line` on both sides and how it was observed. Ranked by
what a user notices first.

Reading the port: `rpi-tui/src/…`, `rpi-cli/src/…` etc. below are relative to
`/Users/gabriel/pi-native/rpi/crates/`; the full path is
`/Users/gabriel/pi-native/rpi/crates/<what is written>`. Reading the original:
`packages/…` below means the path relative to `/Users/gabriel/pi`.

**Method.** Read-only inspection of both trees; mechanical diffs of the component
inventory, the settings-row list, the keybinding tables and the slash-command list;
live runs of both programs under tmux at a fixed 100×30 pane via
`scripts/parity/drive.mjs` and by hand. No file in either tree was modified.

**Snapshot warning.** The interactive-mode tree is being fixed **while this document
is being written** — `app.quit` came back, the startup header was rewritten to the
original's, the Chinese picker strings were replaced, the keybinding hints learned the
macOS `option` rewrite, and the expand hints learned to resolve from the registry.
Every finding below was re-checked against the tree as it stood when it was written,
but **a `file:line` here is a locator, not a guarantee**: re-read the file before you
act on a line number, and check whether the finding still reproduces. Section 2 lists
what changed and when.

**This document supersedes the interactive-mode rows of `scripts/parity/FEATURES.md`.**
That inventory was written before the port gained its mouse layer, its first-run
dialog, transcript search, jump-to-end and list hover. Section 2 lists every verdict
that changed since, so the inventory can be corrected rather than left to rot.

---

## 1. The 54 components

`—` in the port column means the component has no counterpart at all. "differs" means
both sides have it and the user sees something different. Detail for every "differs"
row is in section 3.

| # | Original (`packages/coding-agent/src/modes/interactive/components/`) | Port (`rpi/crates/`) | Verdict |
|---|---|---|---|
| 1 | `armin.ts:9` | `rpi-tui/src/armin.rs:247` `ArminComponent` | differs — **present, not wired** (0 call sites) |
| 2 | `assistant-message.ts:16` | `rpi-tui/src/assistant_message.rs:169` | differs |
| 3 | `auth-url.ts:13` | `rpi-tui/src/auth_url.rs:39` `AuthUrlComponent` | differs — **present, not wired** (0 call sites) |
| 4 | `bash-execution.ts:21` | `rpi-tui/src/bash_execution.rs:66` | differs |
| 5 | `bordered-loader.ts:7` | `rpi-tui/src/bordered_loader.rs:29` | differs — no CLI caller |
| 6 | `branch-summary-message.ts:10` | `rpi-tui/src/summary_cards.rs:206` `BranchSummaryCard` | differs — **present, not wired**; the port still prints a plain note |
| 7 | `centered.ts:8` | `rpi-tui/src/empty_session.rs:17` | close |
| 8 | `compaction-summary-message.ts:10` | `rpi-tui/src/summary_cards.rs:132` `CompactionSummaryCard` | differs — **present, not wired**; the port still prints a plain note |
| 9 | `config-selector.ts:23` | `rpi-cli/src/interactive_tui/config_selector.rs:854` `ConfigSelector` | differs — just landed, **wired** (15 call sites), unverified |
| 10 | `countdown-timer.ts:7` | `rpi-tui/src/countdown_timer.rs:18` | differs — no callbacks, one consumer |
| 11 | `custom-editor.ts:16` | folded into `rpi-tui/src/editor.rs:1494` (`render_card`) | differs |
| 12 | `custom-entry.ts:11` | `rpi-cli/src/interactive_tui/sessions.rs:428` | differs |
| 13 | `custom-message.ts:12` | `rpi-cli/src/interactive_tui/events.rs:299` | differs |
| 14 | `diff.ts:79` | `rpi-tui/src/diff.rs:35` | differs — format |
| 15 | `dynamic-border.ts:11` | `rpi-tui/src/dynamic_border.rs:17` | differs — dimmer |
| 16 | `earendil-announcement.ts:27` | `rpi-tui/src/announcement.rs:53` | differs — **present, not wired** (0 call sites) |
| 17 | `easter-egg-3d.ts:871` | `rpi-tui/src/logo3d.rs:773` (`Logo3d`) + `rpi-tui/src/easter_egg_3d.rs:226` `EasterEgg3dComponent` | differs — the logo frames are fully ported; the fullscreen egg is **present, not wired** (0 call sites) |
| 18 | `easter-egg-3d.lazy.ts:10` | `rpi-tui/src/easter_egg_3d.rs` (no lazy loader) | differs — the original loads it lazily |
| 19 | `empty-session-screen.ts:10` | `rpi-tui/src/empty_session.rs:61` | differs — no overlay row, no mouse |
| 20 | `extension-editor.ts:26` | `rpi-cli/src/interactive_tui/extensions.rs:518` | differs — native plugins only |
| 21 | `extension-input.ts:23` | `rpi-cli/src/interactive_tui/extensions.rs:308` | differs — native plugins only |
| 22 | `extension-selector.ts:18` | `rpi-cli/src/interactive_tui/extensions.rs:400` | differs — native plugins only |
| 23 | `first-time-setup.ts:29` | `rpi-tui/src/first_run.rs:38` | differs — trigger, options, place |
| 24 | `footer.ts:410` | `rpi-tui/src/footer.rs:448` | differs — three sub-findings |
| 25 | `index.ts` | — | n/a (barrel) |
| 26 | `keybinding-hints.ts:13` | `rpi-tui/src/keybinding_hints.rs:141` | differs — wording |
| 27 | `login-dialog.ts:12` | `rpi-cli/src/interactive_tui/settings.rs:1047` | differs |
| 28 | `markdown-transform.ts:3` | `rpi-cli/src/interactive_tui.rs:106` | differs — narrower contract |
| 29 | `menu.ts:48` | `rpi-tui/src/searchable_select.rs:26` | differs — not a `MenuComponent` |
| 30 | `mermaid.ts:60` | `rpi-tui/src/mermaid.rs:15` | differs — no modes |
| 31 | `model-selector.ts:31` | `rpi-cli/src/interactive_tui/selectors.rs:121` | differs |
| 32 | `oauth-selector.ts:49` | `rpi-cli/src/interactive_tui/selectors.rs:626` | differs |
| 33 | `pi-logo.ts:19` | `rpi-cli/src/brand.rs:93` | differs — rebrand |
| 34 | `progress-bar.ts:31` | `rpi-tui/src/progress.rs:45` + `rpi-tui/src/agent_progress.rs:50` `AgentProgressBar` | differs — the hairline bar is **present, not wired** (0 call sites) |
| 35 | `radius-login-selector.ts:105` | `rpi-cli/src/interactive_tui/radius_login.rs:80` `RadiusLoginMenu` | differs — just landed, **wired** (5 call sites), unverified |
| 36 | `scoped-models-selector.ts:97` | `rpi-cli/src/interactive_tui/settings.rs:1827` | differs |
| 37 | `session-menu.ts:195` | `rpi-cli/src/interactive_tui/selectors.rs:301` | differs |
| 38 | `session-selector-search.ts:39` | `rpi-cli/src/interactive_tui/session_search.rs:174` `parse_search_query` | differs — just landed, **wired** (16 call sites), unverified |
| 39 | `settings-selector.ts:472` | `rpi-cli/src/interactive_tui/settings_menu.rs:663` `settings_menu_rows` | close — pi's 37 rows, pi's order, pi's wording (just landed) |
| 40 | `settings-submenu.ts:31` | `rpi-cli/src/interactive_tui/settings_menu.rs` (`SettingsSubmenu::Options` / `::Steps` / `::Rows`) | close — the stepped framework has just landed, **wired**, unverified |
| 41 | `show-images-selector.ts:13` | `rpi-cli/src/interactive_tui/selectors.rs:1017` | differs — wording, no preselect |
| 42 | `skill-invocation-message.ts` | folded into `rpi-tui/src/tool_execution.rs:811` (`render_skill`) | differs |
| 43 | `spinner-sign.ts:22` | — | **missing** |
| 44 | `status-indicator.ts:9` | `rpi-tui/src/status_indicator.rs:45` | differs — 3 of 4 kinds unused |
| 45 | `theme-selector.ts:13` | `rpi-cli/src/interactive_tui/selectors.rs:487` | differs — 3 presets |
| 46 | `themed-text.ts:11` | `rpi-tui/src/theme.rs:726` (one-shot fn) | differs |
| 47 | `thinking-indicator.ts:12` | `rpi-tui/src/assistant_message.rs:123` | close |
| 48 | `thinking-selector.ts:20` | `rpi-cli/src/interactive_tui/selectors.rs:836` | differs |
| 49 | `tool-execution.ts:32` | `rpi-tui/src/tool_execution.rs:46` | differs |
| 50 | `tree-selector.ts` (1429 lines) | `rpi-cli/src/interactive_tui/selectors.rs:408` (a flat entry list) | differs |
| 51 | `trust-selector.ts:55` | — (`rpi-cli/src/interactive_tui/commands.rs:582` takes an argument) | **missing** |
| 52 | `user-message-selector.ts:22` | — | **missing** |
| 53 | `user-message.ts:13` | `rpi-tui/src/user_message.rs:26` | differs |
| 54 | `visual-truncate.ts:30` | `rpi-tui/src/visual_truncate.rs:29` | differs |

**Seven components have no counterpart** — the announcement banner, the Armin, the
branch-summary card, the compaction-summary card, the spinner sign, the trust picker
and the fork-from-message picker. The other 47 exist but behave differently; of those,
four are **present but not reachable** (the announcement, the Armin, the two cards), so
the number a user can actually see is smaller still.

> **Verification state.** A batch of components landed in the port while this document
> was being written: `armin.rs`, `auth_url.rs`, `announcement.rs`, `agent_progress.rs`,
> `easter_egg_3d.rs`, and — in `rpi-cli/src/interactive_tui/` — `config_selector.rs`,
> `radius_login.rs`, `session_search.rs` and `settings_menu.rs`. They are listed above
> as **"just landed, unverified"**: they compile, but nobody has compared their
> rendering against the original's yet, and I have not — the build was red while they
> landed, so the parity captures could not run. They need the verification pass below
> before any of them can be called a match.

### 1.1 The wiring sweep — five of the nine new components are not reachable

A call-site count over `rpi-cli/src/` decides whether a component can appear at all:

| Component | Call sites in `rpi-cli` | Verdict |
|---|---|---|
| `ConfigSelector` (`config_selector.rs:854`) | 15 | **wired** |
| `parse_search_query` (`session_search.rs:174`) | 16 | **wired** |
| `RadiusLoginMenu` (`radius_login.rs:80`) | 5 | **wired** |
| `SettingsSubmenuView` (`settings_menu.rs:195`) | 4 | **wired** |
| `AgentProgressBar` (`agent_progress.rs:50`) | 4 | **wired** — the bar sits at the top of the layout root, as in `chat-viewport.ts:48-52` |
| `AuthUrlComponent` (`auth_url.rs:39`) | 1 | **wired** — the OAuth flow uses it |
| `window_title` (`window_title.rs:26`) | 6 | **wired** — set once before the first render |
| `AnnouncementComponent` (`announcement.rs:53`) | **0** | **present, not wired** |
| `ArminComponent` (`armin.rs:247`) | **0** | **present, not wired** — and there is no `/arminsayshi` |
| `EasterEgg3dComponent` (`easter_egg_3d.rs:226`) | **0** | **present, not wired** — and the header logo is not clickable, so nothing can trigger it |
| `BranchSummaryCard` (`summary_cards.rs:206`) | **0** | **present, not wired** — the port still prints the plain note |
| `CompactionSummaryCard` (`summary_cards.rs:132`) | **0** | **present, not wired** — the port still prints the plain note |

So five components are faithful ports that **no screen in the interactive mode can
show**: the progress hairline, the announcement banner, the Armin, the fullscreen
easter egg and the auth-URL dialog. For the two whose code I read in full, the port's
implementation is a faithful copy of the original and the only thing missing is the
call site:

* **`AgentProgressBar`** (`rpi-tui/src/agent_progress.rs:241-254` `render`) is
  line-for-line the original's `render` (`components/progress-bar.ts:84-93`) — the same
  guard, the same clamp, the same `[""]` when nothing is filled, the same
  `theme.fg("accent", "\u2594".repeat(filled))`. The constants match too
  (`DEFAULT_ESTIMATE_MS` 15 000, `ESTIMATE_SAMPLES` 5, `RUNNING_MAX_FRACTION` 0.95,
  `DONE_HOLD_MS` 800, `TICK_MS` 100, `MAX_CELLS_PER_TICK` 1 — `agent_progress.rs:17-30`
  against `progress-bar.ts:5-22`). It needs a slot at the top of the layout root
  (`chat-viewport.ts:48-52`) and a driver that starts it with the run.
* **`AuthUrlComponent`** (`rpi-tui/src/auth_url.rs`) is the original's
  `AuthUrlComponent` (`components/auth-url.ts:13-41`): the URL in `accent` inside an
  OSC-8 hyperlink, the hint `Cmd+click to open` on darwin and `Ctrl+click to open`
  elsewhere, the `•` separator, and the suffix being replaceable with
  "Copied URL to clipboard" in the success colour. One difference: the default suffix
  paints the copy key in `muted` where the original's `keyHint` paints it in `dim`
  (finding 24). The login flow (`rpi-cli/src/interactive_tui/settings.rs` `begin_provider_oauth_input`)
  still prints a plain `Open: {url}` line instead of using it.
* **`AnnouncementComponent`** (`rpi-tui/src/announcement.rs:29-49`) matches the
  original's text exactly — the accent border, `pi has joined Earendil` in bold+accent,
  `Read the blog post:`, the blog URL in `md_link` — with one gap the file's own
  comment states: the original embeds a bundled PNG (`clankolas.png`, 56 cells wide,
  `components/earendil-announcement.ts:38-48`) and the port has no bundled asset, so
  it leaves that slot empty.

**One of the wired ones already differs in its text: the config selector's header.**

| | |
|---|---|
| Original | `components/config-selector.ts:204-222` — **one** line: the bold title (`"Project Local Resources"` / `"Global Resources"`), padded to the width, then `keyHint("tui.input.tab", "switch mode")` + ` · ` (**only when the project scope is available**), then `rawKeyHint("space", "cycle inherit/+/-")` or `rawKeyHint("space", "toggle")`, then ` · ` + `rawKeyHint("esc", "close")`. The **second** line is the scope hint in `muted`: `<dir>/settings.json · inherited global resources are dimmed` (project) or `~/<dir>/agent/settings.json` (global) — `CONFIG_DIR_NAME` is `".pi"` (`packages/coding-agent/src/config.ts:589`). |
| Port | `rpi-cli/src/interactive_tui/config_selector.rs:570-595` — the title alone on the first line (bold **and** in the accent colour, where the original is bold with no colour), the action hint alone on the second, and **no scope hint line at all**. The "switch mode" hint and the "esc to close" hint are both missing. |

So the port's config selector does not tell the user **which settings file it is
about to edit**, which is the one thing that header is for.

**The session search is a faithful port of the query language.**
`rpi-cli/src/interactive_tui/session_search.rs:174` `parse_search_query` reproduces
`components/session-selector-search.ts:37-100` `parseSearchQuery` exactly: the empty
query, the `re:` prefix (with the same `"Empty regex"` error text), the quoted-phrase
tokens, and the fall back to plain whitespace tokenisation when a quote is unclosed.
The port compiles the pattern with its own engine (`session_search.rs:809` `Regex`)
rather than JS's `RegExp`, and it matches case-insensitively as the original's `"i"`
flag does — but the engine is a documented **subset**, so a pattern the original
accepts (lookaround, backreferences) is rejected by the port and then matches nothing.
The engine's own test names the limit: `regex_rejects_unsupported_patterns`
(`session_search.rs:1125`).

Host-side counterparts outside the component directory, referenced below:
`rpi-cli/src/interactive_tui/{selectors,settings,commands,extensions,events,rendering,sessions,state}.rs`
and `rpi-cli/src/interactive_tui.rs`.

---

## 2. Verdicts that changed since `FEATURES.md` was written

`FEATURES.md` is an accurate record of the port **at the time it was written**. These
rows are now wrong and must be corrected in place.

| `FEATURES.md` row | What it said | What is true now |
|---|---|---|
| "Mouse click-to-select + copy-on-select" | missing | **Fixed.** `rpi-tui/src/component.rs:130` `handle_mouse`, `rpi-tui/src/mouse.rs:67` `MouseRegion`, `rpi-tui/src/list_hover.rs:8` `HoverableList` — and the alt screen dispatches every mouse kind (`rpi-tui/src/tui_alt_screen.rs:1414-1428`). Copy-on-select works (`tui_alt_screen.rs:1647` → `:1737`). **But** the click-to-expand affordances that ride on the mouse are still missing (finding 8). |
| "Hover-to-select in lists" | missing | **Fixed.** `rpi-tui/src/list_hover.rs:23` `apply_hover`, wired at `rpi-tui/src/select_list.rs:714-717` and forwarded by `searchable_select.rs:137-147`. |
| "First-time setup dialog" | missing | **Fixed.** `rpi-tui/src/first_run.rs:38` `FirstRunDialog`, wired at `rpi-cli/src/interactive_tui.rs:1137-1142`. Trigger and option list still differ (finding 25). |
| "Transcript search overlay" | missing | **Fixed as a shell.** `rpi-tui/src/alt_screen_search.rs` + `search_bar.rs`. The inline highlight and the reveal-on-match are still missing, and the counter is off by one (finding 6). |
| "Jump-to-end indicator" | missing | **Fixed in the library** (`rpi-tui/src/jump_to_end.rs:18` `JumpToEnd`), **not wired**: `tui_alt_screen.rs:612` `set_scroll_to_end_indicator` has no caller in `rpi-cli` (finding 7). |
| "Alt-screen flash messages" | missing | **Still missing.** No `flash` in `rpi-tui` at all (finding 7). |
| "Live thinking indicator while streaming" | missing | **Fixed.** `rpi-tui/src/assistant_message.rs:123` `ThinkingIndicator`. |
| "Startup header (logo + onboarding text)" | differs — "Different artwork and content" | **Fixed.** `rpi-cli/src/interactive_tui/rendering.rs:11` `add_welcome_message` now renders the original's two half-block Pi mark rows (`pi_logo_lines()`, `:36-49`), ` v{version}` from `crate::changelog::current_version()`, the compact hint line (`compact_hints()`, `:52-64`), "Press {app.tools.expand} to show full startup help.", the onboarding note (`add_startup_note`, `:133`) and the original's tmux warning (`add_tmux_warning`, `:66`). Two residuals remain (finding 11). |
| "App-level keybindings — `app.quit` replaced by `app.clear`" | differs | **Fixed.** `app.quit` is back (`rpi-tui/src/keybindings.rs:163`, const `:1015`); `app.clear` is gone. The first Ctrl+C now shows "Press Ctrl+C again to exit" and preserves the draft (`rpi-cli/src/interactive_tui.rs:2424-2435`). 28 of the original's 43 ids are still missing (finding 4). |
| "Login / OAuth picker" | differs — "Rust lists providers plainly" | **Partly fixed.** The hard-coded Chinese descriptions are gone from `rpi-cli/src/interactive_tui/settings.rs`; the auth-type column and the configured-status markers are still missing (finding 15). |
| "macOS 'Option' naming in hints" | differs — "Rust always prints `Alt`" | **Fixed.** `rpi-tui/src/keybinding_hints.rs:33-39` rewrites `alt` to `option` on macOS inside `format_combo` (`:22`); `capitalize` is honoured (`:56-60`). The hint *colours* still differ (finding 24). |
| "Tool output expand / collapse" hint | differs — "the same '(Ctrl+O to expand)' hint" | **Fixed.** The expand hint now resolves from the registry: `rpi-tui/src/tool_renderers.rs:165-168` `expand_hint` → `key_text("app.tools.expand")`, also at `:468`, `rpi-tui/src/tool_execution.rs:594`/`:602`, `rpi-tui/src/bash_execution.rs:249`/`:254`. |
| "Bash execution panel with streaming output" | identical | **Still differs** in the framing (no `DynamicBorder` rules, one-line status) but the running row now reads `"⠋ Running... (Esc to cancel)"` with a resolved key (`rpi-tui/src/bash_execution.rs:342-351`) — the Chinese hint is gone from the render (a stale doc comment remains at `:33`). |
| "User message panel (background + OSC 133 zone)" | differs | **Partly fixed.** The background now uses `colors.user_message_bg` (`rpi-tui/src/user_message.rs:43`), matching the original's token; the transformer chain and the `userMessageText` colour are still missing (finding 16). |
| "Select list — empty text" | differs — "No matching commands" | **Fixed.** `rpi-tui/src/select_list.rs:659` now prints `"  No matching commands"`, matching `packages/tui/src/components/select-list.ts:101`. |
| "TUI mode" (reported by the TUI library lead) | — | **Fixed.** The port now defaults to fullscreen on every platform (`rpi-cli/src/args.rs:90-94` `impl Default for TuiMode` → `TuiMode::Fullscreen`); the macOS regular-mode default is gone. |
| "Settings menu — 15 of ~35 rows" | differs | **Fixed.** `rpi-cli/src/interactive_tui/settings_menu.rs:663` `settings_menu_rows` now carries pi's **37** rows in pi's order with pi's wording, and the test `settings_menu.rs:1176` `PI_ROWS` pins the 37 keys and labels. The port-only rows (`Default model`, `Default thinking`, `Cycle scope`) are **gone from the menu** — they stay as `/model`, `/thinking` and `/scoped-models`. `quietStartup` is pi's tri-state (`true`/`header`/`false`), `tuiMode` is read at startup, and `tuiMode` defaults to fullscreen on every platform. The submenu framework is ported (`SettingsSubmenu::Options` / `::Steps` / `::Rows`) and the settings list owns its submenu and returns to the rows on Esc. |
| "Settings menu — no search field" | differs | **Fixed.** The library has `SettingsList::with_search()` (`rpi-tui/src/settings_list.rs:286-295`), `SettingsState::set_filter` exists, the filter matches the row **label** not the key (`refilter` → `fuzzy_filter(…, |item| item.label.as_str())`, pinned by `the_filter_matches_the_label_not_the_key`), and `open_settings_selector` (`rpi-cli/src/interactive_tui/settings.rs:56`) now builds the list with `.with_search()`. |
| "Context-usage block bar", "Exact token count", "Nerd Font footer icons", "Session cost (sub) suffix" | missing | **Fixed.** `rpi-tui/src/footer.rs` — 10-cell bar `:39`/`:107`, exact count `:91`, nerd icons `:157-176`, `(sub)` `:734-745`. Remaining footer gaps: the `xp` marker, the routed-model suffix and a too-broad `(sub)` rule (finding 26b). |
| "3D easter egg" | differs — "the Pi logo's 3D animation is ported … the Armin bitmap and the fullscreen easter egg are missing" | **Still accurate, and stronger.** The logo frames are byte-identical (`scripts/parity/3dicon.mjs` checks them at t = 0, 2, 5 s; `rpi-tui/src/logo3d.rs:636` `pi_logo_model`, `:684` `logo_pose`, `:733` `prepare_stars`, `:773` `Logo3d`; wired at `rpi-cli/src/interactive_tui.rs:1593`). Still missing: the fullscreen dissolve/puzzle around it (`easter-egg-3d.ts:846`), the clickable header logo (`interactive-mode.ts:1168`) and the Armin (`armin.ts:9`) plus `/arminsayshi`. |
| "Scoped-model picker" | identical | **Stale.** The port has the list (`settings.rs:1827`) but no ✓/disabled marker, no enable-all/clear-all/toggle-provider/reorder, no dirty marker, no count footer, no search, and it saves on Esc instead of Ctrl+S (finding 13). |
| "Tool panels cover only the common tools" | differs | **Wrong as written.** The built-in renderer sets are identical — original `core/tools/renderers/index.ts:31-40` and port `rpi-tui/src/tool_renderers.rs:84-101` both cover read, bash, powershell, edit, write, grep, find, ls. The real gaps are the MCP/codemode renderers, the extension-registered renderers (collected and dropped), the `edit` tool's `renderShell: "self"` and its live preview diff, and the generic panel's 12-row cap (finding 17). |
| "Thinking blocks cannot be inspected" | differs — "expanding it needs the mouse event layer, which the port's component trait does not have yet" | **Stale premise, same symptom.** The trait *does* have the mouse layer now; the port's `toggle_thinking_run` (`rpi-tui/src/assistant_message.rs:476`) simply has no caller outside its own test (`:950`), so a single run still cannot be expanded (finding 8). |
| "Progress bar" | differs — "Rust's `ProgressBar` is an in-cell block bar" | **Still true and still missing in the interactive mode.** `rpi-tui/src/progress.rs:45` has no caller outside its unit test (`:251`) (finding 20). |
| "Autocomplete list position (above / below)" | differs — "Rust always paints the list above the editor" | **Still true.** No `autocomplete_position` setting exists in `rpi-cli`; the original forces the list **below** on the empty-session screen (`interactive-mode.ts:944-950`), so the port paints it over the logo. |
| "App-level keybindings" | differs — "Rust has `app.clear` (Ctrl+C) instead of `app.quit` and none of the session/tree/model bindings" | **Still true, and larger than stated:** 29 of the original's 43 app-level ids have no counterpart (finding 4). |
| "Slash-command set" | differs | **Largely still true.** TS-only: `/skills`, `/bug`, `/stats`, `/new`, `/quit`, `/resume`. Port-only: `/help`, `/clear`, `/version`, `/provider`, `/tools`, `/images`, `/context`, `/usage`. |
| "Session picker is much weaker" | differs | **Still true** (finding 3). |
| "Settings menu exposes 15 of roughly 35 rows" | differs | **Still true, now exact:** 15 of 37 (finding 5). |
| "Menu with a search field" | differs | **Still true, now exact:** the port has no `MenuComponent` at all — 11 bespoke selectors (finding 13). |

---

## 3. The behavioural gaps

### Tier 1 — the user cannot do the thing at all

#### 1. JavaScript extension dialogs throw

**What the user sees.** An extension that calls `ctx.ui.select()`, `ctx.ui.confirm()`,
`ctx.ui.input()`, `ctx.ui.custom()` or `ctx.ui.editor()` throws
`unknown host operation: …` and the extension dies. The port's own bundled extensions
already do this.

| | |
|---|---|
| Original | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:2394-2397` (`select`, `confirm`, `input`), `:2413` (`custom`), `:2417` (`editor`); rendered by `components/extension-selector.ts`, `components/extension-input.ts`, `components/extension-editor.ts` |
| Port | `rpi/crates/rpi-js/js/extension-host.ts:305-309` maps them to `hostCall("ui.select" \| …)`; `rpi-cli/src/js_extensions.rs:497-553` implements only `context.mode`, `theme.get`, `ui.notify`, `ui.setStatus`, `ui.setWidget`, `ui.setHeader`, `ui.setFooter`, `footer.getGitBranch`, `footer.getExtensionStatuses`. Everything else falls through to `rpi-js/src/host.rs:262` → `Err` → a thrown `Error` |

**Observed.** Read the path end to end. The port's own extensions call it:
`pi-native/.pi/extensions/import-repro.ts:320` (`await ctx.ui.confirm(...)`),
`.pi/extensions/redraws.ts:16` (`await ctx.ui.custom(...)`). Native (cdylib) plugins use
a **different** envelope (`{"kind":"selector"|"editor"|"input"|"message"}`,
`rpi-cli/src/interactive_tui/extensions.rs:255-275`), so only native plugins get
dialogs.

Also unimplemented for JS: `ui.setTitle` (`extension-host.ts:298`),
`ui.setEditorText`/`getEditorText`/`pasteToEditor` (`:302-304`),
`ui.setEditorComponent`/`getEditorComponent` (original `:2422-2423`),
`ui.addAutocompleteProvider` and `ui.onTerminalInput` (`:311-312` are literal no-ops).
`registerMarkdownTransformer` / `registerToolRenderer` / `registerShortcut`
(`:366-386`) collect into state that is never read or exported, so JS markdown
transformers, JS tool renderers and JS shortcuts are all dropped — only the
native-plugin paths are wired (`rpi-cli/src/interactive_tui.rs:132-147`, `:496`).

The JS **footer** slot is stored (`js_extensions.rs:441-445`) but
`JsExtensions::footer()` (`:182`) has no call site — an extension footer silently never
appears. The **header** slot *is* wired (`interactive_tui/extensions.rs:77-105`).

**Check.**
* Rust: a test that drives a JS extension calling `ctx.ui.confirm` and asserts the host
  answers with a selection instead of throwing; one per dialog kind.
* Parity: drive both sides with the same extension and compare the pane.

#### 2. The tree picker is a flat entry list, not a tree

**What the user sees.** `/tree` shows one line per session entry, `type #seq`, with no
branches, no indentation and no filters — the original shows a navigable branch tree.

| | |
|---|---|
| Original | `packages/coding-agent/src/modes/interactive/components/tree-selector.ts` (1429 lines): tree shape `:106-116`, `:254-341`, `:423-560`, `:704-745`; five filter modes `:88`, `:358-419`, `:1042-1076`; folding `:1003-1020`, `:1104-1160`; labels `:1085-1091`, `:1262-1300`; per-entry formatting `:786-901`; help `:1178-1214` |
| Port | `rpi-cli/src/interactive_tui/selectors.rs:408-483` `open_tree_selector` — flat rows `:427-449`, fuzzy filter over type/seq/id `:478-479`, fixed 12-row window `:450` |

**Observed.** The Rust doc comment at `selectors.rs:405-407` says "the current session's
persisted entry tree", so the tree shape was intended and not implemented.

**Check.**
* Rust: a test that renders a three-branch session and asserts the `├─`/`└─` connectors
  and the `│` gutter, plus one that asserts the five filter modes change the visible
  rows.
* Parity: a scenario that resumes a branched session and opens `/tree` on both sides.

#### 3. The session picker lost scope, sort, rename, delete and the query language

**What the user sees.** The session list cannot be switched between "this project" and
"all folders", cannot be renamed or deleted, cannot be sorted, and its search box does
not understand `re:` or `"phrase"`.

| | |
|---|---|
| Original | `components/session-menu.ts:195`; scope `:197`, `:354-358`; sort modes `:198`, `:360-365`; named filter `:199`; path toggle `:200`; rename `:186-187`, `:279-306`, `:379-385`; delete `:203`, `:339-351`, `:410-441`; query parsing `components/session-selector-search.ts:37-100`; message-content search `:29`; threaded tree `:68-136`; hint `:309-332`; async loading `:211`, `:443-471` |
| Port | `rpi-cli/src/interactive_tui/selectors.rs:301-385` `open_session_selector`; search text is only `"{label} {short_id} {stem}"` `:325-331`; description `"<bytes> · <short id>"` `:318-324` |

**Observed.** Live, TS `/resume` renders

```
                Sessions
              > Search
                No items available
                tab scope: current · re:<pattern> regex · "phrase" exact
                ctrl+s sort · ctrl+n named · ctrl+d delete · ctrl+p path (off) ·
              ctrl+r rename
```

The port has no `/resume` at all (its command is `/session`) and none of the hint,
scope, rename or delete affordances.

**Check.**
* Rust: a test that parses `re:foo` and `"foo bar"` out of a query and asserts the
  matched sessions; one that renames a session through the picker and asserts the
  JSONL metadata changed.
* Parity: open the picker on both sides with the same session directory.

#### 4. Twenty-eight of the original's forty-three app-level keybindings do not exist

**What the user sees.** The tree filters, the session sort/rename/delete keys, the
model enable-all/reorder keys and "save as default" are all unreachable, even though
the port ships the screens they drive.

| | |
|---|---|
| Original | `packages/coding-agent/src/core/keybindings.ts:25-171` (43 ids) |
| Port | `rpi-tui/src/keybindings.rs:156-294` (15 ids) |

Absent ids (original line): `app.thinking.save` 37,
`app.session.toggleNamedFilter` 55, `app.session.new/tree/fork/resume` 79-82,
`app.tree.foldOrUp/unfoldOrDown/editLabel/toggleLabelTimestamp` 83-95,
`app.session.togglePath/toggleSort/rename/delete/deleteNoninvasive` 99-115,
`app.models.save/enableAll/clearAll/toggleProvider/reorderUp/reorderDown` 119-139,
`app.tree.filter.*` 143-167.

**`app.quit` is back** (`rpi-tui/src/keybindings.rs:163`, const `:1015`) and Ctrl+C
behaves like the original again: the first press shows "Press Ctrl+C again to exit"
and preserves the draft (`rpi-cli/src/interactive_tui.rs:2424-2435`, the
`CtrlCAction::Warn` arm). What is still missing:

* **Ctrl+Up / Ctrl+Down.** The original binds
  `tui.altScreen.previousPrompt` / `nextPrompt` to `["ctrl+shift+up","ctrl+up"]` /
  `["ctrl+shift+down","ctrl+down"]` (`core/keybindings.ts:135-146`); the port keeps only
  the shift variants (`rpi-tui/src/keybindings.rs:621-632`). The original binds
  `tui.altScreen.bottom` to ctrl+e and leaves `top` unbound; the port binds `bottom` =
  End and adds `top` = Home (`keybindings.rs:669-679`).
* **Every `app.session.*` / `app.tree.*` / `app.models.*` id** — so the pickers the
  port does ship have no keyboard path to their extra actions.

Overrides now apply to **every** registered id
(`rpi-cli/src/interactive_tui/state.rs:543-575` `configured_keybindings` — "Every
registered id can be overridden, exactly like upstream"), so the registry itself is
complete. What is still broken is that the **editor ignores it**: `rpi-tui/src/editor.rs:374-375`
stores the registry as `#[allow(dead_code)] keybindings` and `handle_key` (`:1228`)
matches hard-coded combos. **No editor key is remappable in the port.**

**Check.**
* Rust: a test that loads a `keybindings.json` overriding `tui.editor.cursorLeft` and
  asserts the editor moves with the new key.
* Parity: `/hotkeys` on both sides shows the same rows for the same registry.

#### 5. The settings menu exposes 15 of the original's 37 rows, and has no search field

**What the user sees.** `/settings` is a short list with no search box; most of the
original's knobs (autocompact, image sizing, autocomplete position, output padding,
nerd fonts, steering/follow-up mode, transport, mermaid mode, tree filter mode, the
TUI mode, the fullscreen scrollbar and wheel settings) cannot be changed at all.

| | |
|---|---|
| Original | `components/settings-selector.ts:490-763` (23 base rows) plus 14 rows spliced at `:770-901` = **37 rows**; search enabled at `:1032` and implemented in `packages/tui/src/components/settings-list.ts:54-55,77-79,355-359` (fuzzy filter over the **label**) |
| Port | `rpi-cli/src/interactive_tui/settings.rs:142` `settings_menu_items` = **15 rows**; `rpi-tui/src/settings_list.rs:553-558` `handle_key` ignores every printable key and `refilter` (`:172-181`) matches on `item.key` |

Missing rows (original line): `autocompact` 491, `image-width-cells` 778,
`auto-resize-images` 788, `block-images` 798, `skill-commands` 808,
`show-hardware-cursor` 818, `output-padding` 838, `nerd-fonts` 848,
`autocomplete-position` 868, `clear-on-shrink` 878, `three-d-empty-session` 898,
`steering-mode` 498, `follow-up-mode` 506, `transport` 513, `share-destination` 520,
`cache-warming-mode` 536, `mermaid-rendering` 551, `default-project-trust` 579,
`tree-filter-mode` 593, `warnings` submenu 600, `model-thinking` stepped submenu 615,
`tui-mode` 716, `fullscreen-exit-output` 723, `fullscreen-scrollbar` 730,
`fullscreen-wheel-scroll-lines` 744.

Rust-only rows: `model` (`settings.rs:178`), `thinking` (`:181`), `scoped-models`
(`:184`).

Also, a submenu **replaces** the settings list in the port (`settings.rs:55-59`), while
the original's `SettingsList` owns the nested submenu and returns to it
(`packages/tui/src/components/settings-list.ts:57-60,309-353`).
`SteppedSubmenu` (`settings-submenu.ts:146-241`) has no counterpart at all.

**Observed.** Live, side by side. The original `/settings` shows a **bordered** list
with a `>` search row and value columns:

```
              ────────────────────────────────────────────────────────────────────────
              >
              → Auto-compact                      true
                Auto-resize images                true
                Block images                      false
```

The port shows an unbordered flat list of label + description and a `(1/15)` counter.

**Check.**
* Rust: a test that builds the settings list from a full `Settings` and asserts the
  row count and the presence of each key; one that types into the settings list and
  asserts the rows narrow.
* Parity: `/settings` on both sides; the row lists must match.

#### 6. Transcript search never highlights a match, never scrolls to it, and the counter is off by one

**What the user sees.** Ctrl+Shift+F counts matches but the transcript never moves and
no match is highlighted; the first Enter already shows "2/N".

| | |
|---|---|
| Original | `packages/tui/src/tui-alt-screen.ts:1544` `applySearchHighlights()` paints every match inline (`:1524` themed underline / bold+inverse for the current one); `:616` `refreshSearch()` selects the first match at/after the anchor and `scrollTo(target, {disableFollow:true})` moves the transcript to it; `:587` `navigateSearch()` cycles matches with clickable ↑/↓ buttons (`:604`) |
| Port | `rpi-tui/src/alt_screen_search.rs:302` `highlight_line()` exists but **is never called** (grep over the whole `rpi` tree: only its definition and its tests); `on_match` (`:57`) has no caller, so the CLI only updates the counter (`rpi-cli/src/interactive_tui.rs:2894-2899`) |

The off-by-one: `next_match()` (`alt_screen_search.rs:203`) returns
`matches[current_index]` and **then** advances; `previous_match()` (`:229`) decrements
**first** and returns the new one. The CLI reads `get_match_index()` afterwards
(`interactive_tui.rs:2765`), so the first Enter shows **"2/N"** where the original
shows "1/N".

The corpus also differs: the original searches the scroll view's `scrollContentLines`
(`tui-alt-screen.ts:620-621`); the port searches
`rpi-cli/src/interactive_tui/rendering.rs:525-528` `collect_transcript_lines()` =
`chat_container.render(80)` — a **hard-coded 80 columns**, chat container only.

**Check.**
* Rust: a test that searches a two-line transcript, asserts the first match index is 0
  after the query settles and that `highlight_line` marks the match; one that asserts
  the search corpus is rendered at the terminal width, not 80.
* Parity: a search scenario in `drive.mjs` that types a term present twice.

#### 7. No scrollbar, no jump-to-latest, no link opening, no flash banner in the interactive mode

**What the user sees.** The transcript has no scrollbar to drag, no "Jump to latest
message" pill, clicking a link does nothing, and copying gives no confirmation.

| | |
|---|---|
| Original | `packages/coding-agent/src/modes/interactive/tui-renderer.ts:29-31` passes `scrollToEndIndicatorPlacement: "below-scroll-view"`, the label " ↓ Jump to latest message " and `openUrl: openBrowser`; `packages/tui/src/tui-alt-screen.ts:1677` paints the indicator, `:1065` handles its click, `:1425-1433`/`:1394-1408` open links on press+release, `:1705` `compositeFlashes()` renders the banner used for "Copied!" (`:1520`) |
| Port | the transcript scroll view is created with `ScrollbarMode::Hidden` (`rpi-cli/src/interactive_tui.rs:1205`; the comment at `:1156-1159` says "Our Auto mode has no hide timer yet"), so the drag path is unreachable. `tui_alt_screen.rs:612` `set_scroll_to_end_indicator` and `:1282` `set_url_opener` are **never called** from `rpi-cli`. `grep -r flash rpi/crates/rpi-tui/src` → **no matches** |

Where a scrollbar *is* visible (the side panel,
`rpi-cli/src/interactive_tui/side_questions.rs:64`) the port paints **thumb only, no
track** (`rpi-tui/src/scroll_view.rs:461-486`), and `scrollbar_hide_delay_ms`
(`scroll_view.rs:61-62`) is declared but never read, so `Auto` never hides.

**Check.**
* Rust: a test that drives a wheel event over a long transcript and asserts the
  scrollbar becomes visible; one that asserts `set_url_opener` is installed by the CLI
  (a call-site test, e.g. a `TuiState` field assertion).
* Parity: a mouse scenario in `drive.mjs` that scrolls and clicks.

#### 8. The mouse affordances the original wires into the transcript are absent

**What the user sees.** Clicking a tool's output does not expand it; clicking a
thinking summary does not reveal it; clicking the skill card does not toggle it; and on
the empty-session screen, clicking the input box does not focus the editor.

| | |
|---|---|
| Original | `components/tool-execution.ts:163-170` `createResultRegion` (left-click toggles `setExpanded`), applied at `:301,:311,:321,:333,:339`; `components/assistant-message.ts:203-211` (left-click toggles that thinking run); `components/skill-invocation-message.ts:149-165` (left-click toggles the skill card, 500 ms double-click burst guard at `:20`); `components/centered.ts:33-42` forwards clicks with `x - padLeft` |
| Port | `rpi-tui/src/mouse.rs:67` `MouseRegion` exists but **is never used by the CLI** (grep `MouseRegion` over `rpi/crates/rpi-cli/src` → no matches); `rpi-tui/src/tool_execution.rs` has **no** `handle_mouse`; `AssistantMessageComponent::toggle_thinking_run` (`rpi-tui/src/assistant_message.rs:476-499`) is called **only from its own unit test** (`:950`); neither `Centered` (`rpi-tui/src/empty_session.rs:39-56`) nor `EmptySessionScreen` (`:88-121`) implements `handle_mouse` |

The `Centered` padding arithmetic itself is identical (`innerWidth(20)=10`,
`padLeft(20)=5` on both sides), so only the forwarding is missing.

**Check.**
* Rust: a test that synthesises a left-click on a tool panel and asserts the panel
  expanded; one on the thinking summary.
* Parity: a mouse scenario that clicks a tool row on both sides.

#### 9. The assistant reply emits no OSC 133 prompt zone

**What the user sees.** A terminal that marks prompt boundaries sees a prompt start
with no matching prompt end for the model's reply. The port also cannot implement the
"jump to previous prompt" gesture, which the original builds on those markers.

| | |
|---|---|
| Original | `components/assistant-message.ts:9-11` defines the markers; `:84-93` `render()` prefixes line 0 with `133;A` and the last line with `133;B`+`133;C` (skipped only when the message has tool calls, `:86`, `:220-221`). The alt-screen then relies on them: `packages/tui/src/tui-alt-screen.ts:73-74` (`OSC133_PROMPT_START`), `:528-538` (`scrollToPrompt`) |
| Port | `rpi-tui/src/assistant_message.rs:603-613` `render()` adds only trailing spacing. Grep `OSC133\|133;A\|133;B\|133;C` over the whole `rpi` tree returns **only** `rpi-tui/src/user_message.rs:21-23`. Grep `133` over `rpi-tui/src/tui_alt_screen.rs` → no matches |

**Check.**
* Rust: a test that renders an assistant message and asserts the first line starts
  with `133;A` and the last ends with `133;B` + `133;C`.
* Parity: not observable in the pane (zero-width); assert on the rendered lines.

### Tier 2 — visible but different

#### 10. A truncated response produces no notice at all

| | |
|---|---|
| Original | `components/assistant-message.ts:220-239`, **inside** the message body: `length` → "Response was truncated before completion." `:222-226`; `aborted` → `errorMessage` or "Operation aborted" `:228-234`; `error` → "Error: <msg>" / "Unknown error" `:235-239` |
| Port | the equivalent code exists at `rpi-tui/src/assistant_message.rs:501-519` (`update_error`) — **but the host never calls it** (grep `update_error` over `rpi/crates` → only the definition `:502` and its unit test `:679`). The host instead renders a detached note: `rpi-cli/src/interactive_tui/events.rs:521-533` `assistant_error_text()` returns `None` for every stop reason other than Error/Aborted (`:522-525`, `_ => return None`), drawn as `"  ✗ <text>"` (`rpi-cli/src/interactive_tui/rendering.rs:569-577`) |

**What the user sees.** A response cut off at the length limit shows **no notice**;
abort/error show a detached `✗` line after the message instead of a red line inside
it, with different wording ("Request aborted." vs "Operation aborted", "Provider
request failed." vs "Unknown error") and emoji the original does not use.

**Check.** A mock turn that stops with `length`; assert the notice appears inside the
message on both sides.

#### 11. The startup header now matches the original's, bar two blank lines and a wrap width

**What the user sees.** The header is the original's: the Pi mark, the version, the
compact hint line, the "Press Ctrl+O to show full startup help." line, the onboarding
sentence and the tmux warning. Three residual differences remain.

| | |
|---|---|
| Original | `interactive-mode.ts:1111-1179`: the `BuiltInHeader` component (`:255-263`) — logo + `v<version>` `:1116-1119`; a compact hint line built live from the keybinding registry `:1133-1140`; "Press Ctrl+O to show full startup help." `:1141-1142`; onboarding `:1160`; Ctrl+O expands it to 19 items `:1122-1132`; the logo's first two lines are clickable (`:1168`) |
| Port | `rpi-cli/src/interactive_tui/rendering.rs:11` `add_welcome_message` — `pi_logo_lines()` `:36-49` (the same half-block mark in coral/blue/yellow), ` v{version}` from `crate::changelog::current_version()`, `compact_hints()` `:52-64`, the "Press {app.tools.expand} to show full startup help." line, `add_startup_note` `:133` and `add_tmux_warning` `:66` |

**Observed.** Live, `drive.mjs rust tool` vs `drive.mjs ts tool` — the header content is
identical line for line, with three residuals:

1. the original's header block starts with a **blank line** before the logo; the port's
   does not;
2. the original puts **two** blank lines between the onboarding sentence and the tmux
   warning; the port puts one;
3. the tmux warning wraps at a different width — the original wraps inside the header's
   one-column padding (96 columns of content), the port across the full pane
   (100 columns), so the sentence breaks one word later.

**Still missing from the header:** the original expands it into a 19-item hint list on
Ctrl+O (`interactive-mode.ts:1122-1132`, `:2869-2871`); the port's header is a fixed
four-line block. And the logo is not clickable (the original plays the 3-D easter egg
from it, `:1168`).

**Check.** Parity: the `tool` scenario's first pane, compared line for line with the
golden. The blank lines are the only difference the pane can settle; the expansion and
the click target need their own checks.

#### 12. The model picker lost the scope toggle, "save as default", the provider grouping and the footer

| | |
|---|---|
| Original | `components/model-selector.ts:31`: scope toggle and title `:74`, `:87-95`, `:124-127`; Ctrl+S "set as default" `:110-116`, `:128-135`; the `· default` marker and the `"default"` search hoist `:188`, `:193-200`; sort current-first/default-second/provider `:229-244`; the `✓ ` prefix `:187`; preselect the current model `:165-172`; background catalog refresh with status/error footer `:83`, `:246-283`; the "Only showing models from configured providers" warning title `:94`; the selected-model footer `:96-108`; "No matching models" `:118-120` |
| Port | `rpi-cli/src/interactive_tui/selectors.rs:121-192` `open_model_selector`; rows from `rpi-cli/src/interactive_tui/settings.rs:500-545` `model_selector_items`; the port has no `app.models.*` binding at all (`rpi-tui/src/keybindings.rs:792-860`) |

**Observed.** Live. The original `/model` renders

```
              > Search
              → ✓ mock-1                        [mock]
                Model catalogs refreshed.
                Enter to select · Ctrl+S to set as default · Escape/Ctrl+C to cancel
```

The port renders `Select model` / `Type to filter by name, provider, or id` / `>` /
`→ Mock Model                      mock/mock-1 (current)` — no hint line, no refresh
status, no ✓ marker, and the label is the model *name* where the original shows the
*id* plus `[provider]`.

**Check.** Parity: `/model` on both sides with the mock catalog.

#### 13. The pickers all lost the shared menu framework

| | |
|---|---|
| Original | a generic `MenuComponent` (`components/menu.ts:48`): title `:26`; search field `:82-86`; **loading state** `:32`, `:76-77`, `:170-173`; transient **footer text** `:181-184`, `:250-253`; **hint line** `:192-196`; per-menu empty text `:200-202`; **floating/overlay mode** `:38`, `:95-97`, `:115`; selection-change callback `:68`, `:151`; per-selector `handleExtraKey` `:205-207`. The filter runs over `${title} ${description}` (`:277-281`) |
| Port | `rpi-tui/src/searchable_select.rs:26` `SearchableSelectList`: title, description, a "Type to filter..." input (`:41`), the list, mouse forwarding (`:137-147`). **No loading state, no footer row, no hint line, no floating mode, no extra-key hook, no selection-change callback** (nothing in `rpi-cli` registers `on_selection_change`). The filter key is `search_text ?? value` (`rpi-tui/src/select_list.rs:57-60`), so the per-item **description is not searched** |

There is **no generic menu in the port at all**: each menu is a bespoke
`open_*_selector` in `rpi-cli/src/interactive_tui/selectors.rs` (11 of them — model
`:121`, session `:301`, tree `:408`, theme `:487`, provider `:550`, login `:626`,
logout `:682`, provider-remove `:728`, thinking `:836`, tools `:919`, images `:1017`),
so these features cannot be added once.

Per-picker losses:

* **Theme picker** — `rpi-cli/src/interactive_tui/selectors.rs:487-545` offers **3
  hard-coded presets** (`:493-497`) instead of `getAvailableThemes()` + "system" +
  user/package themes; no `(current)` marker, no preselection, **no live preview**
  (original `components/theme-selector.ts:29-45`).
* **Scoped-models picker** — `rpi-cli/src/interactive_tui/settings.rs:1827-1911` has no
  ✓/disabled marker, no enable-all / clear-all / toggle-provider / reorder, no dirty
  marker, no count footer, no search field, and it saves on **Esc** instead of Ctrl+S
  (original `components/scoped-models-selector.ts:190-374`).
* **Thinking picker** — `rpi-cli/src/interactive_tui/selectors.rs:836` has no search,
  no ✓, no `· default`, no preselect and no save-as-default
  (original `components/thinking-selector.ts:33-64`); and its level descriptions carry
  **different numbers** — "Low — Light reasoning (~1k tokens)" where the original says
  ~2k, "Medium — Moderate reasoning (~80 % of max)" where it says ~8k, "High —
  Extensive reasoning (~95 % of max)" where it says ~16k
  (`selectors.rs:783-796` vs `components/thinking-selector.ts:7-15`).
* **Show-images picker** — `selectors.rs:1017-1068` does not preselect the current
  value (`:1036`); the labels are "Inline images"/"Placeholder only" where the original
  uses "Yes"/"No" with descriptions (`components/show-images-selector.ts:23-26`).
* **Extension selector** — `rpi-cli/src/interactive_tui/extensions.rs:400-516` has no
  search field; plain `j`/`k` do nothing (the port's `SelectList` only honours
  **Ctrl**+j/k/p/n, `rpi-tui/src/select_list.rs:327-338`); no countdown auto-cancel;
  `app.tools.expand` is not handled (original `components/extension-selector.ts:65-84`).

**Check.**
* Rust: a test for the menu framework — a loading state, a footer text and an
  extra-key hook, one per feature.
* Parity: open each picker on both sides and compare the rows and the hint line.

#### 14. The trust picker is missing; `/trust` takes an argument instead

| | |
|---|---|
| Original | `components/trust-selector.ts:55-83`, `:100-127` — a "Project trust" panel with the cwd, the saved decision (including "inherited from <path>"), the current-session state, a list of options with a ✓ on the saved one, navigable with ↑/↓ **and plain j/k** (`:117-123`). `TrustSelection` also carries `updates` (`:14`) |
| Port | `rpi-cli/src/interactive_tui/commands.rs:582-617` `TrustCommand` takes `yes\|no\|clear` (`:598-606`); `set_project_trust_for_command` `:582-587` |

**Check.** A test that renders the trust panel and asserts the saved decision and the
"inherited from" path; a parity run of `/trust` with no argument on both sides.

#### 15. The OAuth / login pickers lost their auth-type and status columns

**What the user sees.** The login list says whether a provider is configured but not
*how* it is configured — no `[subscription]` / `[account]` / `[API key]` type column and
no `✓ configured` / `• not configured` markers.

| | |
|---|---|
| Original | `components/oauth-selector.ts`: the auth-type label column `[subscription]`/`[account]`/`[API key]`, shown only when the provider set mixes auth types `:64-77`; the status column `✓ configured` / `• not configured` / `• <type> configured` (warning colour when the stored type differs) / `✓ env: FOO` `:30-52`; distinct empty texts for login vs logout `:100-103`; a filter over name + id + authType + method `:105-118`; distinct titles `:74-80` |
| Port | `rpi-cli/src/interactive_tui/settings.rs:668` `login_provider_items_with_oauth` — the rows carry a description (configured / not configured / from an env var) but **no auth-type label and no ✓/• markers**. The provider picker has its own scheme (`settings.rs:1195` `provider_origin_protocol`) with a separate "Add new provider" item (`selectors.rs:573`) |

*(The hard-coded Chinese descriptions this row used to report are gone from
`settings.rs`; the strings are English now.)*

The login dialog itself is also thinner:

| | |
|---|---|
| Original | `components/login-dialog.ts:99-112` opens the browser and renders the URL as an **OSC-8 hyperlink** with a "Cmd+click to open · Ctrl+X to copy" hint (`components/auth-url.ts:22-41`); the device-code path `:117-131` prints "Enter code: …" in warning colour and waits |
| Port | `rpi-cli/src/interactive_tui/settings.rs:1047` `begin_provider_oauth_input` — a plain `Open: {url}` line (`:1064`) and a single-line input. `grep open_browser rpi/crates/rpi-cli` → **no hits** (the helper exists unused at `rpi-tools/src/utils/open_browser.rs:76`). `grep 'device_code\|user_code\|verification_uri' rpi/crates` → **no matches** |

The API key is also **masked** in the port where the original shows it in clear text
(`packages/tui/src/components/input.ts:23-31` has no mask option).

**Check.** A test that renders the login provider rows and asserts the auth-type label
and the ✓/• status markers; a parity run of `/login`.

#### 16. The compaction, branch-summary, custom-message and custom-entry cards are plain notes

| | |
|---|---|
| Original | `components/compaction-summary-message.ts:15-16`, `:40-58` — a `Box` on `customMessageBg` with a `[compaction]` label, collapsed as "Compacted from N tokens (Ctrl+O to expand)" and expanded as "**Compacted from N tokens**" + markdown, clickable via `MouseRegion` `:60-68`. `components/branch-summary-message.ts:40-59` is the twin (`[branch]`, "Branch summary (Ctrl+O to expand)"). `components/custom-message.ts:36`, `:93-112` — a `Box` on `customMessageBg` with a `[<customType>]` label in `customMessageLabel` and the body as `Markdown` in `customMessageText`. `components/custom-entry.ts:56-57` renders a renderer failure as a red `[<customType>] renderer failed: <msg>` inside a `customMessageBg` box |
| Port | compaction → a plain note `"Compacted {n} tokens: {summary}"` (`rpi-cli/src/interactive_tui/sessions.rs:399-407`); branch summary → `"Branch summary: {summary}"` (`:409-412`); a custom **message** falls back to `custom_message_fallback` → the note `"{role}: {content}"` (`sessions.rs:611-623`); a custom **entry** renders through the extension when one is registered (`sessions.rs:427-449`) but otherwise as a note, and a renderer that throws is not shown as an error box. `extension_text_component` (`sessions.rs:505-529`) returns a bare `Text`/`AssistantMessageComponent` — **no box, no label, no background** |

Also: the user bubble now paints its background with `colors.user_message_bg`
(`rpi-tui/src/user_message.rs:43`), matching the original's token, but it still gives
the Markdown **no colour function**, so the `userMessageText` token is unused, and it
still has no markdown-transformer hook (finding 21).

**Check.** A test that renders a compaction entry and asserts the `[compaction]` label
and the collapsed form; a parity run over a session with a compaction and a branch
summary.

#### 17. The `edit` tool lost its own shell and its live preview diff; extension tool renderers are dropped

| | |
|---|---|
| Original | `core/tools/edit.ts:157` declares `renderShell: "self"` — the tool owns its framing and `components/tool-execution.ts:117-119`, `:244-268` skips the standard `Box`. `core/tools/renderers/edit.ts:177-206` computes a **live preview diff** from the file while the call is pending (`computeEditsDiff`, `:189-201`) and renders it inside the call component (`edit.ts:133-151`). Extension renderers are resolved at `core/extensions/runner.ts:797-801` and merged at `interactive-mode.ts:1979-1983`; MCP tools get one at `core/extensions/mcp/tools.ts:357-390` |
| Port | `rpi-tui/src/tool_execution.rs:628-700` always draws the standard `ToolPanel` shell — there is no `renderShell` concept anywhere in the tree (grep `renderShell` → no matches) — and the diff only appears after the tool returns (`rpi-cli/src/transcript_view.rs:952-972` reads `details.diff`). The JS host collects `registerToolRenderer` registrations (`rpi-js/js/extension-host.ts:384-386`) into `state.toolRenderers` and **nothing consumes that list**; `ToolExecutionComponent::set_renderer` (`rpi-tui/src/tool_execution.rs:277-282`) is never called — the renderer is fixed at construction from `builtin_renderer(name)` (`:125`) |

The **built-in** renderer name sets are identical on both sides — original
`core/tools/renderers/index.ts:31-40` and port `rpi-tui/src/tool_renderers.rs:84-101`
both cover read, bash, powershell, edit, write, grep, find, ls. The gap is the MCP /
codemode / extension renderers.

The generic (renderer-less) panel also differs: the original shows the **full
pretty-printed args JSON** and the full output for a tool with no definition
(`components/tool-execution.ts:404-417`), capped at `FALLBACK_PREVIEW_LINES = 10`
(`:24`); the port shows a compact `key=value` summary, the args JSON only when expanded
(`rpi-tui/src/tool_execution.rs:471-493`), and caps the result at 12 rows
(`:570-603`).

**Check.** Parity: the `tool` scenario renders an `edit` call; assert the pending
preview and the panel framing.

#### 18. The status indicator is only wired for retries

| | |
|---|---|
| Original | `components/status-indicator.ts:7` defines kinds `working \| retry \| compaction \| branchSummary`; `:38-49` working, `:51-80` retry with a live countdown, `:85-99` compaction, `:102-112` branch summary; `:24-31` `renderInBorder`/`renderSpinnerInBorder` are used by the editor's top border (`components/custom-editor.ts:39-88`); `IdleStatus` renders two blank lines and is installed when idle (`interactive-mode.ts:2100-2102`) |
| Port | `rpi-tui/src/status_indicator.rs:25-39` defines the same four kinds and `:58-135` the constructors — but the CLI builds **only the retry one** (grep `StatusIndicator::(working\|compaction\|branch_summary\|retry)` over `rpi/crates` → `retry` at `rpi-cli/src/interactive_tui/state.rs:1384-1389` and `rpi-cli/src/tui_shell.rs:377-378`; the other three appear only in `status_indicator.rs`'s own tests). `IdleStatus` (`:222-240`) is never used by the host |

**What the user sees.** During an automatic compaction or a branch summarisation there
is **no "Compacting context… (Esc to cancel)" / "Summarizing branch… (Esc to cancel)"**
indicator; the original shows one (`interactive-mode.ts:3528`, `:3624`, `:5546`).

The rendered line also differs: the port emits `spinner + elapsed + message`
(`status_indicator.rs:176-219`), and the elapsed is not in the original's loader
(`packages/tui/src/components/loader.ts:82-88`).

**Check.** A test that triggers an auto-compaction and asserts the compaction status
line appears.

#### 19. The loaders render a different line, in different colours, with an extra hint and a wrong key

| | |
|---|---|
| Original | `packages/tui/src/components/loader.ts:43-45` returns a **leading blank line** then `"⠋ message"` with the caller's theme colours and **no elapsed time**; the retry countdown takes its key from `keyText("app.interrupt")` (`components/status-indicator.ts:55-57`) |
| Port | `rpi-tui/src/loader.rs:147-180` returns **one** line `"⠋ message 12s"` with **hard-coded** ANSI colours — cyan spinner `\x1b[36m`, bold message `\x1b[1m`, gray time `\x1b[90m` — not the theme's accent/muted, truncating the message with `"..."`. The retry countdown hard-codes **"Ctrl+C to cancel"** (`rpi-tui/src/status_indicator.rs:137-141` via `raw_key_hint_keys()`), whose comment at `:249` claims "no `app.interrupt` binding exists" — false, it is at `rpi-tui/src/keybindings.rs:156-159` |

The port's `CancellableLoader` no longer adds the extra "Press Ctrl+C to cancel" line
the original does not have (`rpi-tui/src/loader.rs:256-265` — "The original's
cancellable loader shows no text of its own"), so that gap is closed; what is left is
the leading blank line, the elapsed suffix and the hard-coded colours.

`BorderedLoader` is ported (`rpi-tui/src/bordered_loader.rs:29`) but has **no call site
in the CLI**; the original uses it for `/bug`
(`packages/coding-agent/src/modes/interactive/bug-report.ts:275-279`) and `/share`
(`modes/interactive/session-share.ts:114-117`, `:166-170`).

The bash panel differs too: the original draws a `DynamicBorder` rule above and below
the block (`components/bash-execution.ts:45-60`), collapsing the preview to the last 20
**logical** lines (`:19`, `:129-131`); the port draws a tinted `ToolPanel` with **no
rules** and truncates the whole output to the last 20 **visual** lines. The running row
now matches (`rpi-tui/src/bash_execution.rs:342-351`: `"⠋ Running... (Esc to cancel)"`
with a resolved key) — the Chinese hint this row used to report is gone from the
render, though a stale doc comment mentioning it remains at `:33`.

**Check.** Parity: a bash run on both sides; compare the panel frame and the running
row.

#### 20. The progress line the original can draw does not exist in the port

| | |
|---|---|
| Original | `components/progress-bar.ts:31` `AgentProgressBar` draws one row of `"▔"` in the accent colour, growing at most one cell per 100 ms (`:22`, `:135-143`), filled against the median of this session's past runs (default 15 s, `:107-112`), capped at 95 % while running (`:100-104`), held full for 800 ms on completion (`:130-134`); placed at the **top row** in fullscreen (`interactive-mode.ts:1081`) or **above the input** in regular mode (`:891`); gated by `terminal.showTerminalProgress` (default **false**, `core/settings-defaults.ts:38`) |
| Port | `rpi-tui/src/progress.rs:45` `ProgressBar` is a generic in-cell block bar `"█░ NN%"` with **no call site outside its own unit test** (`:251`; grep `ProgressBar rpi/crates/rpi-cli` → no hits). `Terminal::set_progress` (`rpi-tui/src/terminal.rs:454-462`) implements OSC 9;4 but is **never called** |

Note: the OSC 9;4 escape is dead on **both** sides now — the original's own changelog
says so (`packages/coding-agent/CHANGELOG.md:22-23`), so the difference is the
*drawing*, not the escape.

The port reuses `show_terminal_progress` for two things: it gates the editor's embedded
"Working…" spinner (`rpi-cli/src/interactive_tui/state.rs:1008-1015`) while its
description promises "OSC 9;4 progress in the terminal tab bar"
(`rpi-cli/src/interactive_tui/settings.rs:224-228`), and it **defaults to true**
(`interactive_tui.rs:923-927`) where the original defaults it to false. Net: the port
always shows the embedded working spinner (the original does too —
`interactive-mode.ts:675` sets `embedWorkingStatus: true` unconditionally) and never
the progress hairline.

**Check.** A test that renders the progress bar at t = 0, 1 s, 2 s and asserts the
hairline grows by at most one cell per tick and never past 95 %.

#### 21. The markdown transformer chain is narrower and does not cover user messages

| | |
|---|---|
| Original | `interactive-mode.ts:1985-1987` builds `[mermaidTransformer, ...extensionRunner.getMarkdownTransformers()]` and passes it to the user message (`components/user-message.ts:49-55`), skill messages (`:3791`) and assistant messages (`:3791-3802`); the context is `{ messageType, isStreaming, availableWidth }` (`core/extensions/types.ts:1541-1547`, built by `components/markdown-transform.ts:5-9`) |
| Port | `rpi-cli/src/interactive_tui.rs:106` types the transformer as `Arc<dyn Fn(&str) -> String + Send + Sync>` — no context, so a handler cannot know the message type, streaming state or width — and installs it only on the assistant component (`rpi-tui/src/assistant_message.rs:251-256`); `rpi-tui/src/user_message.rs` has no `set_markdown_transformer`, and `rpi-tui/src/markdown.rs` has **no `transform` option**, so the transform is applied before styling rather than inside the renderer |

Error isolation is equivalent: the original wraps each transformer in `try/catch`
(`components/markdown-transform.ts:19-35`), the port skips a failing handler and
continues (`rpi-cli/src/interactive_tui.rs:156-200`).

**Check.** A test that registers a transformer that throws and asserts the markdown
still renders.

#### 22. Mermaid has no modes

| | |
|---|---|
| Original | `components/mermaid.ts:60-101` — a transformer with three modes from `settings.markdown.mermaid` (default `"streaming"`, `core/settings-defaults.ts:54`): `off` → raw markdown `:72`; `final` → only when not streaming `:74`; `streaming` → also while streaming `:74`; assistant-thinking is never transformed `:71`; art wider than `availableWidth` keeps the raw block `:88`; parse failures surface as "Mermaid diagram not rendered: …" `:90-94` |
| Port | every ` ```mermaid ` fence is rendered unconditionally (`rpi-tui/src/markdown.rs:299-303` → `rpi-tui/src/mermaid.rs:15`). No setting, no mode, no streaming distinction, no thinking exclusion, no width guard, no warning path |

The renderer also differs: the original draws real Unicode box diagrams via
`grok-mermaid` (`components/mermaid.ts:66-99`); the port's `Mermaid` is hand-written,
prints one row per edge (`rpi-tui/src/mermaid.rs:100-140`) and falls back to the raw
source for unknown kinds (`mermaid.rs:48-60`).

**Check.** A test that renders the same diagram in each of the three modes and asserts
the output.

#### 23. The wheel scroll amount, the Alt multiplier and the text-selection granularity differ

| | |
|---|---|
| Original | `packages/tui/src/tui-alt-screen.ts:76` `ALT_WHEEL_SCROLL_MULTIPLIER = 5`, applied at `:737-738`; the base amount comes from `packages/tui/src/wheel-scroll.ts:40-72` `WheelScrollAccelerator` — a notch moves 1 line and a fast spin accelerates up to 6 (the coding agent passes `"auto"`, `modes/interactive/tui-renderer.ts:34`) |
| Port | `rpi-tui/src/tui_alt_screen.rs:403` `wheel_scroll_lines: AtomicI32::new(3)` — a fixed 3 lines; `set_wheel_scroll_lines` (`:408`) has **no caller**; the `alt` modifier is decoded (`:195`) but **never read** anywhere in `rpi-tui`, so Alt+wheel scrolls the same 3 lines |

The original also cancels the wheel gesture after a jump-to-end (`:520-530`,
`:729-734`) so trackpad momentum does not undo the jump; the port has no gesture state
(`:682-697`).

Text selection: the original double-click selects a word and triple-click a line
(`packages/tui/src/tui-alt-screen.ts:1205`, `:1236`, click-count window `:1269`),
dragging past the edge auto-scrolls on a 50 ms timer (`:1295`, `:1327`), and the
selection comes from the scroll view's content so it can extend past the viewport
(`:1197`, `:1475`). The port's `start_text_selection`
(`rpi-tui/src/tui_alt_screen.rs:1612`) has **no granularity state**, no auto-scroll
(`:1640`), and `selection_text` (`:1706`) reads the **rendered screen** rather than the
scroll content — so the selection can include the editor rows and text scrolled out of
view can never be selected.

The original also tracks terminal focus (mode 1004, `packages/tui/src/tui-alt-screen.ts:67-70`,
clearing the selection on focus-out); the port enables only `1000/1002/1003/1006`
(`rpi-tui/src/terminal.rs:331-339`) and nothing handles `InputEvent::FocusLost`
(`terminal.rs:93`).

Related: the port's own second, dead selection implementation
(`rpi-cli/src/interactive_tui.rs:2123-2164`) can never fire, because the TUI consumes
the `Drag` (`rpi-tui/src/tui_alt_screen.rs:1591`).

**Check.** A test that synthesises a wheel event and asserts the scroll delta is 1
line, then an Alt+wheel and asserts 5.

#### 24. The keybinding hints colour the key `muted` where the original uses `dim`

| | |
|---|---|
| Original | `components/keybinding-hints.ts:14` — `process.platform === "darwin" && part.toLowerCase() === "alt" ? "option" : part`; the key is `dim`, the description `muted` `:44`; `keyHint` resolves `app.tools.expand` through the live registry `:43-45` and is used at `components/tool-execution.ts:158`, `components/bash-execution.ts:183-188`, `core/tools/renderers/{read,write,grep,find,ls}.ts`, `components/compaction-summary-message.ts:56`, `components/branch-summary-message.ts:55` |
| Port | `rpi-tui/src/keybinding_hints.rs:22` `format_combo` now rewrites `alt` to `option` on macOS (`:33-39`) and honours `capitalize` (`:56-60`), so the two wording gaps are closed. The **colour** gap is not: `key_hint` (`:141-145`) and `raw_key_hint` (`:149-152`) both call `hint_line(…, colors.muted, colors.muted)` — the key is `muted` where the original dims it — and the doc comment at `:139-140` still says "rpi-tui has no `dim` color" although the theme has one (`rpi-tui/src/theme.rs:35` `pub dim: Color`) |

The expand hints are now resolved from the registry, so a rebind is reflected:
`rpi-tui/src/tool_renderers.rs:165-168` `expand_hint` → `key_text("app.tools.expand")`
(also `:468`), `rpi-tui/src/tool_execution.rs:594`/`:602`,
`rpi-tui/src/bash_execution.rs:249`/`:254`.

**What the user sees.** Every hint in the app — the pending-dock hint, the hotkeys
table, the tool panels, the status line — paints the key in the same muted grey as
its description, where the original dims the key and mutes the description.

**Check.** A test that renders `key_hint` and asserts the key segment carries the
`dim` colour and the description the `muted` one.

#### 25. The first-run dialog fires for everyone and offers different options

The component itself is a faithful port: `rpi-tui/src/first_run.rs:38` reproduces
`components/first-time-setup.ts:29` — the same 4-line block logo
(`first_run.rs:20` vs `first-time-setup.ts:26`), "Welcome to Pi, the minimal coding
agent." (`:170` vs `:57`), "Pick a theme." (`:174` vs `:62`), the `"→ "` marker
(`:181-188` vs `:86-92`), the `↑↓ navigate · <confirm> continue · <cancel> skip setup`
hint (`:191-198` vs `:70-78`) and the dynamic borders (`:158`, `:200` vs `:51`, `:80`).

The differences:

* **Options.** The original offers **System / Dark / Light**
  (`components/first-time-setup.ts:20-24`); the port offers **dark / light /
  monochrome** (`rpi-cli/src/extras.rs:47-53`) — no System theme, and a Monochrome
  option the original does not have.
* **Trigger.** The original runs the setup only when `PI_EXPERIMENTAL=1`, on the
  official distribution, with the default agent dir and no `settings.json`
  (`packages/coding-agent/src/cli/first-time-setup.ts:37-53` →
  `core/experimental.ts:2`), as a **pre-start** dialog in its own TUI
  (`packages/coding-agent/src/main.ts:690-693` → `cli/startup-ui.ts:136`). The port's
  `first_run_pending()` (`rpi-cli/src/extras.rs:39-43`) checks only a `.setup_done`
  sentinel, so **every** new rpi user gets the picker.
* **Place.** The port adds the dialog to the **live transcript pane**
  (`rpi-cli/src/interactive_tui.rs:1137-1142`) instead of before the TUI starts, and
  suppresses the empty-session screen while it is up (`:1525`).
* **Ctrl+C is dead.** The key loop routes **every** key to the dialog and `continue`s
  (`interactive_tui.rs:2248-2258`) *before* the global Ctrl+C handler (`:2262-2280`);
  `FirstRunDialog::handle_key` (`first_run.rs:95-107`) matches only Up/Down/k/j/Enter/Esc.
  The original's Ctrl+C is `tui.select.cancel`
  (`packages/tui/src/keybindings.ts:150-153`) and cancels the setup
  (`components/first-time-setup.ts:106-107`).
* **The registry is ignored.** The original matches through `getKeybindings()`
  (`first-time-setup.ts:96-107`); the port hard-codes the key codes
  (`first_run.rs:96-106`).
* **Branding.** The port hard-codes "Pi" in the welcome line (`first_run.rs:170`)
  although the product is `rpi` (`rpi-cli/src/lib.rs:90`).

**Check.** A test that boots with a fresh agent dir and asserts the dialog appears, and
one that asserts Ctrl+C cancels it.

#### 26. The window title, the queued dock, the empty text and the dynamic border differ

**a. Window title.**

| | |
|---|---|
| Original | `interactive-mode.ts:1230-1237` — `"Pi - <session> - <cwd>"`, or `"Pi - <cwd>"` |
| Port | `rpi-cli/src/brand.rs:76-89` — `"▃ ▅ ▂ rpi · 🦀"` plus a run-state glyph `"⟳"` / `"↻"` (`rpi-cli/src/interactive_tui/state.rs:1124`, `:1030`, `:1251`). No session name, no cwd |

**b. Queued-message dock.**

| | |
|---|---|
| Original | `interactive-mode.ts:4588-4610` — `Steering: …` / `Follow-up: …` rows rendered with `TruncatedText` (single line, ellipsised) in `dim`, then `↳ <key> to edit all queued messages`. The same container also hosts the **running bash output** (`:6992-6997`, `:7025-7027`) |
| Port | `rpi-cli/src/interactive_tui/state.rs:1070-1107` — the same two row kinds and the same `↳ … to edit all queued messages` hint, but rendered with plain `Text` (**wraps instead of truncating**) in `muted` rather than `dim`; the running bash component is not in the dock (`state.rs:164-167`) |

**c. Empty text.**

| | |
|---|---|
| Original | `packages/tui/src/components/select-list.ts:101` — `"  No matching commands"` |
| Port | `rpi-tui/src/select_list.rs:659` — `"  No matching items"` |

**d. Dynamic border.**

| | |
|---|---|
| Original | `components/dynamic-border.ts:15-25` — `─` repeated, coloured `theme.fg("border", …)` |
| Port | `rpi-tui/src/dynamic_border.rs:41-52` — the default is `theme().colors.border_muted` **and** the rule is additionally wrapped in SGR 2, so a default border is fainter |

#### 27. Escape cannot dismiss the autocomplete popup

| | |
|---|---|
| Original | the editor cancels the autocomplete on `tui.select.cancel` (`packages/tui/src/components/editor.ts:972-976`), and `CustomEditor` only routes Escape to `app.interrupt` when the autocomplete is **not** showing (`components/custom-editor.ts:110-124`) |
| Port | the key loop's `app.interrupt` branch (`rpi-cli/src/interactive_tui.rs:2618-2675`) always ends in `continue`, so Escape never reaches the editor; the suggestion list has no dismiss state — it is recomputed from the draft text on every change (`rpi-cli/src/interactive_tui/autocomplete.rs:11-17`, `render_autocomplete` `:56-110`) |

**Check.** A test that opens the completion list, presses Escape, and asserts the list
is gone.

#### 28. Transcript notes emitted before the first user message are invisible

**What the user sees.** On a fresh session, `/session` with no saved sessions prints
nothing at all.

| | |
|---|---|
| Original | the empty state is rendered **inside** the selector ("No items available", `components/session-menu.ts:211`) |
| Port | `rpi-cli/src/interactive_tui/selectors.rs:321-327` adds the note "No saved sessions found. Sessions are created automatically in interactive mode." to the chat container — but the 3-D empty-session screen owns the whole layout root (`rpi-cli/src/interactive_tui.rs:1505-1533`) and is only released when the session gains messages (`interactive_tui.rs:3280-3285`) |

**Observed.** Live, the captured pane shows the logo and the input and **no note**: the
note is behind the logo.

**Check.** A test that renders the empty-session screen with a chat note and asserts
the note is visible, or that the screen is released when a note is added.

#### 29. Word wrapping, tab handling and visual truncation differ

| | |
|---|---|
| Original | `packages/tui/src/components/text.ts:62` replaces tabs with **three** spaces; `:64-66` wraps with `wrapTextWithAnsi` (`packages/tui/src/utils.ts:900-1000`), which is **word-aware**: it breaks on token boundaries, trims trailing whitespace, does not start a continuation line with a space, and breaks an over-long token character-wise (`utils.ts:943-960`) |
| Port | `rpi-tui/src/text.rs:86` calls `crate::utils::wrap_text_with_ansi` (`rpi-tui/src/utils.rs:276-340`), a **hard character-by-character wrap** that breaks mid-word and can start the next line with the space that caused the break; it also **drops control characters** (`utils.rs:317`), so a tab is deleted rather than expanded. `rpi-tui/src/visual_truncate.rs:52` measures "visual lines" through this `Text`, so the port's preview keeps a **different tail** than the original for the same text and width. The port's bash panel converts tabs to **four** spaces (`rpi-tui/src/bash_execution.rs:171`) where the original uses three |

`components/visual-truncate.ts:30-53` also has a `keep: "start"` mode (used by the
codemode and MCP renderers) that the port's `truncate_to_visual_lines`
(`rpi-tui/src/visual_truncate.rs:29-63`) does not have — latent, since those renderers
do not exist in the port either.

> The wrapping difference is owned by the TUI-library audit and is listed here only
> because the transcript previews inherit it; see `scripts/parity/TUI-LIBRARY.md` §1.

**Check.** A test that renders a tab-indented bash output and asserts the indentation
survives; one that truncates a long line and asserts the kept tail matches.

#### 30. The skill-invocation card drops the user's request; the tool row gains a chevron and an inline elapsed

| | |
|---|---|
| Original | `components/skill-invocation-message.ts:24-64` `SkillRequestComponent` renders the `@skill` mention **and the accompanying user request on the same line**, with the request in the width left over by the mention and a hanging indent (`:48-58`); `:66-160` the card is a `Box` on `customMessageBg` with blank rows above/below and the whole card clickable (`:149-165`). The call row shows only the renderer's text (`core/tools/renderers/read.ts:148-157`) and the duration belongs to the **result** renderer as "Elapsed 4.2s" / "Took 4.2s" (`core/tools/render-utils.ts:147-171`) |
| Port | `rpi-tui/src/tool_execution.rs:811-880` `render_skill` renders `[skill] <name> (Ctrl+O to expand)` collapsed — but it is produced by the **tool-panel** path (`set_skill_name`, `:216-224`), the **user's request text is never shown next to the mention**, the collapsed line carries an extra "(Ctrl+O to expand)" the original does not have, and there is no click target. The tool row puts the status glyph, label, args summary, an **inline elapsed** (`:494-533`, `:888-899`) and a `▸`/`▾` chevron in the header row, *and* the result renderers append their own "Elapsed" line (`rpi-tui/src/tool_renderers.rs:762-772`) |

The **spinner sign** in the tool row is missing outright: the original wraps the call
component in a `SignedRow` while the tool is pending/running
(`components/tool-execution.ts:175-180`, `components/spinner-sign.ts:22`), the port
shows a static `"●"` (`rpi-tui/src/tool_execution.rs:454-460`).

**Check.** Parity: a tool scenario on both sides; the pending row must animate.

### Tier 3 — the rest, briefly

* **Config selector** (`components/config-selector.ts:23`, 947 lines: package resources
  with a user↔project write scope, per-item enable/disable and a three-state project
  override) — **missing**; no `/config` command exists in the port.
* **Fork-from-message picker** (`components/user-message-selector.ts:22`) — **missing**;
  the port's `/fork` forks the whole session
  (`rpi-cli/src/interactive_tui/commands.rs:403-414` → `sessions.rs:198-270`) and
  `/clone` is a duplicate of it.
* **Session search query parsing** (`components/session-selector-search.ts:37-100`) —
  **missing**; the port filters fuzzily over `"{label} {short_id} {stem}"` only.
* **Armin bitmap** (`components/armin.ts:9`, 31×36 XBM, seven effects) and the
  **`/arminsayshi`** command — **missing** (`grep arminsayshi rpi/crates` → only a
  changelog line). The 3-D logo frames themselves **are** ported in full
  (`rpi-tui/src/logo3d.rs:636` `pi_logo_model`, `:684` `logo_pose`, `:733`
  `prepare_stars`, `:773` `Logo3d`; wired at `rpi-cli/src/interactive_tui.rs:1593`;
  checked by `scripts/parity/3dicon.mjs` at t = 0, 2, 5 s). What is missing around it
  is the fullscreen dissolve/puzzle (`components/easter-egg-3d.ts:846`) and the
  clickable header logo that triggers it (`interactive-mode.ts:1168`).
* **Earendil announcement banner** (`components/earendil-announcement.ts:27`) —
  **missing**.
* **Auth-URL dialog** (`components/auth-url.ts:13`) and **Radius login selector**
  (`components/radius-login-selector.ts:105`, the shimmering "Sign in with Radius" row)
  — **missing**; the port also collapses the original's two-level "auth method →
  provider" login menu (`interactive-mode.ts:5886-5900`, `:5953-5985`) into one flat
  provider list.
* **Extension input/selector timeouts** (`components/extension-input.ts:74-81`,
  `components/extension-selector.ts:38-51`) — the port's `CountdownTimer`
  (`rpi-tui/src/countdown_timer.rs:18-46`) has **no callbacks** and its only consumer
  is the retry status; the extension dialogs never auto-cancel.
* **Extension editor dialog** (`components/extension-editor.ts:26`) — the port builds
  the editor with a **fresh default registry**
  (`rpi-cli/src/interactive_tui/extensions.rs:549`) instead of the app's configured
  bindings, has no Ctrl+G external-editor branch, and the key loop routes every key to
  an open dialog (`rpi-cli/src/interactive_tui.rs:2337-2351`) so the app-level Ctrl+G
  handler (`:2547-2553`) can never fire while a dialog is open.
* **`ThemedText`** (`components/themed-text.ts:11`) — the port has a one-shot function
  `themed_text(text, color_fn)` (`rpi-tui/src/theme.rs:726`) and a fixed-string `Text`
  (`rpi-tui/src/text.rs:10`); **no component re-colours itself** on a theme swap,
  though the original uses `ThemedText` in ~15 places.
* **Empty-session screen** (`components/empty-session-screen.ts:10`) — the block is
  equivalent (logo + centred greeting + editor, `floor((width - visibleWidth(greeting))/2)`
  padding, original `:31` vs `rpi-tui/src/empty_session.rs:93`), but the port's
  `EmptySessionScreen` implements only `render`/`invalidate` (`:90-115`) — no
  `renderOverlayAbove`, no `getOverlayRow`, no `handleMouse`. The autocomplete position
  has no option in the port, so the list always paints **above** the input, over the
  logo; the original forces it below on this screen
  (`interactive-mode.ts:944-950`).
* **Pi logo** (`components/pi-logo.ts:19`) — the port draws a different mark
  (`rpi-cli/src/brand.rs:93-111`), with no version beside it and **no Apple Terminal
  fallback** (`pi-logo.ts:32-40`).
* **Footer** (`components/footer.ts:410`) — close. Three gaps: the bold
  warning-coloured **`xp` marker** (`footer.ts:451-454`) is missing (the port
  hard-codes `extra_groups: Vec::new()`, `rpi-tui/src/footer.rs:855`); the
  **routed-model suffix** is implemented but never produced (`footer.rs:573-582`,
  `:793-799` — no setter call site); and the **`(sub)` rule is broader** — the
  original uses `provider === "kimi-coding" || modelRuntime.isUsingSubscription(provider)`
  (`core/model-runtime.ts:582-584`), i.e. OAuth **and** the provider declares a
  subscription, while the port shows it for any OAuth token
  (`rpi-cli/src/interactive_tui/state.rs:1443-1452`). The original can also express
  "percent unknown but token count known" (`footer.ts:437-440`) while the port derives
  the percent from the count (`footer.rs:664-679`).
* **`/hotkeys`** — the port builds the table live from the registry
  (`rpi-cli/src/interactive_tui/rendering.rs:358-525`), but has **no Extensions
  section** (original `interactive-mode.ts:6892-6903`), **no `jumpForward`/
  `jumpBackward` rows** (`:6846-6847`), **no `quit` row and no row at all for the
  port's Ctrl+C** (`:6850`), and binds "Scroll by page" to
  `tui.altScreen.pageUp/pageDown` instead of `tui.editor.pageUp/pageDown`.
* **Slash-command set** — the original has 26 built-ins
  (`packages/coding-agent/src/core/slash-commands.ts:21-47`), the port 30
  (`rpi-cli/src/interactive_tui/commands.rs`). Original-only: `/skills`, `/bug`,
  `/stats`, `/new`, `/quit` (the port's canonical name is `/exit`), `/resume` (the
  port's is `/session`). Port-only: `/help`, `/clear`, `/version`, `/provider`,
  `/tools`, `/images`, `/context`, `/usage`.
* **Rust-only, no original counterpart:** the extension-driven **pet transcript view**
  (`rpi-cli/src/interactive_tui/pet.rs`), the **native side-chat "BTW" workspace**
  (`rpi-cli/src/interactive_tui/side_questions.rs`), the native **provider add/edit
  form** (`rpi-cli/src/interactive_tui/settings.rs:1329-1690`, a six-step wizard), the
  `/tools` on/off list (`rpi-cli/src/interactive_tui/selectors.rs:919`) and the
  compiled-in `monochrome` theme preset.

---

## 4. The original's exact screen text and layout

Copy these strings verbatim. They are the contract; a description of them is not.

### 4.1 The window title

| | |
|---|---|
| Original | `interactive-mode.ts:1230-1237` — `path.basename(cwd)` and the session name: `` `${APP_TITLE} - ${sessionName} - ${cwdBasename}` ``, or `` `${APP_TITLE} - ${cwdBasename}` `` when the session has no name. `APP_TITLE` is `piConfigName ? APP_NAME : "π"` (`packages/coding-agent/src/config.ts:588`, with `APP_NAME` at `:587`) — so with pi's own config directory the title is the literal **`π`**. Set once, before the first render (`:1232-1236`); pi has no activity glyph in the title. |
| Port | `rpi-cli/src/window_title.rs:26` `window_title(session_name: Option<&str>, cwd: &Path) -> String` — `APP_TITLE` is the literal `"π"` (`:19`) and the format is pi's, with three tests. **But the function has no call site**: `grep -rn "window_title(" rpi-cli/src` finds only its own definition, and the only `set_title` in `interactive_tui.rs` is the extension hook (`:1373`). The old `rpi-cli/src/brand.rs` (the `"▃ ▅ ▂ rpi · 🦀"` title and the dead startup lockup) is **deleted**. So the title is correct in code and still **not set at startup**. |

The port also used to rewrite the title on every status change — that is where the `⟳`/`↻` glyphs came from — and those writes are gone, which matches pi.

### 4.2 The menu framework — the shared chrome of every picker

`components/menu.ts`. The rendered block, top to bottom:

```
  <title>                     dim          menu.ts:160-162   (omitted when the title is "")
  <search input>                            menu.ts:82-86    (placeholder "Search")
                                            menu.ts:165
  <loading text>               muted        menu.ts:170-173   (only while loading)
  <empty text>                 muted        menu.ts:200-202
  <the list>                                  menu.ts:167-178
  <footer text>                muted        menu.ts:181-184   (optional, transient)
                                            menu.ts:186
  <hint line>                  dim          menu.ts:192-196
```

* Title: `  <title>` — **two** leading spaces.
* Empty text: `"No items available"` when there are no items at all, `"No results found"`
  when a filter removed them all (`menu.ts:200-202`).
* Hint line: `  Type to search · <confirm> select · <cancel> cancel` — `keyHint`
  supplies the resolved keys (`menu.ts:192-196`).
* Footer text: `  <text>` in `muted`, set with `setFooterText` (`menu.ts:250-253`).
* Loading text: `  <text>` in `muted`, set with `setLoading` (`menu.ts:244-247`).

### 4.3 The model list

`components/model-selector.ts`.

* Row **title**: `✓ <model id>` for the current model, `  <model id>` otherwise
  (`:187`).
* Row **description**: `[<provider>]`, plus ` · default` when the row is the saved
  default (`:188`).
* **Title line** above the search box: `Scope: all | scoped` when scoped models exist
  (`:87-95`), otherwise
  `Only showing models from configured providers. Use /login to add providers.`
  (`:94`).
* **Footer line** under the list: `Model Name: <name>` for the highlighted row, or the
  refresh status, or the error (`:96-108`).
* **Hint line**: `  <confirm> to select · <app.models.save> to set as default · <cancel> to cancel`
  (`:110-116`).
* Empty text: `No matching models` (`:118-120`).
* Sort order: the current model first, the default second, then by provider
  (`:229-244`).
* A search of `default` hoists the default model to the top (`:146-158`).

### 4.4 The provider list (login / logout)

`components/oauth-selector.ts`.

* Title: `Select provider to configure:` for login, `Select provider to logout:` for
  logout (`:74-80`).
* Row **title**: the provider name.
* Row **description**: an optional ` [<subscription>]` / ` [<account>]` / ` [<API key>]`
  label — shown **only** when the provider set mixes auth types (`:64-77`) — followed
  by the status suffix (`:30-52`):
  * ` • not configured` — muted
  * ` • <type> configured` — muted, with the label in the warning colour, when the
    stored credential's type differs from the provider's
  * ` ✓ configured` — success
  * ` ✓ env: FOO` — success, when the credential came from an environment variable
* Empty text: `No matching providers` / `No providers available` /
  `No providers logged in. Use /login first.` (`:100-103`).
* The filter matches the name, the id, the auth type and the method name (`:105-118`).

### 4.5 The login dialog

`components/login-dialog.ts`, framed by `DynamicBorder` on both sides.

* Title: `Login to <provider>` — accent + bold, one column of padding (`:45`).
* **URL** (`showAuth`, `:99-112`): a blank row, then the URL as an OSC-8 hyperlink
  (`components/auth-url.ts:22`), then the hint
  `[Cmd+click to open] • [Ctrl+X to copy]` (`auth-url.ts:29-30`; on darwin
  "Cmd+click to open", elsewhere "Ctrl+click to open" — `auth-url.ts:29`). The browser
  is opened for the user (`:110`). After Ctrl+X the hint becomes
  `Copied URL to clipboard` (`auth-url.ts:35-41`).
* **Device code** (`showDeviceCode`, `:117-131`): a blank row; the verification URI as
  a linked URL in `accent`; the click hint `Cmd+click to open` (darwin) or
  `Ctrl+click to open` as a *linked* dim line; a blank row; then
  `Enter code: <userCode>` in the warning colour.
* **Manual entry** (`showManualInput`, `:136-152`): a blank row; the prompt in `dim`;
  the input; then `(<cancel> to cancel)`.
* The API key is typed into a **plain, unmasked** input
  (`packages/tui/src/components/input.ts:23-31` has no mask option).

### 4.6 The skill entry in the autocomplete

* Each discovered skill becomes a slash command named **`skill:<skill.name>`** whose
  description is the skill's own description
  (`packages/coding-agent/src/core/agent-session.ts:3443-3446`).
* The autocomplete row's **label** is that command name; the row's **description** is
  `<argumentHint> — <description>` when the command has an argument hint, else the
  description alone (`packages/tui/src/autocomplete.ts:352-360`).
* The bare-name match **strips the `skill:` prefix**, so typing `foo` matches
  `skill:foo`; the full-name matches are appended **after** the bare ones
  (`autocomplete.ts:365-372`).
* `/skill:<name> <args>` parses as `{ name: (\S+), args: <the rest, trimmed> }`
  (`packages/coding-agent/src/core/skills.ts:358-364`).
* The setting that gates it: `enableSkillCommands` — "Enable /skill:name command
  expansion." (`packages/coding-agent/src/core/settings-schema.ts:307`); the settings
  row reads "Register skills as /skill:name commands"
  (`packages/coding-agent/src/modes/interactive/components/settings-selector.ts:810`).

### 4.7 The layout — the input box is docked at the bottom

`packages/coding-agent/src/modes/interactive/chat-viewport.ts:25-61`
`createChatViewport`:

```
root  = VStack[
    progress            basis auto, grow 0, shrink 0      (pinned to the TOP)
    transcript          basis 0,   grow 1, shrink 1, minSize 1
    dock                basis auto, grow 0, shrink 1, minSize 1
]

dock  = VStack[
    pendingMessages     shrink 1, minSize 0
    status              shrink 1, minSize 0
    widgetsAbove        shrink 1, minSize 0   (optional)
    warning             shrink 1, minSize 0   (optional)
    editor              shrink 1, minSize 3
    widgetsBelow        shrink 1, minSize 0   (optional)
    footer              shrink 1, minSize 0
]
```

The transcript is the flexible middle; the dock is fixed to the bottom, and the
**editor sits inside the dock, above the widgets-below and the footer**. The editor's
`minSize` is 3, so it can shrink as the dock shrinks but never below three rows.

The port's layout (`rpi-cli/src/interactive_tui.rs:1525-1580`):

```
root = VStack[ scrollview(basis 0, grow 1, shrink 1, min 1), dock(shrink 1) ]
dock = VStack[ status(auto), autocomplete(auto), editor_container(shrink 0, min 3), footer(auto) ]
```

So the editor **is** docked at the bottom, but three things differ: the port's editor
has `shrink: 0` (the original's is `shrink: 1`, so the original's input box gets
shorter when the dock is tight and the port's does not); the port's dock has **no
pendingMessages slot**, so the queued-message rows have nowhere to live in the dock
(finding 26b); and the port has no `widgetsAbove` / `warning` / `widgetsBelow` slots
and no progress row at the top of the root.

## 5. The verification pass — what to check once the build is green

I am the lead for the interactive mode; the port owns the code. These are the checks
I will run, screen by screen, against the original's text in §4. Each is a comparison,
not a fix — the port owns the fix.

| # | Screen | The original's source | What to compare | How |
|---|---|---|---|---|
| V1 | The startup header | `interactive-mode.ts:1111-1179` | the mark, ` v<version>`, the compact hint line, the "Press … to show full startup help." line, the onboarding sentence, the tmux warning — and the two blank lines and the warning's wrap width that differ today (finding 11) | the `tool` scenario pane against `scripts/parity/golden/ts-tool.json` |
| V2 | The window title | `interactive-mode.ts:1230-1237` | `π - <session> - <cwd base name>` | **terminal level, not the pane** — run each side in tmux and read the tab title: `tmux display-message -p '#{window_name}'`. The pane does not contain the title, so a pane diff cannot settle this one. |
| V3 | The input box | `packages/tui/src/components/editor.ts:602-770` | the filled card, the `> ` gutter, the placeholder, the scroll hints | the `startup` scenario pane |
| V4 | The layout | `chat-viewport.ts:25-61` | the editor is in the bottom dock, `shrink: 1`, `minSize: 3`; the pendingMessages slot exists; the progress row is at the top | a fullscreen pane with a long draft |
| V5 | The model list | `components/model-selector.ts:184-244` | `✓ <id>` / `  <id>`, `[<provider>]`, ` · default`, the scope line, the `Model Name:` footer, the hint line, `No matching models` | `/model` on both sides |
| V6 | The provider list | `components/oauth-selector.ts:18-118` | the ` [<subscription>]` / ` [<account>]` / ` [<API key>]` label and when it appears, the ` ✓ configured` / ` • not configured` / ` ✓ env: FOO` suffixes, the titles, the empty texts | `/login` and `/logout` on both sides |
| V7 | The login dialog | `components/login-dialog.ts:40-152`, `components/auth-url.ts:13-41` | `Login to <provider>`, the OSC-8 URL, `[Cmd+click to open] • [Ctrl+X to copy]`, `Copied URL to clipboard`, the device-code lines, `(<cancel> to cancel)`, the **unmasked** API key | a provider login on both sides |
| V8 | The settings menu | `components/settings-selector.ts:490-901` | all 37 rows, their order and wording, the search field, the value column, the submenu returning to the parent list | `/settings` on both sides |
| V9 | The session list | `components/session-menu.ts:195-471`, `components/session-selector-search.ts:37-180` | the scope switch, the sort modes, the rename and delete, `re:` and `"phrase"`, the message-content corpus, the threaded tree, the two-line hint | `/resume` (TS) and `/session` (port) over the same session directory |
| V10 | The tree | `components/tree-selector.ts` (1429 lines) | the tree shape, the five filter modes, folding, the labels, the per-entry formatting, the help line | `/tree` on a branched session |
| V11 | The autocomplete | `packages/tui/src/autocomplete.ts:340-395` | the `skill:<name>` entries, the `<hint> — <description>` row format, the bare-name match stripping `skill:` | type `/` then `foo` on both sides |
| V12 | The transcript | `components/assistant-message.ts`, `components/tool-execution.ts` | the OSC 133 zones, the `+ Thought · 3.7s` summary, the stop-reason notice inside the message, the spinner sign in the tool row, the per-tool renderers | the `tool` and `thinking` scenarios |
| V13 | The cards | `components/compaction-summary-message.ts`, `components/branch-summary-message.ts`, `components/custom-message.ts` | the `[compaction]` / `[branch]` / `[<type>]` labels, the card frame, the collapsed/expanded states | a session with a compaction and a branch summary |
| V14 | The footer | `components/footer.ts:410` | the `xp` marker, the routed-model suffix, the `(sub)` rule | the bottom line of any pane |
| V15 | The 3-D empty session | `components/easter-egg-3d.ts:871` | the frames (already checked by `scripts/parity/3dicon.mjs`) and the fullscreen animation | `3dicon.mjs`, plus a manual run |
| V16 | The announcement, the armin, the progress line, the radius row | `components/earendil-announcement.ts`, `components/armin.ts`, `components/progress-bar.ts`, `components/radius-login-selector.ts` | the newly landed components against the original's text | a manual run of each |
| V17 | **The config selector's scope hint** | `components/config-selector.ts:204-222` | the title **and the hints on one line**, padded: `Global Resources` … `<tab> switch mode · <space> toggle · <esc> close`; and the **second** line in `muted`: `~/.pi/agent/settings.json`, or in the project scope `.pi/settings.json · inherited global resources are dimmed`. The port has the title alone, the action hint alone, no "switch mode", no "esc to close" and **no scope hint line** (`config_selector.rs:570-595`) — and since the port and pi now read the *same* settings file, the user has to be told which one is being edited | `/config` on both sides |
| V18 | **Reachability of the five unwired components** | — | not "does the component exist" but "can a user reach it": the progress hairline, the announcement banner, the Armin, the fullscreen easter egg and the auth-URL dialog all have **0 call sites** in `rpi-cli` (§1.1), so no screen can show them. Each must be reachable **and** its screen must match the original's | a manual run of each; the auth-URL dialog is part of the login flow (V7) |

## 6. Decisions needed

1. **The window title needs one call.** The format is now pi's —
   `rpi-cli/src/window_title.rs:26` `window_title(session_name, cwd)` returns
   `π - <session> - <cwd base name>` with `APP_TITLE` the literal `π` — and the old
   `brand.rs` is deleted. But the function **has no call site**, so the title is never
   set; the original sets it once before the first render
   (`interactive-mode.ts:1232-1236`). That one call belongs in
   `rpi-cli/src/interactive_tui.rs` (the interactive mode port's file), with the
   session's name and the working directory. **No decision needed — the format is
   settled; it needs wiring and a capture (V2).**
2. **The JS extension API gap (finding 1).** Is the native-plugin `{"kind": …}`
   envelope meant to *replace* the original's `ctx.ui` promise API, or coexist with
   it? If it replaces it, JS extensions are limited to
   notify/setStatus/setWidget/setHeader/setFooter and the port's own
   `.pi/extensions/*.ts` will keep throwing; if not, the `ui.*` host ops need
   implementing.
3. **Scope of the session/tree pickers (findings 2 and 3).** The port's `/tree` is a
   flat entry list and `/session` a flat file list; the original's are a branch tree
   and a searchable/sortable/renameable session browser. Deliberate simplifications or
   unfinished ports? The Rust comment "the current session's persisted entry tree"
   (`rpi-cli/src/interactive_tui/selectors.rs:405`) suggests unfinished.
4. **The `app.models.*` / `app.session.*` / `app.tree.*` keybinding family (finding
   4)** — restore the ids, or accept that the port's pickers are keyboard-only in a
   different way?
5. **Progress line and `showTerminalProgress` (finding 20)** — the original now draws
   an in-cell hairline progress row (the OSC 9;4 path is dead on both sides). Should the
   port port that row, and should the port stop reusing `show_terminal_progress` for
   the embedded working spinner?
6. **Wiring the library features that exist but are unreachable** — `update_error`
   (`rpi-tui/src/assistant_message.rs:502`), `toggle_thinking_run` (`:476`),
   `StatusIndicator::working/compaction/branch_summary`
   (`rpi-tui/src/status_indicator.rs:58`, `:90`, `:110`), `MouseRegion`
   (`rpi-tui/src/mouse.rs:67`), `set_url_opener` / `set_scroll_to_end_indicator`
   (`rpi-tui/src/tui_alt_screen.rs:612`, `:1282`),
   `ToolExecutionComponent::set_renderer` (`rpi-tui/src/tool_execution.rs:277`),
   `highlight_line` (`rpi-tui/src/alt_screen_search.rs:302`). Are these deliberate
   deferrals, or are they the cheapest high-value fixes?

---

---

## 7. The components that were "missing" and are now ported — what the port claims, and the deviations

> **Provenance.** This section was written by the interactive mode port, not by the
> auditor, and it records the port's own claims. Nothing in it has been checked
> against a running binary — the build was red throughout (the session area's JSONL
> rename), so `rpi-cli` was never type-checked while these landed. Treat it as the
> port's evidence, not as a verification. The audit's own view of the same components
> is in §1.1 (the wiring sweep) and §5 (the verification checklist).

The component inventory at the top of this file listed `armin.ts`, `auth-url.ts`,
`earendil-announcement.ts`, `branch-summary-message.ts`,
`compaction-summary-message.ts` and `progress-bar.ts` as **missing**. They now exist in
the TUI library.

| component | original | port | check |
|---|---|---|---|
| Armin easter egg | `packages/coding-agent/src/modes/interactive/components/armin.ts:9` — XBM bitmap 31×36 (`:13`), `isArminPixel` (`:32`), half-block `getChar` (`:40`), seven effects (`:27`, `:29`), the trailing "ARMIN SAYS HI" line (`:104`) | `rpi/crates/rpi-tui/src/armin.rs` — `ARMIN_WIDTH`/`ARMIN_HEIGHT` (`:19-21`), `is_armin_pixel` (`:44`), `ArminEffect` (`:77`), `ArminComponent` (`:247`) with `new()` (`:264`), `with_effect()` (`:276`), `tick()` (`:293`), `effect()` (`:283`); `render()` is pure, `tick()` advances a frame | `cargo test -p rpi-tui --lib armin::tests` |
| Auth-URL dialog | `components/auth-url.ts:13-41` — OSC-8 URL in accent (`:22`), the platform click hint and the copy hint (`:25`, `:29`) | `rpi/crates/rpi-tui/src/auth_url.rs` — `AuthUrlComponent::new` (`:47`), `set_hint` (`:78`), `url` (`:70`) | `cargo test -p rpi-tui --lib auth_url::tests` |
| Earendil announcement | `components/earendil-announcement.ts:27-52` — accent border (`:31`), bold accent title (`:32`), "Read the blog post:" in muted (`:34`), the URL (`:35`), the image slot (`:39-47`), the closing border (`:51`) | `rpi/crates/rpi-tui/src/announcement.rs` — `AnnouncementComponent` (`:54`), built in `build_container` (`:29`) | `cargo test -p rpi-tui --lib announcement::tests` |
| Branch summary card | `components/branch-summary-message.ts:10-69` — `Box` on `customMessageBg` (`:16`), the bold `[branch]` label (`:47`), collapsed "Branch summary (…)" (`:54`), expanded "**Branch Summary**" + markdown (`:45`), click to toggle (`:64`) | `rpi/crates/rpi-tui/src/summary_cards.rs` — `BranchSummaryCard::new` (`:206`), `set_expanded`/`is_expanded`, `build_box` (`:53`) | `cargo test -p rpi-tui --lib summary_cards::tests` |
| Compaction summary card | `components/compaction-summary-message.ts:10-70` — the twin of the branch card, "Compacted from N tokens (…)" (`:55`), `toLocaleString` (`:40`) | `rpi/crates/rpi-tui/src/summary_cards.rs` — `CompactionSummaryCard::new` (`:226`), `format_thousands` (`:31`) | `cargo test -p rpi-tui --lib summary_cards::tests` |
| Agent progress bar | `components/progress-bar.ts:5-144` — the hairline row of `▔` (`:90`), one cell per 100 ms tick (`:13`, `:19`, `:127-131`), the 15 s default estimate and the median of the last five runs (`:5`, `:7`, `:107-110`), the 95 % cap (`:9`, `:100-103`), the 800 ms done-hold (`:11`, `:116`) | `rpi/crates/rpi-tui/src/agent_progress.rs` — `AgentProgressBar` (`:50`) with `set_enabled` (`:63`), `start` (`:87`), `complete` (`:107`), `tick` (`:165`), `record_duration` (`:129`), `cells` (`:149`), `elapsed_ms` (`:140`) | `cargo test -p rpi-tui --lib agent_progress::tests` |

Deviations, all deliberate:

* The announcement banner has **no image**: the port ships no bundled `clankolas.png`.
  The blank lines around the image slot are kept, so the banner keeps the original's
  shape.
* `mdLink` maps to the port's own `md_link` token (`rpi/crates/rpi-tui/src/theme.rs:59`);
  no colour was invented.
* The expand hint uses the port's `key_text` (`ctrl+o`, lower case), which is what the
  original's `keyText` produces (`components/branch-summary-message.ts:55`), not the
  capitalised `key_display_text`.
* The rain effect ends in the port. In the original a column whose picture has no ink
  above the settled pixels never settles, so `tickEffect()` never returns `true` and the
  animation runs for ever (`components/armin.ts:246-296`). The port marks such a column
  as settled (`rpi/crates/rpi-tui/src/armin.rs:390-396`); the picture that is left on
  screen is the same, but the effect reports its end.
* The progress bar is a library component only: **nothing calls it yet**. The original
  puts it in the top row in fullscreen (`interactive-mode.ts:1081`) and above the input
  in regular mode (`:891`), gated by `terminal.showTerminalProgress`.
