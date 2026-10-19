# Token usage of one request

How many tokens the agent sends for a fixed request, where they go, and how
much of that can be cut.

- Model: SmolLM2 1.7B Instruct (Q4_K_M) on llama.cpp 0.6.0, the local setup on
  this machine
- Request: `Say hello in three words`, sent three times in a row
- The agent talks to the model through a local proxy, so the request that goes
  out is measured next to the usage the server reports
- The counts come from the tokenizer of the model itself (`/tokenize`), not
  from an estimate

## Where the tokens go

| Part | Characters | Tokens | Share |
| --- | --- | --- | --- |
| the system message | 13879 | 3584 | 84% |
| the tool schemas | 2836 | 667 | 16% |
| the user message | 51 | 15 | 0% |
| **the request** | **16766** | **4266** | |

The system message holds the preamble, the tool list, the rules, the pointer to
the pi documentation, the project context (`AGENTS.md`) and the skills. The
project context is the largest part of it.

The tool schemas are the declarations of `read`, `bash`, `edit` and `write`.
They are what the model needs to call the tools, and they are sent with every
request.

## The same request again

The second and the third request of the same prompt cost almost nothing new:

| Run | Input | Output | Cache read | Total |
| --- | --- | --- | --- | --- |
| 1 | 2445 | 1 | 1158 | 3604 |
| 2 | 1 | 1 | 3602 | 3604 |
| 3 | 1 | 1 | 3602 | 3604 |

llama.cpp keeps the prefix of the prompt, so the system message is a cache read
after the first request. The same holds for the providers with a prompt cache:
the static part of the prompt is paid once, and every request after it pays the
cache read.

That is why the size of the system message matters most for the *first* request
of a session, and why the number of tokens per request is lower than the size
of the prompt for every request after it.

## Cutting the project context

The project context is sent with every request and is the largest part of the
prompt. The new `projectContextMaxChars` setting cuts it at a line boundary and
says how much was left out, so the model can read the file for the rest.

| `projectContextMaxChars` | System message | The request | First token (steady state) |
| --- | --- | --- | --- |
| 0 (the default, everything) | 3584 tokens | 4266 tokens | 454 ms |
| 4000 | 1738 tokens | 2420 tokens | 441 ms |
| 2000 | 1205 tokens | 1887 tokens | 453 ms |

A limit of 4000 characters takes 43% of the tokens out of the request, and the
answer arrives about the same time. The default stays at 0, so nothing changes
until the setting is set: a project whose rules matter should keep them.

## Reproduce

```bash
# a llama.cpp server with a small model
llama-server -m ~/.local/share/pi-models/smollm2-1.7b-instruct-q4_k_m.gguf --port 8081 --ctx-size 8192

# the agent directory that points at it
mkdir -p /tmp/pi-bench-agent
cat > /tmp/pi-bench-agent/models.json <<'EOF'
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

# the measurement
node bench/tokens/token-usage.mjs --runs 3 --agent-dir /tmp/pi-bench-agent
```
