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

## The extension's own tools

A tool an extension registers has to be in the session's tool set, or the
model cannot call it. The JavaScript extension's tools are declared to the
model by `rpi/crates/rpi-cli/src/js_tools.rs`: the tool is published with the
schema the extension gave it, and calling it runs the extension's own
`execute` (`JsExtensions::call_tool`). The TUI adds them to the harness's
tool set and to the active tool names when the extensions load
(`interactive_tui.rs`).

## The provider hooks

The provider hooks are what publish the events that fire on every LLM call
(`before_provider_request`, `before_provider_headers`,
`after_provider_response`, `before_agent_start`) and the `context` events.
The native path installs them only when a **native** plugin subscribes to one
of them (`ExtensionProviderHooks::from_session`), so a session with only
JavaScript extensions had no hooks at all and the events never fired. The
hooks now also come up for the JavaScript extensions
(`ExtensionProviderHooks::for_javascript`), and the TUI installs them when
the extensions load.

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
| `context`, `context_with_system` carry no result | the port's provider hook has the messages and an empty `transform_context` slot | `types.ts:885` |

**Closed since the first pass:** the extension factory is awaited (the node
surface has a timer queue and the runtime pumps it while it settles), the
fallback host fails closed on `agent.isProjectTrusted`, and an unmapped
subpath of one of pi's packages resolves to an empty module instead of
killing the extension.

## The two freezes

Both had the same root cause: the JavaScript host answers the extension
synchronously, on the runtime's own thread, and the CLI answered some
operations by waiting for the very thread that was blocked in the extension's
call.

**A load-time registration froze the port.** The host's `provider.register`,
`mcp.register`, `model.registerVirtual` publish an event, and the event sink
delivered it by dispatching back into the extensions — the same thread that
was making the call. The call waited for itself. The sink now queues an
event that is published from inside a host call and delivers it when the
call returns (`js_emitter.rs`: `in_host_call()`, `JsEventSink::drain`).

**A dialog froze the port.** The host opened the dialog and then polled for
the answer on the runtime's thread, while the TUI — the thread that presents
the dialog — was blocked in the extension's dispatch. The dialog is now the
original's open/poll/cancel shape: `ui.select` opens the request and returns
its id at once (`js_extensions.rs`: `dialog`), the extension polls with
`ui.pollDialog` (`extension-host.ts`: `askDialog`), and the TUI's dispatch of
a JavaScript event no longer waits for the extension
(`interactive_tui/events.rs`: `dispatch_js_event` spawns the dispatch).

## The module surface

The port publishes a **subset** of each of pi's packages:

| module | the original | the port now |
| --- | --- | --- |
| `@earendil-works/pi-coding-agent` | `packages/coding-agent/src/index.ts` — the package entry, 154 runtime exports | `packages/coding-agent/src/core/extensions/types.ts` — the contract's 10 (`defineTool` and the type guards) |
| `@earendil-works/pi-tui` | `packages/tui/src/index.ts` — 92 exports | `rpi/crates/rpi-js/js/pi-tui.ts` — 20, the parts that render |
| `@earendil-works/pi-ai` (and `/compat`) | `packages/ai/src/compat.ts` | `rpi/crates/rpi-js/js/pi-ai.ts` — 1 (`Type`) |
| `@earendil-works/pi-agent-core` | `packages/agent/src/index.ts` | `rpi/crates/rpi-js/js/pi-agent-core.ts` — 1 (`AGENT_RUNTIME_AVAILABLE`) |

**The fix is known: point the map at the vendored pi sources.** The port
vendors pi's packages (`/Users/gabriel/pi-native/packages/`), and the
vendored files are byte-identical to the original's — `diff
packages/coding-agent/src/index.ts` against the original's is empty.

**Two blockers were found and one of them is fixed.**

1. **Fixed: esbuild resolved no npm package.** The bundler runs with
   `platform: "neutral"`, whose `mainFields` is empty, so a package with only
   a `main` field (`which`, `graceful-fs`, `hosted-git-info`,
   `standardwebhooks` — the port's own dependencies) never resolved, from the
   vendored sources *or* anywhere. `scripts/build-extension-host-bundle.mjs`
   now sets `mainFields: ["module", "main"]` and `nodePaths`, and the npm
   packages resolve.

2. **Fixed: the embedded host had almost no node builtins.** The shims in
   `rpi/crates/rpi-js/js/shims/` now cover `node:path`, `node:fs`,
   `node:fs/promises`, `node:os`, `node:url`, `node:perf_hooks`,
   `node:child_process`, `node:events`, `node:worker_threads`, `node:module`,
   `node:timers/promises`, `node:crypto`, `node:util`, `node:readline`,
   `node:readline/promises`, `node:stream`, `node:stream/promises`,
   `node:stream/web`, `node:zlib`, `node:http`, `node:string_decoder`,
   `node:process`, `node:assert`, `node:buffer`, `node:vm`, `node:net`,
   `node:tls`, `node:tty`, `node:async_hooks`, `node:diagnostics_channel`,
   `node:v8`, `node:sqlite`, `node:querystring`, `node:dns`, `node:http2`,
   `node:inspector`, `node:cluster`, `node:dgram`, `node:punycode`,
   `node:sys`, `node:trace_events`, `node:console` and `node:timers`, and the
   bundler aliases them. With those in place **34 of pi's own modules bundle
   cleanly** — `config.ts`, `core/sdk.ts`, `core/tools/index.ts`,
   `core/extensions/index.ts`, `core/compaction/index.ts`,
   `core/session-manager.ts`, `core/model-registry.ts`,
   `modes/interactive/components/index.ts`,
   `modes/interactive/theme/theme.ts`, `core/skills.ts`,
   `core/settings-manager.ts`, `core/trust-manager.ts`, `core/package-manager.ts`
   and the rest.

**What is left, and why the package entry is not the answer.** Pointing
`@earendil-works/pi-coding-agent` at the package entry pulls the **whole CLI**
into the bundle (13.5 MB), and the bundle then replaces the global `process`
at load: `which/which.js` then reads `process.env.OSTYPE` off a null `env`,
and every extension fails to load. So the package entry cannot be bundled
whole. The next step is to bundle the **individual pi modules** the examples
need — the list is below — and re-export them from a port-side module.

That module is written: `rpi/crates/rpi-js/js/pi-coding-agent.ts` re-exports
the pieces of pi's package entry that an extension can use, from the same
source files (the tool factories, the components, the themes, the frontmatter
helpers, the session manager, the compaction helpers, the skill helpers).
**It is not wired into the virtual module map yet**, because two runtime
problems remain, both measured:

1. `which/which.js` reads `process.env.OSTYPE` and finds `process.env` null:
   the bundle replaces the global `process` when it loads. The port's node
   surface publishes `globalThis.process` (`node_surfaces.js:145`) before the
   bundle runs, so something in the bundle overwrites it — that is what to
   find.
2. `packages/coding-agent/src/config.ts` calls
   `fileURLToPath(import.meta.url)`, and the url shim's `fileURLToPath`
   cannot read what the bundle hands it (the error is
   `Cannot read properties of undefined (reading 'pathname')`). The url shim
   needs to accept the bundle's `import.meta.url` as well as a `URL`.

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
