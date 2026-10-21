//! The JavaScript extension host's event plumbing.
//!
//! The native plugin path dispatches the harness's agent events through the
//! cdylib ABI, which carries its own payload shapes. The JavaScript host
//! speaks pi's published contract: the same events, in pi's shapes.
//!
//! Two pieces live here:
//!
//! - [`JsEventSink`] — the listener the extension crate publishes pi's events
//!   to (the provider hooks fire from inside `rpi-extensions`, which knows
//!   nothing about the JavaScript host).
//! - [`JsEmitter`] — the [`AgentEmitter`] that turns the harness's agent events
//!   into pi's event objects and hands them to the extensions.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use futures::future::BoxFuture;
use rpi_agent::events::{AgentEmitter, AgentEvent};
use rpi_agent::message::AgentMessage;
use serde_json::{json, Value};

use crate::js_extensions::JsExtensions;

/// The listener the extension crate publishes pi's events to.
///
/// The JavaScript host answers the extension synchronously, on the runtime's
/// own thread. An event published from inside a host call therefore cannot be
/// handed to the extensions straight away: the extensions are the very thread
/// that is making the call, and the dispatch would wait for itself. Such an
/// event is queued and delivered when the call returns.
pub struct JsEventSink {
    extensions: Mutex<Option<JsExtensions>>,
    queued: Mutex<Vec<(String, Value)>>,
}

impl JsEventSink {
    /// A sink with no extensions yet. The session fills it when the
    /// extensions load.
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            extensions: Mutex::new(None),
            queued: Mutex::new(Vec::new()),
        })
    }

    /// The extensions the sink delivers to.
    pub fn set_extensions(&self, extensions: JsExtensions) {
        if let Ok(mut slot) = self.extensions.lock() {
            *slot = Some(extensions);
        }
    }
}

impl rpi_extensions::EventSink for JsEventSink {
    fn emit(&self, name: &str, payload: &Value) -> Option<Value> {
        let extensions = self.extensions.lock().ok().and_then(|slot| slot.clone())?;
        if crate::js_extensions::in_host_call() {
            // The extensions are the thread that is making the call; the event
            // waits for it to return.
            if let Ok(mut queued) = self.queued.lock() {
                queued.push((name.to_string(), payload.clone()));
            }
            return None;
        }
        match extensions.dispatch(name, payload.clone()) {
            Ok(answer) => Some(answer),
            Err(error) => {
                // A handler that throws must not vanish: the error is the
                // extension author's only sign that something is wrong.
                tracing::warn!(event = name, %error, "the extension handler failed");
                None
            }
        }
    }
}

impl JsEventSink {
    /// Deliver the events that were published from inside a host call.
    pub fn drain(&self) {
        let queued = match self.queued.lock() {
            Ok(mut queued) => std::mem::take(&mut *queued),
            Err(_) => return,
        };
        if queued.is_empty() {
            return;
        }
        let extensions = match self.extensions.lock() {
            Ok(slot) => slot.clone(),
            Err(_) => return,
        };
        let Some(extensions) = extensions else { return };
        for (name, payload) in queued {
            let _ = extensions.dispatch(&name, payload);
        }
    }
}

/// The agent-event emitter for the JavaScript extensions.
///
/// The harness's agent events carry what pi's events carry, so the emitter
/// only has to rename them. The events that carry a result (`turn_end`) read
/// the answer back.
pub struct JsEmitter {
    turn_index: AtomicUsize,
}

impl JsEmitter {
    /// Build an emitter.
    pub fn new() -> Self {
        Self {
            turn_index: AtomicUsize::new(0),
        }
    }

    /// Fire one pi event.
    fn fire(&self, name: &str, payload: Value) {
        rpi_extensions::emit_event(name, &payload);
    }
}

impl AgentEmitter for JsEmitter {
    fn emit(&self, event: AgentEvent) -> BoxFuture<'static, ()> {
        let index = self.turn_index.load(Ordering::SeqCst);
        match &event {
            AgentEvent::AgentStart => {
                self.turn_index.store(0, Ordering::SeqCst);
                self.fire("agent_start", json!({ "type": "agent_start" }));
            }
            AgentEvent::AgentEnd { messages } => {
                self.fire(
                    "agent_end",
                    json!({
                        "type": "agent_end",
                        "messages": messages,
                    }),
                );
            }
            AgentEvent::TurnStart => {
                self.turn_index.store(index + 1, Ordering::SeqCst);
                self.fire(
                    "turn_start",
                    json!({
                        "type": "turn_start",
                        "turnIndex": index,
                        "timestamp": now_millis(),
                    }),
                );
            }
            AgentEvent::TurnEnd {
                message,
                tool_results,
            } => {
                self.fire(
                    "turn_end",
                    json!({
                        "type": "turn_end",
                        "turnIndex": index,
                        "message": message,
                        "toolResults": tool_results,
                        "messageEntryId": Value::Null,
                        "toolResultEntryIds": [],
                        "entries": [],
                        "continue": true,
                        "context": empty_context(),
                        "outcome": "completed",
                    }),
                );
            }
            AgentEvent::MessageStart { message } => {
                self.fire("message_start", json!({ "type": "message_start", "message": message }));
            }
            AgentEvent::MessageUpdate {
                message,
                assistant_message_event,
            } => {
                self.fire(
                    "message_update",
                    json!({
                        "type": "message_update",
                        "message": message,
                        "assistantMessageEvent": rpi_extensions::assistant_message_event_json(assistant_message_event),
                    }),
                );
            }
            AgentEvent::MessageEnd { message } => {
                self.fire("message_end", json!({ "type": "message_end", "message": message }));
            }
            AgentEvent::ToolExecutionStart {
                tool_call_id,
                tool_name,
                args,
            } => {
                self.fire(
                    "tool_execution_start",
                    json!({
                        "type": "tool_execution_start",
                        "toolCallId": tool_call_id,
                        "toolName": tool_name,
                        "args": args,
                    }),
                );
            }
            AgentEvent::ToolExecutionUpdate {
                tool_call_id,
                tool_name,
                args,
                partial_result,
            } => {
                self.fire(
                    "tool_execution_update",
                    json!({
                        "type": "tool_execution_update",
                        "toolCallId": tool_call_id,
                        "toolName": tool_name,
                        "args": args,
                        "partialResult": rpi_extensions::agent_tool_result_json(partial_result),
                    }),
                );
            }
            AgentEvent::ToolExecutionEnd {
                tool_call_id,
                tool_name,
                args,
                result,
                is_error,
                duration_ms,
            } => {
                let result_json = rpi_extensions::agent_tool_result_json(result);
                let mut end = json!({
                    "type": "tool_execution_end",
                    "toolCallId": tool_call_id,
                    "toolName": tool_name,
                    "result": result_json,
                    "isError": is_error,
                });
                if let Some(duration_ms) = duration_ms {
                    end["durationMs"] = json!(duration_ms);
                }
                self.fire("tool_execution_end", end);
                self.fire(
                    "tool_result",
                    json!({
                        "type": "tool_result",
                        "toolCallId": tool_call_id,
                        "toolName": tool_name,
                        "input": args,
                        "content": result_json.get("content").cloned().unwrap_or(Value::Array(Vec::new())),
                        "details": result_json.get("details").cloned().unwrap_or(Value::Null),
                        "structuredContent": result.structured_content.clone(),
                        "isError": is_error,
                        "usage": result_json.get("usage").cloned().unwrap_or(Value::Null),
                    }),
                );
            }
            AgentEvent::BeforeAgentStart {
                prompt,
                system_prompt,
            } => {
                let (text, images) = prompt_text_and_images(prompt);
                self.fire(
                    "before_agent_start",
                    json!({
                        "type": "before_agent_start",
                        "messageType": "user",
                        "prompt": text,
                        "images": images,
                        "systemPrompt": system_prompt,
                        "systemPromptOptions": json!({}),
                    }),
                );
            }
            AgentEvent::AgentBeforeSettle { outcome } => {
                let outcome = match outcome {
                    rpi_agent::events::AgentActivityOutcome::Completed => "completed",
                    rpi_agent::events::AgentActivityOutcome::Aborted => "aborted",
                    rpi_agent::events::AgentActivityOutcome::Error => "error",
                };
                self.fire(
                    "agent_before_settle",
                    json!({
                        "type": "agent_before_settle",
                        "outcome": outcome,
                        "entries": [],
                        "continue": true,
                        "context": empty_context(),
                    }),
                );
            }
            AgentEvent::AgentSettled { aborted } => {
                self.fire(
                    "agent_settled",
                    json!({ "type": "agent_settled", "aborted": aborted }),
                );
            }
            AgentEvent::RetryScheduled { .. } => {}
        }
        Box::pin(async {})
    }
}

/// The boundary context preview a `turn_end` carries when the session has no
/// projection to show.
fn empty_context() -> Value {
    json!({
        "contextEntries": [],
        "contextMessages": [],
        "llmMessages": [],
        "pendingMessages": [],
        "canContinue": true,
    })
}

/// The text and the images of the prompt that starts a run.
///
/// pi's `before_agent_start` carries the prompt's text and its images, so a
/// handler sees what the user sent.
fn prompt_text_and_images(prompt: &AgentMessage) -> (String, Vec<Value>) {
    let AgentMessage::User(user) = prompt else {
        return (String::new(), Vec::new());
    };
    match &user.content {
        rpi_ai::types::UserContent::Text(text) => (text.clone(), Vec::new()),
        rpi_ai::types::UserContent::Blocks(blocks) => {
            let mut text = String::new();
            let mut images = Vec::new();
            for block in blocks {
                match block {
                    rpi_ai::types::Content::Text(block) => text.push_str(&block.text),
                    rpi_ai::types::Content::Image(block) => {
                        images.push(
                            serde_json::to_value(block).unwrap_or(Value::Null),
                        );
                    }
                    _ => {}
                }
            }
            (text, images)
        }
    }
}

/// The wall-clock milliseconds a `turn_start` carries.
fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}
