# Blast radius: removing `export { Type } from "typebox"` from the pi-ai root barrel

Read-only investigation of `/Users/gabriel/pi` (commit state: 2026-10-20). All claims carry file:line.

## 1. The extension host's module map

`packages/coding-agent/src/core/extensions/virtual-modules.ts:14-43` (imports at `:1-10`):

| Specifier an extension may import | Resolves to | Line |
|---|---|---|
| `typebox` | host's own `typebox` (`import * as bundledTypebox from "typebox"`, `:6`) | `:15` |
| `typebox/compile` | host's `typebox/compile` (`:7`) | `:16` |
| `typebox/value` | host's `typebox/value` (`:8`) | `:17` |
| `@sinclair/typebox`, `/compile`, `/value` | same three objects | `:18-20` |
| `@earendil-works/pi-ai` | **the compat entrypoint** (`import * as bundledPiAiCompat from "@earendil-works/pi-ai/compat"`, `:2`) — *not* the root barrel | `:29` |
| `@earendil-works/pi-ai/compat` | same compat object | `:30` |
| `@earendil-works/pi-ai/oauth` | `@earendil-works/pi-ai/oauth` (`:3`) | `:31` |
| `@earendil-works/pi-ai/providers/all` | `@earendil-works/pi-ai/providers/all` (`:4`) | `:32` |
| `@earendil-works/pi-agent-core` | `@earendil-works/pi-agent-core` (`:1`) | `:21` |
| `@earendil-works/pi-tui` | `@earendil-works/pi-tui` (`:5`) | `:22` |
| `@earendil-works/pi-coding-agent` | `packages/coding-agent/src/index.ts` (`:10`) | `:33` |
| `@mariozechner/*` (all of the above) | same objects (legacy aliases) | `:34-42` |

The same map is expressed as jiti **aliases** for unbundled Node builds: `packages/coding-agent/src/core/extensions/loader.ts:104-121` — `"@earendil-works/pi-ai": piAiCompatEntry` (`:108`, resolved to `ai/dist/compat.js` at `:94`), `typebox`/`typebox/compile`/`typebox/value` (`:116-118`, resolved at `:74-76`).

Consequence: an extension's `@earendil-works/pi-ai` **is** the compat entry, and compat re-exports the root barrel: `packages/ai/src/compat.ts:26` → `export * from "./index.ts"`. So the barrel's `Type` currently reaches extensions *through compat*. Verified at runtime: `import("./packages/ai/dist/compat.js").Type` → `object`.

Identity: in one process the compat `Type` and the host's `typebox` `Type` are the same object (`node` and `bun` both: `ai.Type === tb.Type` → `true`; only one typebox is installed, `node_modules/typebox` 1.3.27, no nested copies). Inside the extension sandbox jiti loads the extension's `typebox` as a second module instance (probe: `ai.Type !== tb.Type`), but TypeBox 1.x schemas carry no symbol keys and pi-ai's validator uses the global registry `Symbol.for("TypeBox.Kind")` (`packages/ai/src/utils/validation.ts:6`), so cross-instance schemas validate fine.

## 2. Every `Type` import found

### 2a. `Type` from the ai barrel (these break)

| file:line | import |
|---|---|
| `packages/coding-agent/examples/extensions/hello.ts:5` | `import { Type } from "@earendil-works/pi-ai";` |
| `packages/durable/src/tool-search/tool-search.ts:6` | `import { Type } from "@earendil-works/pi-ai";` |
| `packages/durable/README.md:251` | `import { Type } from "@earendil-works/pi-ai";` (doc) |
| `packages/ai/README.md:104,111,513` | `import { Type, type Context, type Tool } from '@earendil-works/pi-ai';` / `import { Type, type Tool, StringEnum } from '@earendil-works/pi-ai';` (doc) |
| `packages/durable/test/harness-callers.test.ts:1`, `harness-lifecycle.test.ts:5`, `harness-live-deltas.test.ts:2`, `harness-ownership.test.ts:4`, `harness-prompt.test.ts:1`, `harness-registry.test.ts:1`, `harness-reports.test.ts:1`, `harness-support.ts:10`, `harness-tasks-recovery.test.ts:5`, `harness-tasks.test.ts:3`, `session-document-retention.test.ts:4`, `spec-usage.test.ts:7`, `tool-search.test.ts:1`, `codemode.test.ts:5`, `codemode-describe.test.ts:1` | `… , Type } from "@earendil-works/pi-ai"` |
| `packages/durable/test/examples/06-harness.ts:5`, `07-configuration.ts:5`, `10-registry-reload.ts:5`, `11-extension-state.ts:5`, `21-late-join.ts:6`, `22-subagent-foreground.ts:9`, `23-subagent-background.ts:12`, `27-plan-mode.ts:9`, `31-reload-and-restart.ts:9` | `import { Type } from "@earendil-works/pi-ai";` |
| `packages/evals/evals/documentation-audit.eval.ts:3` | `import { Type } from "@earendil-works/pi-ai";` |
| `scripts/browser-smoke-entry.ts:2` | `import { createAssistantMessageEventStream, Type } from "@earendil-works/pi-ai";` |
| `scripts/issues/triage.ts:6` | `import { type ModelThinkingLevel, StringEnum, Type } from "@earendil-works/pi-ai";` |
| `packages/coding-agent/dist/examples/extensions/hello.ts:5`, `packages/durable/dist/tool-search/tool-search.{js,d.ts}:6` | build output (regenerated) |

No hit in `packages/coding-agent/src/**` — the coding agent's own code never imports `Type` from the barrel. `.pi/extensions/tps.ts:1` imports only a *type* from the barrel.

### 2b. `Type` from `typebox` directly (unaffected)

`packages/ai/src/index.ts:1-2`, `packages/ai/src/utils/typebox-helpers.ts:1`, `packages/ai/src/providers/model-schema.ts:1`, `packages/ai/src/providers/compat-schema.ts:1`, `packages/chord/src/contract.ts:1`, `packages/chord/src/wire.ts:1`, `packages/agent/src/types.ts:17` (type-only), `packages/coding-agent/src/core/tools/{read,find,ls,grep,edit,bash,write}.ts`, `packages/coding-agent/src/core/{key-id-schema,keybindings-schema,settings-schema,model-config}.ts`, `packages/coding-agent/src/modes/interactive/theme/theme-schema.ts:10`, `packages/coding-agent/src/extensions/codemode/tool.ts:29`, `packages/coding-agent/src/extensions/tool-search/tool.ts:11`, `packages/durable/src/tools/{read,edit,bash,write}.ts`, `packages/durable/src/codemode/{models,codemode}.ts`, all `packages/ai/test/*` and `packages/agent/test/*` Type usages.

## 3. Documented public API for plugins

- `packages/coding-agent/docs/packages.md:80-88` — "Pi supplies these packages to extensions and skills:" → `- \`@earendil-works/pi-ai\`` (`:82`), … `- \`typebox\`` (`:86`); then (`:88`) "Declare the host-provided packages listed above in \`peerDependencies\` with a \`\"*\"\` range and do not bundle them."
- `packages/coding-agent/docs/extensions.md` — **no** `pi-ai`/`typebox` import line anywhere (grep over `packages/coding-agent/docs/*.md` finds only `rpc-commands.md:860` and `session-format.md:41`, both prose). The doc says only "A custom tool defines a name, model-facing description, TypeBox parameter schema…" and links `examples/extensions/hello.ts` (the one example that imports `Type` from the barrel).
- `packages/ai/README.md:104` — "TypeBox exports are re-exported from \`@earendil-works/pi-ai\`: \`Type\`, \`Static\`, and \`TSchema\`." → this is the ai package's own public contract, not extension-specific.
- `packages/ai/README.md:1651` — "`@earendil-works/pi-ai` … eagerly imports TypeBox and schema validation."
- `packages/durable/README.md:251` — `import { Type } from "@earendil-works/pi-ai";`

## 4. Built-in and example extensions

Built-ins (`packages/coding-agent/src/extensions/`): `mcp/{resources,tools,index}.ts` import **only** `import type { TSchema } from "typebox"` (`:23`, `:26`, `:31`); `codemode/tool.ts:29` and `tool-search/tool.ts:11` import `{ type Static, Type } from "typebox"`; `llama/*` has no TypeBox usage (only `Content-Type` headers). **No built-in imports `Type` from the ai barrel.**

Examples (`packages/coding-agent/examples/extensions/`): all use `import { Type } from "typebox"` (`todo.ts:16`, `reload-runtime.ts:9`, `shutdown-command.ts:9`, `question.ts:17`, `dynamic-tools.ts:11`, `tic-tac-toe.ts:23`, `questionnaire.ts:18`, …) **except `hello.ts:5`**, which uses the barrel. `examples/extensions/README.md:188` and `todo.ts:13` import `StringEnum` from the barrel.

## 5. Loader trace: can a plugin already `import { Type } from "typebox"`?

Yes, in every runtime mode.

- `packages/coding-agent/src/core/extensions/loader.ts:56-61` lazily imports `VIRTUAL_MODULES`; `:569-575` picks the resolution mode: embedded/binary → `{ virtualModules, tryNative: false }`; source TS → `{ virtualModules, tsconfigPaths: true }`; unbundled Node build → `{ alias: getAliases() }`.
- `jiti-loader.ts:1-3` re-exports jiti's `createJiti` (binary builds use `jiti-static-loader.ts`).
- `typebox` is in the virtual map (`virtual-modules.ts:15`) and in the alias map (`loader.ts:116`), so `import { Type } from "typebox"` in a plugin resolves to the host's typebox in all three modes.

**Test coverage exists**: `packages/coding-agent/test/extensions-runner.test.ts:380,430,442` and `packages/coding-agent/test/resource-loader.test.ts:939,954,981,1000` write plugin files containing `import { Type } from "typebox"` and load them through the real loader. `packages/coding-agent/test/suite/regressions/8237-node-sea-extension-loading.test.ts:68` asserts `options.virtualModules?.typebox` is defined.

**Empirical probe** (temp dir, repo untouched): an extension doing `import * as ai from "@earendil-works/pi-ai"` currently gets `ai.Type` → `object` (`"Type"` is among the module keys). A plugin importing a name the barrel does not have gets `undefined` (jiti/CJS interop, no hard error), and using it yields `Failed to load extension: undefined is not an object (evaluating '_piAi.Type.Object')` — i.e. the extension and its tools silently fail to load.

## 6. Decisive answer

**What breaks for a plugin:** only plugins that import `Type` from the pi-ai barrel — `@earendil-works/pi-ai` (or `/compat`, or the `@mariozechner/pi-ai` legacy alias). Because the host maps that specifier to the compat entry (`virtual-modules.ts:29`, `loader.ts:108`) and compat re-exports the root barrel (`packages/ai/src/compat.ts:26`), removing `packages/ai/src/index.ts:2` removes `Type` from the compat surface too. Failure mode is a silent extension load error (`undefined is not an object (evaluating '_piAi.Type.Object')`), not a clean import error.

**Is there a supported no-change replacement?** No plugin can be left untouched if the export disappears — but the replacement is a one-line import swap to a specifier that is already the officially supported, host-provided one:

```ts
import { Type } from "typebox";   // host-provided: docs/packages.md:86, virtual-modules.ts:15, loader.ts:116
```

This is the pattern every built-in extension already uses (`src/extensions/codemode/tool.ts:29`, `src/extensions/tool-search/tool.ts:11`) and nearly every example extension. Schemas stay compatible: TypeBox 1.x schemas are plain JSON objects and pi-ai's validator uses the global `Symbol.for("TypeBox.Kind")` registry (`packages/ai/src/utils/validation.ts:6`), so a schema built by the plugin's typebox instance validates in the host. Type-only imports (`import type { Static, TSchema } from "@earendil-works/pi-ai"`, `packages/ai/src/index.ts:1`) are erased at runtime and can stay.

**Third-party package concern (item 5):** a plugin package declares `@earendil-works/pi-ai` and `typebox` as **peerDependencies with `"*"`** and does not bundle them (`docs/packages.md:88-90`). The host then serves its own module instances, so the plugin adds **no** second TypeBox copy and **no** extra host memory. If a package physically installs pi-ai (discouraged, `docs/packages.md:90`), the plugin gets its own pi-ai + TypeBox copy in its own module root (`docs/packages.md:97`), which costs that plugin memory, not the host's; schema compatibility still holds via the global Kind registry.

**Two caveats the plan must handle (beyond plugin blast radius):**
1. Removing `packages/ai/src/index.ts:2` alone does **not** remove TypeBox from the barrel: `packages/ai/src/index.ts:45` re-exports `./utils/typebox-helpers.ts`, whose `StringEnum` does a runtime `import { Type } from "typebox"` (`packages/ai/src/utils/typebox-helpers.ts:1`). `StringEnum` is itself imported from the barrel by `scripts/issues/triage.ts:6` and `packages/coding-agent/examples/extensions/todo.ts:13` / `examples/extensions/README.md:188`, so it must be moved (e.g. to a subpath) or made lazy for the memory win to materialize.
2. The extension host loads TypeBox itself the first time any extension loads (`virtual-modules.ts:6`), independently of the ai barrel. A plugin that imports `typebox` therefore pays the TypeBox cost regardless of the barrel change.

**Repo-internal fixes required by the change** (each one line, `Type` → `typebox`): `packages/coding-agent/examples/extensions/hello.ts:5`; `packages/durable/src/tool-search/tool-search.ts:6`; `scripts/browser-smoke-entry.ts:2`; `scripts/issues/triage.ts:6`; `packages/evals/evals/documentation-audit.eval.ts:3`; all `packages/durable/test/**` hits listed in §2a; and doc updates at `packages/ai/README.md:104,111,513`, `packages/durable/README.md:251`.
