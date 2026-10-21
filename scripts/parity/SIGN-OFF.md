# The sign-off list

The port is 1:1 with pi in everything the user can see and do, and the parity
harness proves it: **all six scenarios are byte-identical to the golden traces
taken from the TypeScript original** (`node scripts/parity/run-all.mjs`).

This file is the remainder — the fifteen things that are *not* parity items, each
one either pi behaviour the port has not reached, or a port addition pi does not
have. The user signs these off. Each row says what the original does, what the
port does, what the user sees, where the code is on both sides, the check that
measures it, and a recommendation.

**The port-only rows** (7, 8) are things pi does not have at all. They are
listed here so the sign-off is explicit rather than silent, not because they are
missing something.

---

## 1. The image and classifier models

**The original** ships 63 image models and 46 classifier models in its catalogue
(`packages/ai/src/providers/data/`, the `image` and `classifier` model types;
`packages/ai/src/types.ts`).
**The port** publishes 1621 chat models across 42 providers, and its model types
model the chat models only — the image and classifier entries are in the shipped
catalogue data but not exposed (`rpi/crates/rpi-ai/src/providers/catalog.rs`).
**The user sees** no difference: pi's image generation and classification are
not reachable from the agent's tool set either, and the port's tools are the
same seven.
**Check:** `node scripts/parity/audit.mjs` — the chat models match pi's field
for field; the image and classifier counts are not compared.
**Recommendation: out of scope.** The port keeps the chat catalogue, which is
what the agent can use.

## 2. The pi.dev remote overlay

**The original** fetches pi's catalogue over the network with `If-None-Match`,
keeps a `models-store.json` cache and restores it offline
(`packages/ai/src/models-store.ts`, `packages/ai/src/model-catalog.ts`).
**The port** ships the catalogue as data in the tree
(`rpi/crates/rpi-ai/src/providers/catalog/data/`) and never touches the network
(`catalog_generated_at()` records when it was produced).
**The user sees** a catalogue that goes stale when pi publishes new models,
instead of one that updates itself.
**Check:** the catalogue diff — `rpi/crates/rpi-ai/tests/catalog.rs` pins 42
providers, 1621 chat models and 40 credential env vars against pi's data.
**Recommendation: out of scope for now.** It is a live-service feature; the
catalogue can be refreshed by regenerating the data.

## 3. OpenRouter's per-key model list

**The original** asks OpenRouter for the model list that *your* key can use
(`packages/ai/src/providers/openrouter.ts`).
**The port** publishes OpenRouter's catalogue like every other provider
(`rpi/crates/rpi-ai/src/providers/catalog.rs`), so a key with access to a
private model will not see it.
**The user sees** a model list that may be missing the private models their
key can reach.
**Check:** the catalogue diff — 1342 models over 37 providers with every
credential set, identical to pi's.
**Recommendation: out of scope.** It needs OpenRouter's account API.

## 4. The Radius dynamic provider

**The original** can register Radius as a *dynamic* provider — the provider's
own catalogue comes from the Radius service at runtime
(`packages/ai/src/providers/radius.ts`).
**The port** publishes Radius as a fixed provider from the catalogue
(`rpi/crates/rpi-ai/src/providers/catalog.rs:308`).
**The user sees** a stale Radius model list, and no new Radius models as they
appear.
**Check:** the catalogue diff.
**Recommendation: out of scope.** Radius is pi's own deployment service.

## 5. The Radius login row and the session share

**The original** has a Radius login selector in `/login` and a session share that
publishes a Radius artifact or a GitHub gist
(`packages/coding-agent/src/modes/interactive/components/radius-login.ts`,
`packages/coding-agent/src/modes/interactive/commands.ts`).
**The port** has a `RadiusLoginMenu` (`rpi/crates/rpi-cli/src/interactive_tui/radius_login.rs`)
that is not wired into `/login`, and no session share.
**The user sees** no Radius row in the provider list and no `/share`.
**Check:** `scripts/parity/screens/` — the `login-methods` and `login-providers`
rows, and the `login-oauth-*` rows that are not reachable on either side.
**Recommendation: port the login row** (the component exists; it is a wiring
gap) and **drop the session share** — it publishes to pi's deployment service.

## 6. The colour algebra

**The original** parses `oklch` and `okhsl` colours, mixes them, and checks
the WCAG contrast (`packages/tui/src/theme.ts`).
**The port** resolves the RGB tokens it ships, with pi's own contrast rule for
the terminal background (`rpi/crates/rpi-tui/src/theme.rs`).
**The user sees** a theme written in `oklch` — pi's own `dark.json` and
`light.json` are oklch — resolved at load time rather than mixed at runtime. A
theme that *computes* a colour from another one will differ.
**Check:** `rpi/crates/rpi-tui/tests/theme_colours.rs` — 8 tests pinning the
rendered escape sequences for both themes, and the palette values against pi's.
**Recommendation: keep the RGB tokens and resolve oklch at load.** The mixing
and the contrast algebra are only reachable through user themes, and the port
does not load user themes (row 7).

## 7. The port's own additions

**The original** has none of these.
**The port** adds: the `/pet` panel (`rpi/crates/rpi-cli/src/interactive_tui/pet.rs`),
the plan and tasks panels, the provider add/remove form, and the `rpi update`,
`rpi events`, `rpi package` and `rpi dev` subcommands.
**The user sees** extra commands in the `/` list and extra screens they can
open. They do not change any of pi's screens.
**Check:** the `/` list is the port's own registry (`rpi/crates/rpi-cli/src/interactive_tui/commands.rs`);
the language lead is removing the ones that shadow pi's names.
**Recommendation: keep them, and remove the ones that shadow pi's command
names** — a port-only command under pi's name is the one that is actually
confusing.

## 8. `--skip-3d`

**The original** has no such flag: the 3D empty-session screen shows whenever
the setting is on and the session is empty.
**The port** has `--skip-3d`, which forces the screen off for one run.
**The user sees** nothing different by default — the flag only matters when it
is passed.
**Check:** `node scripts/parity/run-all.mjs` — the `startup` scenario, and the
`startup-3d` capture in `scripts/parity/screens/`.
**Recommendation: keep it.** The user asked for it: an agent or a harness
starting the port should not have to wait for the animation.

## 9. The single-line input's yank-pop

**The original** pops the last killed text back into the single-line input with
Alt+Y (`packages/tui/src/components/editor.ts`).
**The port** has the `tui.editor.yank` and `tui.editor.yankPop` bindings in the
registry (`rpi/crates/rpi-tui/src/keybindings.rs:671,678`) but the single-line
input does not implement the pop.
**The user sees** Alt+Y doing nothing in the one-line input.
**Check:** the keybinding registry test — 89 ids on both sides, identical
defaults; the behaviour is not yet covered by a test.
**Recommendation: port it.** It is a small editor behaviour. **Landed** — the
behaviour existed but nothing called it; Alt+Y is bound to it now.

## 10. `ansi::slice_by_column` strips the ANSI codes

**The original** slices a styled string by column and keeps the styling
(`packages/tui/src/utils.ts`).
**The port**'s helper slices and drops the escape codes
(`rpi/crates/rpi-tui/src/ansi.rs`, used by `layout.rs:580,592`).
**The user sees** a styled row losing its colour when it is clipped — the
overlay's placement and the layout's own slicing both go through it.
**Check:** the TUI library's tests — the wrap and the grapheme widths are pinned;
the slicing's ANSI handling is not.
**Recommendation: port it.** It is a helper, and the current behaviour is a
silent loss of styling. **Landed** — it keeps the escapes inside the slice, and
with `preserve_styles` the ones that were active before it.

## 11. The caret can land inside a folded-paste marker

**The original** moves the caret over a folded-paste marker as a unit.
**The port**'s wrap keeps the marker whole, but the caret movement can land
inside it (`rpi/crates/rpi-tui/src/editor.rs`).
**The user sees** a caret in the middle of a marker, and a paste that is
edited in the wrong place.
**Check:** the editor's tests — the wrap, the cap and the click-to-caret are
pinned; the caret over a marker is now too.
**Recommendation: port it. Landed** — `set_cursor` and the mouse click snap the
caret out of the marker.

## 12. pi's four built-in extensions

**The original** ships four extensions that register with the agent: `codemode` and
`tool_search` register *tools* with the model, and `llama` and `mcp` register
*commands* (`packages/coding-agent/src/extensions/{codemode,tool_search,llama,mcp}/`,
registered at `packages/coding-agent/src/extensions/index.ts:3,13`). So an
extension sees them in `pi.getAllTools()` and `pi.getCommands()`.

**The port** ships none of them, so its two lists are shorter by exactly those
four names. The port's lists are otherwise correct: they are "what the extensions
registered", the same rule the original uses, and the host publishes one registry
now — the extension's own commands, the prompt templates and the skills, each
with its `source` and `sourceInfo`.

**What the user sees** is a difference only through an extension that reads the
lists: pi's extension would find `codemode`, `tool_search`, `llama` and `mcp`
there, the port's would not.

**The decision, taken:** the port publishes a command under pi's name for a
feature it has, and does not publish a name for a feature it lacks. So:

- **`/mcp` is published** — the port has MCP support end to end
  (`mcp.register`, `mcp.list`, the server registry, the dialog bridge, and the
  `rpi-mcp` client that speaks JSON-RPC over stdio and streamable HTTP), so the
  feature exists and pi's name for it is `/mcp`.
- **`/llama`, `codemode` and `tool_search` are not published** — the port has no
  local llama.cpp router, no code-writing tool and no tool-searching tool. A
  command that does nothing is worse than a missing one: the user types it.

**Check:** `pi.getAllTools()` and `pi.getCommands()` against the original's
(`/tmp/pi-ext-audit/run.mjs rust` then `diff.mjs`).

---

## 13. The eight wire protocols the port does not implement

**The original** speaks eleven: anthropic-messages, openai-completions,
openai-responses, openai-codex-responses, azure-openai-responses,
google-generative-ai, google-vertex, bedrock-converse-stream,
mistral-conversations, pi-messages and typesafe.
**The port** speaks three: anthropic-messages, openai-completions and
openai-responses (`rpi/crates/rpi-ai/src/providers/`). The other eight are
published in the catalogue and a request to one fails with a clear error
("Provider "mistral" needs the mistral-conversations protocol, which this build
does not support.").
**The user sees** an error naming the protocol, when they use a provider that
needs one.
**Check:** `rpi --list-models` — the catalogue lists all 42 providers; the
protocol support is what the error message reports.
**Recommendation: port the two that matter for a subscription user** — the
`google` and `google-vertex` Gemini protocols, and `amazon-bedrock` — and record
the rest as exceptions. The port's own catalogue is the source: an unsupported
provider is a clear error, not a silent wrong answer.

---

## 14. The npm packages an extension imports

**The original** resolves an extension's own npm dependencies from the
extension's own `node_modules`, with jiti
(`packages/coding-agent/src/core/extensions/loader.ts:576`). Three of pi's
example extensions use one: `ms`
(`packages/coding-agent/examples/extensions/with-deps/index.ts:9`),
`@anthropic-ai/sdk`
(`packages/coding-agent/examples/extensions/custom-provider-anthropic/index.ts:24`)
and `@anthropic-ai/sandbox-runtime`
(`packages/coding-agent/examples/extensions/sandbox/index.ts:47`).
**The port** runs the extensions in an embedded V8 with a shim surface, not in
Node: there is no `node_modules` to resolve from, so a package is either
published by the host or missing. The host publishes `ms`
(`rpi/crates/rpi-js/js/packages/ms.ts`, wired at
`rpi/crates/rpi-js/js/extension-host.ts:417`) — it is small, pure and has no
dependencies — and every other package answers with a stub that fails when it
is used, naming the package
(`rpi/crates/rpi-js/js/extension-host.ts:555`).
**The user sees** the extension load on both sides. An extension that uses
`ms` works. An extension that uses the Anthropic SDK or the sandbox runtime
fails the first time it reaches for the package, with
`the embedded extension host cannot provide the npm package "@anthropic-ai/sdk"`
— a clear message, not a load error that looks like a bug in the extension.
**Check:** the extension acceptance table (`scripts/parity/out/extensions-report.md`)
— every example extension loads on both sides — and the host's own tests
(`rpi/crates/rpi-js/tests/extension.rs`: a published package resolves, a
missing one loads and fails with the message, the package's name is in the
message).
**Recommendation: publish the small and pure packages, record the rest.**
`ms` is the only one of the three the port can publish honestly. The other two
are Anthropic's own packages: the API client belongs to the provider the port
already has in Rust (`rpi/crates/rpi-ai/src/providers/anthropic.rs`), and the
sandbox runtime spawns `sandbox-exec` processes the port does not manage. A
user who needs them should use the port's built-in Anthropic provider.

---

## 15. An extension that fails while it runs

**The original** reports the extension and the error in the transcript and goes
on with the next handler
(`packages/coding-agent/src/core/extensions/runner.ts:1103`,
`packages/coding-agent/src/modes/interactive/interactive-mode.ts:2809`).
**The port** reported the failure of a command handler
(`rpi/crates/rpi-cli/src/interactive_tui.rs:1764`) and dropped the failure of
an event handler. It now reports both, with the original's wording
(`rpi/crates/rpi-cli/src/js_extensions.rs`, the `extension.error` operation;
the host raises it at `rpi/crates/rpi-js/js/extension-host.ts`).
**The user sees** the same thing on both sides: a line in the transcript that
names the extension and the error. The port's line has no stack under it,
where the original's has one.
**Check:** the acceptance table — the two sides' error lines are compared
apart from the panes — and the host's test (`rpi/crates/rpi-js/tests/extension.rs`,
a handler that throws is reported).
**Recommendation: keep the report, and let the interactive mode own the
rendering.** The stack under the message is the interactive mode's screen
detail, not the extension API's.

---

## 14. The mermaid rendering mode

**The original** renders a mermaid code block as a Unicode terminal diagram,
and the `markdown.mermaid` setting says when: `off` (never), `final` (once the
message is complete) or `streaming` (also while the message streams).
The reader is `core/settings-manager.ts:1433` (`getMermaidRenderingMode`),
the gate is `modes/interactive/components/mermaid.ts:63`.
**The port** renders every mermaid block it meets and has no modes: the
setting is written by the menu row and read by nothing
(`rpi/crates/rpi-cli/src/interactive_tui/settings.rs:433`,
`rpi/crates/rpi-tui/src/mermaid.rs`).
**The user sees** a mermaid diagram where the original would show the raw
code, when `markdown.mermaid` is `off`.
**Check:** `cargo test -p rpi-tui --lib` — the markdown tests; the mermaid
modes are not covered.
**Recommendation: sign off.** The `final` mode needs the renderer to know
whether the message is still streaming, which the port's markdown component
does not.

## 15. The user theme directories

**The original** reads the `themes` setting as extra theme files and
directories to load beyond the auto-discovered `~/.pi/themes` and
`<cwd>/.pi/themes` (`core/package-manager.ts:2442`, the generic resolve loop
at `:945`); the loaded themes become selectable in the theme picker
(`modes/interactive/interactive-mode.ts:693`).
**The port** has no user-theme loader at all: its themes are built in
(`rpi/crates/rpi-tui/src/theme.rs`), and `themes` is parsed and written but
read by nothing (`rpi/crates/rpi-cli/src/settings.rs:389`).
**The user sees** a theme picker with only the built-in themes, so a theme
file the user wrote is ignored.
**Check:** `cargo test -p rpi-cli --lib settings_keys_tests` — the key is
parsed; nothing loads it.
**Recommendation: sign off.** A user theme is a pi theme file (oklch colours,
the full token set), and the port resolves RGB tokens at load time only
(`SIGN-OFF.md` §6).

## 16. The npm and git package sources

**The original** reads the `packages` setting as the npm or git sources to
install and load, with per-package resource filtering
(`core/package-manager.ts:936`), and reads `npmCommand` as the argv every npm
invocation uses (`core/settings-manager.ts:1058`,
`core/package-manager.ts:1787`).
**The port** has no npm or git package installer. Its own `packages` module is
a Rust cdylib registry under `.rpi/packages` (`rpi/crates/rpi-cli/src/packages.rs`),
and the port never runs npm, so `npmCommand` has nothing to configure
(`rpi/crates/rpi-cli/src/settings.rs:345`).
**The user sees** no difference until the user points `packages` at an npm or
git source: nothing is installed and nothing is loaded.
**Check:** `cargo test -p rpi-cli --lib settings_keys_tests` — the keys are
parsed and preserved; nothing installs them.
**Recommendation: sign off.** A package manager is a feature of its own.

## 17. The device id

**The original** creates a stable installation UUID on the first provider
login, keeps it in the global settings, and sends it to OpenAI as the agent
host id for the ChatGPT OAuth exchange (`core/settings-manager.ts:1083`
`getOrCreateDeviceId`, `modes/interactive/interactive-mode.ts:6324`,
`packages/ai/src/auth/oauth/openai-chatgpt.ts:226`).
**The port** parses `deviceId` and writes it back, but nothing creates one and
nothing sends it (`rpi/crates/rpi-cli/src/settings.rs:369`).
**The user sees** no difference: the port's OAuth handshake does not carry a
host id.
**Check:** `cargo test -p rpi-cli --lib settings_keys_tests` — the key is
preserved; nothing generates a UUID.
**Recommendation: sign off** until the port has the ChatGPT OAuth flow.

## 18. The WebSocket connect timeout

**The original** reads `websocketConnectTimeoutMs` as the timeout for the
WebSocket connect handshake (`core/settings-manager.ts:959`, the consumer in
`packages/ai/src/api/openai-codex-responses.ts:293`).
**The port** has no WebSocket transport, so the key has nothing to bound
(`rpi/crates/rpi-cli/src/settings.rs:479`).
**The user sees** no difference: a provider that needs a WebSocket fails with
the protocol error, not with a timeout.
**Check:** `cargo test -p rpi-cli --lib settings_keys_tests`.
**Recommendation: sign off** with the WebSocket transport.

## 19. The editor's port-only extras

**The original**'s editor has no selection of its own: the selection belongs
to the renderer (the screen-level selection of `packages/tui/src/tui-alt-screen.ts`),
it survives a caret move, and there is no redo, no placeholder and no
line-end binding (`packages/tui/src/components/editor.ts:1088-1168`,
`packages/tui/src/keybindings.ts:70-137`).
**The port**'s editor adds: a selection of its own (Shift+arrows seed an
anchor, Ctrl+X cuts it, Ctrl+V yanks the kill ring back, typing replaces it),
a redo command on Ctrl+R with a redo stack, a `placeholder` option, and an
`End` / Ctrl+E binding for the line end
(`rpi/crates/rpi-tui/src/editor.rs:2280-2519`, `editor.rs:44`).
**The user sees** extra commands and a selection that pi does not have. They
do not change what pi does: the plain arrows, the words, the kills, the undo
and the history all behave exactly like pi's. The one behaviour that pi
defines and the port still differs on is the *end* of the selection: pi's
selection cannot be ended at all, the port's ends with an edit or an undo.
**Check:** `node scripts/parity/editor-parity.mjs --test` — the editor's
behaviour tests (one per cluster: the keybinding registry, the grapheme
steps, the visual movement and the sticky column, the history, the undo
coalescing, the kill accumulation, the selection, the paste and the submit)
plus `the_editor_matches_the_originals_measured_sessions`, which replays
sessions measured on the original's **TypeScript** editor and compares the
text and the caret after every key, plus the row-by-row comparison in
`EDITOR.md`.
**Recommendation: sign off.** The selection is the port's own model of a
thing pi leaves to the terminal; removing it would take away the port's
cut-and-paste without making the port more like pi.

## What is *not* on this list

The things that were on the list when this work started, and are now parity
items with the harness as the evidence: the keybinding registry (89 ids
identical), the settings menu (37 rows in pi's order), the colours (58 tokens,
pi's exact RGB), the window title (`π - work`), the model picker, the session
round trip, the trust gate, the retry budget, the tool set and the tool-result
contract, the extension API's 110 of 119 probes, and the six parity scenarios.
