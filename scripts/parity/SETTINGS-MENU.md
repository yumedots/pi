# The interactive mode: the settings menu and the missing components

Port of the original's interactive mode (TypeScript, `/Users/gabriel/pi`, branch
`perf/lightweight-harness`) into the Rust port (`/Users/gabriel/pi-native`,
branch `feat/rpi-native`).

This file is the evidence for the work the interactive-mode porter did. It says
what matches, what does not, and what the lead still owes. The original is
read only; every line below points at it.

---

## 1. The settings menu

### What pi does

`packages/coding-agent/src/modes/interactive/components/settings-selector.ts`

- 23 base rows at `:490-763`, then 14 rows spliced in at `:770-901` — **37 rows**
  in a fixed order.
- The list itself is `packages/tui/src/components/settings-list.ts`: a search
  field over the row **label** (`:54-55`, `:77-79`, `:355-359`), the label and
  the value in two aligned columns (`:139-165`), the description of the
  selected row under the list (`:171-179`), the scroll indicator (`:166-169`)
  and the hint line (`:361-373`).
- A submenu row **replaces** the list while it is open and returns to it when
  it closes (`packages/tui/src/components/settings-list.ts:57-60`, `:309-353`).
- The submenu framework is `components/settings-submenu.ts`: `SelectSubmenu`
  (`:31-126`) — a titled list of options, optionally searchable — and
  `SteppedSubmenu` (`:146-241`) — N steps whose options depend on the earlier
  choices, Esc goes back one step, `loop` restarts after the last step.

### What the port does now

| What | Port | Original |
|---|---|---|
| The row list | `rpi/crates/rpi-cli/src/interactive_tui/settings_menu.rs:663` `settings_menu_rows` — pi's 37 rows in pi's order | `settings-selector.ts:490-901` |
| The row set | `settings_menu.rs:1176` `PI_ROWS` — the test that pins the rows | — |
| The settings list | `rpi/crates/rpi-tui/src/settings_list.rs` — rewritten as a port of `packages/tui/src/components/settings-list.ts`: the search field, the label filter, the aligned columns, the description, the scroll indicator, the hint line, and the submenu ownership | `packages/tui/src/components/settings-list.ts` |
| The submenu framework | `rpi/crates/rpi-cli/src/interactive_tui/settings_menu.rs` — `SettingsSubmenu` (`:126`), `SettingsSubmenuStep` (`:107`), `SettingsSubmenuView` (`:195`): one-step `Options`, a `Steps` chain with a shared context, and a nested `Rows` list | `components/settings-submenu.ts:31` and `:146` |
| The rows' effect | `rpi/crates/rpi-cli/src/interactive_tui/settings.rs:194` `apply_setting_change` — one arm per row, writing the field pi writes | `settings-selector.ts:908-1010` |

### The rows, in pi's order

`autocompact`, `show-images`, `image-width-cells`, `auto-resize-images`,
`block-images`, `skill-commands`, `show-hardware-cursor`, `editor-padding`,
`output-padding`, `nerd-fonts`, `autocomplete-max-visible`,
`autocomplete-position`, `clear-on-shrink`, `terminal-progress`,
**`three-d-empty-session`**, `steering-mode`, `follow-up-mode`, `transport`,
`share-destination`, `http-idle-timeout`, `cache-warming-mode`,
`hide-thinking`, `mermaid-rendering`, `cache-miss-notices`,
`collapse-changelog`, `quiet-startup`, `default-project-trust`,
`double-escape-action`, `tree-filter-mode`, `warnings` (submenu),
`model-thinking` (stepped submenu), `tui-mode`, `fullscreen-exit-output`,
`fullscreen-scrollbar`, `fullscreen-copy-on-select`,
`fullscreen-wheel-scroll-lines`, `theme` (submenu).

The row the user noticed — `three-d-empty-session`, "3D empty session", "Show
the spinning 3D pi logo with a centered input box while a session is empty" — is
in the list at `settings_menu.rs:1176` and in the test at
`settings_menu.rs:1188`.

### What changed in the settings file to make the rows honest

- `quietStartup` is now the tri-state string pi uses (`"true"`, `"header"`,
  `"false"`), so the row offers pi's three values.
  `rpi/crates/rpi-cli/src/settings.rs:319` (the field), `:506` (the
  deserializer), `:45` (the default).
- `tuiMode` is now read at startup and not only written.
  `rpi/crates/rpi-cli/src/interactive_tui.rs:949` (the resolution), and the
  port's default is fullscreen on every platform
  (`rpi/crates/rpi-cli/src/args.rs:90`).

### Checks

- `rpi/crates/rpi-cli/src/interactive_tui/settings_menu.rs:1160` —
  `the_menu_has_pis_rows_in_pis_order` pins the 37 keys **and** the 37 labels
  against pi's list, in order.
- `settings_menu.rs:1194` — `the_three_d_empty_session_row_is_there`.
- `settings_menu.rs:1207` — `the_quiet_startup_row_offers_pis_three_values`.
- `settings_menu.rs:1222` — `the_submenu_rows_open_a_submenu`.
- `settings_menu.rs:1244` — `the_value_rows_cycle_pis_values`.
- `settings_menu.rs:1272` — `the_http_idle_timeout_uses_pis_labels`.
- `settings_menu.rs:1283` — `the_project_trust_labels_map_back_to_values`.
- `rpi/crates/rpi-tui/src/settings_list.rs` — the library tests: the label
  filter (not the key), the submenu owning the list, the search field, the
  rendered label/value/hint.

### What does not match yet

- The **theme submenu** is pi's shape (a titled option list) but pi's list is
  `system` plus the built-in and the user/package themes
  (`settings-selector.ts:286-462`, `theme/theme.ts:436-476`). The port can
  apply three presets (`dark`, `light`, `monochrome`) and has no `system` theme
  and no theme-file loading, so the list is the three presets. The automatic
  (light/dark pair) mode and the live preview on hover are not ported.
- The **model-thinking stepped submenu** is ported (model → level, the
  "clear override" entry, the summary "N configured"), but the port has no
  `app.thinking.cycle` binding wired to it, and the port's thinking-level
  descriptions are the original's only for the levels it can offer
  (`rpi/crates/rpi-cli/src/interactive_tui/selectors.rs:781`).
- The **warnings submenu** has pi's one row ("Anthropic extra usage"); pi's
  `WarningSettings` has more kinds upstream.
- The port's settings rows that pi does not have — `Default model`, `Default
  thinking`, `Cycle scope` — were **removed** from the menu, because a user
  comparing the two menus must not see rows pi does not show. The port keeps
  the same capabilities as slash commands (`/model`, `/thinking`,
  `/scoped-models`).
- The **parity capture** of the settings menu has not been run yet (the build
  was red while the rows landed).

---

## 2. The components the port did not have

All nine were written by sub-agents of the interactive-mode porter and are
present in the tree with unit tests. What is **not** done is the wiring and
the comparison against the original.

| Original | Port | State |
|---|---|---|
| `components/progress-bar.ts:31` | `rpi/crates/rpi-tui/src/agent_progress.rs:50` | present, **not wired** — the original draws the hairline at the top of the layout root (`chat-viewport.ts:48-52`) |
| `components/armin.ts:9` | `rpi/crates/rpi-tui/src/armin.rs:247` | present, **not wired** — no `/arminsayshi` command |
| `components/auth-url.ts:13` | `rpi/crates/rpi-tui/src/auth_url.rs:39` | present, **not wired** — the login flow still prints `Open: {url}` |
| `components/earendil-announcement.ts:27` | `rpi/crates/rpi-tui/src/announcement.rs:53` | present, **not wired** — and the port ships no `clankolas.png` |
| `components/branch-summary-message.ts:10` | `rpi/crates/rpi-tui/src/summary_cards.rs` | present, **not wired** — the port still prints a note (`interactive_tui/sessions.rs:409`) |
| `components/compaction-summary-message.ts:10` | `rpi/crates/rpi-tui/src/summary_cards.rs` | present, **not wired** — the port still prints a note (`interactive_tui/sessions.rs:399`) |
| `components/config-selector.ts:23` | `rpi/crates/rpi-cli/src/interactive_tui/config_selector.rs:854` | present and wired into the module, **no `/config` command** |
| `components/session-selector-search.ts:37` | `rpi/crates/rpi-cli/src/interactive_tui/session_search.rs:174` | present, **not wired** into the session picker |
| `components/radius-login-selector.ts:105` | `rpi/crates/rpi-cli/src/interactive_tui/radius_login.rs:80` | present, **not wired** into the login menu |
| `components/easter-egg-3d.ts:846` | `rpi/crates/rpi-tui/src/easter_egg_3d.rs:226` | present, **not wired** — no trigger |

Deviations the sub-agents recorded:

- The **rain effect** terminates in the port; the original's never reports
  completion (a column with no ink above the settled pixels never settles).
  The picture left on screen is the same.
- The **announcement** has no embedded PNG (the port ships no asset); the blank
  lines around the image slot are kept.
- The **auth-url** hint paints the copy key in `muted`; the original's
  `keyHint` paints it in `dim`.
- The **easter egg** is a faithful simplification of the ray cast and the dust
  wave, not a line-for-line port of the 1404-line original.

---

## 3. Other changes in this area

- **Fullscreen is the default on every platform.**
  `rpi/crates/rpi-cli/src/args.rs:90` — the macOS special case is gone, the
  old test is replaced by `tui_mode_defaults_to_fullscreen_on_every_platform`
  (`args.rs:1164`). The `tuiMode` setting is now read
  (`interactive_tui.rs:949`), and an explicit `--tui-mode` still wins via the
  new `Args::tui_mode_set`.
- **`--skip-3d`** — a port addition the user asked for: never show the 3D
  empty-session screen, whatever `threeDEmptySession` says.
  `rpi/crates/rpi-cli/src/args.rs:126` (the field), `:506` (the flag),
  `interactive_tui.rs:1061` (the effect). The original has no such flag.
- The **tmux extended-keys warning** was already in the port
  (`interactive_tui/rendering.rs:62`) with the original's two variants; it was
  invisible in the captures only because the port ran in regular mode, so the
  transcript was shorter than the pane. The fullscreen default fixes that.
  The captures confirm it: `scripts/parity/out/ts-prompt.json` and
  `rust-prompt.json` carry the identical warning text.

---

## 4. What the lead still owes

- The **verification pass** of the nine new components against the original's
  rendering (checklist V1–V16 in `scripts/parity/INTERACTIVE-MODE.md` §5). The
  porter wrote the components; nobody has compared them to the original's
  output yet.
- The **parity capture** of the settings menu (`scripts/parity/drive.mjs rust
  panels`) against the golden trace, once the build is green.
- The **wiring** of the nine components into the screens that show them (the
  progress hairline, the 3D screen's Armin, the auth URL in the login flow,
  the announcement, the two summary cards, the `/config` command, the session
  search, the radius row, the easter-egg trigger).
- The **auth screens** (the provider list, the model list, the login dialog)
  are the original's text, not the port's re-imagined one: the original's
  exact strings are in `INTERACTIVE-MODE.md` §4.3–4.5. That work is not done.

---

## 5. What was wired after the first pass

| What | Port | Original | V-row |
|---|---|---|---|
| The **progress hairline** at the top of the screen | `rpi/crates/rpi-cli/src/interactive_tui/progress.rs` (the bar) + `interactive_tui.rs:1560` (the row at the top of the root) + `interactive_tui.rs:1570` (the 100 ms ticker) + `interactive_tui/state.rs:1030` (`start()` on Working, `complete()` on Idle) | `components/progress-bar.ts:31`, placed at the top of the root in `chat-viewport.ts:48-52` | V16 |
| The **window title** | `rpi/crates/rpi-cli/src/interactive_tui.rs:1112` — `window_title(session_name, cwd)` → `π - <session> - <cwd base name>`, set once before the first render | `interactive-mode.ts:1232-1236` | V2 |
| The **auth-URL dialog** in the OAuth flow | `rpi/crates/rpi-cli/src/interactive_tui/settings.rs:999` — the URL is now an `AuthUrlComponent` (OSC-8 hyperlink, the click hint, the copy hint) instead of the plain `Open: {url}` line | `components/auth-url.ts:13` | V13 |
| The **model row** | `rpi/crates/rpi-cli/src/interactive_tui/settings.rs:435` `model_selector_items` — the row title is `✓ <id>` for the current model and `  <id>` otherwise; the description is `[<provider>]` plus ` · default` | `components/model-selector.ts:187-188` | V5 |
| The **config selector's header** | `rpi/crates/rpi-cli/src/interactive_tui/config_selector.rs:558-620` — one line: the bold title, the padded hints (`<tab> switch mode · <space> toggle · <esc> close`), then the muted scope hint (`~/.pi/agent/settings.json`, or `.pi/settings.json · inherited global resources are dimmed`) | `components/config-selector.ts:204-222` | V12 |
| The **editor's shrink** in the dock | `rpi/crates/rpi-cli/src/interactive_tui.rs:1546` — the editor is `shrink(1)`, so the input box shortens when the dock is tight | `chat-viewport.ts:25-61` (the editor is `shrink 1, min 3`) | V4 |

### Still unwired

- The **announcement banner** (`rpi-tui/src/announcement.rs`) — no call site.
- The **Armin** (`rpi-tui/src/armin.rs`) — no call site and no `/arminsayshi` command.
- The **fullscreen easter egg** (`rpi-tui/src/easter_egg_3d.rs`) — the component is there; the trigger (the clickable header logo) is not.
- The **branch and compaction summary cards** (`rpi-tui/src/summary_cards.rs`) — the port still prints a plain note (`interactive_tui/sessions.rs:399` and `:409`).
- The **session search** (`rpi-cli/src/interactive_tui/session_search.rs`) — not in the session picker.
- The **radius login row** (`rpi-cli/src/interactive_tui/radius_login.rs`) — not in the login menu.
- The **config selector** — no `/config` command.
- The **provider list** and the **login dialog** — still the port's own screens, not the original's text (the original's is in `INTERACTIVE-MODE.md` §4.4-4.5).

### Verification state of this pass

`cargo build -p rpi-tui` → 0 errors; `cargo test -p rpi-tui --lib settings_list` → 14/14.
`cargo build -p rpi-cli` could **not** be run to completion: `rpi/crates/rpi-harness/src/session/jsonl/*` and `rpi/crates/rpi-harness/src/agent_harness.rs` are mid-refactor (11 errors, the session port's files), and `rpi-cli` is not type-checked while a dependency fails. The changes in this pass — the progress bar, the title, the auth URL, the model row, the config header, the editor's shrink — are therefore **unverified by the compiler** and must be re-checked when the tree is green.

---

## 6. The branch and compaction cards

The port printed a plain note for both; pi shows a card.

| What | Port | Original |
|---|---|---|
| The compaction card | `rpi/crates/rpi-cli/src/interactive_tui/sessions.rs:399` — `CompactionSummaryCard::new(&summary, tokens_before)` on the `customMessageBg` box, with the `[compaction]` label and the collapsed `Compacted from N tokens (<expand key> to expand)` line | `components/compaction-summary-message.ts:10` |
| The branch card | `rpi/crates/rpi-cli/src/interactive_tui/sessions.rs:409` — `BranchSummaryCard::new(&summary)`, the `[branch]` label and `Branch summary (<expand key> to expand)` | `components/branch-summary-message.ts:10` |

The cards themselves are `rpi/crates/rpi-tui/src/summary_cards.rs` (the `Box`, the label colour, the collapsed/expanded state, the click target). The live run reaches the same path: the compaction and the branch summary are persisted entries, so the replay and the live transcript render the same card.

## 7. Two things this pass deliberately did not touch

- **The session picker** — `interactive_tui/selectors.rs:312` was rewritten by the session port (the `state.session_menu` state with the scope, the sort modes, the rename and the delete). The session-search query language (`re:` / `"phrase"`) is in `interactive_tui/session_search.rs` and is **not** in that picker; wiring it there is the session port's file, not mine.
- **The login menu's Radius row** — the shimmering row and the original's provider list are the **same screen**. The port's list is a `SelectList` whose rows carry the auth-type description; the `RadiusLoginMenu` renders bare labels. Swapping in the shimmer alone would drop the descriptions, so the screen is one piece of work: the provider list in the original's text (§4.4) with the Radius row shimmering in it. The component is ready (`interactive_tui/radius_login.rs`).
