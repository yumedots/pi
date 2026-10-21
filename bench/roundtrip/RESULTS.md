# Message round trip

The time from submitting a message to the assistant's reply being complete, the
TypeScript original against the Rust port, measured the same way on both.

## The measurement

- Script: `bench/roundtrip/roundtrip.mjs` (prints this table, unattended)
- Provider path: the repo's own mock provider, `scripts/parity/mock-server.mjs`,
  speaking the OpenAI chat-completions SSE protocol. Provider `mock`, model
  `mock/mock-1`. No real model and no llama-server are involved, so the numbers
  measure each runtime's own overhead, not a model's speed.
- Both runtimes run the same agent in `rpc` mode, with the same prompt
  (`"Say hello in three words"`), against the same mock server.
- The TypeScript original runs from `packages/coding-agent/dist/cli.js` on Node
  v26.10.0; the Rust port runs from `rpi/target/debug/rpi`.
- Metrics are read from the client side, identically for both runtimes:
  - **submit to first token**: the prompt is written to the agent, the first
    streamed text delta arrives.
  - **first token to final token**: the first text delta to the last one.
  - **whole turn**: the prompt is written to the assistant message is complete
    (`agent_settled`), which includes the tool round trip in the `tool`
    scenario.
- Each number is the median of 9 runs, after 2 warmup runs per runtime.

## The machine

- Apple M3 Pro, 11 cores, 18 GiB, macOS 27.0.1
- On battery, 54% and discharging, for the whole run
- The Rust binary is a **debug** build (`scripts/agent-cargo.sh build -p rpi-cli`).
  A release build would be faster; the comparison is fair because both
  runtimes are measured on the same machine at the same time, but the Rust
  numbers include debug-build overhead the TypeScript original does not have.
  The TypeScript original is likewise not minified, so both sides carry their
  own development-build overhead.

## The numbers

Run on 2026-10-21, on battery at 52%, Rust build `debug`.

### Scenario: text

| metric | TypeScript original | Rust port | ratio (Rust/TS) |
| --- | --- | --- | --- |
| submit to first token | 41.2 ms | 50.0 ms | 1.21x |
| first token to final token | 199.1 ms | 189.6 ms | 0.95x |
| whole turn | 274.6 ms | 239.8 ms | 0.87x |

### Scenario: tool

| metric | TypeScript original | Rust port | ratio (Rust/TS) |
| --- | --- | --- | --- |
| submit to first token | 75.8 ms | 83.2 ms | 1.10x |
| first token to final token | 61.6 ms | 47.9 ms | 0.78x |
| whole turn | 170.1 ms | 131.3 ms | 0.77x |

### The port's own timestamps

The port timestamps the three moments itself and writes them to stderr as a
`turn_timing` JSON line when `RPI_TURN_TIMING=1` is set. The benchmark reads
that line, and fails loudly when it is missing, so a run without the
instrumentation can never be mistaken for a run that measured nothing.

The port's own numbers, median over the same runs:

| port metric | text scenario | tool scenario |
| --- | --- | --- |
| submit to first token | 49.9 ms | 83.2 ms |
| first token to turn end | 190.1 ms | 48.3 ms |
| submit to turn end | 239.7 ms | 131.3 ms |

They agree with the client-side numbers above to within 0.1 ms, which is what
makes them usable: the port's own view of the turn and the client's view of
the stream are the same turn.

The last run's raw stamps, relative to the port's start:

- text scenario: submit 38.8 ms, first token 89.0 ms, turn end 283.5 ms
- tool scenario: submit 31.5 ms, first token 116.0 ms, turn end 162.8 ms

## Reading the numbers

- The Rust port is **faster end to end** (0.87x and 0.77x) but **slower to the
  first token** (1.21x and 1.10x). The gap is in the start-up path: the port
  spends roughly 31-39 ms between the process's start and the submit, and the
  original spends less before it accepts the prompt.
- In the `tool` scenario the port's advantage is larger (0.77x), because the
  tool round trip dominates the turn and the port's tool execution is quicker.
- The `first token to final token` metric is dominated by the mock server's
  15 ms per-chunk delay, not by either runtime: with 13 chunks that is about
  195 ms of the measured window on both sides. The comparison there is mostly
  the mock's pacing.

## Reproducing

```bash
cd /Users/gabriel/pi-native

# the port (debug build)
scripts/agent-cargo.sh build -p rpi-cli

# the benchmark, both runtimes
node bench/roundtrip/roundtrip.mjs --runs 9 --warmup 2 --scenario both
```

The script needs the TypeScript original's build at
`/Users/gabriel/pi/packages/coding-agent/dist/cli.js` (or `--ts-root`).

## The instrumentation

`rpi/crates/rpi-cli/src/turn_timing.rs` holds the port's own timestamps. It is
off unless `RPI_TURN_TIMING=1` is set, and when off it costs one relaxed
atomic load per event: no allocation, no lock, no change to what the user sees.
The three moments are hooked where they happen:

| moment | hook |
| --- | --- |
| the input is submitted | `interactive_tui.rs` (TUI) and `modes.rs` (rpc) |
| the first token is rendered | `interactive_tui/events.rs` (TUI), `turn_timing::observe_event` (rpc) |
| the turn's end | `interactive_tui/events.rs` (TUI), `turn_timing::observe_event` (rpc) |

Both paths were checked. The rpc path is what the benchmark drives. The TUI
path was driven under tmux (the port in its interactive TUI, against the same
mock provider) and writes the same line, with the phases in order:

```json
{"type":"turn_timing","submit_ms":6015.317291,"first_token_ms":6062.000333,
 "turn_end_ms":6133.072083,"submit_to_first_token_ms":46.683042,
 "first_token_to_turn_end_ms":71.07175,"submit_to_turn_end_ms":117.754792,
 "phases":["submitted","first_token","turn_end"]}
```

`modes.rs`'s flush path drains the event queue without going through the
normal pump, so it observes the events it drains too: without that, the
`agent_settled` event never reached the hook and the port wrote no timing line
at all.

The tests that pin it:

- `rpi/crates/rpi-cli/src/turn_timing.rs` (unit tests): the phases are
  recorded in order, each phase only once, a new submit resets the turn, the
  emitted line carries the stamps and their deltas, and a missing phase has no
  delta.
- `rpi/crates/rpi-cli/tests/turn_timing.rs` (integration test): the port
  writes exactly one `turn_timing` line per turn, its stamps are monotonic and
  its phases are in order; and without `RPI_TURN_TIMING=1` the port writes no
  such line at all.

```bash
scripts/agent-cargo.sh test -p rpi-cli --lib turn_timing
scripts/agent-cargo.sh test -p rpi-cli --test turn_timing
```
