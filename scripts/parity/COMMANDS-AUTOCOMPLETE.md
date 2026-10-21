# Commands & autocomplete parity — TypeScript original vs. Rust port

Area: the **slash-command surface** (the command set, how each command is
dispatched, the exact text each command prints) and the **`/` autocomplete
list** (the command picker in the editor slot).

* Original: `/Users/gabriel/pi` (branch `perf/lightweight-harness`)
* Port: `/Users/gabriel/pi-native` (branch `feat/rpi-native`)

Reading the port: `rpi-tui/src/…`, `rpi-cli/src/…` below are relative to
`/Users/gabriel/pi-native/rpi/crates/`; the full path is
`/Users/gabriel/pi-native/rpi/crates/<what is written>`. Reading the original:
`packages/…` below means the path relative to `/Users/gabriel/pi`.

**Ownership.** Per the lead's split, the commands and the autocomplete are the
language lead's and the branding agent's area; the pickers themselves are the
interactive-mode porter's. This document therefore covers the command
dispatch, the command output text and the autocomplete list, and only
*references* the picker chrome (which
[`INTERACTIVE-MODE.md`](INTERACTIVE-MODE.md) §12–§15 already covers in depth).
Where the two overlap, this document adds the **exact captured text** and the
parts of the picker that are a *command* problem rather than a *menu* problem.

**Overlap with the other parity documents — read this first.**

* [`LANGUAGE.md`](LANGUAGE.md) owns the **wording**: the command descriptions,
  the `/hotkeys` table, the startup header, the changelog. §4.10 and §4.9 here
  only add the three rows the `/hotkeys` table is still missing and the four
  commands `/help` is still missing; do not re-do LANGUAGE.md's work.
* [`INTERACTIVE-MODE.md`](INTERACTIVE-MODE.md) owns the **picker chrome**: the
  model picker, the shared menu framework, the trust panel, the OAuth/login
  columns. §4.11–§4.12 and §5 here only add the **verbatim screens** and the
  *command*-level consequences (e.g. `/trust` takes an argument instead of
  opening a panel; `/login` skips the auth-method step).
* This document owns the parts nobody else has: **the command set**, **the
  dispatch of a command the port does not have**, **the autocomplete list's
  mechanics** (counter, wrap, argument hints, argument completions) and **the
  exact text each command prints**.

**Method.** Read-only inspection of both trees; live runs of both programs under
tmux at a fixed 100×30 pane with a frozen clock and a mock model server, via
`/tmp/pdrive/drive.mjs` (a copy of `scripts/parity/drive.mjs`). Every screen in
§5 is a verbatim capture of the pane, not a description. No file in either tree
was modified while producing this document.

**Snapshot warning.** The Rust tree was being rebuilt **while this document was
written** — `rpi/target/debug/rpi` was rebuilt at 17:37, 17:50, 17:54 and
17:55, and each build changed the startup screen and the command list. Two
findings below were fixed live and are marked **[fixed in-tree]**; the rest were
re-checked against the source as it stood when this file was written. **A
`file:line` here is a locator, not a guarantee**: re-read the file before acting
on it, and re-run the check in the "Check" row.

**I am the auditor for this area, not the porter.** I have made no change to
either tree, so nothing here is self-verified: every row needs a second pair of
eyes before it is called done.

---

## 0. Status — the command surface, re-verified 2026-10-21

**This section replaces the 18:48 status below it**, which described the port
before the command surface was ported over. The older table is kept for the
picker chrome it covers; everything it says about the **command set**, the
**`/` list** and **`/hotkeys`** is superseded by the tables here.

### CLOSED in this pass

| Was reported | Now |
|---|---|
| the port's `/` list carried nine commands the original does not have: `/help`, `/?`, `/clear`, `/version`, `/v`, `/provider`, `/tools`, `/images`, `/usage` (§1.2, §1.3) | **CLOSED.** All nine are gone from the registry, so they are neither listed nor dispatched: `/help` and `/version` are ordinary messages again and reach the model. The port's own `/new` is the original's `/new` (`Start a new session`) and is no longer an alias of `/clear`. |
| the `/` list was in the port's own order, not the original's (§1.2) | **CLOSED.** The registry is registered in the original's order (`packages/coding-agent/src/core/slash-commands.ts:21-52`), so the list reads `settings, model, tree, thinking, scoped-models, skills, theme, export, import, share, bug, copy, name, stats, changelog, hotkeys, fork, clone, trust, login, logout, new, compact, resume, reload, quit`. |
| the original's alias rows were missing from the list (`history`, `sessions`, `exit` — §1.3) | **CLOSED.** Each alias is its own row right after the command it points at, the way the original's picker builds it (`interactive-mode.ts:722-733`): `resume, history, sessions` and `quit, exit`. The port's own aliases (`/q`, `/m`, `/think`, `/session`) stay off the list. |
| the list showed the leading slash (§3.4) | **CLOSED.** The rows show the bare name (`settings`, `model`, `hotkeys`); the slash stays in the row's value, so accepting a row still writes the dispatched name. |
| the `/hotkeys` table had no `Extensions` section (§4.10) | **CLOSED** for the extensions that register shortcuts natively: the section renders the original's table — the `**Extensions**` heading, the `| Key | Action |` table, the capitalised key and the description, or the extension's name when the shortcut has none (`interactive-mode.ts:6892-6903`). **Still open:** the JS (Bun) extension host keeps `registerShortcut` calls in a JS-side map and never exports them, so a JS extension's shortcut does not reach the table — and the extension shown is its display name, not its path. |
| `/exit` with text quit the app | **CLOSED.** The original rewrites a bare alias only (`packages/coding-agent/src/core/slash-commands.ts:56-68`), so `/exit some text` is a message again, like `/history some text`. |
| the `app.session.new` keybinding did nothing | **CLOSED.** It pointed at the removed `/clear`; it now runs `/new`, the command the original's keybinding runs (`interactive-mode.ts:2879`). |

### STILL OPEN — the live gaps

| § | Gap | State now |
|---|---|---|
| §1 | the `/` list is two entries short of the original's | the original's picker shows **31** entries, the port's **29**: the original's built-in extensions add `llama` (`Manage llama.cpp router models`) and `mcp` (`Manage MCP servers…`). The port has neither feature, so it lists neither command. |
| §4.8 | `/new` does not start a session | the command is dispatched and answers `A new session is not created by this command yet; the current session continues.` The port has no session-*create* entry point (`switch_to_session` opens an existing session), so this needs the session area, not the command surface. |
| — | the provider add/remove form has no entry point | the `/provider` command is gone, and the provider selector it opened is the only door to the form. The form's code is still there; nothing opens it. |
| §3.3 | no argument completions | typing `/model ` opens no completion list; the original shows the catalog. |
| §2 | the port's own aliases | `/q`, `/m`, `/think` and `/session` are still registered (off the list), so `/m` runs `/model` where the original sends `/m` to the model. |

### CLOSED since the first captures (18:48)

| Was reported | Now — verified on the 18:48 binary |
|---|---|
| the thinking picker listed five levels for a model that supports none (§4.4) | **CLOSED.** The picker now shows one row, `→ off    No reasoning` — the original's exact screen (§5.2). This is the one-line `if !self.reasoning { return vec![Off]; }` in `rpi-ai` (the `reasoning` flag existed at `model.rs:290` and was ignored). |
| `/thinking <level>` accepted a level the model cannot use (§4.4) | **CLOSED** by the same change. |
| the thinking-level description table differed | **CLOSED** — byte-identical to the original. |
| the `/settings` menu exposed 15 rows, in the wrong order, with the wrong descriptions (§4.15) | **CLOSED.** The port's menu is now the original's screen, character for character: `>` search field, `→ Auto-compact  true`, `Auto-resize images`, `Block images`, `Skill commands`, `Show hardware cursor`, `Editor padding`, `Output padding`, `Nerd Font glyphs`, `Autocomplete max items`, `Autocomplete position`, `(1/35)`, the description on its own line below, and the hint `Type to search · Enter/Space to change · Esc to cancel`. Compare §5.4 — the two panes are identical. |
| the model picker's row format was the model *name* + `provider/id (current)` (§4.11) | **CLOSED.** The row is now the original's: `→ ✓ mock-1                        [mock]` — the `✓` on the current model and the `[provider]` column. |
| the `/` list had no argument hints (§3.2) | **CLOSED.** The list now shows the original's format, including the hints: `→ /model <provider/model> — Select model (opens selector UI)`, `/thinking <level> — Set thinking level`, `/theme <name> — Change the color theme`, `/login <provider> — Configure provider authentication`. |
| `/skills`, `/bug` and `/stats` did not exist (§1, §2) | **CLOSED.** All three are in the port's `/` list now, with the original's descriptions: `/skills Browse and run a skill`, `/bug <description> — Report a bug to the Pi developers`, `/stats Show session info and stats`. `/stats` no longer reaches the model. |
| the Chinese login strings | **CLOSED** — `Not configured` / `Configured · API key` now. |
| the startup header | **CLOSED** — the port now shows pi's header, its ` v1.3.0` and pi's tmux warning. |

**One harness note first, because it will bite the next person:** the port
now reads **pi's** agent directory, so the Rust side is driven with
`PI_CODING_AGENT_DIR`, **not** `RPI_CODING_AGENT_DIR` (the repo's
`scripts/parity/drive.mjs` is already correct at `:208`/`:218`;
`scripts/parity/session-compat.mjs:147` and `scripts/parity/settings-parity.mjs:251`
still pass the old variable and will silently capture a port with no models).

### STILL OPEN — the picker chrome (the 18:48 list)

| § | Gap | State on the 18:48 binary |
|---|---|---|
| §1 | the command set is still not the original's | **superseded — see §0.** The port's list is the original's 26 commands plus the original's three alias rows, in the original's order; only the original's built-in-extension commands (`/llama`, `/mcp`) are missing. |
| §3.1 | the `/` list has no `(n/m)` counter and does not wrap | **CLOSED.** The popup renders through the tui library's `SelectList`, so it prints the counter — the captured port pane reads `(1/29)` against the original's `(1/31)` — and `↓`/`↑` wrap. |
| §3.3 | no argument completions | **OPEN.** Typing `/model ` still opens no completion list; the original shows `→ mock-1   mock`. |
| §4.1 | `/name` with no argument | **OPEN** — the port prints `ℹ Usage: /name <display name> — sets the current session's name.`, the original `Warning: Usage: /name <name>`. |
| §4.2 | `/copy` with no reply | **OPEN** — the port prints `ℹ Nothing to copy yet — no assistant reply captured.`, the original `Error: No agent messages to copy yet.` (info vs error). |
| §4.3 | `/logout` with nothing stored | **OPEN** — the port prints `ℹ No saved provider credentials found.`, the original the two-line "No stored credentials to remove. /logout only removes credentials saved by /login; environment variables and models.json config are unchanged." |
| §4.5 | `/export` | **OPEN** — the port defaults to Markdown and exports an in-memory session; the original defaults to HTML and refuses an in-memory session. |
| §4.6 | `/stats` vs `/usage` | **OPEN — and `/stats` is a no-op.** `/stats` is in the list and dispatches, but it prints **nothing at all**: `interactive_tui.rs:3895` is `Some(TuiMessage::ShowStats) => {}`, an empty handler arm. Verified on the 18:48 binary: type `/stats`, Enter → the pane does not change. The original prints the full `Session Stats` block (§5.9). The sibling `ShowUsage` arm at `:3633` is the one that works and the one to copy — see §4.6a. |
| §4.7 | `/changelog` | **OPEN** — the port's header is `Recent Changes`, the original's is `What's New`; the port shows only the latest release, the original the whole history. |
| §4.8 | `/new` is `/clear` | **OPEN** — the port's `/new` is still `ClearChatCommand`'s alias ("Clear the conversation" in the list) and the session and its usage survive it. |
| §4.9 | `/help` | **OPEN** — the original has no `/help`; the port's table still lists 25 entries, not all of the port's 33. |
| §4.10 | `/hotkeys` | **OPEN** — three rows still missing: `Exit (press twice)`, `Jump forward/backward to character`, and the `Extensions` section. |
| §4.11 | the model picker is missing the title, the footer, the hint line and Ctrl+S | **PARTLY CLOSED.** The row is now the original's (§ above), but the port still shows `Select model` / `Type to filter by name, provider, or id` where the original shows the warning `Only showing models from configured providers. Use /login to add providers.`, still has no `Model catalogs refreshed.` footer and no `Enter to select · Ctrl+S to set as default · Escape/Ctrl+C to cancel` hint — and **Ctrl+S still does nothing**. |
| §4.12 | the login pickers lost the auth-type and status columns and the auth-method step | **OPEN.** The provider list now has 40 rows and a `(1/40)` counter, but the rows still read `Not configured · API key / ANTHROPIC_API_KEY` where the original reads `• not configured` with a `[subscription]`/`[API key]` column, and there is still no `Select authentication method:` first step. |
| §4.13 | the theme picker | **OPEN** — still the three hard-coded presets (`Dark`, `Light`, `Monochrome`) with descriptions, where the original lists `system (current)`, `dark`, `light` under a `Theme` title with a `> Search` field and the hint `Type to search · enter select · escape/ctrl+c cancel`. |
| §4.14 | the scoped-models picker | **OPEN** — still a bare `→ mock-1` row: no `Model Configuration` title, no `Session-only. Ctrl+S to save to settings.`, no search, no `[provider]`, no `Model Name:` line, no refresh status, no `Enter toggle · Ctrl+A all · Ctrl+X clear · Ctrl+P provider · Option+Up/Option+Down reorder · Ctrl+S save · all enabled` hint, and none of those keys work. |
| §4.15 | the trust prompt | **OPEN** — `/trust` still writes the decision and prints `ℹ Current project marked trusted.`; there is no `Project trust` panel, no `Trust parent folder` option and no `Saved decision:` / `Current session:` line. |

**The five screens the lead named as not landed** — the trust prompt, the
OAuth flows, the model list, the skill entries in the autocomplete and the
five unreachable screens — are all confirmed above. The model list is the
*nearest* to done: one row format away, and the missing pieces are the title
line, the footer, the hint line and one key.

## 1. The command set

`INTERACTIVE-MODE.md` §2 already records that the two sets differ. This section
adds the **exact lists**, the aliases, and the two built-in-extension commands
that the earlier row missed.

### 1.1 What the original offers

`packages/coding-agent/src/core/slash-commands.ts:21-47` — 26 built-ins, plus
their aliases, are what the `/` picker lists
(`packages/coding-agent/src/modes/interactive/interactive-mode.ts:722-733`
expands every alias into its own list entry).

| # | Name | Aliases | Description (the exact text in the picker) |
|---|---|---|---|
| 1 | `settings` | | Open settings menu |
| 2 | `model` | | `<provider/model>` — Select model (opens selector UI) |
| 3 | `tree` | | Navigate session tree (switch branches) |
| 4 | `thinking` | | `<level>` — Set thinking level |
| 5 | `scoped-models` | | Enable/disable models for Ctrl+P cycling |
| 6 | `skills` | | Browse and run a skill |
| 7 | `theme` | | `<name>` — Change the color theme |
| 8 | `export` | | Export session (HTML default, or specify path: .html/.jsonl) |
| 9 | `import` | | Import and resume a session from a JSONL file |
| 10 | `share` | | Share session via a Radius artifact or a GitHub gist |
| 11 | `bug` | | `<description>` — Report a bug to the Pi developers |
| 12 | `copy` | | Copy last agent message to clipboard |
| 13 | `name` | | Set session display name |
| 14 | `stats` | | Show session info and stats |
| 15 | `changelog` | | Show changelog entries |
| 16 | `hotkeys` | | Show all keyboard shortcuts |
| 17 | `fork` | | Create a new fork from a previous user message |
| 18 | `clone` | | Duplicate the current session at the current position |
| 19 | `trust` | | Save project trust decision for future sessions |
| 20 | `login` | | `<provider>` — Configure provider authentication |
| 21 | `logout` | | Remove provider authentication |
| 22 | `new` | | Start a new session |
| 23 | `compact` | | Manually compact the session context |
| 24 | `resume` | `history`, `sessions` | Resume a different session |
| 25 | `reload` | | Reload keybindings, extensions, skills, prompts, themes, and context files |
| 26 | `quit` | `exit` | Quit pi |

Two more come from the original's **built-in extensions**, so they are in the
same list: `llama` — "Manage llama.cpp router models"
(`packages/coding-agent/src/extensions/llama/index.ts:186`) and `mcp` — "Manage
MCP servers: sign in, reconnect, enable or disable, and change exposure"
(`packages/coding-agent/src/extensions/mcp/index.ts:1262`).

The picker therefore shows **31 entries** and its counter reads `(1/31)`.

The original also dispatches three commands that are **not** in the list:
`/debug` (`interactive-mode.ts:3084`), `/arminsayshi` (`:3089`) and
`/dementedelves` (`:3094`).

### 1.2 What the port offers

The registry is `rpi-cli/src/interactive_tui/commands.rs` (`build_builtin_registry`).
The list shows **29** rows: the original's 26 commands and the original's three
alias rows, in the original's order. The port's own `/context` is registered but
hidden from the list.

| # | Name | Aliases | Description (the exact text in the picker) |
|---|---|---|---|
| 1 | `settings` | | Open settings menu |
| 2 | `model` | | `<provider/model>` — Select model (opens selector UI) |
| 3 | `tree` | | Navigate session tree (switch branches) |
| 4 | `thinking` | | `<level>` — Set thinking level |
| 5 | `scoped-models` | | Enable/disable models for Ctrl+P cycling |
| 6 | `skills` | | Browse and run a skill |
| 7 | `theme` | | `<name>` — Change the color theme |
| 8 | `export` | | Export session (HTML default, or specify path: .html/.jsonl) |
| 9 | `import` | | Import and resume a session from a JSONL file |
| 10 | `share` | | Share session via a Radius artifact or a GitHub gist |
| 11 | `bug` | | `<description> — Report a bug to the Pi developers |
| 12 | `copy` | | Copy last agent message to clipboard |
| 13 | `name` | | Set session display name |
| 14 | `stats` | | Show session info and stats |
| 15 | `changelog` | | Show changelog entries |
| 16 | `hotkeys` | | Show all keyboard shortcuts |
| 17 | `fork` | | Create a new fork from a previous user message |
| 18 | `clone` | | Duplicate the current session at the current position |
| 19 | `trust` | | Save project trust decision for future sessions |
| 20 | `login` | | `<provider> — Configure provider authentication |
| 21 | `logout` | | Remove provider authentication |
| 22 | `new` | | Start a new session |
| 23 | `compact` | | Manually compact the session context |
| 24 | `resume` | `history`, `sessions` | Resume a different session |
| 25 | `reload` | | Reload keybindings, extensions, skills, prompts, themes, and context files |
| 26 | `quit` | `exit` | Quit pi |

Each alias is its own row right after the command it points at, the way the
original's picker builds it (`interactive-mode.ts:722-733`), so the list reads
`resume, history, sessions` and `quit, exit`. The alias row carries the
command's description and **no** argument hint of its own.

The port keeps four aliases of its own, all off the list: `/q` (of `/quit`),
`/m` (of `/model`), `/think` (of `/thinking`) and `/session` (of `/resume`).
They are the port's own, not the original's.

### 1.3 The delta

| | Commands |
|---|---|
| **Original only** | `llama`, `mcp` — the original's built-in-extension commands. The port has neither feature, so it lists neither. |
| **Port only** | none in the list. (Off the list, the port still answers `/q`, `/m`, `/think` and `/session`, and it has its own hidden `/context`.) |
| **Both, different meaning** | `new` — the original **starts a new session** (`interactive-mode.ts:3068` → `:6914` `runtimeHost.newSession()`); the port answers `A new session is not created by this command yet; the current session continues.` — the port has no session-*create* entry point. |

---

## 2. Dispatch: what happens to a command the port does not have

| | |
|---|---|
| Original | every known command is matched by an exact `if (text === "/x")` chain (`interactive-mode.ts:2969-3119`); an **unmatched** `/foo` falls through to the prompt path and is sent to the model (`:3134-3195`) |
| Port | `dispatch_slash` (`rpi-cli/src/interactive_tui.rs:548-559`) returns `false` for an unknown token, so the text falls through to the agent prompt (`rpi-cli/src/interactive_tui.rs:1729-1740`) |

**The consequence is that a missing command is not an error — it is a
prompt.** Observed live with the mock model, before `/stats` landed:

* Port, `/stats` → the pane showed `/stats` echoed as a **user message** and
  the model's `Hello.` as the reply. The user asked for statistics and paid
  for a model call instead.
* Original, `/stats` → a `Session Stats` block (§4.6).

**Re-verified on the 18:48 green binary:** `/stats`, `/skills` and `/bug` have
landed, so they no longer reach the model. The behaviour remains for the
commands the port still does not have — `/history`, `/sessions`, `/llama`,
`/mcp`, and the original's unlisted `/debug`, `/arminsayshi` and
`/dementedelves` — and it is worth checking that a user typing one of them
does not silently pay for a model call.

**Check.** `PD_HOME=… node run.mjs <spec>` where the spec types `/history`,
Enter; assert the port's pane does **not** contain a `user` echo of `/history`.

---

## 3. The `/` autocomplete list

### 3.1 No `(n/m)` counter and no wrap-around

| | |
|---|---|
| Original | the list is a `SelectList` (`packages/tui/src/components/select-list.ts`) and prints the counter, e.g. `(1/31)` (`select-list.ts:128`); `↓` past the last entry wraps to the first |
| Port | the list is plain `Text` rows (`rpi-cli/src/interactive_tui/autocomplete.rs:54-118`) — no counter, no `SelectList`; `navigate_autocomplete` clamps at both ends (`:170-200`: `(*sel + 1).min(total.saturating_sub(1))`) |

**Worth saying precisely, because the port already has the piece:** the port's
`SelectList` *does* render the counter, in the same place and the same format
as the original — `rpi-tui/src/select_list.rs:682`
`let scroll_text = format!("  ({}/{})", *selected + 1, filtered.len());`
against the original's `select-list.ts:128`
`` const scrollText = `  (${this.selectedIndex + 1}/${this.filteredItems.length})`; ``

So the pickers that *do* use `SelectList` show `(n/m)`; the `/` command list
does not, because the autocomplete renders its own rows instead of going
through `SelectList`. The fix is to route the autocomplete through the same
widget, which would also give it the wrap-around for free (the `SelectList`
arrow handling already wraps) and the `SelectList` row theme.

**Observed live.** Original: `→ settings       Open settings menu` … `(1/31)`;
after 31 `↓` presses the selection is back on `settings` with `(1/31)`. Port:
the same five rows, **no counter line**, and `↓` stops on the last entry for
ever. Re-verified on the 18:48 binary: the port's list is now **33** entries
(§1.2) and it still prints no counter and still clamps on the last one
(`/stats`), while the original wraps.

**The port's `SelectList` already has the counter** — the login list shows
`(1/40)` — so the gap is only in the autocomplete path, and the fix above is
the whole of it.

### 3.2 No argument hints — **CLOSED**, re-verified on the 18:48 binary

| | |
|---|---|
| Original | `packages/tui/src/autocomplete.ts:338-346` merges the command's `argumentHint` into the description: `model   <provider/model> — Select model (opens selector UI)` |
| Port | **now the same.** The 18:48 binary shows `→ /model <provider/model> — Select model (opens selector UI)`, `/thinking <level> — Set thinking level`, `/theme <name> — Change the color theme`, `/login <provider> — Configure provider authentication`, `/bug <description> — Report a bug to the Pi developers` — the original's format, hint first, em-dash, then the description. |

### 3.3 No argument completions

| | |
|---|---|
| Original | `interactive-mode.ts:734-790` gives `model`, `thinking` and `login` a `getArgumentCompletions`; typing `/model ` opens a live list of the catalog: `→ mock-1    mock` |
| Port | no argument completions at all. Typing `/model ` leaves the command list in place (`→ /model Select model (opens selector UI)`) |

### 3.4 The list shows the leading slash — **CLOSED**

The original lists bare names (`settings`, `model`, `tree`); the port now does
too. The row's **label** is the bare name and the row's **value** keeps the
slash, so accepting a row still writes the name the dispatcher matches on
(`packages/tui/src/autocomplete.ts:352-360` uses the bare `cmd.name` as the
label). The captured panes agree:

```
→ settings       Open settings menu          (original)
→ settings       Open settings menu          (port)
```

### 3.5 Extension commands work on both sides

A `registerCommand("hello", …)` extension in `<agent dir>/extensions/hello.ts`
shows in **both** lists with the same description:

```
→ hello       Say hello from an extension          (original)
→ hello       Say hello from an extension          (port)
```

Original: `interactive-mode.ts:795-812`. Port: `commands.rs` (`register_extension_commands`).

---

## 4. What each command prints

The original's text is the reference. "Behaviour" means the command does
something different, not just that it says something different.

### 4.1 `/name` (no argument)

| | |
|---|---|
| Original | `Warning: Usage: /name <name>` — `interactive-mode.ts:6658-6665` |
| Port | `ℹ Usage: /name <display name> — sets the current session's name.` — `commands.rs:632` |

Severity (**Warning** vs an **info** note) and wording. With an argument both
set the session name; the original adds a normalisation warning when the name
is rewritten (`interactive-mode.ts:6672-6677`).

### 4.2 `/copy` with no assistant reply

| | |
|---|---|
| Original | `Error: No agent messages to copy yet.` — `interactive-mode.ts:6644` |
| Port | `ℹ Nothing to copy yet — no assistant reply captured.` — `rpi-cli/src/interactive_tui/run.rs:305` |

Severity (**error** vs **info**) and wording.

### 4.3 `/logout` with nothing stored

| | |
|---|---|
| Original | `No stored credentials to remove. /logout only removes credentials saved by /login; environment variables and models.json config are unchanged.` — `interactive-mode.ts:3063` → `showOAuthSelector("logout")` |
| Port | `ℹ No saved provider credentials found.` — `rpi-cli/src/interactive_tui/selectors.rs:700` |

The original's text explains **what `/logout` does not touch**; the port's does
not.

### 4.4 `/thinking <level>` — accepted and rejected levels

| | |
|---|---|
| Original | `interactive-mode.ts:5049-5062`: the level is validated against **the levels the current model supports**. `Unknown thinking level "bogus". Available levels: off.` / `Unknown thinking level "high". Available levels: off.` (the mock model has no `reasoning`, so `off` is the only level) |
| Port | `commands.rs:191-241`: validated against a **static** list of all seven levels. `✗ Unknown thinking level "bogus". Valid: off, minimal, low, medium, high, xhigh, max` and `/thinking high` **succeeds**: `ℹ Thinking set to high.` |

**Behaviour.** The root cause is the model metadata, not the command: the
original's `getSupportedThinkingLevels` returns `["off"]` when the model has no
`reasoning` flag (`packages/ai/src/models.ts:1236-1245`); the port's
`Model::supported_thinking_levels` ignores that flag and returns
`off, minimal, low, medium, high` for any model without a `thinking_level_map`
(`rpi/crates/rpi-ai/src/model.rs:344-364`). The same root cause makes the
port's thinking picker list five levels for a model that supports none.

### 4.4a The fix is one line, and it is the highest-value line in this document

`Model` **already has** the flag the port is ignoring — `pub reasoning: bool`
at `rpi/crates/rpi-ai/src/model.rs:290`, defaulting to `false` at `:323`. The
method's own doc comment (`:341-343`) claims it mirrors `getSupportedThinkingLevels`,
which is exactly the function that returns `["off"]` for a non-reasoning model.

```rust
pub fn supported_thinking_levels(&self) -> Vec<crate::types::ThinkingLevel> {
    use crate::types::ThinkingLevel::*;
    if !self.reasoning {
        return vec![Off];
    }
    let map = self.thinking_level_map.as_ref();
    …
}
```

That one condition fixes three user-visible symptoms at once:

1. the thinking picker stops offering `minimal`/`low`/`medium`/`high` for a
   model that cannot think (the original shows only `off` — captured in §5.2);
2. `/thinking high` on such a model is **rejected** with the original's wording
   instead of silently succeeding (§4.4);
3. `/model`'s and the thinking picker's level lists agree with the original's.

It is in the `rpi-ai` crate, so it is the provider/ai owner's line to land, and
it needs a test with it: a model with `reasoning: false` and no
`thinking_level_map` must report `["off"]`; a model with `reasoning: true` and
no map must still report the five levels.

**Check.** A test in `rpi-ai`: a model with `reasoning: false` and no
`thinking_level_map` must report `["off"]`.

### 4.5 `/export`

| | |
|---|---|
| Original | `interactive-mode.ts:6510-6527` — defaults to **HTML**; an in-memory session cannot be exported at all: `Error: Failed to export session: Cannot export in-memory session to HTML` |
| Port | `commands.rs:369-401` — defaults to **Markdown**; `/export` succeeds: `ℹ Exported session to /private/tmp/…/session.md`; `/export html` and `/export jsonl` are also accepted; an unknown format prints `Unknown export format: … Supported: md, html, jsonl` |

**Behaviour** (the default format and the in-memory refusal) and wording.

### 4.6 `/stats` versus `/usage`

| | |
|---|---|
| Original | `interactive-mode.ts:6683-6762` — a `Session Stats` block: `Name`, `File`, `ID`, `Messages` (Total / User / Assistant / Tools), `Tokens` (Input / Output / Total, plus the cached/uncached split with the hit rate), `Cache Warming` (Mode / Status), and `Cost` with a per-model breakdown |
| Port | `commands.rs:746-768` → `/usage` — a different block: `## Usage`, `messages`, `total tokens`, `cached tokens`, `uncached tokens`, `cost`, `cache hit ratio`, `last cumulative input/output`, `lane: main`, `leaf: (empty)` |

**No session id, no message breakdown, no cache-warming section, and the
internal `lane` / `leaf` identifiers are shown to the user.**

### 4.6a `/stats` is in the list, and it does **nothing** — re-verified on the green binary

This is worth calling out separately, because it is the one case where the port
is *worse* than having no command at all: the user sees `/stats` in the `/`
picker, types it, presses Enter, and **nothing happens** — no block, no error,
no status line, no feedback of any kind. The original prints the full
`Session Stats` block (§5.9).

**The cause is one line.** The command dispatches, and the message it sends is
swallowed by an empty handler arm:

* `rpi-crates/rpi-cli/src/interactive_tui/commands.rs:122-133` — `StatsCommand::execute` sends `TuiMessage::ShowStats`
* `rpi/crates/rpi-cli/src/interactive_tui.rs:3895` — **`Some(TuiMessage::ShowStats) => {}`** — the arm does nothing
* `rpi/crates/rpi-cli/src/interactive_tui.rs:3633` — `Some(TuiMessage::ShowUsage) => { … }` — the *sibling* arm, which is the one that works, and the one to copy

**Observed** (18:48 binary, mock provider): type `/stats`, Enter → the pane is
unchanged; the transcript is still empty below the header. The port's `/usage`
(the `ShowUsage` arm) does print its block, so the plumbing is there and the
gap is exactly that empty arm.

**Check.** Type `/stats`, Enter on both sides; the port must print the
original's `Session Stats` block — and the fastest way to get there is to
reuse the `ShowUsage` arm's body, since `/usage` already reads the same
session counters.

### 4.7 `/changelog`

| | |
|---|---|
| Original | `interactive-mode.ts:6764-6778` — header `What's New`, and it prints the **whole** changelog history (the entries are reversed so the newest is first) |
| Port | `commands.rs:82-95` → `rendering.rs:303-374` — header `Recent Changes` (or `Full Changelog` for `/changelog all`), and `/changelog` prints **only the latest release**; `/changelog all` prints the history |

The original's dispatcher matches `/changelog` **exactly**
(`interactive-mode.ts:3027`), so `/changelog all` in the original is *not* a
command and is sent to the model — the opposite of the port's behaviour.

### 4.8 `/new` — the name is the original's, the effect is not there yet

| | |
|---|---|
| Original | `interactive-mode.ts:3068` → `handleClearCommand` (`:6914`) → `runtimeHost.newSession()` — a **new session**: a new session id/file, and the footer's counters reset |
| Port | `commands.rs` (`NewSessionCommand`) → `TuiMessage::NewSession` → the transcript is not cleared and no session is created: the command answers `A new session is not created by this command yet; the current session continues. Use /session to switch to another one.` |

**Observed live.** After one prompt and then `/new`: the original's footer
reads `0.0% 0 tokens`; the port's still reads `0.0% 49 tokens`.

The name, the description and the dispatch are the original's now — the port
has no session-*create* entry point (`switch_to_session` opens an existing
session), so the effect is a session-area task, not a command-surface one.

### 4.9 `/help` — **CLOSED**

The original has **no** `/help` — it is not a command and is sent to the model.
The port had one (an `📚 Available Commands` table) and it is gone: `/help` and
`/?` are no longer registered, so they are ordinary messages again and reach
the model, like the original's. The original's help is the expanded startup
screen (Ctrl+O) and the `/hotkeys` table.

### 4.10 `/hotkeys`

The port's list is a live, registry-driven markdown table
(`rpi-cli/src/interactive_tui/rendering.rs`: `**Navigation**`, `**Editing**`,
`**Other**`, `| Key | Action |`), which is the original's shape
(`interactive-mode.ts:6799-6905`).

**The `Extensions` section is landed.** The renderer appends it when the
loaded extensions registered shortcuts, exactly as the original does
(`interactive-mode.ts:6892-6903`): the `**Extensions**` heading, the
`| Key | Action |` table, the capitalised key and the shortcut's description
— or the extension it belongs to when the shortcut has none. The list reaches
the renderer from the extension registry's snapshot
(`interactive_tui.rs`: `CommandContext::extension_shortcuts`).

**Still open on this table:** the JS (Bun) extension host keeps
`registerShortcut` calls in a JS-side map and never exports them to the host,
so a JS extension's shortcut does not reach the table; and the extension shown
in the fallback column is its display name, not its path, because the native
plugin API only carries the name.

### 4.11 `/trust`

| | |
|---|---|
| Original | `interactive-mode.ts:3052` → `components/trust-selector.ts:37-134` — a themed **panel**: the cwd, `Saved decision: none`, `Current session: trusted`, and three options (`Trust`, `Trust parent folder (<dir>)`, `Do not trust`) with a ✓ on the saved one and the hint `↑↓ navigate  enter save  escape/ctrl+c cancel` |
| Port | `commands.rs:582-617` — `/trust` takes `yes\|no\|clear`; with no argument it **writes the decision immediately** and prints `ℹ Current project marked trusted.` There is no panel and no "Trust parent folder" option |

**Behaviour.** Also recorded in `INTERACTIVE-MODE.md` §14.

### 4.12 `/login`

| | |
|---|---|
| Original | `interactive-mode.ts:3057` → `handleLoginCommand` (`:5844`) → `showLoginAuthTypeSelector` (`:5878`) — a **first step** listing the authentication methods: `Select authentication method:` / `→ Sign in with an account` / `  Sign in with an API key` / `  Sign in with Radius • not configured`. The provider list comes after that, with the `[subscription]` / `[API key]` label column and the `✓ configured` / `• not configured` status column (`components/oauth-selector.ts:19-45`) |
| Port | `commands.rs:445-540` → `open_login_provider_selector` (`selectors.rs:626`) — goes **straight to the provider list**, with no auth-method step and no auth-type or status columns |

**Behaviour** (the missing first step) and wording. Also in
`INTERACTIVE-MODE.md` §15.

### 4.13 Commands that are identical

`/settings`, `/model`, `/tree`, `/thinking` (no argument), `/scoped-models`,
`/theme` (no argument), `/import`, `/share`, `/fork`, `/clone`, `/compact`,
`/reload`, `/quit`, `/exit` all reach the same feature on both sides; the
differences are in the picker chrome (see `INTERACTIVE-MODE.md` §12–§15), not in
the dispatch. `/quit` and `/exit` both terminate the app
(`commands.rs:44-66` → `TuiMessage::Exit` → `rpi-cli/src/interactive_tui.rs:3264`).

---

## 5. The screens, verbatim

Captured live, 100×30 pane, frozen clock, mock provider `mock/mock-1`. These
are the **original's** screens; the porters should work from this text.

### 5.1 The original's `/model` picker

```
  Only showing models from configured providers. Use /login to add providers.
> Search
→ ✓ mock-1                        [mock]
  Model catalogs refreshed.
  Enter to select · Ctrl+S to set as default · Escape/Ctrl+C to cancel
```

### 5.2 The original's `/thinking` picker

```
  Thinking Level
> Search
→ ✓ off                           No reasoning
  Enter to select · Ctrl+S to set as default · Escape/Ctrl+C to cancel
```

### 5.3 The original's `/theme` picker

```
  Theme
> Search
→ system                          (current)
  dark
  light
  Type to search · enter select · escape/ctrl+c cancel
```

### 5.4 The original's `/settings` menu

```
────────────────────────────────────────────────────────────────────────────
>
→ Auto-compact                      true
  Auto-resize images                true
  Block images                      false
  Skill commands                    true
  Show hardware cursor              false
  Editor padding                    0
  Output padding                    1
  Nerd Font glyphs                  false
  Autocomplete max items            5
  Autocomplete position             above
  (1/35)

  Automatically compact context when it gets too large

  Type to search · Enter/Space to change · Esc to cancel
────────────────────────────────────────────────────────────────────────────
```

### 5.5 The original's `/scoped-models` picker

```
────────────────────────────────────────────────────────────────────────────
Model Configuration
Session-only. Ctrl+S to save to settings.

>

→ ✓ mock-1 [mock]

  Model Name: Mock Model

  Model catalogs refreshed.
  Enter toggle · Ctrl+A all · Ctrl+X clear · Ctrl+P provider · Option+Up/Option+Down reorder ·
Ctrl+S save · all enabled
────────────────────────────────────────────────────────────────────────────
```

### 5.6 The original's `/trust` panel

```
────────────────────────────────────────────────────────────────────────────
 Project trust
 /private/tmp/cmdparity/work

 Saved decision: none
 Current session: trusted

 →   Trust
     Trust parent folder (/private/tmp/cmdparity)
     Do not trust

 ↑↓ navigate  enter save  escape/ctrl+c cancel
────────────────────────────────────────────────────────────────────────────
```

### 5.7 The original's `/login` first step

```
  Select authentication method:
> Search
→ Sign in with an account
  Sign in with an API key
  Sign in with Radius • not configured
↑↓ navigate  enter select  escape/ctrl+c cancel
```

### 5.8 The original's `/logout` with nothing stored

```
 No stored credentials to remove. /logout only removes credentials saved by /login; environment
 variables and models.json config are unchanged.
```

### 5.9 The original's `/stats`

```
 Session Stats

 File: In-memory
 ID: 01a15b3f-7595-74ca-96ee-030210025512

 Messages
 Total: 0
 User: 0
 Assistant: 0
 Tools: 0 calls, 0 results

 Tokens
 Input: 0
 Output: 0
 Total: 0

 Cache Warming
 Mode: streaming
 Status: Inactive (waiting for first request)
```

### 5.10 The original's `/` list, the whole 31 entries

```
→ settings       Open settings menu
  model          <provider/model> — Select model (opens selector UI)
  tree           Navigate session tree (switch branches)
  thinking       <level> — Set thinking level
  scoped-models  Enable/disable models for Ctrl+P cycling
  skills         Browse and run a skill
  theme          <name> — Change the color theme
  export         Export session (HTML default, or specify path: .html/.jsonl)
  import         Import and resume a session from a JSONL file
  share          Share session via a Radius artifact or a GitHub gist
  bug            <description> — Report a bug to the Pi developers
  copy           Copy last agent message to clipboard
  name           Set session display name
  stats          Show session info and stats
  changelog      Show changelog entries
  hotkeys        Show all keyboard shortcuts
  fork           Create a new fork from a previous user message
  clone          Duplicate the current session at the current position
  trust          Save project trust decision for future sessions
  login          <provider> — Configure provider authentication
  logout         Remove provider authentication
  new            Start a new session
  compact        Manually compact the session context
  resume         Resume a different session
  history        Resume a different session
  sessions       Resume a different session
  reload         Reload keybindings, extensions, skills, prompts, themes, and context files
  quit           Quit pi
  exit           Quit pi
  llama          Manage llama.cpp router models
  mcp            Manage MCP servers: sign in, reconnect, enable or disable, and change exposure
  (1/31)
```

### 5.11 The port's screens today, for comparison

Re-captured on the **18:48 green binary**. Where the two agree, nothing is
listed; the block below is what is **still different**.

```
/model picker
Select model                                          ← the original: "Only showing models from configured providers. Use /login to add providers."
Type to filter by name, provider, or id               ← the original has a "> Search" input
>
→ ✓ mock-1                        [mock]              ← SAME as the original (this row now matches)

/thinking picker
→ off                             No reasoning        ← the original: "✓ off   No reasoning" (the ✓ is missing)

/theme picker
→ Dark                            Default dark theme  ← the original: "system (current)" / "dark" / "light"
  Light                           Light background
  Monochrome                      No color accents

/settings menu
>
→ Auto-compact                      true               ← the original's screen, character for character
  Auto-resize images                true
  Block images                      false
  Skill commands                    true
  Show hardware cursor              false
  Editor padding                    0
  Output padding                    1
  Nerd Font glyphs                  false
  Autocomplete max items            5
  Autocomplete position             above
  (1/35)

  Automatically compact context when it gets too large

  Type to search · Enter/Space to change · Esc to cancel

/scoped-models picker
→ mock-1                          ← the original: "Model Configuration" + "Session-only. Ctrl+S to save to settings."
                                     + "✓ mock-1 [mock]" + "Model Name: Mock Model" + the refresh status
                                     + "Enter toggle · Ctrl+A all · Ctrl+X clear · Ctrl+P provider ·
                                     Option+Up/Option+Down reorder · Ctrl+S save · all enabled"

/trust
   ℹ Current project marked trusted.   ← the original: the "Project trust" panel with Trust /
                                         Trust parent folder / Do not trust, the cwd, the saved
                                         decision and the current session

/login
Log in to provider                      ← the original: "Select authentication method:" first
Type to filter providers · Enter selects · Esc cancels
>
→ ant-ling                        Not configured · API key / ANT_LING_API_KEY
  Anthropic                       Not configured · API key / ANTHROPIC_API_KEY
  …                                    ← the original: "• not configured" + a [subscription]/[API key] column
  (1/40)

/logout
   ℹ No saved provider credentials found.   ← the original: the two-line "No stored credentials to remove…"

/stats
(nothing at all)                    ← the original: the full "Session Stats" block
```

## 6. Checks

Each row is a runnable check. `PD_HOME` and `PD_SOCKET` must be unique per
runner.

```sh
cd /tmp/pdrive
PD_HOME=/tmp/<you> PD_SOCKET=pi-<you> node run.mjs /tmp/<you>.json
```

| # | Check | Expectation |
|---|---|---|
| 1 | type `/`, then `↓` 29 times, capture at each step | the original shows `(1/31)` and wraps to `settings`; the port shows `(1/29)` and wraps to `settings` — the two entries it lacks are `llama` and `mcp` |
| 2 | type `/model ` (with the trailing space) | the original opens a completion list (`→ mock-1   mock`); the port does not |
| 3 | type `/stats`, Enter | the original prints `Session Stats`; the port echoes `/stats` as a user message and calls the model |
| 4 | type `/thinking high`, Enter | the original errors (`Available levels: off.`); the port sets it (`Thinking set to high.`) |
| 5 | open `/model`, press `Ctrl+S` | the original closes the picker and prints `Default model: mock/mock-1`; the port does nothing |
| 6 | type `/logout`, Enter | the original prints the two-line "No stored credentials to remove…" explanation; the port prints one info line |
| 7 | type `/copy` with no reply | the original prints an **Error**; the port prints an **info** note |
| 8 | type `/help`, Enter | the original sends it to the model; the port does the same — `/help` is not a command on either side |
| 9 | type `/hotkeys`, Enter | the original's table has the `Extensions` section; the port's does too, for the extensions that register shortcuts natively |
| 10 | a unit test in `rpi-ai`: a model with `reasoning: false` and no `thinking_level_map` | `supported_thinking_levels()` returns `["off"]` |
| 11 | a unit test in `rpi-cli`: the autocomplete list | the counter `(n/m)` is present and `↓` wraps |
| 12 | a unit test in `rpi-cli`: `build_builtin_registry()` | the registry holds the original's 26 built-ins with the aliases `history`, `sessions`, `exit`; `llama` and `mcp` are the original's built-in-extension commands and the port has neither feature |
| 13 | a unit test in `rpi-cli`: `the_slash_list_is_the_originals_list` | the visible list is the original's 26 commands plus its three alias rows, in the original's order, with the original's descriptions and argument hints |
| 14 | a unit test in `rpi-cli`: `a_registered_command_never_reaches_the_model` | a registered command resolves; `/help`, `/?`, `/clear`, `/version`, `/v`, `/provider`, `/tools`, `/images` and `/usage` do not, so they reach the model |

---

## 7. What this document adds to the existing inventory

| Existing row | Status here |
|---|---|
| `LANGUAGE.md` §5 "The commands (what the autocomplete menu shows)" | **not duplicated here** — that row owns the descriptions. This document adds the *set* difference (§1), the *dispatch* of an unknown command (§2) and the autocomplete list's *mechanics* (§3) |
| `LANGUAGE.md` §6 "`/hotkeys`" | confirmed; §4.10 adds the three rows/sections the port's table is still missing |
| `INTERACTIVE-MODE.md` §2 "Slash-command set — differs" | confirmed and extended: the two alias-only commands (`history`, `sessions`), the two built-in-extension commands (`llama`, `mcp`), and the fact that `resume` is canonical in the original and a hidden alias in the port |
| `INTERACTIVE-MODE.md` §12 (model picker), §13 (menu framework), §14 (trust), §15 (OAuth/login) | confirmed; §5 above adds the **verbatim** screens |
| `INTERACTIVE-MODE.md` §25 (first-run dialog) | confirmed |
| `FEATURES.md` §7 "Hotkeys list — differs (hard-coded 17-row table)" | **out of date** — the port's list is now a live three-section table; only three rows/sections are missing (§4.10) |
| `FEATURES.md` §7 "First-time setup dialog — missing" | **out of date** — the port has one (`rpi-tui/src/first_run.rs`) |
| `FEATURES.md` §9 "Built-in slash-command set — differs" | confirmed and extended (§1) |
| new | §2 (an unknown command is a prompt, not an error), §3 (the autocomplete counter / wrap / hints / argument completions), §4 (every command's output text and severity), §5 (the verbatim screens) |
