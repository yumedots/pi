# Provider parity — providers, catalogue, credentials, model resolution

Area owner: the provider porter (rpi-ai catalogue + rpi-cli provider layer).
The provider lead verifies; the porter does not mark its own work verified.

## 1. The shipped catalogue

| | original | port (before) | port (now) |
|---|---|---|---|
| providers | 42 | 2 | 42 |
| chat models | 1621 | 8 | 1621 |
| image models | 63 | 0 | 0 — the model types belong to another agent |
| classifier models | 46 | 0 | 0 — same |
| API-key env vars | 40 | 2 | 40 |
| wire protocols implemented | 11 | 3 | 3 |

- original: `packages/ai/src/providers/all.ts:129` (`builtinProviders()`), the generated
  snapshot in `packages/ai/src/providers/data/*.json` (generator:
  `packages/ai/scripts/generate-models.ts`).
- port: the snapshot is vendored verbatim at
  `rpi/crates/rpi-ai/src/providers/catalog/data/*.json`; the loader and the 42-entry
  provider manifest table are `rpi/crates/rpi-ai/src/providers/catalog.rs`
  (`builtin_models()`, `builtin_provider()`, `builtin_providers()`,
  `DEFAULT_MODEL_PER_PROVIDER`, `catalog_generated_at()`).
- the CLI reads it: `rpi/crates/rpi-cli/src/provider.rs` `build_catalog()` calls
  `builtin_models()`. The hand-written list (`rpi/crates/rpi-ai/src/providers/anthropic/models.rs`)
  and `openai_responses_models()` are deleted — one source of truth.
- what the user sees: `/model`, `--list-models` and the provider picker now show pi's
  names and numbers (`Claude Haiku 4.5 (latest)`, `claude-opus-5` 1M/128K,
  `claude-sonnet-5` 1M/128K, `claude-fable-5` 1M/128K, `claude-opus-4-8` 1M/128K) and
  all 42 providers, not only Anthropic.
- check: `cargo test -p rpi-ai --features providers --test catalog` (provider count,
  model count, every provider id, the env-var count, per-model fields, cost tiers);
  a field-by-field diff of the port's catalogue against the original's JSON gives
  1621/1621 chat models and **0 field differences**.

## 2. `--list-models` shows only authenticated providers

- original: `packages/coding-agent/src/core/model-resolver.ts` + `Models.getAvailable()`
  — only the models of providers that have a credential; with none, the login guidance.
- port: `rpi/crates/rpi-cli/src/provider.rs` `providers_with_credentials()`;
  `rpi/crates/rpi-cli/src/app.rs` `list_models()` filters on it.
- what the user sees: `ANTHROPIC_API_KEY=dummy rpi --list-models` → exactly pi's 17
  anthropic models; `GROQ_API_KEY=dummy` → groq's 7; no credential → the
  `No models available. …` guidance.
- check: the binary, plus `rpi/crates/rpi-ai/tests/catalog.rs`.

## 3. Model-resolution error sentences

| case | original | port |
|---|---|---|
| unknown provider | `Unknown provider "x". Use --list-models to see available providers/models.` (`model-resolver.ts:487`) | same |
| model not found | `Model "x" not found. Use --list-models to see available models.` (`model-resolver.ts:511`) | same |
| ambiguous model | `Model "x" is ambiguous across providers: …` (`model-resolver.ts:500-503`) | same |
| empty catalogue | `No models available. Check your installation or add models to models.json.` (`model-resolver.ts:466`) | same |
| known provider, unknown model | warning `Model "x" not found for provider "y". Using custom model id.` (`model-resolver.ts:526`), the run continues | same (carried on `ResolvedModel.warning`; **not printed at startup** — the original carries it as a runtime diagnostic and prints it only in the non-interactive modes) |
| invalid thinking level | `Invalid thinking level "x" in pattern "y". Using default instead.` (`model-resolver.ts:222`) | **still different**: `Invalid thinking level "x" in model pattern. Valid: <levels>` (`rpi/crates/rpi-cli/src/provider.rs`, `ResolveError::InvalidThinkingLevel`) — the port raises it as an error where the original warns and continues. Left for the next pass; it is a wording + behaviour change in the resolver. |

## 4. No model without a credential, and the saved default

- original: `findInitialModel` (`model-resolver.ts:543-611`) has four steps —
  1. the first scoped model; 2. **the saved default from the settings
  (`defaultProvider` + `defaultModel`), only when that provider has auth**;
  3. the first available model, preferring `defaultModelPerProvider`; 4. no model.
  The footer then reads `no-model`
  (`packages/coding-agent/src/modes/interactive/components/footer.ts:460`).
- port: `ResolvedModel.model` is `Option<Model>`; `pick_default_model()` implements
  steps 2–3 (the saved default first, then the provider defaults, then the first
  authed model) and returns `None` when nothing is authenticated;
  `provider::no_model()` is the placeholder the harness runs with; the footer gets
  `set_model("no-model")`, `set_provider(None)`, `set_model_reasoning(false)` and no
  thinking level (`rpi/crates/rpi-cli/src/interactive_tui.rs`).
- **the user's report**: with `opencode-go` + `minimax-m3.1-flash-free` configured in
  `~/.pi/agent/settings.json`, the port picked `kimi-k3` (the provider default). The
  saved-default lookup is now inside `pick_default_model` (pi's step 2) and runs
  before the provider defaults, with the same "the provider has a credential"
  predicate pi uses.
- what the user sees: with nothing connected, the startup pane shows the header, the
  hint line and the docs line — and nothing else (no warning, no guidance, no
  "no model selected", no provider name); the footer reads `no-model`; a request
  answers with `No model selected. …` (the request path, not startup).
- check: `rpi/crates/rpi-cli/src/provider.rs` tests — the saved default wins over the
  provider default, the provider default is used when the saved model is not in the
  catalogue, a saved model without a credential does not win, and no credential means
  no model.

## 5. The no-models message rides on the runtime

- original: `packages/coding-agent/src/sdk.ts:247` sets
  `modelFallbackMessage = formatNoModelsAvailableMessage()` when no model resolves;
  the interactive mode renders it as a warning in the transcript
  (`modes/interactive/interactive-mode.ts:1313-1315`); print and JSON modes print it
  on stderr and exit (`main.ts:942-945`).
- port: `ResolvedModel.model_fallback_message: Option<String>` (set when no model
  resolves; the wording comes from `auth_guidance::no_models_available_message()`,
  which matches pi byte for byte). The print/JSON path prints it at
  `rpi/crates/rpi-cli/src/app.rs`. The interactive mode port owns the transcript
  slot — it binds `resolved.model_fallback_message`.

## 6. Provider wire details

- Cloudflare's base URLs carry `{CLOUDFLARE_ACCOUNT_ID}` / `{CLOUDFLARE_GATEWAY_ID}`.
  Original: `packages/ai/src/providers/cloudflare-stream.ts:12` (`resolveCloudflareModel`).
  Port: `rpi/crates/rpi-ai/src/model.rs` `resolve_base_url()`, applied at the request
  URL in all three providers. The credential needs the account id (and the gateway id
  for the AI Gateway) — `packages/ai/src/providers/cloudflare-auth.ts:34`; port:
  `rpi/crates/rpi-cli/src/credentials.rs` `required_env()`.
- OpenCode needs the per-conversation routing header. Original:
  `packages/ai/src/providers/opencode-headers.ts` (and the session id it carries:
  `packages/coding-agent/src/core/agent-session.ts:4285` and `:4405` set
  `sessionId: this.sessionId`). Port:
  `rpi/crates/rpi-ai/src/model.rs` `opencode_session_header()`, applied in all three
  providers from the request's session id, and the session id now reaches the
  request: `rpi/crates/rpi-harness/src/agent_harness.rs` keeps the session's id on
  the harness and puts it in the stream options for the main request and for the
  deferred poll. **Without it the OpenCode gateway rejects every request with
  `400 MissingSessionID`** — that was the user's "we cannot use the opencode-go
  api" report, not the saved-default bug.
  Check: `rpi/crates/rpi-ai/src/model.rs` `opencode_header_tests` (the header is
  present for `opencode`/`opencode-go` and absent for other providers and without
  a session id).
- provider failure text: original `packages/ai/src/utils/error-body.ts:128`
  (`formatProviderError`) + `pickBodyText`; port:
  `rpi/crates/rpi-ai/src/error.rs` (`AiError::Http` carries the exact text;
  `pick_body_text()` unwraps a parsed `error` object) — anthropic prints
  `{status} {body}`, openai `{status}: {body}`.

## 7. Providers whose protocol the port does not implement

`amazon-bedrock` (bedrock-converse-stream), `azure` (azure-openai-responses),
`google` (google-generative-ai), `google-vertex` (google-vertex), `mistral`
(mistral-conversations), `openai-codex` (openai-codex-responses), `radius`
(pi-messages), `typesafe` (typesafe-system-one, classifier only).

They are published (the catalogue matches pi) and a request fails with
`Provider "x" needs the y protocol, which this build does not support.` — never a
panic. Port: `rpi/crates/rpi-cli/src/provider.rs` (`ResolveError::UnsupportedProtocol`,
`RuntimeFactories::supports()`) and `rpi/crates/rpi-cli/src/provider/factories.rs`.

## 8. Not done

- **The pi.dev remote catalogue overlay** (phase 5): no `If-None-Match`, no
  `models-store.json`, no `PI_OFFLINE` overlay. The shipped catalogue is the
  stopping point; `catalog_generated_at()` is in place for it.
- Image and classifier models (63 + 46) — the model types belong to another agent.
- The 9 OAuth flows, OpenRouter's per-key model list, the Radius dynamic provider.
- The invalid-thinking-level sentence (§3).

## 9. OAuth (not implemented)

The original offers an OAuth login for nine providers. The port has none yet.

| provider | original | port |
|---|---|---|
| anthropic | Claude Pro/Max (`packages/ai/src/providers/anthropic.ts:81`) | API key only |
| github-copilot | GitHub Copilot (`github-copilot.ts:15`) | `COPILOT_GITHUB_TOKEN` only |
| kimi-coding | Kimi Code (`kimi-coding.ts:14`) | `KIMI_API_KEY` only |
| meta | Muse (`meta.ts:14`) | `META_API_KEY` only |
| openai | ChatGPT (`openai.ts:16`) | `OPENAI_API_KEY` only |
| openai-codex | ChatGPT Plus/Pro (`openai-codex.ts:13`) | not usable at all |
| openrouter | OpenRouter OAuth (`openrouter.ts:69`) | `OPENROUTER_API_KEY` only |
| xai | Grok/X subscription (`xai.ts:14`) | `XAI_API_KEY` only |
| radius | Radius (`radius.ts:39`) | `RADIUS_API_KEY` only |

Order of work: the screens (the original's provider list and login dialog, built
from the screen-capture agent's diffs), then the flows (device code + browser,
token exchange), then the credential written to the agent directory's `auth.json`.
The file shape is already pi's: `rpi/crates/rpi-cli/src/config.rs:238`
(`#[serde(rename_all = "snake_case", tag = "type")]`), so an OAuth result is
`{"<providerId>":{"type":"oauth","access":…,"refresh":…,"expires":…}}` — the same
shape `packages/coding-agent/src/core/auth-storage.ts:234-247` reads.

## 10. The auth-screen row data (to add)

The interactive-mode audit needs the provider model to carry the original's auth
row data. The picker is theirs; the data is provider work.

- original: `packages/coding-agent/src/modes/interactive/components/oauth-selector.ts:18-25`
  (`formatAuthSelectorProviderType`) and `:30-52` (`formatAuthSelectorProviderStatus`);
  one row per auth type a provider offers, sorted by `name.localeCompare`
  (`interactive-mode.ts:5792-5813`).
- port (to add): `rpi/crates/rpi-ai/src/providers/catalog.rs` `BuiltinProvider` needs
  `oauth_name: Option<&'static str>` (pi's `lazyOAuth({name})` display names:
  "Anthropic (Claude Pro/Max)", "GitHub Copilot", "Kimi Code (subscription)",
  "Meta (Muse subscription)", "OpenAI (ChatGPT subscription)",
  "OpenAI (ChatGPT Plus/Pro)", "OpenRouter OAuth", "xAI (Grok/X subscription)",
  "Radius") and `oauth_subscription: bool` (pi's `isSubscription`; `false` → the row
  says "account"). The nine OAuth providers: anthropic, openai, openai-codex,
  github-copilot, openrouter, kimi-coding, meta, xai, radius.
- port (to add): `rpi/crates/rpi-cli/src/credentials.rs` should expose a status in pi's
  vocabulary so the picker does not re-derive it:

  ```rust
  pub enum ProviderAuthType { ApiKey, OAuth }
  pub enum ProviderAuthSource { Runtime, Stored, Environment, ModelsJsonKey, ModelsJsonCommand, Fallback }
  pub struct ProviderAuthStatus { pub configured: bool, pub source: Option<ProviderAuthSource>, pub label: Option<String> }
  pub fn provider_auth_status(provider_id: &str) -> ProviderAuthStatus
  ```

  Mapping from the port's `CredentialSource` (`credentials.rs:8`): `StoredOauth` →
  `Stored` + label "OAuth"; `StoredApiKey` → `Stored` + label "stored credential";
  `Environment(name)` → `Environment` + label `name`; `ModelsJson` → `ModelsJsonKey`
  (or `ModelsJsonCommand` for a command value); `Headers` → `Fallback`; `Anonymous` →
  configured; `Missing` → not configured.
- the model list side: the rows are `[<provider>]` plus " · default" for the saved
  default (`components/model-selector.ts:187-188`), sorted current first, default
  second, then by provider (`:229-244`). The catalogue keeps pi's declaration order
  in `build_catalog`, so the provider order is already stable and available from
  `rpi_ai::providers::catalog::builtin_providers()`.
- checks: a test that the nine OAuth providers report their pi display name and
  subscription flag (and the other 33 report none); a test for
  `provider_auth_status` (stored oauth → "OAuth", stored key → "stored credential",
  env → the env var name, nothing → not configured); the auth-screen capture diff.

## Build note

`cargo build --workspace` was last blocked by `crates/rpi-tools/src/tools/image.rs`
(`AgentToolResult` gained a `usage` field; the three initializers do not set it) —
not the provider area. No file in the provider area reports an error.
