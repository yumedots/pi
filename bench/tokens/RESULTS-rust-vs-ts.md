# The token cost of a conversation: the Rust port against the TypeScript agent

What the same conversation costs in tokens on both sides: the same prompt, the same
local model, the same machine, measured by the same harness.

- Machine: Apple M3 Pro, 11 cores, 18 GiB, macOS 27.0.1
- Model: SmolLM2 1.7B Instruct (Q4_K_M) on llama.cpp 0.6.0, the local setup on this
  machine
- The TypeScript agent: `packages/coding-agent/dist/cli.js --mode rpc --no-session`,
  run in `/Users/gabriel/pi`
- The Rust port: `cargo build --release -p rpi-cli`, run in `/Users/gabriel/pi-native`
- The harness: [token-usage.mjs](token-usage.mjs), the summary of a run:
  [summarize.mjs](summarize.mjs), the raw numbers: [results/](results/)

## How the numbers are counted

Two counters, kept apart:

- **The counted tokens** are the tokenizer of the model itself: every part of the
  request goes to `/tokenize` of the llama.cpp server and the number of tokens comes
  back. Nothing is estimated. The parts are counted one by one, so the sum of the
  parts is a little above the token count of the whole request.
- **The server tokens** are what llama.cpp itself reports: `timings.prompt_n` (the
  tokens of the prompt it processed) and `timings.cache_n` (the tokens it took from
  its prefix cache), and the `usage` object of the last chunk of the stream
  (`prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`).
  Both sides ask for it with `stream_options: {include_usage: true}`.

The two are not the same number and do not have to be: the counted tokens are the
parts of the request measured one by one, the server tokens are the prompt after
the chat template of the model.

## The commands

```bash
# the agent directory that points at the local model
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

# the release build of the port (its own target directory, so the developer's
# `cargo run` in the same tree is never blocked by the lock)
CARGO_TARGET_DIR=/tmp/rpi-token-target scripts/agent-cargo.sh build --release -p rpi-cli

# one request, both sides, three runs after a warmup, a fresh server for every run
node bench/tokens/token-usage.mjs --runs 3 --warmup 1 --scenario single \
  --runtimes rpi,node --rpi /tmp/rpi-token-target/release/rpi \
  --ts-repo /Users/gabriel/pi --agent-dir /tmp/pi-bench-agent-rpi --own-server \
  --json bench/tokens/results/rust-vs-ts-single.json

# the same, with the same working directory on both sides
node bench/tokens/token-usage.mjs --runs 3 --warmup 1 --scenario single \
  --runtimes rpi,node --rpi /tmp/rpi-token-target/release/rpi \
  --ts-repo /Users/gabriel/pi --agent-dir /tmp/pi-bench-agent-rpi --own-server \
  --cwd /Users/gabriel/pi-native \
  --json bench/tokens/results/rust-vs-ts-single-common-cwd.json

# a conversation of three messages, both sides
node bench/tokens/token-usage.mjs --runs 3 --warmup 1 --scenario conversation \
  --runtimes rpi,node --rpi /tmp/rpi-token-target/release/rpi \
  --ts-repo /Users/gabriel/pi --agent-dir /tmp/pi-bench-agent-rpi --own-server \
  --json bench/tokens/results/rust-vs-ts-conversation.json

# a turn that runs a tool
node bench/tokens/token-usage.mjs --runs 3 --warmup 1 --scenario tool \
  --runtimes rpi,node --rpi /tmp/rpi-token-target/release/rpi \
  --ts-repo /Users/gabriel/pi --agent-dir /tmp/pi-bench-agent-rpi \
  --json bench/tokens/results/rust-vs-ts-tool.json

# the summary of a run, as the tables of this report
node bench/tokens/summarize.mjs --markdown bench/tokens/results/rust-vs-ts-single.json
```

`--own-server` starts a fresh `llama-server` for every run, so the prompt cache of
the server starts empty and the first request of a run is a cold one. The harness
checks the measurement itself: every request has to have a system prompt, the tool
declarations have to be there when the request carries them, and the parts have to
add up to the total (`checkMeasurement` in the harness).

## The same request, both sides

Each side runs in its own repository, so each side sends its own `AGENTS.md` as the
project context. The numbers are the mean of 3 runs after a warmup, and the raw
numbers of every run are in the brackets.

### single, turn 0: Say hello in three words

| Part | Rust port | TypeScript agent |
| --- | --- | --- |
| the system prompt | 2577 (2577, 2577, 2577) | 4536 (4536, 4536, 4536) |
| the tool declarations | 1084 (1084, 1084, 1084) | 1227 (1227, 1227, 1227) |
| the conversation | 168 (231, 146, 127) | 15 (15, 15, 15) |
| **the request (counted)** | 3786 (3849, 3764, 3745) | 5763 (5763, 5763, 5763) |
| the request (server prompt tokens) | 2764 (2827, 2742, 2723) | 4555 (4555, 4555, 4555) |
| the prefix cache (server cached tokens) | 0 (0, 0, 0) | 0 (0, 0, 0) |
| the cache hit rate | 0% | 0% |
| the answer (server output tokens) | 4.7 (3, 5, 6) | 1 (1, 1, 1) |
| the requests per turn | 2 (2, 2, 2) | 1 (1, 1, 1) |
| &nbsp;&nbsp;system:cwd | 80 (80, 80, 80) | 16 (16, 16, 16) |
| &nbsp;&nbsp;system:rules | 553 (553, 553, 553) | 227 (227, 227, 227) |
| &nbsp;&nbsp;system:tools | 55 (55, 55, 55) | 98 (98, 98, 98) |
| &nbsp;&nbsp;system:preamble | 34 (34, 34, 34) | 33 (33, 33, 33) |
| &nbsp;&nbsp;system:project_context | 1440 (1440, 1440, 1440) | 3297 (3297, 3297, 3297) |
| &nbsp;&nbsp;system:available_skills | 373 (373, 373, 373) | - |
| &nbsp;&nbsp;system:docs | - | 346 (346, 346, 346) |
| &nbsp;&nbsp;system:skills | - | 442 (442, 442, 442) |
| &nbsp;&nbsp;system:mcp_servers | - | 63 (63, 63, 63) |
| &nbsp;&nbsp;tool:read | 261 (261, 261, 261) | 217 (217, 217, 217) |
| &nbsp;&nbsp;tool:bash | 240 (240, 240, 240) | 168 (168, 168, 168) |
| &nbsp;&nbsp;tool:edit | 439 (439, 439, 439) | 284 (284, 284, 284) |
| &nbsp;&nbsp;tool:write | 143 (143, 143, 143) | 121 (121, 121, 121) |
| &nbsp;&nbsp;tool:codemode | - | 436 (436, 436, 436) |
| &nbsp;&nbsp;message:user | 163 (226, 141, 122) | 15 (15, 15, 15) |

## What accounts for the difference

The port's request is **not** bigger than pi's: it is smaller, in the counted
tokens and in the tokens llama.cpp processed. The gap that is there is the other
way round, and it is made of three parts:

1. **The project context** (the `AGENTS.md` of the repository each side runs in):
   pi's file is 12529 bytes, the port's is 4581 bytes. That is 3297 tokens against
   1440 tokens, and it is the largest single difference in the whole request. With
   the same working directory on both sides the two are the same size
   (see the table of the common working directory below), so it is the file, not
   the agent.
2. **The pi documentation pointer**: pi sends a section that points the model at
   its own documentation (346 tokens), and a section with the MCP servers (63
   tokens). The port sends neither.
3. **The port's guidelines** are longer than pi's rules (553 against 227 tokens):
   the port puts the language rule, the bash rule, the "prefer the smallest
   change" rule and the "read only what you need" rule in the prompt. They are
   worth what they say, but they are tokens on every request.

Against that, the port pays one thing pi does not:

4. **A context summary request before every turn.** The compaction of the port
   trips before the first turn and before every turn after it, because the
   threshold is `contextWindow - reserveTokens` and the model of the benchmark has
   a window of 8192 against a reserve of 16384: the threshold is negative, so the
   compaction always trips. The port then sends a summarization request (309
   prompt tokens, 100 to 200 answer tokens) for a conversation that is empty, and
   leaves the summary in the transcript, where it is sent again with every later
   request (140 tokens).
   pi does not do that. pi checks the compaction before a run only when there is
   an assistant message to compact
   (`packages/coding-agent/src/core/agent-session.ts:1910`), and its compaction
   only calls the model when there are messages to summarize
   (`packages/coding-agent/src/core/compaction/compaction.ts:983`). With nothing
   to summarize, pi sends nothing.
   The port's pre-run compaction does not have that second rule
   (`rpi/crates/rpi-harness/src/agent_harness.rs:3812`), so it sends the summary
   of an empty conversation, every turn.

So the port's per-turn bill is: a smaller request, plus a request it does not
need, plus a summary it carries in every later request.

### single, turn 0: Say hello in three words

| Part | Rust port | TypeScript agent |
| --- | --- | --- |
| the system prompt | 2577 (2577, 2577, 2577) | 2718 (2718, 2718, 2718) |
| the tool declarations | 1084 (1084, 1084, 1084) | 1227 (1227, 1227, 1227) |
| the conversation | 158 (181, 126, 167) | 15 (15, 15, 15) |
| **the request (counted)** | 3776 (3799, 3744, 3785) | 3945 (3945, 3945, 3945) |
| the request (server prompt tokens) | 2754 (2777, 2722, 2763) | 2737 (2737, 2737, 2737) |
| the prefix cache (server cached tokens) | 0 (0, 0, 0) | 0 (0, 0, 0) |
| the cache hit rate | 0% | 0% |
| the answer (server output tokens) | 5 (3, 5, 7) | 1 (1, 1, 1) |
| the requests per turn | 2 (2, 2, 2) | 1 (1, 1, 1) |
| &nbsp;&nbsp;system:cwd | 80 (80, 80, 80) | 18 (18, 18, 18) |
| &nbsp;&nbsp;system:rules | 553 (553, 553, 553) | 227 (227, 227, 227) |
| &nbsp;&nbsp;system:tools | 55 (55, 55, 55) | 98 (98, 98, 98) |
| &nbsp;&nbsp;system:preamble | 34 (34, 34, 34) | 33 (33, 33, 33) |
| &nbsp;&nbsp;system:project_context | 1440 (1440, 1440, 1440) | 1438 (1438, 1438, 1438) |
| &nbsp;&nbsp;system:available_skills | 373 (373, 373, 373) | - |
| &nbsp;&nbsp;system:docs | - | 346 (346, 346, 346) |
| &nbsp;&nbsp;system:skills | - | 450 (450, 450, 450) |
| &nbsp;&nbsp;system:mcp_servers | - | 94 (94, 94, 94) |
| &nbsp;&nbsp;tool:read | 261 (261, 261, 261) | 217 (217, 217, 217) |
| &nbsp;&nbsp;tool:bash | 240 (240, 240, 240) | 168 (168, 168, 168) |
| &nbsp;&nbsp;tool:edit | 439 (439, 439, 439) | 284 (284, 284, 284) |
| &nbsp;&nbsp;tool:write | 143 (143, 143, 143) | 121 (121, 121, 121) |
| &nbsp;&nbsp;tool:codemode | - | 436 (436, 436, 436) |
| &nbsp;&nbsp;message:user | 153 (176, 121, 162) | 15 (15, 15, 15) |

## The cached case

The prefix cache of llama.cpp is the same on both sides: it caches the prefix of
the prompt, and the second request of a conversation has the whole system prompt
and the conversation so far in the cache.

### conversation, turn 0: Say hello in three words

| Part | Rust port | TypeScript agent |
| --- | --- | --- |
| the system prompt | 2577 (2577, 2577, 2577) | 4536 (4536, 4536, 4536) |
| the tool declarations | 1084 (1084, 1084, 1084) | 1227 (1227, 1227, 1227) |
| the conversation | 148 (133, 122, 189) | 15 (15, 15, 15) |
| **the request (counted)** | 3766 (3751, 3740, 3807) | 5763 (5763, 5763, 5763) |
| the request (server prompt tokens) | 2744 (2729, 2718, 2785) | 4555 (4555, 4555, 4555) |
| the prefix cache (server cached tokens) | 0 (0, 0, 0) | 0 (0, 0, 0) |
| the cache hit rate | 0% | 0% |
| the answer (server output tokens) | 4.3 (2, 5, 6) | 1 (1, 1, 1) |
| the requests per turn | 2 (2, 2, 2) | 1 (1, 1, 1) |
| &nbsp;&nbsp;system:cwd | 80 (80, 80, 80) | 16 (16, 16, 16) |
| &nbsp;&nbsp;system:rules | 553 (553, 553, 553) | 227 (227, 227, 227) |
| &nbsp;&nbsp;system:tools | 55 (55, 55, 55) | 98 (98, 98, 98) |
| &nbsp;&nbsp;system:preamble | 34 (34, 34, 34) | 33 (33, 33, 33) |
| &nbsp;&nbsp;system:project_context | 1440 (1440, 1440, 1440) | 3297 (3297, 3297, 3297) |
| &nbsp;&nbsp;system:available_skills | 373 (373, 373, 373) | - |
| &nbsp;&nbsp;system:docs | - | 346 (346, 346, 346) |
| &nbsp;&nbsp;system:skills | - | 442 (442, 442, 442) |
| &nbsp;&nbsp;system:mcp_servers | - | 63 (63, 63, 63) |
| &nbsp;&nbsp;tool:read | 261 (261, 261, 261) | 217 (217, 217, 217) |
| &nbsp;&nbsp;tool:bash | 240 (240, 240, 240) | 168 (168, 168, 168) |
| &nbsp;&nbsp;tool:edit | 439 (439, 439, 439) | 284 (284, 284, 284) |
| &nbsp;&nbsp;tool:write | 143 (143, 143, 143) | 121 (121, 121, 121) |
| &nbsp;&nbsp;tool:codemode | - | 436 (436, 436, 436) |
| &nbsp;&nbsp;message:user | 143 (128, 117, 184) | 15 (15, 15, 15) |

### conversation, turn 1: Now say it in French, in three words.

| Part | Rust port | TypeScript agent |
| --- | --- | --- |
| the system prompt | 2577 (2577, 2577, 2577) | 4536 (4536, 4536, 4536) |
| the tool declarations | 1084 (1084, 1084, 1084) | 1227 (1227, 1227, 1227) |
| the conversation | 161.3 (144, 136, 204) | 34 (34, 34, 34) |
| **the request (counted)** | 3779.3 (3762, 3754, 3822) | 5782 (5782, 5782, 5782) |
| the request (server prompt tokens) | 2768.3 (2751, 2743, 2811) | 4570 (4570, 4570, 4570) |
| the prefix cache (server cached tokens) | 2747.3 (2730, 2722, 2790) | 4552 (4552, 4552, 4552) |
| the cache hit rate | 99.2% | 99.6% |
| the answer (server output tokens) | 5 (3, 7, 5) | 1 (1, 1, 1) |
| the requests per turn | 1 (1, 1, 1) | 1 (1, 1, 1) |
| &nbsp;&nbsp;system:cwd | 80 (80, 80, 80) | 16 (16, 16, 16) |
| &nbsp;&nbsp;system:rules | 553 (553, 553, 553) | 227 (227, 227, 227) |
| &nbsp;&nbsp;system:tools | 55 (55, 55, 55) | 98 (98, 98, 98) |
| &nbsp;&nbsp;system:preamble | 34 (34, 34, 34) | 33 (33, 33, 33) |
| &nbsp;&nbsp;system:project_context | 1440 (1440, 1440, 1440) | 3297 (3297, 3297, 3297) |
| &nbsp;&nbsp;system:available_skills | 373 (373, 373, 373) | - |
| &nbsp;&nbsp;system:docs | - | 346 (346, 346, 346) |
| &nbsp;&nbsp;system:skills | - | 442 (442, 442, 442) |
| &nbsp;&nbsp;system:mcp_servers | - | 63 (63, 63, 63) |
| &nbsp;&nbsp;tool:read | 261 (261, 261, 261) | 217 (217, 217, 217) |
| &nbsp;&nbsp;tool:bash | 240 (240, 240, 240) | 168 (168, 168, 168) |
| &nbsp;&nbsp;tool:edit | 439 (439, 439, 439) | 284 (284, 284, 284) |
| &nbsp;&nbsp;tool:write | 143 (143, 143, 143) | 121 (121, 121, 121) |
| &nbsp;&nbsp;tool:codemode | - | 436 (436, 436, 436) |
| &nbsp;&nbsp;message:user | 143 (128, 117, 184) | 15 (15, 15, 15) |
| &nbsp;&nbsp;message:assistant | 3.3 (1, 4, 5) | - |

### conversation, turn 2: And once more, in English, in three words.

| Part | Rust port | TypeScript agent |
| --- | --- | --- |
| the system prompt | 2577 (2577, 2577, 2577) | 4536 (4536, 4536, 4536) |
| the tool declarations | 1084 (1084, 1084, 1084) | 1227 (1227, 1227, 1227) |
| the conversation | 176.3 (157, 153, 219) | 54 (54, 54, 54) |
| **the request (counted)** | 3794.3 (3775, 3771, 3837) | 5802 (5802, 5802, 5802) |
| the request (server prompt tokens) | 2794.3 (2775, 2771, 2837) | 4586 (4586, 4586, 4586) |
| the prefix cache (server cached tokens) | 2772.3 (2753, 2749, 2815) | 4567 (4567, 4567, 4567) |
| the cache hit rate | 99.2% | 99.6% |
| the answer (server output tokens) | 4.3 (3, 6, 4) | 1 (1, 1, 1) |
| the requests per turn | 1 (1, 1, 1) | 1 (1, 1, 1) |
| &nbsp;&nbsp;system:cwd | 80 (80, 80, 80) | 16 (16, 16, 16) |
| &nbsp;&nbsp;system:rules | 553 (553, 553, 553) | 227 (227, 227, 227) |
| &nbsp;&nbsp;system:tools | 55 (55, 55, 55) | 98 (98, 98, 98) |
| &nbsp;&nbsp;system:preamble | 34 (34, 34, 34) | 33 (33, 33, 33) |
| &nbsp;&nbsp;system:project_context | 1440 (1440, 1440, 1440) | 3297 (3297, 3297, 3297) |
| &nbsp;&nbsp;system:available_skills | 373 (373, 373, 373) | - |
| &nbsp;&nbsp;system:docs | - | 346 (346, 346, 346) |
| &nbsp;&nbsp;system:skills | - | 442 (442, 442, 442) |
| &nbsp;&nbsp;system:mcp_servers | - | 63 (63, 63, 63) |
| &nbsp;&nbsp;tool:read | 261 (261, 261, 261) | 217 (217, 217, 217) |
| &nbsp;&nbsp;tool:bash | 240 (240, 240, 240) | 168 (168, 168, 168) |
| &nbsp;&nbsp;tool:edit | 439 (439, 439, 439) | 284 (284, 284, 284) |
| &nbsp;&nbsp;tool:write | 143 (143, 143, 143) | 121 (121, 121, 121) |
| &nbsp;&nbsp;tool:codemode | - | 436 (436, 436, 436) |
| &nbsp;&nbsp;message:user | 143 (128, 117, 184) | 15 (15, 15, 15) |
| &nbsp;&nbsp;message:assistant | 3.3 (1, 4, 5) | - |

- The first request of a session is cold on both sides (the harness starts a
  fresh server for every run, so the cache of the server starts empty).
- From the second turn on, the port's prefix is cached exactly like pi's: the
  cache hit rate is the same on both sides, and the new tokens per turn are the
  same (the agent's own words of the turn, not the prompt).
- The port's own provider path never sends an Anthropic style `cache_control`
  marker on the `openai-completions` API, where pi does when the model says its
  cache format is `anthropic`
  (`packages/ai/src/api/openai-completions.ts:822`). For llama.cpp that does not
  matter, the prefix cache is automatic, but for a provider that needs the marker
  the port would pay the full price of the prefix on every request. The
  `anthropic-messages` API of the port does send the marker.

## The turn that runs a tool

The model of the benchmark does not call tools, so this turn runs against a mock
that answers with a tool call ([tool-mock.mjs](tool-mock.mjs)): the same reply on
both sides, the token counts are still the tokenizer of the model. The request
below is the one that carries the result of the tool.

### tool, turn 0: Say hello in three words Use the read tool to read the file bench/README.md.

| Part | Rust port | TypeScript agent |
| --- | --- | --- |
| the system prompt | 2577 (2577, 2577, 2577) | 4536 (4536, 4536, 4536) |
| the tool declarations | 1084 (1084, 1084, 1084) | 1227 (1227, 1227, 1227) |
| the conversation | 591 (591, 591, 591) | 570 (570, 570, 570) |
| **the request (counted)** | 4209 (4209, 4209, 4209) | 6318 (6318, 6318, 6318) |
| the request (server prompt tokens) | 42 (42, 42, 42) | 42 (42, 42, 42) |
| the prefix cache (server cached tokens) | - | - |
| the cache hit rate | 0% | 0% |
| the answer (server output tokens) | 7 (7, 7, 7) | 7 (7, 7, 7) |
| the requests per turn | 3 (3, 3, 3) | 2 (2, 2, 2) |
| &nbsp;&nbsp;system:cwd | 80 (80, 80, 80) | 16 (16, 16, 16) |
| &nbsp;&nbsp;system:rules | 553 (553, 553, 553) | 227 (227, 227, 227) |
| &nbsp;&nbsp;system:tools | 55 (55, 55, 55) | 98 (98, 98, 98) |
| &nbsp;&nbsp;system:preamble | 34 (34, 34, 34) | 33 (33, 33, 33) |
| &nbsp;&nbsp;system:project_context | 1440 (1440, 1440, 1440) | 3297 (3297, 3297, 3297) |
| &nbsp;&nbsp;system:available_skills | 373 (373, 373, 373) | - |
| &nbsp;&nbsp;system:docs | - | 346 (346, 346, 346) |
| &nbsp;&nbsp;system:skills | - | 442 (442, 442, 442) |
| &nbsp;&nbsp;system:mcp_servers | - | 63 (63, 63, 63) |
| &nbsp;&nbsp;tool:read | 261 (261, 261, 261) | 217 (217, 217, 217) |
| &nbsp;&nbsp;tool:bash | 240 (240, 240, 240) | 168 (168, 168, 168) |
| &nbsp;&nbsp;tool:edit | 439 (439, 439, 439) | 284 (284, 284, 284) |
| &nbsp;&nbsp;tool:write | 143 (143, 143, 143) | 121 (121, 121, 121) |
| &nbsp;&nbsp;tool:codemode | - | 436 (436, 436, 436) |
| &nbsp;&nbsp;message:user | 30 (30, 30, 30) | 29 (29, 29, 29) |
| &nbsp;&nbsp;message:assistant | 1 (1, 1, 1) | 1 (1, 1, 1) |
| &nbsp;&nbsp;message:tool | 540 (540, 540, 540) | 540 (540, 540, 540) |

## The tool declarations

### tool, turn 0: Say hello in three words Use the read tool to read the file bench/README.md.

| Part | Rust port | TypeScript agent |
| --- | --- | --- |
| the system prompt | 2577 (2577, 2577, 2577) | 4536 (4536, 4536, 4536) |
| the tool declarations | 1084 (1084, 1084, 1084) | 1227 (1227, 1227, 1227) |
| the conversation | 591 (591, 591, 591) | 570 (570, 570, 570) |
| **the request (counted)** | 4209 (4209, 4209, 4209) | 6318 (6318, 6318, 6318) |
| the request (server prompt tokens) | 42 (42, 42, 42) | 42 (42, 42, 42) |
| the prefix cache (server cached tokens) | - | - |
| the cache hit rate | 0% | 0% |
| the answer (server output tokens) | 7 (7, 7, 7) | 7 (7, 7, 7) |
| the requests per turn | 3 (3, 3, 3) | 2 (2, 2, 2) |
| &nbsp;&nbsp;system:cwd | 80 (80, 80, 80) | 16 (16, 16, 16) |
| &nbsp;&nbsp;system:rules | 553 (553, 553, 553) | 227 (227, 227, 227) |
| &nbsp;&nbsp;system:tools | 55 (55, 55, 55) | 98 (98, 98, 98) |
| &nbsp;&nbsp;system:preamble | 34 (34, 34, 34) | 33 (33, 33, 33) |
| &nbsp;&nbsp;system:project_context | 1440 (1440, 1440, 1440) | 3297 (3297, 3297, 3297) |
| &nbsp;&nbsp;system:available_skills | 373 (373, 373, 373) | - |
| &nbsp;&nbsp;system:docs | - | 346 (346, 346, 346) |
| &nbsp;&nbsp;system:skills | - | 442 (442, 442, 442) |
| &nbsp;&nbsp;system:mcp_servers | - | 63 (63, 63, 63) |
| &nbsp;&nbsp;tool:read | 261 (261, 261, 261) | 217 (217, 217, 217) |
| &nbsp;&nbsp;tool:bash | 240 (240, 240, 240) | 168 (168, 168, 168) |
| &nbsp;&nbsp;tool:edit | 439 (439, 439, 439) | 284 (284, 284, 284) |
| &nbsp;&nbsp;tool:write | 143 (143, 143, 143) | 121 (121, 121, 121) |
| &nbsp;&nbsp;tool:codemode | - | 436 (436, 436, 436) |
| &nbsp;&nbsp;message:user | 30 (30, 30, 30) | 29 (29, 29, 29) |
| &nbsp;&nbsp;message:assistant | 1 (1, 1, 1) | 1 (1, 1, 1) |
| &nbsp;&nbsp;message:tool | 540 (540, 540, 540) | 540 (540, 540, 540) |S

## Where the port can be brought closer

1. **The pre-run compaction.** The port should not send a summary when there is
   nothing to summarize, the way pi does not. That is one request fewer per turn
   (309 prompt tokens, 100 to 200 answer tokens) and 140 tokens less in every
   later request.
2. **The strict schema transform.** pi's `openai-completions` provider sends the
   strict form of the schema (every property required, the optional ones wrapped
   in `anyOf: [..., {type: "null"}]`, `additionalProperties: false`); the port's
   does not. The port's payload is therefore cheaper on the wire than pi's, and
   that is a difference the model sees, not a saving.
3. **The guidelines.** The rules of the port are 553 tokens against pi's 227. The
   ones that are not in pi's prompt are the language rule, the "prefer the
   smallest change" rule and the "read only what you need" rule. Whether they
   earn their tokens is a decision about the agent, not about the measurement.

## What could not be measured

- **The tool declarations cost the local model nothing.** The chat template of
  SmolLM2 renders the messages and drops the tools: the `/apply-template` endpoint
  of the server answers with the system message and the user message only. The
  tool numbers are therefore what a provider that renders the tools would charge;
  on this local model they are invisible to the model.
- **The turn that runs a tool** ran against a mock, because SmolLM2 1.7B does not
  call tools. The reply that triggers the tool is scripted, the token counts are
  not.
- **The cache numbers are llama.cpp's own accounting** (`timings.cache_n` and the
  `usage` object of the last chunk), not a measurement of the port's provider
  layer. The counted tokens are the model's tokenizer.
