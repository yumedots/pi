//! The session-file codec — the original's version 3 format, pinned.
//!
//! The file is what pi writes and pi reads: a
//! `{"type":"session","version":3,"id","timestamp","cwd","parentSession"?}`
//! header line followed by the flat entry list (`{type, id, parentId,
//! timestamp}` plus the entry type's own fields).
//!
//! The references are the original's
//! `packages/coding-agent/src/core/session-manager.ts:44` (the header) and
//! `:57-190` (the entry types).

use rpi_harness::session::jsonl::{
    encode_entry, encode_header, metadata_from_header, parse_entry, parse_header,
    JsonlDecodeErrorKind, JsonlSourceFormat, SessionFileHeader,
};
use rpi_harness::session::types::{
    iso_timestamp_from_ms, ContextEditEntry, CustomEntry, CustomMessageEntry, Entry, EntryBase,
    LabelEntry, MessageEntry, ModelChangeEntry, SessionInfoEntry, ThinkingLevelEntry,
    UsageEntry,
};

fn base(id: &str, parent: Option<&str>) -> EntryBase {
    EntryBase {
        entry_type: "message".into(),
        id: id.into(),
        seq: 1,
        parent_id: parent.map(String::from),
        timestamp: 1_700_000_000_000,
    }
}

fn header() -> SessionFileHeader {
    SessionFileHeader::new(
        "session".into(),
        iso_timestamp_from_ms(1_700_000_000_000),
        "/workspace/project".into(),
        None,
    )
}

fn message_entry(id: &str, parent: Option<&str>) -> Entry {
    Entry::Message(MessageEntry {
        base: base(id, parent),
        message: rpi_agent::message::AgentMessage::User(rpi_ai::types::UserMessage::new(
            "hello",
            1_700_000_000_000,
        )),
        terminate: None,
    })
}

#[test]
fn header_is_the_originals_shape() {
    let line = encode_header(&header());
    assert!(
        line.starts_with("{\"type\":\"session\",\"version\":3,\"id\":\"session\",\"timestamp\":\"2023-11-14T22:13:20.000Z\",\"cwd\":\"/workspace/project\"}"),
        "{line}"
    );
    assert!(line.ends_with('\n'), "{line}");
}

#[test]
fn header_round_trips() {
    let mut original = header();
    original.parent_session = Some("/sessions/parent.jsonl".into());
    let parsed = parse_header(encode_header(&original).trim_end()).unwrap();
    assert_eq!(parsed, original);
}

#[test]
fn header_rejects_a_foreign_header() {
    let err = parse_header("{\"kind\":\"header\",\"version\":4,\"id\":\"x\"}").unwrap_err();
    assert_eq!(err.kind, JsonlDecodeErrorKind::Schema);
}

#[test]
fn entry_line_is_the_originals_shape() {
    let line = encode_entry(&message_entry("e1", None));
    assert!(line.contains("\"type\":\"message\""), "{line}");
    assert!(line.contains("\"id\":\"e1\""), "{line}");
    assert!(line.contains("\"parentId\":null"), "{line}");
    assert!(
        line.contains("\"timestamp\":\"2023-11-14T22:13:20.000Z\""),
        "{line}"
    );
    assert!(!line.contains("\"seq\""), "{line}");
    assert!(!line.contains("\"kind\":\"entry\""), "{line}");
}

#[test]
fn entry_round_trips() {
    let entry = message_entry("e1", None);
    let parsed = parse_entry(encode_entry(&entry).trim_end()).unwrap();
    assert_eq!(parsed.id(), "e1");
    assert_eq!(parsed.base().timestamp, 1_700_000_000_000);
    assert_eq!(parsed.parent_id(), None);
}

#[test]
fn every_original_entry_type_round_trips() {
    let entries = vec![
        Entry::ModelChange(ModelChangeEntry {
            base: base("m1", None),
            provider: "anthropic".into(),
            model_id: "claude-opus-4-8".into(),
        }),
        Entry::ThinkingLevel(ThinkingLevelEntry {
            base: base("t1", None),
            thinking_level: "medium".into(),
        }),
        Entry::Usage(UsageEntry {
            base: base("u1", None),
            kind: "cache_warm".into(),
            provider: "anthropic".into(),
            model: "claude-opus-4-8".into(),
            usage: rpi_ai::types::Usage::zero(),
            note: None,
        }),
        Entry::Custom(CustomEntry {
            base: base("c1", None),
            custom_type: "my-extension".into(),
            data: Some(serde_json::json!({ "count": 2 })),
        }),
        Entry::CustomMessage(CustomMessageEntry {
            base: base("cm1", None),
            custom_type: "my-extension".into(),
            content: serde_json::json!("injected"),
            details: None,
            display: true,
        }),
        Entry::ContextEdit(ContextEditEntry {
            base: base("ce1", None),
            target_id: "e1".into(),
            replacement: Some(serde_json::json!({ "content": "edited" })),
        }),
        Entry::Label(LabelEntry {
            base: base("l1", None),
            target_id: "e1".into(),
            label: Some("important".into()),
        }),
        Entry::SessionInfo(SessionInfoEntry {
            base: base("si1", None),
            name: Some("my session".into()),
        }),
    ];
    for entry in entries {
        let line = encode_entry(&entry);
        let parsed = parse_entry(line.trim_end())
            .unwrap_or_else(|error| panic!("{} failed to parse: {error}", entry.entry_type()));
        assert_eq!(parsed.entry_type(), entry.entry_type());
        assert_eq!(parsed.id(), entry.id());
        assert_eq!(parsed.base().timestamp, entry.base().timestamp);
    }
}

#[test]
fn unknown_entry_type_is_a_schema_error() {
    let err = parse_entry("{\"type\":\"not_a_type\",\"id\":\"x\"}").unwrap_err();
    assert_eq!(err.kind, JsonlDecodeErrorKind::Schema);
}

#[test]
fn malformed_json_is_a_syntax_error() {
    let err = parse_entry("{\"type\":").unwrap_err();
    assert_eq!(err.kind, JsonlDecodeErrorKind::Syntax);
}

#[test]
fn metadata_carries_the_header_fields() {
    let metadata = metadata_from_header(&header(), "/sessions/s.jsonl", 42);
    assert_eq!(metadata.id, "session");
    assert_eq!(metadata.cwd, "/workspace/project");
    assert_eq!(metadata.path, "/sessions/s.jsonl");
    assert_eq!(metadata.modified_at, 42);
    assert_eq!(metadata.created_at, 1_700_000_000_000);
    assert_eq!(metadata.source_format, JsonlSourceFormat::V3);
}
