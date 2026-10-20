# Transcript parity — audit findings

Scope: the rendered conversation history of the TypeScript original
(`/Users/gabriel/pi`, `packages/coding-agent/src/modes/interactive/`) against the
Rust port (`/Users/gabriel/pi-native`, `rpi/crates/rpi-tui/src/`,
`rpi/crates/rpi-cli/src/interactive_tui/`).

Auditor: `BehaviourParityAudit.TranscriptParity` (read-only; nothing in either
repo was modified). Harness: `/tmp/pdrive/drive.mjs` + `run.mjs`, plus a
scratch probe (`/tmp/transcript/probe2.mjs`) that runs the mock in a **child
process** so the event loop stays free while the harness blocks on tmux — the
in-tree harness starts the mock in-process, so the mock cannot answer while
`execFileSync`/`spawnSync` block the loop, and the request count is 0.

The binary used was `/Users/gabriel/pi-native/rpi/target/debug/rpi` as built at
**18:04** on 2026-10-20. The tree was being rebuilt by other agents throughout
the audit, so every "reproduced" claim below was re-checked against that
18:04 binary.

Rows already present in `FEATURES.md` are marked **[in FEATURES.md]** so they
can be deduped.

---

## 1. The assistant reply is rendered TWICE (highest visibility)

**What the user sees.** After a single prompt, the transcript contains the
assistant's answer twice, with a blank line between the two copies. The
TypeScript original shows it once.

**TypeScript** — one component per assistant message, created on
`message_start` and updated in place:
`packages/coding-agent/src/modes/interactive/interactive-mode.ts:3352`
(`this.streamingComponent = new AssistantMessageComponent(...)`) and
`:3365` (`this.streamingComponent.updateContent(this.streamingMessage, true)`).
`message_end` at `:3420` updates the same component and clears
`this.streamingComponent` at `:3442`.

**Rust** — a *second* `AssistantMessageComponent` is created and appended to the
chat container, so both render:
`rpi/crates/rpi-cli/src/interactive_tui/events.rs:286` (`MessageStart` →
`transcript_view().apply(UiEvent::AssistantStart …)`) and
`rpi/crates/rpi-cli/src/transcript_view.rs:314` (`fn start_assistant` →
`self.chat.add_child(comp.clone())`).
The duplicate is produced by the reconcile path racing the stream drain:
`rpi/crates/rpi-cli/src/interactive_tui/run.rs:118`
(`let component = current_assistant.lock().unwrap().take();`) detaches the
live component from the shared slot, and a later
`MessageUpdate`/`MessageEnd` that arrives after that `take()` hits
`rpi/crates/rpi-cli/src/transcript_view.rs:332` (`fn ensure_assistant`), which
sees an empty slot and **creates a brand-new component**
(`transcript_view.rs:335-346`) and appends it to the chat container
(`transcript_view.rs:346`).

**How observed.** Spec `/tmp/transcript-1.json` — one mock turn of
`{type:"thinking", thinking:"Let me think about this carefully.", text:"Here is
the answer."}`; keys: literal `hello`, then `Enter`; settle 4000 ms; capture at
"settled". The pane is 100×30.

TypeScript (one copy):
```
 hello


 + Thought · 0.1s

 Here is the answer.
```
Rust (two copies):
```
 hello


 Let me think about this carefully.

 Here is the answer.

 Let me think about this carefully.

 Here is the answer.
```
Counting `grep -c "Here is the answer"` in the Rust "settled" pane over four
runs of the same spec gave **2, 1, 1, 2** — the duplication is a race, not
deterministic. The TypeScript side was 1 in every run. The same doubling was
seen with a plain text-only turn (spec `/tmp/transcript-2.json`): Rust showed
`Simple answer one.` twice in one run of the in-tree harness.

**Kind of difference:** behaviour (a duplicate block in the transcript), not
appearance. This is not in `FEATURES.md`.

---

## 2. Collapsed thinking summary is not shown; the raw reasoning is shown instead

**What the user sees.** With the default settings, the original collapses a
thinking run to a single `+ Thought · 0.1s` line. The port prints the whole
reasoning text, and it prints it twice (see finding 1).

**TypeScript** — `packages/coding-agent/src/modes/interactive/components/assistant-message.ts:114`
(`formatThoughtSummary` → `+ Thought · 3.7s`) and `:196` (the hidden branch
adds `new Text(this.formatThoughtSummary(runIndex, false), …)`).
Default `hideThinkingBlock` is **true**: `interactive-mode.ts:689`
(`this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();`) with
the setting default `true` in
`packages/coding-agent/src/core/settings-defaults.ts` (`hideThinkingBlock`).

**Rust** — `rpi/crates/rpi-tui/src/assistant_message.rs:367-392` implements the
same hidden/expanded branches, and
`rpi/crates/rpi-cli/src/interactive_tui.rs:921-923` reads the same
`hide_thinking_block` setting with the same default (`true`). But the host
overrides the component's own default when it creates the component:
`rpi/crates/rpi-cli/src/transcript_view.rs:317`
(`comp.set_hide_thinking(*self.hide_thinking.lock().unwrap())`) and
`:337` in `ensure_assistant` — and `rpi/crates/rpi-tui/src/assistant_message.rs:56`
(`AssistantMessageOptions::default()` → `hide_thinking: true`) is then
overridden by `set_hide_thinking`, which **clears** the per-run visibility
overrides and rebuilds (`assistant_message.rs:526-537`).

The visible result on the 18:04 binary is that the reasoning body is printed
instead of the `+ Thought · …` summary. **Kind of difference:** behaviour
(different content, different row count) — but the surrounding cause is the
`hide_thinking` plumbing, and the summary line itself *is* implemented in
`assistant_message.rs:100-115` (`format_thought_summary`) and reached from
`thought_summary` (`:459`). This one is close to the row
"Collapsed thinking summary '+ Thought · 3.7s', click to expand"
in `FEATURES.md` **[in FEATURES.md]**, but the *cause* on the current binary is
the host override, not the missing mouse event layer, so the fix is different.

---

## 3. `bash` tool panel: no duration row, different preview, different chrome

**What the user sees.** The original's bash panel shows a `Took 0.0s` line under
the output and a `$ command` header inside a bordered panel. The port's bash
panel has no duration row, and the tool panel is a plain indented block with a
`✓`/`✗` glyph and a `▸`/`▾` chevron that the original does not have.

**TypeScript** — the shell renderer draws the timer line:
`packages/coding-agent/src/core/tools/renderers/bash.ts:103-106`
(`renderResult` → `toolTimerText(context, options.isPartial)`) and
`packages/coding-agent/src/core/tools/render-utils.ts:166`
(`return \`Took ${formatToolDuration(context.durationMs)}\``).
The panel frame is `packages/coding-agent/src/modes/interactive/components/tool-execution.ts:107`
(`new Box(1, 1, (text) => theme.bg("toolPendingBg", text))`).

**Rust** — the timer line is emitted at
`rpi/crates/rpi-tui/src/tool_renderers.rs:754-764` (inside `ShellRenderer::render_result`),
but only when `ctx.duration_ms` is `Some`, and
`duration_ms` comes from `ToolExecutionComponent::elapsed_ms()`
(`rpi/crates/rpi-tui/src/tool_execution.rs:691-698`), which requires **both**
`started_at` and `finished_at` to be set. The port's own bash path
(`BashExecutionComponent`) is a *different* component with its own status line
(`rpi/crates/rpi-tui/src/bash_execution.rs:233-249`, `fn status_line`), which
only prints a duration when `elapsed > 100ms` and prints it as a bare `0.0s`
with no `Took` prefix.

Observed panes (spec `/tmp/transcript-3.json`, tool call
`bash {"command":"echo hello-from-tool"}`, keys: literal `run bash`, `Enter`):

TypeScript:
```
 $ echo hello-from-tool

 hello-from-tool

 Took 0.0s
```
Rust:
```
  $ echo hello-from-tool

  hello-from-tool
```
Note also the different indent (1 vs 2 columns) and the different blank-line
count around the panel. **Kind of difference:** behaviour — a whole row
(`Took 0.0s`) is present on one side and absent on the other. Partly
**[in FEATURES.md]** ("Bash execution panel with streaming output" /
"Tool call + tool result panel"), but the missing `Took` row is not called out
there.

---

## 4. `read` tool panel: the port prints a `│` gutter and an `args:` row the original does not

**What the user sees.** The original's read panel is a plain
`read <path>` header followed by the file content. The port's read panel adds a
`✓` status glyph, a duration, a `▸`/`▾` chevron, an `args: path=…` row, and
prefixes **every** output line with `│ `.

**TypeScript** — `packages/coding-agent/src/core/tools/renderers/read.ts:148-165`
(`readRenderers`): the call is `formatReadCall(args, theme, context.cwd)` and
the result is `formatReadResult(...)` — no gutter, no args row, no status
glyph.

**Rust** — the gutter is added at
`rpi/crates/rpi-tui/src/tool_execution.rs:580-584`
(`format!("{} {}", colors.dim.fg("│"), colors.tool_output.fg(part))`) and the
`args:` row + chevron + status glyph at
`rpi/crates/rpi-tui/src/tool_execution.rs:472-530` (`render_panel`).

**Important caveat — the cause is not yet pinned.** The Rust `read` tool **has**
a dedicated renderer (`rpi/crates/rpi-tui/src/tool_renderers.rs:492-507`,
`ReadRenderer::render_call`, registered in `builtin_renderer` at `:76`), and
`ToolExecutionComponent::new` picks it up
(`rpi/crates/rpi-tui/src/tool_execution.rs:126`). The generic `render_panel`
path is only reached when `has_renderer()` is false
(`rpi/crates/rpi-tui/src/tool_execution.rs:427-430`). The observed output came
from the *generic* path, so on the 18:04 binary the `read` renderer was not in
effect for this call. Two candidate causes, to be separated on a green build:
(a) the 18:04 binary predates the `tool_renderers.rs` wiring for `read`, or
(b) the host creates the component through a path that drops the renderer.
The **visible difference is confirmed either way**; only the fix site is open.

Observed panes (spec `/tmp/transcript/probe-read.json`, tool call
`read {"path":"sample.txt"}`, then `C-o` to expand):

TypeScript:
```
 read
 read sample.txt

 alpha
 bravo
 charlie
 Done.

 Tool output: expanded
```
Rust:
```
 read
  ✓ read sample.txt 0.0s ▾
  args: path=sample.txt
  │ alpha
  │ bravo
  │ charlie
  │
```
**Kind of difference:** behaviour (extra rows, extra glyph on every line).
Related to the "Tool call + tool result panel" row in `FEATURES.md`
**[in FEATURES.md]**, but the per-tool `read` renderer is not being used and
that specific cause is new.

---

## 5. `Ctrl+O` expand: the original announces the state, the port does not

**What the user sees.** After `Ctrl+O`, the original prints a `Tool output:
expanded` line in the dock. The port silently flips the chevron.

**TypeScript** — the expansion state is announced in the status line; the
original's `showStatus`/status-indicator path is at
`packages/coding-agent/src/modes/interactive/components/status-indicator.ts:9`
and the message is produced where the expand toggle is handled.

**Rust** — `rpi/crates/rpi-cli/src/interactive_tui/state.rs:1298-1301`
(`toggle_tool_outputs` → `self.transcript_view().set_expanded(next)`) flips
the flag and returns it, but nothing renders a notice;
`rpi/crates/rpi-cli/src/transcript_view.rs:225-241` (`set_expanded`) only
re-renders the panels.

**Kind of difference:** behaviour (a status line appears on one side only).
Not in `FEATURES.md`.

---

## 6. The port prints the tool-call *result* body twice for `read`

Already covered by finding 4 (the second `│` block is the result rendered a
second time under the args row). Not counted separately.

---

## 7. Transcript scroll: the port's `PageUp` does not scroll the transcript

**What the user sees.** In the original, `PageUp` scrolls the conversation
backwards. In the port the pane does not move.

**TypeScript** — `packages/coding-agent/src/modes/interactive/chat-viewport.ts:25`
(`new ScrollView(options.document, { follow: "end", primary: true, overscroll:
"chain", … })`); the alt-screen keybindings that drive it are
`packages/coding-agent/src/core/keybindings.ts:194` (`tui.altScreen.*`).

**Rust** — `rpi/crates/rpi-cli/src/interactive_tui.rs:1721-1723` (a new prompt
scrolls the primary view to the end) and the viewport lives in
`rpi/crates/rpi-cli/src/interactive_tui/state.rs:1342` (`transcript_view()`);
the scroll keys are handled in `rpi/crates/rpi-tui/src/keybindings.rs:620`
(alt-screen bindings).

**Observed.** Spec `/tmp/transcript-1.json` with steps
`pageup1 / pageup2 / pageup3` (keys `PageUp`) and `up1` (key `Up`): the
TypeScript pane changed between the "settled" and "pageup1" captures (the
transcript scrolled back — the leading `What's New` block moved off the top),
the Rust pane was **byte-identical** across all four scroll steps.

**Kind of difference:** behaviour. This overlaps the "Transcript viewport
(follow-end scroll)" row in `FEATURES.md` **[in FEATURES.md]**, but the row
says "identical"; on the 18:04 binary the scroll keys do not move the
transcript, so that row's verdict is wrong and should be re-checked.

---

## Checked and found identical

- **Block order within an assistant message** (text / thinking / tool call):
  the port keeps document order — `rpi/crates/rpi-cli/src/session_driver.rs:171`
  (`assistant_blocks` → `Vec<AssistantBlock>`) and
  `rpi/crates/rpi-tui/src/assistant_message.rs:340-430` (`rebuild_content`)
  match the TS loop at
  `packages/coding-agent/src/modes/interactive/components/assistant-message.ts:151-215`.
- **Thinking + text in one assistant message**: both sides render the
  thinking run and then the text in that order with one blank line between
  (visible in the finding-1 panes).
- **Tool call → tool result ordering**: the tool panel is appended between
  the user message and the assistant text on both sides
  (`interactive-mode.ts:3872` vs `transcript_view.rs:399`).
- **The user message bubble** renders the submitted text on its own line
  above the assistant reply on both sides.
- **Request count**: one provider request per prompt on both sides
  (probe request log: `REQ len=7592` for Rust, `REQ len=5757` for TS — the
  bodies differ in size because of the system prompt, but the count is 1 on
  both). So the duplication in finding 1 is a *rendering* bug, not a second
  model call.

## Not reached (ran out of time)

- Compaction summary card, branch summary card, custom/extension message
  cards — code-read only; not driven on the 18:04 binary. `FEATURES.md`
  already lists compaction and branch summaries as differing/missing, and the
  custom-message card as differing, so these need no new rows.
- Stop-reason notices (truncated / aborted / error): `FEATURES.md` already
  records the difference ("TS appends a short line after the partial content;
  Rust replaces the whole message with a '❌ …' line"). The Rust side is
  `rpi/crates/rpi-tui/src/assistant_message.rs:519-538` (`fn update_error`).
  Note: `update_error` is **never called** from `rpi-cli` (grep finds no
  caller), so the port's stop-reason line may never render at all — worth
  confirming on a green build.
- Transcript search overlay and jump-to-end: `FEATURES.md` already covers
  both (search differs, jump-to-end identical).
- Mouse-driven expand of a thinking block: `FEATURES.md` covers it; the port
  has no mouse event layer, so it is not reachable by a key.
