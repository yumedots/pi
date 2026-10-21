//! Built-in provider manifests and the shipped model catalogue.
//!
//! Mirrors `packages/ai/src/providers/all.ts` (the provider/catalog accessors)
//! and `packages/ai/src/providers/data/*.json` (the generated snapshot that
//! `packages/ai/scripts/generate-models.ts` writes from models.dev and the
//! OpenRouter API).
//!
//! The snapshot ships with the crate, exactly as pi ships it next to its
//! providers. Runtime refreshes come from `pi.dev` and layer on top of this
//! baseline.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use serde::Deserialize;

use crate::model::{
    AnthropicMessagesCompat, BedrockCompat, Model, OpenaiCompletionsCompat, OpenaiResponsesCompat,
    StreamingProtocolCompat,
};
use crate::types::{Api, InputModality, ModelCost, ThinkingLevelMap};

// ---------------------------------------------------------------------------
// Provider manifests
// ---------------------------------------------------------------------------

/// A built-in provider's identity, endpoint and credential source.
///
/// Mirrors the fields of pi's `createProvider({ id, name, baseUrl, auth, api })`
/// calls in `packages/ai/src/providers/*.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuiltinProvider {
    /// The provider id used for routing, credentials and `provider/model` selection.
    pub id: &'static str,
    /// The display name pi shows for the provider.
    pub name: &'static str,
    /// The provider-level default endpoint. `None` when every model carries its own.
    pub base_url: Option<&'static str>,
    /// The wire protocols the provider serves.
    pub apis: &'static [&'static str],
    /// The environment variable holding the provider's API key.
    pub api_key_env: Option<&'static str>,
    /// Whether the provider also offers an OAuth login.
    pub oauth: bool,
}

/// Every built-in provider, in the order pi publishes them.
pub const BUILTIN_PROVIDERS: &[BuiltinProvider] = &[
    BuiltinProvider {
        id: "amazon-bedrock",
        name: "Amazon Bedrock",
        base_url: None,
        apis: &["bedrock-converse-stream"],
        api_key_env: None,
        oauth: false,
    },
    BuiltinProvider {
        id: "ant-ling",
        name: "Ant Ling",
        base_url: Some("https://api.ant-ling.com/v1"),
        apis: &["openai-completions"],
        api_key_env: Some("ANT_LING_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "anthropic",
        name: "Anthropic",
        base_url: Some("https://api.anthropic.com"),
        apis: &["anthropic-messages"],
        api_key_env: Some("ANTHROPIC_API_KEY"),
        oauth: true,
    },
    BuiltinProvider {
        id: "azure",
        name: "Azure",
        base_url: None,
        apis: &["azure-openai-responses", "openai-completions"],
        api_key_env: Some("AZURE_OPENAI_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "baseten",
        name: "Baseten",
        base_url: Some("https://inference.baseten.co/v1"),
        apis: &["openai-completions"],
        api_key_env: Some("BASETEN_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "cerebras",
        name: "Cerebras",
        base_url: Some("https://api.cerebras.ai/v1"),
        apis: &["openai-completions"],
        api_key_env: Some("CEREBRAS_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "cloudflare-ai-gateway",
        name: "Cloudflare AI Gateway",
        base_url: None,
        apis: &["anthropic-messages", "openai-completions", "openai-responses"],
        api_key_env: Some("CLOUDFLARE_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "cloudflare-workers-ai",
        name: "Cloudflare Workers AI",
        base_url: None,
        apis: &["openai-completions", "cloudflare-workers-ai-system-one"],
        api_key_env: Some("CLOUDFLARE_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "deepseek",
        name: "DeepSeek",
        base_url: Some("https://api.deepseek.com"),
        apis: &["openai-completions"],
        api_key_env: Some("DEEPSEEK_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "fireworks",
        name: "Fireworks",
        base_url: Some("https://api.fireworks.ai/inference"),
        apis: &["anthropic-messages", "openai-completions"],
        api_key_env: Some("FIREWORKS_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "github-copilot",
        name: "GitHub Copilot",
        base_url: Some("https://api.individual.githubcopilot.com"),
        apis: &["anthropic-messages", "openai-completions", "openai-responses"],
        api_key_env: Some("COPILOT_GITHUB_TOKEN"),
        oauth: true,
    },
    BuiltinProvider {
        id: "google",
        name: "Google",
        base_url: Some("https://generativelanguage.googleapis.com/v1beta"),
        apis: &["google-generative-ai"],
        api_key_env: Some("GEMINI_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "google-vertex",
        name: "Google Vertex AI",
        base_url: None,
        apis: &["google-vertex"],
        api_key_env: Some("GOOGLE_CLOUD_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "groq",
        name: "Groq",
        base_url: Some("https://api.groq.com/openai/v1"),
        apis: &["openai-completions"],
        api_key_env: Some("GROQ_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "huggingface",
        name: "Hugging Face",
        base_url: Some("https://router.huggingface.co/v1"),
        apis: &["openai-completions"],
        api_key_env: Some("HF_TOKEN"),
        oauth: false,
    },
    BuiltinProvider {
        id: "kimi-coding",
        name: "Kimi For Coding",
        base_url: Some("https://api.kimi.com/coding/v1"),
        apis: &["openai-completions"],
        api_key_env: Some("KIMI_API_KEY"),
        oauth: true,
    },
    BuiltinProvider {
        id: "meta",
        name: "Meta",
        base_url: Some("https://api.meta.ai/v1"),
        apis: &["openai-responses"],
        api_key_env: Some("META_API_KEY"),
        oauth: true,
    },
    BuiltinProvider {
        id: "minimax",
        name: "MiniMax",
        base_url: Some("https://api.minimax.io/anthropic"),
        apis: &["anthropic-messages"],
        api_key_env: Some("MINIMAX_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "minimax-cn",
        name: "MiniMax CN",
        base_url: Some("https://api.minimaxi.com/anthropic"),
        apis: &["anthropic-messages"],
        api_key_env: Some("MINIMAX_CN_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "mistral",
        name: "Mistral",
        base_url: Some("https://api.mistral.ai"),
        apis: &["mistral-conversations"],
        api_key_env: Some("MISTRAL_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "moonshotai",
        name: "Moonshot AI",
        base_url: Some("https://api.moonshot.ai/v1"),
        apis: &["openai-completions"],
        api_key_env: Some("MOONSHOT_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "moonshotai-cn",
        name: "Moonshot AI CN",
        base_url: Some("https://api.moonshot.cn/v1"),
        apis: &["openai-completions"],
        api_key_env: Some("MOONSHOT_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "nvidia",
        name: "NVIDIA",
        base_url: Some("https://integrate.api.nvidia.com/v1"),
        apis: &["openai-completions"],
        api_key_env: Some("NVIDIA_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "openai",
        name: "OpenAI",
        base_url: Some("https://api.openai.com/v1"),
        apis: &["openai-responses"],
        api_key_env: Some("OPENAI_API_KEY"),
        oauth: true,
    },
    BuiltinProvider {
        id: "openai-codex",
        name: "OpenAI Codex (legacy)",
        base_url: Some("https://chatgpt.com/backend-api"),
        apis: &["openai-codex-responses"],
        api_key_env: None,
        oauth: true,
    },
    BuiltinProvider {
        id: "opencode",
        name: "OpenCode Zen",
        base_url: None,
        apis: &[
            "anthropic-messages",
            "google-generative-ai",
            "openai-completions",
            "openai-responses",
        ],
        api_key_env: Some("OPENCODE_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "opencode-go",
        name: "OpenCode Go",
        base_url: None,
        apis: &[
            "anthropic-messages",
            "google-generative-ai",
            "openai-completions",
            "openai-responses",
        ],
        api_key_env: Some("OPENCODE_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "openrouter",
        name: "OpenRouter",
        base_url: Some("https://openrouter.ai/api/v1"),
        apis: &["anthropic-messages", "openai-completions", "openrouter-images"],
        api_key_env: Some("OPENROUTER_API_KEY"),
        oauth: true,
    },
    BuiltinProvider {
        id: "qwen-token-plan",
        name: "Qwen Token Plan",
        base_url: Some("https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"),
        apis: &["openai-completions"],
        api_key_env: Some("QWEN_TOKEN_PLAN_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "qwen-token-plan-cn",
        name: "Qwen Token Plan CN",
        base_url: Some("https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"),
        apis: &["openai-completions"],
        api_key_env: Some("QWEN_TOKEN_PLAN_CN_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "qwen-token-plan-individual",
        name: "Qwen Token Plan Individual",
        base_url: Some("https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"),
        apis: &["openai-completions"],
        api_key_env: Some("QWEN_TOKEN_PLAN_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "radius",
        name: "Radius",
        base_url: None,
        apis: &["pi-messages"],
        api_key_env: Some("RADIUS_API_KEY"),
        oauth: true,
    },
    BuiltinProvider {
        id: "together",
        name: "Together",
        base_url: Some("https://api.together.ai/v1"),
        apis: &["openai-completions"],
        api_key_env: Some("TOGETHER_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "typesafe",
        name: "TypeSafe",
        base_url: None,
        apis: &["typesafe-system-one"],
        api_key_env: Some("TYPESAFE_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "vercel-ai-gateway",
        name: "Vercel AI Gateway",
        base_url: Some("https://ai-gateway.vercel.sh"),
        apis: &["anthropic-messages", "typesafe-system-one"],
        api_key_env: Some("AI_GATEWAY_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "xai",
        name: "xAI",
        base_url: Some("https://api.x.ai/v1"),
        apis: &["openai-responses"],
        api_key_env: Some("XAI_API_KEY"),
        oauth: true,
    },
    BuiltinProvider {
        id: "xiaomi",
        name: "Xiaomi",
        base_url: Some("https://api.xiaomimimo.com/v1"),
        apis: &["openai-completions"],
        api_key_env: Some("XIAOMI_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "xiaomi-token-plan-ams",
        name: "Xiaomi Token Plan AMS",
        base_url: Some("https://token-plan-ams.xiaomimimo.com/v1"),
        apis: &["openai-completions"],
        api_key_env: Some("XIAOMI_TOKEN_PLAN_AMS_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "xiaomi-token-plan-cn",
        name: "Xiaomi Token Plan CN",
        base_url: Some("https://token-plan-cn.xiaomimimo.com/v1"),
        apis: &["openai-completions"],
        api_key_env: Some("XIAOMI_TOKEN_PLAN_CN_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "xiaomi-token-plan-sgp",
        name: "Xiaomi Token Plan SGP",
        base_url: Some("https://token-plan-sgp.xiaomimimo.com/v1"),
        apis: &["openai-completions"],
        api_key_env: Some("XIAOMI_TOKEN_PLAN_SGP_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "zai",
        name: "Z.AI",
        base_url: Some("https://api.z.ai/api/coding/paas/v4"),
        apis: &["openai-completions"],
        api_key_env: Some("ZAI_API_KEY"),
        oauth: false,
    },
    BuiltinProvider {
        id: "zai-coding-cn",
        name: "Z.AI Coding CN",
        base_url: Some("https://open.bigmodel.cn/api/coding/paas/v4"),
        apis: &["openai-completions"],
        api_key_env: Some("ZAI_CODING_CN_API_KEY"),
        oauth: false,
    },
];

/// Every built-in provider, in the order pi publishes them.
pub fn builtin_providers() -> &'static [BuiltinProvider] {
    BUILTIN_PROVIDERS
}

/// Look up one built-in provider by id.
pub fn builtin_provider(id: &str) -> Option<&'static BuiltinProvider> {
    BUILTIN_PROVIDERS.iter().find(|provider| provider.id == id)
}

/// The default model of every provider that has one, in pi's declaration order.
///
/// Mirrors the TS `defaultModelPerProvider` table in
/// `packages/coding-agent/src/core/model-resolver.ts`.
pub const DEFAULT_MODEL_PER_PROVIDER: &[(&str, &str)] = &[
    ("amazon-bedrock", "us.anthropic.claude-opus-4-6-v1"),
    ("ant-ling", "Ring-2.6-1T"),
    ("anthropic", "claude-opus-4-8"),
    ("openai", "gpt-5.5"),
    ("azure", "gpt-5.4"),
    ("openai-codex", "gpt-6.1-sol"),
    ("radius", "balanced"),
    ("nvidia", "nvidia/nemotron-3.5-super-vl-120b-a12b"),
    ("deepseek", "deepseek-v4-pro"),
    ("google", "gemini-3.1-pro-preview"),
    ("google-vertex", "gemini-3.1-pro-preview"),
    ("github-copilot", "gpt-5.4"),
    ("openrouter", "moonshotai/kimi-k2.6"),
    ("vercel-ai-gateway", "zai/glm-5.1"),
    ("xai", "grok-4.7"),
    ("groq", "openai/gpt-oss-120b"),
    ("cerebras", "gpt-oss-120b"),
    ("zai", "glm-5.3"),
    ("zai-coding-cn", "glm-5.3"),
    ("mistral", "devstral-medium-latest"),
    ("minimax", "minimax-M2.7"),
    ("minimax-cn", "minimax-M2.7"),
    ("moonshotai", "kimi-k2.6"),
    ("moonshotai-cn", "kimi-k2.6"),
    ("huggingface", "moonshotai/Kimi-K2.6"),
    ("fireworks", "accounts/fireworks/models/kimi-k3"),
    ("together", "moonshotai/Kimi-K3"),
    ("baseten", "zai-org/GLM-5.2"),
    ("opencode", "kimi-k2.6"),
    ("opencode-go", "kimi-k3"),
    ("kimi-coding", "kimi-for-coding"),
    ("meta", "muse-spark-1.3"),
    ("cloudflare-workers-ai", "@cf/moonshotai/kimi-k2.6"),
    ("cloudflare-ai-gateway", "workers-ai/@cf/moonshotai/kimi-k2.6"),
    ("qwen-token-plan", "qwen3.7-max"),
    ("qwen-token-plan-cn", "qwen3.7-max"),
    ("qwen-token-plan-individual", "qwen3.8-max"),
    ("xiaomi", "mimo-v2.6-pro"),
    ("xiaomi-token-plan-cn", "mimo-v2.6-pro"),
    ("xiaomi-token-plan-ams", "mimo-v2.6-pro"),
    ("xiaomi-token-plan-sgp", "mimo-v2.6-pro"),
];

/// The default model of one provider.
pub fn default_model_for(provider_id: &str) -> Option<&'static str> {
    DEFAULT_MODEL_PER_PROVIDER
        .iter()
        .find(|(provider, _)| *provider == provider_id)
        .map(|(_, model)| *model)
}

// ---------------------------------------------------------------------------
// Model catalogue
// ---------------------------------------------------------------------------

/// The embedded per-provider catalog snapshots.
///
/// Copied verbatim from `packages/ai/src/providers/data/*.json`; the generator
/// is `packages/ai/scripts/generate-models.ts`.
const CATALOG_FILES: &[(&str, &str)] = &[
    (
        "amazon-bedrock",
        include_str!("catalog/data/amazon-bedrock.json"),
    ),
    ("ant-ling", include_str!("catalog/data/ant-ling.json")),
    ("anthropic", include_str!("catalog/data/anthropic.json")),
    ("azure", include_str!("catalog/data/azure.json")),
    ("baseten", include_str!("catalog/data/baseten.json")),
    ("cerebras", include_str!("catalog/data/cerebras.json")),
    (
        "cloudflare-ai-gateway",
        include_str!("catalog/data/cloudflare-ai-gateway.json"),
    ),
    (
        "cloudflare-workers-ai",
        include_str!("catalog/data/cloudflare-workers-ai.json"),
    ),
    ("deepseek", include_str!("catalog/data/deepseek.json")),
    ("fireworks", include_str!("catalog/data/fireworks.json")),
    (
        "github-copilot",
        include_str!("catalog/data/github-copilot.json"),
    ),
    ("google", include_str!("catalog/data/google.json")),
    ("google-vertex", include_str!("catalog/data/google-vertex.json")),
    ("groq", include_str!("catalog/data/groq.json")),
    ("huggingface", include_str!("catalog/data/huggingface.json")),
    ("kimi-coding", include_str!("catalog/data/kimi-coding.json")),
    ("meta", include_str!("catalog/data/meta.json")),
    ("minimax", include_str!("catalog/data/minimax.json")),
    ("minimax-cn", include_str!("catalog/data/minimax-cn.json")),
    ("mistral", include_str!("catalog/data/mistral.json")),
    ("moonshotai", include_str!("catalog/data/moonshotai.json")),
    ("moonshotai-cn", include_str!("catalog/data/moonshotai-cn.json")),
    ("nvidia", include_str!("catalog/data/nvidia.json")),
    ("openai", include_str!("catalog/data/openai.json")),
    ("openai-codex", include_str!("catalog/data/openai-codex.json")),
    ("opencode", include_str!("catalog/data/opencode.json")),
    ("opencode-go", include_str!("catalog/data/opencode-go.json")),
    ("openrouter", include_str!("catalog/data/openrouter.json")),
    (
        "qwen-token-plan",
        include_str!("catalog/data/qwen-token-plan.json"),
    ),
    (
        "qwen-token-plan-cn",
        include_str!("catalog/data/qwen-token-plan-cn.json"),
    ),
    (
        "qwen-token-plan-individual",
        include_str!("catalog/data/qwen-token-plan-individual.json"),
    ),
    ("radius", include_str!("catalog/data/radius.json")),
    ("together", include_str!("catalog/data/together.json")),
    ("typesafe", include_str!("catalog/data/typesafe.json")),
    (
        "vercel-ai-gateway",
        include_str!("catalog/data/vercel-ai-gateway.json"),
    ),
    ("xai", include_str!("catalog/data/xai.json")),
    ("xiaomi", include_str!("catalog/data/xiaomi.json")),
    (
        "xiaomi-token-plan-ams",
        include_str!("catalog/data/xiaomi-token-plan-ams.json"),
    ),
    (
        "xiaomi-token-plan-cn",
        include_str!("catalog/data/xiaomi-token-plan-cn.json"),
    ),
    (
        "xiaomi-token-plan-sgp",
        include_str!("catalog/data/xiaomi-token-plan-sgp.json"),
    ),
    ("zai", include_str!("catalog/data/zai.json")),
    ("zai-coding-cn", include_str!("catalog/data/zai-coding-cn.json")),
];

/// The manifest that records when the embedded snapshot was generated.
const CATALOG_MANIFEST: &str = include_str!("catalog/data/manifest.json");

/// Every built-in chat model, across every built-in provider.
pub fn builtin_models() -> &'static [Model] {
    static CATALOG: LazyLock<Vec<Model>> = LazyLock::new(build_catalog);
    &CATALOG
}

/// The built-in chat models of one provider.
pub fn builtin_models_for(provider_id: &str) -> Vec<Model> {
    builtin_models()
        .iter()
        .filter(|model| model.provider == provider_id)
        .cloned()
        .collect()
}

/// The built-in chat models of one provider that use one wire protocol.
pub fn builtin_models_for_api(provider_id: &str, api: &Api) -> Vec<Model> {
    builtin_models()
        .iter()
        .filter(|model| model.provider == provider_id && model.api == *api)
        .cloned()
        .collect()
}

/// When the embedded snapshot was generated, in epoch milliseconds.
///
/// Mirrors pi's `getBuiltinModelDataGeneratedAt()`. The remote-catalog overlay
/// uses it to decide whether a `pi.dev` catalog is newer than the shipped one.
pub fn catalog_generated_at() -> Option<i64> {
    static GENERATED_AT: LazyLock<Option<i64>> = LazyLock::new(|| {
        let manifest: serde_json::Value =
            serde_json::from_str(CATALOG_MANIFEST).expect("built-in catalog manifest is valid JSON");
        manifest
            .get("generatedAt")
            .and_then(|value| value.as_str())
            .and_then(parse_iso8601_millis)
    });
    *GENERATED_AT
}

/// Parse `YYYY-MM-DDTHH:MM:SS.sssZ` into epoch milliseconds.
fn parse_iso8601_millis(value: &str) -> Option<i64> {
    if value.len() < 19 {
        return None;
    }
    let year: i64 = value.get(0..4)?.parse().ok()?;
    let month: i64 = value.get(5..7)?.parse().ok()?;
    let day: i64 = value.get(8..10)?.parse().ok()?;
    let hour: i64 = value.get(11..13)?.parse().ok()?;
    let minute: i64 = value.get(14..16)?.parse().ok()?;
    let second: i64 = value.get(17..19)?.parse().ok()?;
    let millis: i64 = value
        .get(20..23)
        .and_then(|part| part.parse().ok())
        .unwrap_or(0);
    let seconds = days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second;
    Some(seconds * 1_000 + millis)
}

/// Days since 1970-01-01 for a proleptic Gregorian date.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let shifted = if month <= 2 { year - 1 } else { year };
    let era = if shifted >= 0 { shifted } else { shifted - 399 } / 400;
    let year_of_era = shifted - era * 400;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/// One raw catalog entry, as stored in `catalog/data/*.json`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawEntry {
    id: String,
    name: String,
    api: String,
    provider: String,
    base_url: String,
    #[serde(default)]
    reasoning: bool,
    input: Vec<InputModality>,
    cost: ModelCost,
    #[serde(default)]
    context_window: Option<u64>,
    #[serde(default)]
    max_tokens: Option<u64>,
    #[serde(default)]
    thinking_level_map: Option<ThinkingLevelMap>,
    #[serde(default)]
    headers: Option<BTreeMap<String, String>>,
    #[serde(default, rename = "type")]
    model_type: Option<String>,
    #[serde(default)]
    compat: Option<serde_json::Value>,
}

fn build_catalog() -> Vec<Model> {
    let mut models = Vec::new();
    for (provider_id, raw) in CATALOG_FILES {
        let groups: BTreeMap<String, BTreeMap<String, RawEntry>> =
            serde_json::from_str(raw).unwrap_or_else(|error| {
                panic!("built-in model catalog for {provider_id} is invalid JSON: {error}")
            });
        for entries in groups.values() {
            for entry in entries.values() {
                if entry.model_type.as_deref().unwrap_or("chat") != "chat" {
                    continue;
                }
                models.push(Model {
                    id: entry.id.clone(),
                    name: entry.name.clone(),
                    api: Api::from_id(&entry.api),
                    provider: entry.provider.clone(),
                    base_url: entry.base_url.clone(),
                    reasoning: entry.reasoning,
                    thinking_level_map: entry.thinking_level_map.clone(),
                    input: entry.input.clone(),
                    cost: entry.cost.clone(),
                    cost_configured: true,
                    context_window: entry.context_window.unwrap_or(0),
                    max_tokens: entry.max_tokens.unwrap_or(0),
                    sampling_params: None,
                    headers: entry.headers.clone(),
                    compat: entry
                        .compat
                        .clone()
                        .map(|value| compat_for(&entry.api, value)),
                });
            }
        }
    }
    models
}

/// Decode a compat blob into the variant its API uses. Unmodelled APIs keep
/// the raw blob so no catalogue data is lost.
fn compat_for(api: &str, value: serde_json::Value) -> StreamingProtocolCompat {
    let decoded = match api {
        "anthropic-messages" => serde_json::from_value::<AnthropicMessagesCompat>(value.clone())
            .ok()
            .map(StreamingProtocolCompat::AnthropicMessages),
        "openai-completions" => serde_json::from_value::<OpenaiCompletionsCompat>(value.clone())
            .ok()
            .map(StreamingProtocolCompat::OpenaiCompletions),
        "openai-responses" | "azure-openai-responses" | "openai-codex-responses" => {
            serde_json::from_value::<OpenaiResponsesCompat>(value.clone())
                .ok()
                .map(StreamingProtocolCompat::OpenaiResponses)
        }
        "bedrock-converse-stream" => serde_json::from_value::<BedrockCompat>(value.clone())
            .ok()
            .map(StreamingProtocolCompat::Bedrock),
        _ => None,
    };
    decoded.unwrap_or(StreamingProtocolCompat::Other(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_provider_has_a_catalog_snapshot() {
        for provider in builtin_providers() {
            assert!(
                CATALOG_FILES.iter().any(|(id, _)| *id == provider.id),
                "{} has no catalog snapshot",
                provider.id
            );
        }
        assert_eq!(builtin_providers().len(), CATALOG_FILES.len());
    }

    #[test]
    fn catalog_entries_belong_to_their_provider() {
        for (provider_id, raw) in CATALOG_FILES {
            let groups: BTreeMap<String, BTreeMap<String, RawEntry>> =
                serde_json::from_str(raw).expect("valid catalog JSON");
            for entries in groups.values() {
                for entry in entries.values() {
                    assert_eq!(&entry.provider, provider_id);
                }
            }
        }
    }

    #[test]
    fn generated_at_parses() {
        assert!(catalog_generated_at().is_some());
    }
}
