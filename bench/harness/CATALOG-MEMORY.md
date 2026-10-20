# Where the model catalog's memory goes

The catalog is the largest app-level item that is not a runtime cost: the coding
agent creates all 42 builtin providers at startup, and every provider module
imports its catalog statically.

## The measurements

Every number is the median of 5 runs of a process that imports the module and
reports the RSS delta (`node --input-type=module --eval`).

| | RSS |
| --- | --- |
| all 42 catalog JSON files, parsed | 4 MB |
| all 42 catalog shards (parse + flatten) | 10 MB |
| the provider implementations on top (`providers/all.js`) | +6 MB |

So the catalog is 10 MB: **4 MB to parse the JSON** and **6 MB to flatten the
catalogs** into the maps the runtime uses. The provider implementations (the API
clients) are another 6 MB and are only needed for a provider that is actually
used.

## Why the providers are created eagerly

`packages/coding-agent/src/core/model-runtime.ts:228` builds every builtin
provider up front:

```ts
const providers = builtinProviderCatalog.builtinProviders().map((provider) => { ... });
```

`Models.getAuthenticatedProviders()` (`packages/ai/src/models.ts:697`) then
checks the credentials of every one of them, and `updateModelSnapshot()`
(`packages/coding-agent/src/core/model-runtime.ts:334`) reads all their models.
Both touch the provider objects, so the catalogs are loaded whether or not the
user ever talks to that provider.

## Two ways to defer it

### A. Lazy catalogs (smaller change, 6 MB)

The catalogs are flattened at module load, in the generated shard:

```ts
export const XAI_MODELS: ChatModelCatalog<typeof values, "xai"> =
	flattenChatModelCatalog("xai", values);
```

If the shard exported a lazy catalog instead, the flattening would happen when
the models are read, not when the module loads:

- `packages/ai/src/model-catalog.ts`: add a helper that wraps the flatten
  function in a proxy that materializes on first use.
- `packages/ai/scripts/generate-models.ts`: emit the lazy catalog in each shard.
- `packages/ai/src/models.ts`: `createProvider` accepts `models` as a value or a
  function, and materializes it on the first `getModels()` call.
- The 51 provider modules: `models: Object.values(XAI_MODELS)` becomes
  `models: () => Object.values(XAI_MODELS)`.
- `packages/coding-agent/src/core/model-runtime.ts`: the snapshot's `all` list
  becomes a getter, so startup does not read every model.

The JSON is still parsed at module load, so this recovers the 6 MB of
flattening and not the 4 MB of parsing.

### B. Lazy providers (bigger change, 10 MB)

Loading a provider module only when a provider is used recovers both the
parsing and the flattening. The blocker is the credential check: the auth
config of a provider lives in the provider module, and the check runs for every
provider at startup, so the module has to load.

- Move each provider's `auth` config into a light module that does not import
  the catalog or the API implementation. Most are already light
  (`envApiKeyAuth("DeepSeek API key", ["DEEPSEEK_API_KEY"])`); the custom ones
  (anthropic, bedrock, cloudflare) only read `ctx.env()`.
- Give the ai package a factory map (`provider id -> () => Provider`) instead of
  a map of built providers, and let the registry materialize a provider when it
  is first needed.
- The credential check then runs against the auth config alone, and the
  provider module loads when the user picks that provider.

This is the change that makes the catalog free at startup for a user with one
provider configured.

## What it is worth

| | RSS at idle |
| --- | --- |
| today | 77 MB of imports for the whole agent |
| with A | 71 MB |
| with B | 67 MB |

The floor of the runtime is 37.5 MB on Node and 17.3 MB on Bun, so neither
change gets the harness near 10 MB. They are the largest remaining wins that do
not change any behavior.
