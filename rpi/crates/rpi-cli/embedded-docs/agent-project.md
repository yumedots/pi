# rpi Agent project structure guide

This guide is the model-readable default specification. When a task is to use the rpi SDK
to "create your own Agent", "scaffold an Agent structure", or "add an rpi entry point to an
existing project", organize the project as described here. The default recommendation is a
single crate: the embedded Agent and the global `rpi` extension share the same set of tools
(see §1); other shapes are trimmed as needed.

Do not write the tools first and think about the structure afterwards. Decide on the shape
first, lay out the directories second, and wire up the entry point last.

## 1. Choose the shape first

| Shape | Entry point | Direct dependencies | When to use it |
| --- | --- | --- | --- |
| Library-embedded Agent | Your `[[bin]]` / service process | `rpi-agent` + `rpi-ai` (add `rpi-tools` if built-in tools are needed) | Run the loop inside your own process with full control over events, tools, and output |
| CLI project | The global `rpi` host | None (resources and cdylib) | You want the ready-made TUI, `-p`/`--mode json`, sessions, and skills |
| Rust extension | The host loads `.rpi/extensions/*.dll` | `rpi-plugin-sdk` | Add tools/providers/events to the global `rpi` without modifying the host |

A single project **can ship both an "embedded Agent" and a "cdylib extension" adapter,
sharing one implementation of the tools**. This is also the shape this guide recommends by
default: debug locally with the embedded Agent, and in production/interactively let the global
`rpi` load the same extension. Only build one of the two when the requirements are simple
enough.

## 2. Recommended directory structure

```text
my-agent/
├── Cargo.toml
├── AGENTS.md                  # project-level fallback instructions (read even by bare rpi)
├── config/
│   └── agent.json             # project Agent config (system prompt / skill dirs / artifacts)
├── prompts/
│   ├── system.md              # main system prompt
│   └── append-system.md       # appended system prompt
├── skills/
│   └── <skill-name>/SKILL.md  # domain skills, activated dynamically at runtime by description/trigger
├── src/
│   ├── main.rs                # embedded Agent / service entry point
│   ├── lib.rs                 # module exports (+ optional cdylib ABI adapter)
│   ├── config.rs              # runtime configuration (environment variables / files)
│   └── tools/
│       ├── mod.rs             # the single tool registry (single source of truth)
│       ├── core.rs            # single run_tool entry point + domain logic
│       └── content.rs         # AgentTool adapter (used by the embedded Agent)
├── .rpi/
│   ├── settings.json          # skills / prompts / extensions / defaultTools
│   └── extensions/            # compiled cdylibs (build output, do not commit)
└── tests/
    └── behavior.rs
```

Conventions:

- `.rpi/` is rpi's project resource directory; **resources with the same name are resolved
  project-first** (project over global, `.rpi` over `.pi`, package last).
- `prompts/`, `skills/`, `config/` are **plain, reviewable source directories**; do not hide
  them inside `.rpi` or rely on paths generated temporarily by an extension at runtime.
- `target/`, `.rpi/extensions/`, and `artifacts/` are build outputs; add them to `.gitignore`.
- Write generation constraints into the system prompt as fixed text; do not rely on the model
  re-deriving them in every session.

## 3. Cargo.toml

When an embedded Agent and a cdylib share one source, a single package declares both
`[[bin]]` and `[lib]`:

```toml
[package]
name = "my-agent"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "agent"
path = "src/main.rs"

[lib]
name = "my_agent"
path = "src/lib.rs"
crate-type = ["cdylib", "rlib"]   # cdylib for the host; rlib makes integration tests easier

[dependencies]
# Below, `<rpi>` stands for the current rpi release version; replace it with the actual
# version number (e.g. `0.1.x`), and make sure all `rpi-*` dependencies use the same
# version; add or remove third-party dependencies as needed.
rpi-agent = "<rpi>"
rpi-ai = { version = "<rpi>", features = ["providers"] }
rpi-tools = "<rpi>"
rpi-plugin-sdk = "<rpi>"          # only needed for the cdylib adapter
tokio = { version = "1", features = ["full"] }
async-trait = "0.1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
schemars = "0.8"
thiserror = "1"

[dev-dependencies]
# Use a faux provider for offline tests, without depending on the network or an API key
```

Boundary rules:

- **Extensions depend only on `rpi-plugin-sdk`, never on internal modules of `rpi-cli`,
  `rpi-extensions`, or `rpi-harness`** — the host links the plugin, not the other way
  around; otherwise the ABI and versions become coupled.
- The embedded Agent depends only on `rpi-agent`/`rpi-ai`/`rpi-tools`, decoupling it from the
  extension ABI.
- Add `rpi-harness` when you need sessions, compaction, skills, or context files.

## 4. Single registry point for tools

Tools are declared once, and both host adapters derive their own schemas from that single
declaration, avoiding drift between two implementations.

`src/tools/mod.rs`:

```rust
pub struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,
    pub props: serde_json::Value,        // JSON Schema properties
    pub required: &'static [&'static str],
}

pub static TOOLS: std::sync::LazyLock<Vec<ToolSpec>> = std::sync::LazyLock::new(|| {
    vec![ToolSpec {
        name: "lookup",
        description: "Look up symbol definitions in the project.",
        props: serde_json::json!({
            "symbol": {"type": "string", "description": "The name of the symbol to look up"}
        }),
        required: &["symbol"],
    }]
});

/// The single execution entry point shared by all hosts.
pub fn run_tool(name: &str, params: &serde_json::Value)
    -> Result<serde_json::Value, ToolError>
{
    match name {
        "lookup" => lookup::run(params),
        other => Err(ToolError::new(format!("unknown tool `{other}`"))),
    }
}
```

`src/tools/core.rs` holds the shared logic; `src/tools/content.rs` only orchestrates (wrapping
`run_tool` into an `rpi_agent::AgentTool`); the cdylib side only does ABI orchestration. None
of the three reimplements the domain logic.

For each tool, add a unit test asserting that the schema is consistent across the two hosts
(see §11).

## 5. Embedded Agent

The minimal loop: construct the provider/model → `AgentBuilder` → subscribe to events →
`prompt`.

```rust
use std::sync::Arc;
use rpi_agent::AgentBuilder;
use rpi_ai::Provider;

let model = provider.default_model().clone();
let agent = AgentBuilder::new()
    .model(model)
    .system_prompt(compose_system_prompt())     // prompts/system.md + append
    .tools(create_agent_tools())                // derived from TOOLS
    .stream_fn(make_stream_fn(provider))        // a synchronous wrapper around Provider::stream_simple
    .build()?;

let mut events = agent.subscribe();
agent.prompt(user_input).await?;

while let Some(event) = events.recv().await {
    if matches!(event, rpi_agent::AgentEvent::AgentEnd { .. }) {
        break;
    }
    // Forward MessageUpdate / ToolExecutionStart / ToolResult to your UI or logs
}
```

Key points:

- **`subscribe` before `prompt`**, otherwise early events are lost in the broadcast buffer.
- Custom tools implement `rpi_agent::AgentTool`: `schema()` returns `rpi_ai::types::Tool`,
  and `execute(tool_call_id, params, signal, on_update)` parses the JSON, checks `signal`, and
  returns `AgentToolResult`. Map parameter parsing failures to structured errors; do not panic.
- Use a faux provider + `InMemoryExecutionEnv` for offline testing: no network, API key, or real
  filesystem required.
- When you need CLI-level sessions/compaction/skills, use `rpi-harness` instead of rebuilding
  them yourself.

## 6. cdylib ABI adapter (for the global `rpi`)

The host only loads the unified C ABI symbol `rpi_plugin_register`. The extension uses
`export_plugin!` to register capabilities through the same `PluginApi` and calls
`api.declare` to declare priority/platform. The SDK checks `abi_version` and `struct_size`
before registration; on incompatibility it returns a non-zero status and the host reports a
load failure.

```rust
rpi_plugin_sdk::export_plugin!(|api| {
    let Some(register_tool) = api.register_tool else {
        return -1;                         // capability detection: fail explicitly if the slot is missing
    };
    // Build StableToolSchema and the execute/poll/cancel/destroy function table
    // from the same TOOLS declaration, then register_tool(...).
    let _ = register_tool;
    0
});
```

The tool lifecycle is fixed as `execute → poll → cancel → destroy`: `execute` allocates a
per-call handle, `poll` must be non-blocking and respond to the cancellation flag, `cancel`
only sets the flag without freeing anything, and `destroy` is called once by the host and
frees the resources. No `extern "C"` boundary may unwind.

**First copy the skeleton from `examples/plugin-stub/src/lib.rs`**, then replace the schema
and domain logic; do not redesign the ownership protocol. The complete ABI, capability
detection, event handling, resource discovery, and publishing checks are described in the
`authoring` topic of `docs`.

## 7. Project resources: prompts, skills, AGENTS.md

- `prompts/system.md`: the main system prompt, holding responsibilities, workflow, and quality
  gates (e.g. "for every content item, first `read` the corresponding skill's `SKILL.md`").
  It is injected at runtime via `--system-prompt` or configuration.
- `prompts/append-system.md`: the appended section, for environment/project-specific
  constraints.
- `skills/<name>/SKILL.md`: domain skills. The model chooses dynamically from the `name`,
  `description`, and `triggers` of the `<available_skills>` list available at startup;
  **do not maintain a hard-coded topic→skill mapping**. Discovery (`loaded`) is not the same as
  use; the real evidence of activation is a complete `read` of that `SKILL.md` first.
- `AGENTS.md`: project-root fallback instructions, also read by a bare `rpi`. Keep it
  consistent with the core constraints of `prompts/system.md`; change one and you must change
  the other.
- System prompts and skills are loaded as a snapshot **at the start of every session**; after
  editing them, restart the session, since existing sessions are not hot-replaced.

## 8. `config/agent.json` (project convention)

`.rpi/settings.json` is rpi host's native configuration. `config/agent.json` is **the project's
own** convention file, read by the embedded Agent launcher or wrapper script, keeping the
"system prompt / skill directories / artifacts directory / default provider" in one place:

```json
{
  "system_prompt": "prompts/system.md",
  "append_system_prompt": "prompts/append-system.md",
  "skills_dir": "skills",
  "skill_dirs": ["skills"],
  "extension_dirs": [".rpi/extensions"],
  "disable_context_files": true,
  "artifacts_dir": "artifacts",
  "provider": "<default-provider>"
}
```

Fill in the values above according to the provider and directories your project actually
uses; do not copy the example verbatim. `config/agent.json` is not native rpi configuration,
only a convention of this project's launcher. At the same time, use `.rpi/settings.json` so
the host discovers the resources natively:

```json
{
  "skills": ["./skills"],
  "defaultTools": ["read", "bash", "edit", "write", "docs"]
}
```

`disable_context_files: true` prevents the wrapper launcher from being polluted by an upper
repository's `AGENTS.md`/`CLAUDE.md`; when needed, disable it explicitly with
`--no-context-files`.

## 9. Startup and the development loop

Two entry points; the scripts only pin the working directory, build, and forward arguments.
The script language can be chosen per platform (Windows `.ps1`/`.cmd`, Unix `.sh`, or a
unified runner such as Taskfile/just/make), and the responsibilities of the two entry points
stay the same:

- **Embedded Agent**: one launch script → `cargo run --bin agent` (this project's process,
  talking directly to the SDK).
- **Global host**: one build script compiles the cdylib and copies it to `.rpi/extensions`,
  and then one launch script starts the global `rpi`. The scripts should:
  1. Pin the working directory to the project root, so that skills from another project are
     not loaded;
  2. Let the host scan `.rpi/extensions` **natively**; do not pass the same `--extensions-dir`
     again;
  3. Pass `prompts/system.md` and `prompts/append-system.md` to the host explicitly;
  4. Choose the default provider/model only when no higher-priority setting exists, printing
     the source but **not the API key**;
  5. Fail closed: fail first when `--no-tools`, `--no-skills`, `--no-extensions` is detected,
     or when the `--tools` allowlist lacks `read` — these prevent loading content extensions
     or reading skills.
- On Windows, a loaded DLL cannot be overwritten in place: compare the SHA256 before copying
  and skip the copy when the bytes are unchanged; when the file is locked, report an
  actionable "stop the running rpi and retry" error instead of failing silently.

Edit loop: use `rpi dev` for Rust extension changes (watch + hot reload, versioned staging into
`.rpi/extensions/.dev`); use `rpi dev-local` to tune only the current extension (isolated
mode). Do not manually copy the Cargo target DLL to a fixed filename.

## 10. Agent as a service (optional)

When you run the Agent as a long-lived service, `main.rs` exposes an API using the HTTP
framework already used by the project (such as `axum` or `actix-web`; pick one), adding a
message queue consumer (MQTT/Kafka/NATS, etc.) when needed:

- `main.rs` only orchestrates: initialize `tracing` → load `Config::from_env()` → build
  `AppState` → start the HTTP server and handle graceful shutdown.
- All configuration goes through environment variables (`.env.example` records the key names;
  **do not commit real secrets**).
- Task/run state goes into a shared `Arc<TaskStore>`, and the API handlers stay thin.
- When containers are needed, provide a multi-stage `Dockerfile`; the runtime stage carries
  only the binary and the CA certificates, and `EXPOSE`/`CMD` point at the entry point in
  `main.rs`.

## 11. Testing and publishing

- `cargo fmt --check`, `cargo clippy --all-targets`, and `cargo test` all pass.
- Write `rlib` unit tests for the domain logic; write at least one host smoke test for ABI
  registration/loading.
- Assert that **the schemas of the two hosts match**: the Agent schema derived from the same
  `TOOLS` and the ABI JSON must be equal, preventing drift.
- `rpi dev --no-watch` compiles, loads, and registers the expected tools; the clean install
  path of `rpi install <crate> --force` passes.
- When providing a `cdylib`, `crate-type` includes `"cdylib"`, `rpi_plugin_register` is
  exported, and it depends on the published `rpi-plugin-sdk`.
- The `README` documents the tool schemas, permission boundaries, persisted files, network
  access, supported platforms, and uninstall procedure; the paths across `AGENTS.md`,
  `config/agent.json`, `prompts/`, `skills/`, and `.rpi/settings.json` stay consistent.

## 12. Creation checklist

…
…
6. Do not claim that unverified ABI/capabilities are fully compatible; record any degraded
   behavior honestly.

## 13. Model execution rules

When the model receives a task to "create an rpi Agent project / scaffold an Agent structure":

1. First call `docs` to look up `agent` (this guide); for extension development look up
   `authoring`, and for debugging look up `debugging`.
2. Read the current repository's existing `Cargo.toml`, the SDK version, and the conventions of
   neighbouring projects; do not guess APIs.
3. Lay out the directories and the single tool registry point first, then write the adapters,
   and only then wire up the entry point.
4. Prefer copying the minimal skeleton inside the repository (`examples/minimal`,
   `examples/plugin-stub`).
5. Use a faux provider for offline tests, and `rpi dev --no-watch` for a real load smoke test.
6. Do not claim that unverified ABI/capabilities are fully compatible; record any degraded
   behavior honestly.
