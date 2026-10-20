# Benchmark: Bun

Generated 2026-10-19T20:08:46.653Z

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
| `install.cold` | 5.75 s | 4.1 s | 6.55 s | 1 s | 5 |
| `install.warm` | 384 ms | 344 ms | 407 ms | 24 ms | 5 |
| `build.full` | 4.3 s | 4.2 s | 4.39 s | 83 ms | 5 |
| `build.full.sequential` | 5.25 s | 5.19 s | 5.38 s | 78 ms | 5 |
| `build.pkg.telemetry` | 130 ms | 129 ms | 132 ms | 1 ms | 5 |
| `build.pkg.chord` | 596 ms | 584 ms | 607 ms | 11 ms | 5 |
| `build.pkg.tui` | 213 ms | 211 ms | 217 ms | 2 ms | 5 |
| `build.pkg.codemode` | 138 ms | 136 ms | 143 ms | 3 ms | 5 |
| `build.pkg.mcp` | 146 ms | 141 ms | 150 ms | 3 ms | 5 |
| `build.pkg.ai` | 560 ms | 529 ms | 600 ms | 28 ms | 5 |
| `build.pkg.durable` | 774 ms | 751 ms | 810 ms | 28 ms | 5 |
| `build.pkg.env` | 162 ms | 160 ms | 164 ms | 2 ms | 5 |
| `build.pkg.agent` | 201 ms | 193 ms | 206 ms | 5 ms | 5 |
| `build.pkg.coding-agent` | 944 ms | 922 ms | 985 ms | 25 ms | 5 |
| `build.incremental` | 225 ms | 217 ms | 235 ms | 7 ms | 5 |
| `check.full` | 12.12 s | 11.78 s | 12.34 s | 238 ms | 5 |
| `test.one` | 916 ms | 900 ms | 935 ms | 13 ms | 5 |
| `script.startup` | 98 ms | 97 ms | 100 ms | 1 ms | 5 |
| `build.binary` | 8.07 s | 7.06 s | 8.74 s | 884 ms | 3 |
| `cli.startup.node` | 214 ms | 202 ms | 256 ms | 24 ms | 5 |
| `cli.startup.node.models` | 256 ms | 253 ms | 260 ms | 3 ms | 5 |
| `test.full` | 115.3 s | 110.94 s | 122.56 s | 4.45 s | 5 |
| `cli.startup.binary` | 157 ms | 155 ms | 159 ms | 2 ms | 5 |
| `cli.startup.binary.models` | 224 ms | 224 ms | 225 ms | 1 ms | 5 |

## Memory (peak RSS)

| Metric | Peak RSS |
| --- | --- |
| `memory.build.full` | 1105.2 MiB |
| `memory.check.full` | 2826.5 MiB |
| `memory.cli.node` | 106.2 MiB |
| `memory.cli.binary` | 93.3 MiB |

## Failures

- `test.full`: Command failed: hyperfine --warmup 1 --runs 5 --export-json /Users/gabriel/.local/share/opencode/worktree/657e47/bun/bench/.hyperfine-test.full.json --shell=default PI_TEST_PACKAGE_MANAGER=bun ./test.sh
- `build.binary`: Command failed: hyperfine --warmup 1 --runs 3 --export-json /Users/gabriel/.local/share/opencode/worktree/657e47/bun/bench/.hyperfine-build.binary.json --shell=default --prepare rm -rf packages/telemetry/dist packages/chord/dist packages/tui/dist packages/codemode/dist packages/mcp/dist packages/ai/dist packages/durable/dist packages/env/dist packages/agent/dist packages/coding-agent/dist cd packages/coding-agent && bun run build:binary
- `cli.startup.node`: Command failed: hyperfine --warmup 1 --runs 5 --export-json /Users/gabriel/.local/share/opencode/worktree/657e47/bun/bench/.hyperfine-cli.startup.node.json --shell=default node packages/coding-agent/dist/bundle/cli.js --version
- `cli.startup.binary`: Command failed: hyperfine --warmup 1 --runs 5 --export-json /Users/gabriel/.local/share/opencode/worktree/657e47/bun/bench/.hyperfine-cli.startup.binary.json --shell=default packages/coding-agent/dist/pi --version
- `cli.startup.node.models`: Command failed: hyperfine --warmup 1 --runs 5 --export-json /Users/gabriel/.local/share/opencode/worktree/657e47/bun/bench/.hyperfine-cli.startup.node.models.json --shell=default node packages/coding-agent/dist/bundle/cli.js --list-models
- `cli.startup.binary.models`: Command failed: hyperfine --warmup 1 --runs 5 --export-json /Users/gabriel/.local/share/opencode/worktree/657e47/bun/bench/.hyperfine-cli.startup.binary.models.json --shell=default packages/coding-agent/dist/pi --list-models
