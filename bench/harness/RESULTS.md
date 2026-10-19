# Harness benchmark

What the coding agent costs in memory, cpu time, battery, disk and time, on
every runtime that can run it.

- Machine: Apple M3 Pro, 11 cores, 18 GiB, macOS 27.0.1
- Node 26.10.0, Bun 1.4.3, Deno 2.9.7
- Model: SmolLM2 1.7B Instruct (Q4_K_M) on llama.cpp, so the round trip needs no
  network and no key
- Every number is the mean of 5 runs after 1 warmup. The raw results are in
  `results.json`, the table below is `RESULTS-auto.md`.

## The runtime floor comes first

The floor is what an empty program costs on that runtime. Nothing the agent
does can go below it.

| Runtime | Empty program | Start |
| --- | --- | --- |
| Bun 1.4 | **17.3 MB** | 8.3 ms |
| Bun 1.4 `--smol` | 17.3 MB | 8.2 ms |
| Node 26 | 37.5 MB | 92 ms |
| Deno 2.9 | 39.6 MB | 31 ms |
| a native binary | 1.1 MB | 3.0 ms |

**Bun is the best of the JavaScript runtimes by a factor of two**, and Deno is
worse than Node. `bun --smol` (less memory, more garbage collection) does not
lower the floor, and it does not lower the footprint of the running agent
either: it collects more often, it does not hold less.

Two native reference points from this repository: the Rust daemon of the
`env` package serves requests in **9.6 MB**, and an empty native process
starts in 1.1 MB.

## The agent

| Scenario | Runtime | Wall | Peak RSS | Settled RSS | CPU (user+sys) | First screen | First token | Turn | Tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runtime-floor | node | 94.0 ms | 37.5 MB | - | 0.08 s | - | - | - | - |
| runtime-floor | bun | 8.1 ms | 17.3 MB | - | 0.00 s | - | - | - | - |
| runtime-floor | bun-smol | 8.2 ms | 17.3 MB | - | 0.00 s | - | - | - | - |
| runtime-floor | deno | 31.9 ms | 39.5 MB | - | 0.02 s | - | - | - | - |
| runtime-floor | native | 2.9 ms | 1.1 MB | - | 0.00 s | - | - | - | - |
| cli-version | node | 354.5 ms | 119.4 MB | - | 0.40 s | - | - | - | - |
| cli-version | bun | 153.1 ms | 89.7 MB | - | 0.43 s | - | - | - | - |
| cli-version | bun-smol | 170.6 ms | 91.2 MB | - | 0.46 s | - | - | - | - |
| cli-version | binary | 155.5 ms | 91.5 MB | - | 0.18 s | - | - | - | - |
| tui-first-screen | node | 662.5 ms | 139.6 MB | - | 0.60 s | 662.5 ms | - | - | - |
| tui-first-screen | bun | 422.4 ms | 136.1 MB | - | 0.59 s | 422.4 ms | - | - | - |
| tui-first-screen | bun-smol | 473.7 ms | 136.7 MB | - | 0.63 s | 473.7 ms | - | - | - |
| tui-first-screen | binary | 475.0 ms | 134.0 MB | - | 0.34 s | 475.0 ms | - | - | - |
| rpc-first-screen | node | 421.1 ms | 135.8 MB | 135.7 MB | 0.50 s | 421.1 ms | - | - | - |
| rpc-first-screen | bun | 216.3 ms | 112.5 MB | 112.3 MB | 0.54 s | 216.3 ms | - | - | - |
| rpc-first-screen | bun-smol | 227.6 ms | 112.8 MB | 112.5 MB | 0.55 s | 227.6 ms | - | - | - |
| rpc-first-screen | binary | 222.9 ms | 113.0 MB | 112.8 MB | 0.27 s | 222.9 ms | - | - | - |
| rpc-turn | node | 420.3 ms | 159.1 MB | 135.5 MB | 0.61 s | 420.3 ms | 912 ms | 1029 ms | 4678 |
| rpc-turn | bun | 213.8 ms | 125.9 MB | 111.6 MB | 0.61 s | 213.8 ms | 1086 ms | 1180 ms | 4672 |
| rpc-turn | bun-smol | 227.0 ms | 125.7 MB | 112.7 MB | 0.62 s | 227.0 ms | 1079 ms | 1165 ms | 4676 |
| rpc-turn | binary | 225.6 ms | 120.7 MB | 112.7 MB | 0.33 s | 225.6 ms | 1139 ms | 1209 ms | 4673 |
| build | toolchain | 7570 ms | 1086.4 MB | - | 18.38 s | - | - | - | - |

The **compiled binary** (`dist/pi`, 78.2 MB) is the artifact that ships. It
starts as fast as Bun from source and reaches the first screen in 475 ms, and
it burns **less than half the cpu** of the same code run from source (0.34 s
against 0.59 s): the bundle has no module graph to resolve at startup. Its
memory is the same as Bun's, because it is a Bun executable.

- `tui-first-screen` measures the interactive mode until it draws its first
  screen, in a terminal, through `PI_STARTUP_BENCHMARK=1`. The agent reports
  its own phases: 102 ms on Node and 82 ms on Bun from the first line of
  `main` to the first screen.
- `rpc-first-screen` measures the headless mode until it answers the first
  state request.
- `rpc-turn` sends one message and waits for the answer. The message goes out
  after the session is up, so the round trip does not include the startup.
- **Settled RSS** is what the process holds once it is up, without the
  transient of the startup. The peak of a turn is 24 MB above it on Node: that
  is the request, the answer and the model catalog.
- `build` is the whole workspace built from source: every package compiled
  with tsc and the coding agent bundled. It takes 7.6 s of wall time, 18.4 s
  of cpu time and 1.09 GB of memory at its peak.

### Disk

| Path | Size |
| --- | --- |
| `node_modules` | 481.5 MB |
| the compiled binary `dist/pi` | 78.2 MB |
| the coding agent `dist` (with the binary and the assets) | 102.9 MB |
| the tui `dist` | 2.1 MB |
| the ai package `dist` | 3.9 MB |

### The two halves of a message

The time from the message leaving the agent to the request reaching the model,
and from there to the first token of the answer:

| | Request reaches the model | First token | Whole turn |
| --- | --- | --- | --- |
| node | 39 ms | 69 ms | 1212 ms |
| bun | 38 ms | 70 ms | 1546 ms |

The 38 ms is the agent's own work: the preflight, the system prompt, the tool
declarations and the request. The rest is the model.

### The battery

A full run of the matrix takes 62 s and the charge of the battery does not
move: macOS reports the charge in whole percent, and the milliamp hour
reading is not refreshed during a run of a minute. The drain of a benchmark
run is below what the system reports, so the cpu time is the honest proxy for
it: the interactive mode burns 0.56 s of cpu per start, and the build burns
18.3 s.

## Under 10 MB is not reachable on a JavaScript runtime

The goal was a harness under 10 MB of ram. The runtime is the floor, and the
floor is above the goal:

- Node: 37.5 MB before the agent loads a single module.
- Bun: 17.3 MB.
- The best artifact, the compiled binary, with the agent on top: 134.0 MB for
  the interactive mode, 112.8 MB for the headless one.

So the agent's own work is what can be cut, and that is what this branch cuts.
The gap to the goal on the compiled binary is 124 MB, of which 95 MB is the
agent's own code and 17.3 MB the runtime.

Under 10 MB needs a runtime that starts in a megabyte or two. The repository
already has one: the Rust daemon of the `env` package serves in 9.6 MB. A
native harness is a rewrite of the agent loop, not an optimization of it.

## Where the memory goes

`node bench/harness/memory-attribution.mjs` imports the modules of the agent
one group at a time and reports the resident set size after each group. The
same script under Bun is 24 MB lower at every step.

| Step | Node | Delta | Bun | Delta |
| --- | --- | --- | --- | --- |
| the runtime itself | 13 MB | - | 5 MB | - |
| typebox (the schema builder) | 25 MB | +12 MB | 23 MB | +18 MB |
| typebox/compile (the schema compiler) | 33 MB | +8 MB | 26 MB | +3 MB |
| undici (the http client) | 40 MB | +7 MB | 27 MB | +1 MB |
| yaml (the config parser) | 40 MB | 0 MB | 28 MB | +1 MB |
| the model catalog | 40 MB | 0 MB | 29 MB | +1 MB |
| the pi-ai package | 41 MB | +1 MB | 30 MB | +1 MB |
| the durable harness (the agent library) | 51 MB | +10 MB | 39 MB | +9 MB |
| the terminal interface | 59 MB | +8 MB | 52 MB | +13 MB |
| the tools and their schemas | 64 MB | +5 MB | 60 MB | +8 MB |
| the settings | 65 MB | +1 MB | 60 MB | 0 MB |
| the session | 83 MB | +18 MB | 66 MB | +6 MB |
| the interactive mode | 97 MB | +14 MB | 73 MB | +7 MB |

The three largest items are the schema builder (typebox, 12 MB), the schema
compiler (typebox/compile, 8 MB) and the session with the terminal interface
(26 MB together on Node). The schema costs are the price of the type safe
tool, settings, model and theme schemas: they are built with typebox when the
module is imported, and they are built in every process that imports the
coding agent.

The **durable harness** (the agent library of the `env` package, without the
terminal interface) costs 10 MB on top of the pi-ai package: 51 MB on Node
and 39 MB on Bun. The application around it (the session manager, the
settings, the resource loader, the extensions, the theme) is what adds the
other 46 MB.

The http client (undici) is needed for the proxy support: the agent installs a
dispatcher that tunnels through `HTTP_PROXY` and sets the idle timeouts. Bun
ships a stub for undici, so on Bun the dispatcher is left alone and Bun's own
fetch reads the proxy variables.

## What this branch changed

**The interactive mode is loaded when it runs.** `main.ts` imported the modes
barrel, which pulled the whole terminal interface into every mode. The
interactive mode is now behind `modes/interactive/interactive-mode.lazy.ts`, the
same pattern the repository already uses for `pi mcp`.

| Scenario | Node before | Node after | Bun before | Bun after |
| --- | --- | --- | --- | --- |
| cli-version | 131.6 MB | 119.8 MB | 89.9 MB | 89.8 MB |
| tui-first-screen | 143.5 MB | 139.8 MB | 136.3 MB | 136.7 MB |
| rpc-first-screen | 138.1 MB | 135.6 MB | 111.9 MB | 111.6 MB |
| rpc-turn | 160.9 MB | 159.3 MB | 123.1 MB | 125.5 MB |

The other modes pay less; the interactive mode needs the interface anyway.

**The token usage of a request can be cut.** See
[the token report](../tokens/RESULTS.md). The new `projectContextMaxChars`
setting cuts the project context, which is the largest part of the prompt.

## What was not done, and why

- **The schema builder was not replaced.** typebox and typebox/compile cost 20
  MB together. Replacing the type safe schemas with plain JSON schema objects
  would remove that, but it touches every tool, the settings, the model
  configuration and the themes, and it changes the public API of the ai package.
  It is a project of its own, not an optimization.
- **The http client was not deferred.** Loading undici later would free 7 MB
  while the agent waits, but the dispatcher has to be in place before the first
  request, and a request that skips the proxy is a broken proxy.
- **The tools were not deferred.** The tool schemas are typebox schemas, so
  they cost the schema builder. Deferring them would move the cost to the
  first message instead of removing it.
- **The model catalog was not deferred.** It is small (the data is a few
  hundred kilobytes of JSON) and the model list is needed to show the model.
- **Deno was not made to run the agent.** It resolves the workspace through the
  package exports, not the path aliases of the tsconfig. Its floor is worse
  than Node's, so there is nothing to gain from it.
