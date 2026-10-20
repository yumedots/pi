# Harness benchmark

- Machine: Apple M3 Pro, 11 cores, 18432.0 MB
- Node: v26.10.0
- Date: 2026-10-20T19:53:41.549Z

| Scenario | Runtime | Wall | Peak RSS | Settled RSS | CPU (user+sys) | Instructions | Cycles | Battery | First screen | First token | Turn | Tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runtime-floor | node | 95.5 ms | 37.5 MB | - | 0.08 s | 1296M | 341M | 0.00% | - | - | - | - |
| runtime-floor | bun | 8.9 ms | 17.5 MB | - | 0.00 s | 56M | 22M | 0.00% | - | - | - | - |
| runtime-floor | bun-smol | 8.9 ms | 17.5 MB | - | 0.00 s | 56M | 22M | 0.00% | - | - | - | - |
| runtime-floor | deno | 26.4 ms | 39.5 MB | - | 0.02 s | 227M | 88M | 0.00% | - | - | - | - |
| runtime-floor | native | 3.2 ms | 1.1 MB | - | 0.00 s | 8M | 4M | 0.00% | - | - | - | - |
| cli-version | rpi | 6.6 ms | 8.9 MB | - | 0.00 s | 44M | 17M | 0.00% | - | - | - | - |
| tui-first-screen | rpi | 48.8 ms | 17.3 MB | 1.1 MB | 0.00 s | 64M | 30M | 0.00% | - | - | - | - |
| tui-idle | rpi | 4046.1 ms | - | 18.1 MB | - | - | - | 0.00% | - | - | - | - |
| rpc-first-screen | rpi | 6.8 ms | 14.3 MB | 13.8 MB | 0.00 s | 51M | 22M | 0.00% | 6.8 ms | - | - | - |
| rpc-turn | rpi | 8.5 ms | 17.2 MB | 13.7 MB | 0.01 s | 71M | 52M | 0.20% | 8.5 ms | 1947.9 ms | 1961.6 ms | 1869 |
| build | rpi-toolchain | 41871.3 ms | 1570.0 MB | - | 289.79 s | 1938M | 708M | 1.00% | - | - | - | - |

## Disk

| Path | Size |
| --- | --- |
| rpi binary | 26.3 MB |

## Battery and power

- Power source: battery
- Charge before the run: 74% (3843 mAh)
- Charge after the run: 72% (3653 mAh)
- Drain of the run: 190 mAh (2%)
