# The extension API port: what changed, and what still differs

This is the porter's record of the work on the JavaScript extension host. The
audit of the contract is `EXTENSION-API.md` (the extension API lead's file);
this file says what the port answers now, and what it still does not.

The published contract is the TypeScript original's
`packages/coding-agent/src/core/extensions/types.ts`. The port serves it from
three files:

| file | what it holds |
| --- | --- |
| `rpi/crates/rpi-js/js/extension-host.ts` | the bundled host that runs inside V8: the `pi` object, the `ctx` object, the `ctx.ui` object, the theme, the event dispatch |
| `rpi/crates/rpi-js/src/host.rs` | `ProcessHost` — the fallback host |
| `rpi/crates/rpi-cli/src/js_extensions.rs` | `JsHost` — the CLI's own host, which answers from the running session |

## The host operations

**Before:** the bundled host asked for 56 operations; the port answered 24 and
threw `Error: unknown host operation: <op>` into the extension for the other
32. Fifteen `pi.*` methods threw for that reason.

**Now:** every operation is answered. The fallback host
(`rpi/crates/rpi-js/src/host.rs:88`) answers all of them with a neutral value,
and the CLI's host (`rpi/crates/rpi-cli/src/js_extensions.rs:492`) answers the
session questions from the running session: the same harness the native
plugins drive, the same editor, the same settings.

| operation group | the original | the port now |
| --- | --- | --- |
| the session (`sendMessage`, `sendUserMessage`, `appendEntry`, `setSessionName`, `setLabel`, `exec`, `getBranch`, `getEntries`, `getDir`, `getId`, `getFile`, `getLeafId`, `getEntry`, `getLabel`, `getHeader`, `getTree`, `buildContextEntries`, `buildSessionProjection`, `shutdown`) | `types.ts:1731-1763`, `core/session-manager.ts:255-259` | the harness-backed actions (`rpi/crates/rpi-cli/src/extensions_actions.rs:351`) and the session identity (`js_extensions.rs:99`) |
| the model (`get`, `getThinkingLevel`, `set`, `setThinkingLevel`, `registerVirtual`, `unregisterVirtual`) | `types.ts:339`, `:1791-1800`, `:1911-1914` | the harness's model and thinking level (`extensions_actions.rs:753`) |
| the tools (`getActive`, `getAll`, `setActive`, `getExposure`, `getNamespace`, `getPromptGuidelines`, `execute`) | `types.ts:1766-1778` | the harness's tool set (`extensions_actions.rs:709`) |
| the settings and the commands | `types.ts:1772`, `:1781` | the merged settings and the command list the TUI offers |
| the dialogs (`select`, `confirm`, `input`, `editor`) | `types.ts:151-157`, `:240` | the session's dialog mailbox (`js_extensions.rs:1094`), the same one the native plugins use |
| the chrome (`setTitle`, `setWorkingMessage`, `setWorkingVisible`, `setWorkingIndicator`, `setHiddenThinkingLabel`, `setEditorText`, `getEditorText`, `pasteToEditor`) | `types.ts:169-185`, `:211`, `:231-237` | the TUI's terminal, editor and working indicator (`interactive_tui.rs:1294`) |
| the providers, the MCP servers and the virtual models | `types.ts:1858-1914` | the session's registries (`js_extensions.rs:920`) |
| the theme | `theme.ts:222`, `theme-tokens.ts:24` | all 58 tokens and all 18 methods (`rpi/crates/rpi-js/src/theme.rs`, `extension-host.ts:170`) |

The check is `rpi/crates/rpi-js/src/host.rs:274` — it reads the **bundle**,
collects every `hostCall("…")` the extension host makes, and asserts the
fallback host answers each one. A new operation in the extension host cannot
be added without the host answering it.

## The `ctx` objects

**Before:** the `ctx.ui` object had 20 of the original's 28 members, the
`sessionManager` had 2 of its 15, the command context had none of its 7, and
the tool context had none of its 2.

**Now:** all of them exist (`extension-host.ts:433` for the UI, `:462` for the
session manager, `:541` for the command context, `:555` for the tool context).
The theme carries the original's 18 methods and 58 tokens, and its resets are
the original's (`\e[39m` for the foreground, `\e[49m` for the background) —
before, the port wrote `\e[0m`, which also cleared the background.

## The events

**Before:** 6 of the original's 41 categories fired, two of them with
degraded payloads.

**Now** the agent events come from one place — the harness's own agent events,
translated into pi's shapes by `rpi/crates/rpi-cli/src/js_emitter.rs`:

| event | the original | the port now |
| --- | --- | --- |
| `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end` | `types.ts:959-1121` | `js_emitter.rs:96` — the harness's agent events, in pi's shapes, with the run's messages on `agent_end` and the turn's message and tool results on `turn_end` |
| `tool_result` | `types.ts:1267` | `js_emitter.rs:191` — with the tool's content and the error flag |
| `tool_call` (**carries a result**) | `types.ts:1454` `ToolCallEventResult {block?, reason?, terminate?}` | `session.rs:915` — the tool-call hook publishes pi's payload and reads the answer back; a handler that returns `block` stops the call |
| `before_agent_start`, `before_provider_request`, `before_provider_headers`, `after_provider_response` | `types.ts:901-957` | `rpi/crates/rpi-extensions/src/provider_hooks.rs:161`, `:197`, `:210`, `:229` — the provider hooks, where the data lives |
| `ui_prompt_start`, `ui_prompt_end` | `types.ts:1042-1056` | `js_extensions.rs:1149` — around every dialog the extension opens |
| `session_info_changed`, `model_select`, `thinking_level_select`, `mcp_servers_change` | `types.ts:764`, `:1134`, `:1143`, `:746` | `js_extensions.rs:837`, `:741`, `:760`, `:961` — when the extension changes that state |
| `user_bash` | `types.ts:1153` | `interactive_tui.rs:572` — when the user runs `!command` |
| `session_start` | `types.ts:755` | `interactive_tui.rs:1346` — the reason still says `startup` for every start |

Every one of them reaches the extensions through one sink
(`rpi/crates/rpi-extensions/src/event_sink.rs`), so the provider hooks — which
live in the extension crate and know nothing about JavaScript — and the
harness's agent events arrive the same way. The sink also carries the answer
back, which is what `tool_call` needs.

The categories that still do not fire — **15 of the 41**:

```
project_trust            resources_discover        session_before_switch
session_before_fork      session_before_compact    session_compact
session_compact_failed   session_before_tree       session_tree
context                  context_with_system       cache_warming_decision
provider_stream_event    agent_before_settle       agent_settled
```

| category | why |
| --- | --- |
| `project_trust` | the port has no trust prompt |
| `resources_discover` | the port does not let an extension contribute resource paths |
| `session_before_switch`, `session_before_fork`, `session_before_tree`, `session_tree` | the port does not switch, fork or navigate the session tree from an extension |
| `session_before_compact`, `session_compact`, `session_compact_failed` | the port compacts without asking the extensions |
| `context`, `context_with_system` | the port does not let an extension rewrite the messages before a call |
| `cache_warming_decision` | pi's cache warmer has no counterpart in the port |
| `provider_stream_event` | the port's provider layer does not publish the raw stream events |
| `agent_before_settle`, `agent_settled` | the port's harness has no settlement boundary to report |

`context` and `context_with_system` are the two that matter: both carry a
result (`{messages}`), so an extension cannot change the transcript before a
call. The port's provider hook has the messages and an empty
`transform_context` slot — the same place `before_agent_start` would go.

## What still differs

| gap | why | the original |
| --- | --- | --- |
| `session_start`'s `reason` is always `startup` | the port does not resume, fork or reload a JavaScript session, so it has no other reason to report | `types.ts:758` |
| `turn_end`'s `entries`, `context` and `messageEntryId` are empty | the port's harness has no session projection to hand the extension | `types.ts:1065` |
| `after_provider_response` reports `status: 200` and no headers | the port's provider layer does not surface the HTTP response to the hooks | `types.ts:918` |
| `session.setLabel` always fails with `Entry id not found` | the port's session tree has no labels; the original answers the same way for an id that does not exist | `types.ts:1760` |
| `ui.setEditorComponent` stores the component but the editor does not use it | the port's editor is a Rust component | `types.ts:278` |
| `onTerminalInput` and `addAutocompleteProvider` are accepted but not consulted | the port's key loop and autocomplete do not call back into the extension host | `types.ts:163`, `:243` |
| `registerShortcut`, `registerMessageRenderer`, `registerEntryRenderer`, `registerMarkdownTransformer`, `registerToolRenderer` are stored but never read | the port's transcript and tool rows are Rust components | `types.ts:1683-1724` |
| `getFlag` returns the registered default, not the parsed flag | the port's CLI does not parse extension flags | `types.ts:1758` |
| the module surface is the contract's, not the package's | see below | `packages/coding-agent/src/index.ts` |
| `node:child_process`'s functions throw when called | the embedded host cannot spawn a process; the module resolves, so the extension loads | `rpi/crates/rpi-js/js/shims/node-child-process.ts` |
| the extension factory is not awaited | the runtime settles microtasks but has no timer, so an extension that registers after `await` never registers | `loader.ts:624` |

## The module surface

The port publishes a **subset** of each of pi's packages:

| module | the original | the port now |
| --- | --- | --- |
| `@earendil-works/pi-coding-agent` | `packages/coding-agent/src/index.ts` — the package entry, 154 runtime exports | `packages/coding-agent/src/core/extensions/types.ts` — the contract's 10 (`defineTool` and the type guards) |
| `@earendil-works/pi-tui` | `packages/tui/src/index.ts` — 92 exports | `rpi/crates/rpi-js/js/pi-tui.ts` — 20, the parts that render |
| `@earendil-works/pi-ai` (and `/compat`) | `packages/ai/src/compat.ts` | `rpi/crates/rpi-js/js/pi-ai.ts` — 1 (`Type`) |
| `@earendil-works/pi-agent-core` | `packages/agent/src/index.ts` | `rpi/crates/rpi-js/js/pi-agent-core.ts` — 1 (`AGENT_RUNTIME_AVAILABLE`) |

**The fix is known and small: point the map at the vendored pi sources.** The
port vendors pi's packages (`/Users/gabriel/pi-native/packages/`), and the
vendored files are byte-identical to the original's — `diff
packages/coding-agent/src/index.ts` against the original's is empty. So the
`VIRTUAL_MODULES` map can point at `packages/coding-agent/src/index.ts`,
`packages/tui/src/index.ts`, `packages/ai/src/compat.ts` and
`packages/agent/src/index.ts`, and the export surface becomes pi's.

**What blocks it today** (measured, not guessed): the vendored sources import
node builtins and npm packages that the embedded host does not have. The
shims now cover `node:path`, `node:fs`, `node:fs/promises`, `node:os`,
`node:url`, `node:perf_hooks`, `node:child_process`, `node:events`,
`node:worker_threads`, `node:module`, `node:timers/promises`, `node:crypto`,
`node:util`, `node:readline`, `node:stream`, `node:zlib`, `node:http`,
`node:string_decoder`, `node:stream/promises` and `node:process`
(`rpi/crates/rpi-js/js/shims/`), and the bundler aliases them
(`scripts/build-extension-host-bundle.mjs:34`). Still missing:

- the builtins `node:readline/promises`, `node:assert` and `node:v8`;
- the npm packages `which`, `graceful-fs`, `hosted-git-info` and
  `standardwebhooks`.

The npm ones are the interesting half: they are in the port's root
`node_modules` (a symlink to pi's), but esbuild does not resolve them from
`packages/<pkg>/src/`, while it resolves them from `scripts/`. The node
resolution path is the thing to look at.

**A subpath the host does not publish no longer kills the extension.** An
import of `@earendil-works/pi-ai/providers/anthropic` resolves to an empty
module (`extension-host.ts:404`): the extension loads, and only the names it
wanted are missing. pi maps every subpath it publishes, so this is a
port-side gap being made forgiving rather than fatal. The check is
`rpi/crates/rpi-js/tests/extension.rs:153`.

The names pi's own example extensions import, and where each one lives:

| name | the original |
| --- | --- |
| `defineTool` | `core/extensions/index.ts` |
| `CONFIG_DIR_NAME`, `getAgentDir`, `VERSION` | `config.ts` |
| `createBashTool` | `core/sdk.ts` |
| `createReadToolDefinition`, `withFileMutationQueue` | `core/tools/index.ts` |
| `serializeConversation` | `core/compaction/index.ts` |
| `BorderedLoader`, `CustomEditor`, `DynamicBorder`, `keyHint` | `modes/interactive/components/index.ts` |
| `getMarkdownTheme`, `getSettingsListTheme` | `modes/interactive/theme/theme.ts` |
| `parseFrontmatter` | `utils/frontmatter.ts` |
| `Box`, `Container`, `Input`, `Markdown`, `SelectList`, `SettingsList`, `Spacer`, `Text`, `Key`, `CURSOR_MARKER`, `isKeyRelease`, `matchesKey`, `parseKey`, `renderFakeCursor`, `truncateToWidth`, `visibleWidth` | `packages/tui/src/index.ts` |
| `Type`, `StringEnum`, `uuidv7` | `packages/ai/src/index.ts` |
| `streamSimple` | `packages/ai/src/compat.ts` |

## The checks

```sh
# the host operations, the theme, the node surface and the subpaths
cd /Users/gabriel/pi-native/rpi && cargo test -p rpi-js

# the bundle is the build output of the .ts: rebuild it after every change
cd /Users/gabriel/pi-native && node scripts/build-extension-host-bundle.mjs

# the whole extension surface, against both sides
cd /Users/gabriel/pi-native/scripts/parity && node extensions.mjs --all
```

`cargo test -p rpi-js` is 5 lib tests + 8 integration tests + the doctests:
the lib test reads the **bundle** and asserts the host answers every
operation it asks for; the integration tests cover the node builtins, an
unpublished subpath, a tool, a command, an event and a screen.

The probe is the precise version; it lives in the extension API lead's scratch
directory and compares `/tmp/pi-ext-audit/report-ts.json` (the original) with
the port's own report.

**This work has not been verified by a second pair of eyes.** The porter wrote
it and the checks above; the extension API lead re-runs the probe and the
parity suite.
