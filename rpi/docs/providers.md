# Providers

The port publishes the same provider set as pi: 42 providers, with the same
ids, display names, endpoints and API-key environment variables. The catalogue
of models behind them is generated data (see [models.md](models.md)).

## How a provider is selected

- `--provider <id>` picks the provider; `--model <provider>/<id>` picks a model
  inside one.
- A provider's credential is resolved in this order: `~/.rpi/auth.json`, the
  `apiKey` of `~/.rpi/models.json`, then the provider's API-key environment
  variable. The credential of one provider never reaches another.
- A provider without a credential is still listed by `rpi --list-models` only
  when it has one; the request path then answers with the login guidance
  (`No API key found for <provider>.`).

## The provider table

| id | name | base URL | API key env | credential needed |
|---|---|---|---|---|
| amazon-bedrock | Amazon Bedrock | per model | — (AWS credential chain) | yes |
| ant-ling | Ant Ling | https://api.ant-ling.com/v1 | `ANT_LING_API_KEY` | yes |
| anthropic | Anthropic | https://api.anthropic.com | `ANTHROPIC_API_KEY` | yes |
| azure | Azure | per deployment | `AZURE_OPENAI_API_KEY` | yes |
| baseten | Baseten | https://inference.baseten.co/v1 | `BASETEN_API_KEY` | yes |
| cerebras | Cerebras | https://api.cerebras.ai/v1 | `CEREBRAS_API_KEY` | yes |
| cloudflare-ai-gateway | Cloudflare AI Gateway | per model (placeholders) | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_GATEWAY_ID` | yes |
| cloudflare-workers-ai | Cloudflare Workers AI | per model (placeholders) | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` | yes |
| deepseek | DeepSeek | https://api.deepseek.com | `DEEPSEEK_API_KEY` | yes |
| fireworks | Fireworks | https://api.fireworks.ai/inference | `FIREWORKS_API_KEY` | yes |
| github-copilot | GitHub Copilot | https://api.individual.githubcopilot.com | `COPILOT_GITHUB_TOKEN` | yes |
| google | Google | https://generativelanguage.googleapis.com/v1beta | `GEMINI_API_KEY` | yes |
| google-vertex | Google Vertex AI | per region | `GOOGLE_CLOUD_API_KEY` | yes |
| groq | Groq | https://api.groq.com/openai/v1 | `GROQ_API_KEY` | yes |
| huggingface | Hugging Face | https://router.huggingface.co/v1 | `HF_TOKEN` | yes |
| kimi-coding | Kimi For Coding | https://api.kimi.com/coding/v1 | `KIMI_API_KEY` | yes |
| meta | Meta | https://api.meta.ai/v1 | `META_API_KEY` | yes |
| minimax | MiniMax | https://api.minimax.io/anthropic | `MINIMAX_API_KEY` | yes |
| minimax-cn | MiniMax CN | https://api.minimaxi.com/anthropic | `MINIMAX_CN_API_KEY` | yes |
| mistral | Mistral | https://api.mistral.ai | `MISTRAL_API_KEY` | yes |
| moonshotai | Moonshot AI | https://api.moonshot.ai/v1 | `MOONSHOT_API_KEY` | yes |
| moonshotai-cn | Moonshot AI CN | https://api.moonshot.cn/v1 | `MOONSHOT_API_KEY` | yes |
| nvidia | NVIDIA | https://integrate.api.nvidia.com/v1 | `NVIDIA_API_KEY` | yes |
| openai | OpenAI | https://api.openai.com/v1 | `OPENAI_API_KEY` | yes |
| openai-codex | OpenAI Codex (legacy) | https://chatgpt.com/backend-api | — (OAuth only) | yes |
| opencode | OpenCode Zen | per model | `OPENCODE_API_KEY` | yes |
| opencode-go | OpenCode Go | per model | `OPENCODE_API_KEY` | yes |
| openrouter | OpenRouter | https://openrouter.ai/api/v1 | `OPENROUTER_API_KEY` | yes |
| qwen-token-plan | Qwen Token Plan | https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1 | `QWEN_TOKEN_PLAN_API_KEY` | yes |
| qwen-token-plan-cn | Qwen Token Plan CN | https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1 | `QWEN_TOKEN_PLAN_CN_API_KEY` | yes |
| qwen-token-plan-individual | Qwen Token Plan Individual | https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1 | `QWEN_TOKEN_PLAN_API_KEY` | yes |
| radius | Radius | per gateway | `RADIUS_API_KEY` | yes |
| together | Together | https://api.together.ai/v1 | `TOGETHER_API_KEY` | yes |
| typesafe | TypeSafe | per model | `TYPESAFE_API_KEY` | yes |
| vercel-ai-gateway | Vercel AI Gateway | https://ai-gateway.vercel.sh | `AI_GATEWAY_API_KEY` | yes |
| xai | xAI | https://api.x.ai/v1 | `XAI_API_KEY` | yes |
| xiaomi | Xiaomi | https://api.xiaomimimo.com/v1 | `XIAOMI_API_KEY` | yes |
| xiaomi-token-plan-ams | Xiaomi Token Plan AMS | https://token-plan-ams.xiaomimimo.com/v1 | `XIAOMI_TOKEN_PLAN_AMS_API_KEY` | yes |
| xiaomi-token-plan-cn | Xiaomi Token Plan CN | https://token-plan-cn.xiaomimimo.com/v1 | `XIAOMI_TOKEN_PLAN_CN_API_KEY` | yes |
| xiaomi-token-plan-sgp | Xiaomi Token Plan SGP | https://token-plan-sgp.xiaomimimo.com/v1 | `XIAOMI_TOKEN_PLAN_SGP_API_KEY` | yes |
| zai | Z.AI | https://api.z.ai/api/coding/paas/v4 | `ZAI_API_KEY` | yes |
| zai-coding-cn | Z.AI Coding CN | https://open.bigmodel.cn/api/coding/paas/v4 | `ZAI_CODING_CN_API_KEY` | yes |

## Wire protocols

The port implements three wire protocols: `anthropic-messages`,
`openai-completions` and `openai-responses`. Every provider whose models use
one of them is usable today, including the per-provider wire details the
original applies:

- **opencode** and **opencode-go** send the `x-opencode-session` header with
  the request's session id.
- **cloudflare-ai-gateway** and **cloudflare-workers-ai** substitute
  `{CLOUDFLARE_ACCOUNT_ID}` and `{CLOUDFLARE_GATEWAY_ID}` in the model's base
  URL from the environment before the request goes out.

Eight providers need a wire protocol this build does not implement yet. They
are published (the catalogue matches) but a request for one of their models
fails with a clear error instead of a panic:

| provider | protocol it needs |
|---|---|
| amazon-bedrock | `bedrock-converse-stream` |
| azure | `azure-openai-responses` |
| google | `google-generative-ai` |
| google-vertex | `google-vertex` |
| mistral | `mistral-conversations` |
| openai-codex | `openai-codex-responses` |
| radius | `pi-messages` |
| typesafe | `typesafe-system-one` (classifier only) |

The error is:

```
error: Provider "mistral" needs the mistral-conversations protocol, which this build does not support.
```

## OAuth

Nine providers offer an OAuth login in pi (Anthropic, GitHub Copilot, Kimi For
Coding, Meta, OpenAI, OpenAI Codex, OpenRouter, Radius, xAI). The port has no
built-in OAuth flow yet: those providers are usable with an API key (or, for
OpenAI Codex, not at all until OAuth lands).
