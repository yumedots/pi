//! The request-level and turn-level hooks, and the tool-result contract.
//!
//! Mirrors TS `agent-loop.test.ts` / `agent.test.ts`:
//! - "prepareRequest runs before every provider request and can replace the
//!   model and the thinking level"
//! - "finishTurn returns continue to force one more provider request"
//! - "finishTurn returns end to stop the run"
//! - a tool that reports a soft failure keeps its details and is flagged
//!   `isError`, and the tool result carries the measured duration.

#[path = "common/mod.rs"]
mod common;

use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use common::{assistant_text, base_config, mock_stream_fn, run_and_collect, user_message};
use rpi_agent::{
    AgentContext, AgentEvent, AgentRequestUpdate, AgentToolResult, AgentTurnDecision,
    FinishTurn, PrepareRequest,
};
use rpi_ai::types::StopReason;
use tokio_util::sync::CancellationToken;

/// A stream function that records the model every request carries.
fn recording_stream_fn(
    messages: Vec<rpi_ai::types::AssistantMessage>,
    requested: Arc<Mutex<Vec<String>>>,
) -> rpi_agent::StreamFn {
    let queue = Arc::new(Mutex::new(messages.into_iter().collect::<VecDeque<_>>()));
    rpi_agent::stream_fn(move |model, _ctx, _opts| {
        requested.lock().expect("requested lock").push(model.id.clone());
        let (mut prod, stream) = rpi_ai::event_stream::create_assistant_message_event_stream();
        let next = queue
            .lock()
            .expect("queue lock")
            .pop_front()
            .expect("a scripted message");
        let partial = Arc::new(next.clone());
        prod.push(rpi_ai::types::AssistantMessageEvent::Start { partial });
        prod.push(rpi_ai::types::AssistantMessageEvent::Done {
            reason: rpi_ai::types::DoneReason::Stop,
            message: next,
        });
        stream
    })
}

/// A tool that does nothing, so the loop asks the model again.
struct NoopTool {
    schema: rpi_ai::types::Tool,
}

fn noop_schema() -> rpi_ai::types::Tool {
    rpi_ai::types::Tool {
        name: "noop".to_string(),
        description: "Does nothing".to_string(),
        parameters: rpi_ai::types::Schema::new(serde_json::json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false,
        })),
        constrained_sampling: None,
    }
}

#[async_trait::async_trait]
impl rpi_agent::AgentTool for NoopTool {
    fn schema(&self) -> &rpi_ai::types::Tool {
        &self.schema
    }
    fn label(&self) -> &str {
        "Noop"
    }
    async fn execute(
        &self,
        _tool_call_id: &str,
        _params: serde_json::Value,
        _signal: CancellationToken,
        _on_update: Arc<dyn Fn(rpi_agent::ToolResultPartial) + Send + Sync>,
    ) -> Result<AgentToolResult, rpi_agent::AgentError> {
        Ok(AgentToolResult::text("ok"))
    }
}

#[tokio::test]
async fn prepare_request_runs_before_every_provider_request() {
    let calls = Arc::new(AtomicUsize::new(0));
    let seen_models = Arc::new(Mutex::new(Vec::<String>::new()));
    let prepare: PrepareRequest = {
        let calls = Arc::clone(&calls);
        let seen_models = Arc::clone(&seen_models);
        Arc::new(move |ctx: rpi_agent::PrepareRequestContext<'_>, _signal| {
            let model_id = ctx.model.id.clone();
            let calls = Arc::clone(&calls);
            let seen_models = Arc::clone(&seen_models);
            Box::pin(async move {
                calls.fetch_add(1, Ordering::SeqCst);
                seen_models
                    .lock()
                    .expect("models lock")
                    .push(model_id);
                None
            })
        })
    };

    let mut config = base_config();
    config.prepare_request = Some(prepare);
    // A tool call makes the loop send a second request, so the hook has two
    // requests to run before.
    let stream_fn = mock_stream_fn(vec![
        common::assistant_tool_calls(
            vec![("call-1", "noop", serde_json::json!({}))],
            StopReason::ToolUse,
        ),
        assistant_text("done", StopReason::Stop),
    ]);
    let context = AgentContext {
        system_prompt: String::new(),
        messages: Vec::new(),
        tools: vec![Arc::new(NoopTool {
            schema: noop_schema(),
        })],
    };
    let (_events, _messages) = run_and_collect(
        vec![user_message("hello")],
        context,
        config,
        stream_fn,
    )
    .await;

    // One call per provider request: the hook ran before each of them.
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn prepare_request_can_replace_the_model_and_the_thinking_level() {
    let routed = rpi_ai::Model::new(
        "routed",
        "routed",
        rpi_ai::types::Api::Other("openai-responses".into()),
        "mock",
        "https://example.invalid",
    );
    let seen: Arc<Mutex<Vec<(String, rpi_ai::types::ThinkingLevel)>>> =
        Arc::new(Mutex::new(Vec::new()));
    let prepare: PrepareRequest = {
        let seen = Arc::clone(&seen);
        let routed = routed.clone();
        Arc::new(move |ctx: rpi_agent::PrepareRequestContext<'_>, _signal| {
            let model_id = ctx.model.id.clone();
            let thinking_level = ctx.thinking_level;
            let seen = Arc::clone(&seen);
            let routed = routed.clone();
            Box::pin(async move {
                seen.lock().expect("seen lock").push((model_id, thinking_level));
                Some(AgentRequestUpdate {
                    context: None,
                    model: Some(routed),
                    thinking_level: Some(rpi_ai::types::ThinkingLevel::High),
                })
            })
        })
    };

    let mut config = base_config();
    config.prepare_request = Some(prepare);
    let requested = Arc::new(Mutex::new(Vec::<String>::new()));
    let stream_fn = recording_stream_fn(
        vec![assistant_text("one", StopReason::Stop)],
        Arc::clone(&requested),
    );
    let context = AgentContext {
        system_prompt: String::new(),
        messages: Vec::new(),
        tools: Vec::new(),
    };
    let (_events, _messages) =
        run_and_collect(vec![user_message("hello")], context, config, stream_fn).await;

    let seen = seen.lock().expect("seen lock").clone();
    assert_eq!(seen.len(), 1, "the hook runs before the first request");
    assert_eq!(seen[0].0, "mock", "the hook sees the configured model");
    // The replacement model is the one the provider request carries.
    let requested = requested.lock().expect("requested lock").clone();
    assert_eq!(requested, vec!["routed".to_string()]);
}

#[tokio::test]
async fn finish_turn_continue_forces_one_more_provider_request() {
    let turns = Arc::new(AtomicUsize::new(0));
    let finish: FinishTurn = {
        let turns = Arc::clone(&turns);
        Arc::new(move |_ctx: rpi_agent::AgentTurnContext<'_>, _signal| {
            let turns = Arc::clone(&turns);
            Box::pin(async move {
                let seen = turns.fetch_add(1, Ordering::SeqCst);
                // Continue once: a second continue would ask for a third
                // request, which the script does not have.
                (seen == 0).then_some(AgentTurnDecision::Continue)
            })
        })
    };

    let mut config = base_config();
    config.finish_turn = Some(finish);
    let stream_fn = mock_stream_fn(vec![
        assistant_text("one", StopReason::Stop),
        assistant_text("two", StopReason::Stop),
    ]);
    let context = AgentContext {
        system_prompt: String::new(),
        messages: Vec::new(),
        tools: Vec::new(),
    };
    let (events, _messages) =
        run_and_collect(vec![user_message("hello")], context, config, stream_fn).await;

    assert_eq!(
        turns.load(Ordering::SeqCst),
        2,
        "the continued turn is a turn of its own"
    );
    let assistant_messages = events
        .iter()
        .filter(|event| {
            matches!(
                event,
                AgentEvent::MessageEnd {
                    message: rpi_agent::AgentMessage::Assistant(_)
                }
            )
        })
        .count();
    assert_eq!(
        assistant_messages, 2,
        "a continue decision forces a second provider request"
    );
}

#[tokio::test]
async fn finish_turn_end_stops_the_run() {
    let turns = Arc::new(AtomicUsize::new(0));
    let finish: FinishTurn = {
        let turns = Arc::clone(&turns);
        Arc::new(move |_ctx: rpi_agent::AgentTurnContext<'_>, _signal| {
            let turns = Arc::clone(&turns);
            Box::pin(async move {
                turns.fetch_add(1, Ordering::SeqCst);
                Some(AgentTurnDecision::End)
            })
        })
    };

    let mut config = base_config();
    config.finish_turn = Some(finish);
    let stream_fn = mock_stream_fn(vec![
        assistant_text("one", StopReason::Stop),
        assistant_text("two", StopReason::Stop),
    ]);
    let context = AgentContext {
        system_prompt: String::new(),
        messages: Vec::new(),
        tools: Vec::new(),
    };
    let (events, _messages) =
        run_and_collect(vec![user_message("hello")], context, config, stream_fn).await;

    assert_eq!(turns.load(Ordering::SeqCst), 1);
    let assistant_messages = events
        .iter()
        .filter(|event| {
            matches!(
                event,
                AgentEvent::MessageEnd {
                    message: rpi_agent::AgentMessage::Assistant(_)
                }
            )
        })
        .count();
    assert_eq!(assistant_messages, 1, "an end decision stops the run");
}

struct FailingTool {
    schema: rpi_ai::types::Tool,
}

#[async_trait::async_trait]
impl rpi_agent::AgentTool for FailingTool {
    fn schema(&self) -> &rpi_ai::types::Tool {
        &self.schema
    }
    fn label(&self) -> &str {
        "Failing"
    }
    async fn execute(
        &self,
        _tool_call_id: &str,
        _params: serde_json::Value,
        _signal: CancellationToken,
        _on_update: Arc<dyn Fn(rpi_agent::ToolResultPartial) + Send + Sync>,
    ) -> Result<AgentToolResult, rpi_agent::AgentError> {
        let mut result = AgentToolResult::error_text("it failed");
        result.details = serde_json::json!({ "code": 7 });
        result.structured_content = Some(serde_json::json!({ "code": 7 }));
        Ok(result)
    }
}

#[tokio::test]
async fn a_soft_failure_keeps_its_details_and_carries_the_duration() {
    let schema = rpi_ai::types::Tool {
        name: "failing".to_string(),
        description: "Always fails".to_string(),
        parameters: rpi_ai::types::Schema::new(serde_json::json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false,
        })),
        constrained_sampling: None,
    };
    let context = AgentContext {
        system_prompt: String::new(),
        messages: Vec::new(),
        tools: vec![Arc::new(FailingTool { schema })],
    };
    let stream_fn = mock_stream_fn(vec![
        common::assistant_tool_calls(
            vec![("call-1", "failing", serde_json::json!({}))],
            StopReason::ToolUse,
        ),
        assistant_text("done", StopReason::Stop),
    ]);
    let (events, _messages) =
        run_and_collect(vec![user_message("hello")], context, base_config(), stream_fn).await;

    let end = events
        .iter()
        .find_map(|event| match event {
            AgentEvent::ToolExecutionEnd {
                tool_call_id,
                tool_name: _,
                result,
                is_error,
                duration_ms,
            } if tool_call_id == "call-1" => Some((result, *is_error, *duration_ms)),
            _ => None,
        })
        .expect("tool_execution_end for call-1");
    let (result, is_error, duration_ms) = end;
    assert!(is_error, "a soft failure is an error result");
    assert_eq!(result.details, serde_json::json!({ "code": 7 }));
    assert_eq!(
        result.structured_content,
        Some(serde_json::json!({ "code": 7 }))
    );
    assert!(
        duration_ms.is_some(),
        "the tool result carries the measured duration"
    );

    let message = events
        .iter()
        .find_map(|event| match event {
            AgentEvent::MessageEnd {
                message: rpi_agent::AgentMessage::ToolResult(result),
            } => Some(result.clone()),
            _ => None,
        })
        .expect("tool result message");
    assert!(message.is_error, "the tool result message is an error");
    assert_eq!(message.details, Some(serde_json::json!({ "code": 7 })));
    assert_eq!(message.duration_ms, duration_ms);
}
