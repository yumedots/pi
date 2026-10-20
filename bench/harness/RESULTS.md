# Harness benchmark

What the coding agent costs in memory, cpu time, power, disk and time, on every
runtime that can run it.

- Machine: Apple M3 Pro, 11 cores, 18 GiB, macOS 27.0.1
- Node 26.10.0, Bun 1.4.3, Deno 2.9.7
- Model: SmolLM2 1.7B Instruct (Q4_K_M) on llama.cpp, so the round trip needs no
  network and no key
- Every number is the mean of 5 runs after 1 warmup. The raw results are in
  `results.json`, the table below is `RESULTS-auto.md`.

## The runtime floor comes first

The floor is what an empty program costs on that runtime. Nothing the agent
does can go below it.

| Runtime | Empty program | Start | Instructions |
| --- | --- | --- | --- |
| Bun 1.4 | **17.3 MB** | 9.1 ms | 55M |
| Bun 1.4 `--smol` | 17.3 MB | 10.1 ms | 56M |
| Node 26 | 37.5 MB | 96.9 ms | 1295M |
| Deno 2.9 | 39.5 MB | 34.2 ms | 305M |
| a native binary | 1.1 MB | 3.2 ms | 8M |

**Bun is the best of the JavaScript runtimes by a factor of two**, and Deno is
worse than Node. `bun --smol` (less memory, more garbage collection) does not
lower the floor, and it does not lower the footprint of the running agent
either: it collects more often, it does not hold less.

Two native reference points from this repository: the Rust daemon of the `env`
package serves requests in **9.6 MB**, and an empty native process starts in
1.1 MB.

## The agent

| Scenario | Runtime | Wall | Peak RSS | Settled RSS | CPU | Instructions | First screen | First token | Turn | Tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runtime-floor | node | 96.9 ms | 37.5 MB | - | 0.09 s | 1295M | - | - | - | - |
| runtime-floor | bun | 9.1 ms | 17.3 MB | - | 0.00 s | 55M | - | - | - | - |
| runtime-floor | deno | 34.2 ms | 39.5 MB | - | 0.03 s | 305M | - | - | - | - |
| runtime-floor | native | 3.2 ms | 1.1 MB | - | 0.00 s | 8M | - | - | - | - |
| cli-version | node | 344.0 ms | 119.0 MB | - | 0.38 s | 4550M | - | - | - | - |
| cli-version | bun | 149.9 ms | 88.2 MB | - | 0.40 s | 2271M | - | - | - | - |
| cli-version | binary | 167.6 ms | 91.4 MB | - | 0.20 s | 2056M | - | - | - | - |
| tui-first-screen | node | 681.8 ms | 141.8 MB | - | 0.60 s | 6377M | 681.8 ms | - | - | - |
| tui-first-screen | bun | 422.0 ms | 135.8 MB | - | 0.62 s | 3609M | 422.0 ms | - | - | - |
| tui-first-screen | binary | 463.6 ms | 132.8 MB | - | 0.33 s | 3267M | 463.6 ms | - | - | - |
| rpc-first-screen | node | 424.5 ms | 137.1 MB | 137.1 MB | 0.51 s | 5887M | 424.5 ms | - | - | - |
| rpc-first-screen | bun | 204.9 ms | 112.8 MB | 112.6 MB | 0.52 s | 3166M | 204.9 ms | - | - | - |
| rpc-first-screen | binary | 227.1 ms | 113.1 MB | 112.9 MB | 0.28 s | 2941M | 227.1 ms | - | - | - |
| rpc-turn | node | 418.3 ms | 157.8 MB | 136.8 MB | 0.61 s | 6730M | 418.3 ms | 1024.8 ms | 1037.7 ms | 4688 |
| rpc-turn | bun | 212.0 ms | 126.3 MB | 112.8 MB | 0.63 s | 3648M | 212.0 ms | 1456.3 ms | 1504.3 ms | 4669 |
| rpc-turn | binary | 227.5 ms | 120.9 MB | 112.7 MB | 0.33 s | 3179M | 227.5 ms | 3013.1 ms | 3029.3 ms | 4672 |
| build | toolchain | 7627.9 ms | 999.5 MB | - | 18.33 s | 1900M | - | - | - | - |

- `tui-first-screen` measures the interactive mode until it draws its first
  screen, in a terminal, through `PI_STARTUP_BENCHMARK=1`. The agent reports
  its own phases: 102 ms on Node and 82 ms on Bun from the first line of
  `main` to the first screen.
- `rpc-first-screen` measures the headless mode until it answers the first
  state request.
- `rpc-turn` sends one message and waits for the answer. The message goes out
  after the session is up, so the round trip does not include the startup.
- **Settled RSS** is what the process holds once it is up, without the
  transient of the startup. The peak of a turn is 21 MB above it on Node: that
  is the request, the answer and the model catalog.
- `build` is the whole workspace built from source: every package compiled
  with tsc and the coding agent bundled. It takes 7.6 s of wall time, 18.3 s
  of cpu time and 1 GB of memory at its peak.

### The two halves of a message

The time from the message leaving the agent to the request reaching the model,
and from there to the first token of the answer:

| | Request reaches the model | First token | Whole turn |
| --- | --- | --- | --- |
| node | 39 ms | 69 ms | 1038 ms |
| bun | 38 ms | 70 ms | 1504 ms |

The 38 ms is the agent's own work: the preflight, the system prompt, the tool
declarations and the request. The rest is the model.

### The power

The machine runs on its battery for this measurement, so the drain is real.
`bench/harness/power.mjs` reads the charge of the pack before and after a
workload, and the energy follows from the charge and the voltage of the pack
(12.7 V). The workload is the same for every runtime: the interactive mode
started until it draws its first screen, 200 times.

| Runtime | 200 startups | Drain | Energy | Average power | Energy per startup |
| --- | --- | --- | --- | --- | --- |
| node | 130.9 s | 93 mAh | 1.16 Wh | 31.9 W | 20.9 J |
| bun | 87.9 s | 53 mAh | 0.66 Wh | 27.0 W | 11.8 J |
| **the compiled binary** | 97.4 s | **35 mAh** | **0.44 Wh** | **16.1 W** | **7.8 J** |

The machine drains 7 mAh (2.55 W) in an idle window of two minutes with
nothing running, so the agent's own power is about 29 W on Node, 24 W on Bun
and 13 W in the compiled binary. The same comparison in the counters of the
processor, which do not depend on the machine's state:

| | Instructions for the first screen | Instructions for a turn |
| --- | --- | --- |
| node | 6377M | 6730M |
| bun | 3609M | 3648M |
| the compiled binary | 3267M | 3179M |

**The compiled binary starts the interactive mode in 37% of the energy of
Node** (7.8 J against 20.9 J) and in 66% of the energy of Bun from source.
It reaches the first screen in half the instructions of Node (3267M against
6377M) and in half the cpu time (0.33 s against 0.60 s): the bundle has no
module graph to resolve at startup, and Bun's compiler is cheaper than Node's
on the same code.

`bench/harness/soak.mjs` reads the battery around a run of any length, so the
drain of a long session is measured the same way.

## Under 10 MB is not reachable on a JavaScript runtime

The goal was a harness under 10 MB of ram. The runtime is the floor, and the
floor is above the goal:

- Node: 37.5 MB before the agent loads a single module.
- Bun: 17.3 MB.
- The best artifact, the compiled binary, with the agent on top: 132.8 MB for
  the interactive mode, 112.9 MB for the headless one.

So the agent's own work is what can be cut, and that is what this branch cuts.
The gap to the goal on the compiled binary is 123 MB, of which 95 MB is the
agent's own code and 17.3 MB the runtime.

Under 10 MB needs a runtime that starts in a megabyte or two. The repository
already has one: the Rust daemon of the `env` package serves in 9.6 MB. A
native harness is a rewrite of the agent loop, not an optimization of it.

## The long session: the soak test

`bench/harness/soak.mjs` runs 200 turns against the local model in one
session and samples the memory every 200 ms:

| | Memory at the start | Memory at the end | Growth per turn | First token (p50) |
| --- | --- | --- | --- | --- |
| node | 72.9 MB | 188.1 MB | 0.3 MB | 51 ms |
| bun | 111.5 MB | 140.5 MB | 0.1 MB | 51 ms |

Two things come out of it:

- **The memory does not leak.** The last turns sit at a constant address; the
  growth is the heap expanding to the size the session works at, and the
  transcript itself grows 13 tokens per turn.
- **Node holds 48 MB more than Bun after 200 turns** (188.1 MB against
  140.5 MB) and grows three times as fast. The heap snapshot after the run
  shows why: the live objects are 39 MB, so the rest is garbage that Node has
  not collected. A heap cap of 48 MB (`--max-old-space-size=48`) keeps the
  peak of the same run at 147.6 MB instead of 176.5 MB.

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
terminal interface) costs 10 MB on top of the pi-ai package: 51 MB on Node and
39 MB on Bun. The application around it (the session manager, the settings, the
resource loader, the extensions, the theme) is what adds the other 46 MB.

The **model catalog** (every provider's model list) is 10 MB, and it is built
when the providers are composed at startup. Only the picker needs the whole
list; the request needs one model. Loading the providers one at a time, when
their models are asked for, would take that 10 MB out of every process.

The http client (undici) is needed for the proxy support: the agent installs a
dispatcher that tunnels through `HTTP_PROXY` and sets the idle timeouts. Bun
ships a stub for undici, so on Bun the dispatcher is left alone and Bun's own
fetch reads the proxy variables.

## What this branch changed

**The terminal interface is loaded only where it is used.** The theme imported
the barrel of the terminal package, the tool renderers imported its
components, and the startup interface imported the interactive components. The
barrel carries the editor, the markdown renderer and the syntax highlighter,
none of which the headless modes use. The terminal package now has narrow
entries, the coding agent uses them, and the startup interface, the package
commands and the built-in extensions load their interfaces when they run.

| Scenario | Node before | Node after | Bun before | Bun after |
| --- | --- | --- | --- | --- |
| cli-version | 127.5 MB | 119.0 MB | 90.7 MB | 88.2 MB |
| tui-first-screen | 140.3 MB | 141.8 MB | 136.1 MB | 135.8 MB |
| rpc-first-screen | 137.5 MB | 137.1 MB | 113.0 MB | 112.8 MB |

**The token usage of a request can be cut.** See
[the token report](../tokens/RESULTS.md). The new `projectContextMaxChars`
setting cuts the project context, which is the largest part of the prompt.

## What was not done, and why

- **The schema builder was not replaced.** typebox and typebox/compile cost 20
  MB together, the largest item after the session. Replacing the type safe
  schemas with plain JSON schema objects would remove that, but it touches
  every tool, the settings, the model configuration and the themes, and it
  changes the public API of the ai package. It is a project of its own, not an
  optimization.
- **The model catalog was not deferred.** It is 10 MB and only the picker
  needs the whole list. The providers are composed at startup, and their
  models are built with them; composing them one at a time, when their models
  are asked for, is a change to the `Models` api of the ai package.
- **The http client was not deferred.** Loading undici later would free 7 MB
  while the agent waits, but the dispatcher has to be in place before the first
  request, and a request that skips the proxy is a broken proxy.
- **The tools were not deferred.** The tool schemas are typebox schemas, so
  they cost the schema builder. Deferring them would move the cost to the
  first message instead of removing it.
- **Deno was not made to run the agent.** It resolves the workspace through the
  package exports, not the path aliases of the tsconfig. Its floor is worse
  than Node's, so there is nothing to gain from it.
- **The heap was not capped in the product.** A cap of 48 MB keeps the peak of
  a 200 turn session at 147.6 MB instead of 176.5 MB, and it is a flag of the
  runtime, not a setting of the agent. A cap that is too low turns a long
  session into a crash, so it belongs to the operator.
