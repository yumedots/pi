# What "done" means here, and where each part stands

The objective: make the Rust port of pi 1:1 with the TypeScript original, with
no exceptions in the UI, and prove it automatically.

This file maps each part of the objective to the thing that proves it, so the
state can be read without guessing. `bash scripts/parity/verify-goal.sh` runs
every check below in one command.

## The pipeline the work moves through

| role | what it does | what it may write |
| --- | --- | --- |
| the worker | ports a behaviour, with a check for it | code, tests, the parity scripts |
| the investigator | audits: reads both trees, drives both programs, finds what is missing | its findings file, and the worker's instructions |
| the validator | runs the checks; a difference goes back to the worker as the exact difference | nothing but the difference it found |
| the committer | commits what the validator passed, in small blocks, one-line messages | the commits |

The rule that keeps it honest: a worker never marks its own work verified, and
a validator that finds a difference blocks the port.

## 1. The tmux 1:1 harness

| what | where | evidence |
| --- | --- | --- |
| the driver: fixed pane, scripted keys, a capture per step, a trace file | `scripts/parity/drive.mjs` | `node scripts/parity/drive.mjs rust startup` writes `scripts/parity/out/rust-startup.json` |
| the comparison | `scripts/parity/compare.mjs` | prints the panes side by side for every differing step |
| the runner for every scenario | `scripts/parity/run-all.mjs` | exits non-zero when a trace differs |
| the golden traces, taken from the TypeScript original | `scripts/parity/golden/*.json` | the harness reports "ts: matches the golden trace" |
| the deterministic clock on the TypeScript side | `scripts/parity/clock-preload.mjs` | `performance.now` reads the harness's virtual time |
| the deterministic clock on the Rust side | `rpi/crates/rpi-tui/src/clock.rs` | `clock::now_ms()` reads the same file |
| the model both sides talk to | `scripts/parity/mock-server.mjs` | a fixed reply, so a turn is reproducible |
| the gate | `.github/workflows/ci.yml`, the `parity` job | builds both sides and runs the harness |

Two rules the harness needed to become a gate rather than a noisy report:

- **The clock is frozen for a whole scenario.** An animation reads the clock when it
  is built, and the moment it is built is not deterministic, so a clock that moves
  between the steps gives two runs of the same screen two different frames. The
  animation's own frames are pinned by the Rust tests, which render at fixed
  times, and by the 3dicon script, which renders the TypeScript original at the
  same fixed times.
- **A capture waits for the settled screen.** The app paints in pieces and
  repaints while the logo animates, so a read can land between two of them. The
  capture reads until two reads a good while apart agree.

## 2. The 3dicon

| what | where | evidence |
| --- | --- | --- |
| the port | `rpi/crates/rpi-tui/src/logo3d.rs` | `cargo test -p rpi-tui --lib logo3d` pins the frame at 0, 2 and 5 seconds against the reference |
| the frame-by-frame check, both sides | `scripts/parity/3dicon.mjs` | renders the logo at the same elapsed times on both sides and compares the lines: `t=0s`, `t=2s` and `t=5s` are identical |
| the screen it appears in | `rpi/crates/rpi-tui/src/empty_session.rs` | the harness's "booted" step matches the golden trace |
| the animation | `rpi/crates/rpi-cli/src/interactive_tui.rs` | the screen ticks at the upstream's frame interval while the logo is up |

## 3. Every TUI feature, or a signed exception

| what | where | evidence |
| --- | --- | --- |
| the inventory: 147 features, each with a file:line on both sides and a verdict | `scripts/parity/FEATURES.md` | 62 identical, 50 differ, 35 missing |
| the mechanical audit: the keybindings and their default keys, the slash commands, the settings keys and the components, extracted from both trees and diffed | `scripts/parity/audit.mjs` | it finds the gaps that reading misses; the port was missing 22 keybinding ids, including every `app.models.*`, `app.session.*` and `app.tree.*` binding |
| the gaps that need a decision, and the ones being ported | `scripts/parity/EXCEPTIONS.md` | each row leaves the file only when the harness shows the pane matching, or the user signs it off |

## 4. The extension compatibility suite

| what | where | evidence |
| --- | --- | --- |
| the embedded engine | `rpi/crates/rpi-js/` | `cargo test -p rpi-js` — the round trip from Rust to JavaScript and back, WebAssembly included |
| pi's own extension host, bundled | `rpi/crates/rpi-js/js/extension-host.bundle.js`, built by `scripts/build-extension-host-bundle.mjs` | the bundle is embedded in the crate; the build script refuses a bundle that needs a Node built-in the host does not provide |
| the TypeScript in a plugin | `rpi/crates/rpi-js/src/transpile.rs` | oxc turns the plugin's TypeScript into JavaScript |
| the suite: every example extension that changes something | `scripts/parity/` | the suite runs the extension on both sides and diffs the panes |

## 5. The benchmarks

| what | where | evidence |
| --- | --- | --- |
| the Rust arm in the benchmark | `bench/harness/bench.mjs` | `node bench/harness/bench.mjs --runtime rpi` |
| the per-layer memory attribution | `bench/harness/memory-attribution-rpi.mjs` | the port is one static binary, so the layers are its own |
| the token harness | `bench/tokens/token-usage.mjs` | the same prompt against the same local model on both sides |
| the results | `bench/harness/RESULTS-rpi.md`, `bench/tokens/results-rpi.json` | 18 MB idle against the original's 160 MB; 48 ms to the first screen against 673 ms |

## The known difference outside the UI

The port's request is not the original's request, so the local model's prefix
cache never hits: 2943 tokens per turn against the original's 1357. The
double-request-per-turn bug is fixed; the prompt itself is not yet the same.
`scripts/parity/EXCEPTIONS.md` records it.
