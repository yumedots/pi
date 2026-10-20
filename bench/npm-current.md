# Benchmark: npm + Node (migrated code)

Generated 2026-10-19T20:08:40.571Z

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
| `install.cold` | 7.19 s | 4.04 s | 10.7 s | 2.66 s | 5 |
| `install.warm` | 2.99 s | 2.88 s | 3.09 s | 94 ms | 5 |
| `build.full` | 4.96 s | 4.87 s | 5.06 s | 94 ms | 5 |
| `build.full.sequential` | 6.9 s | 6.69 s | 7.04 s | 130 ms | 5 |
| `build.pkg.telemetry` | 132 ms | 131 ms | 134 ms | 1 ms | 5 |
| `build.pkg.chord` | 606 ms | 585 ms | 664 ms | 33 ms | 5 |
| `build.pkg.tui` | 216 ms | 209 ms | 227 ms | 8 ms | 5 |
| `build.pkg.codemode` | 143 ms | 137 ms | 147 ms | 4 ms | 5 |
| `build.pkg.mcp` | 142 ms | 141 ms | 144 ms | 2 ms | 5 |
| `build.pkg.ai` | 528 ms | 506 ms | 537 ms | 13 ms | 5 |
| `build.pkg.durable` | 734 ms | 711 ms | 753 ms | 15 ms | 5 |
| `build.pkg.env` | 167 ms | 162 ms | 175 ms | 5 ms | 5 |
| `build.pkg.agent` | 203 ms | 196 ms | 208 ms | 5 ms | 5 |
| `build.pkg.coding-agent` | 959 ms | 931 ms | 977 ms | 19 ms | 5 |
| `build.incremental` | 298 ms | 228 ms | 370 ms | 64 ms | 5 |
| `check.full` | 13.17 s | 11.83 s | 16.05 s | 1.77 s | 5 |
| `test.full` | 114.02 s | 111.9 s | 117.81 s | 2.31 s | 5 |
| `test.one` | 952 ms | 941 ms | 963 ms | 10 ms | 5 |
| `script.startup` | 247 ms | 243 ms | 249 ms | 2 ms | 5 |
| `build.binary` | 7.59 s | 7.14 s | 8.5 s | 785 ms | 3 |
| `cli.startup.node` | 206 ms | 205 ms | 206 ms | 1 ms | 5 |
| `cli.startup.binary` | 158 ms | 157 ms | 159 ms | 1 ms | 5 |
| `cli.startup.node.models` | 255 ms | 251 ms | 259 ms | 4 ms | 5 |
| `cli.startup.binary.models` | 229 ms | 225 ms | 241 ms | 7 ms | 5 |

## Memory (peak RSS)

| Metric | Peak RSS |
| --- | --- |
| `memory.build.full` | 809.2 MiB |
| `memory.check.full` | 2892 MiB |
| `memory.cli.node` | 106.2 MiB |
| `memory.cli.binary` | 91.5 MiB |
