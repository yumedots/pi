# Harness benchmark

What the coding agent costs in memory, cpu time, disk and time, on Node and on
Bun, measured on this machine.

- Machine: Apple M3 Pro, 11 cores, 18 GiB, macOS 27.0.1
- Node 26.10.0, Bun 1.4.3
- Model: SmolLM2 1.7B Instruct (Q4_K_M) on llama.cpp, so the round trip needs no
  network and no key
- Every number is the mean of 5 runs after 1 warmup. The raw results are in
  `results.json`.

## The numbers

| Scenario | Runtime | Wall | Peak RSS | CPU (user+sys) | First screen | First token | Turn | Tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runtime-floor | node | 94.2 ms | 37.6 MB | 0.08 s | - | - | - | - |
| runtime-floor | bun | 8.1 ms | 17.3 MB | 0.00 s | - | - | - | - |
| cli-version | node | 353.3 ms | 119.3 MB | 0.39 s | - | - | - | - |
| cli-version | bun | 156.2 ms | 89.5 MB | 0.42 s | - | - | - | - |
| tui-first-screen | node | 671.1 ms | 140.2 MB | 0.58 s | - | - | - | - |
| tui-first-screen | bun | 436.8 ms | 135.3 MB | 0.59 s | - | - | - | - |
| rpc-first-screen | node | 418.3 ms | 135.6 MB | 0.50 s | 418.3 ms | - | - | - |
| rpc-first-screen | bun | 210.8 ms | 111.8 MB | 0.52 s | 210.8 ms | - | - | - |
| rpc-turn | node | 420.0 ms | 159.2 MB | 0.61 s | 420.0 ms | 1398.1 ms | 1628.1 ms | 4703 |
| rpc-turn | bun | 237.2 ms | 122.9 MB | 0.69 s | 237.2 ms | 2969.8 ms | 3238.8 ms | 4671 |

- `runtime-floor` is the runtime alone: `node -e ""` and `bun -e "0"`. It is the
  part of the memory that no change to the agent can touch.
- `tui-first-screen` measures the interactive mode until it draws its first
  screen, in a terminal, through `PI_STARTUP_BENCHMARK=1`. The agent reports its
  own phases: 102 ms on Node and 82 ms on Bun from the first line of `main` to
  the first screen.
- `rpc-first-screen` measures the headless mode until it answers the first
  state request.
- `rpc-turn` sends one message and waits for the answer. The first token is the
  time from the prompt to the first token of the answer, the turn is the time to
  the end of the turn.
- Disk: `node_modules` 481.5 MB, the published `dist` of the coding agent
  17.9 MB, the tui 2.1 MB, the ai package 3.9 MB. The compiled binary adds
  about 60 MB on top of the dist it contains.

## Under 10 MB is not reachable on a JavaScript runtime

The goal was a harness under 10 MB of ram. The runtime is the floor, and the
floor is above the goal:

| | Peak RSS of an empty program |
| --- | --- |
| Node 26 | 37.6 MB |
| Bun 1.4 | 17.3 MB |
| a native binary (`/usr/bin/true`) | 1.1 MB |

An empty Node program already uses 2.5x the budget. So the agent cannot get
under 10 MB while it runs on Node, and it cannot get under 10 MB on Bun
either, because the runtime alone is 17.3 MB. The agent's own work is what can
be cut, and that is what this branch cuts.

What the numbers say about the goal:

- The gap to close on Node is 129 MB (140.2 MB measured, 10 MB wanted) and on
  Bun 125 MB (135.3 MB measured, 10 MB wanted).
- The part of the footprint that is not the runtime is 58 MB on Bun and 81 MB
  on Node (peak RSS minus the runtime floor).
- Getting the *whole* agent under 10 MB needs a runtime that starts in a
  megabyte or two, which means a native implementation. The repository already
  has one: the `pi-env` daemon is Rust. A native harness is a rewrite of the
  agent loop, not an optimization of it.

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
| cli-version | 131.6 MB | 119.3 MB | 89.9 MB | 89.5 MB |
| tui-first-screen | 143.5 MB | 140.2 MB | 136.3 MB | 135.3 MB |
| rpc-first-screen | 138.1 MB | 135.6 MB | 111.9 MB | 111.8 MB |
| rpc-turn | 160.9 MB | 159.2 MB | 123.1 MB | 122.9 MB |

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
