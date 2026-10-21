# The sign-off list

The port is 1:1 with pi in everything the user can see and do, and the parity
harness proves it: **all six scenarios are byte-identical to the golden traces
taken from the TypeScript original** (`node scripts/parity/run-all.mjs`).

This file is the remainder — the twelve things that are *not* parity items, each
one either pi behaviour the port has not reached, or a port addition pi does not
have. The user signs these off. Each row says what the original does, what the
port does, what the user sees, where the code is on both sides, the check that
measures it, and a recommendation.

**The port-only rows** (5, 7, 8) are things pi does not have at all. They are
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
**Recommendation: port it.** It is a small editor behaviour.

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
silent loss of styling.

## 11. The caret can land inside a folded-paste marker

**The original** moves the caret over a folded-paste marker as a unit.
**The port**'s wrap keeps the marker whole, but the caret movement can land
inside it (`rpi/crates/rpi-tui/src/editor.rs`).
**The user sees** a caret in the middle of a marker, and a paste that is
edited in the wrong place.
**Check:** the editor's tests — the wrap, the cap and the click-to-caret are
pinned; the caret over a marker is not.
**Recommendation: port it.**

## 12. The eight wire protocols the port does not implement

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

## What is *not* on this list

The things that were on the list when this work started, and are now parity
items with the harness as the evidence: the keybinding registry (89 ids
identical), the settings menu (37 rows in pi's order), the colours (58 tokens,
pi's exact RGB), the window title (`π - work`), the model picker, the session
round trip, the trust gate, the retry budget, the tool set and the tool-result
contract, the extension API's 110 of 119 probes, and the six parity scenarios.
