# Bun migration

The dev, build, test and CI toolchain moved from npm + Node to
[Bun](https://bun.sh). This document says what moved, what did not, why, and
how to go back.

## What moved to Bun

| Area | Before | After |
| --- | --- | --- |
| Install | `npm ci --ignore-scripts` | `bun install --frozen-lockfile --ignore-scripts` |
| Script runner | `npm run X` | `bun run X` (66 ms against npm's 291 ms) |
| Package build | a hand-written `cd packages/X && npm run build` chain | `scripts/build-workspaces.mjs`, which builds the dependency levels and runs the packages inside a level at the same time |
| Bundler for the published package | esbuild | esbuild, unchanged (see below) |
| Standalone binary | `bun build --compile` | `bun build --compile`, unchanged flags (see below) |
| CI | `actions/setup-node` + `cache: npm` | `oven-sh/setup-bun` + a cache of `~/.bun/install/cache` |

`bun.lock` is generated from `package-lock.json` with `bun pm migrate`, so both
lockfiles describe one dependency tree. `bun run check:lockfiles` fails when
they resolve different versions.

## What stayed on npm or Node, and why

### npm keeps `package-lock.json` and the publication path

- `nix/package.nix` reads the root lockfile with `importNpmLock`. Nix has no
  Bun support, and the nix build is a release artifact.
- `packages/coding-agent/install-lock/` is the shrinkwrap the published pi.dev
  installer uses. It is generated from `package-lock.json` and ships to end
  users, who install it with npm.
- `npm pack`, `npm publish` and `npm audit` stay on npm. The packages are
  published to the npm registry and installed with `npm i -g`; that path is
  unchanged.

`npm version --workspaces` and `npm install --package-lock-only` also stay, for
the same reason: they own `package-lock.json`. `bun pm migrate` then
regenerates `bun.lock` from it.

### Node stays the runtime of the published packages

Bun 1.4.3 does not implement `node:module`'s `registerHooks`, which
`packages/chord/src/loader.ts` and
`packages/coding-agent/src/experimental/source-resolver.ts` need. The
published packages therefore keep running on Node. The compiled binary does
not include those modules, so it is unaffected.

Bun's `undici` npm package is a stub. `new undici.Client()` under Bun has
only `request`: no `close`, no `destroy`, no `stats`. The coding-agent builds
its HTTP dispatcher on the npm `undici` package, so every provider request
depends on it. Moving the coding-agent's runtime to Bun means replacing
undici with Bun's native fetch, which is an application change, not a
toolchain change.

The dev-only source resolver now reads `registerHooks` off the namespace and
skips registering the hook when the runtime has none. Bun applies the
tsconfig paths itself, so the resolver has nothing to add there. This is
what lets the CLI run from source on Bun.

### The check scripts now run on Bun

`scripts/check-runtime-deps.mjs` and `scripts/check-ts-relative-imports.mjs`
used TypeScript 7's `typescript/unstable/sync` API, which reads the tsgo
server's output through `child.stdout._handle.fd`, a Node internal Bun does
not expose. Both now use `typescript/unstable/async`, which speaks JSON-RPC
over a stream and runs on both runtimes:

| Script | Node | Bun |
| --- | --- | --- |
| `check-ts-relative-imports` | 5.48 s | 1.18 s |
| `check-runtime-deps` | 2.33 s | 1.31 s |

The output is identical on both, including the failure messages when a
violation is planted.

`scripts/biome-check.mjs` still runs on Node: it spawns the Biome CLI
through `process.execPath`, and under Bun that would run Biome's launcher
with Bun, which changes what the native binary is told about the runtime.

### The test suite runs on Node

`bun test` passes the whole `scripts/` suite (44 tests) and the whole
`packages/tui` suite (1070 tests) with the same counts as Node's runners. It
is slower than Node's runner (5.4 s against 3.8 s for `scripts/`, 11.6 s
against 6.5 s for `packages/tui`), so Node's runner stays.

vitest on Bun passes every test in `packages/telemetry`, `packages/mcp` and
`packages/agent`. It fails in the rest:

| Package | Failing files | Cause |
| --- | --- | --- |
| `packages/coding-agent` | 12 of 303 | install-method detection (19 tests), the undici stub, `fs.watch` handle semantics, and other runtime differences |
| `packages/chord` | 4 of 47 | `registerHooks`, `node:v8`'s `setFlagsFromString("--expose-gc")`, WebSocket server timeouts |
| `packages/durable` | 2 of 68 | error message wording, `null` against `undefined` from the file system |
| `packages/env` | 1 of 6 | a different file system error code |
| `packages/codemode` | 1 of 6 | the timing-sensitive worker lifetime test |

The largest group is the install-method detection. `detectInstallMethod()`
answers "bun" under Bun, which is correct: the app knows which runtime it
runs on. The tests assume the ambient runtime is npm. Making them pass
needs a seam in the application, so they stay on Node.

The packages' `test` scripts are unchanged (`vitest --run`), so vitest runs on
Node in both setups. `bun run --workspaces` drives them.

## The build optimizations that were tried and rejected

### `--bytecode` on the compiled binary

`bun build --compile --bytecode` halves the warm start (159 ms to 76 ms) and
costs 3 MiB of size and 155 ms of build time. It breaks the CLI: the lazily
loaded chunks use `import.meta`, and bytecode-compiled modules cannot.

```
SyntaxError: import.meta is only valid inside modules.
```

Rejected.

### `--minify` on the compiled binary

`--minify` saves 5 MiB (78.2 MiB to 73.2 MiB) and 15 ms of warm start. It
also destroys the CLI's error output, which prints the offending source line:

```
177717 | function getBuiltinThemes() {
177718 |   if (!BUILTIN_THEMES) {
```

becomes a wall of minified syntax highlighting rules. The CLI's behavior
changes for users who hit an error, so it was rejected.

### `--sourcemap=external`

Adds 7.6 MiB and does not change the startup time. Rejected.

### `--target=bun-<os>-<arch>-modern`

No size or startup difference on darwin-arm64. The release script already
picks `-baseline` for the x64 targets, which is the setting that matters for
older CPUs. Left as is.

### `bun build` as the replacement for esbuild

esbuild produces the published bundle in 0.42 s and 8.8 MiB across 80 files.
Bun's bundler produces 12.6 MiB in 0.09 s for the main entry alone, and it
does not provide the code splitting, the per-flow lazy entry points, or the
checks that keep the codemode worker importable only from Node builtins and
free of `import.meta`. Replacing esbuild would mean reimplementing a
correctness- and security-sensitive script to save 0.3 s of an 8 s build.

esbuild stays.

## Known risks

- **Two lockfiles.** `package-lock.json` and `bun.lock` describe one tree, and
  `bun run check:lockfiles` enforces that. The check runs in `bun run check`,
  which CI and the pre-commit hook both run.
- **A stale `tsbuildinfo` can silently skip work.** The package builds are
  incremental. The buildinfo lives in `dist/`, which the clean script removes,
  so `rm -rf dist` is always a full rebuild. A buildinfo next to the config
  file would survive the clean and make `tsc` exit 0 while emitting nothing.
- **`bun run --workspaces` runs the workspace scripts in parallel.** npm runs
  them one after another. The root test script passes `--sequential`, because
  running the workspaces at once adds enough load to trip
  `packages/codemode`'s timing-sensitive worker lifetime test.
- **Bun ignores `.npmrc`.** `min-release-age=2` is npm's two-day window. Bun
  reads it as seconds from `bunfig.toml` instead, as `minimumReleaseAge`.
  Without that, a Bun install would accept a dependency published minutes ago
  while npm would refuse it.
- **Bun blocks dependency lifecycle scripts.** Nothing is trusted, because the
  repository installs with `--ignore-scripts` and no dependency needs its
  install script. `bun pm untrusted` lists the three: `@google/genai` (a no-op
  preinstall), `autoevals` (a preinstall that fails unless pnpm is used) and
  `protobufjs` (a postinstall that only prints a warning). Trusting
  `autoevals` would break the install.
- **The workspace scripts run in the same order.** `build-workspaces.mjs`
  derives the levels from the workspace `dependencies`, so a new dependency
  between packages changes the build order automatically. The old chain was
  hand-written and had to be updated by hand.

## Rolling back

The branch is `bun-migration`. To go back to npm and Node:

```bash
git checkout main
bun install --frozen-lockfile --ignore-scripts   # restore node_modules
npm ci --ignore-scripts                          # or restore the npm tree
```

`package-lock.json` is unchanged on this branch, so `npm ci --ignore-scripts`
still produces the tree the release scripts, the nix build and the published
installer shrinkwrap expect. Nothing outside the toolchain changed: the
published packages, the public API, the package names and the versions are the
same, and the compiled binary is built with the same `bun build --compile`
flags as before.

To keep the incremental builds but drop Bun, revert the `tsconfig.build.json`
changes and the `package.json` script changes; the two are independent.
