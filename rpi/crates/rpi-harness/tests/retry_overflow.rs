//! The retry budget, the retryability classifier and the context-overflow
//! recovery — the three behaviours pi defines and the port must match.
//!
//! - The budget is three attempts (pi's `retry.maxRetries` default), not ten.
//! - The classifier is pi's pair of regex tables: a transient upstream failure
//!   is retryable, a quota/billing failure is terminal.
//! - A context overflow compacts the session and retries the turn once; a
//!   second overflow surfaces instead of looping.

use std::sync::Arc;

use rpi_agent::AgentMessage;
use rpi_ai::providers::faux::{faux_assistant_message, FauxProvider, FauxScript, FauxStep};
use rpi_ai::types::{Api, AssistantMessage, Content, StopReason, UserMessage};
use rpi_ai::Provider;
use rpi_harness::agent_harness::{AgentHarness, AgentLane, HarnessRunOutcome};
use rpi_harness::session::memory::{InMemorySessionStorage, SystemClock};
use rpi_harness::session::types::{
    CompactionReason, Entry, EntryOrder, EntryQuery, LaneRecord, RecordQuery, SessionMetadata,
};
use rpi_harness::session::{DefaultIdGenerator, Session};
use rpi_harness::types::{AgentHarnessOptions, CompactionSettings, RetryPolicy};

/// The overflow text a provider returns when the request no longer fits.
const OVERFLOW_ERROR: &str = "prompt is too long: 213462 tokens > 200000 maximum";

/// Build a harness over a faux provider with no tools.
async fn harness_with_script(script: FauxScript) -> (AgentHarness, Arc<FauxProvider>) {
    let provider = FauxProvider::new(script);
    let model = provider.default_model().clone();

    let metadata = SessionMetadata {
        id: "overflow".into(),
        created_at: 0,
        parent_session_id: None,
    };
    let storage = Arc::new(InMemorySessionStorage::new(
        metadata,
        Arc::new(SystemClock),
        Arc::new(DefaultIdGenerator::new()),
    ));
    let session = Session::new(storage, None);

    let options = AgentHarnessOptions {
        model,
        thinking_level: Default::default(),
        active_tool_names: Vec::new(),
        tools: Vec::new(),
        system_prompt: None,
        resources: Default::default(),
        stream_options: Default::default(),
        retry: RetryPolicy::default(),
        // `keep_recent_tokens` is small so the compaction cut point falls after
        // the first user message of the short test history; the threshold check
        // uses `reserve_tokens`, which stays at pi's default, so no *threshold*
        // compaction fires.
        compaction: CompactionSettings {
            enabled: true,
            reserve_tokens: 16_384,
            keep_recent_tokens: 1,
        },
        steering_mode: Default::default(),
        follow_up_mode: Default::default(),
        tool_execution: Default::default(),
        drive: Default::default(),
        session,
        models: vec![provider.clone() as Arc<dyn Provider>],
        to_provider_messages: None,
        entry_projectors: Default::default(),
        agent_emitter: None,
        before_tool_call: None,
        after_tool_call: None,
        transform_context: None,
        entry_transforms: Vec::new(),
        provider_hooks: None,
        prepare_request: None,
        finish_turn: None,
        allow_existing_session: false,
    };

    let harness = AgentHarness::create(options).await.expect("create harness");
    (harness, provider)
}

/// An assistant message carrying `text`.
fn assistant_turn(text: &str) -> AgentMessage {
    let mut assistant = AssistantMessage::empty(Api::Faux, "faux", "faux-1", 2);
    assistant.content = vec![Content::text(text)];
    assistant.stop_reason = StopReason::Stop;
    AgentMessage::Assistant(Box::new(assistant))
}

/// Give the session a prior turn, so a compaction has something to summarize.
async fn append_history(harness: &AgentHarness) {
    harness
        .append_message(AgentMessage::User(UserMessage::new(
            "the earlier question",
            1,
        )))
        .await
        .expect("append the earlier user message");
    harness
        .append_message(assistant_turn("the earlier answer"))
        .await
        .expect("append the earlier assistant message");
}

/// The number of provider calls the run made.
fn call_count(provider: &FauxProvider) -> usize {
    provider
        .state()
        .call_count
        .load(std::sync::atomic::Ordering::Relaxed)
}

/// The compaction entries on the branch.
async fn compaction_entries(harness: &AgentHarness) -> Vec<Entry> {
    harness
        .find_entries(&EntryQuery {
            order: Some(EntryOrder::OldestFirst),
            ..Default::default()
        })
        .await
        .expect("entries readable")
        .into_iter()
        .filter(|entry| matches!(entry, Entry::Compaction(_)))
        .collect()
}

/// The compaction reasons recorded for this run.
async fn compaction_reasons(harness: &AgentHarness) -> Vec<CompactionReason> {
    harness
        .session()
        .find_records(&RecordQuery {
            lane: Some("main".to_string()),
            order: Some(EntryOrder::OldestFirst),
            ..Default::default()
        })
        .await
        .expect("records readable")
        .into_iter()
        .filter_map(|record| match record {
            LaneRecord::StepAttempt(attempt) => attempt.compaction_reason,
            _ => None,
        })
        .collect()
}

/// The retry budget is three attempts — pi's `retry.maxRetries` default
/// (2 s, 4 s, 8 s ≈ 14 s), not the port's former ten.
#[test]
fn the_default_retry_budget_is_three_attempts() {
    let retry = RetryPolicy::default();
    assert!(retry.enabled);
    assert_eq!(retry.max_retries, 3);
}

/// The classifier retries a transient upstream failure …
#[test]
fn transient_upstream_failures_are_retryable() {
    let mut message = faux_assistant_message("", StopReason::Error);
    for text in [
        "server_busy",
        "The model is at capacity",
        "upstream request failed",
        "Service is temporarily unavailable",
        "HTTP 520 from the gateway",
        "ResourceExhausted",
    ] {
        message.error_message = Some(text.to_string());
        assert!(
            rpi_harness::compaction::is_retryable_assistant_error(&message),
            "{text} must be retryable"
        );
    }
}

/// … and treats a quota/billing failure as terminal.
#[test]
fn quota_failures_are_terminal() {
    let mut message = faux_assistant_message("", StopReason::Error);
    for text in [
        "insufficient_quota: You exceeded your current quota",
        "Your card was declined (billing)",
        "Monthly usage limit reached",
    ] {
        message.error_message = Some(text.to_string());
        assert!(
            !rpi_harness::compaction::is_retryable_assistant_error(&message),
            "{text} must not be retryable"
        );
    }
}

/// The overflow detector matches the provider texts pi matches …
#[test]
fn provider_overflow_texts_are_detected() {
    let mut message = faux_assistant_message("", StopReason::Error);
    for text in [
        "prompt is too long: 213462 tokens > 200000 maximum",
        "Prompt too long",
        "Your input exceeds the context window of this model",
        "Requested token count exceeds the model's maximum context length of 131072 tokens",
        "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)",
        "context length exceeded",
    ] {
        message.error_message = Some(text.to_string());
        assert!(
            rpi_harness::compaction::is_context_overflow(&message),
            "{text} must be an overflow"
        );
    }
}

/// … and does not mistake a throttling or rate-limit error for one.
#[test]
fn throttling_errors_are_not_overflows() {
    let mut message = faux_assistant_message("", StopReason::Error);
    for text in [
        "Throttling error: Too many tokens, please wait before trying again.",
        "Service unavailable: The service is temporarily unavailable.",
        "Rate limit exceeded, please retry after 30 seconds.",
        "Too many requests. Please slow down.",
        "500 `model runner crashed unexpectedly`",
    ] {
        message.error_message = Some(text.to_string());
        assert!(
            !rpi_harness::compaction::is_context_overflow(&message),
            "{text} must not be an overflow"
        );
    }
}

/// A provider that overflows the context once recovers: the session is
/// compacted (with the Overflow reason) and the turn is retried.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_context_overflow_compacts_and_retries_the_turn() {
    let mut overflow = faux_assistant_message("", StopReason::Error);
    overflow.error_message = Some(OVERFLOW_ERROR.to_string());
    let script = FauxScript::new();
    script.set_responses(vec![
        FauxStep::message(overflow),
        FauxStep::text("## Goal\nkeep going"),
        FauxStep::text("Recovered after compaction."),
    ]);
    let (harness, provider) = harness_with_script(script).await;
    append_history(&harness).await;

    let result = harness
        .prompt_text("the new question", vec![])
        .await
        .expect("the run completes");
    assert!(
        matches!(&result.outcome, HarnessRunOutcome::Completed { .. }),
        "the retried turn must succeed, got {:?}",
        result.outcome
    );

    // The failed attempt, the compaction summary and the retried turn.
    assert_eq!(call_count(&provider), 3);

    // The compaction landed, and it was an overflow compaction.
    let compactions = compaction_entries(&harness).await;
    assert_eq!(compactions.len(), 1, "exactly one compaction entry");
    assert_eq!(
        compaction_reasons(&harness).await,
        vec![CompactionReason::Overflow],
        "the compaction must be recorded as an overflow compaction"
    );

    // The failed attempt is not in the transcript: only the recovered turn is.
    let entries = harness
        .find_entries(&EntryQuery {
            order: Some(EntryOrder::OldestFirst),
            ..Default::default()
        })
        .await
        .expect("entries readable");
    let assistant_errors: Vec<String> = entries
        .iter()
        .filter_map(|entry| match entry {
            Entry::Message(message) => match &message.message {
                AgentMessage::Assistant(assistant) => assistant.error_message.clone(),
                _ => None,
            },
            _ => None,
        })
        .collect();
    assert!(
        !assistant_errors
            .iter()
            .any(|error| error.contains("prompt is too long")),
        "the failed attempt must not be committed, got {assistant_errors:?}"
    );
}

/// A second overflow in the same run surfaces: the recovery happens once, not
/// in a loop.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_second_context_overflow_is_not_recovered_again() {
    let mut overflow = faux_assistant_message("", StopReason::Error);
    overflow.error_message = Some(OVERFLOW_ERROR.to_string());
    let script = FauxScript::new();
    script.set_responses(vec![
        FauxStep::message(overflow.clone()),
        FauxStep::text("## Goal\nkeep going"),
        FauxStep::message(overflow),
    ]);
    let (harness, provider) = harness_with_script(script).await;
    append_history(&harness).await;

    let result = harness
        .prompt_text("the new question", vec![])
        .await
        .expect("the run completes with a failure outcome");
    match &result.outcome {
        HarnessRunOutcome::Failed { error, .. } => {
            assert!(
                error.message.contains("prompt is too long"),
                "the overflow error must surface, got {}",
                error.message
            );
        }
        other => panic!("expected Failed, got {other:?}"),
    }

    // The failed attempt, the compaction summary, the retried attempt. No
    // second compaction and no further attempts.
    assert_eq!(call_count(&provider), 3);
    assert_eq!(
        compaction_entries(&harness).await.len(),
        1,
        "the recovery compaction must not run twice"
    );
}
