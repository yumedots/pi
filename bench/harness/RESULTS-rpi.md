# The Rust port against the TypeScript agent

The same benchmark, the same machine, the same model. The TypeScript numbers are
the ones published in [RESULTS.md](RESULTS.md) and
[the token report](../tokens/RESULTS.md); the Rust numbers are in
[results-rpi.json](results-rpi.json) and [RESULTS-rpi-auto.md](RESULTS-rpi-auto.md).

- Machine: Apple M3 Pro, 11 cores, 18 GiB, macOS 27.0.1
- Model: SmolLM2 1.7B Instruct (Q4_K_M) on llama.cpp 0.6.0
- The Rust binary: `rpi/target/release/rpi`, built with
  `cargo build --release -p rpi-cli` (a debug build is not comparable)

## The commands

```bash
# the model the harness talks to
llama-server -m ~/.local/share/pi-models/smollm2-1.7b-instruct-q4_k_m.gguf --port 8081 --ctx-size 8192

# the agent directory that points at it
mkdir -p /tmp/pi-bench-agent-rpi
cat > /tmp/pi-bench-agent-rpi/models.json <<'EOF'
{
  "providers": {
    "local": {
      "baseUrl": "http://127.0.0.1:8081/v1",
      "apiKey": "local",
      "api": "openai-completions",
      "models": [
        { "id": "smollm2-1.7b-instruct", "name": "SmolLM2 1.7B", "contextWindow": 8192, "maxTokens": 512 }
      ]
    }
  }
}
EOF

# the harness
PI_BENCH_AGENT_DIR=/tmp/pi-bench-agent-rpi \
  node bench/harness/bench.mjs --runtime rpi \
    --out bench/harness/results-rpi.json --markdown bench/harness/RESULTS-rpi-auto.md

# where the memory goes, layer by layer
node bench/harness/memory-attribution-rpi.mjs --agent-dir /tmp/pi-bench-agent-rpi

# the tokens of one request
node bench/tokens/token-usage.mjs --runs 3 --agent-dir /tmp/pi-bench-agent-rpi
```

## The harness

Every number is the mean of 5 runs after 1 warmup. The Rust rows are the `rpi`
rows of `results-rpi.json`.

| Scenario | Runtime | Wall | Peak RSS | Settled RSS | Instructions | First screen | First token | Turn | Tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runtime-floor | node | 94.2 ms | 37.5 MB | - | 1293M | - | - | - | - |
| runtime-floor | bun | 8.6 ms | 17.5 MB | - | 56M | - | - | - | - |
| runtime-floor | native | 3.0 ms | 1.1 MB | - | 8M | - | - | - | - |
| **runtime-floor** | **rpi (native)** | **3.0 ms** | **1.1 MB** | **-** | **8M** | - | - | - | - |
| cli-version | node | 333.0 ms | 114.9 MB | - | 4374M | - | - | - | - |
| cli-version | bun | 141.0 ms | 86.5 MB | - | 2067M | - | - | - | - |
| cli-version | binary | 154.8 ms | 88.3 MB | - | 1839M | - | - | - | - |
| **cli-version** | **rpi** | **6.6 ms** | **8.9 MB** | **-** | **44M** | - | - | - | - |
| tui-first-screen | node | 672.8 ms | 140.9 MB | - | 6338M | 672.8 ms | - | - | - |
| tui-first-screen | bun | 416.1 ms | 136.3 MB | - | 3572M | 416.1 ms | - | - | - |
| tui-first-screen | binary | 465.9 ms | 134.7 MB | - | 3257M | 465.9 ms | - | - | - |
| **tui-first-screen** | **rpi** | **48.8 ms** | **17.3 MB** | **1.1 MB** | **64M** | **48.8 ms** | - | - | - |
| tui-idle | node | - | - | 159.9 MB | - | - | - | - | - |
| tui-idle | bun | - | - | 137.3 MB | - | - | - | - | - |
| tui-idle | binary | - | - | 141.3 MB | - | - | - | - | - |
| **tui-idle** | **rpi** | **-** | **-** | **18.1 MB** | **-** | - | - | - | - |
| rpc-first-screen | node | 432.9 ms | 133.3 MB | 133.3 MB | 5704M | 432.9 ms | - | - | - |
| rpc-first-screen | bun | 204.7 ms | 110.5 MB | 110.3 MB | 2971M | 204.7 ms | - | - | - |
| rpc-first-screen | binary | 225.5 ms | 111.3 MB | 111.0 MB | 2757M | 225.5 ms | - | - | - |
| **rpc-first-screen** | **rpi** | **6.8 ms** | **14.3 MB** | **13.8 MB** | **51M** | **6.8 ms** | - | - | - |
| rpc-turn | node | 431.8 ms | 156.8 MB | 133.2 MB | 6605M | 431.8 ms | - | 3557.8 ms | 5037 |
| rpc-turn | bun | 223.6 ms | 123.3 MB | 110.4 MB | 3429M | 223.6 ms | - | 1228.7 ms | 5037 |
| rpc-turn | binary | 241.0 ms | 118.8 MB | 110.4 MB | 3041M | 241.0 ms | - | 6928.1 ms | 5040 |
| **rpc-turn** | **rpi** | **8.5 ms** | **17.2 MB** | **13.7 MB** | **71M** | **8.5 ms** | **1947.9 ms** | **1961.6 ms** | **1869** |
| build | toolchain (npm) | 3333.5 ms | 1009.5 MB | - | 1885M | - | - | - | - |
| **build** | **rpi-toolchain (cargo)** | **41871.3 ms** | **1570.0 MB** | **-** | **1938M** | - | - | - | - |

The Rust port starts in **6.6 ms and 8.9 MB**, against 333 ms and 114.9 MB for
the TypeScript agent on Node and 154.8 ms and 88.3 MB for the compiled
TypeScript binary. The interactive mode waits in **18.1 MB**, against 141.3 MB
for the compiled TypeScript binary. The artifact itself is 26.3 MB
(`rpi/target/release/rpi`), and it holds 8.9 MB at its version line, where the
compiled TypeScript binary holds 88.3 MB.

A whole turn (the harness prompt, `Reply with the single word: ready`) takes
**1962 ms** on the Rust port, against 3558 ms on Node, 1229 ms on Bun and
6928 ms on the compiled TypeScript binary. The Rust port sits between Bun and
Node, but it pays for it with a second request to the model before the turn
(the token section below).

## Where the memory goes

`node bench/harness/memory-attribution.mjs` measures the cost of every module
of the TypeScript agent. The Rust port is one statically linked binary, so its
layers are measured by the modes that load them, with the same method (the peak
resident set size under `/usr/bin/time -l`) and the same rule: every step is
the state of the one before it plus the layer it names.

| Layer | Cost | TypeScript module | Cost |
| --- | --- | --- | --- |
| the runtime itself | +1 MB | the runtime itself | +1 MB |
| the cli (the arguments, the config) | +8 MB | typebox (the schema builder) | +12 MB |
| the model catalog (every provider) | +1 MB | typebox/compile (the schema compiler) | +9 MB |
| the agent, the tools and their schemas | +4 MB | undici (the http client) | +6 MB |
| the interactive mode | +4 MB | the model catalog (every provider) | +10 MB |
| | | the pi-ai package | +4 MB |
| | | the terminal interface | +3 MB |
| | | the syntax highlighter | +1 MB |
| | | the tools and their schemas | +5 MB |
| | | the settings | +1 MB |
| | | the model runtime | +6 MB |
| | | the session | +8 MB |
| | | the interactive mode | +9 MB |
| **the whole agent** | **18 MB** | **the whole agent** | **75 MB** |

The two lists are not the same granularity. The TypeScript agent loads its
modules at runtime, so each one can be measured on its own; the Rust port links
everything into the binary, so the layers are the modes that pull them in. The
Rust port has no schema builder, no schema compiler and no separate http
client, and it does not build the whole provider catalog at startup.

## The tokens of one request

Same model, same server, same prompt (`Say hello in three words`), three runs
in a row. The TypeScript numbers are the published ones.

| | Request reaches the model | First token |
| --- | --- | --- |
| node (published) | 39 ms | 69 ms |
| bun (published) | 38 ms | 70 ms |
| **rpi** | **1452-1508 ms** | **1655-1708 ms** |

| Run | Runtime | Input | Output | Cache read | Requests | Request | First token |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | node | 11 | 1 | 3592 | 1 | 68 ms | 313 ms |
| 2 | node | 1 | 1 | 3602 | 1 | 45 ms | 72 ms |
| 3 | node | 1 | 1 | 3602 | 1 | 40 ms | 70 ms |
| 1 | **rpi** | **127** | **4** | **1696** | **2** | **1452 ms** | **1655 ms** |
| 2 | **rpi** | **138** | **7** | **1699** | **2** | **1502 ms** | **1708 ms** |
| 3 | **rpi** | **142** | **9** | **1696** | **2** | **1508 ms** | **1704 ms** |

Here the Rust port is the slower one: the request that carries the tools goes
out 1452 ms after the message, against 40-45 ms for the TypeScript agent,
because the Rust port sends a context summarization request first (see below).

| Part | TypeScript chars | TypeScript tokens | Rust chars | Rust tokens |
| --- | --- | --- | --- | --- |
| the system message | 13879 | 3584 | 6949 | 1664 |
| the compaction summary (a user message) | - | - | 608 | 150 |
| the user message | 51 | 15 | 24 | 5 |
| the tool schemas | 2836 | 667 | 5172 | 1274 |
| **the request** | **16766** | **4266** | **12753** | **3093** |

The Rust request is **28% smaller** than the TypeScript one (3093 tokens
against 4266). Its system message is half the size, because the preamble is
shorter and the project context of this repository is smaller (`AGENTS.md` is
4581 bytes here, 12529 bytes in the TypeScript repository). The tool schemas
are twice the size, because the Rust port declares five tools (`read`, `bash`,
`edit`, `write`, `docs`) with longer descriptions, against the four of the
TypeScript agent. The second user message is the summary of the compaction
that tripped before the turn, which the TypeScript agent does not send.

## What is different between the two measurements

- **The Rust port sends two requests per turn.** Before the turn it sends a
  context summarization request ("You are a context summarization assistant"),
  and only then the request that carries the tools. The pre-run compaction
  always trips: the default reserve of the compaction is 16384 tokens and the
  model of the benchmark has a context window of 8192, so the threshold is
  below zero and an empty session trips it. That is the whole difference
  between the 1452 ms of the Rust port and the 45 ms of the TypeScript agent
  in the "request reaches the model" column, and it is most of the 1962 ms of
  the Rust turn of the harness (the TypeScript turns of the same harness are
  3558 ms on Node, 1229 ms on Bun and 6928 ms on the compiled binary).
- **The Rust request carries a summary the TypeScript one does not.** The
  compaction that trips before the turn leaves its summary in the transcript,
  and the Rust port sends it as a second user message (150 tokens).
- **The first screen of the interactive mode is measured differently.** The
  TypeScript agent exits by itself after its first screen when
  `PI_STARTUP_BENCHMARK` is set, so its wall time is the time until that exit.
  The Rust port stays up, so its wall time is the time until the terminal shows
  something, and the agent is stopped afterwards so that `/usr/bin/time -l`
  writes its report. The settled memory of that row is the wrapper around the
  agent (1.1 MB) on both sides, so the two rows are not comparable on it.
- **The startup phases are not comparable.** The Rust port records two of them
  (`args parsed`, `config migrated`), the TypeScript agent records the whole
  startup.
- **The memory attribution is per layer, not per module.** See above.

## What could not be measured

- **The power harness.** `bench/harness/power.mjs` and `bench/harness/soak.mjs`
  drive the TypeScript agent (200 startups, 200 turns in one session). They were
  not ported to the Rust port, so the battery drain of a long session and the
  energy per startup of the Rust port are not measured here. The battery column
  of the harness table is the drain of each scenario, the same way as for the
  TypeScript rows.
- **The published TypeScript numbers were not re-measured with the new
  harness.** The TypeScript arms of the harness are unchanged, and they were
  run with the new harness against the TypeScript repository to check that:
  the peak memory, the settled memory of the first screen row (1.1 MB, the
  wrapper around the agent, on every runtime) and the startup phases come out
  the same. The TypeScript token run was repeated in this session (4662 tokens
  against the published 4266, the difference being the larger `AGENTS.md` of
  the TypeScript repository today), so the two sides are comparable up to the
  project context.
- **The model file.** The token harness needs the local llama.cpp server. The
  model was not on the machine when the run started (the path
  `~/.local/share/pi-models/smollm2-1.7b-instruct-q4_k_m.gguf` was empty); it
  was fetched with the approval of the user during the run, and every number
  above was measured with that file.

## The session picker with 2563 sessions

The user's agent directory holds 2563 sessions, most of them header-only, and
the session picker was slow with them. This section measures the picker on
that directory, on the port and on the original.

### The fixture

```bash
node bench/harness/make-session-fixture.mjs --out /tmp/rpi-session-fixture --count 2563 --cwd /Users/gabriel/pi
# 2563 session files in /tmp/rpi-session-fixture/sessions/--Users-gabriel-pi-- (2307 header-only)
```

Every file is small (a header line, plus a model-change and a message line for
the 256 files that have one), so the numbers below are the *fixed* cost of a
list of 2563 sessions, not the cost of a list of 2563 large ones.

### The commands

```bash
# the port's list: the index, the titles of the rows the list shows, and the
# path the picker used to take (the metadata list plus a full summary of every
# session file)
RPI_SESSION_DIR=/tmp/rpi-session-fixture/sessions/--Users-gabriel-pi-- \
RPI_SESSION_AGENT_DIR=/tmp/rpi-session-fixture RPI_SESSION_CWD=/Users/gabriel/pi \
RPI_SESSION_DUMP=/tmp/port-rows.tsv \
  cargo test -p rpi-cli --test session_list_latency -- --ignored --nocapture measure_a_real_session_directory

# the original's list (it parses every session file)
node bench/harness/measure-session-list-original.mjs --dir /tmp/rpi-session-fixture/sessions/--Users-gabriel-pi--
bun  bench/harness/measure-session-list-original.mjs --dir /tmp/rpi-session-fixture/sessions/--Users-gabriel-pi--

# the picker itself, in a pty that answers the terminal's capability queries
python3 bench/harness/measure-picker-terminal.py --label port --marker "fixture prompt" -- \
  env PI_CODING_AGENT_DIR=/tmp/rpi-session-fixture PI_OFFLINE=1 RPI_SESSION_PICKER_TIMING=1 \
  rpi/target/debug/rpi -r
python3 bench/harness/measure-picker-terminal.py --label original --marker "fixture prompt" -- \
  env PI_CODING_AGENT_DIR=/tmp/rpi-session-fixture bun /Users/gabriel/pi/packages/coding-agent/src/cli.ts -r

# the entries of the two lists, compared
node bench/harness/compare-session-list.mjs --original /tmp/original-list.json --port /tmp/port-rows.tsv
```

### The numbers

| Measurement | Port (`rpi`) | Original (node) | Original (bun) |
| --- | --- | --- | --- |
| The list of 2563 sessions | **58-99 ms** (one header line per file) | 299-311 ms (every file parsed) | 133-139 ms (every file parsed) |
| The titles of the rows the list shows | **0.24-0.36 ms** (12 rows) | - | - |
| The picker paints its first session row | **72-103 ms** | - | 150-154 ms |
| The first byte the picker writes | **71-101 ms** | - | 137-144 ms |
| The path the picker used to take | 121-123 ms (metadata list) + 35-37 ms (a full summary of every file) | - | - |

The port's own counters (`RPI_SESSION_PICKER_TIMING=1`) for the three runs
above: `rows=2563 index_ms=85-87 titles_ms=86-88 ready_ms=89-91`.

The port reads **one header line per session file** and the content of a file
only when its row is drawn; the other 2551 files are never opened for
content. The original parses every session file to build its list.

### The entries are the same

`bench/harness/compare-session-list.mjs` compares the port's 2563 rows with the
original's 2563 rows (id, title, timestamp):

```json
{
 "originalFiles": 2563,
 "portRows": 2563,
 "missingInPort": 0,
 "extraInPort": 0,
 "titleDifferences": 0,
 "timestampDifferences": 0
}
```

Every session of the fixture is in both lists, with the same title (the
recorded name, else the first user prompt, else the original's "(no messages)")
and the same timestamp (the header's ISO-8601 creation time).

### What is different between the two measurements

- **The order of the rows.** The port sorts the rows by the session file's
  modification time, the original by the session's last activity (the message
  timestamps), which it can only know after parsing the file. The fixture
  writes every file in the same second and gives every session a different
  message timestamp, so the two orders differ while the two sets are the
  same. On a real directory the file's mtime is the session's last write, so
  the two orders agree.
- **The port waits for the terminal's answer.** The port's TUI asks the
  terminal for its capabilities (DA1, the colours) before its first frame. In
  a pty that never answers, the picker takes 1.9-2.4 s (the port's counter
  shows `index_ms=87` and `ready_ms=2386`: the delay is in the TUI's setup,
  not in the listing), while the original does not wait at all. With a
  terminal that answers — the real case, and what
  `bench/harness/measure-picker-terminal.py` emulates — the port paints its
  first row in about 95 ms.
- **The port's numbers are from a debug build** (`rpi/target/debug/rpi`); a
  release build of the port takes too long to produce safely on this machine.
  The listing is file-I/O bound, so the debug build costs the port a few
  milliseconds here.
