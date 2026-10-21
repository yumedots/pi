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
| `agent_before_settle`, `agent_settled` | `types.ts:1028-1037` | `rpi/crates/rpi-harness/src/agent_harness.rs` — the harness emits the boundary after the run's automatic work (the retry loop and the overflow recovery) and the settle when the run is done. The boundary's `entries` are empty, and its `continue` is `true` like the port's `turn_end`: the port cannot act on it either way |
| `tool_result` | `types.ts:1267` | `js_emitter.rs` — with the tool's content, its details, the error flag, the call's arguments and the tool's own usage |
| `tool_call` (**carries a result**) | `types.ts:1454` `ToolCallEventResult {block?, reason?, terminate?}` | `session.rs:915` — the tool-call hook publishes pi's payload and reads the answer back; a handler that returns `block` stops the call |
| `before_agent_start`, `before_provider_request`, `before_provider_headers`, `after_provider_response`, `provider_stream_event` | `types.ts:901-931` | `rpi/crates/rpi-extensions/src/provider_hooks.rs` — the provider hooks, where the data lives |
| `resources_discover` | `types.ts:725` | `interactive_tui.rs` — right after `session_start`, the way the original orders them; the answer's skill and prompt paths are loaded and merged into the session's resources |
| `ui_prompt_start`, `ui_prompt_end` | `types.ts:1042-1056` | `js_extensions.rs:1149` — around every dialog the extension opens |
| `session_info_changed`, `model_select`, `thinking_level_select`, `mcp_servers_change` | `types.ts:764`, `:1134`, `:1143`, `:746` | `js_extensions.rs:837`, `:741`, `:760`, `:961` — when the extension changes that state |
| `user_bash` | `types.ts:1153` | `interactive_tui.rs:572` — when the user runs `!command` |
| `session_start` | `types.ts:755` | `interactive_tui.rs:1346` — the reason still says `startup` for every start |

Every one of them reaches the extensions through one sink
(`rpi/crates/rpi-extensions/src/event_sink.rs`), so the provider hooks — which
live in the extension crate and know nothing about JavaScript — and the
harness's agent events arrive the same way. The sink also carries the answer
back, which is what `tool_call` and `before_provider_request` need.

The categories that still do not fire — **10 of the 41**:

```
project_trust            session_before_switch     session_before_fork
session_before_compact   session_compact            session_compact_failed
session_before_tree      session_tree               cache_warming_decision
```

| category | why |
| --- | --- |
| `project_trust` | the port has no trust prompt |
| `session_before_switch`, `session_before_fork`, `session_before_tree`, `session_tree` | the port does not switch, fork or navigate the session tree from an extension |
| `session_before_compact`, `session_compact`, `session_compact_failed` | the port compacts without asking the extensions |
| `cache_warming_decision` | pi's cache warmer has no counterpart in the port |

`context` and `context_with_system` fire, and they carry the messages; the
port's provider hook has no `transform_context` slot for the answer, so a
handler cannot yet replace the transcript before a call.

## The extension's own module

An extension's module is evaluated as a script, and `import.meta` is a
syntax error outside a module — pi's `doom-overlay` example reads it and
failed to load. The transpiler rewrites `import.meta` into the object the
evaluator provides (`rpi/crates/rpi-js/src/transpile.rs`:
`replace_import_meta`, which skips strings and comments), and the evaluator
passes the module's `url` and `filename` (`extension-host.ts`:
`loadModule`). The check is `an_extension_reads_import_meta`.

**The module scope carries no `__filename` and no `__dirname`.** The original
loads an extension as a module, where a declaration of either name is the
extension's own — and `doom-overlay` declares `__dirname` for its WAD file.
The evaluator used to pass both as parameters, so the extension's own
declaration was a syntax error: `Identifier '__dirname' has already been
declared`. Now the extension's declaration wins inside the extension's scope,
the way a bundler's per-module scope does. The check is
`an_extension_declares_its_own_dirname`.

## The npm packages

The host is an embedded V8 with a shim surface, not Node: there is no
`node_modules` to resolve from. The original resolves an extension's own npm
dependencies from the extension's own `node_modules`, with jiti
(`packages/coding-agent/src/core/extensions/loader.ts:576`).

The port publishes the packages it can: `ms` is small, pure and has no
dependencies, so the host has it (`rpi/crates/rpi-js/js/packages/ms.ts`,
wired at `extension-host.ts:417`). Every other package answers with a stub
that fails **when it is used**, naming the package
(`extension-host.ts:555`): the extension loads, and the failure says what the
port cannot do instead of looking like a bug in the extension.

The rule is the same one the shims follow: an import must never throw, and a
call must work or fail visibly. The checks are
`an_extension_imports_an_npm_package_the_host_publishes` and
`an_extension_imports_an_npm_package_the_host_cannot_provide`.

## A handler that throws

A handler that throws is reported to the host as `extension.error`, with the
extension's path, the event, the message and the stack, and the dispatch goes
on with the next handler — the original's rule
(`packages/coding-agent/src/core/extensions/runner.ts:1103`). The port used to
drop the error: the event sink threw it away and the user saw nothing. The
check is `a_handler_that_throws_is_reported`.

## The file system

The `fs` shim's call to the host did not encode its arguments, so the host
never saw the path: `writeFileSync` reported success and wrote nothing — a
silent data loss for any extension that writes a file. The shim now encodes
the arguments and reads the answer, and the check is
`an_extension_writes_a_file`.

## The node surface

Every shim in `rpi/crates/rpi-js/js/shims/` is published to the extensions,
not only to the bundle: the extension host imports all of them and puts them
in the builtins map (`extension-host.ts`: `NODE_BUILTINS`), so `node:net`,
`node:dgram`, `node:zlib` and the rest resolve for an extension. A builtin
that does not resolve kills the extension at load time, so the class is
closed by a test: `every_shim_is_reachable_by_an_extension`
(`rpi/crates/rpi-js/tests/extension.rs`) walks the shim directory, derives
the builtin name from each file and loads an extension that imports it.

## The four empty answers

`pi.getSettings()` answers the **file's content** — the original hands the
settings as the file holds them, not the effective set (which is a different
answer to a different question). `pi.getCommands()` answers one list: the
commands the extensions registered, the prompt templates and the skills, each
with its `source` and its `sourceInfo` — the original's list, which does not
carry the host's own slash commands. `ui.getAllThemes()` answers the
original's `system`, `dark` and `light` (the port's themes are built in, so
the path is empty, but the names are the original's), and `ui.getTheme(name)`
answers the **theme instance** — the name, the colour mode, the escape
sequences and the concrete colours.

The session's copies are the answer, and the host falls back to the file and
the preset list when the session has none: an **empty** copy is not the same
as an absent one, and shadowing the fallback with an empty object is what
left the settings and the themes empty.

The settings answer carries only the keys the file holds — the port's loader
fills every key it knows with a null, and the answer has to be the file's
content, not the loader's shape. The theme list carries no `path` where
there is no file: the original's type is `{ name: string; path: string |
undefined }`, so the path is absent, not null.

## What the module surface still does not carry

The port's re-export module publishes **56** of pi's package entry's **156**
runtime exports. The comparison is a script that builds both and compares the
exports; the hundred that are missing are:

- the **components** — safe one by one (`modes/interactive/components/<name>.ts`),
  but the barrel also pulls the components that reach for the session;
- the **tools** — safe one by one (`core/tools/<name>.ts`): `createReadTool`,
  `createReadToolDefinition`, `createFindToolDefinition`,
  `createGrepToolDefinition`, `createLsToolDefinition`,
  `createWriteToolDefinition`, `createEditToolDefinition`;
- the **session and the model** — `AgentSession`, `SessionManager`,
  `ModelRegistry`, `ModelRuntime`, `SettingsManager`, `ExtensionRunner`,
  `discoverAndLoadExtensions` and the rest: they reach for the network layer
  (`core/http-dispatcher.ts` → `undici`, whose CommonJS classes extend each
  other) and for pi's `config.ts`, which reads the package directory at import
  time;
- the **entry points** — `InteractiveMode`, `RpcClient`, `runPrintMode`,
  `runRpcMode`, `main`.

## The scope decisions

The port's lists are pi's lists **minus the features the port does not have**,
and the difference is deliberate:

| name | the original | the port |
| --- | --- | --- |
| `mcp` | pi's MCP extension, a built-in extension | **published** — the port has MCP support end to end, and its own built-in extension (`rpi/crates/rpi-js/js/pi-mcp-extension.ts`) registers the command under pi's name and does the port's real MCP work: it lists the session's servers and removes one |
| `llama` | pi's router for local llama.cpp models | not published — the port resolves models through the catalogue and the credentials, like any other provider; there is no router to command |
| `codemode`, `tool_search` | pi's built-in extensions, which register tools with the model | not published — the port has no code-writing tool and no tool-searching tool, and publishing the names would put rows in `pi.getAllTools()` that cannot be called |

If the port grows a code-writing tool, `codemode` comes with it.

## The tool metadata

`pi.getAllTools()` answers the tools with the metadata **the extension
registered**: its `promptGuidelines`, its `namespace`, its `annotations`, its
`exposure` and a `sourceInfo` with the extension's path, its `baseDir` and
`source: "auto"`. The harness's tool schema carries none of that, so the
extension host publishes it with the tool and the host merges it into the
list.

## The extension's own tools

A tool an extension registers has to be in the session's tool set, or the
model cannot call it. The JavaScript extension's tools are declared to the
model by `rpi/crates/rpi-cli/src/js_tools.rs`: the tool is published with the
schema the extension gave it, and calling it runs the extension's own
`execute` (`JsExtensions::call_tool`). The TUI adds them to the harness's
tool set and to the active tool names when the extensions load
(`interactive_tui.rs`).

**The order matters, and it was wrong.** The `session_start` dispatch used
to run on the TUI's own thread, before the tool wiring and before the
command list was published. A handler that reads the session — the active
tools, the commands, the settings — blocked the thread that was supposed to
fill them in, so the wiring never ran and the handler saw an empty session.
The dispatch now goes out last (after the tools and the commands are in the
session) and does not block the TUI: the handler may open a dialog, which
the TUI has to present.

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

`before_provider_request` publishes the **wire payload** — the request the
provider is about to send, in the provider's own field names (`model`,
`messages`, `tools`, `stream`, `max_completion_tokens`,
`prompt_cache_key`, `prompt_cache_retention`, `store`, `stream_options`) —
the way the original does. The native handlers keep the port's own internal
request: the native ABI is the port's contract, and an extension written
against pi watches the wire payload.

**The replacement is the answer the event sink gives back.** The JavaScript
host's sink answers with the handler's return value (the same answer channel
`tool_call` uses), so a handler that returns a payload replaces the request.
The port applies the returned payload field by field: the `messages` and the
`tools` it carries become the request's, and `max_completion_tokens` and
`temperature` become the request's. A field the handler left exactly as it
was changes nothing, so a handler that only logs the payload leaves the
request alone. The model cannot be changed this way — the provider call is
already bound to one — and that is the one field of pi's payload the port
does not take.

The replacement is asked and answered the way the dialogs are: the host makes
the request, the extension answers on its own thread, and the host waits for
the answer. The provider's thread is the one that waits (`build_stream_fn`),
never the TUI's, so a handler may open a dialog while it rewrites the
request.

The provider's own events reach the host through the same seam: the hooks
travel in `SimpleStreamOptions::hooks`, and the provider hands them the HTTP
response (`on_response`) and every parsed stream event
(`on_stream_event`). That is where `after_provider_response` (with the real
status and headers) and `provider_stream_event` (with the provider's own
parsed event) come from.

## What still differs

| gap | why | the original |
| --- | --- | --- |
| `session_start`'s `reason` is always `startup` | the port does not resume, fork or reload a JavaScript session, so it has no other reason to report | `types.ts:758` |
| `turn_end`'s `entries`, `context` and `messageEntryId` are empty | the port's harness has no session projection to hand the extension | `types.ts:1065` |
| `agent_before_settle` cannot append entries and cannot ask for one more provider request | the port's boundary is a notification, not an actionable one | `types.ts:1028` |
| `before_provider_request` cannot change the model | the provider call is already bound to one model; every other field of pi's payload is applied | `types.ts:901` |
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

The port now publishes **pi's own modules** to the extensions.

| module | the original | the port now |
| --- | --- | --- |
| `@earendil-works/pi-coding-agent` | `packages/coding-agent/src/index.ts` — the package entry, 154 runtime exports | `rpi/crates/rpi-js/js/pi-coding-agent.ts` — pi's real modules, re-exported |
| `@earendil-works/pi-tui` | `packages/tui/src/index.ts` — 92 exports | `rpi/crates/rpi-js/js/pi-tui.ts` — pi's own TUI code |
| `@earendil-works/pi-ai` (and `/compat`) | `packages/ai/src/compat.ts` | `rpi/crates/rpi-js/js/pi-ai.ts` — pi's own |
| `@earendil-works/pi-agent-core` | `packages/agent/src/index.ts` | `rpi/crates/rpi-js/js/pi-agent-core.ts` — pi's own |

**The bundle is 1.6 MB**, and six blockers had to be cleared to get there.
Each of them was a value crossing a boundary in a form the other side cannot
use, and each is now a rule in the tree:

| blocker | the fix |
| --- | --- |
| no npm package resolved (the bundler runs with `platform: "neutral"`, whose `mainFields` is empty) | `mainFields: ["module", "main"]` and `nodePaths` in the bundler |
| almost no node builtins | ~40 shims in `rpi/crates/rpi-js/js/shims/`, all published to the extensions |
| `process.env` arrived as null | the environment is read when it is used, and the bundler defines `process` as the host's object |
| `graceful-fs` patches the `fs` module | the `fs` shim is a mutable CommonJS module (`export =`) |
| `createRequire` threw when it was *obtained* | the shim answers for the modules the host has and throws only when they are *used* |
| `import.meta.url` | defined in the bundler |
| pi's `config.ts` reads the package directory at import time | the bundler substitutes the port's module (`rpi/crates/rpi-js/js/pi-config.ts`) for pi's; the vendored package's README and package directory are baked in at bundle time |
| the network layer (`undici`) | the components and the tools are imported one by one — the barrels pull the ones that reach for the session — and `cli/args.ts` (→ `core/settings-manager.ts` → `core/http-dispatcher.ts`) is gone |

**The rule the whole thing follows, from the shims up:** an import must never
throw, and a call must either work or throw *visibly* to the caller. Two
shims broke it — `createRequire` (threw when obtained, and a module-scope call
took the whole host with it) and `fs` (reported success and wrote nothing) —
and both are fixed, with `every_shim_is_reachable_by_an_extension` walking
the shim directory so a shim that is not published fails there.

**A subpath the host does not publish no longer kills the extension.** An
import of `@earendil-works/pi-ai/providers/anthropic` resolves to an empty
module (`extension-host.ts:404`): the extension loads, and only the names it
wanted are missing. pi maps every subpath it publishes, so this is a
port-side gap being made forgiving rather than fatal. The check is
`rpi/crates/rpi-js/tests/extension.rs:153`.

**The export list was checked against pi's, name by name.** pi's
`packages/coding-agent/src/index.ts` publishes **156** runtime exports; the
port's `js/pi-coding-agent.ts` publishes **66**. The 90 that are missing are
the session, the CLI and the provider registries — `AgentSession`,
`SessionManager`, `InteractiveMode`, `RpcClient`, `ExtensionRunner`,
`ModelRuntime`, `ModelRegistry`, `SettingsManager`, `DefaultPackageManager`,
`DefaultResourceLoader`, `ProjectTrustStore`, `main`, `runPrintMode`,
`runRpcMode` and the rest. They cannot be published: the barrels behind them
pull `core/http-dispatcher.ts` (→ `undici`, whose CommonJS class extension the
bundler cannot hold) and pi's `config.ts`, which reads the package directory
at import time. The port's own module substitutes for `config.ts`; the
network layer has no substitute.

**What the missing 90 cost the examples was nothing but the names they
import.** `todo.ts`, `subagent/index.ts` and `tic-tac-toe.ts` needed
`StringEnum`; `truncated-tool.ts` needed `formatSize`, `DEFAULT_MAX_BYTES`,
`DEFAULT_MAX_LINES` and `truncateHead`; `gondolin/index.ts` and `ssh.ts`
needed `createReadTool`; `minimal-mode.ts` needed `createFindToolDefinition`.
All of them are published now — the tools one file at a time
(`core/tools/read.ts`, `find.ts`, `grep.ts`, `ls.ts`, `write.ts`, `edit.ts`,
`bash.ts`) and the truncation names from `core/tools/truncate.ts`, which is
where they live. (`bash.ts` only *imports* them, so a re-export from it
published `undefined`: the name was there and the value was not.)

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
