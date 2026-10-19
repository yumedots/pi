# Benchmark: npm + Node (baseline)

Generated 2026-10-19T17:32:03.962Z

## Machine

| Property | Value |
| --- | --- |
| Platform | darwin-arm64 |
| OS | 27.0.1 |
| CPU | Apple M3 Pro |
| Cores | 11 |
| RAM | 18 GiB |
| Node | v26.10.0 |
| npm | 11.19.1 |
| Bun | 1.4.3 |
| hyperfine | hyperfine 2.0.0 |

## Timings

| Metric | Mean | Min | Max | Std dev | Runs |
| --- | --- | --- | --- | --- | --- |
| `install.cold` | 16.31 s | 14.71 s | 18.66 s | 1.64 s | 5 |
| `install.warm` | 3.02 s | 2.92 s | 3.15 s | 117 ms | 5 |
| `build.full` | 8.06 s | 7.58 s | 9.73 s | 935 ms | 5 |
| `build.pkg.telemetry` | 147 ms | 117 ms | 183 ms | 31 ms | 5 |
| `build.pkg.chord` | 681 ms | 634 ms | 749 ms | 48 ms | 5 |
| `build.pkg.tui` | 260 ms | 213 ms | 314 ms | 41 ms | 5 |
| `build.pkg.codemode` | 131 ms | 128 ms | 137 ms | 3 ms | 5 |
| `build.pkg.mcp` | 136 ms | 134 ms | 139 ms | 2 ms | 5 |
| `build.pkg.ai` | 476 ms | 468 ms | 485 ms | 8 ms | 5 |
| `build.pkg.durable` | 1.06 s | 677 ms | 1.55 s | 401 ms | 5 |
| `build.pkg.env` | 161 ms | 153 ms | 171 ms | 8 ms | 5 |
| `build.pkg.agent` | 180 ms | 173 ms | 183 ms | 4 ms | 5 |
| `build.pkg.coding-agent` | 1.55 s | 906 ms | 1.8 s | 366 ms | 5 |
| `build.incremental` | 259 ms | 248 ms | 269 ms | 9 ms | 5 |
| `check.full` | 17.32 s | 13.35 s | 23.87 s | 4.6 s | 5 |
| `test.one` | 962 ms | 894 ms | 1.14 s | 101 ms | 5 |
| `script.startup` | 464 ms | 445 ms | 492 ms | 20 ms | 5 |
| `build.binary` | 9.41 s | 8.74 s | 9.95 s | 619 ms | 3 |
| `cli.startup.node` | 201 ms | 199 ms | 208 ms | 4 ms | 5 |
| `cli.startup.binary` | 156 ms | 155 ms | 157 ms | 1 ms | 5 |
| `cli.startup.node.models` | 252 ms | 246 ms | 262 ms | 6 ms | 5 |
| `cli.startup.binary.models` | 235 ms | 227 ms | 245 ms | 7 ms | 5 |
| `build.full.sequential` | 7.44 s | 7.32 s | 7.57 s | 98 ms | 5 |
| `test.full` | 134.02 s | 121.96 s | 159.81 s | 15.5 s | 5 |

## Memory (peak RSS)

| Metric | Peak RSS |
| --- | --- |
| `memory.build.full` | 1057 MiB |
| `memory.check.full` | 3014.1 MiB |
| `memory.cli.node` | 105.9 MiB |
| `memory.cli.binary` | 90.5 MiB |

## Failures

- `build.full.sequential`: Command failed: hyperfine --warmup 1 --runs 5 --export-json /Users/gabriel/.local/share/opencode/worktree/657e47/bun/bench/.hyperfine-build.full.sequential.json --shell=default cd packages/telemetry && npm run build && cd packages/chord && npm run build && cd packages/tui && npm run build && cd packages/codemode && npm run build && cd packages/mcp && npm run build && cd packages/ai && npm run build:offline && cd packages/durable && npm run build && cd packages/env && npm run build && cd packages/agent && npm run build && cd packages/coding-agent && npm run build
- `test.full`: Command failed: hyperfine --warmup 1 --runs 5 --export-json /Users/gabriel/.local/share/opencode/worktree/657e47/bun/bench/.hyperfine-test.full.json --shell=default ./test.sh
