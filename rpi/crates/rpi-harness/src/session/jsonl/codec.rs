//! The session-file codec — the original's on-disk shape.
//!
//! ## Wire shapes (all lines terminate with `\n`)
//!
//! - **Header** (the first line): `{"type":"session","version":3,"id","timestamp",
//!   "cwd","parentSession"?}`.
//! - **Entry** (every other line): `{type, id, parentId, timestamp}` plus the
//!   entry type's own fields. `timestamp` is an ISO-8601 string.
//!
//! The entry types are the original's (`packages/coding-agent/src/core/session-manager.ts:57-190`):
//! `message`, `thinking_level_change`, `model_change`, `usage`, `compaction`,
//! `branch_summary`, `custom`, `custom_message`, `context_edit`, `label`,
//! `session_info` — plus the port's own `active_tools_change`.
//!
//! ## Decode validation
//!
//! The header must be `type:"session"`; an entry must carry `type`, `id` and a
//! `timestamp`. Errors are [`JsonlDecodeError`] with `kind: Syntax` (bad JSON)
//! or `kind: Schema` (wrong shape). The storage layer keys torn-tail recovery
//! off `kind: Syntax` on the last line.

use serde_json::Value;

use crate::session::jsonl::errors::{JsonlDecodeError, JsonlDecodeErrorKind};
use crate::session::jsonl::types::{JsonlSessionMetadata, JsonlSourceFormat, SessionFileHeader};
use crate::session::types::{iso_timestamp_from_ms, ms_from_iso_timestamp, Entry, JsonValue};

/// The entry types the file may contain.
const ENTRY_TYPES: &[&str] = &[
    "message",
    "thinking_level_change",
    "model_change",
    "usage",
    "compaction",
    "branch_summary",
    "custom",
    "custom_message",
    "context_edit",
    "label",
    "session_info",
    "active_tools_change",
];

// ============================ header ============================

/// Parse the first JSONL line into a validated [`SessionFileHeader`].
pub fn parse_header(line: &str) -> Result<SessionFileHeader, JsonlDecodeError> {
    let value = parse_object(line)?;
    let entry_type = value.get("type").and_then(|v| v.as_str());
    if entry_type != Some("session") {
        return Err(schema("is not a session header"));
    }
    let id = require_string(&value, "id")?;
    let timestamp = require_string(&value, "timestamp")?;
    let cwd = require_string(&value, "cwd")?;
    let parent_session = optional_string_field(&value, "parentSession")?;
    Ok(SessionFileHeader {
        entry_type: "session".to_string(),
        version: 3,
        id,
        timestamp,
        cwd,
        parent_session,
    })
}

/// Serialize a header to its newline-terminated JSONL line.
pub fn encode_header(header: &SessionFileHeader) -> String {
    let mut s = serde_json::to_string(header).expect("header serializes");
    s.push('\n');
    s
}

/// Build the metadata for a session file: the path, the filesystem mtime and
/// the source format.
pub fn metadata_from_header(
    header: &SessionFileHeader,
    path: &str,
    modified_at: i64,
) -> JsonlSessionMetadata {
    JsonlSessionMetadata {
        path: path.to_string(),
        id: header.id.clone(),
        cwd: header.cwd.clone(),
        created_at: ms_from_iso_timestamp(&header.timestamp).unwrap_or(0),
        modified_at,
        source_format: JsonlSourceFormat::V3,
        parent_session_id: None,
    }
}

// ============================ entries ============================

/// Parse one entry line into an [`Entry`].
pub fn parse_entry(line: &str) -> Result<Entry, JsonlDecodeError> {
    let value = parse_object(line)?;
    let entry_type = value
        .get("type")
        .and_then(|v| v.as_str())
        .ok_or_else(|| schema("entry is missing \"type\""))?;
    if !ENTRY_TYPES.contains(&entry_type) {
        return Err(schema("has an unknown entry type"));
    }
    serde_json::from_value(Value::Object(value)).map_err(|error| schema(error.to_string()))
}

/// Serialize an entry to its newline-terminated JSONL line.
pub fn encode_entry(entry: &Entry) -> String {
    let mut s = serde_json::to_string(&entry.to_flat_json()).expect("entry serializes");
    s.push('\n');
    s
}

// ============================ shared field helpers ============================

fn parse_object(line: &str) -> Result<serde_json::Map<String, Value>, JsonlDecodeError> {
    let parsed: Value = serde_json::from_str(line).map_err(|error| {
        if error.is_syntax() || error.is_eof() {
            syntax(error.to_string())
        } else {
            schema(error.to_string())
        }
    })?;
    match parsed {
        Value::Object(map) => Ok(map),
        _ => Err(schema("is not a JSON object")),
    }
}

fn require_string(
    value: &serde_json::Map<String, Value>,
    field: &str,
) -> Result<String, JsonlDecodeError> {
    value
        .get(field)
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| schema(&format!("is missing \"{field}\"")))
}

fn optional_string_field(
    value: &serde_json::Map<String, Value>,
    field: &str,
) -> Result<Option<String>, JsonlDecodeError> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        Some(_) => Err(schema(&format!("has an invalid \"{field}\""))),
    }
}

fn syntax(message: impl Into<String>) -> JsonlDecodeError {
    JsonlDecodeError {
        kind: JsonlDecodeErrorKind::Syntax,
        message: message.into(),
    }
}

fn schema(message: impl Into<String>) -> JsonlDecodeError {
    JsonlDecodeError {
        kind: JsonlDecodeErrorKind::Schema,
        message: message.into(),
    }
}

/// Render the current time as an ISO-8601 timestamp, for a new session file.
pub fn now_iso_timestamp(now_ms: i64) -> String {
    iso_timestamp_from_ms(now_ms)
}

/// The `JsonValue` alias re-export, so callers do not need the types module.
pub type EntryValue = JsonValue;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::types::{EntryBase, MessageEntry};
    use rpi_agent::message::AgentMessage;
    use rpi_ai::types::UserMessage;
    use rpi_ai::types::UserContent;

    fn message_entry(id: &str, parent: Option<&str>, timestamp: i64) -> Entry {
        Entry::Message(MessageEntry {
            base: EntryBase {
                entry_type: "message".into(),
                id: id.into(),
                seq: 1,
                parent_id: parent.map(String::from),
                timestamp,
            },
            message: AgentMessage::User(UserMessage::new(
                UserContent::Text("hello".into()),
                timestamp,
            )),
            terminate: None,
        })
    }

    #[test]
    fn header_round_trip() {
        let header = SessionFileHeader::new(
            "abc".into(),
            "2026-10-20T21:34:06.203Z".into(),
            "/tmp/work".into(),
            None,
        );
        let line = encode_header(&header);
        assert!(line.starts_with("{\"type\":\"session\",\"version\":3,"), "{line}");
        assert!(line.ends_with('\n'));
        let parsed = parse_header(line.trim_end()).unwrap();
        assert_eq!(parsed.id, "abc");
        assert_eq!(parsed.cwd, "/tmp/work");
        assert_eq!(parsed.timestamp, "2026-10-20T21:34:06.203Z");
    }

    #[test]
    fn entry_line_has_the_original_shape() {
        let entry = message_entry("e1", None, 1_800_000_000_000);
        let line = encode_entry(&entry);
        assert!(line.contains("\"type\":\"message\""), "{line}");
        assert!(line.contains("\"parentId\":null"), "{line}");
        assert!(line.contains("\"timestamp\":\"2027-01-15T08:00:00.000Z\""), "{line}");
        assert!(!line.contains("\"seq\""), "{line}");
        let parsed = parse_entry(line.trim_end()).unwrap();
        assert_eq!(parsed.id(), "e1");
        assert_eq!(parsed.base().timestamp, 1_800_000_000_000);
    }

    #[test]
    fn unknown_entry_type_is_a_schema_error() {
        let err = parse_entry("{\"type\":\"nope\",\"id\":\"x\"}").unwrap_err();
        assert_eq!(err.kind, JsonlDecodeErrorKind::Schema);
    }

    #[test]
    fn malformed_json_is_a_syntax_error() {
        let err = parse_entry("{\"type\":").unwrap_err();
        assert_eq!(err.kind, JsonlDecodeErrorKind::Syntax);
    }
}
