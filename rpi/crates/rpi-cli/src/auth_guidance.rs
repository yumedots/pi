//! Auth guidance strings.
//!
//! Port of the upstream `packages/coding-agent/src/core/auth-guidance.ts`.
//! These produce the user-facing "you have no model / no key — here's how to fix
//! it" messages so every entry point (startup, `/model`, provider resolution)
//! says the same thing.

/// Where the login help points. The documentation lives in a directory next
/// to the installed binary; the source tree keeps it under `docs`.
const DOCS_DIR: &str = "docs";

/// The documentation directory the login help points at.
///
/// The installed binary keeps the docs next to it; the source tree keeps them
/// under `rpi/docs`. The path in the message must exist on the machine, so it
/// is resolved at runtime and the source-tree path is the fallback.
fn docs_dir() -> std::path::PathBuf {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(DOCS_DIR));
            candidates.push(dir.join("..").join(DOCS_DIR));
            candidates.push(dir.join("..").join("..").join(DOCS_DIR));
            candidates.push(dir.join("..").join("..").join("rpi").join(DOCS_DIR));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join(DOCS_DIR));
    }
    let found = candidates
        .iter()
        .find(|dir| dir.join("providers.md").is_file())
        .cloned();
    let dir = found.unwrap_or_else(|| std::path::PathBuf::from(DOCS_DIR));
    // The message names an absolute path, like pi's `getDocsPath()`.
    let dir = if dir.is_absolute() {
        dir
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(&dir))
            .unwrap_or(dir)
    };
    // A clean path: no `..` segments, no symlink hops.
    std::fs::canonicalize(&dir).unwrap_or(dir)
}

pub fn provider_login_help() -> String {
    let dir = docs_dir();
    [
        "Use /login to log into a provider via OAuth or API key. See:".to_string(),
        format!("  {}", dir.join("providers.md").display()),
        format!("  {}", dir.join("models.md").display()),
    ]
    .join("\n")
}

/// Native `formatNoModelsAvailableMessage`.
pub fn no_models_available_message() -> String {
    format!("No models available. {}", provider_login_help())
}

/// Native `formatNoModelSelectedMessage`.
pub fn no_model_selected_message() -> String {
    format!(
        "No model selected.\n\n{}\n\nThen use /model to select a model.",
        provider_login_help()
    )
}

/// Native `formatNoApiKeyFoundMessage`.
pub fn no_api_key_found_message(provider: &str) -> String {
    let display = if provider.is_empty() || provider == "unknown" {
        "the selected model".to_string()
    } else {
        provider.to_string()
    };
    format!(
        "No API key found for {display}.\n\n{}",
        provider_login_help()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_mention_login() {
        assert!(no_models_available_message().contains("/login"));
        assert!(no_model_selected_message().contains("/model"));
        assert!(no_api_key_found_message("anthropic").contains("anthropic"));
        assert!(no_api_key_found_message("").contains("the selected model"));
    }
}
