# Harness benchmark

- Machine: Apple M3 Pro, 11 cores, 18432.0 MB
- Node: v26.10.0
- Date: 2026-10-19T22:33:12.562Z

| Scenario | Runtime | Wall | Peak RSS | Settled RSS | CPU (user+sys) | Battery | First screen | First token | Turn | Tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runtime-floor | node | 94.0 ms | 37.5 MB | - | 0.08 s | 0.00% | - | - | - | - |
| runtime-floor | bun | 8.1 ms | 17.3 MB | - | 0.00 s | 0.00% | - | - | - | - |
| runtime-floor | bun-smol | 8.2 ms | 17.3 MB | - | 0.00 s | 0.00% | - | - | - | - |
| runtime-floor | deno | 31.9 ms | 39.5 MB | - | 0.02 s | 0.00% | - | - | - | - |
| runtime-floor | native | 2.9 ms | 1.1 MB | - | 0.00 s | 0.00% | - | - | - | - |
| cli-version | node | 354.5 ms | 119.4 MB | - | 0.40 s | 0.00% | - | - | - | - |
| cli-version | bun | 153.1 ms | 89.7 MB | - | 0.43 s | 0.00% | - | - | - | - |
| cli-version | bun-smol | 170.6 ms | 91.2 MB | - | 0.46 s | 0.00% | - | - | - | - |
| cli-version | binary | 155.5 ms | 91.5 MB | - | 0.18 s | 0.00% | - | - | - | - |
| tui-first-screen | node | 662.5 ms | 139.6 MB | - | 0.60 s | 0.00% | - | - | - | - |
| tui-first-screen | bun | 422.4 ms | 136.1 MB | - | 0.59 s | 0.00% | - | - | - | - |
| tui-first-screen | bun-smol | 473.7 ms | 136.7 MB | - | 0.63 s | 0.00% | - | - | - | - |
| tui-first-screen | binary | 475.0 ms | 134.0 MB | - | 0.34 s | 0.00% | - | - | - | - |
| rpc-first-screen | node | 421.1 ms | 135.8 MB | 135.7 MB | 0.50 s | 0.00% | 421.1 ms | - | - | - |
| rpc-first-screen | bun | 216.3 ms | 112.5 MB | 112.3 MB | 0.54 s | 0.00% | 216.3 ms | - | - | - |
| rpc-first-screen | bun-smol | 227.6 ms | 112.8 MB | 112.5 MB | 0.55 s | 0.00% | 227.6 ms | - | - | - |
| rpc-first-screen | binary | 222.9 ms | 113.0 MB | 112.8 MB | 0.27 s | 0.00% | 222.9 ms | - | - | - |
| rpc-turn | node | 420.3 ms | 159.1 MB | 135.5 MB | 0.61 s | 0.00% | 420.3 ms | 912.3 ms | 1029.2 ms | 4678 |
| rpc-turn | bun | 213.8 ms | 125.9 MB | 111.6 MB | 0.61 s | 0.00% | 213.8 ms | 1086.4 ms | 1180.0 ms | 4672 |
| rpc-turn | bun-smol | 227.0 ms | 125.7 MB | 112.7 MB | 0.62 s | 0.00% | 227.0 ms | 1079.3 ms | 1164.5 ms | 4676 |
| rpc-turn | binary | 225.6 ms | 120.7 MB | 112.7 MB | 0.33 s | 0.00% | 225.6 ms | 1139.2 ms | 1209.2 ms | 4673 |
| build | toolchain | 7570.2 ms | 1086.4 MB | - | 18.38 s | 0.00% | - | - | - | - |

## Disk

| Path | Size |
| --- | --- |
| node_modules | 481.5 MB |
| coding-agent dist | 102.9 MB |
| compiled binary | 78.2 MB |
| tui dist | 2.1 MB |
| ai dist | 3.9 MB |

## Battery

- Charge before the run: 95% (5057 mAh)
- Charge after the run: 95% (5057 mAh)
- Drain of the run: 0 mAh (0%)
