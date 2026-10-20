# Harness benchmark

- Machine: Apple M3 Pro, 11 cores, 18432.0 MB
- Node: v26.10.0
- Date: 2026-10-20T12:31:53.385Z

| Scenario | Runtime | Wall | Peak RSS | Settled RSS | CPU (user+sys) | Instructions | Cycles | Battery | First screen | First token | Turn | Tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runtime-floor | node | 94.2 ms | 37.5 MB | - | 0.08 s | 1293M | 337M | 0.00% | - | - | - | - |
| runtime-floor | bun | 8.6 ms | 17.5 MB | - | 0.00 s | 56M | 22M | 0.00% | - | - | - | - |
| runtime-floor | bun-smol | 8.7 ms | 17.5 MB | - | 0.00 s | 56M | 22M | 0.00% | - | - | - | - |
| runtime-floor | deno | 32.8 ms | 39.5 MB | - | 0.02 s | 313M | 114M | 0.00% | - | - | - | - |
| runtime-floor | native | 3.0 ms | 1.1 MB | - | 0.00 s | 8M | 4M | 0.00% | - | - | - | - |
| cli-version | node | 333.0 ms | 114.9 MB | - | 0.37 s | 4374M | 1371M | 0.00% | - | - | - | - |
| cli-version | bun | 141.0 ms | 86.5 MB | - | 0.34 s | 2067M | 1134M | 0.00% | - | - | - | - |
| cli-version | bun-smol | 152.2 ms | 84.7 MB | - | 0.35 s | 2155M | 1170M | 0.00% | - | - | - | - |
| cli-version | binary | 154.8 ms | 88.3 MB | - | 0.16 s | 1839M | 626M | 0.00% | - | - | - | - |
| tui-first-screen | node | 672.8 ms | 140.9 MB | 1.1 MB | 0.58 s | 6338M | 2083M | 0.00% | - | - | - | - |
| tui-first-screen | bun | 416.1 ms | 136.3 MB | 1.1 MB | 0.59 s | 3572M | 1951M | 0.00% | - | - | - | - |
| tui-first-screen | bun-smol | 456.4 ms | 136.9 MB | 1.1 MB | 0.60 s | 3694M | 1985M | 0.00% | - | - | - | - |
| tui-first-screen | binary | 465.9 ms | 134.7 MB | 1.1 MB | 0.34 s | 3257M | 1200M | 0.00% | - | - | - | - |
| tui-idle | node | 4051.1 ms | - | 159.9 MB | - | - | - | 0.20% | - | - | - | - |
| tui-idle | bun | 4051.6 ms | - | 137.3 MB | - | - | - | 0.00% | - | - | - | - |
| tui-idle | bun-smol | 4042.2 ms | - | 139.5 MB | - | - | - | 0.00% | - | - | - | - |
| tui-idle | binary | 4039.3 ms | - | 141.3 MB | - | - | - | 0.00% | - | - | - | - |
| rpc-first-screen | node | 432.9 ms | 133.3 MB | 133.3 MB | 0.52 s | 5704M | 1897M | 0.00% | 432.9 ms | - | - | - |
| rpc-first-screen | bun | 204.7 ms | 110.5 MB | 110.3 MB | 0.49 s | 2971M | 1638M | 0.00% | 204.7 ms | - | - | - |
| rpc-first-screen | bun-smol | 220.7 ms | 110.9 MB | 110.7 MB | 0.50 s | 3092M | 1690M | 0.00% | 220.7 ms | - | - | - |
| rpc-first-screen | binary | 225.5 ms | 111.3 MB | 111.0 MB | 0.27 s | 2757M | 999M | 0.00% | 225.5 ms | - | - | - |
| rpc-turn | node | 431.8 ms | 156.8 MB | 133.2 MB | 0.62 s | 6605M | 2234M | 0.00% | 431.8 ms | 3525.7 ms | 3557.8 ms | 5037 |
| rpc-turn | bun | 223.6 ms | 123.3 MB | 110.4 MB | 0.59 s | 3429M | 1964M | 0.00% | 223.6 ms | 1159.4 ms | 1228.7 ms | 5037 |
| rpc-turn | bun-smol | 244.0 ms | 122.7 MB | 111.3 MB | 0.60 s | 3537M | 2030M | 0.00% | 244.0 ms | 1225.3 ms | 1338.5 ms | 5033 |
| rpc-turn | binary | 241.0 ms | 118.8 MB | 110.4 MB | 0.35 s | 3041M | 1249M | 0.20% | 241.0 ms | 6794.9 ms | 6928.1 ms | 5040 |
| build | toolchain | 3333.5 ms | 1009.5 MB | - | 9.59 s | 1885M | 605M | 0.00% | - | - | - | - |

## Disk

| Path | Size |
| --- | --- |
| node_modules | 510.0 MB |
| coding-agent dist | 105.2 MB |
| compiled binary | 78.2 MB |
| tui dist | 2.2 MB |
| ai dist | 4.5 MB |

## Battery and power

- Power source: battery
- Charge before the run: 88% (4451 mAh)
- Charge after the run: 86% (4448 mAh)
- Drain of the run: 3 mAh (2%)
