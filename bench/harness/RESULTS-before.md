# Harness benchmark

- Machine: Apple M3 Pro, 11 cores, 18432.0 MB
- Node: v26.10.0
- Date: 2026-10-19T22:01:35.417Z

| Scenario | Runtime | Wall | Peak RSS | CPU (user+sys) | First screen | First token | Turn | Tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runtime-floor | node | 95.0 ms | 37.5 MB | 0.08 s | - | - | - | - |
| runtime-floor | bun | 8.3 ms | 17.3 MB | 0.00 s | - | - | - | - |
| cli-version | node | 424.8 ms | 131.6 MB | 0.46 s | - | - | - | - |
| cli-version | bun | 166.5 ms | 89.9 MB | 0.41 s | - | - | - | - |
| tui-first-screen | node | 650.3 ms | 143.5 MB | 0.58 s | - | - | - | - |
| tui-first-screen | bun | 423.0 ms | 136.3 MB | 0.59 s | - | - | - | - |
| rpc-first-screen | node | 411.4 ms | 138.1 MB | 0.50 s | 411.4 ms | - | - | - |
| rpc-first-screen | bun | 208.3 ms | 111.9 MB | 0.51 s | 208.3 ms | - | - | - |
| rpc-turn | node | 456.9 ms | 160.9 MB | 0.61 s | 456.9 ms | 3806.6 ms | 3889.1 ms | 4678 |
| rpc-turn | bun | 218.8 ms | 123.1 MB | 0.65 s | 218.8 ms | 1937.7 ms | 2042.0 ms | 4678 |

## Disk

| Path | Size |
| --- | --- |
| node_modules | 481.5 MB |
| coding-agent dist | 17.9 MB |
| tui dist | 2.1 MB |
| ai dist | 3.9 MB |
