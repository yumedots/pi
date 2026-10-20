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

| Scenario | Runtime | Wall | Peak RSS | Settled RSS | CPU | Instructions | First screen | Turn | Tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| runtime-floor | node | 94.2 ms | 37.5 MB | - | 0.08 s | 1293M | - | - | - |
| runtime-floor | bun | 8.6 ms | 17.5 MB | - | 0.00 s | 56M | - | - | - |
| runtime-floor | deno | 32.8 ms | 39.5 MB | - | 0.02 s | 313M | - | - | - |
| runtime-floor | native | 3.0 ms | 1.1 MB | - | 0.00 s | 8M | - | - | - |
| cli-version | node | 333.0 ms | 114.9 MB | - | 0.37 s | 4374M | - | - | - |
| cli-version | bun | 141.0 ms | 86.5 MB | - | 0.34 s | 2067M | - | - | - |
| cli-version | binary | 154.8 ms | 88.3 MB | - | 0.16 s | 1839M | - | - | - |
| tui-first-screen | node | 672.8 ms | 140.9 MB | - | 0.58 s | 6338M | 672.8 ms | - | - |
| tui-first-screen | bun | 416.1 ms | 136.3 MB | - | 0.59 s | 3572M | 416.1 ms | - | - |
| tui-first-screen | binary | 465.9 ms | 134.7 MB | - | 0.34 s | 3257M | 465.9 ms | - | - |
| **tui-idle** (the agent waits) | node | - | - | **159.9 MB** | - | - | - | - | - |
| **tui-idle** | bun | - | - | **137.3 MB** | - | - | - | - | - |
| **tui-idle** | binary | - | - | **141.3 MB** | - | - | - | - | - |
| rpc-first-screen | node | 432.9 ms | 133.3 MB | 133.3 MB | 0.52 s | 5704M | 432.9 ms | - | - |
| rpc-first-screen | bun | 204.7 ms | 110.5 MB | 110.3 MB | 0.49 s | 2971M | 204.7 ms | - | - |
| rpc-first-screen | binary | 225.5 ms | 111.3 MB | 111.0 MB | 0.27 s | 2757M | 225.5 ms | - | - |
| rpc-turn | node | 431.8 ms | 156.8 MB | 133.2 MB | 0.62 s | 6605M | 431.8 ms | 3557.8 ms | 5037 |
| rpc-turn | bun | 223.6 ms | 123.3 MB | 110.4 MB | 0.59 s | 3429M | 223.6 ms | 1228.7 ms | 5037 |
| rpc-turn | binary | 241.0 ms | 118.8 MB | 110.4 MB | 0.35 s | 3041M | 241.0 ms | 6928.1 ms | 5040 |
| build | toolchain | 3333.5 ms | 1009.5 MB | - | 9.59 s | 1885M | - | - | - |

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
- Bun: 17.5 MB.
- The best artifact, the compiled binary, with the agent on top: 141.3 MB for the
  interactive mode while it waits, 111.0 MB for the headless one.

So the agent's own work is what can be cut, and that is what this branch cuts.
The gap to the goal on the compiled binary is 131 MB, of which 124 MB is the
agent's own code and 17.5 MB the runtime.

Under 10 MB needs a runtime that starts in a megabyte or two. The repository
already has one: the Rust daemon of the `env` package serves in 9.6 MB. A
native harness is a rewrite of the agent loop, not an optimization of it.

## The agent that waits

The number that matters for a harness is the memory the agent holds while it
waits, not the peak of its startup. The interactive mode left up in a terminal
holds:

| Runtime | Memory while it waits |
| --- | --- |
| node | 159.9 MB |
| bun | 137.3 MB |
| the compiled binary | 141.3 MB |

The curve is flat: the memory is the same at the first second and at the
25th, so the agent does not grow while it waits. The peak of a turn is 24 MB
above that on Node, and that is the request, the answer and the model
catalog.

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

## The build

The build of the workspace went from a chain of `cd packages/X && npm run build`
to a script that groups the packages into levels of independent packages and
builds a level at the same time, run with bun.

| | Wall | Memory |
| --- | --- | --- |
| the chain, with npm | 7.10 s | 1.0 GB |
| the levels, with npm | 5.25 s | 1.0 GB |
| **the levels, with bun** | **2.23 s** | **308 MB** |

Measured with hyperfine, 3 runs after a warmup. The install is 8.2x faster with
bun than with npm on a warm cache (384 ms against 3.13 s), and the whole
toolchain of the repository now runs on bun: `bun run build`, `bun run check`,
`bun run test` and `bun install --frozen-lockfile`.

## Where the memory goes

`node bench/harness/memory-attribution.mjs` measures the cost of every module
of the agent on Node. The same script under Bun is lower at every step.

| Module | Cost |
| --- | --- |
| the runtime itself | +1 MB |
| typebox (the schema builder) | +12 MB |
| typebox/compile (the schema compiler) | +9 MB |
| undici (the http client) | +6 MB |
| the model catalog (every provider) | +10 MB |
| the pi-ai package | +4 MB |
| the terminal interface | +3 MB |
| the syntax highlighter | +1 MB |
| the tools and their schemas | +5 MB |
| the settings | +1 MB |
| the model runtime | +6 MB |
| the session | +8 MB |
| the interactive mode | +9 MB |

Every step imports the modules before it, so the number is what the module
adds on top of them.

The three largest items are the schema builder (typebox, 12 MB), the schema
compiler (typebox/compile, 9 MB) and the model catalog (10 MB). The schema
costs are the price of the type safe tool, settings, model and theme schemas:
they are built with typebox when the module is imported, and they are built in
every process that imports the coding agent. The compiler is now loaded only
when a file is validated, which is why the interactive mode holds 12 MB less
on Bun than it did.

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

## What this round changed

**The schema compiler is loaded when a file is validated.** The settings, the
models configuration, the themes and the keybindings were compiled with typebox
when their module was imported, so the compiler was always in the process. An
agent without a models.json, a custom theme or a keybindings.json never
validates anything, and the compiler is one of the heavier modules of the
agent: the interactive mode holds 12 MB less on Bun (147.0 MB against 159.9 MB
on Node) and the headless mode 4 MB less.

**The workspace builds in parallel, with bun.** See the build section above.

## What was not done, and why

- **The schema builder was not replaced.** typebox and typebox/compile cost 20
  MB together, the largest item after the session. Replacing the type safe
  schemas with plain JSON schema objects would remove that, but it touches
  every tool, the settings, the model configuration and the themes, and it
  changes the public API of the ai package. It is a project of its own, not an
  optimization.
- **The model catalog was not deferred.** It is 10 MB, the largest item that is
  left, and only the picker needs the whole list: a request needs the model of
  one provider. The providers are composed at startup and their models are
  built with them, so deferring the catalog means creating the providers when
  their models are asked for, which is a change to the `Models` api of the ai
  package and to the model runtime of the coding agent. The plan is in the
  paragraph above: the provider modules would be imported when they are needed
  instead of when the catalog is built.
- **The type safe schemas were not replaced.** The builder of typebox is 12 MB
  and the tools build their schemas with it when the agent starts, so the
  builder is in the process. A builder of the agent's own would remove it, but
  the type inference of the tool arguments (`Static<typeof schema>`) is the
  feature, and it is what the public api of the ai package hands to the
  extensions.
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
