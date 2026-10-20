//! Built-in provider and model catalogue parity.
//!
//! The counts and identities here mirror pi's generated catalog
//! (`packages/ai/src/providers/data/*.json`): 42 providers and 1621 chat models.

use rpi_ai::providers::catalog::{
    builtin_models, builtin_models_for, builtin_provider, builtin_providers, catalog_generated_at,
};

const PROVIDER_COUNT: usize = 42;
const CHAT_MODEL_COUNT: usize = 1621;

#[test]
fn publishes_every_provider_pi_publishes() {
    let ids: Vec<&str> = builtin_providers()
        .iter()
        .map(|provider| provider.id)
        .collect();
    assert_eq!(ids.len(), PROVIDER_COUNT);
    for expected in [
        "amazon-bedrock",
        "ant-ling",
        "anthropic",
        "azure",
        "baseten",
        "cerebras",
        "cloudflare-ai-gateway",
        "cloudflare-workers-ai",
        "deepseek",
        "fireworks",
        "github-copilot",
        "google",
        "google-vertex",
        "groq",
        "huggingface",
        "kimi-coding",
        "meta",
        "minimax",
        "minimax-cn",
        "mistral",
        "moonshotai",
        "moonshotai-cn",
        "nvidia",
        "openai",
        "openai-codex",
        "opencode",
        "opencode-go",
        "openrouter",
        "qwen-token-plan",
        "qwen-token-plan-cn",
        "qwen-token-plan-individual",
        "radius",
        "together",
        "typesafe",
        "vercel-ai-gateway",
        "xai",
        "xiaomi",
        "xiaomi-token-plan-ams",
        "xiaomi-token-plan-cn",
        "xiaomi-token-plan-sgp",
        "zai",
        "zai-coding-cn",
    ] {
        assert!(ids.contains(&expected), "missing provider {expected}");
    }
}

#[test]
fn provider_names_and_endpoints_match_pi() {
    let anthropic = builtin_provider("anthropic").expect("anthropic is published");
    assert_eq!(anthropic.name, "Anthropic");
    assert_eq!(anthropic.base_url, Some("https://api.anthropic.com"));
    assert_eq!(anthropic.api_key_env, Some("ANTHROPIC_API_KEY"));
    assert_eq!(anthropic.apis, ["anthropic-messages"]);

    let groq = builtin_provider("groq").expect("groq is published");
    assert_eq!(groq.name, "Groq");
    assert_eq!(groq.base_url, Some("https://api.groq.com/openai/v1"));
    assert_eq!(groq.api_key_env, Some("GROQ_API_KEY"));

    let openrouter = builtin_provider("openrouter").expect("openrouter is published");
    assert_eq!(openrouter.name, "OpenRouter");
    assert_eq!(openrouter.base_url, Some("https://openrouter.ai/api/v1"));

    assert_eq!(builtin_provider("nope"), None);
}

#[test]
fn every_provider_with_an_api_key_has_one_env_var() {
    let with_env = builtin_providers()
        .iter()
        .filter(|provider| provider.api_key_env.is_some())
        .count();
    assert_eq!(with_env, 40);
    assert_eq!(
        builtin_provider("amazon-bedrock")
            .expect("amazon-bedrock is published")
            .api_key_env,
        None
    );
    assert_eq!(
        builtin_provider("openai-codex")
            .expect("openai-codex is published")
            .api_key_env,
        None
    );
}

#[test]
fn publishes_pi_model_counts() {
    assert_eq!(builtin_models().len(), CHAT_MODEL_COUNT);
}

#[test]
fn every_provider_lists_models() {
    for provider in builtin_providers() {
        let models = builtin_models_for(provider.id);
        assert!(
            !models.is_empty() || provider.id == "typesafe",
            "{} lists no chat models",
            provider.id
        );
        assert!(models.iter().all(|model| model.provider == provider.id));
    }
}

#[test]
fn model_entry_carries_pi_fields() {
    let models = builtin_models_for("anthropic");
    let opus = models
        .iter()
        .find(|model| model.id == "claude-opus-4-8")
        .expect("anthropic ships claude-opus-4-8");
    assert_eq!(opus.name, "Claude Opus 4.8");
    assert_eq!(opus.api.as_str(), "anthropic-messages");
    assert_eq!(opus.base_url, "https://api.anthropic.com");
    assert!(opus.reasoning);
    assert_eq!(opus.context_window, 1_000_000);
    assert!(opus.max_tokens > 0);
    assert!(opus.has_pricing());
    assert!(opus
        .supported_thinking_levels()
        .contains(&rpi_ai::ThinkingLevel::High));
}

#[test]
fn openai_completions_models_carry_compat_flags() {
    let models = builtin_models_for("groq");
    let llama = models
        .iter()
        .find(|model| model.id == "llama-3.1-8b-instant")
        .expect("groq ships llama-3.1-8b-instant");
    assert_eq!(llama.name, "Llama 3.1 8B");
    assert_eq!(llama.api.as_str(), "openai-completions");
    assert_eq!(llama.base_url, "https://api.groq.com/openai/v1");
    assert_eq!(llama.context_window, 131_072);
    assert_eq!(llama.max_tokens, 131_072);
    assert!(!llama.reasoning);
    match llama.compat.as_ref() {
        Some(rpi_ai::StreamingProtocolCompat::OpenaiCompletions(compat)) => {
            assert_eq!(compat.supports_strict_mode, Some(true));
        }
        other => panic!("expected openai-completions compat, got {other:?}"),
    }
}

#[test]
fn cost_tiers_survive_the_port() {
    let models = builtin_models_for("anthropic");
    let with_tiers = models
        .iter()
        .find(|model| !model.cost.tiers.is_empty())
        .expect("some anthropic model carries cost tiers");
    assert!(with_tiers.cost.tiers[0].input_tokens_above > 0);
}

#[test]
fn generated_at_is_available_for_the_remote_overlay() {
    assert!(catalog_generated_at().is_some());
}
