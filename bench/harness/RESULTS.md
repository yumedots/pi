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
| Bun 1.4 | **17.3 MB** | 8.0 ms |
| Bun 1.4 `--smol` | 17.3 MB | 8.0 ms |
| Node 26 | 37.5 MB | 94 ms |
| Deno 2.9 | 39.5 MB | 35 ms |
| a native binary | 1.1 MB | 3 ms |

**Bun is the best of the JavaScript runtimes by a factor of two**, and Deno is
worse than Node. `bun --smol` (less memory, more garbage collection) does not
lower the floor: it only changes the collector.

Two native reference points from this repository: the Rust daemon of the
`env` package serves requests in **9.6 MB**, and an empty native process
starts in 1.1 MB.

## The agent

| Scenario | Runtime | Wall | Peak RSS | CPU (user+sys) | First screen | First token | Turn | Tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runtime-floor | node | 98.0 ms | 37.5 MB | 0.08 s | - | - | - | - |
| runtime-floor | bun | 9.2 ms | 17.3 MB | 0.00 s | - | - | - | - |
| runtime-floor | bun-smol | 8.0 ms | 17.3 MB | 0.00 s | - | - | - | - |
| runtime-floor | deno | 34.8 ms | 39.5 MB | 0.02 s | - | - | - | - |
| runtime-floor | native | 2.9 ms | 1.1 MB | 0.00 s | - | - | - | - |
| cli-version | node | 350.2 ms | 119.6 MB | 0.39 s | - | - | - | - |
| cli-version | bun | 155.4 ms | 90.0 MB | 0.42 s | - | - | - | - |
| cli-version | bun-smol | 169.5 ms | 91.5 MB | 0.45 s | - | - | - | - |
| tui-first-screen | node | 638 ms | 139.9 MB | 0.58 s | 638 ms | - | - | - |
| tui-first-screen | bun | 421 ms | 136.3 MB | 0.59 s | 421 ms | - | - | - |
| tui-first-screen | bun-smol | 453 ms | 136.7 MB | 0.63 s | 453 ms | - | - | - |
| rpc-first-screen | node | 441.9 ms | 135.3 MB | 0.52 s | 441.9 ms | - | - | - |
| rpc-first-screen | bun | 213.3 ms | 111.8 MB | 0.55 s | 213.3 ms | - | - | - |
| rpc-first-screen | bun-smol | 229.6 ms | 113.3 MB | 0.57 s | 229.6 ms | - | - | - |
| rpc-turn | node | 421.6 ms | 159.2 MB | 0.61 s | 421.6 ms | 1263 ms | 1347 ms | 4685 |
| rpc-turn | bun | 210.1 ms | 125.8 MB | 0.60 s | 210.1 ms | 1105 ms | 1196 ms | 4677 |
| rpc-turn | bun-smol | 230.8 ms | 125.8 MB | 0.64 s | 230.8 ms | 967 ms | 1051 ms | 4671 |
| build | toolchain | 7751 ms | 1066.8 MB | 18.7 s | - | - | - | - |

- `tui-first-screen` measures the interactive mode until it draws its first
  screen, in a terminal, through `PI_STARTUP_BENCHMARK=1`. The agent reports
  its own phases: 102 ms on Node and 82 ms on Bun from the first line of
  `main` to the first screen.
- `rpc-first-screen` measures the headless mode until it answers the first
  state request.
- `rpc-turn` sends one message and waits for the answer. The message goes out
  after the session is up, so the round trip does not include the startup.
- `build` is the whole workspace built from source: every package compiled
  with tsc and the coding agent bundled. It takes 7.8 s of wall time, 18.7 s
  of cpu time and 1.07 GB of memory at its peak, and it leaves 17.9 MB of
  `dist`.

### The two halves of a message

The time from the message leaving the agent to the request reaching the model,
and from there to the first token of the answer:

| | Request reaches the model | First token | Whole turn |
| --- | --- | --- | --- |
| node | 39 ms | 69 ms | 1347 ms |
| bun | 38 ms | 70 ms | 1196 ms |

The 38 ms is the agent's own work: the preflight, the system prompt, the tool
declarations and the request. The rest is the model.

### The battery

A full run of the matrix takes 57 s and the charge of the battery does not
move: macOS reports the charge in whole percent, and the milliamp hour
reading is not refreshed during a run of a minute. The drain of a benchmark
run is below what the system reports, so the cpu time is the honest proxy for
it: the interactive mode burns 0.58 s of cpu per start, and the build burns
18.7 s.

## Under 10 MB is not reachable on a JavaScript runtime

The goal was a harness under 10 MB of ram. The runtime is the floor, and the
floor is above the goal:

- Node: 37.5 MB before the agent loads a single module.
- Bun: 17.3 MB.
- The best of the two, with the agent on top: 136.3 MB for the interactive
  mode.

So the agent's own work is what can be cut, and that is what this branch cuts.
The gap to the goal on Bun is 126 MB, of which 58 MB is the agent's own code
and 17.3 MB the runtime.

Under 10 MB needs a runtime that starts in a megabyte or two. The repository
already has one: the Rust daemon of the `env` package serves in 9.6 MB. A
native harness is a rewrite of the agent loop, not an optimization of it.

## Where the memory goes

`node bench/harness/memory-attribution.mjs` imports the modules of the agent
one group at a time and reports the resident set size after each group:

| Step | RSS | Delta |
| --- | --- | --- |
| the runtime itself | 12 MB | - |
| typebox (the schema builder) | 24 MB | +12 MB |
| typebox/compile (the schema compiler) | 32 MB | +8 MB |
| undici (the http client) | 39 MB | +7 MB |
| yaml (the config parser) | 40 MB | +1 MB |
| the model catalog | 40 MB | 0 MB |
| the pi-ai package | 40 MB | 0 MB |
| the terminal interface | 48 MB | +8 MB |
| the tools and their schemas | 59 MB | +11 MB |
| the settings | 59 MB | 0 MB |
| the session | 73 MB | +14 MB |
| the interactive mode | 93 MB | +20 MB |

The three largest items are the schema builder (typebox, 12 MB), the schema
compiler (typebox/compile, 8 MB) and the terminal interface with the session
and the interactive mode (42 MB together). The schema costs are the price of
the type safe tool, settings, model and theme schemas: they are built with
typebox when the module is imported, and they are built in every process that
imports the coding agent.

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
| cli-version | 131.6 MB | 119.6 MB | 89.9 MB | 90.0 MB |
| tui-first-screen | 143.5 MB | 139.9 MB | 136.3 MB | 136.3 MB |
| rpc-first-screen | 138.1 MB | 135.3 MB | 111.9 MB | 111.8 MB |
| rpc-turn | 160.9 MB | 159.2 MB | 123.1 MB | 125.8 MB |

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
