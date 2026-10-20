# The extension compatibility report

What pi's example extensions need from the Rust port, what the port has
today, and what the compatibility suite measures.

- The suite: `node scripts/parity/extensions.mjs` (`--all` for every example,
  a bare name for one). It runs each extension on both sides with the same
  prompt and diffs the panes.
- The report it writes: `scripts/parity/out/extensions-report.md`.
- The pane is the judge: the TypeScript original runs in `tmux`, the Rust port
  runs in the same `tmux`, and the two panes are compared line by line.

## Running it

```sh
cargo build -p rpi-cli --bin rpi          # the Rust side of every run
node scripts/parity/extensions.mjs         # the screen-changing set
node scripts/parity/extensions.mjs --all    # every example extension
node scripts/parity/extensions.mjs status-line.ts
```

The suite drives the `prompt` scenario (one prompt), so the transcript and
the dock — where the status line, the widgets and the notifications land — are
both on screen. The baseline run (no extension) is what "takes effect" is
measured against.

## The path an extension takes

1. **Discovery** — `rpi-cli/src/js_extensions.rs::discover_extension_paths`
   walks the project directory (`.pi/extensions`), then the agent directory
   (`<agent dir>/extensions`), then the paths the user named. A directory
   contributes its `*.ts` / `*.js` files and the entry point of every
   subdirectory that has one (`index.ts`, `index.js`, or a `package.json` with
   a `pi.extensions` list) — pi's own rules.
2. **Loading** — the file is transpiled by `rpi-js` (oxc) and evaluated in the
   embedded V8. The extension's factory runs with the extension API.
3. **The screen** — the extension reaches the TUI through the host operations
   `ui.setStatus`, `ui.notify`, `ui.setWidget`, `ui.setHeader`, `ui.setFooter`
   and through the events `session_start`, `input`, `agent_start`, `turn_start`,
   `turn_end`, `agent_end`.

## The virtual modules

The extension host publishes the same module names pi publishes
(`packages/coding-agent/src/core/extensions/virtual-modules.ts`):

| module | what the port has |
| --- | --- |
| `typebox`, `typebox/compile`, `typebox/value`, `@sinclair/typebox*` | pi's own typebox, bundled |
| `@earendil-works/pi-tui` | pi's own TUI rendering code: the width helpers, `Text`, `Box`, `SelectList`, `Container`, the key helpers, `fuzzyFilter`, `CURSOR_MARKER`, `renderFakeCursor` |
| `@earendil-works/pi-ai` (+ `/compat`, `/oauth`, `/providers/all`) | the typebox schema builder; the provider SDKs stay with the host |
| `@earendil-works/pi-agent-core` | the names only — the agent loop belongs to the host |
| `@earendil-works/pi-coding-agent` | pi's own `types.ts` (`defineTool`, the result guards) |

The `pi-tui` module is pi's source, bundled with the node built-ins it uses
replaced by host shims (`rpi/crates/rpi-js/js/shims/`). The bundle is built by
`scripts/build-extension-host-bundle.mjs`.

## What the port has, per capability

| capability | port | notes |
| --- | --- | --- |
| tool registration | yes | `registerTool` reaches the host's tool list |
| slash command | yes | the command shows in the `/` list and runs |
| event handler | yes | `session_start`, `input`, `agent_start`, `turn_start`, `turn_end`, `agent_end` |
| status line (`ui.setStatus`) | yes | the footer's second line, key-sorted, one space between entries (pi's rule) |
| notification (`ui.notify`) | yes | a dim line in the transcript, preceded by a blank line (pi's rule) |
| widget (`ui.setWidget`) | yes | the slots above and below the editor exist in the dock |
| component rendered to text | yes | the extension host renders the component in V8 and hands the lines over |
| custom header (`ui.setHeader`) | partial | the host holds the component, but the Rust TUI has no header slot yet |
| custom footer (`ui.setFooter`) | partial | the host holds the component, but the Rust TUI has no footer slot yet |
| `ui.custom` / `ui.select` / `ui.confirm` / `ui.input` / `ui.editor` | no | the native dialog bridge is not wired to the JavaScript host |
| key input (`ui.onTerminalInput`) | no | the JavaScript host does not receive the keyboard |
| custom editor (`ui.setEditorComponent`) | no | the Rust editor cannot be replaced from JavaScript |
| session manager / model registry | partial | the read-only branch and the entries are answered; the session is not writable |
| MCP servers, providers, virtual models | no | the native runtime actions are not reachable from JavaScript |

## The extensions that need a capability the host does not have yet

These load, but they cannot change the screen the way the TypeScript original
does. The suite reports them as "loads: yes, takes effect: no".

| extension | the capability it needs |
| --- | --- |
| `custom-header.ts` | a header slot in the Rust TUI (pi replaces the logo block with the component) |
| `custom-footer.ts` | a footer slot in the Rust TUI, plus `ctx.sessionManager.getBranch()` and the footer data provider |
| `overlay-test.ts`, `overlay-qa-tests.ts` | `ui.custom` with keyboard focus (the overlay runtime) |
| `question.ts`, `questionnaire.ts` | `ui.select` / `ui.input` dialogs from JavaScript |
| `modal-editor.ts`, `rainbow-editor.ts`, `border-status-editor.ts` | a replaceable editor component and the key channel |
| `minimal-mode.ts`, `preset.ts` | the same, plus the autocomplete provider hook |
| `snake.ts`, `space-invaders.ts`, `tic-tac-toe.ts` | raw terminal input (`ui.onTerminalInput`) and an overlay |
| `doom-overlay/*` | the overlay runtime and the key channel |
| `qna.ts`, `summarize.ts`, `todo.ts`, `structured-output.ts` | a writable session (`appendEntry`, `sendMessage`) and `pi-ai`'s message types |
| `handoff.ts`, `plan-mode/*`, `subagent/*` | the agent runtime (`@earendil-works/pi-agent-core`) and child agents |
| `custom-provider-*`, `debug-provider.ts`, `jev-router.ts` | provider registration (the native runtime action) |
| `custom-compaction.ts`, `prompt-customizer.ts` | the compaction boundary events and the prompt builder |
| `tool-override.ts`, `dynamic-tools.ts` | replacing a built-in tool and the active tool set |
| `built-in-tool-renderer.ts`, `truncated-tool.ts`, `tools.ts` | the tool renderer registry on the Rust side |
| `message-renderer.ts`, `entry-renderer.ts` | the custom message and entry renderers on the Rust side |
| `notify.ts` | `process.stdout.write` (the host has no stdout) |
| `minimal-mode.ts` | `os.homedir()` from the extension itself |

## The parity gaps that are known

- The extension status line joins its entries with one space (pi's rule); the
  Rust `ExtensionStatusMailbox` used two and now uses one
  (`rpi/crates/rpi-extensions/src/status.rs`).
- A notification is a dim line in the transcript with a blank line above it
  (pi's rule). The native extension path renders `ℹ <text>` instead; the
  JavaScript path follows pi.
- The JavaScript extensions load in the interactive TUI. The headless modes
  (`--print`, `--mode json`) do not load them yet.
- The JavaScript host answers the read-only context (`cwd`, the model, the
  thinking level, the session branch); the writable session calls
  (`sendMessage`, `appendEntry`) are answered by the host but do not reach the
  harness yet.
