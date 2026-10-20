//! A compaction reserve larger than the model's own context window must not
//! cost a model call per turn. The TypeScript original only compacts when
//! there is history to summarize, so a short conversation with a small model
//! sends one request, not a request plus a summary request.

use std::sync::Arc;

use rpi_ai::providers::faux::{FauxProvider, FauxScript, FauxStep};
use rpi_ai::Model;
use rpi_ai::Provider;
use rpi_harness::agent_harness::{AgentHarness, AgentLane, HarnessRunOutcome};
use rpi_harness::session::memory::{InMemorySessionStorage, SystemClock};
use rpi_harness::session::types::SessionMetadata;
use rpi_harness::session::{DefaultIdGenerator, Session};
use rpi_harness::types::{AgentHarnessOptions, CompactionSettings};

const CONTEXT_WINDOW: u64 = 8_192;
const RESERVE_TOKENS: i64 = 16_384;

fn harness_options(
    model: Model,
    provider: Arc<FauxProvider>,
    compaction: CompactionSettings,
) -> AgentHarnessOptions {
    let metadata = SessionMetadata {
        id: "small-model".into(),
        created_at: 0,
        parent_session_id: None,
    };
    let storage = Arc::new(InMemorySessionStorage::new(
        metadata,
        Arc::new(SystemClock),
        Arc::new(DefaultIdGenerator::new()),
    ));
    let session = Session::new(storage, None);

    AgentHarnessOptions {
        model,
        thinking_level: Default::default(),
        active_tool_names: Vec::new(),
        tools: Vec::new(),
        system_prompt: None,
        resources: Default::default(),
        stream_options: Default::default(),
        retry: Default::default(),
        compaction,
        steering_mode: Default::default(),
        follow_up_mode: Default::default(),
        tool_execution: Default::default(),
        drive: Default::default(),
        session,
        models: vec![provider as Arc<dyn Provider>],
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
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_reserve_larger_than_the_context_window_sends_one_request_per_turn() {
    let script = FauxScript::new();
    script.set_responses(vec![FauxStep::text("Hello, good day.")]);
    let provider = FauxProvider::new(script);
    let mut model = provider.default_model().clone();
    model.context_window = CONTEXT_WINDOW;

    let compaction = CompactionSettings {
        enabled: true,
        reserve_tokens: RESERVE_TOKENS,
        keep_recent_tokens: 20_000,
    };
    let options = harness_options(model, provider.clone(), compaction);
    let harness = AgentHarness::create(options).await.expect("create harness");

    let result = harness
        .prompt_text("Say hello in three words", vec![])
        .await
        .expect("prompt_text completes");
    assert!(
        matches!(result.outcome, HarnessRunOutcome::Completed { .. }),
        "expected Completed, got {:?}",
        result.outcome
    );

    assert_eq!(
        provider
            .state()
            .call_count
            .load(std::sync::atomic::Ordering::Relaxed),
        1,
        "the turn must cost one model request, not a request plus a compaction summary"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_reserve_larger_than_the_context_window_stays_at_one_request_across_turns() {
    let script = FauxScript::new();
    script.set_responses(vec![
        FauxStep::text("First answer."),
        FauxStep::text("Second answer."),
    ]);
    let provider = FauxProvider::new(script);
    let mut model = provider.default_model().clone();
    model.context_window = CONTEXT_WINDOW;

    let compaction = CompactionSettings {
        enabled: true,
        reserve_tokens: RESERVE_TOKENS,
        keep_recent_tokens: 20_000,
    };
    let options = harness_options(model, provider.clone(), compaction);
    let harness = AgentHarness::create(options).await.expect("create harness");

    for prompt in ["Say hello in three words", "And once more"] {
        let result = harness
            .prompt_text(prompt, vec![])
            .await
            .expect("prompt_text completes");
        assert!(
            matches!(result.outcome, HarnessRunOutcome::Completed { .. }),
            "expected Completed, got {:?}",
            result.outcome
        );
    }

    assert_eq!(
        provider
            .state()
            .call_count
            .load(std::sync::atomic::Ordering::Relaxed),
        2,
        "two turns must cost two model requests, without a compaction summary in between"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_conversation_with_history_to_summarize_still_compacts() {
    let script = FauxScript::new();
    script.set_responses(vec![
        FauxStep::text("First answer."),
        FauxStep::text("Summary of the earlier turns."),
        FauxStep::text("Second answer."),
    ]);
    let provider = FauxProvider::new(script);
    let mut model = provider.default_model().clone();
    model.context_window = CONTEXT_WINDOW;

    let compaction = CompactionSettings {
        enabled: true,
        reserve_tokens: RESERVE_TOKENS,
        keep_recent_tokens: 10,
    };
    let options = harness_options(model, provider.clone(), compaction);
    let harness = AgentHarness::create(options).await.expect("create harness");

    let first = harness
        .prompt_text(&"a".repeat(200), vec![])
        .await
        .expect("prompt_text completes");
    assert!(
        matches!(first.outcome, HarnessRunOutcome::Completed { .. }),
        "expected Completed, got {:?}",
        first.outcome
    );

    let second = harness
        .prompt_text(&"b".repeat(200), vec![])
        .await
        .expect("prompt_text completes");
    assert!(
        matches!(second.outcome, HarnessRunOutcome::Completed { .. }),
        "expected Completed, got {:?}",
        second.outcome
    );

    assert_eq!(
        provider
            .state()
            .call_count
            .load(std::sync::atomic::Ordering::Relaxed),
        3,
        "the second turn must compact the older history: answer, summary, answer"
    );
}
