//! The event sink the JavaScript extension host listens through.
//!
//! The native plugin path dispatches its events through the cdylib ABI, which
//! carries its own payload shapes. The JavaScript host speaks pi's published
//! contract instead, so it needs the same events in pi's shapes.
//!
//! A sink is a process-wide listener: the host installs one when the
//! JavaScript extensions load, and the places that know an event's pi payload
//! publish it here. The sink is optional — a session without JavaScript
//! extensions has none, and the publishing sites do nothing.

use std::sync::{Arc, LazyLock, Mutex};

use serde_json::Value;

/// A listener for the pi events the host publishes.
pub trait EventSink: Send + Sync {
    /// Deliver one event. `name` is the pi `on()` category; `payload` is the
    /// event object, including its `type` field.
    ///
    /// The returned value is the answer of the first handler that produced
    /// one — the events that carry a result (`tool_call`, `context`, the
    /// boundary events) read it back.
    fn emit(&self, name: &str, payload: &Value) -> Option<Value>;
}

static SINKS: LazyLock<Mutex<Vec<Arc<dyn EventSink>>>> = LazyLock::new(|| Mutex::new(Vec::new()));

/// Install a sink. A session that reloads its extensions installs a fresh
/// sink; the previous one is dropped with its session.
pub fn install_event_sink(sink: Arc<dyn EventSink>) {
    if let Ok(mut slots) = SINKS.lock() {
        slots.push(sink);
    }
}

/// Remove every installed sink. The host calls it when the session's
/// extensions are torn down.
pub fn clear_event_sinks() {
    if let Ok(mut slots) = SINKS.lock() {
        slots.clear();
    }
}

/// Publish one event to every installed sink.
pub fn emit_event(name: &str, payload: &Value) -> Option<Value> {
    let listeners = SINKS.lock().ok()?.clone();
    let mut answer = None;
    for listener in listeners {
        if let Some(value) = listener.emit(name, payload) {
            if answer.is_none() {
                answer = Some(value);
            }
        }
    }
    answer
}
