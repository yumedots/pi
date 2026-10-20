# The agent, the tools and the approvals

Audit of the TypeScript original's agent layer and tool set against the Rust
port's.

- Original: `/Users/gabriel/pi`, branch `perf/lightweight-harness`
  - `packages/agent/src/` — `agent-loop.ts`, `agent.ts`, `types.ts`, `proxy.ts`, `stream-fn.ts`
  - `packages/coding-agent/src/core/` — `agent-session.ts`, `tools/*.ts`, `compaction/`, `project-trust.ts`, `trust-manager.ts`, `nested-tool-calls.ts`
- Port: `/Users/gabriel/pi-native`, branch `feat/rpi-native`
  - `rpi/crates/rpi-agent/src/` — `agent_loop.rs`, `agent.rs`, `hooks.rs`, `events.rs`, `types.rs`, `agent_tool.rs`, `queue.rs`
  - `rpi/crates/rpi-tools/src/tools/` — `read.rs`, `write.rs`, `edit.rs`, `bash.rs`, `grep.rs`, `find.rs`, `ls.rs`, `truncate.rs`
  - `rpi/crates/rpi-harness/src/` — `agent_harness.rs`, `compaction/`, `types.rs`
  - `rpi/crates/rpi-cli/src/` — `session.rs`, `config.rs`, `trust.rs`, `docs_tool.rs`

**Method.** Both trees read side by side; schemas and descriptions extracted
mechanically on both sides (the original's typebox schemas dumped through
`bun` against `packages/coding-agent/dist/core/tools/index.js`; the port's
schemars schemas dumped through a scratch crate that links `rpi-tools` by
path and prints `schema().parameters`). Argument validation was run through
both implementations with the same inputs. No file in either tree was
modified; the scratch crate lives in `/tmp`.

**Read this first.** The port has the *shape* of the original's agent layer:
the same loop structure, the same event names, the same tool names, the same
hooks (`before_tool_call` / `after_tool_call` / `prepare_next_turn`), the same
queue modes, the same truncation limits, and a working `read`/`write`/`edit`
whose success texts are byte-identical. What it lacks is every layer that
lets an *application* (the coding agent, an extension, a host) shape the run:
the request-level hook, the turn decision, the tool-result content contract
beyond text, the mid-run tool announcement, and the whole approval policy.

---

## 1. The ranked list

Severity: **P1** = the port cannot do what the original does; **P2** = the port
does it differently, the user sees the difference; **P3** = wording or shape.

| # | Sev | What the original does | What the port does | What the user sees | Original | Port | Check |
|---|---|---|---|---|---|---|---|
| 1 | P1 | `grep`, `find`, `ls` are built-in tools, registered and selectable (`--tools grep` works) | The three tools are implemented in `rpi-tools` but **never registered**; the default set is `read, bash, edit, write, docs` | The model cannot search the codebase; `rpi --tools grep` silently enables nothing | `packages/coding-agent/src/core/tools/index.ts:95-105`, `packages/coding-agent/src/core/agent-session.ts:3687-3692` | `rpi/crates/rpi-cli/src/session.rs` — `BUILTIN_TOOL_NAMES:71`, `build_tools():2024-2064`, assertion at `:3430-3441` | `rpi --tools grep --debug-system-prompt` → prompt still lists `read/bash/edit/write/docs`; the port's own test asserts `grep`/`find`/`ls` are absent |
| 2 | P1 | No `docs` tool; pi documentation is reached with `read` over `docs/…` | A port-only `docs` tool with a compiled-in Markdown index is a **default** tool | The model gets a tool the original has no equivalent of, and loses the three it does | no `docs` tool in `packages/coding-agent/src/core/tools/index.ts:95-105` | `rpi/crates/rpi-cli/src/docs_tool.rs:105`, registered `session.rs:2057` | `rpi --debug-system-prompt` → "Available tools: … - docs — Look up rpi usage…" |
| 3 | P1 | The system prompt's tool list and its per-tool guidelines are **derived from the active tool set** (`promptSnippet` / `promptGuidelines` on every tool definition) | The "Available tools" block is a **static string**; the active tool set never changes it, and there are no per-tool guidelines | `rpi --tools read` still tells the model `bash`, `edit`, `write` and `docs` are available; the original's guidelines ("Use read to examine files instead of cat or sed.", 4 edit rules) are gone | `packages/coding-agent/src/core/tools/read.ts:97-98` (+ `write.ts:54-55`, `edit.ts:153-154`, `bash.ts:256-257`, `grep.ts:79`, `find.ts:79`, `ls.ts:63`), consumed `packages/coding-agent/src/core/agent-session.ts:3598-3611`, rendered `packages/coding-agent/src/core/system-prompt.ts:181-185` | `rpi/crates/rpi-cli/src/session.rs:99-110` (hard-coded list); no `prompt_snippet` anywhere in `rpi/` | `rpi --tools read --debug-system-prompt` → all five tools still listed. Original: `buildSystemPrompt({selectedTools:["read"],…})` → only `- read: Read file contents` |
| 4 | P1 | `prepareRequest` runs before **every** provider request and can replace the context, the model and the thinking level; the coding agent hangs the session projection, the virtual-model routing and the pre-request compaction on it | No `prepare_request` hook exists | The port cannot project the session into the request, cannot route a request to another model, and cannot compact before a request | `packages/agent/src/types.ts:198-206`, `packages/agent/src/agent-loop.ts:219-241`, wired `packages/coding-agent/src/core/agent-session.ts:804-856` | missing — `rpi/crates/rpi-agent/src/hooks.rs:99-133` has no such field; grep `prepare_request` over `rpi/` finds nothing | `grep -rn "prepare_request" rpi/` → no hits |
| 5 | P1 | `finishTurn` returns `{action:"continue"}` to force one more provider request even when the model asked for no tools (used by compaction and retry continuations) | No `finishTurn`; the port has a boolean `should_stop_after_turn` used only for the optional turn ceiling | A turn that must be continued (post-compaction, post-retry) cannot be continued | `packages/agent/src/types.ts:145-152`, `packages/agent/src/agent-loop.ts:286-298` and `:310-314` | `rpi/crates/rpi-agent/src/hooks.rs:38-41` (`ShouldStopAfterTurn`), used `rpi/crates/rpi-harness/src/agent_harness.rs:3822-3834` | `rpi/crates/rpi-agent/src/agent_loop.rs:377-390` — the only turn-end exit is the boolean stop |
| 6 | P1 | `AgentToolResult` carries `isError` — a tool reports a soft failure **and keeps its `details`** (`bash` on a non-zero exit returns a result with `isError:true`, not an exception) | `AgentToolResult` has no `is_error`; the flag only exists on the persisted `ToolResultMessage`, so a Rust tool must throw to fail — and throwing loses the details payload | A failing `bash` in the port loses the truncation/full-output details, and its text is prefixed `tool error: ` | `packages/agent/src/types.ts:440`, `packages/coding-agent/src/core/tools/bash.ts:401-406`, loop `packages/agent/src/agent-loop.ts:844` | `rpi/crates/rpi-agent/src/types.rs:41-47`, `rpi/crates/rpi-tools/src/tools/bash.rs:286-291` | Port run: `bash` exit 3 → `Err("tool error: hello\n\n\nCommand exited with code 3")`, details dropped. Original: result `isError:true`, text `hello\n\nCommand exited with code 3`, details kept |
| 7 | P1 | `AgentToolResult.structuredContent` + `AgentTool.outputSchema` give programmatic callers (codemode scripts) a machine-readable result | Neither exists | `read`/`bash` cannot return the machine-readable payload the original exposes | `packages/agent/src/types.ts:433`, `:475-476`; `packages/coding-agent/src/core/tools/read.ts:33-36,216`, `bash.ts:56-62,391-408` | `rpi/crates/rpi-agent/src/types.rs:41-47`, `rpi/crates/rpi-agent/src/agent_tool.rs:30-49` | grep `structured_content`/`output_schema` over `rpi/` → no hits |
| 8 | P1 | `tool_execution_end` and the tool-result message carry `durationMs`; the message also carries `nestedCalls` | Neither field exists | The TUI cannot show a per-tool duration from the agent event; nested tool calls (a tool calling another tool) cannot be recorded | `packages/agent/src/types.ts:538`, `:634-636`; `packages/agent/src/agent-loop.ts:926`, `:941` | `rpi/crates/rpi-agent/src/events.rs:82-87`, `rpi/crates/rpi-ai/src/types.rs:623-635` | The port's own renderer takes a `duration_ms` (`rpi/crates/rpi-tui/src/tool_renderers.rs:53`) but nothing ever fills it |
| 9 | P1 | The agent loop announces tool-loadout changes to the model with a system message (`declareToolChanges`), so a tool that appears mid-run is declared in the transcript | No announcement; the port has no `SystemMessage` role at all — the transcript is user/assistant/toolResult only | A tool added or removed mid-run is invisible to the model | `packages/agent/src/agent-loop.ts:333-374`, called at `:110` and `:211` | `rpi/crates/rpi-ai/src/types.rs:764-768` (`Message` has three arms); no `tools_added` in `rpi/` | grep `tools_added`/`declare_tool_changes` over `rpi/` → only the unused model flag `rpi/crates/rpi-ai/src/model.rs:82` |
| 10 | P1 | Project trust **fails closed**: headless ⇒ not trusted; interactive ⇒ the user is asked | Trust **fails open**: an unknown project is trusted | A fresh checkout with project-local extensions/settings executes them with no prompt | `packages/coding-agent/src/core/project-trust.ts:51-92` | `rpi/crates/rpi-cli/src/session.rs:1908-1916` (`resolve_project_trust`), self-documented `rpi/crates/rpi-cli/src/config.rs:451-453` | read both; the port's own comment says "there is no trust prompt. Deferred." |
| 11 | P1 | `defaultProjectTrust` setting (`ask`/`always`/`never`, default `ask`) | Missing | The user cannot make trust a policy | `packages/coding-agent/src/core/settings-schema.ts:266-271`, default `packages/coding-agent/src/core/settings-defaults.ts:31` | `rpi/crates/rpi-cli/src/settings.rs:259-360` (`struct Settings`) — no trust key | read the `Settings` struct |
| 12 | P1 | The `project_trust` extension event lets an extension decide or defer trust | The event tag exists but is never dispatched | An extension cannot participate in the trust decision | `packages/coding-agent/src/core/extensions/types.ts:700-722`, emitted `project-trust.ts:59-71` | tag `rpi/crates/rpi-plugin-sdk/src/lib.rs:598`; the only mention is the payload-free arm at `rpi/crates/rpi-extensions/src/translate.rs:946` | grep `ProjectTrust` over `rpi/crates/**` → the tag and that arm only |
| 13 | P1 | The `user_bash` extension event intercepts the user's `!` shell command | Tag reserved, never dispatched | An extension can no longer intercept or redirect a user shell command | `packages/coding-agent/src/core/extensions/runner.ts:1269-1292` | tag `rpi/crates/rpi-plugin-sdk/src/lib.rs:634`; the only mention is the payload-free arm at `rpi/crates/rpi-extensions/src/translate.rs:966` | grep `UserBash` over `rpi/crates/**` → the tag and that arm only |
| 14 | P1 | The `tool_result` extension event rewrites a tool result (content / details / isError / usage) after execution | The `after_tool_call` hook exists in the harness but the CLI never installs it; the extension event is not dispatched | A permission plugin cannot rewrite a denial result, and no plugin can post-process a result | `packages/coding-agent/src/core/agent-session.ts:700-745` | `rpi/crates/rpi-cli/src/session.rs:804-808` ("remain `None`"); harness slot `rpi/crates/rpi-harness/src/types.rs:434-439` | read both |
| 15 | P1 | `ctx.isProjectTrusted()` returns the real decision | Hard-coded `true` | The extension API lies about trust | `packages/coding-agent/src/core/extensions/runner.ts:929-932` | `rpi/crates/rpi-js/src/host.rs:179` (host stub), `rpi/crates/rpi-js/js/extension-host.ts:531` (the `pi.*` method) | read both |
| 16 | P1 | The agent's retry budget defaults to **3** attempts (2 s, 4 s, 8 s ≈ 14 s) | Defaults to **10** (2 s … 60 s × 5 ≈ 298 s) | A transient provider failure hangs the port for five minutes where the original gives up in fourteen seconds | `packages/coding-agent/src/core/settings-defaults.ts:18-25`, backoff `packages/ai/src/utils/retry.ts:141-145` | `rpi/crates/rpi-harness/src/types.rs:288-310` (test pins `max_retries == 10`), loop `agent_harness.rs:4053-4095` | read both defaults |
| 17 | P1 | `retry.provider.{maxRetries,maxRetryDelayMs,timeoutMs}` are honoured | Parsed into an opaque `serde_json::Value` and never used; the agent always passes `max_retries: None` (0) | HTTP-level retries never happen | `packages/coding-agent/src/core/settings-schema.ts:44-53`, `settings-manager.ts:950-957`, `packages/ai/src/utils/provider-retry.ts:107-131` | `rpi/crates/rpi-cli/src/settings.rs:90` (`provider`) — parsed but unused; `rpi/crates/rpi-agent/src/agent.rs:536`, `rpi/crates/rpi-harness/src/agent_harness.rs:3944-3951` | grep `max_retries` over `rpi/crates` → only `None` in production paths |
| 18 | P1 | A context-overflow error triggers a compaction and one retry of the turn | No overflow detection anywhere | The provider's "context length exceeded" ends the run in the port; the original recovers | `packages/coding-agent/src/core/agent-session.ts:3013-3150` | `CompactionReason::Overflow` exists `rpi/crates/rpi-harness/src/session/types.rs:738-739` but is never produced | grep `overflow` over `rpi/crates/rpi-harness` → the enum arm only |
| 19 | P1 | Compaction is checked **before every assistant response** (plus before each prompt and after `agent_end`) | Once before the run, then mid-loop **only after a turn that produced tool results** | A long turn that produces no tools never triggers threshold compaction | `packages/coding-agent/src/core/agent-session.ts:920-921`, `:792-801`, `:1910-1912`, `:1990` | `rpi/crates/rpi-harness/src/agent_harness.rs:3698-3706` (pre-run), `:3867-3905` (mid-loop), invoked under `if !tool_results.is_empty()` at `rpi/crates/rpi-agent/src/agent_loop.rs:334` | read both |
| 20 | P1 | The compaction threshold uses the **provider-reported** usage when there is one, the estimate only as a fallback | Always the token estimate | The compaction point drifts from the original whenever the estimate diverges from billed context | `packages/coding-agent/src/core/agent-session.ts:3114-3141` | `rpi/crates/rpi-harness/src/agent_harness.rs:3700`, `:3891` | read both |
| 21 | P1 | The retryability classifier is a pair of regex tables | A pair of substring lists, missing ~15 patterns TS retries (`server_busy`, `model is at capacity`, `520`, `service is temporarily unavailable`, `ResourceExhausted`, `upstream request failed`, …) and one TS treats as terminal | Transient upstream errors end the run instead of retrying | `packages/ai/src/utils/retry.ts:7-29`, `:30-126` | `rpi/crates/rpi-harness/src/compaction/compaction.rs:504-560` | read both tables side by side |
| 22 | P1 | Nested tool calls: a tool may call another tool through the agent's own pipeline (`ctx.executeTool()`), with its own hooks, its own events (`parentToolCallId`) and a `nestedCalls` record on the result | No nested tool calls | An extension or a codemode script cannot call a tool from inside a tool | `packages/agent/src/agent-loop.ts:811` (`runToolCall`), `packages/coding-agent/src/core/nested-tool-calls.ts:137,221`, `packages/coding-agent/src/core/agent-session.ts:755-764` | absent — grep `nested` over `rpi/crates/rpi-harness` finds only the child-agent tests | grep for `run_tool_call`/`nested_calls` over `rpi/` → no hits |
| 23 | P2 | `prepareNextTurn` may replace the **model** and the **thinking level** as well as the context | The hook's `AgentLoopTurnUpdate` has `model` and `thinking_level` fields, but the loop applies only `context` — the other two are ignored (the code says so) | A host cannot switch model mid-run from the turn hook | `packages/agent/src/agent-loop.ts:186-199`, `packages/agent/src/types.ts:161-170` | `rpi/crates/rpi-agent/src/types.rs:200-204`, `rpi/crates/rpi-agent/src/agent_loop.rs:363-375` (comment: "Model/thinking swaps are owned by Agent") | read both |
| 24 | P2 | The `Agent` class exposes `transformContext`, `getApiKey`, `onPayload`, `onResponse`, `onProviderStreamEvent`, `beforeToolCall`, `afterToolCall`, `finishTurn`, `prepareRequest`, `prepareNextTurn` as **mutable public fields** — a host installs them after construction | The port's `Agent` hard-codes every one of them to `None` in `build_config` | An embedding host of `rpi-agent` cannot install a single hook; only `rpi-harness` can | `packages/agent/src/agent.ts:198-224`, wired `:470-503` | `rpi/crates/rpi-agent/src/agent.rs:514-541` (all `None`), `rpi/crates/rpi-agent/src/agent.rs:36-46` (`AgentOptions` has no hook fields) | read both |
| 25 | P2 | `Agent.continue()` from an assistant message **drains the queued steering (then follow-up) messages** and runs them | Errors `Cannot continue from message role: assistant` and leaves the queue loaded | A user who types while the model is answering cannot have that message run by `continue` | `packages/agent/src/agent.ts:395-405` | `rpi/crates/rpi-agent/src/agent.rs:557-570` (same error path as `run_continue`) | read both |
| 26 | P2 | The `Agent` exposes `clearSteeringQueue()`, `clearFollowUpQueue()`, `clearAllQueues()`, `peekQueuedMessages()`, `signal`, and settable `steeringMode`/`followUpMode` | None of them; the queue's `mode` has a getter but no setter | A host cannot drop queued messages or change the drain mode at runtime | `packages/agent/src/agent.ts:280-296`, `:308-336` | `rpi/crates/rpi-agent/src/agent.rs:317-435`, `rpi/crates/rpi-agent/src/queue.rs:34-38` | read both |
| 27 | P2 | `prompt(input, images?)` accepts images | `prompt` takes text only (there is `prompt_message` for a full message, but no image convenience) | No image prompt from the `rpi-agent` API | `packages/agent/src/agent.ts:371-373`, `:418-429` | `rpi/crates/rpi-agent/src/agent.rs:377-385` | read both |
| 28 | P2 | `Agent.reset()` keeps the transcript's baseline **system message** (prompt + tool declarations) | `reset()` wipes every message and keeps only the separate `system_prompt` field | After a reset the port's transcript has no leading system message; the tool declarations it carried are not restored | `packages/agent/src/agent.ts:355-368` | `rpi/crates/rpi-agent/src/agent.rs:419-450` (`state.messages.clear()`) | read both |
| 29 | P2 | The bash tool has **no default timeout** ("no default timeout") | The CLI injects a 120 s default (`RPI_BASH_TIMEOUT`) | A long-running command is killed after two minutes in the port and runs forever in the original | `packages/coding-agent/src/core/tools/bash.ts:42` | `rpi/crates/rpi-cli/src/session.rs:2005-2022` (`bash_options`) | read both |
| 30 | P2 | The bash tool strips `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, `PI_REASONING_LEVEL` from the shell env and re-injects them (on by default) | The env map is empty and `inherit_env: true`; nothing is stripped and the session env is never exposed | The model cannot read `PI_*`; the original's docs promise it can | `packages/coding-agent/src/core/tools/bash.ts:186-212` | `rpi/crates/rpi-tools/src/tools/bash.rs:146-157` | read both |
| 31 | P2 | `grep` shells out to **ripgrep**, `find` to **fd**; both honour `.gitignore`; both are auto-downloaded when missing | Both are re-implemented in-process (`regex` + `globset`); `.gitignore` is **not** honoured (only `.git/` is skipped); no `rg`/`fd` download | Different results for the same query, and ignored files show up in the output | `packages/coding-agent/src/core/tools/grep.ts:119-121`, `find.ts:172,178` | `rpi/crates/rpi-tools/src/tools/grep.rs:160-200,216-220`, `find.rs:144-200` | read both |
| 32 | P2 | `find` returns **files only** (fd), and a basename glob (`*.ts`) matches the basename only | `find` also returns **directories** (with a `/`), and `globset`'s default lets `*` match `/`, so `*.ts` matches nested files too | The model gets a different file list for the same query | `packages/coding-agent/src/core/tools/find.ts:186-217` | `rpi/crates/rpi-tools/src/tools/find.rs:186-197`, `:190-193` | read both; the port's own `grep` implements the basename rule (`grep.rs:356-366`), so the two port tools disagree with each other |
| 33 | P2 | `bash` on a non-zero exit returns a **result**; the text is `…\n\nCommand exited with code 3` and the details survive | `bash` throws; the text becomes `tool error: …\n\n\nCommand exited with code 3` and the details are lost | Different text for the model, and the truncation notice/full-output path disappear on failure | `packages/coding-agent/src/core/tools/bash.ts:401-406` | `rpi/crates/rpi-tools/src/tools/bash.rs:286-291` | port run: `Err("tool error: hello\n\n\nCommand exited with code 3")` |
| 34 | P2 | `bash` reports `Command terminated without an exit code` | Treated as success | A command killed without an exit code looks successful to the model | `packages/coding-agent/src/core/tools/bash.ts:386-388` | `rpi/crates/rpi-tools/src/tools/bash.rs:286-292` | read both |
| 35 | P2 | The bash timeout message reads `Command timed out after 2 seconds` | `Command timed out after 2s` | Different wording on every timeout | `packages/coding-agent/src/core/tools/bash.ts:379` | `rpi/crates/rpi-tools/src/tools/bash.rs:274-283` | read both |
| 36 | P2 | `shellPath` selects the shell binary | Parsed from the settings file and **never consumed** | The user cannot choose a shell | `packages/coding-agent/src/core/agent-session.ts:3679,3689` → `tools/bash.ts:174,246` | `rpi/crates/rpi-cli/src/settings.rs:318` (`shell_path`) — "not consumed yet", `rpi/crates/rpi-cli/src/session.rs:2013-2015` | read both |
| 37 | P2 | `shellCommandPrefix` is applied to the user's `!`/`!!` commands as well as to the tool | Applied to the tool only; the TUI runs the raw `!` command | The user's shell alias does not apply in the port | `packages/coding-agent/src/core/agent-session.ts:3915-3924` | `rpi/crates/rpi-cli/src/interactive_tui.rs:596-608` | read both |
| 38 | P2 | The bash spawn hook (`BashSpawnHook`) lets an extension rewrite `{command, cwd, env}` before the shell runs | The port has the type (`BashPrepare`) but **every** construction site passes `prepare: None` | The hook surface exists but is dead code | `packages/coding-agent/src/core/tools/bash.ts:178-212,223-224,268-274` | `rpi/crates/rpi-tools/src/tools/bash.rs:66-69,72-83,152-154`; `rpi/crates/rpi-cli/src/session.rs:2020` (`prepare: None`) | read both |
| 39 | P2 | The retry events are `auto_retry_start {attempt, maxAttempts, delayMs, errorMessage}` and `auto_retry_end {success, attempt, finalError?}`, plus summarisation-level retry events | One event, `RetryScheduled {attempt, max_retries, delay_ms, error}` | The UI cannot show that a retry finished or succeeded | `packages/coding-agent/src/core/agent-session.ts:3844-3852`, `:3813-3826`, `:238-251` | `rpi/crates/rpi-agent/src/events.rs:29-36`, wire shape `rpi/crates/rpi-cli/src/modes.rs:1553-1562` | read both |
| 40 | P2 | The provider backoff applies 0–25 % jitter; `retry-after` (ms, seconds **or HTTP-date**) and `x-should-retry` are honoured; HTTP 504 is never retried | No jitter; `retry-after`/`x-should-retry` are never populated; no status exclusion list | The port retries when the server said not to, and never waits as long as the server asked | `packages/ai/src/utils/provider-retry.ts:25-36`, `:53-68`, `:66-68`; `packages/ai/src/api/openai-decisions.ts:151` | `rpi/crates/rpi-ai/src/providers/anthropic/retry.rs:51-70`, `:96-108`, `:174-190` | read both |
| 41 | P2 | Trust decisions are stored per folder and looked up by **walking parents**; the dialog offers parent and session-only variants | Exact canonical path only; no parent walk; no session-only decision; no file lock | A decision saved for a parent folder is invisible in a child folder | `packages/coding-agent/src/core/trust-manager.ts:45-58`, `:67-97`, `:139-176` | `rpi/crates/rpi-cli/src/config.rs:494-500` | read both |
| 42 | P2 | `/trust` opens a selector (trust / trust parent / trust this session / do not trust / do not trust this session) and reports `Saved trust decision: … Restart pi for this to take effect.` | `/trust [yes|no|clear]` only, message `Current project marked {label}.` | A smaller trust UX | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:5222-5235` | `rpi/crates/rpi-cli/src/interactive_tui/commands.rs:589-622` | read both |
| 43 | P2 | A blocked tool call carries the **extension's own `reason`** verbatim ("Blocked by user", "Path … is protected") | The plugin ABI returns only an int code, so the host synthesises `extension \`X\` blocked tool \`Y\`` | The model is never told *why* it was denied | `packages/coding-agent/src/core/extensions/types.ts:1454-1463`; `packages/agent/src/agent-loop.ts:746` | `rpi/crates/rpi-extensions/src/translate.rs:536-538`; default text `rpi/crates/rpi-agent/src/agent_loop.rs:996-997` (identical to the original's default) | read both |
| 44 | P2 | The port's JS extension backend cannot express any approval: no `tool_call`, `tool_result`, `project_trust` or `user_bash` handler exists | — | A TypeScript permission extension cannot be reused in the port | `packages/coding-agent/src/core/extensions/types.ts:1250-1258` | grep `tool_call|tool_result|project_trust|user_bash` over `rpi/crates/rpi-js/**` → no matches | grep |
| 45 | P2 | The original ships working approval examples (bash danger list, protected paths, plan-mode allowlist, confirm-destructive) | No example plugin in-tree | No ready-made gate to copy | `packages/coding-agent/examples/extensions/permission-gate.ts`, `protected-paths.ts`, `plan-mode/index.ts`, `confirm-destructive.ts` | none under `rpi/` | directory listing |
| 46 | P2 | The summary uses the model's output limit; `reserveTokens` is explicitly *not* used for it | The summary is capped at `0.8 × reserveTokens` (13 107 tokens by default) and the turn-prefix summary at `0.5 ×` (8 192) | A different summary length, and a different truncation point | `packages/coding-agent/src/core/compaction/compaction.ts:644-648`, `:696-700` | `rpi/crates/rpi-harness/src/compaction/compaction.rs:582-600` | read both |
| 47 | P2 | Branch summarisation runs when the user navigates back to a branch (with a "Summarize branch?" prompt unless `branchSummary.skipPrompt`) | `generate_branch_summary` has **no production caller** | Navigating back to a branch produces no summary | `packages/coding-agent/src/core/agent-session.ts:4125-4136` | `rpi/crates/rpi-harness/src/compaction/branch_summary.rs:288`; acknowledged `rpi/crates/rpi-cli/src/settings.rs:303` (`branch_summary`) — parsed but unused | read both |
| 48 | P2 | Compaction summarisation always uses the retry policy and the retry callbacks | The **mid-loop** compaction passes `retry: None`; the Rust `retry_assistant_call` has no `onRetryScheduled`/`onRetryAttemptStart`/`onRetryFinished` callbacks | A failing summarisation is not retried mid-run | `packages/coding-agent/src/core/agent-session.ts:2794-2812`, `packages/coding-agent/src/core/compaction/compaction.ts:612-638` | `rpi/crates/rpi-harness/src/agent_harness.rs:3900`, `rpi/crates/rpi-harness/src/compaction/compaction.rs:451-500` (documented `:30-34`) | read both |
| 49 | P3 | `formatSize` renders `50.0KB` | Renders `(50.0)KB` — with parentheses | Every truncation notice in `read`, `bash`, `grep`, `find`, `ls` reads `(50.0)KB limit reached` | `packages/coding-agent/src/core/tools/truncate.ts:64-72` | `rpi/crates/rpi-tools/src/truncate.rs:108-118` (`format_size`) — its own test pins it | port run: `format_size(51200) == "(50.0)KB"` |
| 50 | P3 | Optional arguments are `Type.Optional(Type.Number)` → `{"type":"number"}`, absent from `required` | schemars → `{"type":["integer","null"],"format":"uint32","minimum":0}` | The model may send `offset: null`; and a fractional or negative `limit` is **rejected** by the port but accepted by the original | `packages/coding-agent/src/core/tools/read.ts:16-17`, `bash.ts:42`, `grep.ts:23-31`, `find.ts:30`, `ls.ts:13` | `rpi/crates/rpi-tools/src/tools/read.rs:30-38`, `bash.rs:40-45`, `grep.rs:48-69`, `find.rs:44-53`, `ls.rs:39-46` | Both validators run with the same inputs: original accepts `limit:1.5` and `limit:-1`, rejects `limit:"abc"`; the port rejects all three, and keeps `offset:null` where the original strips the key |
| 51 | P3 | The `edit` schema inlines the `oldText`/`newText` object, so the strict JSON-schema transform succeeds and the tool can be declared strict | schemars emits `$ref` + `definitions`; the port's strict transform rejects `$ref`/`definitions`, so `edit` **always** falls back to non-strict | The `edit` tool gets weaker constrained sampling than every other tool | `packages/coding-agent/src/core/tools/edit.ts:23-27` | `rpi/crates/rpi-tools/src/tools/edit.rs:47-55`; reject list `rpi/crates/rpi-ai/src/strict_schema.rs:17-19` | dumped both schemas; the port's `edit` parameters contain `"$ref":"#/definitions/ReplaceEditJson"` |
| 52 | P3 | The schema root is `{type, properties, required}` | schemars adds `$schema`, `title` and a `description` | Cosmetic noise in the model's tool declaration | typebox `Type.Object` | `rpi/crates/rpi-tools/src/tools/*.rs` (`schemars::schema_for!`) | dumped both |
| 53 | P3 | Property descriptions have no trailing period | Every port description ends with `.` | Cosmetic | `packages/coding-agent/src/core/tools/read.ts:15` | `rpi/crates/rpi-tools/src/tools/read.rs:31` (and every other input struct) | dumped both |
| 54 | P3 | `details.truncation` is camelCase (`truncatedBy`, `totalLines`, `outputLines`) | snake_case (`truncated_by`, `total_lines`, `output_lines`) | The session log and the renderers see different field names | `packages/coding-agent/src/core/tools/truncate.ts:16-36` | `rpi/crates/rpi-tools/src/truncate.rs:60-84` | dumped both |
| 55 | P3 | The duplicate-match error reads `Found 2 occurrences of the text in f.ts. The text must be unique. Please provide more context to make it unique.` and stops there | Same first sentence, then appends a multi-line `Matching locations` report | More text than the original in the model's context | `packages/coding-agent/src/core/tools/edit-diff.ts:266-274` | `rpi/crates/rpi-tools/src/tools/edit_diff.rs:638-690` (`:658` is the extra "Matching locations" block) | dumped both |
| 56 | P3 | `details.diff` is npm `diff`'s `diffLines` (removed block, then added block) and `details.patch` is `createTwoFilesPatch` (`@@ -1,3 +1,3 @@`) | `similar`'s `TextDiff` (interleaved `+`/`-` on a `Replace`) and `udiff` (`@@ -1 +1 @@`) | The diff text and the patch hunk headers differ | `packages/coding-agent/src/core/tools/edit-diff.ts:366-375`, `:378-500` | `rpi/crates/rpi-tools/src/tools/edit_diff.rs:437-600`, `:614-628` | read both |
| 57 | P3 | A missing file raises Node's `ENOENT: no such file or directory, access '/abs'`; `grep`/`find`/`ls` say `Path not found: /abs` | `not_found: No such file or directory (os error 2) (path: /abs)` | Different error text; the port's also leaks the absolute path where the original shows the raw errno | `packages/coding-agent/src/core/tools/read.ts:126`, `grep.ts:130-132`, `ls.ts:87-90` | `rpi/crates/rpi-tools/src/error.rs:96-113`, `read.rs:164-168`, `ls.rs:131-135` | port run: read of a missing file → `tool error: not_found: No such file or directory (os error 2) (path: …)`; `ls` says `Path not found: …` (that one matches) |
| 58 | P3 | The `read` tool notes `[Current model does not support images. The image will be omitted from this request.]` for a non-vision model | Missing | The model is not told that an image was dropped | `packages/coding-agent/src/core/tools/read.ts:81-85`, `:141-148` | `rpi/crates/rpi-tools/src/tools/read.rs:295-345` | read both |
| 59 | P3 | `grep`/`find` descriptions say `Respects .gitignore` | They say `Skips \`.git/\` directories` | The model is told something different about what is searched | `packages/coding-agent/src/core/tools/grep.ts:78`, `find.ts:78` | `rpi/crates/rpi-tools/src/tools/grep.rs:97-104`, `find.rs:80-86` | dumped both |
| 60 | P3 | The bash description is `Execute a bash command in the current working directory…` | `Execute a Bash command … using Bash/POSIX syntax, even on Windows. PowerShell cmdlets (Get-ChildItem, Select-Object, Select-String) are not valid here…` | A longer, differently-worded tool description | `packages/coding-agent/src/core/tools/bash.ts:255` | `rpi/crates/rpi-tools/src/tools/bash.rs:98-105` | dumped both |
| 61 | P3 | The `edit` description is three sentences | The port's is seven — it adds "Before editing, use read to inspect the current target region…", "Each edit is matched against the same original file snapshot…", "Choose enough surrounding lines…". The `edits[]` item description is also reworded, and the `edits` array description loses "Each edit is matched against the original file, not incrementally… merge them into one edit instead." | Different guidance to the model | `packages/coding-agent/src/core/tools/edit.ts:23-38`, `:151-152` | `rpi/crates/rpi-tools/src/tools/edit.rs:42`, `:50-55`, `:77` | dumped both |
| 62 | P3 | `ls` sorts with `localeCompare` on the lower-cased name | Byte order on the lower-cased name | Different order for non-ASCII names (`ä` vs `z`) | `packages/coding-agent/src/core/tools/ls.ts:112` | `rpi/crates/rpi-tools/src/tools/ls.rs:156` | read both |
| 63 | P3 | `limit: 0` is allowed (`limit ?? 500` → 0 results) | Clamped to 1 | `limit: 0` returns one entry instead of none | `packages/coding-agent/src/core/tools/ls.ts:82`, `find.ts:107`, `grep.ts:135` | `rpi/crates/rpi-tools/src/tools/ls.rs:119`, `find.rs:125`, `grep.rs:146` | read both |
| 64 | P3 | `read`/`write`/`edit`/`ls` resolve paths with `resolveToCwd`; only `read` gets the fuzzy path variants | **All four** of `read`, `grep`, `find`, `ls` use the fuzzy `resolve_read_tool_path` | The port's `grep`/`find`/`ls` resolve smart-quote/NFD path variants the original would not | `packages/coding-agent/src/core/tools/path-utils.ts:48-56,96-131`; `grep.ts:126`, `find.ts:106`, `ls.ts:81` | `rpi/crates/rpi-tools/src/path_utils.rs:42-100`; `grep.rs:170`, `find.rs:130`, `ls.rs:126` | read both |
| 65 | P3 | The `powershell` tool has the same schema, output schema and constrained sampling as `bash` | A one-line description, no output schema, no constrained sampling | The Windows shell tool is declared differently | `packages/coding-agent/src/core/tools/powershell.ts:40-64` | `rpi/crates/rpi-tools/src/tools/powershell.rs` | dumped both |
| 66 | P3 | The trust store file is `<agentDir>/trust.json` | `~/.rpi/agent/trust.json` | (Note: the port now reads pi's config dir — `CONFIG_DIR_NAME = ".pi"`, `CONFIG_DIR_ENV = "PI_CODING_AGENT_DIR"`, `rpi/crates/rpi-cli/src/config.rs:45,49` — so the *file name* is `~/.pi/agent/trust.json`; the stale comment at `config.rs:3-16` still says `~/.rpi`.) | `packages/coding-agent/src/core/trust-manager.ts:139-176` | `rpi/crates/rpi-cli/src/config.rs:139-141`, `:456-500` | read both |
| 67 | P3 | A second, contradictory trust implementation does not exist | `rpi/crates/rpi-cli/src/trust.rs` (356 lines) defines `TrustDecision`/`TrustStore`/`ProjectTrust` and `should_trust_project` (undecided ⇒ **not** trusted) and is **never called** — the live path (`config.rs` + `session.rs:1849`) trusts by default | Two contradictory policies in one tree; the dead one fails closed, the live one fails open | — | `rpi/crates/rpi-cli/src/trust.rs:215-240` (unused) | grep the callers of `should_trust_project` → none |
| 68 | P3 | The `AgentEvent` union has no retry event; the retry lives at the session level | The port puts a `RetryScheduled` event in the **agent** event union | An extra event in the agent stream (a duplicate of row 39's shape difference) | `packages/agent/src/types.ts:516-539` | `rpi/crates/rpi-agent/src/events.rs:29-36` | read both |
| 69 | P3 | The `edit` tool's legacy `oldText`/`newText` arguments (a single object instead of `edits[]`) are folded by `prepareArguments` | Folded too (`prepare_arguments` + the port's own folding) — **same behaviour** | — | `packages/coding-agent/src/core/tools/edit.ts:112-141`, `:158` | `rpi/crates/rpi-tools/src/tools/edit.rs:222-278`, `rpi/crates/rpi-agent/src/agent_tool.rs:44-47`, invoked `rpi/crates/rpi-agent/src/agent_loop.rs:947` | read both — no difference |
| 70 | P3 | The mutation queue keys on `realpath`, falling back on `ENOENT`/`ENOTDIR` | Keys on `canonical_path`, falling back only on `not_found`/`not_supported` | An `ENOTDIR` path errors instead of falling back | `packages/coding-agent/src/core/tools/file-mutation-queue.ts:14-24` | `rpi/crates/rpi-tools/src/file_mutation_queue.rs:78-96` | read both |

---

## 2. What the port already matches

So the next reader does not re-check these:

- **Event names and order.** `agent_start`, `turn_start`, `message_start`/`message_end`,
  `message_update`, `tool_execution_start`/`_update`/`_end`, `turn_end`, `agent_end` —
  same names, same order (`rpi/crates/rpi-agent/src/events.rs:23-88` against
  `packages/agent/src/types.ts:516-539`).
- **Tool-call ordering.** In a parallel batch `tool_execution_end` fires in completion
  order and the tool-result messages fire in source order — the port implements the
  same invariant (`rpi/crates/rpi-agent/src/agent_loop.rs:700-860` against
  `packages/agent/src/agent-loop.ts:586-660`).
- **Truncate-fail.** A `stopReason: "length"` message fails every tool call in place
  without executing it, with the same sentence
  (`rpi/crates/rpi-agent/src/agent_loop.rs:578-620` against
  `packages/agent/src/agent-loop.ts:478-506`).
- **Late-update suppression.** `on_update` after `execute` resolves is dropped
  (`rpi/crates/rpi-agent/src/agent_loop.rs:1024-1060` against
  `packages/agent/src/agent-loop.ts:821-856`).
- **Sequential vs parallel tool execution**, and the per-tool `executionMode`
  override (`rpi/crates/rpi-agent/src/agent_loop.rs:626-640` against
  `packages/agent/src/agent-loop.ts:508-525`).
- **Batch terminate rule.** The batch stops only when *every* result sets `terminate`
  (`rpi/crates/rpi-agent/src/agent_loop.rs:1150` against
  `packages/agent/src/agent-loop.ts:690`).
- **Queue modes.** `all` / `one-at-a-time`, default `one-at-a-time`
  (`rpi/crates/rpi-agent/src/queue.rs:57-73`, `types.rs:30-35` against
  `packages/agent/src/agent.ts:145-181`).
- **Compaction threshold formula and defaults.** `contextTokens > contextWindow −
  reserveTokens`, `reserveTokens 16384`, `keepRecentTokens 20000`
  (`rpi/crates/rpi-harness/src/compaction/settings.rs:23-33` against
  `packages/coding-agent/src/core/compaction/compaction.ts:121-130,267-270`).
- **Compaction summary message text** — byte-identical
  (`rpi/crates/rpi-harness/src/messages.rs:28-38` against
  `packages/coding-agent/src/core/messages.ts:15-21`).
- **`read` / `write` / `edit` success texts and truncation notices** — byte-identical,
  including `[Showing lines 1-2000 of 5000. Use offset=2001 to continue.]`
  (`rpi/crates/rpi-tools/src/tools/read.rs:207-252` against
  `packages/coding-agent/src/core/tools/read.ts:159-201`).
- **`edit`'s exact-then-fuzzy match algorithm** — ported, including the NFKC and
  smart-quote normalisation (`rpi/crates/rpi-tools/src/tools/edit_diff.rs:75-149`
  against `packages/coding-agent/src/core/tools/edit-diff.ts:29-42,236-275`).
- **The blocked-tool default text** `Tool execution was blocked`
  (`rpi/crates/rpi-agent/src/agent_loop.rs:996-997` against
  `packages/agent/src/agent-loop.ts:746`).
- **The agent-level backoff formula** `baseDelay × 2^(n−1)`, capped
  (`rpi/crates/rpi-harness/src/agent_harness.rs:4092-4095` against
  `packages/ai/src/utils/retry.ts:141-145`).

---

## 3. Decisions the porter needs

1. **The tool set.** `grep`/`find`/`ls` are ported but not wired; `docs` is a
   port-only tool in the default set. Either the three search tools join the
   default set (the original's default is `read, bash, edit, write` —
   `packages/coding-agent/src/core/settings-manager.ts:85`) and `docs` leaves, or
   the divergence is deliberate and documented. This one decision unblocks rows
   1, 2 and 3.
2. **The tool-result contract.** `isError` and `structuredContent` on the result
   (rows 6, 7) are a shape change to `AgentToolResult`, not a per-tool fix. It
   also decides whether a failing `bash` keeps its details (row 33).
3. **The hook surface.** `prepareRequest` and `finishTurn` (rows 4, 5) are the two
   hooks the port lacks, and they are what the coding agent's session projection,
   the virtual-model routing and the compaction/retry continuations hang on. The
   port's `after_tool_results` is a port-specific hook with no original
   counterpart; decide whether to add the original's two or to document the
   port's shape as intentional.
4. **The trust default.** The port fails open where the original fails closed
   (row 10). If that stays, it needs to be a conscious decision, not a
   "deferred" comment — the port now reads pi's own `~/.pi/agent` directory, so
   the trust file is shared with the original.
5. **The retry budget** (row 16) is a one-constant change but changes how long a
   user waits on a flaky provider.

---

## 4. How the checks were run

- Original tool schemas and descriptions:
  `bun` against `packages/coding-agent/dist/core/tools/index.js`
  (`createAllToolDefinitions(cwd)`), printing `name`, `label`, `description`,
  `parameters`, `outputSchema`, `promptSnippet`, `promptGuidelines`,
  `constrainedSampling`.
- Original system prompt: `bun` against
  `packages/coding-agent/dist/core/system-prompt.js` (`buildSystemPrompt`).
- Original argument validation: `bun` against
  `packages/ai/dist/utils/validation.js` (`validateToolArguments`).
- Port tool schemas, descriptions, argument validation, tool execution and
  `format_size`: a scratch crate in `/tmp` linking `rpi-tools` and `rpi-ai` by
  path (`schemars::schema_for!` output, `validate_tool_arguments`, direct tool
  `execute` calls). Nothing was written into either tree.
- Port system prompt: `rpi --offline --no-session --debug-system-prompt -p hi`
  with `--tools read` and `--tools grep` (`rpi/crates/rpi-cli/src/session.rs`,
  `rpi/crates/rpi-cli/src/agent_session.rs`).
- The mechanical audit (`scripts/parity/audit.mjs`) was run first; it does not
  cover this area (it reports keybindings, slash commands, settings keys and
  components), so everything above was extracted by hand.

---

## 5. Re-capture status

The port-side observations in this file were taken against a binary built
**before** the header, the key hints and the provider resolution changed, and
before the interactive-mode and extension work landed. Every port-side row must
be re-run against a fresh binary before the porter chases it. This section
records which rows are source-level (stable) and which need a re-run.

**Rows that are source-level only** — they do not depend on the binary and are
unaffected by the rebuild: 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18,
19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 34, 35, 36, 37, 38,
39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 50, 51, 52, 53, 54, 55, 56, 57, 58,
59, 60, 61, 62, 63, 64, 65, 66, 67, 70.

**Rows that need a re-run against a fresh binary** — the check reads the
running program, so a rebuild can close them:

| Row | The check to re-run | Closed? |
|---|---|---|
| 1 | `rpi --tools grep --debug-system-prompt` → the prompt must list `grep` | pending rebuild |
| 2 | `rpi --debug-system-prompt` → `docs` must be gone from the tool list | pending rebuild |
| 3 | `rpi --tools read --debug-system-prompt` → the prompt must mention only `read`, plus its guidelines | pending rebuild |
| 10 | a project with a local extension must not run it without a trust decision | pending rebuild |
| 29 | `rpi` with no `RPI_BASH_TIMEOUT` → the tool must have no default timeout | pending rebuild |
| 30 | `rpi` → `echo $PI_MODEL` inside `bash` must show the session env (and `PI_*` must be stripped from the inherited env) | pending rebuild |
| 49 | `rpi` → a truncated read must say `50.0KB`, not `(50.0)KB` | pending rebuild |
| 50 | `rpi` → `read` with `limit: 1.5` must be accepted | pending rebuild |
| 68 | the agent event stream must carry no `retry_scheduled` event | pending rebuild |

**The two checks that matter most to a user** (from the lead):

1. `--tools read` must produce a system prompt that mentions only `read` and
   its guidelines, not the hard-coded list. Today it prints all five tools.
   The check is one command:
   `rpi --offline --no-session --tools read --debug-system-prompt -p hi`
2. A tool in an untrusted project must not run. The check is: create a
   directory with a local `.pi` settings file or a project extension, point
   `rpi` at it, and confirm the extension does not load and no project
   resource is read without a trust decision.

**Status:** re-capture pending — the workspace does not build as of
`scripts/parity/out/build-state.txt` (`BROKEN … rpi-cli/src/interactive_tui/
settings_menu.rs`), so no fresh binary exists to capture against. The rows
above are marked "pending rebuild" and will be closed here as soon as the
tree is green.

