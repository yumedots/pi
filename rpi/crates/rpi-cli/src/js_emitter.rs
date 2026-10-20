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
use serde_json::{json, Value};

use crate::js_extensions::JsExtensions;

/// The listener the extension crate publishes pi's events to.
pub struct JsEventSink {
    extensions: Mutex<Option<JsExtensions>>,
}

impl JsEventSink {
    /// A sink with no extensions yet. The session fills it when the
    /// extensions load.
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            extensions: Mutex::new(None),
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
        extensions.dispatch(name, payload.clone()).ok()
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
                result,
                is_error,
                ..
            } => {
                self.fire(
                    "tool_execution_end",
                    json!({
                        "type": "tool_execution_end",
                        "toolCallId": tool_call_id,
                        "toolName": tool_name,
                        "result": rpi_extensions::agent_tool_result_json(result),
                        "isError": is_error,
                    }),
                );
                self.fire(
                    "tool_result",
                    json!({
                        "type": "tool_result",
                        "toolCallId": tool_call_id,
                        "toolName": tool_name,
                        "input": Value::Null,
                        "content": rpi_extensions::agent_tool_result_json(result),
                        "isError": is_error,
                    }),
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

/// The wall-clock milliseconds a `turn_start` carries.
fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}
