# Benchmarks

Two benchmarks for the coding agent.

## `bench/harness`

Memory, cpu time, disk and time of the agent, on Node and on Bun.

```bash
node bench/harness/bench.mjs --runs 5 --warmup 1 \
  --out bench/harness/results.json --markdown bench/harness/RESULTS.md
```

The scenarios are the runtime alone (Node, Bun, Bun with `--smol`, Deno and a
native binary), `pi --version`, the interactive mode until its first screen,
the headless mode until it answers, one message with the answer that comes
back, and the build of the whole workspace. The charge of the battery is read
before and after every run. The result is in [RESULTS.md](harness/RESULTS.md).

`node bench/harness/memory-attribution.mjs` shows which group of modules costs
how much memory.

The turn scenario needs a model. A local llama.cpp server is enough, see
[the token report](tokens/RESULTS.md#reproduce).

## `bench/tokens`

The tokens of one fixed request, and where they go.

```bash
node bench/tokens/token-usage.mjs --runs 3 --agent-dir /tmp/pi-bench-agent
```

The result is in [RESULTS.md](tokens/RESULTS.md).

`node bench/tokens/analyze-request.mjs <file>` breaks a captured request down
into its parts.
