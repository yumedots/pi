# rpi Rust Extension Development Best Practices

This document is the model-readable specification for creating Rust `cdylib`
extensions with rpi. An extension is a native Rust dynamic library that
registers tools, event handlers, resource discovery, Providers, and renderers
through a stable C ABI (`rpi-plugin-sdk`); the host (the `rpi` CLI) is
responsible for loading and lifecycle. See the `agent` topic of `docs` for the
default structure of a complete Agent project; this guide focuses on the ABI and
lifecycle of extensions themselves.

## 1. Extension Model Overview

| Item | Native Rust extension |
| --- | --- |
| Installation | `rpi install crate-name` (prebuilt protocol); `--build` / `--path` (source) |
| Entry point | The `rpi_plugin_register` C ABI symbol |
| Development feedback | `rpi dev` watch + hot reload; `rpi dev-local` for isolated debugging |
| Static resources | `resources_discover` or shipped with the project under `.rpi` |
| Runtime environment | Native dynamic library, with the current user's permissions |
| Use cases | Local tools, system integration, performance-sensitive work, or pure Rust projects |

Extensions should follow capability detection: only call capabilities the host
explicitly provides, and check whether the corresponding registration slot in
`PluginApi` is `Some`. When a capability is missing, return a clear error and
degrade gracefully; do not panic, use null pointers, or rely on `undefined`
semantics.

## 2. Recommended Structure

```text
my-rpi-extension/
├── Cargo.toml
├── README.md
├── src/
│   ├── lib.rs
│   ├── tool.rs
│   └── error.rs
└── tests/
    └── behavior.rs
```

### Cargo.toml

```toml
[package]
name = "my-rpi-extension"
version = "0.1.0"
edition = "2021"
license = "MIT"
repository = "https://github.com/example/my-rpi-extension"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
rpi-plugin-sdk = "0.1"
serde_json = "1"
```

`cdylib` is the artifact the host loads; also keep the `rlib` so that Rust
integration tests are easy to write. The extension boundary depends only on
`rpi-plugin-sdk`; do not depend on `rpi-cli`, `rpi-extensions`, or harness
internal modules, otherwise the plugin becomes coupled to the host
implementation.

## 3. ABI Entry Point

The host only loads the unified C ABI symbol `rpi_plugin_register`. An
extension uses `export_plugin!`, registers capabilities through the same
`PluginApi`, and calls `api.declare` to declare its priority/platform. The SDK
checks `abi_version` and `struct_size` before registration; optional trailing
slots missing on older hosts are filled in as `None`, so plugins can degrade
accordingly. When the version is incompatible or required fields are
incomplete, a non-zero status is returned and the host reports a load failure.

```rust
rpi_plugin_sdk::export_plugin!(|api| {
    if let Some(declare) = api.declare {
        let status = declare(rpi_plugin_sdk::StbStringRef::from_str(
            r#"{"priority":60,"platforms":["linux"]}"#,
        ));
        if status != 0 {
            return status;
        }
    }
    let Some(register_tool) = api.register_tool else {
        return -1;
    };
    // Build the StableToolSchema and the execute/poll/cancel/destroy function
    // table, then call register_tool. See examples/plugin-stub for a complete
    // implementation.
    let _ = register_tool;
    0
});
```

The JSON passed to `declare` supports `priority` (a number; larger runs first)
and `platforms` (an array of strings such as
`["linux","windows","macos"]`); the host skips non-matching platforms when
dispatching event handlers.

### Capability Detection

Every registration slot is an `Option`. Before registering, check that the
vtable slot is `Some` and return a clear error when it is missing; do not rely
on null pointers or panics to express "unsupported". The host returns a
structured error for unknown runtime action IDs and does not dispatch them.
Runtime actions use the SDK's `RuntimeActionId` definitions (including
`GetCliFlag` and `UiDialog`); do not assume numeric ranges on your own.

### Stand-alone Sub-tasks

`GetExecutionContext` (23) returns the current model identity, thinking, active
tools, cwd, and session ID; it does not include credentials, authentication
headers, or endpoints. `ChildAgent` (24) dispatches on `op`:

- `start`: `task` (required, at most 20,000 bytes), `role`, `maxTurns` (1–32,
  default 8), `timeoutSeconds` (10–1800, default 300), plus an optional subset
  of the parent's active tools named `tools`. It immediately returns a
  `childId`, an independent `sessionId`, and `status: running`.
- `poll`: pass in `childId`, consume the `deltas` array, and obtain the
  `running/done/failed` status. After `done`, also check `result.status`,
  `result.text`, and `result.turnLimited`.
- `cancel`: sets the cancellation signal; `dispose`: cancels and releases the
  handle. Every terminal state must be disposed.

Sub-tasks inherit the effective provider's private binding, the system
prompt/resources, the project cwd, and permission hooks; they do not reload the
default configuration and do not enter the parent transcript. Permission
approvals and user questions use the parent UI, and without an interactive
consumer they are not allowed by default. `delegate_task` is removed from the
sub-tool registry. Plugin tools still belong to the parent host, and
`__rpi.sessionId` is still the parent's extension state space, so it must not
be mistaken for a child ID. Handles are isolated per plugin owner; they are
cleaned up when the parent ends/is cancelled, on session switch, on shutdown, or
on plugin reload. Each host keeps at most 16 tasks, and text deltas plus the
final report share 4 MiB with at most 8192 deltas. This is not an OS-level
security sandbox; read-only tasks should narrow the tool scope and use
permission rules.

Call synchronous runtime actions from a worker thread to avoid self-deadlock
in a single-threaded Tokio executor. ChildAgent must also be bound to the
`__rpi.runtimeHandle` / `runtimeKey` of the current tool call: pass an opaque
handle as the action's user_data and include `__rpiRuntimeKey` in the
arguments; do not cache it across calls or output it to the model. Only
registration-level, invalidated, and child-originated calls are rejected
(including aliased tools), and the tool subset cannot be bypassed through the
root host. A correct parent capability after cancellation only permits
poll/cancel/dispose to reclaim existing tasks and does not permit start; a
queued start also inherits the original call's cancellation. Synchronous tool
callbacks are bound automatically by the host. Background tools, providers, and
approval drivers keep the DLL and its arguments alive themselves; after the
two-second foreground cleanup grace period they still occupy an active slot
until they actually exit. The host's runtime binding weakly holds the parent
harness; a candidate reload rollback never leaves a dereferenceable stale bridge
pointer. When an old host does not support a new action, it clearly prompts for
an upgrade and must not silently fall back to a subprocess that might switch
models. See `docs/extensions/subagents.md` in the repository for the full
protocol and real DLL tests.

### Appending Context During a Run

The `{"customType": "...", "data": {...}}` form of `AppendEntry` only stores
extension data; by default it does not enter the model context. The
`{"message": <AgentMessage>}` form appends a session message but does not
trigger a new model reply. Messages appended during a run first enter a
persistent queue; they are written to the history and displayed only after all
tool results of the current turn have been committed, and they become readable
only on the next model request.

The returned `entryId` is a stable reserved ID; querying that entry while it is
queued may return nothing. A tool may wait for `AppendEntry` to return; it does
not wait for the tool or the whole run to finish. Cancellation and session
resume do not discard queued messages that have already been accepted.

### SendMessage Delivery Options

`SendMessage` accepts the existing `{"message": <AgentMessage>}` /
`{"text": "..."}` forms, and also accepts Pi's custom message shape:
`customType`, `content`, `display`, `details`. `content` may be a string or an
array of text/image blocks; a missing or null value is normalized to an empty
array.

Options may be placed in an `options` object or at the top level of the
arguments; do not mix the two forms:

```json
{
  "message": {"customType": "goal-state", "content": "Goal state updated", "display": true},
  "options": {"triggerTurn": false}
}
```

| Option | Behaviour |
| --- | --- |
| `triggerTurn` omitted | When idle, only append context; while running, it goes to the steering queue by default |
| `triggerTurn: true` | When idle, start a model run; while running, queue according to `deliverAs` |
| `triggerTurn: false` | Only update the context; while running, submit after the current tool batch ends; do not proactively append a model reply |
| `deliverAs: "steer"` | Default mode; inject after the current tool batch ends |
| `deliverAs: "followUp"` | Inject after the current task completes, then keep processing |
| `deliverAs: "nextTurn"` | Hold until the next explicitly started run, joining before the new input; takes precedence over `triggerTurn` |

The return value distinguishes `status: "appended"`, `status: "queued"`, and
the existing run result statuses. Appending and queueing both return a stable
`entryId`; querying the entry before a queued message is committed may return
nothing. The `deliverAs` in a queued result indicates the delivery method; a
silent context update returns `queue: "context"`. Steering/follow-up do not
re-enter a tool that is already executing, and `nextTurn` is not consumed early
by an auto-resumed run.

The default idle send now matches Pi and no longer automatically requests the
model. Calls that previously relied on an immediate reply from the default send
should explicitly pass `triggerTurn: true`.

## 4. Tool Lifecycle: execute → poll → cancel → destroy

A tool exports four `extern "C"` functions, driven by the host according to a
fixed protocol:

- `execute` parses the JSON passed in by the host (an owned `StbString`,
  released with `free_with`), and creates a handle that is independent per
  invocation (`Box::into_raw`).
- `poll` must be non-blocking; it returns `Pending` when not finished, and
  `Done` or `Err` when finished. `partial_cb` is invoked synchronously inside
  poll, and the host forwards partial results in real time while waiting for a
  terminal state. The host briefly backs off on Pending, and after cancellation
  it waits for the driver to end without busy-spinning; a late success does not
  override a cancellation.
- `cancel` only sets a thread-safe cancellation flag; it must be idempotent and
  must not release the handle.
- `destroy` is called by the host exactly once at the end and releases the
  handle (a null pointer is a no-op).

Ownership protocol:

- `StbString`s produced by the host (execute's params, event payloads) are
  released by the plugin through the host's `free_string`.
- `StbString`s produced by the plugin (the done result, partial progress, the
  out of `resources_discover`) are released by the host through the
  `plugin_free_string` supplied at plugin registration.
- No `extern "C"` boundary may unwind; the plugin catches panics internally
  and converts them into error results.

A complete, runnable ABI template lives in `examples/plugin-stub/src/lib.rs`.
When creating a new tool, first copy the lifecycle skeleton, then replace the
parameter schema and the domain logic; do not redesign the ownership protocol.

### Host Context Injected into Tool Arguments

Before handing the arguments to the plugin, the host **adds** a reserved key
`__rpi` (`rpi_plugin_sdk::HOST_CONTEXT_KEY`) to the JSON arguments of that
invocation:

```json
{ "action": "add", "text": "…",
  "__rpi": { "cwd": "D:\\Projects\\pi-rust",
             "sessionId": "01adb026-7230-708b-855b-91eab6b056b8" } }
```

- **The model cannot see it, and cannot write it.** The injection happens after
  the model's arguments are parsed and before `execute`; it does not enter
  `ToolExecutionStart`/`Update` events and does not enter the session log; if
  the model happens to pass a key of the same name, the host's value wins.
- **Both fields may be missing.** There is no `cwd` when the working directory
  is unavailable; ephemeral sessions and old hosts that predate this injection
  have no `sessionId`; the whole key may be absent as well.
- **So the tool's argument type must tolerate unknown top-level fields.** Using
  `serde_json::Value` for the values satisfies this naturally; a struct that
  declares `#[serde(deny_unknown_fields)]` for its arguments will fail
  outright.
- Built-in tools do not go through this path — they receive
  `ExecutionToolContext` directly from the harness.

A plugin that needs "one piece of state per session" should key on `sessionId`
(`rpi-todo` stores `.rpi/todos/<sessionId>.json`, one file per session); when it
is unavailable, fall back to the project level and **state that in the reply**;
do not invent a shared pseudo-session — that is precisely the problem it is
meant to solve.

## 5. Event Handlers, Resource Discovery, and Providers

### Event Handlers

Subscribe via `api.register_event_handler` by `EventTag` (36 kinds):

- **Session lifecycle**: `SessionStart`, `SessionBeforeSwitch`,
  `SessionBeforeFork`, `SessionBeforeCompact`, `SessionCompact`,
  `SessionShutdown`, and so on.
- **Agent loop**: `BeforeAgentStart`, `AgentStart`, `AgentEnd`, `AgentSettled`,
  `TurnStart`, `TurnEnd`, `MessageStart`/`MessageUpdate`/`MessageEnd`,
  `ToolExecutionStart`/`Update`/`End`, `ToolCall`, `ToolResult`, `UserBash`,
  `Input`.
- **rpi-specific / UI**: `BeforeTuiStart` (before TUI initialization),
  `UiPromptStart`/`UiPromptEnd`.

A handler receives a `StablePluginEvent` and must not free the strings inside
the event (the host frees them uniformly after the fan-out). Returning `0`
means success; returning `EVENT_HANDLER_ABORT` means veto.

### Lifecycle Veto

`BeforeTuiStart` is an rpi-specific hook with veto semantics: the first
handler that returns `EVENT_HANDLER_ABORT` aborts startup, and the CLI exits
with exit code `3` (used for "an external connection must be established before
entering the TUI"). The vetoes of `SessionStart`/`SessionShutdown` are only
advisory. Dispatch has a timeout, so a slow handler will not block the main
flow indefinitely.

### Resource Discovery

`api.register_resources_discover` registers a handler; the host fans out to
all registered handlers on `startup`/`reload` and merges the returned
`{skillPaths, promptPaths, themePaths}`. An error from a single handler does
not abort the fan-out. `out` is a plugin-owned `StbString`, reclaimed by the
host through the `plugin_free_string` given at plugin registration.

### Rewriting the System Prompt at Runtime

`api.register_before_agent_start` registers a system prompt transformer,
corresponding to pi's `before_agent_start` handler returning `systemPrompt`
(which becomes the `forceSystemPrompt` of that run). This is the only proper
entry point for a plugin to change the system prompt **at runtime**:

```rust
// event_json carries prompt / imageCount / sessionId / host, as well as the
// **current** systemPrompt.
extern "C" fn on_before_agent_start(
    event_json: StbStringRef,
    out: *mut StbString,
    user_data: *mut c_void,
) -> i32 {
    rpi_plugin_sdk::guard_or(1, || {
        let env: serde_json::Value =
            serde_json::from_str(unsafe { event_json.as_str() }).unwrap_or_default();
        let current = env["systemPrompt"].as_str().unwrap_or("");
        // The return value is a **replacement**, not an append: to append, read
        // the current value and concatenate it back (pi requires the same).
        let next = format!("{current}\n\nThis repository prefers `just test` over `cargo test`.");
        unsafe { *out = StbString::from_string(json!({ "systemPrompt": next }).to_string()); }
        0
    })
}
```

Semantic points (aligned with pi):

- **Replacement, not append.** The returned text becomes the prompt. To append,
  you must read the `systemPrompt` from `eventJson` yourself and concatenate —
  the host does not preserve the original text for you.
- **Chained in registration order.** Each later handler receives the result
  returned by the previous handler.
- **A single handler failing is not fatal.** When a handler returns a non-zero
  value or panics, the prompt keeps the result of the previous handler and the
  fan-out continues (the host logs it and skips it).
- **Only that run is affected.** The host re-derives the prompt from the
  session state on every turn, and the plugin's result is not persisted.
- **Counted once per user prompt.** A single prompt may trigger multiple
  provider calls (the tool loop); the transformer runs only before the first
  turn and caches the result, avoiding drift in the middle of a run.
- **Returning an empty object/empty string means no change.** A plugin that
  only wants to observe may return nothing; explicitly returning an empty
  string means "clear the prompt", and that is honoured.

`out`, like the out-param of other handlers, is owned by the plugin and
reclaimed by the host via `plugin_free_string`. This slot was added at the end
of the struct and may be `None`: a plugin targeting older hosts should detect
it before registering (see §3 Capability Detection), while the host does not
enter this path at all when no plugin registers.

### Providers and Renderers

See the "Provider Integration Specification" at the end of this document for the
catalogue, authentication, execution binding, and acceptance requirements of
inference providers.

`api.register_provider` injects a custom LLM Provider (`provider_id`/`base_url`/
`api_style` plus `request_fn`). `register_message_renderer`/
`register_markdown_transformer`/`register_entry_renderer` register message
rendering capabilities. All of these slots may be `None` and must be detected
before use.

`api.register_streaming_provider` injects a **streaming** Provider. At
registration you likewise provide a provider ID, an endpoint, the API style,
and a string release callback; the streaming request fn additionally has a
per-chunk callback `emit`, `emit_user_data`, an optional control plane
`control`, and a `completion` that is always `None` on the current host. The
plugin calls `emit` while the request is still running, pushing the deltas to
the host:

```json
{"type":"text_delta","contentIndex":0,"delta":"hello "}
{"type":"thinking_delta","contentIndex":1,"delta":"weighing"}
{"type":"toolcall_delta","contentIndex":2,"delta":"{\"path\""}
```

The host immediately maps them to `AssistantMessageEvent`s (`TextDelta`/
`ThinkingDelta`/`ToolCallDelta`, and so on), so the TUI starts rendering while
the model is still generating instead of waiting for the whole message. The
available `type`s are: `start`, `text_start`/`text_delta`/`text_end`,
`thinking_start`/`thinking_delta`/`thinking_end`,
`toolcall_start`/`toolcall_delta`/`toolcall_end`, `usage`; an unknown `type`
is ignored (forward compatibility).

Conventions:

- **`out` is still the final message.** The callback only carries deltas; the
  complete `AssistantMessage` written to `out` when the plugin returns is the
  payload of the terminal `Done`/`Error`. The host inserts a `Start` before the
  terminal state, so the event stream is valid even if the plugin never emits
  a single chunk.
- **Callback ownership matches that of tool partials.** Every chunk is a
  plugin-allocated `StbString`, reclaimed by the host through the
  `plugin_free_string` given at registration; `emit`/`emit_user_data` are
  valid only for the duration of this request and the plugin must not keep
  them.

This slot is likewise appended at the end of the struct and may be `None`: when
targeting an older host, degrade to `register_provider` (one-shot) rather than
refusing to load. When the same `provider_id` is first registered one-shot and
then registered as streaming, the streaming registration replaces the record in
place (streaming is a superset of one-shot). A complete, runnable skeleton can
be copied from `on_provider_stream_request` in
`examples/plugin-stub/src/lib.rs`.

#### Cancellation: One Method, the Plugin Decides

Long generations need to be interruptible. **There is no separate
"cancellable" registration**: `register_streaming_provider` has only one method
with one signature, and the request fn always receives a `control` argument
(the host-provided synchronous control plane). Whether to poll it is the
plugin's own decision.

```rust
// Between SSE frames (a real provider usually blocks on a socket read here):
if (control.is_cancelled)(control.user_data, ProviderChunkKind::Content as u32) != 0 {
    return 1; // The caller has already gone away; stop generating
}
```

- `is_cancelled(user_data, chunk_kind)`: a non-blocking poll. Pass `Content`
  (0) for "model output", and `Structural` (1) for closing frames such as
  `start`/`*_end`/`usage`. After cancellation the host confirms structural
  frames and rejects content frames; closing frames emitted after the terminal
  state are discarded. The cancellation terminal state preserves the
  already-forwarded content, the model identity, and the usage. The plugin
  holds the DLL reference until the request returns, and a later successful
  write to `out` does not override the cancellation terminal state.
- `wait_cancelled_ms(user_data, timeout_ms)`: the blocking variant, for loops
  that cannot poll; when already cancelled it returns immediately instead of
  sleeping for the full timeout.

The host's cancellation signal comes from `options.signal` (the same
`CancellationToken` as for built-in providers, cancelled by the agent loop
when the user interrupts). After cancellation the host: latches the control
plane, stops forwarding content deltas, **immediately** emits the terminal
`Error { reason: Aborted }` and ends the event stream — it does not wait for a
complete generation that nobody wants. A non-zero return from `emit` for a
content frame counts as the same signal, and the plugin may exit accordingly.

Polling `control` is **optional**, and both styles are valid:

- **Not polling** (fire-and-forget): the plugin pushes the entire output as
  usual. On cancellation the host still stops forwarding content frames and
  immediately ends that turn; the plugin merely spends the tokens it has
  already produced.
- **Polling**: the plugin exits at the earliest checkable point, saving the
  remaining generation.

`control` may be `null` (for hosts that do not support a control plane); treat
that as "not cancellable" and do not refuse to load.

The `completion` parameter is **always `None` on the current host**: this host
does not allow a plugin to keep calling back after the request fn has returned
(that would let the callback pointer outlive the call). The plugin must finish
up inside the request fn and write `out`; the parameter is kept in the ABI so
that future hosts can extend it without changing the signature.

A plugin simply degrades step by step, streaming → one-shot:

```rust
if let Some(register) = api.register_streaming_provider { /* streaming, optionally polling control */ }
else { /* register_provider, one-shot */ }
```

You can copy a skeleton from each of `on_provider_stream_request` (no polling)
and `on_cancellable_provider_stream_request` (polling) in
`examples/plugin-stub/src/lib.rs`.

## 6. Rust Tool Design Best Practices

1. Write the domain logic as ordinary Rust functions; the FFI functions only
   handle conversion, lifecycle, and error mapping.
2. Write `rlib` unit tests for the ordinary logic; write at least one host
   smoke test for ABI registration, loading, and unloading.
3. Use the same field names in the schema and the implementation, reject
   unknown fields, and set upper bounds for paths, URLs, commands, counts, and
   output sizes.
4. `poll` must not perform long blocking work. Put expensive work into
   threads/tasks and let the handle hold the state; the cancellation flag must
   be able to end the task in finite time.
5. Use explicit synchronization for global mutable state; do not store session
   or tool-call state in unprotected `static mut`.
6. Runtime actions, providers, renderers, event handlers, and resources
   handlers are all optional capabilities; check the vtable slot before
   registering.
7. Return non-zero when plugin registration fails; return a structured error
   when a single tool execution fails, and never bring down the whole host.
8. The README should document the tool schema, permission boundaries,
   persisted files, network access, supported platforms, and how to uninstall.

## 7. Developing with rpi dev

Run this in the extension crate directory:

```bash
rpi dev
```

rpi identifies the current `cdylib` through Cargo metadata; after the first
build it places a versioned copy in the workspace `.rpi/extensions/.dev/`,
starts the normal TUI, and watches `src/`, `build.rs`, the package/workspace
`Cargo.toml`, and `Cargo.lock`. When the sources change it rebuilds
automatically and goes through the existing reload flow; if the build fails,
the currently loaded version is kept.

A workspace with multiple extensions must explicitly select the package:

```bash
rpi dev --package rpi-todo
rpi dev -P rpi-webfetch
```

Other modes:

```bash
rpi dev --release
rpi dev --no-watch
rpi dev-local
rpi dev --package rpi-todo -- --model gateway/model
```

Use `rpi dev-local` (equivalent to `rpi dev --local-only`) when debugging a
single extension. It loads only the currently compiled extension, the
skills/prompts of the current project directory, and the skills/prompts
discovered by that extension; it does not scan global extensions, installed Pi
packages, or other projects' resources, so that same-named commands and
irrelevant commands do not interfere with debugging. Built-in commands
(including `/reload`) remain available. When there is no Cargo cdylib, it
degrades gracefully to skills-only mode.

Running `/reload` in the TUI forces a Cargo build to run again and then loads
the newly staged artifact. On Windows an already loaded DLL cannot be
overwritten in place, so do not manually copy the Cargo target DLL to a fixed
file name; `rpi dev`'s versioned staging performs the switch safely and cleans
up after the session exits and the loader is released.

## 8. Resource and Configuration Conventions

Project-level resources live in `.rpi/`. For resources with the same name,
the priority is: definitions inside the project take precedence over `.pi`,
the project takes precedence over the global scope, and packages come last:

```text
.rpi/
├── SYSTEM.md
├── APPEND_SYSTEM.md
├── settings.json
├── skills/
├── prompts/
├── themes/
└── extensions/
```

Dynamic `resources_discover` suits deciding paths based on the runtime
environment; for fixed resources prefer the manifest or the conventional
directories, so that the installer, the welcome page, and `/context` can
discover them before the extension code runs.

### Custom Load Paths

A project-level `.rpi/settings.json` can declare additional resource paths; no
other compatibility fallback is needed. The paths are relative to the project
root, and configured paths come before the conventional directories:

```json
{
  "skills": ["./team-skills"],
  "prompts": ["./prompts/shared"],
  "extensions": ["./target/debug"],
  "packages": ["./packages/review-tools"]
}
```

The keys `skillDirs`, `promptDirs`, and `extensionDirs` are the older
spellings of the same three path arrays and are still read. The global
`~/.pi/agent/settings.json` supports the same `skills`, `prompts`, and
`extensions`, where relative paths are relative to the global agent directory.
Project configuration takes precedence over global configuration; `.rpi`
resources and settings come before `.pi`.

A single run can explicitly add paths:

```bash
rpi --skill ./extra-skills
rpi --prompt-template ./extra-prompts
rpi --extension ./target/debug/my_extension.dll
rpi --extensions-dir ./target/debug
```

`--skill`, `--prompt-template`, `--extension`, and `--extensions-dir` can all be
repeated. Additional Rust extension directories can also be configured via
`RPI_EXTENSIONS_DIR`; use semicolons as the separator on Windows and colons on
Linux/macOS. The command line and environment variables suit local
development, CI, and troubleshooting; for team-wide shared configuration use
the project `.rpi/settings.json`.

## 9. Release Checklist

- `cargo fmt --check`, `cargo clippy --all-targets`, and `cargo test` pass.
- `crate-type` includes `cdylib`, and `export_plugin!` is used to export
  `rpi_plugin_register`.
- It depends on a compatible published version of `rpi-plugin-sdk` and links
  no host-private crates.
- `rpi dev --no-watch` can compile, load, and register the expected tools.
- The clean install path `rpi install <crate> --build --force` passes.
- Linux/macOS/Windows builds are verified by CI, and the README states the
  support matrix.

## 10. Model Execution Rules

When the model receives a task to "create an rpi Rust plugin, extend the
tools":

1. First call `docs` to look up `authoring` (extension development) or
   `debugging` (debugging).
2. Read the existing manifests, SDK version, and neighbouring extension
   conventions in the current repository; do not guess APIs.
3. Prefer copying the minimal skeleton from `examples/plugin-stub`.
4. Implement the domain logic and boundary tests, and only then hook up the
   loader/ABI.
5. Use `rpi dev --no-watch` and `rpi install <crate> --build --force` for a
   real smoke test.
6. Do not claim that unverified Pi capabilities are fully compatible; clearly
   document the degraded behaviour.

## Provider Integration Specification

The unified production package is `rpi-providers`; a single installation entry
point covers DeepSeek, OpenRouter, llama.cpp, and Proxy. Prefer adding a module
inside the package for a new vendor; only the root module exports one
`export_plugin!`, and the modules share the registration bridge. Provider IDs,
the catalogue, and credentials stay independent. Only single-provider tutorial
samples use `export_provider!`.

Full specification: [Provider Integration Specification](https://github.com/bigfish1913/pi-rust/blob/feature-stream-porider/docs/extensions/provider-integration.md). When creating an inference extension,
prefer copying the official provider package example, see
[rpi-providers](https://github.com/pi-rust/rpi-package/tree/feature-1014/packages/rpi-providers);
for general-purpose tool extensions use `plugin-stub` instead. The current
integration conventions are as follows.

### Approach and Catalogue

When only the endpoint, model, and key of an already supported protocol change,
prefer `models.json`; when an installable catalogue, an authentication policy,
or vendor logic is needed, use a standalone package. New vendors are not added
as default dependencies of the CLI. The Provider handles inference, auth handles
credentials and the login flow, and the two are registered independently.

Declare the `id`, the complete `rpi_ai::Model` array `models`, the optional
`apiKeyEnv`, and `requiresAuth` (defaulting to `true`) through the `providers`
array of `declare`. Construct with `Model::new` and then serialize; the
shorthand objects of models.json must not be used. The provider ID, each
model's `provider`, and the actual registration ID must be consistent; the
model ID is the name sent to the server. Anonymous services must explicitly
set `requiresAuth: false`, and the protocol client must also allow anonymous
access — changing only the catalogue declaration is not enough.

The catalogue only takes effect after the same plugin successfully registers
the corresponding provider; on a name conflict the first implementation and
its catalogue are kept. Registration and catalogue discovery do not require
credentials; the host loads extensions and merges models.json overrides before
a model is selected. `--list-models` can show the catalogue without
credentials; `--no-extensions` disables both implementations and declarations.

### Factory and Private Execution Binding

Within the unified package, reuse `crate::registration::register_provider!`; a
single-provider tutorial package may use `rpi_plugin_sdk::export_provider!`,
which requires explicitly enabling the `provider` feature that the SDK
disables by default. The module provides
`fn(&Model, &SimpleStreamOptions) -> Arc<dyn Provider>`. OpenAI-compatible
integrations can reuse
`rpi_plugin_sdk::provider::completions(model, options, anonymous)` without
copying an SSE parser. The host-private `ProviderFactory` uniformly selects
between an extension and a built-in protocol; it is not an interface that
plugins need to implement. Runtime dependencies use `rpi-ai` and
`rpi-plugin-sdk` with the `provider` feature enabled, and do not depend on
`rpi-cli`; the host loader may serve as a test dependency.

The descriptions returned by the public catalogue, the current model, and
`Provider::models()` after configuration carry no request headers. The
host-private `ExecutionBinding` holds the actual endpoint, the model request
headers, and the default authentication, and is restored before execution
according to provider / API / model ID; modifying the public description
cannot redirect the bound credentials. `base_url` remains public for display,
and options explicitly passed per request still take effect under the existing
rules. A plugin must use the model / options passed with the request and must
not switch to a hardcoded endpoint or to a key from the process environment.

### Authentication and Reload

The host resolves default credentials by provider ID: the `--api-key` of the
selected provider → a valid key in `auth.json` / OAuth → `models.json` → the
declared `apiKeyEnv` → explicitly permitted anonymity. The protocol name does
not determine authentication and does not inherit `OPENAI_API_KEY`; blank
values, unresolved references, and expired tokens do not count as usable. The
catalogue must not contain credentials; request parameters, tokens, and
private request headers must not enter logs, ordinary events, or error text.
OAuth vendor flows are integrated separately via `register_oauth_provider`, and
the host handles the generic commands and storage.

`auth check`, `/provider`, and actual requests use the same authentication
resolution. `auth check` only inspects local state; it does not contact the
server or refresh tokens; the exit codes are 0 for ready, 1 for missing
credentials, and 2 for a configuration error. `/provider <id>` and the list
selection switch the current session immediately and save the default model;
when authentication is missing or the switch fails, the original session and
defaults are kept. `/model` selects a specific model; `/provider remove`
deletes the configuration, and uninstalling a package uses
`rpi package unlink`. Logging out of an API key does not clear environment
variables or models.json.

A `/reload` that involves a provider package rebinds the runtime, credentials,
endpoint, and public catalogue; when the current package disappears or cannot
be resolved again, an error is returned and the old session is kept. Sessions
that use only built-in providers still use the existing resource reload logic,
and no promise is made to re-resolve every provider configuration; a full
reload is not yet an atomic generation switch.

### Streaming and Acceptance

Deltas must be emitted during generation, the final `out` still provides the
complete message, and the host produces exactly one Done / Error. Cancellation
must promptly stop the request and preserve partial output; calling `emit`
after a synchronous request fn returns is forbidden. Use the bridging library
to handle ABI string release, cancellation, and the runtime lifecycle;
hand-written ABI code must follow the protocol described above.

Acceptance must include real dynamic library loading, a gated test where a local
SSE only continues sending after the first body delta arrives, UTF-8 across
chunk boundaries, usage, a unique terminal state, cancellation before the
response ends, and HTTP 401; authentication isolation, endpoint / request
header overrides, a public catalogue without authentication headers, commands,
and reload must also be verified. Tools and OAuth may only declare
capabilities that have already been verified. Real API tests are ignored by
default; when run explicitly, inject the key from the environment and limit the
timeout, retries, and usage. The official unified package lives in the separate
[rpi-package project](https://github.com/pi-rust/rpi-package/tree/feature-1014/packages/rpi-providers);
it keeps the `deepseek` ID, declares `DEEPSEEK_API_KEY`, and supports
tool-continuation turns through `requiresReasoningContent`.

Run the offline verification of the official package in the rpi-package
repository:

```sh
cd /path/to/rpi-package
cargo build -p rpi-providers
cargo test -p rpi-providers --test streaming
cargo test -p rpi-providers --test host
```

When running the CLI integration tests in the pi-rust repository, set
`RPI_TEST_PROVIDER_LIBRARY` and `RPI_TEST_PROVIDER_PACKAGE`, and then run:

```sh
cargo test -p rpi-cli --test provider_packages
```

A new package must also build and test its own dynamic library; passing the
host tests alone is not enough to claim the integration is complete.
