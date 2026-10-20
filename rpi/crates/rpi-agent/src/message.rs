//! Mirrors `packages/agent/src/types.ts` (open enum portion) — the
//! `AgentMessage = Message | Custom` declaration-merging model.
//!
//! TS lets apps add custom message kinds via declaration merging on
//! `CustomAgentMessages`. Rust has no declaration merging, so we model the same
//! openness as a four-arm enum: the three base [`Message`] arms plus
//! [`CustomMessage`]. Apps extend by populating `Custom`, not by adding arms.
//!
//! Serialization mirrors the wire shape: the message's `role` is the
//! discriminator, with pi's values `user` / `assistant` / `toolResult` (and the
//! app-defined role of a custom message). The three base arms carry the
//! `rpi_ai` message, which already writes its own `role`; the enum is therefore
//! `untagged` and each arm's own `role` field decides the variant — the same
//! shape pi writes and reads. `Custom` carries a free-form `data: Value` so
//! each role's structured payload rides along.

use rpi_ai::types::{
    AssistantMessage, Content, Message, SystemMessage, ToolResultMessage, UserMessage,
};
use serde::{Deserialize, Serialize};

/// `AgentMessage = Message | Custom`. The open-enum port of TS
/// `AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages]`.
///
/// `PartialEq` is derived so `pi-harness` entry equality (and tests) can compare
/// persisted messages by value. `rpi_ai`'s base message types already implement
/// `PartialEq`; `CustomMessage` does too, so the four-arm enum derives cleanly.
///
/// The variant is picked by the `role` field, exactly as in pi: `user`,
/// `assistant` and `toolResult` are the base messages, and any other role is a
/// custom message. The mapping is written out by hand (mirroring
/// `rpi_ai::Message`, which does the same) so the wire shape is pi's — the
/// message's own `role`, and no `kind` field — and so a `role` the port does
/// not know still reads as a custom message instead of failing the whole file.
#[derive(Debug, Clone, PartialEq)]
pub enum AgentMessage {
    User(UserMessage),
    Assistant(Box<AssistantMessage>),
    ToolResult(Box<ToolResultMessage>),
    System(Box<SystemMessage>),
    Custom(CustomMessage),
}

impl Serialize for AgentMessage {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            AgentMessage::User(message) => message.serialize(serializer),
            AgentMessage::Assistant(message) => message.serialize(serializer),
            AgentMessage::ToolResult(message) => message.serialize(serializer),
            AgentMessage::System(message) => message.serialize(serializer),
            AgentMessage::Custom(message) => message.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for AgentMessage {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        let role = value
            .get("role")
            .and_then(|role| role.as_str())
            .unwrap_or_default()
            .to_string();
        let decoded = match role.as_str() {
            "user" => serde_json::from_value(value).map(AgentMessage::User),
            "assistant" => serde_json::from_value(value)
                .map(|message: AssistantMessage| AgentMessage::Assistant(Box::new(message))),
            "toolResult" => serde_json::from_value(value)
                .map(|message: ToolResultMessage| AgentMessage::ToolResult(Box::new(message))),
            "system" => serde_json::from_value(value)
                .map(|message: SystemMessage| AgentMessage::System(Box::new(message))),
            _ => {
                // A custom message: its content may be a plain string.
                let value = normalize_custom_content(value);
                serde_json::from_value(value).map(AgentMessage::Custom)
            }
        };
        decoded.map_err(serde::de::Error::custom)
    }
}

/// Turn a string `content` into the text block pi's content array holds, so a
/// custom message whose content is a plain string reads.
fn normalize_custom_content(mut value: serde_json::Value) -> serde_json::Value {
    let text = value
        .get("content")
        .and_then(|content| content.as_str())
        .map(|text| text.to_string());
    if let (Some(text), Some(object)) = (text, value.as_object_mut()) {
        object.insert(
            "content".to_string(),
            serde_json::json!([{ "type": "text", "text": text }]),
        );
    }
    value
}

impl AgentMessage {
    /// The logical role tag — mirrors `message.role` on the TS side. For base
    /// messages this is `"user"`/`"assistant"`/`"toolResult"`; for custom it is
    /// the custom role string. Used by the loop's role checks (e.g. "can't
    /// continue from an assistant message").
    pub fn role(&self) -> AgentMessageRole {
        match self {
            AgentMessage::User(_) => AgentMessageRole::User,
            AgentMessage::Assistant(_) => AgentMessageRole::Assistant,
            AgentMessage::ToolResult(_) => AgentMessageRole::ToolResult,
            AgentMessage::System(_) => AgentMessageRole::Custom("system".to_string()),
            AgentMessage::Custom(c) => AgentMessageRole::Custom(c.role.clone()),
        }
    }

    pub fn is_assistant(&self) -> bool {
        matches!(self, AgentMessage::Assistant(_))
    }

    /// If this is an assistant message, borrow it.
    pub fn as_assistant(&self) -> Option<&AssistantMessage> {
        match self {
            AgentMessage::Assistant(a) => Some(a),
            _ => None,
        }
    }

    /// If this is an assistant message, own a clone of it.
    pub fn into_assistant(self) -> Option<AssistantMessage> {
        match self {
            AgentMessage::Assistant(a) => Some(*a),
            _ => None,
        }
    }
}

/// Serialize an `AssistantMessage` in the exact shape `AgentMessage::Assistant`
/// produces (the message itself, with its `role`), without materializing an
/// owned `AgentMessage` copy of it.
///
/// [`crate::AgentEvent::MessageUpdate`] carries the streaming partial as an
/// `Arc<AssistantMessage>` so neither the loop nor its consumers deep-clone the
/// whole growing message per delta. Consumers that need the message as JSON (the
/// remote protocol, the extension bridge) use this to keep the wire/plugin shape
/// byte-identical to a real `AgentMessage` — a deep clone here would reintroduce
/// exactly the per-delta copy the `Arc` exists to avoid. The equivalence is
/// pinned by `assistant_json_matches_the_agent_message_shape`.
///
/// [`crate::AgentEvent::MessageUpdate`]: crate::events::AgentEvent::MessageUpdate
pub fn assistant_json(message: &AssistantMessage) -> serde_json::Value {
    serde_json::to_value(message).unwrap_or(serde_json::Value::Null)
}

impl From<UserMessage> for AgentMessage {
    fn from(m: UserMessage) -> Self {
        AgentMessage::User(m)
    }
}
impl From<AssistantMessage> for AgentMessage {
    fn from(m: AssistantMessage) -> Self {
        AgentMessage::Assistant(Box::new(m))
    }
}
impl From<ToolResultMessage> for AgentMessage {
    fn from(m: ToolResultMessage) -> Self {
        AgentMessage::ToolResult(Box::new(m))
    }
}
impl From<Message> for AgentMessage {
    fn from(m: Message) -> Self {
        match m {
            Message::User(u) => AgentMessage::User(u),
            Message::Assistant(a) => AgentMessage::Assistant(a),
            Message::ToolResult(t) => AgentMessage::ToolResult(t),
        }
    }
}

/// Typed view of `AgentMessage::role`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentMessageRole {
    User,
    Assistant,
    ToolResult,
    Custom(String),
}

impl AgentMessageRole {
    pub fn as_str(&self) -> &str {
        match self {
            AgentMessageRole::User => "user",
            AgentMessageRole::Assistant => "assistant",
            AgentMessageRole::ToolResult => "toolResult",
            AgentMessageRole::Custom(s) => s.as_str(),
        }
    }
}

/// A custom app message. `role` is the app-defined tag (e.g. `"bashExecution"`,
/// `"branchSummary"`); `content` is provider-content the renderer emits;
/// `data` carries the role's structured payload; `timestamp` is ms-since-epoch.
///
/// `pi-harness::messages` provides typed constructors per known role;
/// `pi-agent` stays role-agnostic and only owns this shell.
///
/// `PartialEq` is derived so `pi-harness` entry equality (and tests) can compare
/// persisted custom messages by value. `serde_json::Value` + `Content` both
/// implement `PartialEq`, so the derive is sound.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomMessage {
    pub role: String,
    /// pi's `customType` — the app-defined kind of a `role: "custom"` message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_type: Option<String>,
    /// pi's `display` — whether the message is shown in the transcript.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display: Option<bool>,
    #[serde(default)]
    pub content: Vec<Content>,
    #[serde(default)]
    pub data: serde_json::Value,
    #[serde(default)]
    pub timestamp: i64,
}

impl CustomMessage {
    pub fn new(
        role: impl Into<String>,
        content: Vec<Content>,
        data: serde_json::Value,
        timestamp: i64,
    ) -> Self {
        Self {
            role: role.into(),
            custom_type: None,
            display: None,
            content,
            data,
            timestamp,
        }
    }
}

#[cfg(test)]
mod assistant_json_tests {
    use super::*;
    use rpi_ai::types::{Api, AssistantMessage};

    #[test]
    fn assistant_json_matches_the_agent_message_shape() {
        // The whole point of `assistant_json` is that consumers can keep
        // serializing a `MessageUpdate` partial the way they always have, so it
        // must be indistinguishable from the real `AgentMessage` encoding.
        let mut assistant =
            AssistantMessage::empty(Api::OpenaiCompletions, "gateway", "gpt-test", 7);
        assistant.error_message = Some("boom".into());
        let as_agent = AgentMessage::Assistant(Box::new(assistant.clone()));
        assert_eq!(
            assistant_json(&assistant),
            serde_json::to_value(&as_agent).expect("AgentMessage serializes"),
        );
    }

    /// pi's messages are discriminated by `role` (`packages/ai/src/types.ts:641`)
    /// and carry no `kind` field, so a session pi wrote has to read here.
    #[test]
    fn pis_message_shapes_read() {
        let user = serde_json::json!({
            "role": "user",
            "content": "hello",
            "timestamp": 1,
        });
        let assistant = serde_json::json!({
            "role": "assistant",
            "content": [{"type": "text", "text": "hi"}],
            "api": "openai-completions",
            "provider": "local",
            "model": "m",
            "stopReason": "stop",
            "usage": {"input": 1, "output": 2, "cacheRead": 0, "cacheWrite": 0, "reasoning": 0, "totalTokens": 3},
            "durationMs": 12,
            "thinkingLevel": "off",
            "timestamp": 2,
        });
        let tool_result = serde_json::json!({
            "role": "toolResult",
            "toolCallId": "call-1",
            "toolName": "read",
            "content": [{"type": "text", "text": "file"}],
            "details": {},
            "isError": false,
            "durationMs": 3,
            "timestamp": 3,
        });

        assert!(matches!(
            serde_json::from_value::<AgentMessage>(user).expect("pi user message"),
            AgentMessage::User(_)
        ));
        assert!(matches!(
            serde_json::from_value::<AgentMessage>(assistant).expect("pi assistant message"),
            AgentMessage::Assistant(_)
        ));
        assert!(matches!(
            serde_json::from_value::<AgentMessage>(tool_result).expect("pi tool result"),
            AgentMessage::ToolResult(_)
        ));
    }

    /// The port writes the same shape pi reads: the `role` discriminator and
    /// no `kind`.
    #[test]
    fn the_written_shape_is_pis() {
        let message = AgentMessage::User(UserMessage::new(
            rpi_ai::types::UserContent::Text("hello".into()),
            1,
        ));
        let written = serde_json::to_value(&message).expect("AgentMessage serializes");
        assert_eq!(written.get("role").and_then(|v| v.as_str()), Some("user"));
        assert!(written.get("kind").is_none(), "pi writes no kind field");
    }

    /// pi's custom message (`role: "custom"` + `customType`) and its system
    /// message (`role: "system"`) both read; a custom message whose content is
    /// a plain string reads too.
    #[test]
    fn pis_custom_and_system_messages_read() {
        let custom = serde_json::json!({
            "role": "custom",
            "customType": "note",
            "content": "a note",
            "display": true,
            "timestamp": 4,
        });
        let system = serde_json::json!({
            "role": "system",
            "content": "the prompt",
            "sections": {"tools": "read"},
            "timestamp": 5,
        });

        let custom = serde_json::from_value::<AgentMessage>(custom).expect("pi custom message");
        match custom {
            AgentMessage::Custom(message) => {
                assert_eq!(message.role, "custom");
                assert_eq!(message.custom_type.as_deref(), Some("note"));
                assert_eq!(message.display, Some(true));
                assert_eq!(message.content.len(), 1);
            }
            other => panic!("a custom message must read as custom: {other:?}"),
        }

        let system = serde_json::from_value::<AgentMessage>(system).expect("pi system message");
        match system {
            AgentMessage::System(message) => {
                assert_eq!(message.content, "the prompt");
                assert!(message.sections.is_some());
            }
            other => panic!("a system message must read as a system message: {other:?}"),
        }
    }
}
