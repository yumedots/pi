//! The session list's index — one header read per file, and titles resolved
//! only for the rows that are drawn.
//!
//! The original lists a session directory by reading each file's first line
//! (its header) and then reading the files it shows
//! (`packages/coding-agent/src/core/session-manager.ts:685`
//! `readSessionHeader`, `:803` `buildSessionInfo`). The port parsed *every*
//! session file to build a preview for every row, so a directory with a few
//! thousand sessions froze the picker.
//!
//! Two things live here:
//!
//! - the **index**: one bounded read of the header line per file, carrying the
//!   id, the timestamp, the cwd and whether the file holds anything but its
//!   header;
//! - the **row**: the index plus a title that is resolved on demand, through
//!   an injectable [`SessionContentReader`] so a test can count the parses.

use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use crate::session::{session_display_label, SessionSummary};

/// Bytes read from the head of a session file to get its header line. The
/// header is one short line, so one small chunk is enough for every session;
/// the buffer only grows for a file whose header line is longer.
const HEADER_READ_BYTES: usize = 8 * 1024;
/// The most the header scan reads, so a file without a header line cannot
/// pull the whole log into memory.
const HEADER_SCAN_LIMIT: usize = 1024 * 1024;

/// The label a session with no messages shows, the original's marker
/// (`packages/coding-agent/src/core/session-manager.ts:874`).
const NO_MESSAGES_LABEL: &str = "(no messages)";

/// The facts a session file's own header carries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionIndexEntry {
    /// The session file.
    pub path: PathBuf,
    /// The session id (the header's `id`).
    pub id: String,
    /// The session's creation time (the header's ISO-8601 `timestamp`).
    pub timestamp: String,
    /// The session's creation time in milliseconds since the Unix epoch.
    pub created_at: i64,
    /// The working directory the session ran in (the header's `cwd`).
    pub cwd: String,
    /// The file's size in bytes.
    pub bytes: u64,
    /// The file's modification time, in milliseconds since the Unix epoch.
    pub modified_at: i64,
    /// The file holds nothing but its header: no messages and no name.
    pub header_only: bool,
}

impl SessionIndexEntry {
    /// The metadata of this session file, for the paths that open a session.
    pub fn metadata(&self) -> rpi_harness::session::jsonl::JsonlSessionMetadata {
        rpi_harness::session::jsonl::JsonlSessionMetadata {
            id: self.id.clone(),
            created_at: self.created_at,
            cwd: self.cwd.clone(),
            path: self.path.to_string_lossy().into_owned(),
            modified_at: self.modified_at,
            source_format: rpi_harness::session::jsonl::JsonlSourceFormat::V3,
            parent_session_id: None,
        }
    }
}

/// Read one session file's header and return what it says.
///
/// Returns `None` when the file cannot be read or its first line is not a
/// session header: the original drops such a file from the list
/// (`packages/coding-agent/src/core/session-manager.ts:836`).
pub fn read_session_index_entry(path: &Path) -> Option<SessionIndexEntry> {
    let metadata = std::fs::metadata(path).ok();
    let bytes = metadata.as_ref().map(|meta| meta.len()).unwrap_or(0);
    let modified_at = metadata
        .as_ref()
        .and_then(|meta| meta.modified().ok())
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|since| since.as_millis() as i64)
        .unwrap_or(0);
    read_session_index_entry_with_stats(path, bytes, modified_at)
}

/// The header of a session file, with the file's size and modification time
/// already known (the listing stats every file once).
fn read_session_index_entry_with_stats(
    path: &Path,
    bytes: u64,
    modified_at: i64,
) -> Option<SessionIndexEntry> {
    use std::io::Read;

    let mut file = std::fs::File::open(path).ok()?;
    let mut head = Vec::with_capacity(HEADER_READ_BYTES);
    let mut newline = None;
    while head.len() < HEADER_SCAN_LIMIT {
        let mut chunk = vec![0u8; HEADER_READ_BYTES];
        let read = file.read(&mut chunk).unwrap_or(0);
        chunk.truncate(read);
        if chunk.is_empty() {
            break;
        }
        let base = head.len();
        head.extend_from_slice(&chunk);
        newline = head[base..].iter().position(|byte| *byte == b'\n');
        if newline.is_some() {
            newline = Some(base + newline.unwrap());
            break;
        }
    }
    let head = &head[..];
    let header_len = newline.unwrap_or(head.len());
    let line = String::from_utf8_lossy(&head[..header_len]).into_owned();
    let header = rpi_harness::session::jsonl::parse_header(&line).ok()?;
    Some(SessionIndexEntry {
        path: path.to_path_buf(),
        id: header.id,
        timestamp: header.timestamp.clone(),
        created_at: rpi_harness::session::types::ms_from_iso_timestamp(&header.timestamp).unwrap_or(0),
        cwd: header.cwd,
        bytes,
        modified_at,
        header_only: bytes <= header_len as u64 + 1,
    })
}

/// The session files under `dir`, newest first by modification time.
///
/// The layout is the one the port's pickers scan: the `.jsonl` files directly
/// under `dir` and the ones in its immediate subdirectories (one level, the
/// cwd-encoded project directories).
pub fn list_session_index(dir: &Path) -> Vec<SessionIndexEntry> {
    let mut files: Vec<(PathBuf, u64, i64)> = Vec::new();
    let mut visit = |path: PathBuf| {
        if path.extension().and_then(|extension| extension.to_str()) != Some("jsonl") {
            return;
        }
        let Ok(metadata) = std::fs::metadata(&path) else {
            return;
        };
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|since| since.as_millis() as i64)
            .unwrap_or(0);
        files.push((path, metadata.len(), modified_at));
    };
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Ok(inner) = std::fs::read_dir(&path) {
                    for child in inner.flatten() {
                        visit(child.path());
                    }
                }
            } else {
                visit(path);
            }
        }
    }
    files.sort_by(|left, right| right.2.cmp(&left.2));
    files
        .into_iter()
        .filter_map(|(path, bytes, modified_at)| {
            read_session_index_entry_with_stats(&path, bytes, modified_at)
        })
        .collect()
}

/// Reads a session file's content.
///
/// Injected into the rows so a test can count the full parses the listing
/// does.
pub trait SessionContentReader: Send + Sync {
    /// The full parse of one session file.
    fn read_summary(&self, path: &Path) -> SessionSummary;
}

/// The real reader: the bounded head and tail read of the session file.
pub struct FileSessionContentReader;

impl SessionContentReader for FileSessionContentReader {
    fn read_summary(&self, path: &Path) -> SessionSummary {
        crate::session::summarize_session_file(path)
    }
}

/// One row of the session list: the header index plus a title that is
/// resolved only when the row is drawn.
#[derive(Clone)]
pub struct SessionListRow {
    index: SessionIndexEntry,
    reader: Arc<dyn SessionContentReader>,
    summary: OnceLock<SessionSummary>,
}

impl std::fmt::Debug for SessionListRow {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SessionListRow")
            .field("index", &self.index)
            .field("resolved", &self.is_resolved())
            .finish()
    }
}

impl SessionListRow {
    /// A row over `index`, reading its content through `reader`.
    pub fn new(index: SessionIndexEntry, reader: Arc<dyn SessionContentReader>) -> Self {
        Self {
            index,
            reader,
            summary: OnceLock::new(),
        }
    }

    /// The row's header facts.
    pub fn index(&self) -> &SessionIndexEntry {
        &self.index
    }

    /// The session file.
    pub fn path(&self) -> &Path {
        &self.index.path
    }

    /// The session id.
    pub fn id(&self) -> &str {
        &self.index.id
    }

    /// The session's creation time, the header's ISO-8601 timestamp.
    pub fn timestamp(&self) -> &str {
        &self.index.timestamp
    }

    /// The session file's size in bytes.
    pub fn bytes(&self) -> u64 {
        self.index.bytes
    }

    /// Whether the file holds nothing but its header.
    pub fn header_only(&self) -> bool {
        self.index.header_only
    }

    /// Whether the row's content has been read already.
    pub fn is_resolved(&self) -> bool {
        self.summary.get().is_some()
    }

    /// The row's full summary. Reading it is the parse the listing avoids.
    pub fn summary(&self) -> &SessionSummary {
        self.summary
            .get_or_init(|| self.reader.read_summary(&self.index.path))
    }

    /// The row's title: its name, else its first prompt, else the marker.
    ///
    /// A session with nothing but its header needs no read at all: the marker
    /// is what the original shows for it
    /// (`packages/coding-agent/src/core/session-manager.ts:874`).
    pub fn title(&self) -> String {
        if self.index.header_only {
            return NO_MESSAGES_LABEL.to_string();
        }
        session_display_label(self.summary())
    }

    /// The row's title when it has been read already, without reading it.
    ///
    /// A session with nothing but its header always has one: the marker.
    pub fn resolved_title(&self) -> Option<String> {
        if self.index.header_only {
            return Some(NO_MESSAGES_LABEL.to_string());
        }
        self.summary.get().map(session_display_label)
    }

    /// The row's name, if it recorded one.
    pub fn name(&self) -> Option<String> {
        self.summary
            .get()
            .and_then(|summary| summary.name.as_deref())
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
    }
}

/// The session list: the rows, newest first.
pub fn list_session_rows(dir: &Path) -> Vec<Arc<SessionListRow>> {
    list_session_rows_with(dir, Arc::new(FileSessionContentReader))
}

/// The session list, reading the rows' content through `reader`.
pub fn list_session_rows_with(
    dir: &Path,
    reader: Arc<dyn SessionContentReader>,
) -> Vec<Arc<SessionListRow>> {
    list_session_index(dir)
        .into_iter()
        .map(|index| Arc::new(SessionListRow::new(index, reader.clone())))
        .collect()
}

/// Resolve the titles of the rows in `range`, and only those.
///
/// Returns `true` when a row had to be read, so the caller knows the rows it
/// drew changed.
pub fn resolve_titles(rows: &[Arc<SessionListRow>], range: Range<usize>) -> bool {
    let end = range.end.min(rows.len());
    let start = range.start.min(end);
    let mut resolved = false;
    for row in &rows[start..end] {
        if !row.header_only() && !row.is_resolved() {
            row.title();
            resolved = true;
        }
    }
    resolved
}

/// Resolve the titles of every row, and only those.
pub fn resolve_all_titles(rows: &[Arc<SessionListRow>]) -> bool {
    resolve_titles(rows, 0..rows.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn header_line(id: &str) -> String {
        format!(
            "{{\"type\":\"session\",\"version\":3,\"id\":\"{id}\",\"timestamp\":\"2026-10-20T10:00:00.000Z\",\"cwd\":\"/tmp/work\"}}\n"
        )
    }

    fn user_message(text: &str) -> String {
        format!(
            "{{\"type\":\"message\",\"id\":\"m1\",\"parentId\":null,\"timestamp\":\"2026-10-20T10:00:01.000Z\",\"message\":{{\"role\":\"user\",\"content\":[{{\"type\":\"text\",\"text\":\"{text}\"}}]}}}}\n"
        )
    }

    fn write_file(path: &Path, body: &str) {
        std::fs::write(path, body).unwrap();
    }

    #[test]
    fn the_index_reads_only_the_header() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("2026-10-20T10-00-00-000Z_abc.jsonl");
        write_file(&path, &format!("{}{}", header_line("abc"), user_message("hello")));
        let entry = read_session_index_entry(&path).unwrap();
        assert_eq!(entry.id, "abc");
        assert_eq!(entry.timestamp, "2026-10-20T10:00:00.000Z");
        assert_eq!(entry.cwd, "/tmp/work");
        assert!(!entry.header_only);
    }

    #[test]
    fn a_header_only_file_is_recognized_without_reading_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("2026-10-20T10-00-00-000Z_abc.jsonl");
        write_file(&path, &header_line("abc"));
        let entry = read_session_index_entry(&path).unwrap();
        assert!(entry.header_only);
        assert_eq!(entry.bytes, header_line("abc").len() as u64);
    }

    #[test]
    fn a_file_without_a_session_header_is_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("broken.jsonl");
        write_file(&path, "{\"type\":\"message\"}\n");
        assert!(read_session_index_entry(&path).is_none());
    }

    #[test]
    fn the_listing_reads_no_file_in_full() {
        let dir = tempfile::tempdir().unwrap();
        for index in 0..40 {
            let path = dir.path().join(format!("2026-10-20T10-00-00-000Z_{index}.jsonl"));
            if index % 2 == 0 {
                write_file(&path, &header_line(&format!("{index}")));
            } else {
                write_file(&path, &format!("{}{}", header_line(&format!("{index}")), user_message("hello")));
            }
        }
        let counter = Arc::new(AtomicUsize::new(0));
        let reader = CountingReader {
            counter: counter.clone(),
        };
        let mut rows = list_session_rows_with(dir.path(), Arc::new(reader));
        assert_eq!(rows.len(), 40);
        assert_eq!(counter.load(Ordering::SeqCst), 0, "the listing read a file");
        assert!(rows.iter().all(|row| !row.is_resolved()));
    }

    #[test]
    fn a_header_only_row_needs_no_read() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("2026-10-20T10-00-00-000Z_abc.jsonl");
        write_file(&path, &header_line("abc"));
        let counter = Arc::new(AtomicUsize::new(0));
        let reader = CountingReader {
            counter: counter.clone(),
        };
        let rows = list_session_rows_with(dir.path(), Arc::new(reader));
        assert_eq!(rows[0].title(), NO_MESSAGES_LABEL);
        assert_eq!(counter.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn the_resolved_title_matches_a_full_parse() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("2026-10-20T10-00-00-000Z_abc.jsonl");
        write_file(&path, &format!("{}{}", header_line("abc"), user_message("hello world")));
        let rows = list_session_rows(dir.path());
        assert_eq!(rows[0].title(), "hello world");
        let full = crate::session::summarize_session_file(&path);
        assert_eq!(rows[0].title(), session_display_label(&full));
        assert_eq!(rows[0].timestamp(), "2026-10-20T10:00:00.000Z");
    }

    struct CountingReader {
        counter: Arc<AtomicUsize>,
    }

    impl SessionContentReader for CountingReader {
        fn read_summary(&self, path: &Path) -> SessionSummary {
            self.counter.fetch_add(1, Ordering::SeqCst);
            crate::session::summarize_session_file(path)
        }
    }
}
