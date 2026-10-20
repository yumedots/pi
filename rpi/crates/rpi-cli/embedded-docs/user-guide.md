# rpi User Guide

This is the rpi manual for users and extension authors. rpi started as a Rust reimplementation of Mario Zechner's [Pi TypeScript SDK](https://github.com/earendil-works/pi); the core capabilities are provided as crates, and `rpi` is the ready-to-use CLI. See the NOTICE file in the repository root for sources and licensing. This document records the commands and behaviors implemented in the current version; it is released together with `rpi-cli`.

## 1. Installation

### Installing the CLI directly

Rust/Cargo is required:

```bash
cargo install rpi-cli
rpi --version
rpi --help
```

To install a development build from this repository's source:

```bash
git clone https://github.com/bigfish1913/pi-rust.git
cd pi-rust
cargo install --path crates/rpi-cli --force
```

`cargo install` installs an executable; it is not the same as `rpi install`. The latter installs Rust dynamic library extensions built with `rpi-plugin-sdk`.

### Running and building from source

This project is a Rust Cargo workspace, not a Node/npm project, and there is no `package.json` in the root directory. Run the following in the repository root:

```bash
# Run the CLI directly
cargo run -p rpi-cli

# Pass arguments to the CLI (everything after `--` belongs to rpi)
cargo run -p rpi-cli -- -p "Summarize README.md"
cargo run -p rpi-cli -- --mode json -p "List the crates in the project"

# Build the release version
cargo build -p rpi-cli --release
```

After the build finishes, the Windows executable is at `target/release/rpi.exe`, and on Linux/macOS it is usually `target/release/rpi`. You can also install the local CLI into Cargo's bin directory and use it directly:

```bash
cargo install --path crates/rpi-cli --force
rpi
```

For offline examples (no API key or network required), use:

```bash
cargo run -p minimal
```

### First run

Interactive mode:

```bash
rpi
rpi "Explain the directory structure of the current project"
```

Single-shot output mode:

```bash
rpi -p "Summarize README.md"
rpi --mode json -p "List the risks of the project"
```

Use `@` to put a file into the first message:

```bash
rpi @README.md "Give suggestions for improving this project"
```

## 2. Models and Credentials

### Credential precedence

When multiple sources exist at the same time, the precedence is:

1. `--api-key`
2. `~/.pi/auth.json` (written by `rpi auth login`)
3. The provider's `apiKey` in `~/.pi/agent/models.json`
4. Environment variables

Anthropic uses `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`; OpenAI-compatible providers use `OPENAI_API_KEY`. Checking credentials never makes a network request:

```bash
rpi auth check
rpi auth check --provider gateway --json
rpi auth login
rpi auth logout
```

Never write keys into a Git repository, project documentation, or a package manifest.

### Custom Providers

The configuration file is `~/.pi/agent/models.json` by default; the agent configuration directory can also be specified with `PI_CODING_AGENT_DIR`:

```jsonc
{
  "providers": {
    "gateway": {
      "api": "anthropic-messages",
      "baseUrl": "https://gateway.example.com",
      "apiKey": "sk-gateway-secret",
      "models": [
        { "id": "custom-claude", "name": "Custom Claude" }
      ]
    },
    "openai-gateway": {
      "api": "openai-completions",
      "baseUrl": "https://api.example.com/v1",
      "apiKey": "sk-openai-secret",
      "models": [
        { "id": "custom-model", "name": "Custom Model" }
      ]
    }
  }
}
```

Selecting a model:

```bash
rpi --model gateway/custom-claude -p "hello"
rpi --model openai-gateway/custom-model -p "hello"
rpi --provider gateway --model custom-claude -p "hello"
```

When `--model` is not given, rpi prefers a model that is already authenticated. The built-in default model is used when standard Anthropic credentials are present; when only a custom gateway is authenticated, the first available model of that gateway is selected.

Anthropic-compatible gateways can also use:

```text
ANTHROPIC_BASE_URL=https://gateway.example.com
ANTHROPIC_AUTH_TOKEN=token
```

## 3. CLI Commands

Common global options:

```text
--provider <name>       Provider name
--model <pattern>       Model ID, supports provider/model and thinking suffixes
--api-key <key>         Override credentials for this run
--base-url <url>        Override the model endpoint
--timeout <seconds>     LLM API request timeout (default 600)
--thinking <level>      off/minimal/low/medium/high/xhigh/max
--print, -p             Run once and exit
--mode text|json|rpc    Output mode
--continue, -c          Continue the most recent session
--resume, -r            Choose a historical session
--session <id|path>     Specify a session
--session-dir <dir>     Specify the session directory
--name, -n <name>       Set the session display name
--tools <list>          Allow only the specified tools
--exclude-tools <list>  Disable the specified tools
--no-tools              Disable all tools
--no-builtin-tools      Disable built-in tools (read/bash/edit/write/docs)
--no-skills             Skip skill discovery
--no-prompt-templates   Skip prompt-template discovery
--no-context-files      Skip AGENTS.md/CLAUDE.md discovery
--no-extensions         Disable extension loading
--extensions-dir <dir>  Additionally scan a Rust extension directory
--package-only         Load only the current project's package/resources, excluding global resources
--project-only         Equivalent alias for `--package-only`
--list-models [search]  List available models (optionally with a fuzzy search)
--offline               Disable the network check at startup
--export <file>         Export a JSONL session to HTML
--tui-mode <mode>       TUI buffer: regular or fullscreen
--system-prompt <text>  Replace the default system prompt
--append-system-prompt <text>  Append to the system prompt (repeatable)
--debug-system-prompt   Print each section of the parsed system prompt to stderr
--verbose               Show startup warnings (e.g. ignored flags)
--server [--port <n>] [--bind <ip>]
                        Headless server (prints a token at startup)
--connect <host:port>   Remote client TUI (no local resources)
--token <token>         Remote authentication token (the RPI_SERVER_TOKEN environment variable is also supported)
```

Subcommands:

```text
rpi auth login|check|logout
rpi events path|tail    Inspect the extension event log (requires RPI_EVENT_LOG=1)
rpi install <crate>
rpi uninstall <crate>
rpi update                 # Update the rpi CLI itself
rpi dev [options]          # Develop a Rust extension: build, watch, hot reload
rpi dev-local [options]    # Debug only the current Rust extension (isolated mode)
```

### CLI self-update

`rpi update` by default downloads a prebuilt CLI from a GitHub Release and does not require a local Rust/Cargo toolchain.
Versions are resolved from the crates.io release record; `rpi-release.json` provides the download URL, size and
SHA-256 of the archive/executable for each platform. After verifying the target platform, integrity and the actual version, the current CLI is replaced atomically.
On Windows the update is staged and the replacement is completed after the current process exits.

`rpi update --force` reinstalls the resolved version; `rpi update --build` explicitly compiles from source with Cargo.
A missing manifest, a failed download or a failed verification produce an error and keep the original version; there is no automatic fallback to compiling.
`--offline` only reports the cached version information, downloading and compiling nothing. When an old Release has no manifest,
you can wait for the protocol assets to be added, or explicitly use `rpi update --build`.

### Scrolling through TUI history

The interactive TUI uses the alternate screen by default and manages transcript scrolling itself. You can use `PageUp` / `PageDown`, `Home` / `End`, or the mouse and trackpad wheel to browse through history messages.

The behavior on macOS differs from the terminal's native main-screen scrollback: an alternate-screen TUI must receive mouse tracking events for the wheel and trackpad to scroll history messages. After entering raw mode, the TUI explicitly re-enables mouse tracking in alternate-screen mode; in main-screen mode it keeps mouse tracking off, preserving the terminal's native scrolling and text selection.

If the wheel does not scroll history messages on macOS, check whether `TuiAltScreen::start_readerless` includes the alternate-screen mouse tracking initialization, rather than modifying macOS global defaults directly.

### macOS keyboard and plugin panels

Terminals that support the Kitty keyboard protocol use flags 7, consistent with Pi, enabling modifier key recognition as well as function key repeat and key release events. Ordinary text keeps UTF-8 input, so that Chinese input methods in terminals such as iTerm2 can submit text properly; flag 8, which converts all text into key events, is not enabled. Release events for ordinary character keys (for example space) are not guaranteed, so plugins that rely on holding a key down should use function keys in terminals that support release events. The protocol is enabled after switching to the current screen and restored before exiting or suspending; restoring also re-enables fullscreen mouse scrolling.

On macOS the protocol is enabled by default as well, because `Shift+Enter` relies on it to be distinguishable from `Enter`; only terminals where enabling the protocol prevents the input method from working (such as Otty) fall back to traditional input. `RPI_KITTY_KEYBOARD=1` forces it on, and `RPI_KITTY_KEYBOARD=0` forces the fallback to traditional input.

The local Terminal.app `Shift+Enter` uses the native macOS Shift state to make newline detection work, and ordinary `Enter` is still sent. SSH sessions do not read the local Shift state. Terminals without support for the enhanced keyboard protocol still use traditional input, and features that depend on release events, such as hold-down shortcuts, require terminal support.

When the plugin input box, editor, picker or history search is open, it receives input first, and plugin global shortcuts do not steal keystrokes from these windows. Keys already taken over by a plugin still receive the corresponding release events, to avoid a stuck held state. Overlays are laid out according to their actual width and avoid the input box and footer; multiple passive panels are automatically arranged vertically when there is enough space, and panels that do not fit are temporarily hidden when the window is too small. To keep overlays from covering the chat body, turn the panels off or use the plugin's sidebar layout.

### Remote mode (`--server` / `--connect`)

Run the agent on a headless server and drive it remotely from another process with the TUI. The client has **no local agent resources at all**.

```bash
rpi --server --port 9899          # Server: prints the token at startup
rpi --connect 127.0.0.1:9899 --token <token>   # Client

# Or pass the token via an environment variable
export RPI_SERVER_TOKEN=<token>
rpi --connect 127.0.0.1:9899
```

The server enables token authentication by default (`--no-token` turns it off). The client supports commands such as `/state`, `/model`,
`/thinking`, `/tools` and `/abort`; `/tree`, `/fork`, `/switch`, `/export`,
`/name` and `/reload` depend on the local harness and are unavailable in remote mode. See [`remote-mode.md`](remote-mode.md)
for the full protocol, the available commands and the limitations.

## 4. Built-in Tools

The default tools include Pi's `read`, `bash`, `edit` and `write`, as well as rpi's own read-only `docs` document query tool. On Windows, `powershell` is also registered by default. `docs` can query the user guide, extension development, the Agent project structure, Rust debugging and the architecture notes; `grep`, `find` and `ls` are still kept as library implementations but are not registered by the CLI by default.

You can restrict the set of tools available at startup via the `defaultTools` field (or the shorthand `default_tools`) in `.rpi/settings.json`, when `--tools` is not specified:

```json
{
  "defaultTools": ["read", "bash", "edit", "write", "docs"]
}
```

To limit the tool scope, list Pi's four tools explicitly:

```bash
rpi --tools read,bash,edit,write,docs -p "Inspect and modify the project files"
```

## 5. Project Directories and Resource Precedence

rpi prefers its own directories while remaining compatible with the original Pi `.pi` layout:

```text
project/
├── .rpi/
│   ├── settings.json
│   ├── SYSTEM.md
│   ├── APPEND_SYSTEM.md
│   ├── skills/
│   ├── prompts/
│   ├── themes/
│   ├── extensions/
│   └── packages/
└── themes/
```

The project's `.rpi` takes precedence over the project's `.pi`. Global resources live in `~/.pi/agent/` by default, including `settings.json`, `models.json`, `skills/`, `prompts/`, `themes/`, `extensions/` and `packages/`. When resources with the same name conflict, project resources take precedence over global resources, and `.rpi` takes precedence over `.pi`.

Project-level `.rpi/settings.json` can add extra resource directories:

```json
{
  "skills": ["./team-skills"],
  "prompts": ["./prompts/shared"],
  "extensions": ["./target/debug"],
  "packages": ["./packages/review-tools"]
}
```

Paths are relative to the project root; `skills`, `prompts` and `extensions` are shorthands for the corresponding `*Dirs` fields. Custom directories are loaded together with `.rpi`, `.pi` and the conventional global directories, with `.rpi` taking precedence. The global `~/.pi/agent/settings.json` supports these fields as well, with relative paths resolved against the agent directory.

To load only the current project's packages/resources and exclude global resources, use either of the equivalent options:

```bash
rpi --package-only
rpi --project-only
```

Both load the current project's skills, prompts, themes, extensions and packages, and read the project's `.rpi/settings.json`; they do not load global resources automatically. `--local-only` has different semantics: it loads only the extensions explicitly given via `--extensions-dir` or `--extension`.

The configuration directory can be relocated:

```bash
PI_CODING_AGENT_DIR=/work/rpi-agent rpi
```

Sessions are saved by default under the sessions directory of the agent configuration directory; `--no-session` uses a temporary session.

## 6. Rust Plugins

Native Rust plugins are `cdylib` crates that depend only on `rpi-plugin-sdk`, and are dynamically loaded by `rpi-extensions`:

```bash
cargo build -p plugin-stub
rpi --extensions-dir target/debug -p 'echo "hi"'
```

Installing a prebuilt extension (the default, no Rust/Cargo needed):

```bash
rpi install rpi-todo
rpi install rpi-todo --version 0.2.0
rpi install rpi-todo --force # Reinstall the same version
```

`rpi install <crate>` installs or upgrades directly; when the target version is already installed it reports that and skips. Reinstalling the same version or downgrading requires `--force`. Source builds follow the same rule: when you change code locally without changing the version, reinstall with `--force`.

The installer picks the latest non-yanked stable version from crates.io, uses the package's `repository` metadata to find the GitHub repository, and then reads `rpi-extension.json` from the `<crate>-v<version>` Release. It matches prebuilt files by exact target triple and verifies the archive size and SHA-256, the SHA-256 of the extracted library file, the platform architecture and the declared SDK ABI. The library file name is taken from the manifest's `library.path`. Extensions within the same repository can be versioned and released independently.

To specify a custom GitHub repository (a full HTTPS repository URL is also accepted):

```bash
rpi install my-extension --github owner/repo --version 1.2.3
rpi install my-extension --github https://github.com/owner/repo
```

A custom repository must publish the same distribution protocol. An explicit repository does not depend on crates.io; when the version is omitted, only the latest stable version among that repository's `<crate>-v<version>` tags is selected. The repository's global latest Release is not used. Later `--force` reinstalls and the startup update check preserve the source and verify that the new version's manifest fits the current platform.

Publishers must upload the archives for the declared platforms first and the manifest last. If the manifest has not been published, the target platform is missing, or verification fails, the installation fails; it never compiles automatically or picks another version. When you need to build from source, use this explicitly:

```bash
rpi install rpi-todo --build
rpi install rpi-todo --build --version 0.2.0 --force
```

The prebuilt installation record includes the version, repository, target platform, source commit, SDK ABI and checksums; installation and uninstallation use the same transactional mechanism. At load time the actual plugin entry point and API struct sizes are still verified. Dependencies on system native runtime libraries are still provided by the operating system.

Local development:

```bash
rpi install my-extension --path ../my-rpi-extension --force
```

Use watch mode when developing an extension project:

```bash
cd ../my-rpi-extension
rpi dev
# Multi-extension workspace: rpi dev --package my-extension
# Debug only the current extension: rpi dev-local (isolated mode, no global extensions loaded)
```

`rpi dev` automatically recognizes Cargo `cdylib` crates, performs the first build and loads the versioned artifact from `.rpi/extensions/.dev`. Source changes trigger a rebuild and a hot reload; manually running `/reload` also rebuilds first. If the build fails, the currently loaded version is kept. See the online extension authoring guide for the complete template and boundary rules: <https://rpi.laofu.online/extension-authoring.md>, and see the `debugging` topic of `docs` for debugging tips.

After installation, the dynamic library is placed in `~/.pi/agent/extensions` (or the directory specified by `PI_CODING_AGENT_DIR`) and is loaded the next time rpi starts. Plugins register tools, providers, event handlers and resource handlers through a stable ABI; do not depend directly on private modules of `rpi-cli`.

### Web search and fetching

The networked tools are provided by the separate [rpi-package extension](https://github.com/pi-rust/rpi-package),
and are not part of the CLI's default built-in tools. Install them as needed and restart rpi:

```bash
rpi install rpi-websearch
rpi install rpi-webfetch
```

- `websearch` returns the titles, links and summaries of search results.
- `webfetch` extracts the readable text of public HTTP(S) pages; it rejects private addresses and oversized responses.
- These two extensions are not interactive browsers: they provide no clicking, no login flows and no execution of web page JavaScript.

### Sub agents that inherit the main session configuration

After installing a compatible version of `rpi-subagents` and restarting, you can delegate tasks with `delegate_task`:

```bash
rpi install rpi-subagents
```

A sub agent uses a snapshot of the currently effective configuration of the main session: model/provider and its private credential bindings, thinking,
system prompt, resources, request options, enabled tools, project cwd and approval hooks. It is not an `rpi` subprocess started by re-reading the default
configuration; credentials are not passed through the plugin JSON.

Subtasks use an independent in-memory Session and **do not copy or modify the parent chat history**. The host API can further narrow the
tool set but not widen it; `delegate_task` is removed from the sub tool set, and recursive delegation via aliases is forbidden.
Approvals and `ask_user` follow the parent UI; without an interactive consumer they keep an explicit denial/error rather than allowing by default.
Subtasks are cancelled when the parent run ends or is cancelled, when the session is switched, and when the owning plugin is unloaded/reloaded.
This is not an OS-level security sandbox; allowed shell and similar tools keep their normal capabilities.

The host and the extension must support the corresponding protocol at the same time; older hosts explicitly require an upgrade and do not fall back to a default-configuration subprocess.
The SDK provides `AgentHarness::create_child`, and extensions plug in through the `GetExecutionContext` and `ChildAgent` runtime actions. See the full protocol in the repository's `docs/extensions/subagents.md`:
<https://github.com/bigfish1913/pi-rust/blob/main/docs/extensions/subagents.md>.

## 7. SDK Integration

When you only need to embed the Agent, depend on `rpi-agent` and `rpi-ai`; add `rpi-tools` when you need the built-in tools; add `rpi-harness` when you need sessions, compaction, skills and context files.

```rust
use rpi_agent::{Agent, AgentEvent};
use rpi_ai::providers::faux::faux_provider;

let model = faux_provider().model("echo");
let mut agent = Agent::builder(model)
    .system_prompt("You are a helpful assistant.")
    .build();

let mut events = agent.subscribe();
agent.prompt("Hello from rpi").await?;
while let Some(event) = events.recv().await {
    if matches!(event, AgentEvent::AgentEnd { .. }) {
        break;
    }
}
```

Custom tools implement `rpi-agent::AgentTool`; providers implement `rpi-ai::Provider`. Using the `faux provider` and `InMemoryExecutionEnv` you can test the Agent loop without a network, an API key or a real filesystem.

## 8. Troubleshooting

### Model not found or API errors

Run `rpi auth check` and confirm the provider, `models.json`, the environment variables and `baseUrl`. Use `--provider` together with a full `provider/model` to avoid ambiguity between models with the same name. API errors preserve the diagnostic text returned by the provider; check the endpoint, the authentication headers and the model ID first.

### Extension fails to load

Make sure the Rust plugin is a `cdylib` and matches the current platform; temporarily point `--extensions-dir` at the output directory. When loading fails, keep the full error text printed by the host and check whether the extension declares capabilities the host does not provide.

### Extension event handlers do not fire, or startup is aborted

```bash
export RPI_EVENT_LOG=1
rpi            # Log all extension event handler invocations
rpi events tail   # Follow the log; check whether result is Continue or Error/Abort/Panic/Timeout
```

The log lives at `~/.pi/logs/events.jsonl` by default (override it with `RPI_EVENT_LOG_PATH`). If
an extension returns a veto (`EVENT_HANDLER_ABORT`) during the `BeforeTuiStart` phase, the CLI aborts startup with exit code `3`
and prints the reason.

### Resources do not appear on the welcome page

Make sure the files are in `.rpi` (or the compatible `.pi`) or in the global `~/.pi/agent`. Use `rpi --debug-system-prompt` to see the final system prompt, skills and resource counts; for resources with the same name, check first whether `.rpi` overrides `.pi`.

### Remote mode cannot connect

Make sure the server was started with `rpi --server --port <port>` and that the token is correct (or supplied via
`RPI_SERVER_TOKEN`). The client is a pure display client and loads no local provider/tool/extension;
session files live on the server.

## 9. Development, Testing and Releasing

Run formatting, checks and tests:

```bash
cargo fmt --all
cargo check --workspace
cargo test --workspace
```

When releasing crates, follow the dependency order:

```text
rpi-telemetry → rpi-ai → rpi-agent → rpi-tools → rpi-harness →
rpi-plugin-sdk → rpi-extensions → rpi-tui → rpi-cli
```

Routine contributions do not require manually bumping version numbers. After an ordinary change is merged into `main` and passes CI, automation prepares a
Release PR; only merging a qualifying Release PR publishes it. The release record is maintained in the root
`CHANGELOG.md`, and no new `docs/release-vX.Y.Z.md` is created. See the repository's `docs/maintaining/releasing.md` for the full process and for how
documentation-only changes are handled:
<https://github.com/bigfish1913/pi-rust/blob/main/docs/maintaining/releasing.md>.

After modifying the model-readable documentation sources in `docs/rpi-tool/`, run `sh scripts/sync-embedded-docs.sh` and commit the
generated documentation snapshot. Updating documentation alone requires neither a version bump nor a tag. The website still has to be deployed separately; committing or merging
documentation does not mean the live site has been updated.

## 10. Documentation Entry Points

- Online documentation: <https://rpi.laofu.online/docs.html>
- Source repository: <https://github.com/bigfish1913/pi-rust>
- Rust API: <https://docs.rs/rpi-agent>, <https://docs.rs/rpi-plugin-sdk>

- Package and extension authoring guide: <https://rpi.laofu.online/extension-authoring.md>
- Remote mode: <docs/remote/user-guide.md>
- Rust extension and agent debugging: the `debugging` topic of the `docs` tool inside `rpi`

When the online documentation and the installed version disagree, the Git tag of the corresponding version and the documentation in the repository are authoritative.
