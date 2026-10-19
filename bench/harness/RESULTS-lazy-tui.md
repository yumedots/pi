# Harness benchmark

- Machine: Apple M3 Pro, 11 cores, 18432.0 MB
- Node: v26.10.0
- Date: 2026-10-19T22:03:03.917Z

| Scenario | Runtime | Wall | Peak RSS | CPU (user+sys) | First screen | First token | Turn | Tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runtime-floor | node | 94.2 ms | 37.5 MB | 0.08 s | - | - | - | - |
| runtime-floor | bun | 8.2 ms | 17.4 MB | 0.00 s | - | - | - | - |
| cli-version | node | 352.1 ms | 119.9 MB | 0.39 s | - | - | - | - |
| cli-version | bun | 153.9 ms | 89.8 MB | 0.40 s | - | - | - | - |
| tui-first-screen | node | 672.3 ms | 140.2 MB | 0.58 s | - | - | - | - |
| tui-first-screen | bun | 455.7 ms | 136.1 MB | 0.60 s | - | - | - | - |
| rpc-first-screen | node | 416.1 ms | 136.4 MB | 0.50 s | 416.1 ms | - | - | - |
| rpc-first-screen | bun | 220.0 ms | 112.3 MB | 0.53 s | 220.0 ms | - | - | - |
| rpc-turn | node | 426.4 ms | 158.6 MB | 0.62 s | 426.4 ms | 2967.4 ms | 2998.7 ms | 4675 |
| rpc-turn | bun | 260.7 ms | 122.1 MB | 0.66 s | 260.7 ms | 1056.2 ms | 1260.5 ms | 4682 |

## Disk

| Path | Size |
| --- | --- |
| node_modules | 481.5 MB |
| coding-agent dist | 17.9 MB |
| tui dist | 2.1 MB |
| ai dist | 3.9 MB |
