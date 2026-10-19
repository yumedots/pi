# Harness benchmark

- Machine: Apple M3 Pro, 11 cores, 18432.0 MB
- Node: v26.10.0
- Date: 2026-10-19T22:25:36.464Z

| Scenario | Runtime | Wall | Peak RSS | CPU (user+sys) | Battery | First screen | First token | Turn | Tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runtime-floor | node | 98.0 ms | 37.5 MB | 0.09 s | 0.00% | - | - | - | - |
| runtime-floor | bun | 9.2 ms | 17.3 MB | 0.00 s | 0.00% | - | - | - | - |
| runtime-floor | bun-smol | 8.0 ms | 17.3 MB | 0.00 s | 0.00% | - | - | - | - |
| runtime-floor | deno | 34.8 ms | 39.5 MB | 0.02 s | 0.00% | - | - | - | - |
| runtime-floor | native | 2.9 ms | 1.1 MB | 0.00 s | 0.00% | - | - | - | - |
| cli-version | node | 352.3 ms | 119.6 MB | 0.39 s | 0.00% | - | - | - | - |
| cli-version | bun | 157.3 ms | 89.3 MB | 0.44 s | 0.00% | - | - | - | - |
| cli-version | bun-smol | 166.6 ms | 91.4 MB | 0.44 s | 0.00% | - | - | - | - |
| tui-first-screen | node | 637.9 ms | 139.9 MB | 0.57 s | 0.00% | - | - | - | - |
| tui-first-screen | bun | 421.0 ms | 136.3 MB | 0.62 s | 0.00% | - | - | - | - |
| tui-first-screen | bun-smol | 452.7 ms | 136.7 MB | 0.62 s | 0.00% | - | - | - | - |
| rpc-first-screen | node | 420.9 ms | 135.8 MB | 0.50 s | 0.00% | 420.9 ms | - | - | - |
| rpc-first-screen | bun | 210.8 ms | 111.7 MB | 0.52 s | 0.00% | 210.8 ms | - | - | - |
| rpc-first-screen | bun-smol | 221.5 ms | 113.4 MB | 0.52 s | 0.00% | 221.5 ms | - | - | - |
| rpc-turn | node | 426.4 ms | 159.2 MB | 0.62 s | 0.00% | 426.4 ms | 1262.7 ms | 1347.0 ms | 4671 |
| rpc-turn | bun | 215.6 ms | 125.8 MB | 0.62 s | 0.00% | 215.6 ms | 1105.0 ms | 1195.9 ms | 4674 |
| rpc-turn | bun-smol | 230.3 ms | 125.8 MB | 0.65 s | 0.00% | 230.3 ms | 966.6 ms | 1050.9 ms | 4671 |
| build | toolchain | 7751.3 ms | 1066.8 MB | 18.67 s | 0.00% | - | - | - | - |

## Disk

| Path | Size |
| --- | --- |
| node_modules | 481.5 MB |
| coding-agent dist | 17.9 MB |
| tui dist | 2.1 MB |
| ai dist | 3.9 MB |

## Battery

- Charge before the run: 95% (5057 mAh)
- Charge after the run: 95% (5057 mAh)
- Drain of the run: 0 mAh (0%)
