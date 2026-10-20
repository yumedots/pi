# The extension API: what the TypeScript original publishes, and what the port's host answers

The published contract is `packages/coding-agent/src/core/extensions/types.ts` (2304 lines)
plus `packages/coding-agent/src/core/extensions/index.ts` and the package entry
`packages/coding-agent/src/index.ts`.

The port serves that contract from three places:

| file | what it holds |
| --- | --- |
| `rpi/crates/rpi-js/js/extension-host.ts` | the bundled host that runs inside V8: the `pi` object, the `ctx` object, the `ctx.ui` object, the theme, the event dispatch |
| `rpi/crates/rpi-js/src/host.rs` | `ProcessHost` — the fallback host (process, fs, console, and 14 stub answers) |
| `rpi/crates/rpi-cli/src/js_extensions.rs` | `JsHost` — the CLI's own host. It answered 9 operations when this was measured (mode, theme, notify, status, widget, header, footer, git branch, extension statuses) and answers all 56 now |

The bundled host and `extension-host.ts` agree: the bundle at
`rpi/crates/rpi-js/js/extension-host.bundle.js` requested **56 distinct host operations** when
this was measured and requests **90** now; the `.ts` and the bundle always agree.

The check for that number is `rpi/crates/rpi-js/src/host.rs:274`: it reads the **bundle**,
collects every `hostCall("…")` the extension host makes, and asserts the fallback host answers
each one. A new operation cannot be added to the extension host without an answer for it. That
test is green (`cargo test -p rpi-js`).

## The numbers

**Where the port is now (2026-10-20, 18:45).** The JavaScript side of the boundary is the
original's: `ctx.ui` 28 of 28, `ctx.sessionManager` 15 of 15, the command context 7 of 7, the
tool context 2 of 2, the `pi` object 33 of 33, the theme 58 tokens and 18 methods with the
original's resets, and **all 90** host operations answered — the session-backed ones with the
session's real data. The check for the operation count is a test that reads the bundle
(`rpi/crates/rpi-js/src/host.rs:274`), and it is green.

**The remaining gap is the events.** Measured live on 2026-10-20 at 19:40, in one prompt run
with a tool call: **the original fires 23 of the 41 categories, the port fires 13** — and ten of
the forty-one still do not fire (section B.1), while three fire with a payload that has fewer
keys than the original's (`input` has no `streamingBehavior`, `tool_execution_end` has no
`durationMs`, `tool_result` has no `details` and no `usage`). The module surface is still short
(section I).

**And two calls freeze the port** rather than merely differ: a load-time `pi.registerProvider`
/ `registerMcpServer` / `registerVirtualModel`, and a dialog (`ctx.ui.select` and its
siblings) from an extension handler. Both are the same root cause — the JavaScript host's
`hostCall` is synchronous and the CLI answers those operations by waiting for the thread that is
blocked in the extension's call. The A/B test and the evidence are in "The baseline" below.

**What the audit found when it ran (2026-10-20, 17:57), which is the evidence for the rows
below.** The tree has moved since; the "what changed under us" table below says how.

- **56** host operations the bundled host asks for.
  - **10** were implemented: `context.mode`, `theme.get`, `ui.notify`, `ui.setStatus`,
    `ui.setWidget`, `ui.setHeader`, `ui.setFooter`, `footer.getExtensionStatuses`, `process.cwd`,
    `module.load`. (`theme.get` answered 11 of the original's 58 tokens when this was measured.)
  - **14** were answered with a constant stub: `model.get` → `null`, `model.getThinkingLevel` → `null`,
    `agent.getContextUsage` → `null`, `agent.getSystemPrompt` → `""`, `agent.isIdle` → `true`,
    `agent.isProjectTrusted` → `true`, `agent.hasPendingMessages` → `false`, `tools.getActive` → `[]`,
    `tools.getAll` → `[]`, `settings.get` → `{}`, `commands.get` → `[]`, `mcp.list` → `[]`,
    `session.getSessionName` → `null`, `footer.getGitBranch` → `null`.
  - **32** were not answered at all. The host threw
    `Error: unknown host operation: <op>` into the extension
    (`rpi/crates/rpi-js/src/host.rs:185`).
- **15** of the 33 `pi.*` methods existed in the port but threw when called.
- **35** of the 41 event categories never fired. The 6 that did were `session_start`, `agent_start`,
  `agent_end`, `turn_start`, `turn_end`, `input`; two of them carried degraded payloads.
- **8** members of `ctx.ui` were missing outright; **7** members of the command context were missing;
  **2** of the tool context's members were missing.
- The theme carried **11** of the original's **58** tokens and 2 of its 18 methods.
- The bundle that actually runs was out of step with `extension-host.ts` (see below).
- `@earendil-works/pi-coding-agent` exposes **10** of the original's **154** runtime exports;
  `@earendil-works/pi-tui` exposes **20** of **92**; `@earendil-works/pi-ai` exposes **1** of **67**.

`scripts/parity/EXTENSION-HOST.md` used to claim "the plugin API is therefore 1:1 by construction:
there is no translation layer, and nothing in the plugin contract can drift from the TypeScript
original". The types are pi's and do not drift; the host behind them drifts badly. The note has
been corrected.

## Read this before you measure anything

**The bundle is what runs, and it is a separate build step.**
`rpi/crates/rpi-js/src/runtime.rs:14` does `include_str!("../js/extension-host.bundle.js")` — the
binary embeds the **bundle**, not `extension-host.ts`. There is no `build.rs`; the bundle is
produced by a manual script that no CI workflow and no build script runs:

```sh
node scripts/build-extension-host-bundle.mjs
```

Editing `extension-host.ts` changes nothing until the bundle is rebuilt, and the bundle is
tracked in git. When this file was written, the two were 53 minutes out of step and the live
binary was still running the old host. Rebuild the bundle, rebuild the binary, and only then
measure.

**The tree moves.** The theme (section H) and the Node shims (section J) were rewritten by other
people while this audit was running. Every number here is dated; re-measure before you act on
it.

**What changed under us, and when.** Measured 2026-10-20 at 17:57 against
`rpi/target/debug/rpi`; the `.ts` was last written at 17:58, and the bundle at 17:04.

| what | the state this file describes (17:57) | the state now (18:30) |
| --- | --- | --- |
| `ctx.ui` | 20 of the original's 28 members (section D) | **all 28** — `getAllThemes`, `getTheme`, `setTheme`, `getToolsExpanded`, `setToolsExpanded`, `setWorkingIndicator`, `setEditorComponent`, `getEditorComponent` have been added |
| `ctx.sessionManager` | 2 of the original's 15 members (section A.2) | **all 15** — `getCwd`, `getSessionDir`, `getSessionId`, `getSessionFile`, `getLeafId`, `getLeafEntry`, `getEntry`, `getLabel`, `getBranch`, `buildContextEntries`, `buildSessionProjection`, `getHeader`, `getEntries`, `getTree`, `getSessionName` |
| the `pi` object | 33 members (all present, 15 of them throwing) | 33 members (all present) |
| the theme | 11 of 58 tokens, 2 of 18 methods (section H) | 58 tokens, 18 methods |
| the host operations | 10 implemented, 14 stub, 32 unanswered (section A) | **all 90 answered** (the bundle asks for 90 now, not 56), and the session-backed ones answer with the session's real data (`js_extensions.rs:492` onward, through `self.action(...)`, which is the native bridge's spawn-and-park pattern). The check is `rpi/crates/rpi-js/src/host.rs:274` — it reads the bundle and asserts every requested operation is answered. Green |
| the events | 6 of 41 fire (section B) | **13 of 41 fire**: `session_start`, `input`, `user_bash`, and the ten the new `rpi/crates/rpi-cli/src/js_emitter.rs` emits (`agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`). The bridge is `rpi/crates/rpi-extensions/src/event_sink.rs` — one process-wide sink, `emit_event(name, payload)` publishes pi's payload shape and the answer comes back for the events that carry a result |

So the shape of the remaining work is: **the host operations and the events.** The API surface
on the JavaScript side of the boundary is now the original's; what is behind it is not.

(Updated 18:25: the host operations are all answered and they answer with the session's real
data. What is left is **the events**: 13 of the 41 fire, 28 do not — and the three that matter
most are the three that carry a result, because without them an extension can only observe:
`tool_call` (the veto a permission extension needs), `context` (the message rewrite before each
LLM call) and `before_agent_start` (the system prompt override for a run). The bridge that
makes them possible already exists — `rpi/crates/rpi-extensions/src/event_sink.rs` — and the
native path already has the `before_tool_call` hook (`rpi-cli/src/session.rs:739`); it is wired
to the native session, not to the JavaScript host.)

## How this was measured

A probe extension is loaded into the bundled host and every API call is made and recorded.

```sh
# the original (bun, tmux) and the port (a live rpi in tmux), the same probe on both
cd /tmp/pi-ext-audit && node run.mjs ts      # -> report-ts.json
cd /tmp/pi-ext-audit && node run.mjs rust    # -> report-rust.json
node /tmp/pi-ext-audit/diff.mjs report-ts.json report-rust.json
```

The probe is `/tmp/pi-ext-audit/probe.ts`; the event probe is
`/tmp/pi-ext-audit/probe-events.ts` (`node run-events.mjs ts|rust`, then
`node diff-events.mjs events-ts.json events-rust.json`).

A scratch crate (`/tmp/pi-ext-audit/probe-crate`) drives the same bundled host with a host that
mirrors the CLI's `JsHost`, for when `rpi-cli` does not build:

```sh
cd /tmp/pi-ext-audit/probe-crate
CARGO_TARGET_DIR=/Users/gabriel/pi-native/rpi/target cargo build
PI_EXT_PROBE_OUT=/tmp/pi-ext-audit/jsreport-process.json \
  /Users/gabriel/pi-native/rpi/target/debug/probe-crate file
```

The end-to-end check is the parity suite's extension run:

```sh
node scripts/parity/extensions.mjs --all     # per extension: loads / takes effect (ts) / takes effect (rust)
```

---

# A. The 32 host operations that did not answer

> **All 56 are answered now (18:30).** The table below is the audit's evidence, kept because it
> is what the rows say and where the answers live. `js_extensions.rs:716-1010` routes the
> session-backed operations through `self.action(...)` (`:1075`), which spawns the call on the
> session's runtime and parks the V8 thread on the reply — the native plugin bridge's pattern,
> and the answer to the synchronous `hostCall` problem. The measurements that follow are the
> ones that say whether the answers carry the original's values.

Every one of these threw `Error: unknown host operation: <op>` inside the extension, aborting
the handler. The original answers all of them.

| operation | the original | the port | what the extension sees | check |
| --- | --- | --- | --- | --- |
| `session.sendMessage` | `types.ts:1731` `pi.sendMessage`; the runner writes the message into the session and, with `triggerTurn`, starts a run | `extension-host.ts:387-389` forwards it; no host answers | `{"ok":false,"error":"unknown host operation: session.sendMessage"}` | probe `pi.sendMessage`; parity `send-user-message.ts`, `file-trigger.ts` |
| `session.sendUserMessage` | `types.ts:1741` | `extension-host.ts:390-392` | `unknown host operation: session.sendUserMessage` | probe `pi.sendUserMessage`; parity `send-user-message.ts` |
| `session.appendEntry` | `types.ts:1747` (persisted, not sent to the LLM) | `extension-host.ts:393-395` | `unknown host operation: session.appendEntry` | probe `pi.appendEntry`; parity `entry-renderer.ts`, `tools.ts` |
| `session.setSessionName` | `types.ts:1754` | `extension-host.ts:396-398` | `unknown host operation: session.setSessionName` | probe `pi.setSessionName`; parity `session-name.ts` |
| `session.setLabel` | `types.ts:1760` | `extension-host.ts:400-402` | `unknown host operation: session.setLabel` | probe `pi.setLabel`; parity `bookmark.ts` |
| `session.exec` | `types.ts:1763` `pi.exec` (runs a command, returns `ExecResult`) | `extension-host.ts:403-404` | `unknown host operation: session.exec` | probe `pi.exec`; parity `interactive-shell.ts`, `git-checkpoint.ts` |
| `session.getBranch` | `core/session-manager.ts:255` `ctx.sessionManager.getBranch` | `extension-host.ts:323-326` | `unknown host operation: session.getBranch` | probe `ctx.sessionManager.getBranch()`; parity `custom-footer.ts` |
| `session.getEntries` | `core/session-manager.ts:259` `ctx.sessionManager.getEntries` | `extension-host.ts:323-326` | `unknown host operation: session.getEntries` | probe `ctx.sessionManager.getEntries()` |
| `session.shutdown` | `types.ts:358` `ctx.shutdown` (gracefully exits pi) | `extension-host.ts:340` | `unknown host operation: session.shutdown` | probe `ctx.shutdown`; parity `shutdown-command.ts` |
| `model.set` | `types.ts:1791` `pi.setModel` (returns `false` when the provider has no key) | `extension-host.ts:412` | `unknown host operation: model.set` | probe `pi.setModel`; parity `preset.ts` |
| `model.setThinkingLevel` | `types.ts:1800` (clamped to the model's capability) | `extension-host.ts:414-416` | `unknown host operation: model.setThinkingLevel` | probe `pi.setThinkingLevel`; parity `preset.ts` |
| `model.registerVirtual` | `types.ts:1911` `pi.registerVirtualModel` | `extension-host.ts:430-432` | `unknown host operation: model.registerVirtual` | probe `pi.registerVirtualModel`; parity `jev-router.ts` |
| `model.unregisterVirtual` | `types.ts:1914` | `extension-host.ts:433-435` | `unknown host operation: model.unregisterVirtual` | probe `pi.unregisterVirtualModel` |
| `tools.setActive` | `types.ts:1778` `pi.setActiveTools` (ignores unknown and `hidden` tools) | `extension-host.ts:408-410` | `unknown host operation: tools.setActive` | probe `pi.setActiveTools`; parity `tools.ts`, `dynamic-tools.ts` |
| `provider.register` | `types.ts:1858-1859` `pi.registerProvider` (base URL, models, `streamSimple`, `oauth`, `images`, `classifiers`, `refreshModels`) | `extension-host.ts:417-419` | `unknown host operation: provider.register` | probe `pi.registerProvider`; parity `custom-provider-anthropic/index.ts`, `debug-provider.ts` |
| `provider.unregister` | `types.ts:1874` | `extension-host.ts:420-422` | `unknown host operation: provider.unregister` | probe `pi.unregisterProvider` |
| `mcp.register` | `types.ts:1894` `pi.registerMcpServer` | `extension-host.ts:423-425` | `unknown host operation: mcp.register` | probe `pi.registerMcpServer`; parity `mcp` extensions |
| `mcp.unregister` | `types.ts:1897` | `extension-host.ts:426-428` | `unknown host operation: mcp.unregister` | probe `pi.unregisterMcpServer` |
| `agent.abort` | `types.ts:349` `ctx.abort` | `extension-host.ts:338` | `unknown host operation: agent.abort` | probe `ctx.abort`; parity `timed-confirm.ts` |
| `agent.compact` | `types.ts:362` `ctx.compact` | `extension-host.ts:342` | `unknown host operation: agent.compact` | probe `ctx.compact`; parity `trigger-compact.ts` |
| `ui.select` | `types.ts:151` `ctx.ui.select` (a modal list, returns the choice) | `extension-host.ts:305` | `unknown host operation: ui.select` | probe `ui.select`; parity `commands.ts`, `permission-gate.ts`, `project-trust.ts` |
| `ui.confirm` | `types.ts:154` | `extension-host.ts:306` | `unknown host operation: ui.confirm` | probe `ui.confirm`; parity `confirm-destructive.ts`, `timed-confirm.ts` |
| `ui.input` | `types.ts:157` | `extension-host.ts:307` | `unknown host operation: ui.input` | probe `ui.input`; parity `project-trust.ts` |
| `ui.editor` | `types.ts:240` (multi-line) | `extension-host.ts:308` | `unknown host operation: ui.editor` | probe `ui.editor`; parity `handoff.ts` |
| `ui.custom` | `types.ts:229-243` `ctx.ui.custom(factory, options)` — an overlay with keyboard focus, `overlay`/`overlayOptions`/`onHandle`, resolves to the factory's `done(result)` | `extension-host.ts:309-310`; and even if answered, `extension-host.ts:156-166` calls the factory as `factory(tuiStub(), theme, footerDataStub())` — no `done`, no `keybindings`, no overlay options | `unknown host operation: ui.custom` | probe `ui.custom`; parity `overlay-test.ts`, `question.ts`, `snake.ts` |
| `ui.setTitle` | `types.ts:211` (the terminal window/tab title) | `extension-host.ts:298` | `unknown host operation: ui.setTitle` | probe `ui.setTitle`; parity `titlebar-spinner.ts` |
| `ui.setWorkingMessage` | `types.ts:169` | `extension-host.ts:299` | `unknown host operation: ui.setWorkingMessage` | probe `ui.setWorkingMessage`; parity `working-message-test.ts` |
| `ui.setWorkingVisible` | `types.ts:172` | `extension-host.ts:300` | `unknown host operation: ui.setWorkingVisible` | probe `ui.setWorkingVisible` |
| `ui.setHiddenThinkingLabel` | `types.ts:185` | `extension-host.ts:301` | `unknown host operation: ui.setHiddenThinkingLabel` | probe `ui.setHiddenThinkingLabel`; parity `hidden-thinking-label.ts` |
| `ui.setEditorText` | `types.ts:234` | `extension-host.ts:302` | `unknown host operation: ui.setEditorText` | probe `ui.setEditorText`; parity `handoff.ts`, `rpc-demo.ts` |
| `ui.getEditorText` | `types.ts:237` | `extension-host.ts:303` | `unknown host operation: ui.getEditorText` | probe `ui.getEditorText` |
| `ui.pasteToEditor` | `types.ts:231` (triggers the paste handling, collapses large content) | `extension-host.ts:304` | `unknown host operation: ui.pasteToEditor` | probe `ui.pasteToEditor`; parity `qna.ts` |

## A.2 The 14 stub answers

These do not throw, but they do not answer either. The extension gets a constant.

| operation | the original | the port answers | the extension sees | check |
| --- | --- | --- | --- | --- |
| `model.get` | `types.ts:339` `ctx.model` — the model object | `host.rs:173` → `null` | `null` | probe `ctx.model` must equal the model the session runs |
| `model.getThinkingLevel` | `types.ts:1794` | `host.rs:174` → `null` | `null` | probe `pi.getThinkingLevel` must be `"off"`/`"low"`/… |
| `agent.getContextUsage` | `types.ts:360`, `runner.ts:949` | `host.rs:178` → `null` | `null` | probe `ctx.getContextUsage` must be `{tokens, contextWindow, percent}`; parity `trigger-compact.ts` |
| `agent.getSystemPrompt` | `types.ts:364`, `runner.ts:957` | `host.rs:179` → `""` | `""` | probe `ctx.getSystemPrompt` must be the real prompt; parity `system-prompt-header.ts` |
| `agent.isIdle` | `types.ts:348`, `runner.ts:925` | `host.rs:175` → `true` | always `true` | probe `ctx.isIdle` during a run must be `false` |
| `agent.isProjectTrusted` | `types.ts:350`, `runner.ts:929` | `host.rs:176` → `true` | always `true` | probe `ctx.isProjectTrusted`; parity `project-trust.ts` |
| `agent.hasPendingMessages` | `types.ts:356`, `runner.ts:941` | `host.rs:177` → `false` | always `false` | probe `ctx.hasPendingMessages` |
| `tools.getActive` | `types.ts:1766` | `host.rs:180` → `[]` | `[]` | probe `pi.getActiveTools` must list the declared tools |
| `tools.getAll` | `types.ts:1769` (`ToolInfo[]` with exposure, namespace, annotations, sourceInfo) | `host.rs:181` → `[]` | `[]` | probe `pi.getAllTools`; parity `tools.ts`, `preset.ts` |
| `settings.get` | `types.ts:1772` (the merged effective settings) | `host.rs:182` → `{}` | `{}` | probe `pi.getSettings`; parity `tools.ts` |
| `commands.get` | `types.ts:1781` (`SlashCommandInfo[]`) | `host.rs:183` → `[]` | `[]` | probe `pi.getCommands`; parity `commands.ts` |
| `mcp.list` | `types.ts:1900` | `host.rs:184` → `[]` | `[]` | probe `pi.getMcpServers` |
| `session.getSessionName` | `types.ts:1757` | `host.rs:185` → `null` | `null` (the original answers `undefined`) | probe `pi.getSessionName` |
| `footer.getGitBranch` | `core/footer-data-provider.ts:127` | `js_extensions.rs:449` → `null` | always `null` | probe `ctx.ui.theme` + a custom footer; parity `custom-footer.ts` |

---

# B. The events

## B.0 The reference: what fires in one prompt run, and with which payload

The probe `probe-events.ts` subscribes to all 41 `on()` categories and records what arrives. On
the original, one run (a prompt that triggers a tool call and an answer) fires **23** of them,
with these payload keys:

| event | times | the payload keys the original sends |
| --- | --- | --- |
| `session_start` | 1 | `reason`, `type` |
| `resources_discover` | 1 | `cwd`, `reason`, `type` |
| `input` | 1 | `images`, `source`, `streamingBehavior`, `text`, `type` |
| `before_agent_start` | 1 | `images`, `messageType`, `prompt`, `systemPrompt`, `systemPromptOptions`, `type` |
| `agent_start` | 1 | `type` |
| `turn_start` | 2 | `timestamp`, `turnIndex`, `type` |
| `message_start` | 5 | `message`, `type` |
| `message_update` | 10 | `assistantMessageEvent`, `message`, `type` |
| `message_end` | 5 | `message`, `type` |
| `context` | 2 | `messages`, `type` |
| `context_with_system` | 2 | `messages`, `type` |
| `before_provider_headers` | 2 | `headers`, `type` |
| `before_provider_request` | 2 | `payload`, `type` |
| `after_provider_response` | 2 | `headers`, `status`, `type` |
| `provider_stream_event` | 8 | `api`, `data`, `model`, `provider`, `type` |
| `tool_execution_start` | 1 | `args`, `toolCallId`, `toolName`, `type` |
| `tool_call` | 1 | `input`, `toolCallId`, `toolName`, `type` |
| `tool_result` | 1 | `content`, `details`, `input`, `isError`, `toolCallId`, `toolName`, `type`, `usage` |
| `tool_execution_end` | 1 | `durationMs`, `isError`, `result`, `toolCallId`, `toolName`, `type` |
| `turn_end` | 2 | `context`, `continue`, `entries`, `message`, `messageEntryId`, `outcome`, `toolResultEntryIds`, `toolResults`, `turnIndex`, `type` |
| `agent_end` | 1 | `messages`, `type` |
| `agent_before_settle` | 1 | `context`, `continue`, `entries`, `outcome`, `type` |
| `agent_settled` | 1 | `aborted`, `type` |

The other 18 need their own flows (a session switch, a fork, a compaction, a tree navigation, a
model change, a `!command`, a trust prompt, a blocking dialog, a cache-warming decision), and
each has its own payload in `types.ts`. The reference for those is the table in `types.ts`, not
this run.

**The check:** the same probe on the port must fire the same 23 with the same payload keys, and
the 18 that need their own flow must fire when that flow runs.

## B.1 The categories that never fire

The original publishes 41 `on(event: "…")` overloads (`types.ts:1597-1664`) and the same 41 in the
`ExtensionEvent` union (`types.ts:1405-1440`).

**When this was measured (17:57) the port dispatched 6** — `session_start`, `input`,
`agent_start`, `agent_end`, `turn_start`, `turn_end`
(`interactive_tui.rs:1255`, `interactive_tui/events.rs:198, 207, 245, 271`,
`js_extensions.rs:337`) — and 35 never fired.

**Now (18:30) it dispatches 13**, through the new
`rpi/crates/rpi-cli/src/js_emitter.rs` and the sink in
`rpi/crates/rpi-extensions/src/event_sink.rs`: `session_start`, `input`, `user_bash`,
`agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update`,
`message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`.

These **28** still never fire, and therefore are invisible to any extension:

`project_trust`, `resources_discover`, `mcp_servers_change`, `session_info_changed`,
`session_before_switch`, `session_before_fork`, `session_before_compact`, `session_compact`,
`session_compact_failed`, `session_shutdown`, `session_before_tree`, `session_tree`, `context`,
`context_with_system`, `cache_warming_decision`, `before_provider_request`,
`before_provider_headers`, `after_provider_response`, `provider_stream_event`,
`before_agent_start`, `agent_before_settle`, `agent_settled`, `ui_prompt_start`, `ui_prompt_end`,
`model_select`, `thinking_level_select`, `tool_call`, `tool_result`.

The consequences the original relies on:

- `tool_call` / `tool_result` are how a permission extension blocks or rewrites a tool call
  (`types.ts:1454-1462` `ToolCallEventResult.block`). Without them nothing can be blocked.
  Parity: `permission-gate.ts`, `protected-paths.ts`, `dirty-repo-guard.ts`.
  The native path already has the hook (`rpi-cli/src/session.rs:739` `before_tool_call`); it is
  wired to the native session, not to the JavaScript host.
- `context` is how an extension rewrites the messages before each LLM call
  (`types.ts:885-891`). Parity: `prompt-customizer.ts`.
- `session_before_switch` / `session_before_fork` / `session_before_compact` / `session_before_tree`
  are the cancellable boundaries. Parity: `handoff.ts`, `plan-mode/index.ts`.
- `before_agent_start` is how an extension replaces the system prompt for a run
  (`types.ts:936-950`). Parity: `system-prompt-header.ts`, `prompt-customizer.ts`.
- `ui_prompt_start` / `ui_prompt_end` are emitted around every blocking dialog
  (`runner.ts:589-613`). The port cannot raise them, because it cannot raise a dialog at all.
- `resources_discover` is what lets an extension add skill, prompt and theme paths after
  `session_start` (`types.ts:727-737`). Parity: `dynamic-resources/`.

**The check:** a probe extension that subscribes to all 41 names and records which ones fire.
The original fires them from the real flows; the port must fire the same set from the same
points. The parity suite's per-extension "takes effect" column is the coarse version of the
same check.

## B.2 The six that fire, and their payloads

| event | the original | the port | the difference | check |
| --- | --- | --- | --- | --- |
| `session_start` | `types.ts:755-761` — `reason: "startup"\|"reload"\|"new"\|"resume"\|"fork"`, plus `previousSessionFile` | `interactive_tui.rs:1256` — always `{"type":"session_start","reason":"startup"}` | `reason` is never anything else; there is no `previousSessionFile` | probe: the reason must follow the session lifecycle |
| `agent_start` | `types.ts:960-962` — `{type}` | `events.rs:201` — `{type}` | none | — |
| `agent_end` | `types.ts:965-968` — `{type, messages: AgentMessage[]}` | `events.rs:210` — `{"type":"agent_end","messages":[]}` | `messages` is always empty | probe: the messages of the run must be there |
| `turn_start` | `types.ts:1058-1062` — `{type, turnIndex, timestamp}` | `events.rs:245-252` — same | none | — |
| `turn_end` | `types.ts:1065-1074` — `BoundaryState` (`entries`, `continue`, `context`, `outcome`) plus `message`, `toolResults`, `messageEntryId`, `toolResultEntryIds` | `events.rs:271-278` — `{type, turnIndex, timestamp}` | every field but the three is missing | probe: `entries`/`outcome` must be there; parity `custom-compaction.ts` |
| `input` | `types.ts:1171-1181` — `{type, text, images?, source: "interactive"\|"rpc"\|"extension", streamingBehavior?}` | `js_extensions.rs:337` — source `"user"`, no `streamingBehavior`, `images: null` | `source` is outside the published enum; `streamingBehavior` is missing | probe `input`; parity `input-transform.ts`, `input-transform-streaming.ts` |

---

# C. The `pi.*` methods that throw

Fifteen of the thirty-three `pi.*` methods exist in the port
(`extension-host.ts:362-436`) and throw when called. Grouped by what they need:

| group | methods | the operation each needs | the original |
| --- | --- | --- | --- |
| the session | `sendMessage`, `sendUserMessage`, `appendEntry`, `setSessionName`, `setLabel`, `exec` | `session.sendMessage`, `session.sendUserMessage`, `session.appendEntry`, `session.setSessionName`, `session.setLabel`, `session.exec` | `types.ts:1731-1763` |
| the model | `setModel`, `setThinkingLevel` | `model.set`, `model.setThinkingLevel` | `types.ts:1791-1800` |
| the tools | `setActiveTools` | `tools.setActive` | `types.ts:1778` |
| the providers | `registerProvider`, `unregisterProvider` | `provider.register`, `provider.unregister` | `types.ts:1858-1874` |
| the MCP servers | `registerMcpServer`, `unregisterMcpServer` | `mcp.register`, `mcp.unregister` | `types.ts:1894-1897` |
| the virtual models | `registerVirtualModel`, `unregisterVirtualModel` | `model.registerVirtual`, `model.unregisterVirtual` | `types.ts:1911-1914` |

The other fifteen (`on`, `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`,
`getFlag`, `registerMessageRenderer`, `registerMarkdownTransformer`, `registerEntryRenderer`,
`registerToolRenderer`, `getActiveTools`, `getAllTools`, `getSettings`, `getCommands`,
`getSessionName`, `getMcpServers`, `getThinkingLevel`, `events`) do not throw — but seven of them
answer a stub (section A.2) and five of the registrations have no effect (section E).

**The check:** the probe calls each of the 21 and records `{"ok":false,"error":"unknown host
operation: X"}`. The port must answer the same way the original does
(`report-ts.json` is the reference).

---

# D. `ctx.ui`: eight members missing, two no-ops

> **Changed under us.** All 28 members of the original's `ExtensionUIContext` are now on the
> JavaScript side of the boundary (`extension-host.ts`, 17:58). What is still missing is the
> **host** behind them: `ui.select`, `ui.confirm`, `ui.input`, `ui.editor`, `ui.custom`,
> `ui.setTitle`, `ui.setWorkingMessage`, `ui.setEditorText`, `ui.getEditorText` and
> `ui.pasteToEditor` still throw `unknown host operation` (section A), and `onTerminalInput` and
> `addAutocompleteProvider` are still no-ops.

The original's `ExtensionUIContext` (`types.ts:149-303`) has 28 members; the port's
(`extension-host.ts:267-313`) has 20.

Missing outright:

| member | the original | the port | check |
| --- | --- | --- | --- |
| `setWorkingIndicator(options)` | `types.ts:182` — frames, interval, `[]` hides the indicator | absent | probe `ui.setWorkingIndicator` → `is not a function`; parity `working-indicator.ts` |
| `setEditorComponent(factory)` | `types.ts:278` — replaces the editor; the factory gets `(tui, theme, keybindings)` | absent | probe; parity `modal-editor.ts`, `rainbow-editor.ts`, `border-status-editor.ts` |
| `getEditorComponent()` | `types.ts:281` | absent | probe |
| `getAllThemes()` | `types.ts:287` — every registered theme, with its file path | absent | probe; parity `mac-system-theme.ts` |
| `getTheme(name)` | `types.ts:290` | absent | probe |
| `setTheme(theme)` | `types.ts:293` — `{success, error?}` | absent | probe; parity `mac-system-theme.ts` |
| `getToolsExpanded()` | `types.ts:296` | absent | probe |
| `setToolsExpanded(expanded)` | `types.ts:299` | absent | probe |

Present but a no-op:

| member | the port | the original | check |
| --- | --- | --- | --- |
| `onTerminalInput(handler)` | `extension-host.ts:311` returns `() => undefined`; the handler is never called | `types.ts:163` — the raw keystrokes, with a consume flag | probe: a handler must receive keys; parity `snake.ts`, `space-invaders.ts`, `tic-tac-toe.ts` |
| `addAutocompleteProvider(factory)` | `extension-host.ts:312` returns `undefined`; the provider is never consulted | `types.ts:243` | probe; parity `github-issue-autocomplete.ts` |

## D.2 The objects a component is handed

| what | the original | the port | the consequence |
| --- | --- | --- | --- |
| the `tui` object | the real `TUI` (`packages/tui/src/tui.ts:117`) — a component can add children, request a repaint, read the terminal | `extension-host.ts:115-126` — a `Proxy` whose every property except `theme` is a function returning `undefined`; `requestRender` is a no-op | a component cannot ask for a repaint and cannot touch the screen |
| the theme | `theme.ts:222` | `extension-host.ts` — the original's 18 methods and 58 tokens | section H |
| the footer data | `core/footer-data-provider.ts:385-388` — `getGitBranch`, `getExtensionStatuses`, `getAvailableProviderCount`, `onBranchChange` | `extension-host.ts:128-147` — `getGitBranch` always `null` (`js_extensions.rs:449`), `getAvailableProviderCount` hard-coded `0` (`extension-host.ts:143`), `onBranchChange` a no-op | a custom footer always shows an empty branch and no providers |
| **the shape of `ctx.sessionManager`** | a class instance: **11** own enumerable properties (`byId`, `cwd`, `fileEntries`, `flushed`, `labelTimestampsById`, `labelsById`, `leafId`, `persist`, `sessionDir`, `sessionFile`, `sessionId`) and the 15 `ReadonlySessionManager` methods on the prototype | a plain object: **15** own enumerable properties, the methods | **not a missing method — but it is visible.** An extension that does `Object.keys(ctx.sessionManager)` sees the 15 method names on the port and 11 unrelated property names on the original; an extension that does `for (const k in ctx.sessionManager)` sees the original's 11 properties and the port's 15 methods. pi's own examples do not iterate it, but the difference is real and should be recorded rather than dismissed |
| **the shape of `ctx`** | 18 own properties (`ui`, `mode`, `hasUI`, `cwd`, `sessionManager`, `modelRegistry`, `model`, `scopedModels`, `thinkingLevel`, `isIdle`, `isProjectTrusted`, `signal`, `abort`, `hasPendingMessages`, `shutdown`, `getContextUsage`, `compact`, `getSystemPrompt`) | the same 18 **plus `extensionPath`** | an extra property; harmless, but it is what `Object.keys(ctx)` returns |

---

# E. Five registrations that are stored and never used

| registration | the original | the port | check |
| --- | --- | --- | --- |
| `registerShortcut` | `types.ts:1683-1689` — bound by the interactive mode, listed in `/hotkeys` | `extension-host.ts:368-370` writes `state.shortcuts`; nothing reads it | probe: the shortcut must fire; parity `preset.ts`, `plan-mode/index.ts` |
| `registerMessageRenderer` | `types.ts:1715` — the transcript draws the custom message | `extension-host.ts:375-377` writes `state.messageRenderers`; nothing reads it | probe; parity `message-renderer.ts`, `tic-tac-toe.ts` |
| `registerEntryRenderer` | `types.ts:1721` | `extension-host.ts:381-383` writes `state.entryRenderers`; nothing reads it | probe; parity `entry-renderer.ts` |
| `registerMarkdownTransformer` | `types.ts:1718` — applied to user and assistant markdown | `extension-host.ts:378-380` writes `state.markdownTransformers`; nothing reads it | probe |
| `registerToolRenderer` | `types.ts:1724` — chooses how a tool call is drawn | `extension-host.ts:384-386` writes `state.toolRenderers`; nothing reads it | probe; parity `built-in-tool-renderer.ts`, `truncated-tool.ts`, `tools.ts` |

Two more with the same shape:

- `ui.setFooter` — the component is stored (`js_extensions.rs:441-447`) but the Rust TUI has no
  footer slot; there is no `sync_js_footer` anywhere. The **header** slot does exist
  (`interactive_tui/extensions.rs:77 sync_js_header`, wired at `interactive_tui.rs:1862`).
  Parity: `custom-footer.ts`.
- `getFlag` — `extension-host.ts:374` returns the registered *default*; the original returns the
  value the CLI parsed (`loader.ts:375-378`, `core/agent-session-services.ts:107-111`). The port's
  CLI does not parse extension flags at all, so `--<flag>` is not even accepted.
  Parity: `preset.ts`, `ssh.ts`.

---

# F. The command context is absent

The original builds a command context with seven extra members
(`runner.ts:997-1030`, `types.ts:401-431`):

`getSystemPromptOptions`, `waitForIdle`, `newSession`, `fork`, `navigateTree`, `switchSession`, `reload`.

The port calls the command handler with the plain event context
(`extension-host.ts:545-556 runCommand` → `handler(args, createContext(state))`). Observed in the
command handler: every one of the seven is `undefined`. The original's
`ReplacedSessionContext` (`types.ts:442-456`, promise-returning `sendMessage`/`sendUserMessage`)
is missing for the same reason.

**The check:** the probe registers a command and records `typeof ctx.<member>` for the seven;
the port must answer `function`. Parity: `handoff.ts`, `reload-runtime.ts`.

---

# G. The tool context is absent, and the tool's own arguments are degraded

| member | the original | the port | the extension sees |
| --- | --- | --- | --- |
| `ctx.tools` | `types.ts:385`, `runner.ts:968-984` — the callable tools | absent | `undefined` |
| `ctx.executeTool(name, args, opts)` | `types.ts:394`, `runner.ts:978-996` — runs another tool with the same validation, hooks and permissions | absent | `undefined` |
| `signal` (argument 3 of `execute`) | `types.ts:651` — the run's abort signal | `extension-host.ts:11-23` types it `undefined` | `undefined` |
| `onUpdate` (argument 4 of `execute`) | `types.ts:651` — the streaming callback | typed `undefined` | `undefined` |
| `toolCallId` (argument 1 of `execute`) | a unique id per call | `extension-host.ts:486` passes the constant `"tool-call"` | `"tool-call"` |

**The check:** the probe's tool calls `execute` and records `typeof ctx.executeTool`,
`typeof ctx.tools`, `typeof signal`, `typeof onUpdate`. Parity: `codemode` style tools.

---

# H. The theme

> **Changed under us.** The theme was the port's worst gap when this was measured; it has since
> been rewritten. The token table now lives in `rpi/crates/rpi-js/src/theme.rs:94` `tokens()` and
> answers the shape the JavaScript side expects — `{fg, bg, colors, colorEnabled, name,
> sourcePath, appearance, colorMode}` — with **all 58** tokens, the foreground ones in `fg` and
> the background ones in `bg`. `rpi/crates/rpi-js/js/extension-host.ts` has the full `ThemeLike`:
> `fg`, `bg`, `bgStart`, `style`, `bold`, `italic`, `underline`, `inverse`, `strikethrough`,
> `colors`, `name`, `sourcePath`, `appearance`, `getFgAnsi`, `getBgAnsi`, `getColorMode`,
> `getThinkingBorderColor`, `getBashModeBorderColor` — the original's 18 methods, with the
> original's reset sequences (`\e[39m`, `\e[49m`).
>
> The live measurement now agrees: `ctx.ui` has all 28 members, `ctx.sessionManager` all 15, the
> theme all 18 methods, and `theme.fg` answers `\e[36mX\e[39m`.
>
> **The bundle is the trap.** `rpi/crates/rpi-js/src/runtime.rs:14` embeds
> `extension-host.bundle.js`, not `extension-host.ts`, and the bundle is a separate manual build
> step (`node scripts/build-extension-host-bundle.mjs`). CI now fails when the two are out of
> step, but a local measurement still has to rebuild it.

| | the original | the port |
| --- | --- | --- |
| the class | `theme.ts:222` — 18 methods | `extension-host.ts` `ThemeLike` — the same 18 |
| the tokens | `theme-tokens.ts:24` — **58** (49 foreground, 9 background) | `rpi-js/src/theme.rs:94` `tokens()` — **58**, in `fg` and `bg` |
| `fg("accent", "X")` | `\e[38;2;167;152;215mX\e[39m` | a colour with the right reset (`\e[36mX\e[39m` in the harness, the real accent in the port) |
| `bg("selectedBg", "X")` | `\e[48;2;33;59;73mX\e[49m` | a background colour with the right reset |
| `bold` / `style` / `colors` | present | present |

**The check:** rebuild the bundle, rebuild the binary, then the probe must answer
`theme.fg`, `theme.bg`, `theme.bold`, `theme.style` and `Object.keys(theme.colors).length` = 58,
with the escape sequences `report-ts.json` records.

---

# I. The module surface an extension can import

| module | the original | the port | the consequence |
| --- | --- | --- | --- |
| `@earendil-works/pi-coding-agent` | `packages/coding-agent/src/index.ts` — **154** runtime exports (`CustomEditor`, `createBashTool`, `createReadToolDefinition`, `BorderedLoader`, `DynamicBorder`, `CONFIG_DIR_NAME`, `getAgentDir`, `parseFrontmatter`, `ModelRegistry`, `ExtensionRunner`, `createEventBus`, …) | `extension-host.ts:1` maps it to **`core/extensions/types.ts`** — **10** exports (`defineTool` + 9 type guards) | 144 exports are `undefined`. `scripts/parity/out/extensions-report.md` already shows `built-in-tool-renderer.ts` failing with `TypeError: createReadToolDefinition is not a function` |
| `@earendil-works/pi-tui` | `packages/tui/src/index.ts` — **92** runtime exports (`Markdown`, `Spacer`, `SettingsList`, `Editor`, `Loader`, `Image`, `OverlayHandle`, `KeybindingsManager`, …) | `js/pi-tui.ts` — **20** | 77 exports are `undefined` |
| `@earendil-works/pi-ai` | `packages/ai/package.json` publishes `.`, `./models`, `./compat`, `./providers/*`, `./api/*`, `./utils/*`, `./oauth`, `./bedrock-provider`, `./bun-oauth` | `js/pi-ai.ts` exports `Type` only; `./compat`, `./oauth` and `./providers/all` all map to the same stub | a subpath that is not mapped **kills the whole extension**: `extension-host.ts:212` throws `cannot resolve "<spec>" from "<referrer>"`. Observed: `@earendil-works/pi-ai/providers/anthropic` → FAIL, `@earendil-works/pi-ai/utils/tokenizer` → FAIL |
| `@earendil-works/pi-agent-core` | `packages/agent/src/index.ts` — the agent loop, the agent events, the tool types | `js/pi-agent-core.ts` — `AGENT_RUNTIME_AVAILABLE = false` | an extension that drives its own agent cannot. Parity: `handoff.ts`, `plan-mode/`, `subagent/` |

**The check:** the probe imports each module and records `Object.keys(module).sort()`; the port
must answer the original's sets. The parity suite's "loads" column catches the fatal cases.

---

# J. The Node surface

`rpi/crates/rpi-js/src/node_surfaces.js:90-93` provides `node:fs`, `node:fs/promises`,
`node:path`, plus `process`, `performance`, `TextEncoder`, `TextDecoder`, `console`.

> **Partly changed under us.** `rpi/crates/rpi-js/js/shims/` now holds `node-os.ts`,
> `node-child-process.ts`, `node-perf-hooks.ts` and `node-url.ts`. They are **not reachable from
> an extension**: the extension's `require` goes through `resolveModule`
> (`extension-host.ts:360-366`), which resolves a builtin only if `globals.__piNodeModules` has
> it, and `node_surfaces.js:90-93` still lists only `node:fs`, `node:fs/promises`, `node:path`.
> The shims are in the *bundler's* alias table
> (`scripts/build-extension-host-bundle.mjs:34-42`), so they serve the bundle's own imports, not
> the extension's.

Still missing, and fatal at load time: `node:os` (`minimal-mode.ts`), `node:child_process`
(`interactive-shell.ts`), `node:events`, `node:readline`, `node:module`, the unprefixed `fs` /
`fs/promises` / `child_process`, and `process.stdout.write` (`notify.ts`).

**The check:** the probe imports each specifier and records whether the extension loads.

---

# K. The extension factory is not awaited

| | the original | the port |
| --- | --- | --- |
| the factory | `loader.ts:624` `await factory(load.api)`, then `load.commit()` | `extension-host.ts:470` `(factory as (api: unknown) => void)(createApi(state));` — the promise is dropped |
| a factory that registers after an `await` | the registration lands | **nothing lands** |

Observed: an extension whose factory registers a command and a tool after
`await new Promise(r => setTimeout(r, 10))` yields `ASYNC COMMANDS right after load: []` and
`ASYNC TOOLS right after load: []`, and still `[]` after a 200 ms pause and a further host call.
`ExtensionFactory` is typed `(pi) => void | Promise<void>` (`types.ts:2045`), so this is a
contract violation, not an edge case.

**The check:** the probe-crate's `async` mode; the port must list the command and the tool.

---

# L. The `ToolDefinition` contract and the loader's validation

The original's `ToolDefinition` (`types.ts:579-672`) has 20 fields; the port's
(`extension-host.ts:11-23`) has 5 — `name`, `label`, `description`, `parameters`, `execute`.
Dropped: `promptSnippet`, `promptGuidelines`, `constrainedSampling`, `renderShell`,
`prepareArguments`, `outputSchema`, `exposure`, `namespace`, `reachesTools`, `annotations`,
`defaultActive`, `prepareLoadout`, `executionMode`, `renderCall`, `renderResult`.

The original's loader also validates (`loader.ts:320-330`, `:337-344`, `:347-355`): a tool must
have an object parameter schema, a command must have a non-empty name and a `handler`, a flag's
default must match its type. The port stores whatever it is given.

**The check:** the probe registers a tool with every field and the port must keep them
(`getAllTools` must report the exposure, the namespace, the annotations, the prompt guidelines).

---

# M. The native plugin path already implements most of this

The port has a second extension surface: the native plugin ABI
(`rpi/crates/rpi-plugin-sdk/`, `rpi/crates/rpi-extensions/`). It is a different contract, but
the **host side** of it already implements almost every operation the JS host is missing, and
`rpi/crates/rpi-cli/src/extensions_actions.rs:351` (`impl RuntimeActionHost for HarnessActionHost`)
is the implementation the JS host should be routed to rather than re-written.

| the JS host's operation | the native action | the implementation |
| --- | --- | --- |
| `session.sendMessage` | `RuntimeActionId::SendMessage` | `extensions_actions.rs:430` |
| `session.sendUserMessage` | `SendUserMessage` | `:441` |
| `session.appendEntry` | `AppendEntry` | `:454` |
| `session.setSessionName` | `SetSessionName` | `:506` |
| `session.getBranch` | `GetSessionBranch` | `:483` |
| `tools.getActive` | `GetActiveTools` | `:516` |
| `tools.setActive` | `SetActiveTools` | `:525` |
| `model.set` | `SetModel` | `:534` |
| `model.getThinkingLevel` | `GetThinkingLevel` | `:546` |
| `model.setThinkingLevel` | `SetThinkingLevel` | `:555` |
| `agent.compact` | `Compact` | `:576` |
| `agent.getSystemPrompt` | `GetSystemPrompt` | `:588` |
| `newSession` (the command context) | `NewSession` | `:600` |
| `fork` (the command context) | `Fork` | `:614` |
| `navigateTree` (the command context) | `NavigateTree` | `:625` |
| `switchSession` (the command context) | `SwitchSession` | `:649` |
| `reload` (the command context) | `Reload` | `:661` — the only fallback: it errors unless the `/reload` callback is wired on the bridge |
| `ui.select` / `ui.confirm` / `ui.input` / `ui.editor` | `UiDialog` | the bridge's `UiDialogMailbox` (`rpi/crates/rpi-extensions/src/actions.rs`) |
| `ui.setStatus` | `SetStatus` | `ExtensionStatusMailbox` (`rpi/crates/rpi-extensions/src/status.rs`) |
| `ui.setEditorText` | `SetEditorText` | `EditorTextMailbox` (`rpi/crates/rpi-extensions/src/editor_text.rs`) |

The `RuntimeActionId` enum is `rpi/crates/rpi-plugin-sdk/src/lib.rs:1016-1060`; the dispatcher
that maps an id to the host is `rpi/crates/rpi-extensions/src/actions.rs:881-925`; the trait the
host implements is `rpi/crates/rpi-extensions/src/actions.rs:381`.

Two obstacles the JS host has to solve that the native path already solved:

- **The call is synchronous.** `hostCall` is synchronous
  (`rpi/crates/rpi-js/src/runtime.rs:265-300`): it calls the host on the V8 thread and takes a
  JSON string back. The native `RuntimeActionHost` methods are `async`; the native path bridges
  that with `Handle::spawn` and a channel (`rpi/crates/rpi-extensions/src/actions.rs:1040-1080`).
  The JS runtime already owns a thread and a request channel
  (`rpi/crates/rpi-cli/src/js_extensions.rs:281-366`), so the same shape fits.
- **The JS tools never reach the model.** The native path merges its tools into the model's tool
  set (`rpi/crates/rpi-cli/src/session.rs:1925`); the JS path does not, because the CLI never
  calls `__piExtensionHost.listTools` (`rpi/crates/rpi-js/src/runtime.rs:130` is the only
  caller). When it is wired, the JS tools have to reach `merge_extension_tools` too.

# N. The port's other extension surface

`rpi/crates/rpi-plugin-sdk/src/lib.rs:597-655` `EventTag` has 37 tags, of which **35** map to
TypeScript `on()` categories. Missing: `agent_before_settle`, `cache_warming_decision`,
`context_with_system`, `mcp_servers_change`, `provider_stream_event`, `session_compact_failed`.
Two extra tags (`BeforeTuiStart`, `EditorChange`) are rpi-only. `rpi/crates/rpi-extensions/src/`
is a cdylib ABI, not the TypeScript API: it shares no type, no event name and no registration
shape with `types.ts`.

**The decision (Main, 2026-10-20): the TypeScript contract is the published API.**
`packages/coding-agent/src/core/extensions/types.ts` is what pi publishes to extension authors, so
that is the surface the port has to match, and the compatibility suite is measured against it.

Two consequences:

- The native plugin ABI is an addition the port brings. It may stay and it may be documented, but
  it is not the contract the port is judged against, and it does not have to mirror the
  TypeScript one.
- Where the native path already answers more than the JavaScript host (section M), using it as
  the implementation underneath the JavaScript host is a legitimate shortcut **inside** the port.
  What is not acceptable is the native path being the only path that works: then the TypeScript
  contract stays unimplemented and an extension written against pi still fails.

**The acceptance test** is that an example extension from pi loads and behaves identically. That
is `node scripts/parity/extensions.mjs --all` over
`packages/coding-agent/examples/extensions/`, and it only exercises the TypeScript surface.

---

# The order of work

1. **The events.** 35 of 41 never fire, and an extension that subscribes to an event that never
   arrives is broken in a way no test of the API surface catches. Start with `tool_call`,
   `tool_result`, `message_start/update/end`, `context`, `before_agent_start`, `agent_settled`,
   `session_*`, `model_select`, `thinking_level_select`, `user_bash`, `ui_prompt_start/end`.
2. **The `pi.*` methods that throw**: the session (`session.*`), the model (`model.set`,
   `model.setThinkingLevel`), the tools (`tools.setActive`), the command context
   (`newSession`, `fork`, `navigateTree`, `switchSession`, `reload`, `waitForIdle`).
3. **The provider, MCP and virtual-model registration** (`provider.*`, `mcp.*`,
   `model.registerVirtual`, `model.unregisterVirtual`).
4. **The remaining host operations**: the dialogs (`ui.select`, `ui.confirm`, `ui.input`,
   `ui.editor`, `ui.custom`), the editor (`ui.setEditorText`, `ui.getEditorText`,
   `ui.pasteToEditor`), the chrome (`ui.setTitle`, `ui.setWorkingMessage`, `ui.setWorkingVisible`,
   `ui.setHiddenThinkingLabel`), the read-only context (`model.get`,
   `model.getThinkingLevel`, `agent.getContextUsage`, `agent.getSystemPrompt`, `agent.isIdle`,
   `agent.hasPendingMessages`, `tools.getActive`, `tools.getAll`, `settings.get`, `commands.get`,
   `mcp.list`, `session.getSessionName`, `session.getBranch`, `session.getEntries`).
5. **The theme** (58 tokens, 18 methods).
6. **The write-only registrations** and `getFlag`.
7. **The module surface** and the Node surface.
8. **The async factory.**

## The check for each step

- The probe extension: every call it makes must move from
  `{"ok":false,"error":"unknown host operation: X"}` to `{"ok":true, …}` with the value
  `report-ts.json` records for the original.
- The parity suite: `node scripts/parity/extensions.mjs --all` — the "takes effect (rust)" column
  must match "takes effect (ts)" for every example extension.

### The check, in one place

```sh
cd /Users/gabriel/pi-native/scripts/parity
node extensions.mjs --all          # the "takes effect (rust)" column must match "takes effect (ts)"
```

and the probe, which is the precise version. **Rebuild the bundle and the binary first** — the
bundle is what the binary embeds, and a stale bundle measures the old host:

```sh
cd /Users/gabriel/pi-native
node scripts/build-extension-host-bundle.mjs
(cd rpi && cargo build -p rpi-cli --bin rpi)

cd /tmp/pi-ext-audit
node run.mjs ts        # the original      -> report-ts.json
node run.mjs rust      # the port, live    -> report-rust.json
node diff.mjs report-ts.json report-rust.json
```

and the event check, which is the one that matters now that the API surface matches:

```sh
cd /tmp/pi-ext-audit
node run-events.mjs ts     # the original -> events-ts.json:  23 events fired
node run-events.mjs rust   # the port     -> events-rust.json: how many?
```

`events-ts.json` is the reference: the 23 events, their counts and their payload keys are in
section B.0. The port must fire the same events with the same payload keys.

The reference is `report-ts.json` (the original): every `{"ok":true,…}` value there is what the
port must produce. Every `{"ok":false,"error":"unknown host operation: X"}` in the port's report
is a remaining gap.

The scratch crate (`/tmp/pi-ext-audit/probe-crate`) is the fallback when `rpi-cli` does not
compile: it drives the same bundled host with a host that answers exactly what `JsHost` answers.
It cannot show that the CLI dispatches the events or wires the dialogs, and its `theme.get`
answer is a stand-in, so read the theme's values from the live run.

### The baseline

Both sides were run with the same probe (`/tmp/pi-ext-audit/probe.ts`) on 2026-10-20 against a
fresh `rpi/target/debug/rpi`, in the same tmux harness:

```
# the extension API: original vs port
same: 105   different: 14

## different values (14)             the shape differences and the empty answers, listed below
```

14 differences in total, down from 65 when this was first measured. The two freezes are fixed
and the three load-time registrations now work. The event side is still the
bigger gap: **the original fires 23 of the 41 categories in one prompt run, the port fires 13**
(the table in section B.0 is the reference). The ten that do not fire are
`after_provider_response`, `agent_before_settle`, `agent_settled`, `before_agent_start`,
`before_provider_headers`, `before_provider_request`, `context`, `context_with_system`,
`provider_stream_event`, `resources_discover` — five of them fire on **every** LLM call on the
original, so they are not a run-shape artefact.

Three events fire with the wrong payload shape: `input` has no `streamingBehavior`,
`tool_execution_end` has no `durationMs`, and `tool_result` has no `details` and no `usage`.

**The two differences that are not shape but a freeze.** Both were found by the A/B test below,
and both are the same root cause: the JavaScript host's `hostCall` is synchronous, and the CLI
answers some operations by waiting for the thread that is blocked in the extension's call.

| what | the original | the port | the observation |
| --- | --- | --- | --- |
| `pi.registerProvider` / `pi.registerMcpServer` / `pi.registerVirtualModel` **in the extension's factory** | the original queues them and applies them when the runner binds (`types.ts:1806-1817`, `loader.ts:230-236`) — it is explicitly supported at load time | the load never returns | the extension's factory calls the host, the host answers by spawning the call on the **session's runtime** and waiting for the reply — and the extension is being loaded **on that runtime**. The report is never written, the TUI stops drawing and stops reading keys. A/B: with the three calls the probe writes nothing; without them it writes all 123 rows |
| `ctx.ui.select` / `confirm` / `input` / `editor` / `custom` from an extension handler | the original returns a promise; the TUI keeps running and the overlay is presented | the call never returns | the same deadlock: the dialog is presented by the TUI, and the TUI is the thread blocked in the extension's dispatch. A/B: with the dialogs the report stops at the dialog probe and the pane is frozen; without them the report is complete. The native plugin path does not have this problem — its `UiDialog` is open/poll/cancel, so the plugin's call returns at once |

The other 29 differences are shape or value, and they are listed in
`/tmp/pi-ext-audit/result-api.txt`. The ones worth naming:

| row | the original | the port |
| --- | --- | --- |
| `ctx.getSystemPrompt()` | the prompt, a string | `"[object Object]"` — the port returns an object where the original returns a string |
| `pi.getActiveTools()` | `["read","bash","edit","write","probe_tool"]` — the extension's own tool is in the active set, so the model can call it | `["read","bash","edit","write","grep","find","ls"]` — an array now, but **without the extension's own tool**: a tool an extension registers is still not declared to the model |
| `pi.getThinkingLevel()` | `"off"` | `{"level":"medium"}` — an object, and a different value |
| `ctx.thinkingLevel` | a string | an object |
| `pi.getSettings()` | the merged settings | `{}` |
| `pi.getCommands()` | the command list, with `source` and `sourceInfo` — the extension's own command is in it | `[]` — the session's command list is never filled, so the extension's own command is missing too |
| `ui.getAllThemes()` | the three themes with their paths | `[]` |
| `ui.getTheme(name)` | the theme | `null` |
| `ui.getToolsExpanded()` | `false` | `true` |
| `ui.custom()` | a promise (the overlay with keyboard focus) | `null` — the other four dialogs return a promise now, this one does not |
| `pi.getMcpServers()` | the server with its `extensionPath` | the server with an **empty** `extensionPath` |
| `pi.getSessionName()` | `undefined` | `null` |
| the twelve `void` operations (`ui.notify`, `ui.setStatus`, `ui.setTitle`, `ui.setWorkingMessage`, `ui.setWorkingVisible`, `ui.setWorkingIndicator`, `ui.setHiddenThinkingLabel`, `ui.setEditorText`, `ui.pasteToEditor`, `ui.setEditorComponent`, `ui.setToolsExpanded`, `ui.getEditorComponent`) | `undefined` | `null` — the port's host operation answers `null` where the original answers `undefined` |

### A note on the probe's history (why the first baseline had 19 rows in it)

**Those 19 were an artefact of the probe, not a difference in the original.** The first version of
the probe called the UI methods from inside the `input` handler, and on the original those calls
overflowed the stack ("Maximum call stack size exceeded"). A second probe that calls the same
methods from `session_start` shows every one of them working:

```
session_start.ui.getEditorText        {"ok":true,"value":"\"\""}
session_start.ui.getAllThemes         {"ok":true,"value":"[{\"name\":\"system\"},{\"name\":\"dark\",…]"}
session_start.ui.getToolsExpanded     {"ok":true,"value":"false"}
session_start.ui.getTheme             {"ok":true,"value":"{\"name\":\"dark\",\"mode\":\"truecolor\",…}"}
session_start.ui.setTitle             {"ok":true,"value":"undefined"}
session_start.ui.setWorkingMessage    {"ok":true,"value":"undefined"}
session_start.ui.setEditorText        {"ok":true,"value":"undefined"}
session_start.ui.pasteToEditor        {"ok":true,"value":"undefined"}
session_start.ui.setEditorComponent   {"ok":true,"value":"undefined"}
session_start.ui.getEditorComponent   {"ok":true,"value":"undefined"}
session_start.ui.setToolsExpanded     {"ok":true,"value":"undefined"}
session_start.ui.notify              {"ok":true,"value":"undefined"}
```

The probe has been fixed: the UI calls now happen in `session_start`, the `input` handler only
exercises what is input-specific, every key is prefixed with the handler it came from (the two
handlers were overwriting each other's results under the same keys), and a call that returns a
promise is recorded as `"a promise"` rather than awaited. The corrected probe on the original
reports **zero** stack-overflow probes.

So the 19 are real differences in the sense that matters — the original has a working method
where the port throws or is missing — but the original's *value* for them could not be read from
the first report. The corrected probe reads it.

### The live check

The scratch crate drives the bundled host with a host that mirrors the CLI's `JsHost` exactly
(the 9 operations at `rpi/crates/rpi-cli/src/js_extensions.rs:402-462` plus `ProcessHost`'s set).
It is precise for the host boundary, but it cannot show that the CLI now dispatches the events
or wires the dialogs. Once the tree compiles, the same probe runs against a live `rpi`:

```sh
cd /tmp/pi-ext-audit && node run.mjs rust   # writes report-rust.json
node /tmp/pi-ext-audit/diff.mjs /tmp/pi-ext-audit/report-ts.json /tmp/pi-ext-audit/report-rust.json
```

The live check needs `rpi/target/debug/rpi` (the same binary the parity harness uses). The
`rpi/target/release/rpi` that happened to be on this machine was built before the JavaScript
extension host existed — it has no `ui.setWidget` string in it at all — so it must not be used
for this check.
