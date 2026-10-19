# npm + Node vs Bun

Baseline (npm + Node, before the migration): 2026-10-19T20:08:10.728Z

Bun (after the migration): 2026-10-19T20:08:46.653Z

Same machine, same settings, same method (hyperfine, 5+ runs, 1 warmup). Lower is better except for the memory and size rows.

## The headline: the repository before and after

| Metric | npm + Node (before) | Bun (after) | Speedup | Notes |
| --- | --- | --- | --- | --- |
| Install, cold cache | 7.42 s | 5.75 s | 1.29x | Empty node_modules, cleared package-manager cache. variance: npm sd 1.85 s, Bun sd 1 s |
| Install, warm cache | 3.13 s | 384 ms | 8.16x | Empty node_modules, warm cache. |
| Full build (build:offline) | 8.06 s | 4.3 s | 1.88x | The repository's own build script. variance: npm sd 935 ms, Bun sd 83 ms |
| Full build, explicit sequential chain | 7.44 s | 5.25 s | 1.42x | Isolates the script runner's overhead. |
| Check (biome + tsc --noEmit + checks) | 17.32 s | 12.12 s | 1.43x | variance: npm sd 4.6 s, Bun sd 238 ms |
| Full test suite | 134.02 s | 115.3 s | 1.16x | Through the isolated test runner. variance: npm sd 15.5 s, Bun sd 4.45 s |
| One test file | 962 ms | 916 ms | 1.05x | packages/agent. variance: npm sd 101 ms, Bun sd 13 ms |
| One script invocation | 464 ms | 98 ms | 4.73x | Process startup for a trivial script. |
| Build the compiled binary | 9.41 s | 8.07 s | 1.17x | bun build --compile. variance: npm sd 619 ms, Bun sd 884 ms |
| CLI startup on Node (--version) | 203 ms | 214 ms | 0.95x | The same command in both profiles: it does not go through the package manager. variance: npm sd 1 ms, Bun sd 24 ms |
| CLI startup, compiled binary (--version) | 157 ms | 157 ms | 1x | The same command in both profiles. |
| CLI startup on Node (--list-models) | 252 ms | 256 ms | 0.98x | The same command in both profiles. |
| CLI startup, compiled binary (--list-models) | 224 ms | 224 ms | 1x | The same command in both profiles. |

## The toolchain alone: the same code, both runners

Both columns run the migrated code. The only difference is the package manager and the script runner, so these rows isolate the toolchain from the code changes. The CLI startup rows run the same command in both columns, so they should read the same; they are the noise floor of this measurement.

| Metric | npm + Node | Bun | Speedup |
| --- | --- | --- | --- |
| Install, cold cache | 7.19 s | 5.75 s | 1.25x |
| Install, warm cache | 2.99 s | 384 ms | 7.8x |
| Full build (build:offline) | 4.96 s | 4.3 s | 1.15x |
| Full build, explicit sequential chain | 6.9 s | 5.25 s | 1.31x |
| Check (biome + tsc --noEmit + checks) | 13.17 s | 12.12 s | 1.09x |
| Full test suite | 114.02 s | 115.3 s | 0.99x |
| One test file | 952 ms | 916 ms | 1.04x |
| One script invocation | 247 ms | 98 ms | 2.51x |
| Build the compiled binary | 7.59 s | 8.07 s | 0.94x |
| CLI startup on Node (--version) | 206 ms | 214 ms | 0.96x |
| CLI startup, compiled binary (--version) | 158 ms | 157 ms | 1.01x |
| CLI startup on Node (--list-models) | 255 ms | 256 ms | 1x |
| CLI startup, compiled binary (--list-models) | 229 ms | 224 ms | 1.02x |

## Per-package tsc build

| Package | npm + Node (before) | Bun (after) | Speedup |
| --- | --- | --- | --- |
| `telemetry` | 147 ms | 130 ms | 1.12x |
| `chord` | 681 ms | 596 ms | 1.14x |
| `tui` | 260 ms | 213 ms | 1.22x |
| `codemode` | 131 ms | 138 ms | 0.95x |
| `mcp` | 136 ms | 146 ms | 0.93x |
| `ai` | 476 ms | 560 ms | 0.85x |
| `durable` | 1.06 s | 774 ms | 1.37x |
| `env` | 161 ms | 162 ms | 0.99x |
| `agent` | 180 ms | 201 ms | 0.89x |
| `coding-agent` | 1.55 s | 944 ms | 1.64x |

## Memory (peak RSS)

| Measurement | npm + Node (before) | Bun (after) |
| --- | --- | --- |
| `memory.build.full` | 1097.8 MiB | 1105.2 MiB |
| `memory.check.full` | 2904.3 MiB | 2826.5 MiB |
| `memory.cli.node` | 120.4 MiB | 106.2 MiB |
| `memory.cli.binary` | 93.2 MiB | 93.3 MiB |

## Raw data

- `bench/baseline.json` (npm + Node, before the migration)
- `bench/npm-current.json` (npm + Node, migrated code)
- `bench/bun.json` (Bun, migrated code)
