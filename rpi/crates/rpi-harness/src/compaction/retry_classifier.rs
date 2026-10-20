//! The retryability classifier — a faithful port of pi's two regex tables in
//! `packages/ai/src/utils/retry.ts`: `NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN`
//! (`:7-29`) and `RETRYABLE_PROVIDER_ERROR_PATTERN` (`:30-126`).
//!
//! pi joins each table's patterns with `|` and matches the error text against
//! the joined regex with the `i` flag, so each table is ported here as one
//! case-insensitive regex over the same pattern strings. The non-retryable
//! table is checked first and wins: a quota/billing error is terminal even
//! when its text also looks transient.

use std::sync::LazyLock;

use regex::{Regex, RegexBuilder};
use rpi_ai::types::{AssistantMessage, StopReason};

/// Subscription/account limits that are not transient throttles. Mirrors
/// `NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN` (`retry.ts:7-29`).
const NON_RETRYABLE_PROVIDER_LIMIT_ERRORS: &[&str] = &[
    "GoUsageLimitError",
    "FreeUsageLimitError",
    "Monthly usage limit reached",
    "available balance",
    "insufficient_quota",
    "out of budget",
    "quota exceeded",
    "billing",
    "subscription_sharing_usage_limit_exceeded",
];

/// Transient provider/transport failures worth another attempt. Mirrors
/// `RETRYABLE_PROVIDER_ERROR_PATTERN` (`retry.ts:30-126`).
const RETRYABLE_PROVIDER_ERRORS: &[&str] = &[
    "overloaded",
    "server_busy",
    "servers are currently busy",
    "currently experiencing high demand",
    "model is at capacity",
    "rate.?limit",
    "too many requests",
    "429",
    "500",
    "502",
    "503",
    "504",
    "520",
    "524",
    "service.?(?:is.?)?(?:temporarily.?)?unavailable",
    "server.?error",
    "internal.?error",
    "provider.?returned.?(?:an.?)?error",
    "exceeded request buffer limit while retrying upstream",
    "unable to forward upstream",
    "upstream.?request.?failed",
    "upstream_stream_read_error",
    "stream was interrupted",
    "http/?2 stream failed",
    "network.?error",
    "connection.?error",
    "connection.?refused",
    "connection.?lost",
    "other side closed",
    "fetch failed",
    r"request to \S+ failed, reason:",
    "getaddrinfo",
    "ENOTFOUND",
    "EAI_AGAIN",
    "upstream.?connect",
    "reset before headers",
    "socket hang up",
    "socket connection was closed",
    "timed? out",
    "timeout",
    "terminated",
    "websocket.?closed",
    "websocket.?error",
    "ended without",
    "stream ended before message_stop",
    "stream ended before a terminal response event",
    "http2 request did not get a response",
    "pending stream has been canceled",
    "retry delay",
    "you can retry your request",
    "try your request again",
    "please retry your request",
    "ResourceExhausted",
    "subscription_sharing_usage_unavailable",
    "subscription_sharing_user_unavailable",
];

/// Build the joined, case-insensitive regex for one table.
fn compile(patterns: &[&str]) -> Regex {
    RegexBuilder::new(&patterns.join("|"))
        .case_insensitive(true)
        .build()
        .unwrap_or_else(|error| panic!("retry classifier pattern must compile: {error}"))
}

/// The non-retryable table, compiled once.
static NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| compile(NON_RETRYABLE_PROVIDER_LIMIT_ERRORS));

/// The retryable table, compiled once.
static RETRYABLE_PROVIDER_ERROR_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| compile(RETRYABLE_PROVIDER_ERRORS));

/// Whether a failed assistant message looks like a transient provider or
/// transport error, so the caller can decide to restart the turn.
///
/// Mirrors `isRetryableAssistantError` (`retry.ts`): a non-error or
/// error-less message is never retryable, the non-retryable table wins over
/// the retryable one, and the error text is matched case-insensitively.
pub fn is_retryable_assistant_error(message: &AssistantMessage) -> bool {
    if message.stop_reason != StopReason::Error {
        return false;
    }
    let Some(error_message) = message.error_message.as_deref() else {
        return false;
    };
    if error_message.is_empty() {
        return false;
    }
    if NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN.is_match(error_message) {
        return false;
    }
    RETRYABLE_PROVIDER_ERROR_PATTERN.is_match(error_message)
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
    fn transient_upstream_errors_are_retryable() {
        for text in [
            "server_busy",
            "The model is at capacity",
            "upstream request failed",
            "Service is temporarily unavailable",
            "HTTP 520 from gateway",
            "ResourceExhausted: quota exceeded for shard",
            "Provider returned an error",
            "rate limit exceeded",
        ] {
            assert!(
                is_retryable_assistant_error(&error_message(text)),
                "{text} must be retryable"
            );
        }
    }

    #[test]
    fn quota_and_billing_errors_are_terminal() {
        for text in [
            "insufficient_quota: You exceeded your current quota",
            "Your card was declined (billing)",
            "Monthly usage limit reached",
            "out of budget",
            "GoUsageLimitError",
        ] {
            assert!(
                !is_retryable_assistant_error(&error_message(text)),
                "{text} must not be retryable"
            );
        }
    }

    #[test]
    fn a_successful_message_is_never_retryable() {
        let mut message = error_message("503 service unavailable");
        message.stop_reason = StopReason::Stop;
        assert!(!is_retryable_assistant_error(&message));
    }

    #[test]
    fn a_message_without_an_error_text_is_never_retryable() {
        let mut message = error_message("503 service unavailable");
        message.error_message = None;
        assert!(!is_retryable_assistant_error(&message));
    }
}
