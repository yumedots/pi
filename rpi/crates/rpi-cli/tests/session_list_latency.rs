//! The `/session` picker must open fast with a large session directory, and
//! it must not read the session files it does not show.
//!
//! The user's directory holds 2563 sessions, most of them header-only. The
//! picker used to parse every one of them to label its rows, so the read has
//! to stay cheap: one header line per file, and the content of a file only
//! when its row is drawn.

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use rpi_cli::session::{session_display_label, summarize_session_file, SessionSummary};
use rpi_cli::session_index::{
    list_session_rows_with, resolve_titles, SessionContentReader, SessionListRow,
};

/// How many sessions the user's directory holds.
const SESSION_COUNT: usize = 2563;
/// The budget for building the whole list, in milliseconds.
const BUDGET_MS: u64 = 250;
/// How many rows the picker shows at once.
const VISIBLE_ROWS: usize = 10;

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

fn assistant_message(text: &str) -> String {
    format!(
        "{{\"type\":\"message\",\"id\":\"m2\",\"parentId\":\"m1\",\"timestamp\":\"2026-10-20T10:00:02.000Z\",\"message\":{{\"role\":\"assistant\",\"content\":[{{\"type\":\"text\",\"text\":\"{text}\"}}]}}}}\n"
    )
}

fn session_info(name: &str) -> String {
    format!(
        "{{\"type\":\"session_info\",\"id\":\"m3\",\"parentId\":\"m2\",\"timestamp\":\"2026-10-20T10:00:03.000Z\",\"name\":\"{name}\"}}\n"
    )
}

/// Write `count` session files under `dir`, spread over a few cwd
/// subdirectories the way pi stores them. Most are header-only.
fn write_sessions(dir: &Path, count: usize) {
    for index in 0..count {
        let sub = dir.join(format!("--cwd-{}-", index % 5));
        std::fs::create_dir_all(&sub).unwrap();
        let id = format!("{index:08}-0000-4000-8000-000000000000");
        let path = sub.join(format!("2026-10-20T10-00-00-000Z_{id}.jsonl"));
        let mut content = header_line(&id);
        match index % 10 {
            0 => {}
            1 => {
                content.push_str(&user_message("hello world"));
            }
            2 => {
                content.push_str(&user_message("hello world"));
                content.push_str(&assistant_message("hi there"));
            }
            3 => {
                content.push_str(&user_message("hello world"));
                content.push_str(&session_info("named session"));
            }
            _ => {
                content.push_str(&user_message("hello world"));
                for line in 0..8 {
                    content.push_str(&assistant_message(&format!("reply {line}")));
                }
            }
        }
        std::fs::write(path, content).unwrap();
    }
}

/// A reader that counts the session files it parses in full.
struct CountingReader {
    parses: Arc<AtomicUsize>,
}

impl SessionContentReader for CountingReader {
    fn read_summary(&self, path: &Path) -> SessionSummary {
        self.parses.fetch_add(1, Ordering::SeqCst);
        summarize_session_file(path)
    }
}

/// The rows of the list, read through a counting reader.
fn counted_rows(dir: &Path) -> (Vec<Arc<SessionListRow>>, Arc<AtomicUsize>) {
    let parses = Arc::new(AtomicUsize::new(0));
    let reader = CountingReader {
        parses: parses.clone(),
    };
    let rows = list_session_rows_with(dir, Arc::new(reader));
    (rows, parses)
}

#[test]
fn the_listing_does_not_read_every_file() {
    let dir = tempfile::tempdir().unwrap();
    write_sessions(dir.path(), 200);

    let (rows, parses) = counted_rows(dir.path());
    assert_eq!(rows.len(), 200);
    assert_eq!(
        parses.load(Ordering::SeqCst),
        0,
        "the listing parsed the session files before it had to"
    );
    assert!(rows.iter().all(|row| !row.is_resolved()));
}

#[test]
fn only_the_rows_the_list_shows_are_read() {
    let dir = tempfile::tempdir().unwrap();
    write_sessions(dir.path(), 200);

    let (rows, parses) = counted_rows(dir.path());
    assert!(resolve_titles(&rows, 0..VISIBLE_ROWS));
    let read = parses.load(Ordering::SeqCst);
    assert!(read > 0, "the visible rows were not read");
    assert!(
        read < rows.len(),
        "the listing read {read} of {} files",
        rows.len()
    );
}

#[test]
fn a_header_only_session_needs_no_read_at_all() {
    let dir = tempfile::tempdir().unwrap();
    write_sessions(dir.path(), 200);

    let (rows, parses) = counted_rows(dir.path());
    let header_only: Vec<_> = rows.iter().filter(|row| row.header_only()).collect();
    assert!(!header_only.is_empty());
    for row in &header_only {
        assert_eq!(row.title(), "(no messages)");
    }
    assert_eq!(
        parses.load(Ordering::SeqCst),
        0,
        "a header-only session was read"
    );
}

#[test]
fn the_visible_titles_match_a_full_parse() {
    let dir = tempfile::tempdir().unwrap();
    write_sessions(dir.path(), 60);

    let (rows, _) = counted_rows(dir.path());
    assert!(resolve_titles(&rows, 0..rows.len()));
    for row in &rows {
        let full = summarize_session_file(row.path());
        assert_eq!(
            row.title(),
            session_display_label(&full),
            "the title of {} differs from a full parse",
            row.path().display()
        );
        assert_eq!(row.timestamp(), "2026-10-20T10:00:00.000Z");
        assert_eq!(row.bytes(), full.bytes);
    }
}

/// The header's timestamp, read the way a full parse reads it: the whole file.
fn full_parse_timestamp(path: &Path) -> String {
    let content = std::fs::read_to_string(path).expect("the session file");
    let header_line = content.lines().next().expect("the header line");
    let header = rpi_harness::session::jsonl::parse_header(header_line).expect("the header");
    header.timestamp
}

#[test]
fn the_visible_timestamps_match_a_full_parse() {
    let dir = tempfile::tempdir().unwrap();
    write_sessions(dir.path(), 60);

    let (rows, _) = counted_rows(dir.path());
    assert!(resolve_titles(&rows, 0..rows.len()));
    for row in &rows {
        assert_eq!(
            row.timestamp(),
            full_parse_timestamp(row.path()),
            "the timestamp of {} differs from a full parse",
            row.path().display()
        );
    }
}

#[test]
fn a_header_only_session_is_recognized_without_reading_it() {
    let dir = tempfile::tempdir().unwrap();
    write_sessions(dir.path(), 20);

    let rows = rpi_cli::session_index::list_session_rows(dir.path());
    assert_eq!(rows.len(), 20);
    let mut header_only = 0;
    for row in &rows {
        let full = summarize_session_file(row.path());
        assert_eq!(
            rpi_cli::session::session_file_is_header_only(row.path()),
            full.empty,
            "the header-only test of {} differs from a full parse",
            row.path().display()
        );
        if full.empty {
            header_only += 1;
        }
    }
    assert!(header_only > 0, "the fixture has no header-only session");
}

#[test]
fn the_visible_titles_carry_the_name_and_the_first_prompt() {
    let dir = tempfile::tempdir().unwrap();
    write_sessions(dir.path(), 60);

    let (rows, _) = counted_rows(dir.path());
    assert!(resolve_titles(&rows, 0..rows.len()));
    assert!(rows.iter().any(|row| row.title() == "named session"));
    assert!(rows.iter().any(|row| row.title() == "hello world"));
}

#[test]
fn session_list_builds_fast_with_2563_sessions() {
    let dir = tempfile::tempdir().unwrap();
    write_sessions(dir.path(), SESSION_COUNT);

    let start = Instant::now();
    let (rows, parses) = counted_rows(dir.path());
    let listed = start.elapsed();
    assert_eq!(rows.len(), SESSION_COUNT);
    assert_eq!(parses.load(Ordering::SeqCst), 0);

    let start = Instant::now();
    resolve_titles(&rows, 0..VISIBLE_ROWS);
    let painted = start.elapsed();

    println!(
        "session list: {} files, listed in {listed:?}, first rows in {painted:?}",
        SESSION_COUNT
    );
    assert!(
        listed < Duration::from_millis(BUDGET_MS),
        "the session list took {listed:?} for {SESSION_COUNT} sessions (budget {BUDGET_MS}ms)"
    );
}

#[test]
#[ignore = "measures a real session directory; set RPI_SESSION_DIR to point at one"]
fn measure_a_real_session_directory() {
    let dir = std::env::var("RPI_SESSION_DIR").unwrap_or_else(|_| {
        let home = std::env::var("HOME").expect("HOME");
        format!("{home}/.pi/agent/sessions")
    });
    let start = Instant::now();
    let rows = rpi_cli::session_index::list_session_rows(Path::new(&dir));
    let listed = start.elapsed();
    let start = Instant::now();
    rpi_cli::session_index::resolve_titles(&rows, 0..VISIBLE_ROWS);
    let painted = start.elapsed();

    // The cost the listing used to pay: a full parse of every session file.
    let start = Instant::now();
    let mut parsed = 0usize;
    for row in &rows {
        let _ = summarize_session_file(row.path());
        parsed += 1;
    }
    let full_parse = start.elapsed();

    println!(
        "{dir}: {} rows, listed in {listed:?}, first rows in {painted:?}, full parse of {parsed} files in {full_parse:?}",
        rows.len()
    );

    // The path the picker used to take: the metadata list over every file,
    // then a full summary of every file. The agent dir holds the sessions, so
    // the old listing is measured through the public entry point.
    if let Some(agent_dir) = std::env::var("RPI_SESSION_AGENT_DIR").ok() {
        std::env::set_var("PI_CODING_AGENT_DIR", &agent_dir);
        let cwd = std::env::var("RPI_SESSION_CWD").unwrap_or_else(|_| "/Users/gabriel/pi".to_string());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("the runtime");
        let start = Instant::now();
        let metas = runtime
            .block_on(rpi_cli::session::list_session_metadata(&cwd))
            .expect("the metadata list");
        let metadata_ms = start.elapsed();
        let start = Instant::now();
        for meta in &metas {
            let _ = summarize_session_file(Path::new(&meta.path));
        }
        let summaries_ms = start.elapsed();
        println!(
            "old path: {} files, metadata list in {metadata_ms:?}, full summaries in {summaries_ms:?}",
            metas.len()
        );
    }

    if let Ok(dump) = std::env::var("RPI_SESSION_DUMP") {
        let mut out = String::new();
        for row in &rows {
            out.push_str(&format!(
                "{}\t{}\t{}\t{}\n",
                row.id(),
                row.title(),
                row.timestamp(),
                row.path().display()
            ));
        }
        std::fs::write(dump, out).expect("the dump file");
    }
}
