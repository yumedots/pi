# The harness memory plan

Where the agent's memory goes, measured, and what can be taken out of it
without changing a feature.

## How the numbers were taken

Every MB is the median of 7-9 runs of a process that imports a module and
reports the RSS delta:

```bash
node --input-type=module --eval 'const r=()=>Math.round(process.memoryUsage().rss/1048576);
  const b=r(); await import("<module>"); console.log(r()-b)'
```

The "prefix" is the chain the attribution harness uses
(`bench/harness/memory-attribution.mjs`), so a candidate's number is its
*marginal* cost on top of what the agent already loaded:

```
typebox, typebox/compile, undici, ai/dist/providers/all.js, ai/dist/index.js,
tui/dist/index.js, coding-agent/dist/utils/syntax-highlight.js,
coding-agent/dist/core/tools/index.js, coding-agent/dist/core/settings-manager.js
```

The prefix is 51 MB; the whole agent (with the session and the interactive
mode) is 75-78 MB. The spread between runs is 2-3 MB, so a difference below
that is not a result.

## What is already changed

| change | effect |
| --- | --- |
| the tool validation no longer loads `typebox/compile` or `typebox/value` | the pi-ai barrel: 21 MB → 14 MB |
| the generated catalogs are built on first use | the provider catalogs: 15 MB → 13 MB |
| the bug report, the HTML exporter and the diff helpers load on demand | small, inside the noise of the agent's total |
| the model catalog is one file per provider again (the merged file was reverted) | the catalogs: 16 MB → 15 MB |

## The measured breakdown of what is left

Measured on top of the prefix, in the same process family:

| module | marginal | what it is |
| --- | --- | --- |
| `core/extensions/virtual-modules.js` | **+28 MB** | the plugin host's `typebox`, `typebox/compile` and `typebox/value` |
| `highlight.js/lib/index.js` | **+9 MB** | the whole highlight.js corpus, loaded one tick after the first screen |
| `core/model-config.js` | +7 MB | the models.json schemas, built at module scope |
| `core/bug-report.js` | +3 MB | the zip writer and the compaction module (now lazy) |
| `ai/dist/compat.js` | +2 MB | a second copy of every provider, plus the image surface |
| `core/model-resolver.js` | +2 MB | `minimatch` |
| `core/package-manager.js` | +3 MB | `minimatch` and `semver` |
| `core/export-html/index.js` | +1 MB | the HTML exporter (now lazy) |
| `modes/interactive/theme/theme.js` | +0 MB | already loaded by the tui |
| `utils/image-process.js` | +0 MB | the WASM encoder is already lazy |

Two of these are the same cost seen twice: the compat barrel is imported by
`core/provider-composer.ts:28`, `core/agent-session.ts:46` and
`core/compaction/compaction.ts:26`, and it builds a *second* complete provider
collection at module scope (`packages/ai/src/compat.ts:217`,
`const compatModels = builtinModels()`).

Two more are not visible in the import graph at all: the highlight.js corpus
and the 526 KB announcement PNG are loaded after the first render, so they
show up in the settled RSS (the harness's first-screen-to-idle gap is 19 MB).

## The plan, in the order it pays off

### 1. The lazy providers: -7 MB, the largest win left

Loading a provider module only when a provider is used recovers both the
parsing and the flattening of the catalog. The blocker is the credential
check: the auth config of a provider lives in the provider module, and the
check runs for every provider at startup, so the module has to load.

- Move each provider's `auth` config into a light module that does not import
  the catalog or the API implementation. Most are already light
  (`envApiKeyAuth("DeepSeek API key", ["DEEPSEEK_API_KEY"])`); the custom ones
  (anthropic, bedrock, cloudflare) only read `ctx.env()`.
- Give the ai package a factory map (`provider id -> () -> Provider`) instead of
  a map of built providers, and let the registry materialize a provider when it
  is first needed.
- The credential check then runs against the auth config alone.

### 2. The highlight.js corpus: -9 MB, a trade-off

`packages/coding-agent/src/utils/syntax-highlight.ts:61` imports
`highlight.js/lib/index.js`, which registers all ~190 grammars, and
`interactive-mode.ts:1113` calls it one tick after the first render. A session
highlights one to three languages.

A per-language lazy registry would keep the 21 eagerly registered grammars and
load the rest on demand. The behavior that changes: `highlightAuto`, the path
for a file whose extension is unknown, would only know the languages that were
loaded. The alternative is to keep the corpus and lose the 9 MB.

### 3. The plugin host's typebox: 28 MB, only for users with file extensions

`packages/coding-agent/src/core/extensions/virtual-modules.ts:7` imports
`typebox/compile` and `typebox/value` eagerly, and the module is loaded when
the first file-based extension loads. The plugins get the host's copy, so the
host has to have it.

The unbundled dev mode already resolves the plugins' `typebox` import to a
path, which jiti loads on demand. The bundled binary cannot: the map holds
namespace objects, so the copy has to be there. Making it lazy needs the
bundler to put typebox in its own chunk and the map to hold a getter, which
the ESM output cannot require synchronously.

### 4. The narrow compat import: -2 MB

Move the API registry (`registerApiProvider` / `getApiProvider` /
`registerBuiltInApiProviders`) into its own entry point. `compat.ts` re-exports
it unchanged, so the extension-facing surface stays the same. The compaction
needs `completeSimple`, which only the compat exports, so the core needs an
equivalent export first.

### 5. The tui's own eager allocations

- `packages/tui/src/utils.ts:4-5` builds two `Intl.Segmenter` instances at
  module scope, and `utils.ts:48` compiles `/^\p{RGI_Emoji}$/v`. The segmenters
  are the largest single allocation in the tui; both are pure, so they can be
  built on first use.
- `packages/tui/src/latex.ts` builds ~600 symbol-table entries for a feature
  that only runs when a markdown block contains `$...$`.
- `packages/tui/src/keys.ts` builds ~180 legacy key-sequence entries at module
  scope.

The coding-agent imports the tui *barrel* in 69 files, and the barrel pulls all
47 modules (620 KB of compiled JS). The package already publishes narrow
entries (`@earendil-works/pi-tui/colors`, `/components/text`, ...) and the
codebase already uses them in places, so switching the importers is mechanical.

### 6. The tools

- `packages/coding-agent/src/core/tools/index.ts` imports all eight tool
  modules, and each builds its typebox schemas at module scope, although a
  default session enables four tools.
- `core/tools/read.ts` reaches `node:worker_threads` through the image resize
  path; the WASM encoder is already lazy, the worker host is not.
- `core/tools/grep.ts` and `core/tools/find.ts` link the fd/rg downloader,
  which only runs when the binary is missing from PATH.

## What is not worth doing

- **The typebox builder (13 MB)**: the plugins need the host's copy. Removing
  `export { Type } from "typebox"` from the pi-ai barrel buys 0 for a user with
  extensions and breaks the barrel's public surface.
- **undici (6 MB)**: the global dispatcher carries the proxy support and the
  2 s connect timeout. Dropping it loses behavior.
- **The image pipeline, the theme, the syntax highlighter's 21 grammars**:
  measured at 0 MB on top of what the agent already loads.

## The floor

The runtime floor is 37.5 MB on Node and 17.3 MB on Bun; a native binary is
1.1 MB and the Rust daemon of the `env` package serves requests in 9.6 MB. The
harness cannot reach 10 MB on a JavaScript runtime, whatever the agent itself
costs.
