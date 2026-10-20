# Behaviour parity audit — TypeScript `pi` vs Rust `rpi`

Audit of the remaining **user-visible behavioural** differences between the
TypeScript original and the Rust port.

- Original: `/Users/gabriel/pi` (branch `perf/lightweight-harness`) — TUI in
  `packages/tui/src/`, interactive mode in
  `packages/coding-agent/src/modes/interactive/`.
- Port: `/Users/gabriel/pi-native` (branch `feat/rpi-native`) — TUI in
  `rpi/crates/rpi-tui/src/`, interactive mode in
  `rpi/crates/rpi-cli/src/interactive_tui/`.

## Method

Both programs were driven in tmux (fixed 100×30 pane, frozen clock, mock model
server) with the parity harness's arrangement (`scripts/parity/mock-server.mjs`,
`PI_CODING_AGENT_DIR` / `RPI_CODING_AGENT_DIR`, `PI_PARITY_CLOCK`), and the
same key sequences were sent to both sides and the panes compared.

Everything below is either (a) reproduced live — the keys and the two panes are
quoted — or (b) read in both sources and stated as a code-level difference.

**Baseline / caveat.** The Rust tree was being rebuilt by other agents during
this audit (binary rebuilt at 17:18 and again at 18:04; `keybindings.rs`,
`status_indicator.rs`, `settings.rs`, `rendering.rs`, `selector_keys.rs`,
`first_run.rs` edited between 17:33 and 18:10). Each row therefore carries a
**Status**:

- `live` — reproduced against the 18:04 binary **and** still present in the
  source at ~18:10.
- `fixed` — reproduced earlier in the audit, fixed in the working tree since
  (re-check the current source before acting on it).
- `code` — code-level difference (not exercised live, or exercised only
  through a key the harness cannot deliver).

`scripts/parity/FEATURES.md` (the prior 147-row inventory) already lists a
number of these. Where a row here is **new**, it says so; where a FEATURES.md
row is now wrong, see [Corrections to FEATURES.md](#corrections-to-featuresmd).

**Read this before acting on the file.** The audit ended during a build freeze:
the workspace does not compile, so `rpi/target/debug/rpi` is **stale** and the
captures below were taken against the 17:18 and 18:04 builds. Re-run the
capture for your area before you change anything, and treat the `Status`
column as "live at the time of the audit", not as a promise about the current
tree. I am the auditor: I changed no source, no test, no scenario and no
golden trace, and nothing below is verified work.

---

## 1. The editor can panic and take the whole TUI down — **behaviour, fatal**

**User sees.** Type `abc`, press `Shift+←`, then `Ctrl+U` (or `Ctrl+K`), then
any key. The port prints

```
thread 'tokio-rt-worker' panicked at …/core/src/slice/index.rs:1009:51:
range end index 3 out of range for slice of length 1
```

and the TUI is dead — the input no longer responds. The original keeps working
(`> x`).

- Original: no selection model at all — `packages/tui/src/components/editor.ts:243`
  (`EditorState` = lines/cursorLine/cursorCol); `Ctrl+K`/`Ctrl+U` are
  `packages/tui/src/components/editor.ts:1871` / `:1836`.
- Port: `rpi/crates/rpi-tui/src/editor.rs:788-809` (`delete_selection_no_undo`
  → `replace_range(sc..ec)` with a stale anchor) reached from the kill
  handlers `rpi/crates/rpi-tui/src/editor.rs:1302` (`Ctrl+K`) and `:1317`
  (`Ctrl+U`), which mutate the line but never clear `selection_anchor`
  (`editor.rs:58`, `clear_selection` at `editor.rs:772`).

**Keys:** `abc`, `S-Left`, `C-u`, `x`. **Status: live** (reproduced on the
18:04 binary and still present in the source).

---

## 2. `Enter` with the completion list open sends the raw text to the model — **behaviour**

**User sees.** Type `/mod`, press `Enter`.

- Original: the completion is accepted, `/model` runs, and the **model picker**
  opens (`→ ✓ mock-1  [mock]`, `Enter to select · Ctrl+S to set as default · Escape/Ctrl+C to cancel`).
- Port: the literal text `/mod` is **sent to the model** — the transcript shows
  `/mod` as a user message and the mock's reply (`Hello from the parity mock.`),
  and the token counter moves.

- Original: `packages/tui/src/components/editor.ts:1004` (`tui.select.confirm`
  → `applyCompletion`, then falls through to submit for a `/` prefix).
- Port: `rpi/crates/rpi-cli/src/interactive_tui.rs:2950` routes **only `Tab`**
  to `accept_top_suggestion`; `Enter` falls through to
  `rpi/crates/rpi-tui/src/editor.rs:1279` (`submit`) → `rpi/crates/rpi-cli/src/interactive_tui.rs`
  (unknown slash command → the prompt path, so it is sent as a chat message).

**Keys:** `/mod`, `Enter`. **Status: live.**

---

## 3. `/import` can never open the file it just imported — **behaviour**

**User sees.** `/import <any session file>` always ends in

```
✗ Could not open session 2026-10-20T21-29-48-806Z_01a15b38-7406-…:
  no session matches session 2026-10-20T21-29-48-806Z_01a15b38-7406-…
```

The imported file is copied into the sessions **root** while every read path
scans only the cwd-encoded **subdirectory**, so the orphan also shows up as a
row in the session picker and fails again when selected. The original also asks
for confirmation (`Import session / Replace current session with <path>? → Yes / No`);
the port does not.

- Original: `packages/coding-agent/src/modes/interactive/interactive-mode.ts:6559`
  (`handleImportCommand`), `packages/coding-agent/src/core/agent-session-runtime.ts:359`.
- Port: `rpi/crates/rpi-cli/src/interactive_tui/sessions.rs:157` (`import_session`
  → `crate::session::default_session_dir(cwd)` = `<cwd>/.rpi/sessions`,
  `rpi/crates/rpi-cli/src/session.rs:190`) vs the reader
  `rpi/crates/rpi-harness/src/session/jsonl/repo.rs:482`
  (`jsonl_session_directories` → only `<root>/--<encoded-cwd>--`).

**Status: live** (re-check once the session format lands in pi's own
directory — see §7).

---

## 4. `Ctrl+P` (cycle model) reports a switch that did not happen — **behaviour + wording**

**User sees.** One model is configured; `Ctrl+P`.

- Original: `Only one model available` — it refuses to move
  (`this.session.scopedModels.length > 0 ? "Only one model in scope" : "Only one model available"`).
- Port: `ℹ Model set to mock/mock-1 — applies to the next message.` — it
  "switches" to the model that was already active.

- Original: `packages/coding-agent/src/modes/interactive/interactive-mode.ts:4387-4399`.
- Port: `rpi/crates/rpi-cli/src/interactive_tui/selectors.rs:194-209`
  (`cycle_model`) and `:212-232` (`apply_model_selection`, the note text at
  `:224`).

**Status: live.**

---

## 5. `Ctrl+O`, `Ctrl+T` and `Shift+Tab` give no feedback — **behaviour (missing status)**

**User sees.**

| key | original | port |
|---|---|---|
| `Ctrl+O` | `Tool output: expanded` | *(nothing)* |
| `Ctrl+T` | `Thinking blocks: visible` | *(nothing)* |
| `Shift+Tab` | `Thinking level: high` / `Current model does not support thinking` | *(nothing)* |

- Original: `packages/coding-agent/src/modes/interactive/interactive-mode.ts:4423`,
  `:4440`, `:4383`.
- Port: the handlers in `rpi/crates/rpi-cli/src/interactive_tui.rs` (the `Ctrl+O`
  block, the `Ctrl+T` block, the `Shift+Tab` block) only flip state and re-render;
  no transcript note is added. (`ℹ Thinking blocks shown.` exists, but only
  for the `/settings` path: `rpi/crates/rpi-cli/src/interactive_tui/settings.rs:297`.)

**Status: live.**

---

## 6. "Jump to previous/next prompt" is not implemented — **behaviour**

The original binds `Ctrl+↑`/`Ctrl+↓` (and `Ctrl+Shift+↑`/`↓`) to jump the
transcript to the previous/next prompt (OSC 133 prompt markers). In the port
the two binding ids exist in the registry but **nothing reads them** — no
call site anywhere in the workspace.

- Original: `packages/tui/src/keybindings.ts:181-190` (`tui.altScreen.previousPrompt`
  = `ctrl+shift+up` **and** `ctrl+up`), `packages/tui/src/tui-alt-screen.ts:805-812`
  → `scrollToPrompt` (`:527`).
- Port: `rpi/crates/rpi-tui/src/keybindings.rs:821` / `:837` — definitions only
  (`grep -rn "PREVIOUS_PROMPT\|NEXT_PROMPT"` finds no consumer).

**Status: live** (code-level; the harness's tmux has `extended-keys off`, so
`Ctrl+Shift+↑` is not deliverable, and the plain `Ctrl+↑` alias is gone too).

---

## 7. The session file is a different format in a different place — **behaviour**

| | original | port |
|---|---|---|
| location | `<agent-dir>/sessions/--<encoded-cwd>--/<ts>_<uuid>.jsonl` | `<project>/.rpi/sessions/--<encoded-cwd>--/<ts>_<uuid>.jsonl` |
| header | `{"type":"session","version":3,…}` | `{"kind":"header","version":4,…}` |
| entries | `model_change`, `thinking_level_change`, `message`, `session_info` | `record`/`entry`/`fact` lines, incl. persisted streaming frames |

The port drops a `.rpi/sessions/` tree inside the user's **project** directory
and its files cannot be read by the original.

- Original: `packages/coding-agent/src/core/session-manager.ts:41`
  (`CURRENT_SESSION_VERSION = 3`), `:43` (`SessionHeader`), `:589`
  (`getDefaultSessionDirPath`).
- Port: `rpi/crates/rpi-cli/src/session.rs:190` (`default_session_dir`),
  `rpi/crates/rpi-harness/src/session/jsonl/types.rs:48` (`JsonlV4Header`),
  `rpi/crates/rpi-harness/src/session/jsonl/repo.rs:482`.

**Status: live** — and it is the file format Main called out ("the session
files are now shared too, which is why the session file format has to be pi's
exactly"). Re-check after the session port lands.

---

## 8. `/new` is an alias of `/clear` — **behaviour**

**User sees.** After one turn, `/new` then a second prompt: the original's
session picker lists **two** sessions and the footer resets to `0 tokens`; the
port lists **one** and the footer still shows the old session's
`0.0% 49 tokens` (the harness session is never reset).

- Original: `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3068`
  → `:6914` `handleClearCommand` → `runtimeHost.newSession()`.
- Port: `rpi/crates/rpi-cli/src/interactive_tui/commands.rs:25` — `/clear`
  with `/new` as an alias → `TuiMessage::ClearChat` (`chat_container.clear()`).

**Status: live.**

---

## 9. `/export` cannot write to a path — **behaviour**

**User sees.**

| | original | port |
|---|---|---|
| `/export` | `Session exported to: pi-session-<stem>.html` | `ℹ Exported session to /…/<uuid>.md` (Markdown) |
| `/export custom.html` | writes `./custom.html` | `✗ Unknown export format: custom.html. Supported: md, html, jsonl` |

The original's argument is a **path** (extension decides the format, default
HTML); the port's argument is a **format token** (`md`/`html`/`jsonl`) and the
output name is an opaque leaf UUID.

- Original: `packages/coding-agent/src/modes/interactive/interactive-mode.ts:6510`,
  `packages/coding-agent/src/core/export-html/index.ts:236`.
- Port: `rpi/crates/rpi-cli/src/interactive_tui/commands.rs:376-408`.

**Status: live.**

---

## 10. `/fork` has no picker, and `/clone` is the same command — **behaviour**

**User sees.** The original opens a *Fork from Message* picker
(`Select a user message to copy the active path up to that point into a new
session`), forks the path **before** that message and pre-fills the editor with
the message text (`Forked to new session`). The port forks immediately at the
current leaf, copies the whole transcript, does not pre-fill the editor
(`ℹ Forked into a new session.`), and `/clone` runs the identical handler, so
the two commands are indistinguishable.

- Original: `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3037`,
  `:5404` (`showUserMessageSelector`), `packages/coding-agent/src/core/session-manager.ts:1632`.
- Port: `rpi/crates/rpi-cli/src/interactive_tui/commands.rs:410` and `:426`
  → `rpi/crates/rpi-cli/src/interactive_tui/sessions.rs:198` (`fork_session`).

**Status: live.**

---

## 11. `/tree` shows ids instead of content, and has no branch-summary step — **behaviour**

**User sees.**

```
original                              port
Session Tree                          Session tree
 ↑/↓ move · ←/→ page · option+←/→      Type to filter by entry type, sequence, or id
 filters ctrl+d/t/u/l/a · cycle …
  • [system]                          → message #2        01a15b41-998
  • user: Hi                          → message #8 (current) 01a15b41-99b
› • assistant: First reply.
```

After picking an entry the original asks `Summarize branch? / → No summary /
Summarize / Summarize with custom prompt`; the port prints
`ℹ Moved to the selected session entry.`

- Original: `packages/coding-agent/src/modes/interactive/components/tree-selector.ts:690`,
  `:1329`; `packages/coding-agent/src/modes/interactive/interactive-mode.ts:5463`.
- Port: `rpi/crates/rpi-cli/src/interactive_tui/selectors.rs:408`
  (`open_tree_selector`, label `"{type} #{seq}"` + a 12-char uuid).

**Status: live.**

---

## 12. The session picker is much weaker — **behaviour + appearance**

- Original rows: `<message count> <relative age>`; a `Sessions` title, a
  `Search` row, and a **hint line**
  (`tab scope: current · re:<pattern> regex · "phrase" exact` /
  `ctrl+s sort · ctrl+n named · ctrl+d delete · ctrl+p path (off) · ctrl+r rename`).
- Port rows: `<bytes> · <short id>` (`Hi … 6KB · 01a15b38`), **no hint line at
  all**, no scope switch, no sort modes, no rename, no delete, no regex/phrase
  query, no fork tree.

- Original: `packages/coding-agent/src/modes/interactive/components/session-menu.ts:195`,
  `:218`, `:255`, `:404`; `packages/coding-agent/src/modes/interactive/components/session-selector-search.ts:39`.
- Port: `rpi/crates/rpi-cli/src/interactive_tui/selectors.rs:301`,
  `rpi/crates/rpi-cli/src/session.rs:2456`.

**Status: live.**

---

## 13. `!command` prints a raw JSON debug line into the transcript — **behaviour**

**User sees.** After `!echo hello-bash` the port shows the panel *and* a raw
dump:

```
$ echo hello-bash

hello-bash

ℹ bashExecution: {"command":"echo hello-bash","output":"hello-bash\n","exitCode":0,"cancelled":false,"truncated":false,"excludeFromContext":false}
```

The original shows only the panel.

- Original: `packages/coding-agent/src/modes/interactive/components/bash-execution.ts:21`
  (the `bashExecution` custom message is routed to a themed panel).
- Port: `rpi/crates/rpi-cli/src/interactive_tui/sessions.rs:611-625`
  (`custom_message_fallback` → `"{role}: {data}"`), reached from
  `rpi/crates/rpi-cli/src/interactive_tui/events.rs:290` (the `AgentMessage::Custom` arm).

**Status: live.**

---

## 14. The default TUI mode differs on macOS — **behaviour (hides half the UI)**

The original defaults to the alternate screen; the port defaults to terminal
scrollback on macOS. Every fullscreen-only affordance — the scrollbar, wheel
scrolling, the jump-to-end indicator, the flash banner, the alt-screen search —
is therefore unreachable **by default** in the port.

- Original: `packages/coding-agent/src/core/settings-defaults.ts:64` (`tuiMode: "fullscreen"`).
- Port: `rpi/crates/rpi-cli/src/args.rs:90-101` (`default_tui_mode_for(is_macos)`
  → `Regular` on macOS).

**Status: live.**

---

## 15. The settings menu cannot be searched, and `Esc` in a submenu closes the whole menu — **behaviour**

**User sees.** `/settings`, then type `theme`: the original filters the list
(`> theme`, narrowed to `Theme` + `Default thinking level per model`); the port
swallows the characters and shows all 15 rows with no search field and no hint
line. `/settings` → `Theme` → `Esc`: the original returns to the settings list
(with the selection restored); the port closes the **entire** menu and returns
to the empty prompt.

- Original: `packages/tui/src/components/settings-list.ts:113`, `:361-367`,
  `:267-284`, `:338-352`;
  `packages/coding-agent/src/modes/interactive/components/settings-selector.ts:1032`.
- Port: `rpi/crates/rpi-cli/src/interactive_tui/settings.rs:100-140`,
  `rpi/crates/rpi-tui/src/settings_list.rs:421`,
  `rpi/crates/rpi-cli/src/interactive_tui/selectors.rs:35-60`.

**Status: live.**

---

## 16. The settings menu exposes 15 of the original's ~35 rows — **behaviour**

Missing rows: Steering mode, Follow-up mode, Transport, Session share
destination, Cache warming, Mermaid diagrams, Default project trust, Tree
filter mode, Warnings, Default thinking level per model, TUI mode, Fullscreen
exit output, Fullscreen scrollbar, Fullscreen wheel scrolling, Auto-compact,
Image width, Auto-resize images, Block images, Skill commands, Show hardware
cursor, Output padding, Nerd Font glyphs, Autocomplete position, Clear on
shrink, 3D empty session.

- Original: `packages/coding-agent/src/modes/interactive/components/settings-selector.ts:474-1042`.
- Port: `rpi/crates/rpi-cli/src/interactive_tui/settings.rs:41-140`, `:146-265`.

**Status: live.**

---

## 17. The pickers lost their hint line, footer and current/default markers — **behaviour + appearance**

The original's menus render *title → search → list → footer → hint line*
(`Type to search · enter select · escape/ctrl+c cancel`); the port's
`SearchableSelectList` renders *title → description → search → list* and
nothing else. Concretely:

- **Model picker**: original `Only showing models from configured providers. Use /login to add providers.` /
  `→ ✓ mock-1  [mock]` / `Model catalogs refreshed.` / `Enter to select · Ctrl+S to set as default · Escape/Ctrl+C to cancel`;
  port `Select model` / `→ Mock Model  mock/mock-1 (current)` — no footer, no hint,
  no `✓`, no `· default`.
- **Thinking picker**: no title, no search, no hint, no `✓`, no `· default`.
- **Scoped-models picker**: no title, no search, no `✓`, no provider, no model
  name, no refresh status, no hint; `Ctrl+A`/`Ctrl+X`/`Ctrl+P`/`Option+↑`/`Option+↓`/`Ctrl+S`
  are not implemented there, and the port **saves on `Esc`** where the original
  keeps the change session-only until `Ctrl+S`.
- **Theme picker**: no `system` theme, no `(current)` marker.

- Original: `packages/coding-agent/src/modes/interactive/components/menu.ts:170-197`;
  `components/model-selector.ts:118-146`, `:185-192`;
  `components/thinking-selector.ts:24-84`;
  `components/scoped-models-selector.ts:97-401`;
  `components/theme-selector.ts:16-63`.
- Port: `rpi/crates/rpi-tui/src/searchable_select.rs:121-142`;
  `rpi/crates/rpi-cli/src/interactive_tui/selectors.rs:121-205`, `:836-923`,
  `:487-520`; `rpi/crates/rpi-cli/src/interactive_tui/settings.rs:1827-1912`.

**Status: live** (the `Ctrl+S` "set as default" wiring was added during the
audit in `rpi/crates/rpi-cli/src/interactive_tui/selector_keys.rs:635`/`:738` —
re-check it in the current build).

---

## 18. `/trust` writes the decision without asking, and has no parent-folder scope — **behaviour**

**User sees.** Original: a *Project trust* picker with
`→ Trust / Trust parent folder (/private/tmp/x) / Do not trust` and the saved
decision. Port: `/trust` immediately writes the decision and prints
`ℹ Current project marked trusted.` — no picker and no "Trust parent folder".

- Original: `packages/coding-agent/src/modes/interactive/components/trust-selector.ts:37-134`;
  `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3052`.
- Port: `rpi/crates/rpi-cli/src/interactive_tui/commands.rs:596-627`.

**Status: live.**

---

## 19. `/login` skips the authentication-method step — **behaviour**

**User sees.** Original `/login` first asks *how* to sign in
(`→ Sign in with an account / Sign in with an API key / Sign in with Radius • not configured`)
and then lists providers with their auth type and status. The port goes
straight to the provider list and drops the `[subscription]`/`[API key]`
labels and the `✓ configured` / `• not configured` glyphs.

- Original: `packages/coding-agent/src/modes/interactive/interactive-mode.ts:5878-5953`;
  `packages/coding-agent/src/modes/interactive/components/oauth-selector.ts:19-45`.
- Port: `rpi/crates/rpi-cli/src/interactive_tui/selectors.rs:626-681`,
  `rpi/crates/rpi-cli/src/interactive_tui/settings.rs:668-757`.

**Status: live.**

---

## 20. Unknown slash commands are sent to the model — **behaviour**

The original's command set contains `/skills`, `/bug`, `/stats`, `/llama`,
`/mcp` and the `/history` + `/sessions` aliases. In the port those words are
not commands, so they are **sent to the model as a chat message** instead of
erroring:

```
/stats          → the transcript shows "/stats" as a user message and the model's reply
```

- Original: `packages/coding-agent/src/core/slash-commands.ts:21`,
  `packages/coding-agent/src/modes/interactive/interactive-mode.ts:722-733`;
  `/llama` from `packages/coding-agent/src/extensions/llama/index.ts:186`,
  `/mcp` from `packages/coding-agent/src/extensions/mcp/index.ts:1262`.
- Port: `rpi/crates/rpi-cli/src/interactive_tui/commands.rs:792`
  (`build_builtin_registry`), the fall-through to the prompt at
  `rpi/crates/rpi-cli/src/interactive_tui.rs:514-525`.

**Status: live.**

---

## 21. The `/` autocomplete has no counter, no wrap-around and no argument completions — **behaviour + appearance**

**User sees.** Original: `→ settings Open settings menu` … `(1/31)`, `↓` wraps
back to the first entry, `model <provider/model> — Select model (opens
selector UI)`, and after `/model ` a live completion list. Port: the same five
rows but **no counter**, `↓` clamps on the last entry, no `<provider/model>`
hint and no argument completion list at all.

- Original: `packages/tui/src/components/select-list.ts:102-130`;
  `packages/tui/src/autocomplete.ts:336-372`;
  `packages/coding-agent/src/modes/interactive/interactive-mode.ts:734-790`.
- Port: `rpi/crates/rpi-cli/src/interactive_tui/autocomplete.rs:54-118`
  (plain `Text` rows, not `SelectList`), `:170-200`
  (`(*sel + 1).min(total-1)`).

**Status: live.**

---

## 22. The file-completion popup pops for any word — **behaviour (spurious UI)**

**User sees.** Typing the word `al` makes the port show `→ alpha.txt` above
the input; the original shows nothing (it only completes `@paths`, quoted
paths, or a path-like token, and otherwise only on an explicit `Tab`).

- Original: `packages/tui/src/autocomplete.ts:535` (`extractPathPrefix`).
- Port: `rpi/crates/rpi-tui/src/autocomplete.rs:154-181`
  (`extract_path_prefix` returns the raw token for any word) and `:236-255`.

**Status: live** (re-check: `extract_path_prefix` was still unconditional at
18:10).

---

## 23. `Tab`-accept of a slash command glues the next character — **behaviour**

**User sees.** `/mo` + `Tab` + `x` → original `> /model x`; port `> /modelx`
(a command that can never parse).

- Original: `packages/tui/src/autocomplete.ts:424` (`applyCompletion` appends a space).
- Port: `rpi/crates/rpi-cli/src/interactive_tui/autocomplete.rs:119`
  (`accept_top_suggestion`); the slash provider sets `insert_space: false`
  (`rpi/crates/rpi-tui/src/autocomplete.rs:340`).

**Status: live.**

---

## 24. Long lines wrap differently — **behaviour (layout)**

**User sees.** The same 160-char sentence: the original breaks at whitespace
(`… into the woods` / `  beyond the hill …`), the port breaks mid-word
(`… into the woods bey` / `  ond the hill …`).

- Original: `packages/tui/src/components/editor.ts:126` (`wordWrapLine`).
- Port: `rpi/crates/rpi-tui/src/editor.rs:194` (`wrap_line_ranges`).

**Status: live** (the word-wrap work was in flight during the audit).

---

## 25. `Ctrl+]` and `Ctrl+-` are dead without the kitty keyboard protocol — **behaviour**

**User sees.** In tmux and most terminals, `Ctrl+]` then a character types the
character normally in the port (the original eats it as the jump target), and
`Ctrl+-` does not undo in the port (the original does).

- Original: `packages/tui/src/keys.ts:1330-1331` maps the legacy bytes
  `0x1d → "ctrl+]"`, `0x1f → "ctrl+-"`.
- Port: crossterm 0.27 maps `0x1C..=0x1F` to `Char('4'..'7')+CONTROL`, so
  `rpi/crates/rpi-tui/src/editor.rs:1374` (jump) and `:1335` (undo) never match.

**Status: live** (code-level; the harness cannot deliver those bytes as
distinct keys).

---

## 26. History recall differs when the draft is not empty — **behaviour**

**User sees.** Type a draft, `Ctrl+A`, `↑`: the original replaces the draft
with the newest history entry (and `↓` restores the draft); the port does
nothing.

- Original: `packages/tui/src/components/editor.ts:1136-1146`, `:545`,
  `:1411` (typing resets the browse index).
- Port: `rpi/crates/rpi-cli/src/interactive_tui.rs:2856-2866` (history only
  when the editor is empty or already browsing),
  `rpi/crates/rpi-cli/src/interactive_tui/state.rs:837`.

**Status: live.**

---

## 27. `Ctrl+U` / `Ctrl+K` at a line boundary do not join the lines — **behaviour**

**User sees.** `abc` `Ctrl+J` `def` `↑` `Ctrl+K`: the original gives one line
(`> abcdef`, the newline is killed); the port keeps two rows.

- Original: `packages/tui/src/components/editor.ts:1836` and `:1871` (both
  merge with the neighbouring line and push `"\n"` onto the kill ring).
- Port: `rpi/crates/rpi-tui/src/editor.rs:1302` / `:1317` only drain the
  current line.

**Status: live.**

---

## 28. `\` + `Enter` submits in the port instead of continuing the line — **behaviour**

**User sees.** Type `foo\` then `Enter`: the original deletes the `\` and
inserts a newline (nothing is sent); the port sends `foo` to the model.

- Original: `packages/tui/src/components/editor.ts:1141`, `:1563`
  (`shouldSubmitOnBackslashEnter`).
- Port: missing — `rpi/crates/rpi-tui/src/editor.rs:1279` (`submit`) has no
  such branch.

**Status: live.**

---

## 29. The mouse wheel scrolls 3 lines per notch in the port, 1 in the original — **behaviour**

**User sees.** One wheel-up notch moves the transcript 1 line in the original
(Alt+wheel = 5) and 3 lines in the port.

- Original: `packages/coding-agent/src/core/settings-defaults.ts:68`
  (`fullscreenWheelScrollLines: 1`), `packages/tui/src/wheel-scroll.ts`.
- Port: `rpi/crates/rpi-tui/src/tui_alt_screen.rs:403`
  (`wheel_scroll_lines: AtomicI32::new(3)`).

**Status: live.**

---

## 30. Aborting a run leaves no trace in the port — **behaviour**

**User sees.** `Esc` during a long command: the original prints
`Command aborted` and `Error: The operation was aborted.`; the port's
transcript is unchanged (the panel just shows `7.7s (exit 1)`).

- Original: `packages/coding-agent/src/modes/interactive/components/bash-execution.ts:192-196`
  and the abort path in `packages/coding-agent/src/modes/interactive/interactive-mode.ts`.
- Port: `rpi/crates/rpi-cli/src/interactive_tui.rs` (the `Esc` handler sets
  `RunStatus::Aborting` and clears the status text; no transcript note).

**Status: live.**

---

## 31. The port claims a compaction that did not happen — **behaviour**

**User sees.** The original errors with
`Error: Compaction failed: Nothing to compact (session …)`; the port prints
`ℹ Conversation compacted.`

- Port: `rpi/crates/rpi-cli/src/interactive_tui/run.rs:285`.
- Original: `packages/coding-agent/src/modes/interactive/interactive-mode.ts` (the
  `/compact` handler).

**Status: live.**

---

## 32. No terminal progress bar in the port, and the setting promises one that is never emitted — **behaviour + wording**

With `terminal.showTerminalProgress: true` the original paints a `▔▔▔…`
hairline row across the top of the screen while the agent works; the port
draws nothing (its `ProgressBar` component is dead code) and its settings row
reads `OSC 9;4 progress in the terminal tab bar (applies on restart)` — an
OSC sequence it never emits (the flag only toggles the in-editor spinner).

- Original: `packages/coding-agent/src/modes/interactive/components/progress-bar.ts:84-94`,
  `components/chat-viewport.ts:44-49`;
  `packages/coding-agent/src/modes/interactive/components/settings-selector.ts:887-892`.
- Port: `rpi/crates/rpi-tui/src/progress.rs:45` (unused),
  `rpi/crates/rpi-cli/src/interactive_tui/state.rs:1008-1018`,
  `rpi/crates/rpi-cli/src/interactive_tui/settings.rs:222-228`.

**Status: live.**

---

## 33. The flash banner is missing — copy feedback becomes a permanent line — **behaviour**

**User sees.** `Ctrl+X` in the original flashes an inverse-video ` Copied! `
banner top-right for about a second; the port writes a permanent
`ℹ Copied last reply to the clipboard.` line into the transcript.

- Original: `packages/tui/src/components/alt-screen-flash.ts:13-46`,
  `packages/tui/src/tui-alt-screen.ts:685-688`,
  `packages/coding-agent/src/modes/interactive/interactive-mode.ts:6648`.
- Port: `rpi/crates/rpi-cli/src/interactive_tui/run.rs:302-326`
  (`copy_last_assistant` → `add_note_message`); there is no
  `alt_screen_flash` component in `rpi-tui`.

**Status: live.**

---

## 34. The jump-to-end indicator paints over the transcript — **behaviour + appearance**

**User sees.** The original puts `↓ Jump to latest message` on its own row
below the transcript; the port paints `↓ Jump to latest message · End` **on
the last transcript row**, cutting the text underneath off.

- Original: `packages/tui/src/tui-alt-screen.ts:1677-1703`
  (`scrollToEndIndicatorPlacement: "below-scroll-view"`),
  `packages/coding-agent/src/modes/interactive/tui-renderer.ts:30`.
- Port: `rpi/crates/rpi-tui/src/jump_to_end.rs:29`,
  `rpi/crates/rpi-cli/src/transcript_navigation.rs:19-30`.

**Status: live.**

---

## 35. The trust/answer wording and the note severity differ — **wording**

| case | original | port |
|---|---|---|
| `/copy` with no reply | `Error: No agent messages to copy yet.` | `ℹ Nothing to copy yet — no assistant reply captured.` |
| `/name` with no argument | `Warning: Usage: /name <name>` | `ℹ Usage: /name <display name> — sets the current session's name.` |
| `/logout` with nothing stored | `No stored credentials to remove. /logout only removes credentials saved by /login; environment variables and models.json config are unchanged.` | `ℹ No saved provider credentials found.` |
| `/thinking bogus` | `Error: Unknown thinking level "bogus". Available levels: off.` | `✗ Unknown thinking level "bogus". Valid: off, minimal, low, medium, high, xhigh, max` |
| copy confirmation | `Copied last agent message to clipboard` | `ℹ Copied last reply to the clipboard.` |

- Original: `packages/coding-agent/src/modes/interactive/interactive-mode.ts:6644`,
  `:6658-6665`, `:6651`, `:5057-5062`.
- Port: `rpi/crates/rpi-cli/src/interactive_tui/run.rs:305`,
  `rpi/crates/rpi-cli/src/interactive_tui/commands.rs:632`,
  `rpi/crates/rpi-cli/src/interactive_tui/selectors.rs:693`,
  `rpi/crates/rpi-cli/src/interactive_tui/commands.rs:212-220`.

**Status: live.**

---

## 36. `/thinking <level>` accepts levels the model does not support — **behaviour**

**User sees.** `/thinking high` on a model without reasoning: the original
answers `Error: Unknown thinking level "high". Available levels: off.`; the
port answers `ℹ Thinking set to high.`

- Original: `packages/ai/src/models.ts:1236-1245` (`getSupportedThinkingLevels`
  returns `["off"]` when `!model.reasoning`).
- Port: `rpi/crates/rpi-ai/src/model.rs:304-324` returns
  `off,minimal,low,medium,high` for any model without a `thinking_level_map`.

**Status: live.**

---

## 37. The first-run dialog fires where the original never shows one — **behaviour**

The original's first-run setup is skipped whenever the agent directory is set
explicitly (`PI_CODING_AGENT_DIR`), so it never appears in the parity setup;
the port's `first_run_pending()` ignores `RPI_CODING_AGENT_DIR` and shows the
theme dialog. The option lists differ too
(original: `System (follows the terminal's light or dark mode)` / Dark / Light;
port: Dark / Light / Monochrome) and the greeting casing differs
(`Welcome to Pi` vs `Welcome to pi`).

- Original: `packages/coding-agent/src/cli/first-time-setup.ts:50`,
  `packages/coding-agent/src/modes/interactive/components/first-time-setup.ts:21-25`.
- Port: `rpi/crates/rpi-tui/src/first_run.rs:17`, `:167`;
  `rpi/crates/rpi-cli/src/extras.rs:39-93`.

**Status: live.**

---

## 38. `/hotkeys` is missing three entries and the Extensions section — **behaviour + appearance**

The original's table has `Ctrl+C | Exit (press twice)`, `Jump forward to
character`, `Jump backward to character`, and an **Extensions** section
listing extension-registered shortcuts; the port omits all four.

- Original: `packages/coding-agent/src/modes/interactive/interactive-mode.ts:6799-6905`.
- Port: `rpi/crates/rpi-cli/src/interactive_tui/rendering.rs:286-410`.

**Status: live.**

---

## 39. The input has a selection model in the port and none in the original — **behaviour (Rust-only, and the cause of §1)**

`Shift+←` highlights characters in the port's input (and `Ctrl+X` cuts them);
the original has no selection in the editor at all, so `Ctrl+X` copies the last
assistant reply there.

- Original: `packages/tui/src/components/editor.ts:243`.
- Port: `rpi/crates/rpi-tui/src/editor.rs:58` (`selection_anchor`), `:764`
  (`begin_selection`), `:1330` (`Ctrl+X` → `cut_selection`).

**Status: live.**

---

## 40. The submitted text is trimmed in the original and not in the port — **behaviour (low visibility)**

- Original: `packages/tui/src/components/editor.ts:1602` (`submitValue` →
  `expandPasteMarkers(...).trim()`).
- Port: `rpi/crates/rpi-tui/src/editor.rs:1279` (`get_expanded_text()`, no trim).

**Status: live.**

---

## 41. The model's reasoning is printed inline instead of behind a collapsed summary — **behaviour**

**User sees.** After a turn that streams `reasoning_content`:

- Original: one line, `+ Thought · 0.1s` — the reasoning is hidden until the
  user expands the block.
- Port: the whole reasoning text is printed in the transcript
  (`The parity mock thinks before it answers.`), with no summary line.

The cause is a **settings default**: the original ships
`hideThinkingBlock: true` (collapsed by default), the port's
`hide_thinking_block` is an `Option<bool>` with **no default**, so the
thinking is expanded.

- Original: `packages/coding-agent/src/core/settings-defaults.ts:27`
  (`hideThinkingBlock: true`),
  `packages/coding-agent/src/modes/interactive/components/assistant-message.ts:114-135`
  (`formatThoughtSummary`, `buildExpandedThinking`), `:196-197`.
- Port: `rpi/crates/rpi-tui/src/assistant_message.rs:100-118`
  (`format_thought_summary`), `:343-395` (the block is rendered **expanded**
  unless `hide_thinking` is set);
  the host override that decides it is
  `rpi/crates/rpi-cli/src/transcript_view.rs:317` and `:337`
  (the transcript sub-audit located the actual override here — the fix site is
  the host, not the component);
  `rpi/crates/rpi-cli/src/interactive_tui.rs:934-936` and `:1033`
  (`hide_thinking` comes from the setting, which has no default);
  `rpi/crates/rpi-cli/src/settings.rs:309` (`hide_thinking_block: Option<bool>`).

**Keys:** `hello world`, `Enter`. **Status: live** (reproduced on the 18:04
binary).

---

## 42. The user message is drawn inside a box with rules above and below — **appearance**

**User sees.** Every submitted message is echoed inside a bordered band in the
port:

```
────────────────────────────────────────────────────────────────────
 hello world
────────────────────────────────────────────────────────────────────
```

The original paints the message markdown with a background colour and **no**
box (its own comment says a box would duplicate every line).

- Original: `packages/coding-agent/src/modes/interactive/components/user-message.ts:43-60`
  (Markdown + `bgColor`, no `Box`).
- Port: `rpi/crates/rpi-tui/src/user_message.rs:44-56` (`build_box` → a
  `Box` with `user_message_bg`).

**Status: live.**

---

## 43. The assistant reply can be rendered **twice** — behaviour (race)

**User sees.** One prompt, one model answer — but the port sometimes draws the
answer (and the reasoning above it) **twice** in the transcript, the original
once.

- Original: `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3352`,
  `:3365`, `:3420` (one component per assistant turn).
- Port: `rpi/crates/rpi-cli/src/interactive_tui/run.rs:118` (`take()` detaches
  the live component from the shared slot) →
  `rpi/crates/rpi-cli/src/transcript_view.rs:332` (`ensure_assistant()` sees an
  empty slot and creates a **second** component at `:335-346`).

**Keys:** `hello` + `Enter`. **Observed:** the transcript sub-audit counted the
answer 2, 1, 1, 2 over four runs of the port and 1 on every run of the
original; the mock logged **one** provider request on both sides, so it is a
render bug, not a second model call. **I reproduced it on the 18:25 binary**:
the reasoning line `The parity mock thinks before it answers.` appears
**twice** in the port's transcript. **Status: live** (a race — it will not
reproduce on every run).

---

## 44. The bash tool panel has no `Took 0.0s` row — behaviour (a whole row missing)

**User sees.** The original's bash tool panel ends with a `Took 0.0s` line; the
port's panel stops after the output.

- Original: `packages/coding-agent/src/core/tools/renderers/bash.ts:103-106`,
  `packages/coding-agent/src/core/tools/render-utils.ts:166`.
- Port: `rpi/crates/rpi-tui/src/tool_renderers.rs:754-764` (needs
  `ctx.duration_ms`) and `rpi/crates/rpi-tui/src/tool_execution.rs:691-698`
  (`elapsed_ms` is only supplied when **both** `started_at` and `finished_at`
  are set).

**Status: live** (from the transcript sub-audit, `scripts/parity/TRANSCRIPT-PARITY.md`).

---

## 45. The read tool panel has extra chrome the original does not draw — behaviour

**User sees.** Original: `read sample.txt` / the file lines / `Done.`.
Port: `✓ read sample.txt 0.0s ▾` / `args: path=sample.txt` / `│ alpha` /
`│ bravo` / `│ charlie` — a `│` gutter on every line, an `args:` row, a ✓
glyph, a duration and a chevron.

- Original: `packages/coding-agent/src/core/tools/renderers/read.ts:148-165`.
- Port: `rpi/crates/rpi-tui/src/tool_execution.rs:472-530`, `:580-584`.

**Status: live** (fix site still open: the `read` renderer exists at
`rpi/crates/rpi-tui/src/tool_renderers.rs:492-507`, registered at `:76`, but
the generic path ran anyway — `tool_execution.rs:427-430`).

---

## 46. `PageUp` does not scroll the port's transcript — behaviour

**User sees.** With a long transcript, `PageUp` moves the original's view; the
port's pane is byte-identical before and after.

- Original: `packages/coding-agent/src/modes/interactive/chat-viewport.ts:25`
  (the follow-end scroll view), `packages/coding-agent/src/core/keybindings.ts:194`.
- Port: `rpi/crates/rpi-cli/src/interactive_tui.rs:1721-1723`, the viewport at
  `rpi/crates/rpi-cli/src/interactive_tui/state.rs:1342`.

**Status: live** (contradicts the "identical" verdict in FEATURES.md).

---

## 47. Fixed during the audit (kept for the record)

These were live in the 17:18 binary and are fixed in the working tree as of
18:10 — re-check them against the current build before spending time on them.

| what | original | port (before) | port (now) |
|---|---|---|---|
| `Ctrl+C` on a draft | keeps the text, shows `Press Ctrl+C again to exit` | wiped the draft silently (`app.clear`) | `app.quit` + `CtrlCAction::Warn`: `rpi/crates/rpi-tui/src/keybindings.rs:163`, `rpi/crates/rpi-cli/src/interactive_tui.rs:2419-2450` |
| `Home` in the input | moves the caret to the line start | scrolled the transcript to the top (the global viewport handler swallowed it) | `tui.altScreen.top` is unbound again: `rpi/crates/rpi-tui/src/keybindings.rs:887-891`; `Ctrl+E` is the bottom key again (`:894-898`) |
| user keybinding overrides | `<agent-dir>/keybindings.json` | ignored the file (only `settings.json → keybindings`) | reads `<agent-dir>/keybindings.json`: `rpi/crates/rpi-cli/src/settings.rs:1001` |
| cancel hint on the status line | `(Esc to cancel)` | hard-coded `(Ctrl+C to cancel)` | resolves `app.interrupt` → `escape`: `rpi/crates/rpi-tui/src/status_indicator.rs:251` |
| `app.models.save` / `app.thinking.save` | wired (`Ctrl+S` = set as default) | registered but never read | wired: `rpi/crates/rpi-cli/src/interactive_tui/selector_keys.rs:635`, `:738` |

---

## Corrections to FEATURES.md

| row | verdict today |
|---|---|
| §7 *Scoped-model picker — identical* | **differs** (no title/search/✓/provider/hint, the `Ctrl+A`/`Ctrl+X`/`Ctrl+P`/`Option+↑↓`/`Ctrl+S` keys are not implemented there, and the port saves on `Esc`) |
| §7 *Thinking-level picker — identical* | **differs** (no title/search/hint/✓/`· default`; the level list is wrong for non-reasoning models) |
| §7 *First-time setup dialog — missing* | **differs** — the port has one now, but it fires where the original never shows one |
| §7 *Hotkeys list — differs (hard-coded 17-row table)* | mostly fixed; three entries and the Extensions section are still missing (§38) |
| §3 *App-level keybindings — differs* | the registry is now complete; the remaining gap is the wiring (§17) |
| §9 *Built-in slash-command set* | also missing `/history`, `/sessions`, `/llama`, `/mcp` (§20) |
| §8 *Mouse wheel scrolling* | the original is **1** line/notch by default, not accelerating |
| §8 *Terminal progress bar (OSC 9;4)* | the original's OSC 9;4 was removed upstream; what it has is an in-TUI `▔` hairline row. The port has none (§32) |
| §8 *Alt-screen flash messages* | still missing (§33) |
| §8 *Click-to-select / copy-on-select / hover-to-select* | the mouse layer now exists in the port; only the flash container is still absent |
| §3 *Cancel hint in the running-status line* | fixed (§41) |
| §9 *`/import` — identical* | **broken** (§3) |
| §7 *Session-tree / branch picker — identical* | **differs** (§11) |

---

## Notes for the readers of this file

- I am the **auditor**, not a porter: I changed no source, no test, no
  scenario and no golden trace. Every row above still needs the owning porter
  to fix it and the area lead to re-check it — do not treat it as verified
  work.
- The tree was in heavy flux during the audit; the `Status` column says which
  findings were re-verified against the 18:04 binary and the ~18:10 source.
- The Rust workspace did **not** build at the end of this audit
  (`rpi/crates/rpi-harness/src/prompt_templates.rs:273` — missing fields
  `argument_hint` and `file_path` in the `PromptTemplate` initializer, not my
  file, reported by LanguagePort).
