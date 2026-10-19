# Harness benchmark

- Machine: Apple M3 Pro, 11 cores, 18432.0 MB
- Node: v26.10.0
- Date: 2026-10-19T23:52:12.230Z

| Scenario | Runtime | Wall | Peak RSS | Settled RSS | CPU (user+sys) | Instructions | Cycles | Battery | First screen | First token | Turn | Tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runtime-floor | node | 96.9 ms | 37.5 MB | - | 0.09 s | 1295M | 342M | 0.00% | - | - | - | - |
| runtime-floor | bun | 9.1 ms | 17.3 MB | - | 0.00 s | 55M | 22M | 0.00% | - | - | - | - |
| runtime-floor | bun-smol | 10.1 ms | 17.3 MB | - | 0.00 s | 56M | 23M | 0.00% | - | - | - | - |
| runtime-floor | deno | 34.2 ms | 39.5 MB | - | 0.03 s | 305M | 116M | 0.00% | - | - | - | - |
| runtime-floor | native | 3.2 ms | 1.1 MB | - | 0.00 s | 8M | 4M | 0.00% | - | - | - | - |
| cli-version | node | 344.0 ms | 119.0 MB | - | 0.38 s | 4550M | 1445M | 0.00% | - | - | - | - |
| cli-version | bun | 149.9 ms | 88.2 MB | - | 0.40 s | 2271M | 1340M | 0.00% | - | - | - | - |
| cli-version | bun-smol | 159.2 ms | 87.9 MB | - | 0.40 s | 2356M | 1337M | 0.00% | - | - | - | - |
| cli-version | binary | 167.6 ms | 91.4 MB | - | 0.20 s | 2056M | 722M | 0.00% | - | - | - | - |
| tui-first-screen | node | 681.8 ms | 141.8 MB | - | 0.60 s | 6377M | 2138M | 0.00% | - | - | - | - |
| tui-first-screen | bun | 422.0 ms | 135.8 MB | - | 0.62 s | 3609M | 2040M | 0.00% | - | - | - | - |
| tui-first-screen | bun-smol | 473.6 ms | 136.7 MB | - | 0.61 s | 3728M | 2014M | 0.00% | - | - | - | - |
| tui-first-screen | binary | 463.6 ms | 132.8 MB | - | 0.33 s | 3267M | 1176M | 0.00% | - | - | - | - |
| rpc-first-screen | node | 424.5 ms | 137.1 MB | 137.1 MB | 0.51 s | 5887M | 1882M | 0.00% | 424.5 ms | - | - | - |
| rpc-first-screen | bun | 204.9 ms | 112.8 MB | 112.6 MB | 0.52 s | 3166M | 1765M | 0.00% | 204.9 ms | - | - | - |
| rpc-first-screen | bun-smol | 215.4 ms | 113.8 MB | 113.6 MB | 0.54 s | 3268M | 1830M | 0.00% | 215.4 ms | - | - | - |
| rpc-first-screen | binary | 227.1 ms | 113.1 MB | 112.9 MB | 0.28 s | 2941M | 1042M | 0.00% | 227.1 ms | - | - | - |
| rpc-turn | node | 418.3 ms | 157.8 MB | 136.8 MB | 0.61 s | 6730M | 2165M | 0.00% | 418.3 ms | 1024.8 ms | 1037.7 ms | 4688 |
| rpc-turn | bun | 212.0 ms | 126.3 MB | 112.8 MB | 0.63 s | 3648M | 2045M | 0.00% | 212.0 ms | 1456.3 ms | 1504.3 ms | 4669 |
| rpc-turn | bun-smol | 219.3 ms | 126.1 MB | 113.5 MB | 0.62 s | 3736M | 2025M | 0.00% | 219.3 ms | 1467.2 ms | 1497.7 ms | 4669 |
| rpc-turn | binary | 227.5 ms | 120.9 MB | 112.7 MB | 0.33 s | 3179M | 1192M | 0.00% | 227.5 ms | 3013.1 ms | 3029.3 ms | 4672 |
| build | toolchain | 7627.9 ms | 999.5 MB | - | 18.33 s | 1900M | 579M | 0.00% | - | - | - | - |

## Disk

| Path | Size |
| --- | --- |
| node_modules | 481.5 MB |
| coding-agent dist | 102.9 MB |
| compiled binary | 78.2 MB |
| tui dist | 2.1 MB |
| ai dist | 3.9 MB |

## Battery and power

- Power source: AC power
- Charge before the run: 95% (5057 mAh)
- Charge after the run: 95% (5057 mAh)
- Drain of the run: 0 mAh (0%)
- On AC power the battery does not drain, so the drain of a run is below what the machine reports. The instructions and the cycles of the processor are the power measure of the table above: the energy of a run follows them.
