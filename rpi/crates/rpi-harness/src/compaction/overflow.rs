//! Context-overflow detection — a port of pi's `isContextOverflow`
//! (`packages/ai/src/utils/overflow.ts`).
//!
//! Only the error-text case is ported: the harness reacts to a *failed*
//! assistant message, so pi's silent-overflow case (a successful response whose
//! usage exceeds the context window) and its length-stop case (a truncated
//! response that filled the window) have no counterpart here — both need the
//! model's context window, and neither is an error.
//!
//! The pattern list and the exclusions are pi's, in pi's order: a text that
//! matches an exclusion is not an overflow even when it also matches an
//! overflow pattern (Bedrock's `ThrottlingException: Too many tokens…` is the
//! case that motivated the exclusions).

use std::sync::LazyLock;

use regex::{Regex, RegexBuilder};
use rpi_ai::types::{AssistantMessage, StopReason};

/// Provider-specific overflow texts. Mirrors `OVERFLOW_PATTERNS`
/// (`overflow.ts:37-63`).
const OVERFLOW_PATTERNS: &[&str] = &[
    r"prompt (?:is )?too long",
    r"prompt exceeds max length",
    r"request_too_large",
    r"input is too long for requested model",
    r"exceeds the context window",
    r"exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))",
    r"input token count.*exceeds the maximum",
    r"maximum prompt length is \d+",
    r"reduce the length of the messages",
    r"maximum context length is \d+ tokens",
    r"exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?",
    r"input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)",
    r"exceeds the limit of \d+",
    r"exceeds the available context size",
    r"greater than the context length",
    r"context window exceeds limit",
    r"exceeded model token limit",
    r"too large for model with \d+ maximum context length",
    r"prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?",
    r"model_context_window_exceeded",
    r"prompt too long; exceeded (?:max )?context length",
    r"range of input length should be",
    r"context[_ ]length[_ ]exceeded",
    r"too many tokens",
    r"token limit exceeded",
];

/// Texts that are not overflows even when they match an overflow pattern.
/// Mirrors `NON_OVERFLOW_PATTERNS` (`overflow.ts:69-74`).
const NON_OVERFLOW_PATTERNS: &[&str] = &[
    r"^(Throttling error|Service unavailable):",
    r"rate limit",
    r"too many requests",
];

/// Cerebras reports an overflow as a bodyless 400/413. Mirrors
/// `CEREBRAS_BODYLESS_OVERFLOW_PATTERN` (`overflow.ts:65`).
const CEREBRAS_BODYLESS_OVERFLOW_PATTERN: &str = r"^4(?:00|13)\s*(?:status code)?\s*\(no body\)";

/// Compile one case-insensitive pattern list.
fn compile(patterns: &[&str]) -> Vec<Regex> {
    patterns
        .iter()
        .map(|pattern| {
            RegexBuilder::new(pattern)
                .case_insensitive(true)
                .build()
                .unwrap_or_else(|error| panic!("overflow pattern must compile: {error}"))
        })
        .collect()
}

/// The overflow patterns, compiled once.
static OVERFLOW_PATTERN_LIST: LazyLock<Vec<Regex>> = LazyLock::new(|| compile(OVERFLOW_PATTERNS));

/// The exclusion patterns, compiled once.
static NON_OVERFLOW_PATTERN_LIST: LazyLock<Vec<Regex>> =
    LazyLock::new(|| compile(NON_OVERFLOW_PATTERNS));

/// The Cerebras bodyless-overflow pattern, compiled once.
static CEREBRAS_BODYLESS_OVERFLOW: LazyLock<Regex> = LazyLock::new(|| {
    RegexBuilder::new(CEREBRAS_BODYLESS_OVERFLOW_PATTERN)
        .case_insensitive(true)
        .build()
        .expect("cerebras bodyless overflow pattern compiles")
});

/// Whether a failed assistant message reports a context overflow.
///
/// Mirrors `isContextOverflow` (`overflow.ts:137`): only an error message with
/// an error text can be an overflow, the exclusions win, and the Cerebras
/// bodyless status is an overflow only for that provider.
pub fn is_context_overflow(message: &AssistantMessage) -> bool {
    if message.stop_reason != StopReason::Error {
        return false;
    }
    let Some(error_message) = message.error_message.as_deref() else {
        return false;
    };
    if error_message.is_empty() {
        return false;
    }
    if NON_OVERFLOW_PATTERN_LIST
        .iter()
        .any(|pattern| pattern.is_match(error_message))
    {
        return false;
    }
    if OVERFLOW_PATTERN_LIST
        .iter()
        .any(|pattern| pattern.is_match(error_message))
    {
        return true;
    }
    message.provider == "cerebras" && CEREBRAS_BODYLESS_OVERFLOW.is_match(error_message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rpi_ai::types::Api;

    fn error_message(text: &str) -> AssistantMessage {
        let mut message = AssistantMessage::empty(Api::Faux, "faux", "faux-1", 0);
        message.stop_reason = StopReason::Error;
        message.error_message = Some(text.to_string());
        message
    }

    #[test]
    fn provider_overflow_texts_are_detected() {
        for text in [
            "prompt is too long: 213462 tokens > 200000 maximum",
            "Prompt too long",
            "Your input exceeds the context window of this model",
            "Requested token count exceeds the model's maximum context length of 131072 tokens",
            "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)",
            "context length exceeded",
        ] {
            assert!(
                is_context_overflow(&error_message(text)),
                "{text} must be an overflow"
            );
        }
    }

    #[test]
    fn throttling_and_rate_limits_are_not_overflows() {
        for text in [
            "Throttling error: Too many tokens, please wait before trying again.",
            "Service unavailable: The service is temporarily unavailable.",
            "Rate limit exceeded, please retry after 30 seconds.",
            "Too many requests. Please slow down.",
        ] {
            assert!(
                !is_context_overflow(&error_message(text)),
                "{text} must not be an overflow"
            );
        }
    }

    #[test]
    fn a_generic_provider_error_is_not_an_overflow() {
        assert!(!is_context_overflow(&error_message(
            "500 `model runner crashed unexpectedly`"
        )));
    }

    #[test]
    fn a_bodyless_400_is_an_overflow_only_for_cerebras() {
        let mut message = error_message("400 status code (no body)");
        assert!(!is_context_overflow(&message));
        message.provider = "cerebras".to_string();
        assert!(is_context_overflow(&message));
    }
}
