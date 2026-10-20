# Models

The port ships pi's model catalogue: **1621 chat models** across the 42
providers in [providers.md](providers.md), with the same ids, names, context
windows, costs, modalities and thinking support.

## The shipped catalogue

The catalogue is generated data, not hand-written code. It lives in
`crates/rpi-ai/src/providers/catalog/data/*.json`, one file per provider, and
is copied verbatim from pi's
`packages/ai/src/providers/data/*.json`. Pi generates those files with
`packages/ai/scripts/generate-models.ts` (models.dev plus the OpenRouter API);
the port embeds the same snapshot with `include_str!` and parses it once, on
first use.

Each entry carries the model id, display name, wire protocol, provider, base
URL, input modalities, cost (including the tiered rates), context window, max
tokens, thinking-level map and the protocol's compatibility flags. The loader
lives in `crates/rpi-ai/src/providers/catalog.rs`; the provider manifests (id,
display name, base URL, API-key env var, default model) live next to it.

To refresh the catalogue, copy the generator's output over the data directory
and update `catalog_data/manifest.json` with the new `generatedAt` timestamp.

## Custom providers

`~/.rpi/models.json` adds providers on top of the shipped catalogue:

```json
{
  "providers": {
    "my-gateway": {
      "api": "openai-completions",
      "baseUrl": "https://gateway.example.com/v1",
      "apiKey": "$MY_GATEWAY_API_KEY",
      "models": [
        { "id": "my-model", "name": "My Model", "contextWindow": 128000, "maxTokens": 8192 }
      ]
    }
  }
}
```

A provider id from `models.json` is its own routing and credential identity:
its models never appear under another provider's id, and its credential is
never sent to another provider's endpoint. The same merge happens for
provider packages (native extensions), whose manifests declare their models,
API-key env var and whether they need a credential at all.

## Listing models

`rpi --list-models` prints the models of the providers that have a credential,
mirroring pi's behaviour. With no credential configured it prints the login
guidance instead:

```
No models available. Use /login to log into a provider via OAuth or API key. See:
  docs/providers.md
  docs/models.md
```

## Choosing a model

- `--model <id>` selects a model by id.
- `--model <provider>/<id>` selects a model inside one provider.
- A trailing `:level` sets the thinking level (`off`, `minimal`, `low`,
  `medium`, `high`, `xhigh`, `max`).
- An unknown model id on a known provider is not an error: the run continues
  with that id on the provider's endpoint, and the port says so:

  ```
  warning: Model "nope" not found for provider "groq". Using custom model id.
  ```

- An unknown model id on no known provider is an error:

  ```
  error: Model "zzz-nope" not found. Use --list-models to see available models.
  ```
