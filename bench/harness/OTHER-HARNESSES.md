# Other coding-agent harnesses: model catalogs, provider SDKs, and idle memory

Research date: 2026-10-20. Every RSS/memory number below carries its source and attribution.
"User report in issue N" = a reporter's own measurement, not a vendor figure. "Not measured in the
sources" = no idle RSS figure was found in the project's repo, docs, issues, or vendor pages.

---

## 1. Comparison table

| Harness | Language / runtime | Model catalog approach | Measured idle RSS | Source |
| --- | --- | --- | --- | --- |
| Claude Code | TS, bundled with Bun; **native binary** since npm 2.1.113 (no Node resident) | **Hardcoded in the bundle** — max-output-token map, context window, cost table, display names. No model-list endpoint. | **~700 MB** idle per instance (user report, v2.1.148). 400 MB stable on an npm build (comment in same thread). | [issues/61425](https://github.com/anthropics/claude-code/issues/61425), [issues/67433](https://github.com/anthropics/claude-code/issues/67433) |
| Codex CLI | **Rust** (`codex-rs`); TS implementation removed from the repo | **Bundled JSON 472,072 B** (`codex-rs/models-manager/models.json`, 11 models), embedded via `include_str!` and **parsed eagerly**; + 300 s disk cache (`~/.codex/models_cache.json`) with ETag remote refresh | Not measured in the sources. Closest: a user's "~23 MB" starting RSS before subagent fan-out (v0.130.0). | [models-manager/src/lib.rs](https://github.com/openai/codex/blob/main/codex-rs/models-manager/src/lib.rs), [issues/23260](https://github.com/openai/codex/issues/23260) |
| Goose | **Rust** (workspace: `goose`, `goose-providers`, `goose-agent`, …) | **3 layers**: (1) bundled `canonical_models.json` **5,449,440 B** → **zstd-19 = 145,588 B**, `include_bytes!` + parsed inside a `once_cell::Lazy` (**lazy**); (2) background refresh of `models.dev/api.json`; (3) 50 declarative provider JSONs (71,927 B total), parsed per provider | Not measured in the sources | [canonical/registry.rs](https://github.com/aaif-goose/goose/blob/main/crates/goose-provider-types/src/canonical/registry.rs), [model_catalog.rs](https://github.com/aaif-goose/goose/blob/main/crates/goose/src/model_catalog.rs) |
| Crush | **Go 1.27**, single binary, Bubble Tea v2 | **No catalog in the binary**: fetched from Catwalk (`GET https://catwalk.charm.land/v2/providers`, ETag, 45 s timeout) → disk cache `<data>/providers.json` → `go:embed` fallback in the *dependency* (42 files, 786,433 B); plus per-provider `/v1/models` discovery | Not measured in the sources. (User report of a 45–50 GB anonymous-RSS leak, v0.79.0.) | [internal/config/provider.go](https://github.com/charmbracelet/crush/blob/main/internal/config/provider.go), [issues/3162](https://github.com/charmbracelet/crush/issues/3162) |
| Aider | **Python** | **Fetched, never bundled by aider**: `ModelInfoManager.MODEL_INFO_URL` = litellm's JSON, `requests.get(timeout=5)`, 24 h disk cache in `~/.aider/caches/`. Small hardcoded lists only (31 OpenAI / 24 Anthropic / 20 aliases). litellm itself *also* fetches the same JSON at import time | Not measured in the sources. (User report: "500mb memory usage" while indexing, v0.86.1.) | [aider/models.py](https://github.com/Aider-AI/aider/blob/main/aider/models.py), [issues/4661](https://github.com/Aider-AI/aider/issues/4661) |
| OpenCode | **TS on Bun** (repo `anomalyco/opencode`) | **Bundled snapshot + live fetch**: `packages/core/src/models-dev/snapshot.txt` **5,855,270 B**, decoded **once per isolate** into a module-level `bundledCache`; runtime source `https://models.opencode.ai/api.json`, 10 s timeout, **5-min TTL** KV cache + SHA-256 digest so a byte-identical body is a no-op | Not measured in the sources. (User report: "RSS grows from 400MB to 150GB+ over 3–4 hours", `opencode serve`.) | [packages/core/src/models-dev.ts](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/models-dev.ts), [issues/20695](https://github.com/anomalyco/opencode/issues/20695) |
| Cline | **TS/Node** (VS Code extension + CLI) | **Bundled generated catalog, eagerly imported**: `sdk/packages/llms/src/catalog/catalog.generated.ts` **4,747,187 B** of TS literals generated from models.dev, **statically imported** through the barrel. A live models.dev path exists but is not the default | Not measured idle. **Process-tree RSS mean 443.5 MB / peak 706.1 MB** during a 100-turn workload (author measurement, harness-perf-benchmark) | [catalog.generated.ts](https://github.com/cline/cline/blob/main/sdk/packages/llms/src/catalog/catalog.generated.ts), [harness-perf-benchmark](https://github.com/KonghaYao/harness-perf-benchmark) |
| Roo Code | **TS/Node** VS Code extension | **Hardcoded per-provider TS tables** (`packages/types/src/providers/*.ts`, 25 files; `openai.ts` 19,624 B) typed by a zod `modelInfoSchema`. Dynamic providers fetched lazily (NodeCache, 5-min TTL + on-disk JSON) | Not measured in the sources. (User report: VS Code "balloons to 3-4 GB … at ~200 MB/sec"; reporter expected "< 500 MB".) | [providers/anthropic.ts](https://github.com/RooCodeInc/Roo-Code/blob/main/packages/types/src/providers/anthropic.ts), [issues/5005](https://github.com/RooCodeInc/Roo-Code/issues/5005) |
| Gemini CLI | **TS/Node ≥20**, ESM | **Hardcoded in code, no network**: `config/models.ts` (22,854 B) + `config/defaultModelConfigs.ts` (21,749 B, 44 entries) | Not measured in the sources. Vendor ships a **7 GB** high-memory warning threshold. | [config/models.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/config/models.ts), [useMemoryMonitor.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/ui/hooks/useMemoryMonitor.ts) |
| Qwen Code | **TS/Node ≥22**, ESM | **Bundled snapshot + daily refresh**: `models/generated/model-registry.json` **41,555 B** (299 models, `source: models.dev`), statically imported; refresh of `models.dev/api.json` every 24 h with ETag, into `~/.qwen/model-registry.json` | Not measured idle. **Tree RSS peak 436 MB** (launcher 49 MB, CLI child ~390 MB at 2.7 s, steady 370–412 MB) — Qwen maintainers' own measurement | [model-registry.json](https://github.com/QwenLM/qwen-code/blob/main/packages/core/src/models/generated/model-registry.json), [issues/12405](https://github.com/QwenLM/qwen-code/issues/12405) |
| smolagents | **Python** | **No catalog at all**: model ids go straight to the provider SDK; cost/context metadata only via litellm's map (bundled in the wheel *and* fetched at import). `LiteLLMModel` never calls `litellm.get_model_info` | Not measured in the sources | [smolagents/models.py](https://github.com/huggingface/smolagents/blob/main/src/smolagents/models.py) |
| Continue | **TS/Node** | **Bundled TS tables** (`packages/llm-info/src/providers/*.ts`, 54,769 B; GUI copy 92,560 B); runtime model lists fetched from provider APIs (`openrouter.ai/api/v1/models`, Anthropic `/v1/models`, Gemini `v1beta/models`). No `models.json`, no `api.continue.dev` catalog | Not measured in the sources. (User report: extension host "from 600 MB to 3GB+" while idle.) | [llm-info/src/index.ts](https://github.com/continuedev/continue/blob/main/packages/llm-info/src/index.ts), [issues/1318](https://github.com/continuedev/continue/issues/1318) |

---

## 2. Theme: how model catalogs are loaded

Five distinct patterns, all present in the wild:

1. **Hardcoded in source, no network** — Codex (472 KB JSON), Gemini CLI (~45 KB TS), Roo Code (per-provider TS), Claude Code (inside the bundle). Cheapest at runtime; requires a release to update.
2. **Bundled snapshot + background refresh** — OpenCode (5.86 MB `snapshot.txt` + 5-min fetch), Qwen Code (41.5 KB registry + daily fetch), Codex (472 KB + 300 s disk cache with ETag).
3. **Compressed + lazily parsed** — **Goose, the best precedent for pi.** `canonical_models.json` is **5,449,440 B** raw; its build script zstd-19 compresses it to **145,588 B (37×)** and the runtime embeds that with `include_bytes!`, decompressing + parsing inside a `once_cell::Lazy` so the cost is paid on first use, not at boot. *(Verified independently: `zstd -19` on the same file → 145,588 B; the file has 8,410 top-level model entries.)*
4. **Fetch-only, never bundled** — Aider (24 h disk cache of litellm's JSON), Crush (Catwalk API + disk cache + `go:embed` fallback), litellm itself (network fetch at import, bundled `model_prices_and_context_window_backup.json` only parsed on failure, `LITELLM_LOCAL_MODEL_COST_MAP=True` forces local).
5. **Bundled *and* eagerly imported** — **Cline: the anti-pattern** pi currently resembles. A 4.75 MB generated TS file statically imported through the package barrel.

Catalog byte sizes (measured 2026-10-20 where noted):

| Artifact | Bytes | Notes |
| --- | ---: | --- |
| `models.dev/api.json` | 5,855,451 | 231 providers / 9,075 models (counted). No per-provider split is published — `?provider=openai` still returns everything. |
| OpenCode `snapshot.txt` | 5,855,270 | Same data, bundled. |
| Goose `canonical_models.json` | 5,449,440 | → **145,588 B** at zstd-19. 8,410 entries. |
| Cline `catalog.generated.ts` | 4,747,187 | Generated TS literals, eagerly imported. |
| litellm `model_prices_and_context_window.json` | 2,946,669 | 4,225 entries; also shipped inside the wheel. |
| catwalk embedded provider configs | 786,433 | 42 files, in a *dependency*, parsed only on cache+network failure. |
| Codex `models.json` | 472,072 | 11 models, eagerly parsed. |
| Continue GUI `configs/models.ts` | 92,560 | |
| Continue `packages/llm-info` | 54,769 | 15 provider files. |
| Qwen `model-registry.json` | 41,555 | 299 models, 1/120th of models.dev — a *projected* subset. |
| Crush `providers.json` (disk cache) | ~372 KB | User report, issue #3162. |

**Key asymmetry:** everyone else either compresses, projects, lazily parses, or fetches. pi's 43 provider
lists (~10 MB) are the only case of a large catalog parsed eagerly at startup.

## 3. Theme: provider SDK loading

**Lazy (per-provider dynamic import):**
- **OpenCode** — `packages/core/src/provider.ts` keeps a `builtins` map of `() => import("@opencode/ai/providers/<name>")` for ~60 entrypoints; `loadPackage()` resolves/imports on demand and can `npm add` unknown providers.
- **Cline** — `sdk/packages/llms/src/providers/ai-sdk.ts` does `await import("./vendors/openai")`, `./vendors/anthropic`, … ; each vendor then statically imports its `@ai-sdk/*` package.
- **Qwen Code** — `core/contentGenerator.ts` uses `await import('./openaiContentGenerator/index.js')` etc., with an explicit rule to keep `undici` out of the eager startup closure (issue #7264).
- **Aider** — `aider/llm.py` wraps litellm in `LazyLiteLLM` (`__getattr__` → `importlib.import_module`), with the comment *"`import litellm` takes 1.5 seconds, defer it!"*.
- **smolagents** — `import litellm` / `import openai` / `import boto3` happen inside the model classes.

**Eager (the anti-pattern):** Roo Code (`src/api/index.ts` statically imports ~26 handlers → `@anthropic-ai/sdk`, `openai`, `@aws-sdk/client-bedrock-runtime`, `@google/genai`), Gemini CLI (`@google/genai` static; single provider), Continue (all ~60 provider classes static; AWS SDK runtime-static), Claude Code (SDK inlined in the bundle).

**Statically linked (Rust/Go):** Codex, Goose and Crush compile every provider in, but *construct* the client on demand per session (`ProviderDef::from_env` → `BoxFuture`; a `tokio::sync::OnceCell` registry). Compile-time linking costs disk, not RSS.

## 4. Theme: runtime/language choice (Codex, Goose, Crush)

**Why Codex left Node** — official rationale, [discussion #1174](https://github.com/openai/codex/discussions/1174) (fouad-openai, 2025-05-30): (a) *zero-dependency install* — "currently Node v22+ is required"; (b) *native security bindings*; (c) *"Optimized Performance — no runtime garbage collection, resulting in lower memory consumption"* — a **claim, with no number attached**; (d) an extensible "wire protocol" so extensions can be written in other languages. **No controlled Rust-vs-TypeScript RSS comparison exists** — not measured in the sources.

**What they gave up:** the npm/TS ecosystem. `codex-cli/` in the repo is now just `bin/codex.js`, a launcher that `spawn`s a prebuilt per-platform native binary; the TypeScript implementation was deleted from the repo.

**What they gained (measured, same batch):** see §6.

**Goose** split into crates (`goose-providers`, `goose-agent`, `goose-context-management`, `goose-local-inference`), with AWS Bedrock/SageMaker behind cargo features rather than runtime loading.

**Crush** is a single Go binary that keeps the catalog *entirely out of the binary* — fetched from Catwalk, cached on disk, with a `go:embed` fallback living in the dependency.

**Claude Code made the same move Codex did, a year later**: from a bundled Node CLI (`package/cli.js` = 11,011,987 B at 2.0.77; 13,468,528 B at 2.1.100) to a native binary (npm 2.1.113+, `postinstall` copies a platform binary, "no Node.js process stays resident") — at the cost of a **271,161,873 B** darwin-arm64 artifact. Trading RSS for disk, not eliminating the problem: the ~700 MB idle report is *post*-native-binary.

**Python harnesses (aider, smolagents)** show the runtime is not the lever — lazy imports are.

## 5. Theme: the tool-schema / JSON-schema cost

**No harness pays pi's TypeBox bill.** Breakdown of what each actually does at runtime:

| Harness | Runtime schema handling |
| --- | --- |
| Codex | **Hand-rolled JSON Schema** (`codex-rs/tools/src/json_schema.rs`, 14 KB). `schemars` is derive-only, for config/protocol. **No runtime validator.** |
| Crush | Tool params are typed Go structs; `fantasy` generates schema by reflection. But `kaptinlin/jsonschema` builds a **new compiler on every validation call** (`schema.go:321`) — a per-call cost, not a startup cost. `invopop/jsonschema` is config-only. |
| smolagents | **Hand-rolled** from Python type hints (`_function_type_hints_utils.py`). No jsonschema/pydantic import. |
| Continue | **Raw JSON Schema objects** (`Tool.function.parameters: Record<string, any>`). zod is used for *config* validation only. |
| Claude Code | Plain JSON `input_schema`; `zod` appears 9 times in an 11 MB bundle. **[INFERENCE]** no JSON-Schema compiler at runtime. |
| OpenCode | Effect `Schema` → JSON Schema; `packages/schema/src/tool.ts` accepts `Schema.Codec | StandardSchemaV1 | JsonSchema.JsonSchema` — **plain JSON Schema is allowed**. No Ajv. |
| Cline / Roo Code | zod only, for config/model schemas. No Ajv/TypeBox. |
| Gemini CLI | **Ajv 8.17.1 + zod-to-json-schema, eagerly imported** (`utils/schemaValidator.ts`, re-exported from the core barrel). |
| Qwen Code | **Ajv + ajv-formats** at runtime; zod present but not used to build tool schemas. |
| Goose | **`jsonschema` 0.55 crate, validators compiled at runtime** (`agents/final_output_tool.rs`, `recipe/validate_recipe.rs`). |

**Library-level measurements:**

- **TypeBox** (user report in [typebox#1563](https://github.com/sinclairzx81/typebox/issues/1563), maintainer-confirmed; 100,000 × `Compile`, M1 Max, Node 24.14.0 + Bun 1.3.11): TypeBox 0.34 `TypeCompiler.Compile` = **228 ms / 108 MB**; `typebox/schema` = **2259 ms / 226 MB**; `typebox/compile` = **2232 ms / 230 MB**. With random keys (defeating the 0.34 cache): 0.34 = 1447 ms / 200 MB vs TB1 = 4364 ms / 406 MB. Maintainer: **1.1.16 = 4297 ms / 203 MB → 1.1.17 = 1662 ms / 3 MB** (engine/function-caching bug, PR #1564). Schema *construction* also regressed: 100,000 × `t.Object` with 5 `Optional` = 65 ms (0.34) → 558 ms (TB1).
- **Zod** (vendor benchmark, [zod.dev/blog/reducing-memory-footprint](https://zod.dev/blog/reducing-memory-footprint)): Zod 4.5 cut retained heap per schema instance 2–9.8× by moving bound methods to a memoizing prototype — `z.string()` **7.5 KB → 784 B**; 10-key object **82.0 KB → 11.0 KB**; union **17.5 KB → 2.1 KB**.
- **Ajv**: no published per-compile memory number — not measured in the sources. The *retention* effect is documented in [MCP TS SDK PR #2626](https://github.com/modelcontextprotocol/typescript-sdk/pull/2626) (comment by @rainblowing, 2026-08-12, Node v26.5.0, 20,000 calls, `global.gc()` before/after): fresh schema object per call → **105.3 MB retained (5,519 B/call)**; same schema hoisted → **0.4 MB (19 B/call)**; content-keyed cache → **0.2 MB (11 B/call, 1 cache entry)**. *The library is not the cost — the number of distinct compiled schema objects is.*
- **Runtime schema compilation is a known startup tax**: Vercel AI SDK commit [`95f65c2` (#9275)](https://github.com/vercel/ai/commit/95f65c281c36844771bb7beb8b575e4dd7eb36aa) made zod schemas lazy because *"Cloudflare workers with AI SDK 5 and Zod 4.0 are exceeding their allowed startup time… CPU profiles indicated that this might be related to Zod schema initialization on import."*
- npm unpacked sizes (a size proxy, **not** RSS): `typebox` 1.4.2 = 1,569,434 B; `zod` 4.6.7 = 6,148,944 B; `ajv` 8.20.0 = 1,033,496 B; `@sinclair/typebox` 0.34.52 = 1,907,776 B. **[INFERENCE]** pi's "TypeBox builder+compiler ~21 MB" is ~13× the *entire* `typebox` package's unpacked size, so 21 MB must refer to an installed subtree or bundled artifact, not the package.
- **Runtime floor (Bun vs Node)** — vendor benchmark, [bun.sh/blog/bun-v1.4](https://bun.sh/blog/bun-v1.4): trivial script, Linux peak memory **Bun 1.4 = 14.6 MB / Bun 1.3 = 33.0 MB / Node 26 = 44.5 MB**. macOS caveat: [bun#28318](https://github.com/oven-sh/bun/issues/28318) — *"Bun process RSS is 7 MB but `footprint` shows 1.3 GB"*; on macOS measure `footprint`/`vmmap`, not RSS.

## 6. Theme: what the market considers acceptable

**The one controlled cross-harness measurement found:** [`KonghaYao/harness-perf-benchmark`](https://github.com/KonghaYao/harness-perf-benchmark) — macOS Apple Silicon, 100 ms `proc_pid_rusage`, **process-tree** RSS, 100 scripted tool turns (~4 KB response each), 3 serial runs, median run. *Author measurement, not a vendor claim.* **These are workload numbers, not idle numbers.** The author warns only the CU column compares across batches.

Same batch (`codex-proxy-fix`, 2026-09-19 — the only batch where these are directly comparable):

| Harness | Version | RSS mean | RSS peak | RSS growth first→last sample |
| --- | --- | ---: | ---: | ---: |
| pi | 0.85.1 | 186.2 MB | 234.4 MB | +106 MB |
| **Codex CLI** | 0.155.1 | **123.4 MB** | **163.7 MB** | +119 MB |
| Claude Code | 2.1.277 | 310.9 MB | 351.0 MB | +206 MB |
| dsh (DeepSeek Harness) | 0.1.5-rc.2 | 185.6 MB | 231.2 MB | +173 MB |
| peri | 3.17.0 | 54.7 MB | 71.7 MB | +49 MB |
| MiniMax Code | 0.4.12 | 617.6 MB | 892.0 MB | +696 MB |

Other batches (indicative only, per the author's own caveat): Cline 443.5/706.1 MB; OpenCode v2 576.1/849.6 MB; Kimi Code 491.9/603.6 MB; Antigravity CLI 208.6/225.1 MB; Hermes Agent 147.3/201.1 MB; Grok Build 96.7/102.6 MB; **ccode (C, static binary) 3.8/4.4 MB**. Also from `docs/perf-compare.md`: *"Codex's main process is only a Node launcher (CPU mean 0.1%, RSS mean 41.7 MB) — the work happens in binaries it spawns"*; reading the main process alone undercounts Codex and OpenCode.

**Published budgets / thresholds — the closest thing to a market standard:**

| Source | Budget |
| --- | --- |
| [Qwen Code #12405](https://github.com/QwenLM/qwen-code/issues/12405) | **"Memory baseline (target: tree peak < 250 MB)"** — the only explicit RSS target found from a shipping agent. |
| [jcode `docs/MEMORY_BUDGET.md`](https://github.com/1jehuang/jcode/blob/master/docs/MEMORY_BUDGET.md) (Rust) | Hard caps + "ratchet expectations" on counters — explicitly *"tied to counters and caps already exposed by the codebase rather than guessed RSS numbers."* Debug surfaces: `:debug memory`, `agent:memory`. |
| [Grinta-Coding-Agent `docs/PERFORMANCE.md`](https://github.com/josephsenior/Grinta-Coding-Agent/blob/main/docs/PERFORMANCE.md) (Python) | **"Idle REPL: ~150 MB RSS (target)"** + token budgets (system prompt soft 6k/hard 10k, MCP block 2k/6k). |
| [Claude Code troubleshooting](https://code.claude.com/docs/en/troubleshooting) | *"If a session's heap memory passes 2.5GB, a critical memory usage warning appears."* |
| [Gemini CLI `useMemoryMonitor.ts`](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/ui/hooks/useMemoryMonitor.ts) | `MEMORY_WARNING_THRESHOLD = 7 * 1024**3`, checked every 60 s. |

**Read:** the market tolerates ~150–300 MB RSS per CLI process as normal, ~400–700 MB as "significant
resources" that generates issue reports, and multi-GB as a bug. **No harness publishes a hard *idle*-RSS
budget**, and no harness treats the model catalog or the schema library as its dominant cost.

## 7. What we could not verify

- **True idle RSS (no session, no workload) for every harness except Claude Code.** Codex, Goose, Crush, Aider, OpenCode, Cline, Roo Code, Gemini CLI, Qwen Code, smolagents, Continue — **not measured in the sources**. Every number found is a workload measurement or a leak report.
- **A controlled Rust-vs-TypeScript RSS comparison for Codex CLI** — none found in issues, blogs, or the vendor announcement. The "no GC → lower memory" line is a claim without a number.
- **VS Code's per-extension memory budget** — the extension-host doc states only the intent ("prevents extensions from impacting startup performance", lazy activation events) and **documents no numeric budget**. I could not locate where VS Code sets an extension-host heap cap.
- **A measured per-compile memory figure for Ajv** — not measured in the sources (only the retention figures via the MCP SDK PR).
- **pi's own "43 provider model lists ≈ 10 MB"** — could not be confirmed from the public repo (`earendil-works/pi`): `packages/ai/src/providers/data/` is gitignored and generated at build time; only 42 `*.models.ts` files (~34 KB total) are committed. The figure may still be correct for a built artifact.
- **A per-provider split of models.dev** — not published; `api.json?provider=openai` still returns the full 5.86 MB catalog. **Claude Code's *current* native binary** — its bundled `cli.js` was inspected at 2.0.77; the 271 MB native artifact's contents are not published.
- **smolagents / LangChain schema cost** — mechanism documented (schema generated from type hints / Pydantic at call time), but no measurements were published.
