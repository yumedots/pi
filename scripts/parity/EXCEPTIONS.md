# The gaps that need a decision

The rule for this work: a feature is ported unless it cannot be, and anything
that cannot be is listed here with the reason, so the user can sign it off.
Nothing in this file is a silent gap.

**How the port is measured** (all of it reproducible):

| what | command | result |
| --- | --- | --- |
| the six parity scenarios | `node scripts/parity/run-all.mjs` | **all six byte-identical to the golden traces** — startup 2/2, panels 5/5, prompt 2/2, tool 3/3, thinking 2/2, markdown 2/2 |
| the keybinding registry | `node scripts/parity/audit.mjs keys` | **89 ids on both sides, every default key identical** |
| the settings keys | `node scripts/parity/audit.mjs` | **60 on both sides, identical** |
| the settings behaviour | `node scripts/parity/settings-parity.mjs` | 20 cases, 17 identical, 3 differ (the rows below) |
| the session round trip | `node scripts/parity/session-compat.mjs` | `rust → ts` ok; `ts → rust` restores the same conversation in the same pane |
| the extension API | `/tmp/pi-ext-audit/run.mjs rust` + `diff.mjs` | **110 of 119 probes match**; the events 18 of the original's 23 |
| the example extensions | `node scripts/parity/extensions.mjs --all` | 37 of pi's own examples load on both sides; three fail on the module surface (below) |
| the 3D logo's frames | `node scripts/parity/3dicon.mjs` | identical at fixed times |

## Being ported now

| Feature | Where | Who |
| --- | --- | --- |
| the trust decision picker and the startup trust prompt | rpi-cli/src/interactive_tui/commands.rs, config.rs | the interactive mode port |
| the `/login` authentication-method step and the API-key form's shape | rpi-cli/src/interactive_tui/settings.rs | the interactive mode port |
| the OAuth flows and their screens: anthropic, github-copilot, kimi-coding, meta, openai, openai-codex, openrouter, xai | rpi-cli/src/provider.rs, rpi-js | the provider lead |
| the module surface: pi's package exports (`createBashTool`, `CustomEditor`, `BorderedLoader`, `DynamicBorder`, …) | rpi-js/js/pi-coding-agent.ts | the extension port — the bundle initialises; the last blocker is pi's network layer pulling `undici` into the embedded host |
| the easter egg's click target on the header mark | rpi-cli/src/interactive_tui/ | the interactive mode port — the component's entry point is in rpi-tui; the CLI has no component-level mouse path |
| the expanded startup help (Ctrl+O) | rpi-cli/src/interactive_tui/rendering.rs | the interactive mode port |
| the settings list's frame and search-then-Enter descending into a submenu | rpi-tui/src/settings_list.rs, rpi-cli/src/interactive_tui/settings_menu.rs | the interactive mode port |
| the model picker's title, footer and hint lines, and Ctrl+S "set as default" | rpi-cli/src/interactive_tui/selectors.rs | the interactive mode port |
| the scoped-models picker, the transcript search's highlight and jump, the overlay, the footer's context readout | rpi-tui + rpi-cli | the interactive mode port |
| the jump-to-latest label and the bounce-back after jumping | rpi-tui/src/jump_to_end.rs, rpi-cli/src/interactive_tui/panels.rs | the interactive mode port |
| the port-only slash commands: `/help`, `/?`, `/clear`, `/version`, `/v`, `/provider`, `/tools`, `/images`, `/usage` | rpi-cli/src/interactive_tui/commands.rs | the language lead — they are not in pi's registry, so an unregistered `/name` goes to the model |
| the five provider events that never fire and the four event payloads with missing keys | rpi-extensions/src/event_sink.rs, rpi-agent | the extension port |
| the thinking block in the port's own session files, and the `system` message entry pi writes | rpi-harness/src/session | the session port |
| the eight of pi's eleven wire protocols: amazon-bedrock, azure, google, google-vertex, mistral, openai-codex, radius, typesafe | rpi-ai/src/providers | the provider lead — the port implements anthropic-messages, openai-completions and openai-responses |

## Needs a decision

| Feature | Why it might not be portable | Recommendation |
| --- | --- | --- |
| the 63 image models and 46 classifier models | pi's catalogue ships them; the port's model types do not model them | decide: the port keeps the chat models and the classifier types, and the image and classifier catalogues are out of scope |
| the pi.dev remote overlay: `If-None-Match`, `models-store.json`, the offline restore | it is a live-service feature: the port would fetch pi's catalogue over the network | decide: out of scope, the port ships a static catalogue like the one in the tree |
| OpenRouter's per-key model list | the list depends on OpenRouter's account API | decide: out of scope |
| the Radius dynamic provider | Radius is pi's own deployment service | decide: the port does not talk to Radius; the Radius login row and the session share stay port-side |
| the colour algebra: oklch, okhsl, mixing, the contrast checks | pi's themes use oklch; the port resolves the colours it ships | decide: the port keeps RGB tokens, and a theme that uses oklch is resolved at load time rather than mixed at runtime |
| the regular-mode main screen repaints the whole transcript every frame | the original repaints only the changed range, and the port's regular mode has no viewport to diff against | port it: the fullscreen path already repaints only what changed |
| the port's own additions: the `/pet` panel, the plan and tasks panels, the provider add/remove form, `rpi update` / `events` / `package` / `dev` | pi has no equivalent | decide: keep them, they are additions and do not change pi's screens |
| `--skip-3d` | pi has no such flag; the user asked for one so an agent or a harness can start without the animation | keep it: it is an addition, and it defaults to off |
| the single-line input's yank-pop (Alt+Y) | pi's input has it; the port's does not | port it |
| `ansi::slice_by_column` strips the ANSI codes instead of preserving them | a helper, not a feature | port it |
| the caret can land inside a folded-paste marker | the wrap keeps the marker whole; the caret movement does not | port it |

## How a row leaves this file

A row leaves when the feature is ported and the harness shows the pane matching,
or when the user signs the row off as an exception. The harness is the evidence:
`node scripts/parity/run-all.mjs` has to be clean for the row to be called done,
and the screen captures in `scripts/parity/screens/` carry the per-screen diffs.

## A difference outside the UI

The token harness (`bench/tokens/token-usage.mjs`) sends the same prompt to the
same local model on both sides. The TypeScript original's request is 1357 tokens
with the prefix cached; the Rust port's is 2943 with nothing cached. The port's
prompt is not the same as the original's — the system prompt, the tool
declarations and the project context differ — so the server's prefix cache never
hits and the request carries the whole prompt every turn.

The port's system prompt is now derived from the active tool set, like pi's, and
it matches pi's tool list and guidelines exactly (`--tools read` prints only
`read` with read's guideline). What still differs is the length: pi's prompt is
3584 tokens and the port's is 1664, because the port does not yet carry the
project context and the tool schemas in pi's shape. That is the remaining cause
of the token difference, and it is a parity item, not an exception.
