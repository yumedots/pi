//! Mirrors `packages/agent/src/harness/session/jsonl/types.ts` — the JSONL
//! repo's typed options + metadata + v4 header shape.
//!
//! The TS `JsonlSessionRepoFileSystem` is a `Pick` of the harness `FileSystem`
//! trait; the Rust port reuses [`rpi_tools::env::FileSystem`] directly (it
//! already exposes every method the Pick selected), so there is no separate
//! file-system trait here.

use std::sync::Arc;

use rpi_tools::env::FileSystem;

use crate::session::memory::Clock;
use crate::session::types::{IdGenerator, JsonValue, SessionCreateOptions, SessionMetadata};

/// The session file's header line, in the original's shape:
/// `{"type":"session","version":3,"id","timestamp","cwd","parentSession"?}`.
///
/// Mirrors TS `SessionHeader`
/// (`packages/coding-agent/src/core/session-manager.ts:44`). `parentSession`
/// is the parent session's file path.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFileHeader {
    #[serde(rename = "type")]
    pub entry_type: String,
    pub version: u32,
    pub id: String,
    /// ISO-8601 timestamp of the session's creation.
    pub timestamp: String,
    pub cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session: Option<String>,
}

impl SessionFileHeader {
    /// Build a header for a new session.
    pub fn new(id: String, timestamp: String, cwd: String, parent_session: Option<String>) -> Self {
        Self {
            entry_type: "session".to_string(),
            version: 3,
            id,
            timestamp,
            cwd,
            parent_session,
        }
    }
}

/// `sourceFormat: 3`. The session file is the original's version 3 format.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JsonlSourceFormat {
    V3,
}

impl JsonlSourceFormat {
    pub fn as_u8(self) -> u8 {
        3
    }
}

/// Mirrors TS `JsonlSessionMetadata` (extends `SessionMetadata` with JSONL-
/// specific filesystem fields). Carries the on-disk `path` + `cwd` +
/// `modified_at` so the repo/storage can locate and append to the file without
/// re-deriving them. The shared [`SessionStorage`] trait exposes only the base
/// [`SessionMetadata`]; the richer fields live here for the JSONL backend.
#[derive(Debug, Clone, PartialEq)]
pub struct JsonlSessionMetadata {
    pub id: String,
    pub created_at: i64,
    pub cwd: String,
    pub path: String,
    /// Filesystem modification time as milliseconds since Unix epoch.
    pub modified_at: i64,
    pub source_format: JsonlSourceFormat,
    /// The parent session's id (the file's `parentSession` carries its path).
    pub parent_session_id: Option<String>,
}

impl JsonlSessionMetadata {
    /// Project to the shared base [`SessionMetadata`] (the subset the
    /// [`SessionStorage`] trait exposes).
    pub fn to_base(&self) -> SessionMetadata {
        SessionMetadata {
            id: self.id.clone(),
            created_at: self.created_at,
            parent_session_id: self.parent_session_id.clone(),
        }
    }
}

/// Mirrors TS `JsonlSessionRepoOptions`. `fs` is the shared
/// [`rpi_tools::env::FileSystem`] (the Rust analog of the TS `Pick<FileSystem,…>`).
///
/// The Rust port additionally carries a shared [`Clock`] + [`IdGenerator`]: the
/// TS repo reaches into `Date.now()` / `uuidv7()` directly, but the Rust harness
/// abstracts both behind injectable traits (so tests can run deterministically
/// against the in-memory FS). Passing them through the repo options keeps every
/// `SessionStorage` construction (create/load/fork) supplied consistently.
#[derive(Clone)]
pub struct JsonlSessionRepoOptions {
    pub fs: Arc<dyn FileSystem>,
    /// Root containing cwd-encoded session directories.
    pub sessions_root: String,
    pub clock: Arc<dyn Clock>,
    pub ids: Arc<dyn IdGenerator>,
}

/// Mirrors TS `JsonlSessionCreateOptions` (extends `SessionCreateOptions` with
/// `cwd` + `metadata`). The shared [`SessionCreateOptions`] now carries `cwd`
/// + `metadata` as `Option`s (ignored by the in-memory repo); this struct is
/// kept as a typed convenience for the JSONL repo's inherent API so `cwd` is
/// non-optional at the JSONL entry point.
#[derive(Debug, Clone)]
pub struct JsonlSessionCreateOptions {
    pub id: Option<String>,
    pub parent_session_id: Option<String>,
    pub cwd: String,
    pub metadata: Option<serde_json::Map<String, JsonValue>>,
}

impl JsonlSessionCreateOptions {
    /// Build from a shared [`SessionCreateOptions`] + the cwd/metadata the
    /// JSONL repo additionally requires.
    pub fn from_shared(base: &SessionCreateOptions, cwd: String) -> Self {
        Self {
            id: base.id.clone(),
            parent_session_id: base.parent_session_id.clone(),
            cwd,
            metadata: base.metadata.clone(),
        }
    }
}

/// Mirrors TS `JsonlSessionListOptions { cwd? }`. The shared `SessionRepo`
/// trait has no list options, so this is used only by the JSONL repo's inherent
/// typed `list` API.
#[derive(Debug, Clone, Default)]
pub struct JsonlSessionListOptions {
    pub cwd: Option<String>,
}
