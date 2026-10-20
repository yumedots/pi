# rpi Rust Extension and Agent Debugging Guide

This guide covers two main threads: **how to write Rust `cdylib` extensions** (unified C ABI, tool lifecycle,
event handlers, resource discovery, providers/renderers), and **how to debug agents and extensions** (event logs,
development hosts, system prompt inspection, locating common failures). The default structure of a complete
agent project is described in the `agent` topic of `docs`.

## 1. Rust Extension Quick Start

The minimal viable extension is a Rust `cdylib` crate that depends only on `rpi-plugin-sdk`:

```bash
cargo new my-rpi-extension
cd my-rpi-extension
# set crate-type to ["cdylib", "rlib"] in Cargo.toml
```

```toml
[package]
name = "my-rpi-extension"
version = "0.1.0"
edition = "2021"
license = "MIT"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
rpi-plugin-sdk = "0.1"
serde_json = "1"
```

**Extension boundary rules**: a `cdylib` depends only on `rpi-plugin-sdk`. Never link `rpi-cli`,
`rpi-extensions`, or harness-internal crates — the host loads plugins dynamically and the host links the
plugin; the plugin must not link back to the host. Keeping `rlib` allows you to write Rust unit tests
inside the same crate.

The `examples/plugin-stub` directory shipped with the repository is a complete, runnable template that
covers three capabilities: an echo tool, event handlers, and resource discovery. It is the preferred
source for a starting skeleton.

## 2. Unified ABI Entry Point

The host loads only the unified C ABI symbol `rpi_plugin_register`. Extensions use `export_plugin!`,
register capabilities through the same `PluginApi`, and call `api.declare` to declare priority/platform.
The SDK checks `abi_version` and `struct_size` before registration; on incompatibility it returns a
non-zero status and the host reports a load failure.

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
    // Build the StableToolSchema and the execute/poll/cancel/destroy function table,
    // then call register_tool. See examples/plugin-stub for a complete implementation.
    let _ = register_tool;
    0
});
```

The JSON passed to `declare` supports `priority` (a number, larger runs first) and `platforms` (an array
of strings such as `["linux","windows","macos"]`); the host skips non-matching platforms when
dispatching event handlers.

### Capability Detection

Every registration slot is an `Option`. Before registering, check that the vtable slot is `Some`; when it
is missing, return a clear error and degrade gracefully instead of panicking, dereferencing null, or
relying on `undefined` semantics. The host returns a structured error for unknown runtime action IDs
and does not enter dispatch.

## 3. Tool Lifecycle: execute → poll → cancel → destroy

Each tool exports four `extern "C"` functions that the host drives with a fixed protocol:

- `execute(tool_call_id, params, free_params) -> StepHandle`: parses the JSON passed in by the host
  (an owned `StbString`, released with `free_with(free_params)`), and creates a handle dedicated to
  this call (usually `Box::into_raw(Box::new(State))`).
- `poll(handle, partial_cb, user_data) -> StepResult`: **must not block**. Return
  `StepResult::pending(progress)` when not finished, `StepResult::done(result)` when finished, and
  `StepResult::err(message)` on failure. `partial_cb` is called synchronously inside poll.
- `cancel(handle)`: sets a thread-safe cancellation flag. **Must be idempotent and must not free the
  handle.**
- `destroy(handle)`: called once by the host at the end; `Box::from_raw` frees the handle. A null handle
  must be a no-op.

Key points of the ownership protocol:

- `StbString`s produced by the host (execute's params, event payloads) are freed by the **plugin** via the
  host-provided `free_string`.
- `StbString`s produced by the plugin (done results, partial progress, the `out` of
  resources_discover) are freed by the **host** via the `plugin_free_string` provided by the plugin at
  registration time.
- No `extern "C"` boundary may unwind: the plugin catches panics internally with `catch_unwind` and
  converts them into structured error results.

```rust
extern "C" fn my_execute(
    _tool_call_id: StbStringRef,
    params: StbString,
    free_params: Option<FreeStringFn>,
) -> StepHandle {
    let text = params.to_string_lossy();
    params.free_with(free_params);
    let state = Box::new(MyState { input: text, done: false });
    Box::into_raw(state) as StepHandle
}

extern "C" fn my_poll(
    handle: StepHandle,
    _partial_cb: Option<ToolPartialCb>,
    _user_data: *mut c_void,
) -> StepResult {
    let state = unsafe { &mut *(handle as *mut MyState) };
    if !state.done {
        state.done = true;
        return StepResult::pending(StbString::empty());
    }
    StepResult::done(StbString::from_string(
        r#"{"content":[{"type":"text","text":"ok"}]}"#.to_string(),
    ))
}

extern "C" fn my_cancel(_handle: StepHandle) {}

extern "C" fn my_destroy(handle: StepHandle) {
    if !handle.is_null() {
        unsafe { drop(Box::from_raw(handle as *mut MyState)) };
    }
}
```

See `examples/plugin-stub/src/lib.rs` for the complete template. When creating a new tool, copy the
lifecycle skeleton and replace only the parameter schema and the domain logic; do not redesign the
ownership protocol.

## 4. Event Handlers, Resource Discovery, and Providers

### Event Handlers (36 event categories)

Subscribe via `api.register_event_handler` using an `EventTag`. Events fall into three major groups:

- **Session lifecycle**: `SessionStart`, `SessionBeforeSwitch`, `SessionBeforeFork`,
  `SessionBeforeCompact`, `SessionCompact`, `SessionShutdown`, and so on.
- **Agent loop**: `BeforeAgentStart`, `AgentStart`, `AgentEnd`, `AgentSettled`,
  `TurnStart`, `TurnEnd`, `MessageStart`/`MessageUpdate`/`MessageEnd`,
  `ToolExecutionStart`/`Update`/`End`, `ToolCall`, `ToolResult`, `UserBash`, `Input`.
- **rpi-specific / UI**: `BeforeTuiStart` (before TUI initialization), `UiPromptStart`/`UiPromptEnd`
  (when an interactive prompt blocks the agent).

Handlers receive a `StablePluginEvent` and **must not free** the strings inside the event (the host
frees them uniformly after fan-out). Return `0` for success; return `EVENT_HANDLER_ABORT` to veto.

### Lifecycle Veto (P1)

`BeforeTuiStart` is an rpi-specific hook with veto semantics: the first handler that returns
`EVENT_HANDLER_ABORT` **aborts startup**, and the CLI exits with exit code `3` while printing the
reason (useful for scenarios like "an external connection must be established before entering the
TUI"). The veto of `SessionStart` / `SessionShutdown` is only advisory: headless mode prints a
warning, and it is ignored during shutdown. Event dispatch has a timeout, so a slow handler never
blocks the main flow indefinitely.

### Resource Discovery

`api.register_resources_discover` registers a handler. The host fans out to all registered handlers
on `startup` / `reload` and merges the returned `{skillPaths, promptPaths, themePaths}`. An error in a
single handler does not abort the fan-out. `out` is a plugin-owned `StbString`, reclaimed by the host
via the `plugin_free_string` supplied at registration time.

### Providers and Renderers

`api.register_provider` injects a custom LLM provider (`provider_id` / `base_url` / `api_style` +
`request_fn`). `register_message_renderer` / `register_markdown_transformer` / `register_entry_renderer`
register message rendering capabilities; the host accepts `{text, lines}` component envelopes. All of
these slots may be `None`, so they must be detected before use.

## 5. Developing with `rpi dev`

Run this inside the extension crate directory:

```bash
rpi dev
```

rpi identifies the current `cdylib` through Cargo metadata, and after the first build places a
versioned copy in the workspace's `.rpi/extensions/.dev/`, starts the normal TUI, and watches `src/`,
`build.rs`, the package/workspace `Cargo.toml`, and `Cargo.lock`. Source changes trigger an automatic
rebuild and hot reload; if the build fails, the currently loaded version is kept. `/reload` inside the
TUI forces a rebuild and reload.

Multi-extension workspaces must explicitly select a package:

```bash
rpi dev --package rpi-todo
rpi dev -P rpi-webfetch
rpi dev --release
rpi dev --no-watch
rpi dev --package rpi-todo -- --model gateway/model
```

To debug a single extension, use `rpi dev-local` (equivalent to `rpi dev --local-only`): it loads only
the extension currently being compiled plus the skills/prompts discovered by that extension, and does
not scan global extensions, installed Pi packages, or resources from other projects, avoiding
interference from commands with the same name. When there is no `cdylib`, it degrades gracefully into
skills-only mode. On Windows an already loaded DLL cannot be overwritten in place, so do not manually
copy the Cargo target DLL; versioned staging switches safely.

## 6. Agent Debugging: Event Logs

### Enabling the Event Log

```bash
export RPI_EVENT_LOG=1
rpi            # any run records extension event handler invocations
```

Logs are written by default to `~/.rpi/logs/events.jsonl` (when `RPI_CODING_AGENT_DIR` exists, they
go to the `logs/` directory under its parent directory; `RPI_EVENT_LOG_PATH` can override the path
explicitly). When disabled, there is zero disk writes and zero overhead.

Show the log location and follow it live:

```bash
rpi events path        # print the event log path
rpi events tail        # print existing content and keep following (Ctrl+C to stop)
```

Each JSON line contains `ts_ms` (Unix milliseconds), `event` (such as `BeforeTuiStart` /
`MessageEnd`), `plugin` (the extension display name), `result` (`Continue` / `Error` / `Abort` /
`Timeout` / `Panic` / `JoinFailed`), `duration_ms`, and an optional `detail`. Use it to answer
questions like "why isn't my extension running".

### System Prompt and Resource Inspection

```bash
rpi --debug-system-prompt   # print each section of the final resolved system prompt to stderr
rpi --list-models           # list available models (a fuzzy search term may be given)
rpi --verbose               # show startup warnings (such as ignored flags)
```

`--debug-system-prompt` shows skills, prompts, package resources, and counts; it is the fastest route
for diagnosing "why didn't the resource show up on the welcome page".

### Credential and Provider Debugging

```bash
rpi auth check                          # report any available authentication sources (no network)
rpi auth check --provider gateway --json
```

When the interface reports errors, keep the diagnostic text returned by the provider and check the
endpoint, authentication headers, and model ID first.

### Session Export

```bash
rpi --export session.jsonl      # export a JSONL session as HTML for review
```

## 7. Remote Mode Debugging

```bash
rpi --server --port 9899        # headless server, prints a token at startup
rpi --connect 127.0.0.1:9899 --token <token>   # remote TUI client
```

The client is pure input/display, with no local provider, tools, extensions, or session files; all
agent work happens on the server. Debugging tips:

- The server log (`--verbose`) shows startup warnings; the event log (`RPI_EVENT_LOG=1`) is enabled in
  the server process, so use `rpi events tail` to follow it on the same machine.
- The client can inspect session state with `/state` (current model/thinking/tools), `/model <id>`,
  `/thinking <level>`, and `/tools`.
- In remote mode `/tree`, `/fork`, `/switch`, `/export`, `/name`, and `/reload` are unavailable (they
  depend on the local harness) and produce a clear "not supported" message.

### Key Diagnostics (Mobile / Remote Terminal)

Mobile clients, IMEs, and SSH gateways encode "Enter" differently. When something goes wrong, look at
the **raw key events that reach the TUI** first instead of guessing. Setting `RPI_DEBUG_KEYS` appends
all key events (including the decision result for Enter) to the log:

```powershell
# Windows: in the session you SSHed into from your phone
$env:RPI_DEBUG_KEYS=1; rpi
```

```bash
# Unix / Termux
RPI_DEBUG_KEYS=1 rpi
```

By default this writes to `<temp dir>/rpi-keys.log` (`%TEMP%\rpi-keys.log` on Windows); you can also
specify a file with `RPI_DEBUG_KEYS=<path>`. Format:

```text
2026-09-24T12:00:01.234Z --- rpi TUI key trace start pid=4321 TERM=xterm-256color raw_mode=true ---
2026-09-24T12:00:01.235Z code=Char('h') mods=NONE kind=Press
2026-09-24T12:00:01.236Z code=Enter mods=NONE kind=Press
2026-09-24T12:00:01.236Z enter-decision -> newline (paste burst) gap_ms=1 more_queued=false
```

Judge by these two clues:

| Log | Meaning | Action |
| --- | --- | --- |
| `code=Char('j') mods=CONTROL` (or `Char('\n')`) | The client sent Enter as **LF (0x0A)**. In raw mode crossterm treats LF as Ctrl+J, and Ctrl+J is bound to "insert newline" (matching pi's `tui.input.newLine`) | **Fixed**: `Editor::handle_key` now treats unmodified `Char('\n')`/`Char('\r')` as submit, while `Ctrl+J` (`Char('j') + CONTROL`) still inserts a newline |
| `code=Enter mods=NONE` + `enter-decision -> newline (paste burst)` | A normal CR arrived, but the client sent "text + Enter" as one batch, and the paste heuristic (20 ms burst window) misclassified it as a paste | **Fixed**: the paste heuristic is kept only on Windows (`cfg!(windows)`). On Unix, bracketed paste uses `Event::Paste` to handle real pastes, and a plain Enter submits directly |
| `code=Enter mods=NONE` + `enter-decision -> submit` | The input path is fine; the problem is not at the key layer | Check the session/network layer |
| No `code=` lines at all | The keys never reached the TUI | The client isn't connected, the window isn't focused, or `RPI_SKIP_STDIN` is set |

## 8. Locating Common Failures

| Symptom | What to check |
| --- | |
| The extension did not load | `cdylib` crate-type? Platform match? Point `--extensions-dir` at the output directory; make sure `--no-extensions` wasn't enabled by mistake |
| The tool was not registered | ABI version negotiation failed? Is the vtable slot `None` (not implemented by the host)? Did registration return non-zero? |
| The event handler never fired | `RPI_EVENT_LOG=1` + `rpi events tail` to see whether there is an `Abort`/`Panic`/`Timeout` |
| Startup was aborted | An extension's `BeforeTuiStart` returned `EVENT_HANDLER_ABORT`; exit code 3 |
| `poll` is stuck | `poll` must not block; put long-running work on a thread, keep state in the handle, and end via the cancellation flag with a deadline |
| Hot reload fails on Windows | A loaded DLL cannot be overwritten; use `rpi dev`'s versioned staging instead of copying manually |
| Resources don't appear in the system prompt | Use `--debug-system-prompt` to inspect the final assembled result; confirm the skill path was discovered |
| Enter turns into a newline on mobile/remote terminals | Inspect the keys with `RPI_DEBUG_KEYS=1`: `Char('j') mods=CONTROL` means the client sent LF (already treated as submit by `Editor`); `Enter` + `paste burst` means the paste heuristic misfired (now limited to the Windows platform) |
| The pasted content isn't the system clipboard (but the TUI's own text) | When a remote/mobile client maps paste to `Ctrl+V`, `read_clipboard_text` reads the **server's** clipboard — which may have been overwritten by copy-on-select dragging into the TUI text (such as the welcome line `Skills (…): …`). This fallback is now limited to Windows; on Unix, real pastes use bracketed paste `Event::Paste`, and the `Ctrl+V` fallback becomes an editor kill-ring yank |
| panic / segfault across the ABI | `extern "C"` boundaries must not unwind; `StbString` ownership follows the host/plugin rules on both sides |
| ABI version mismatch | The host log reports a mismatch and skips loading; check the `rpi-plugin-sdk` version |

## 9. Testing and Release

- Write domain logic as plain Rust functions; the FFI layer only handles conversion, lifecycle, and
  error mapping; write `rlib` unit tests for the plain logic.
- At least one host smoke test verifies ABI registration, loading, and unloading (see `plugin-stub`'s
  test pattern: the host reads the plugin's exported hit counter and asserts on the behavior).
- `cargo fmt --check`, `cargo clippy --all-targets`, and `cargo test` pass.
- `rpi dev --no-watch` compiles, loads, and registers the expected tools.
- The clean install path of `rpi install <crate> --force` passes (Linux/macOS/Windows are verified by
  CI).
- The README documents the tool schema, permission boundaries, persisted files, network access,
  supported platforms, and how to uninstall.
