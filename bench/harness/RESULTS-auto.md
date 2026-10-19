# Harness benchmark

- Machine: Apple M3 Pro, 11 cores, 18432.0 MB
- Node: v26.10.0
- Date: 2026-10-19T22:30:34.051Z

| Scenario | Runtime | Wall | Peak RSS | Settled RSS | CPU (user+sys) | Battery | First screen | First token | Turn | Tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runtime-floor | node | 92.4 ms | 37.5 MB | - | 0.08 s | 0.00% | - | - | - | - |
| runtime-floor | bun | 8.3 ms | 17.3 MB | - | 0.00 s | 0.00% | - | - | - | - |
| runtime-floor | bun-smol | 8.2 ms | 17.3 MB | - | 0.00 s | 0.00% | - | - | - | - |
| runtime-floor | deno | 30.6 ms | 39.6 MB | - | 0.02 s | 0.00% | - | - | - | - |
| runtime-floor | native | 3.0 ms | 1.1 MB | - | 0.00 s | 0.00% | - | - | - | - |
| cli-version | node | 350.2 ms | 119.8 MB | - | 0.39 s | 0.00% | - | - | - | - |
| cli-version | bun | 154.8 ms | 89.8 MB | - | 0.43 s | 0.00% | - | - | - | - |
| cli-version | bun-smol | 170.4 ms | 91.5 MB | - | 0.44 s | 0.00% | - | - | - | - |
| tui-first-screen | node | 629.5 ms | 139.8 MB | - | 0.56 s | 0.00% | - | - | - | - |
| tui-first-screen | bun | 422.1 ms | 136.7 MB | - | 0.60 s | 0.00% | - | - | - | - |
| tui-first-screen | bun-smol | 453.9 ms | 136.5 MB | - | 0.61 s | 0.00% | - | - | - | - |
| rpc-first-screen | node | 420.2 ms | 135.6 MB | 135.5 MB | 0.51 s | 0.00% | 420.2 ms | - | - | - |
| rpc-first-screen | bun | 208.0 ms | 111.6 MB | 111.5 MB | 0.49 s | 0.00% | 208.0 ms | - | - | - |
| rpc-first-screen | bun-smol | 227.6 ms | 113.6 MB | 113.5 MB | 0.55 s | 0.00% | 227.6 ms | - | - | - |
| rpc-turn | node | 420.2 ms | 159.3 MB | 135.8 MB | 0.61 s | 0.00% | 420.2 ms | 1143.0 ms | 1212.3 ms | 4671 |
| rpc-turn | bun | 211.3 ms | 125.5 MB | 112.1 MB | 0.61 s | 0.00% | 211.3 ms | 1429.2 ms | 1545.6 ms | 4675 |
| rpc-turn | bun-smol | 254.5 ms | 126.8 MB | 113.5 MB | 0.64 s | 0.00% | 254.5 ms | 1018.7 ms | 1164.1 ms | 4671 |
| build | toolchain | 7527.9 ms | 1050.0 MB | - | 18.25 s | 0.00% | - | - | - | - |

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
