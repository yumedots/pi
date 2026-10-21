//! Editor component for multi-line text editing.
//!
//! Provides a text editor with cursor positioning, selection, and keyboard input.

use std::any::Any;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::sync::{Arc, Mutex};

use crossterm::event::{KeyCode, KeyModifiers};
use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

use super::component::{Component, Focusable, MouseButton, MouseEvent, MouseEventKind, MouseEventResult};
use super::keybindings::Keybindings;
use crate::ansi::CURSOR_MARKER;
use crate::kill_ring::{KillRing, PushOptions};
use crate::undo_stack::UndoStack;

/// Editor style configuration.
#[derive(Debug, Clone)]
pub struct EditorStyle {
    pub prompt: String,
    pub placeholder: String,
}

impl Default for EditorStyle {
    fn default() -> Self {
        Self {
            prompt: "> ".to_string(),
            placeholder: String::new(),
        }
    }
}

/// Editor options.
#[derive(Debug, Clone, Default)]
pub struct EditorOptions {
    /// Padding on left and right.
    pub padding_x: usize,
    /// Maximum visible lines for autocomplete.
    pub autocomplete_max_visible: usize,
    /// Placeholder text when empty.
    pub placeholder: Option<String>,
    /// Initial text content.
    pub initial_text: Option<String>,
    /// Number of content rows the box always shows. The text scrolls inside
    /// the box, so the views around it do not resize while typing.
    pub content_height: Option<usize>,
    /// Largest number of content rows the box shows. The box grows with the
    /// text up to this height, then the overflow scrolls inside it.
    pub max_content_height: Option<usize>,
    /// Whether the box reports how many lines are hidden above and below it.
    pub show_scroll_hints: bool,
}

/// Editor state.
#[derive(Debug, Clone)]
struct EditorState {
    /// Lines of text.
    lines: Vec<String>,
    /// Cursor row (line index).
    cursor_row: usize,
    /// Cursor column (character index within line).
    cursor_col: usize,
    /// Selection anchor (row, col) if any.
    selection_anchor: Option<(usize, usize)>,
    /// Scroll offset for multi-line.
    #[allow(dead_code)]
    scroll_offset: usize,
    /// Whether the editor is focused.
    focused: bool,
    /// History of submitted lines.
    history: Vec<String>,
    /// History index for navigation.
    history_index: usize,
}

impl Default for EditorState {
    fn default() -> Self {
        Self {
            lines: vec![String::new()],
            cursor_row: 0,
            cursor_col: 0,
            selection_anchor: None,
            scroll_offset: 0,
            focused: false,
            history: Vec::new(),
            history_index: 0,
        }
    }
}

/// Greatest char-boundary byte index in `s` that is `<= idx` (clamped to
/// `s.len()`). The editor tracks `cursor_col` as a **byte** index and keeps it
/// on a char boundary; this helper restores that invariant when a caller
/// supplies a column that may be mid-character (e.g. clamping after moving
/// across lines of differing widths) and when converting external char counts.
///
/// Why byte indices: every `String` mutation the editor performs
/// (`insert`, `remove`, `truncate`, `drain`) and the `len()` comparisons used
/// for clamping are byte-indexed in `std`. Treating `cursor_col` as a byte
/// offset (advanced by `ch.len_utf8()`, never `+1`) keeps all of those sound
/// for multibyte input. Movement ops use this helper to step by *character*
/// while storing bytes.
fn snap_boundary(s: &str, idx: usize) -> usize {
    let idx = idx.min(s.len());
    // A valid char boundary (including the END of the string) is kept as-is —
    // the old `take_while(b <= idx)` returned the START of the char AT `idx`
    // for boundary positions, so a caret placed exactly after the last char
    // (e.g. autocomplete accept: `set_cursor(0, len)`) snapped one char EARLY
    // and the terminal showed "/mode|l" with the final char dangling past the
    // caret. Mid-character positions snap DOWN to the char start instead.
    if s.is_char_boundary(idx) {
        return idx;
    }
    s.char_indices()
        .take_while(|(b, _)| *b < idx)
        .last()
        .map(|(b, _)| b)
        .unwrap_or(0)
}

/// A folded store of a large paste, keyed by the id rendered in its marker.
/// The document (`EditorState::lines`) only ever carries the short
/// `[paste #id …]` marker; the real text lives here until the draft is
/// submitted, at which point [`Editor::get_expanded_text`] splices it back in.
#[derive(Debug, Clone)]
struct PasteEntry {
    content: String,
}

/// Matches a whole `[paste #id …]` marker (group 1 = id).
fn paste_marker_regex() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]").unwrap())
}

/// The byte length of the `[paste #id …]` marker ending exactly at `end`
/// (`end` is a byte offset in `line`), or `0` when no marker ends there.
fn paste_marker_len_ending_at(line: &str, end: usize) -> usize {
    for m in paste_marker_regex().find_iter(line) {
        if m.end() == end {
            return m.as_str().len();
        }
    }
    0
}

/// A paste folds when it exceeds either threshold (upstream's `handlePaste`).
const PASTE_FOLD_LINE_THRESHOLD: usize = 10;
const PASTE_FOLD_CHAR_THRESHOLD: usize = 1000;

/// Replace every `[paste #id …]` marker in `document` with its stashed body
/// (upstream's `expandPasteMarkers`). Markers whose id is absent from
/// `pastes` are left as-is so a stray marker never silently vanishes.
fn expand_paste_markers(document: &str, pastes: &HashMap<u32, PasteEntry>) -> String {
    if pastes.is_empty() || !document.contains("[paste #") {
        return document.to_string();
    }
    paste_marker_regex()
        .replace_all(document, |caps: &regex::Captures| {
            let id: u32 = caps[1].parse().unwrap_or(0);
            match pastes.get(&id) {
                Some(entry) => entry.content.clone(),
                None => caps[0].to_string(),
            }
        })
        .into_owned()
}

/// Decode the kitty CSI-u form a client may emit for `Ctrl+<letter>`
/// (`ESC[<code>;5u`), which upstream decodes before folding
/// (`handlePaste`). Scalars that are not a `Ctrl+letter` chord are left as-is.
fn decode_csi_u_ctrl(text: &str) -> String {
    if !text.contains("\x1b[") {
        return text.to_string();
    }
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r"\x1b\[(\d+);5u").unwrap());
    re.replace_all(text, |caps: &regex::Captures| {
        let code: u32 = caps[1].parse().unwrap_or(0);
        let lower = 0x61..=0x7a;
        let upper = 0x41..=0x5a;
        if lower.contains(&code) {
            char::from_u32(code - 96)
                .map(String::from)
                .unwrap_or_default()
        } else if upper.contains(&code) {
            char::from_u32(code - 64)
                .map(String::from)
                .unwrap_or_default()
        } else {
            caps[0].to_string()
        }
    })
    .into_owned()
}

/// The segments of a logical line: graphemes, with a folded-paste marker kept
/// whole so it never breaks across a row.
fn editor_line_segments(line: &str) -> Vec<(usize, &str)> {
    let mut segments: Vec<(usize, &str)> = Vec::new();
    let mut last = 0usize;
    for capture in paste_marker_regex().find_iter(line) {
        push_graphemes(&line[last..capture.start()], last, &mut segments);
        segments.push((capture.start(), capture.as_str()));
        last = capture.end();
    }
    push_graphemes(&line[last..], last, &mut segments);
    segments
}

fn push_graphemes<'a>(text: &'a str, offset: usize, segments: &mut Vec<(usize, &'a str)>) {
    for (index, grapheme) in text.grapheme_indices(true) {
        segments.push((offset + index, grapheme));
    }
}

/// Split a logical editor line into terminal-width chunks. The editor keeps
/// logical lines for editing and cursor movement; wrapping is strictly a
/// rendering concern so a long draft cannot escape the bordered input box.
///
/// The split happens at word boundaries: a word that does not fit moves whole
/// to the next row, and only a word wider than the row is broken. A CJK run
/// may break between two characters.
fn wrap_line_ranges(line: &str, max_width: usize) -> Vec<(usize, usize)> {
    if line.is_empty() || max_width == 0 {
        return vec![(0, 0)];
    }
    if crate::ansi::visible_width(line) <= max_width {
        return vec![(0, line.len())];
    }

    let segments = editor_line_segments(line);
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    let mut current_width = 0usize;
    let mut start = 0usize;
    let mut wrap_opportunity: Option<(usize, usize)> = None;

    for (position, (index, grapheme)) in segments.iter().enumerate() {
        let grapheme_width = crate::ansi::visible_width(grapheme);
        let is_whitespace = grapheme.chars().any(char::is_whitespace);

        if current_width + grapheme_width > max_width {
            let backtrack = wrap_opportunity
                .filter(|(_, width)| current_width - width + grapheme_width <= max_width);
            if let Some((opportunity, width)) = backtrack {
                ranges.push((start, opportunity));
                start = opportunity;
                current_width -= width;
            } else if wrap_opportunity.is_none() && start < *index {
                ranges.push((start, *index));
                start = *index;
                current_width = 0;
            }
            wrap_opportunity = None;
        }

        if grapheme_width > max_width {
            ranges.push((start, index + grapheme.len()));
            start = index + grapheme.len();
            current_width = 0;
            wrap_opportunity = None;
            continue;
        }

        current_width += grapheme_width;

        let next = segments.get(position + 1);
        if let Some((next_index, next_grapheme)) = next {
            let next_is_whitespace = next_grapheme.chars().any(char::is_whitespace);
            if is_whitespace && !next_is_whitespace {
                wrap_opportunity = Some((*next_index, current_width));
            } else if !is_whitespace
                && !next_is_whitespace
                && (crate::utils::is_cjk_break(grapheme)
                    || crate::utils::is_cjk_break(next_grapheme))
            {
                wrap_opportunity = Some((*next_index, current_width));
            }
        }
    }
    ranges.push((start, line.len()));
    ranges
}

/// Copy one escape sequence (CSI, OSC, APC or a two-byte escape) verbatim.
fn copy_escape_sequence(chars: &mut std::iter::Peekable<std::str::Chars<'_>>, out: &mut String) {
    out.push('\x1b');
    match chars.next() {
        Some('[') => {
            out.push('[');
            while let Some(c) = chars.next() {
                out.push(c);
                if ('@'..='~').contains(&c) {
                    break;
                }
            }
        }
        Some(c @ (']' | '_' | 'P' | '^')) => {
            out.push(c);
            while let Some(c) = chars.next() {
                out.push(c);
                if c == '\x07' {
                    break;
                }
                if c == '\x1b' {
                    match chars.next() {
                        Some('\\') => {
                            out.push('\\');
                            break;
                        }
                        Some(other) => out.push(other),
                        None => break,
                    }
                }
            }
        }
        Some(c) => out.push(c),
        None => {}
    }
}

/// Insert the zero-width cursor marker at a visible column without slicing
/// through ANSI escape sequences added for selection/placeholder styling.
fn insert_cursor_marker(text: &str, column: usize) -> String {
    let mut out = String::with_capacity(text.len() + CURSOR_MARKER.len());
    let mut visible = 0;
    let mut chars = text.chars().peekable();
    let mut inserted = false;
    while let Some(ch) = chars.next() {
        if ch == '\x1b' {
            copy_escape_sequence(&mut chars, &mut out);
            continue;
        }
        if !inserted && visible >= column {
            out.push_str(CURSOR_MARKER);
            inserted = true;
        }
        out.push(ch);
        visible += UnicodeWidthStr::width(ch.to_string().as_str());
    }
    if !inserted {
        out.push_str(CURSOR_MARKER);
    }
    out
}

/// A rendered row of the editor: one wrapped chunk of a logical line.
struct LayoutChunk {
    /// The logical row the chunk belongs to.
    row: usize,
    /// The byte range of the chunk inside the logical row.
    start: usize,
    end: usize,
    /// The byte offset of the caret inside the chunk, when the caret is on
    /// this row.
    cursor: Option<usize>,
}

/// The caret decoration of a chunk: the hardware cursor marker followed by
/// the fake cursor around the grapheme under the caret. The TUI turns the
/// fake cursor into reverse video, or drops it when the hardware cursor
/// already sits on the cell.
fn caret_decoration(content: &str, cursor_byte: usize, focused: bool) -> String {
    let split = content
        .char_indices()
        .find(|(index, _)| *index >= cursor_byte)
        .map(|(index, _)| index)
        .unwrap_or(content.len());
    let (before, rest) = content.split_at(split);
    let (caret, after) = match rest.graphemes(true).next() {
        Some(grapheme) => (grapheme, &rest[grapheme.len()..]),
        None => (" ", ""),
    };
    let marker = if focused { CURSOR_MARKER } else { "" };
    format!(
        "{before}{marker}{}{caret}{}{after}",
        crate::ansi::FAKE_CURSOR_START,
        crate::ansi::FAKE_CURSOR_END
    )
}

/// Editor - A multi-line text editor component.
pub struct Editor {
    state: Mutex<EditorState>,
    options: EditorOptions,
    style: EditorStyle,
    #[allow(dead_code)]
    keybindings: Arc<Keybindings>,
    on_submit: Mutex<Option<Arc<dyn Fn(&str) + Send + Sync>>>,
    on_change: Mutex<Option<Arc<dyn Fn(&str) + Send + Sync>>>,
    /// Undo history (text + caret snapshots). Pushed before each mutation;
    /// consecutive character insertions coalesce into one entry.
    undo_stack: Mutex<UndoStack<EditorSnapshot>>,
    /// Popped undo entries, for Ctrl+R redo.
    redo_stack: Mutex<Vec<EditorSnapshot>>,
    /// Emacs-style kill ring for Ctrl+K/U/W kills; Ctrl+Y yanks.
    kill_ring: Mutex<KillRing>,
    /// The last mutation kind, for undo coalescing + kill accumulation.
    last_action: Mutex<Option<&'static str>>,
    /// Character-jump mode (pi `jumpForward`/`jumpBackward`): `Some(1)` waits
    /// for the next printable char to jump forward to, `Some(-1)` backward.
    /// The next character input consumes it instead of inserting.
    jump_mode: Mutex<Option<i32>>,
    /// Working indicator text shown on the card's top row. `None` means idle.
    /// When `Some`, the top row renders the spinner + elapsed + message
    /// instead of a blank row (pi's working-inside-input-border style).
    working: Mutex<Option<WorkingState>>,
    /// Folded pastes: `id -> content`, referenced by a `[paste #id …]` marker
    /// in `state.lines`. Mirrors upstream's `pastes` map.
    pastes: Mutex<HashMap<u32, PasteEntry>>,
    /// Monotonic id source for [`Self::pastes`] (upstream's `pasteCounter`).
    paste_counter: Mutex<u32>,
    /// First content row the box shows. The text above it is hidden.
    scroll_offset: Mutex<usize>,
    /// The view was scrolled away from the caret with the mouse wheel, so it
    /// stays where it is until the next key press moves the caret back.
    scroll_pinned: Mutex<bool>,
    /// Number of content rows the last render showed, and the number of rows
    /// the text has. The wheel scrolls by the difference.
    rendered_rows: Mutex<(usize, usize)>,
    /// The width the last render laid the text out at, for the mouse to map
    /// a clicked column back to a caret position.
    rendered_width: Mutex<usize>,
}

/// State for the working indicator embedded in the editor's top border.
#[derive(Debug, Clone)]
pub struct WorkingState {
    /// Spinner animation frame index.
    pub frame: usize,
    /// When the working state started (for elapsed time display).
    pub started_at: std::time::Instant,
    /// The message to display (e.g. "Working…").
    pub message: String,
}

/// A restorable editor state snapshot (text + caret, plus the folded paste
/// store so undo can resurrect a marker's content). Selection/scroll/focus
/// are not part of undo (mirrors the TS `EditorSnapshot`).
#[derive(Clone)]
struct EditorSnapshot {
    lines: Vec<String>,
    cursor_row: usize,
    cursor_col: usize,
    pastes: HashMap<u32, PasteEntry>,
    paste_counter: u32,
}

impl Editor {
    /// Create a new editor with options.
    pub fn new(options: EditorOptions, style: EditorStyle, keybindings: Arc<Keybindings>) -> Self {
        let mut state = EditorState::default();
        if let Some(text) = &options.initial_text {
            state.lines = text.split('\n').map(|s| s.to_string()).collect();
            if state.lines.is_empty() {
                state.lines.push(String::new());
            }
        }

        Self {
            state: Mutex::new(state),
            options,
            style,
            keybindings,
            on_submit: Mutex::new(None),
            on_change: Mutex::new(None),
            undo_stack: Mutex::new(UndoStack::with_max_size(200)),
            redo_stack: Mutex::new(Vec::new()),
            kill_ring: Mutex::new(KillRing::new()),
            last_action: Mutex::new(None),
            jump_mode: Mutex::new(None),
            working: Mutex::new(None),
            pastes: Mutex::new(HashMap::new()),
            paste_counter: Mutex::new(0),
            scroll_offset: Mutex::new(0),
            scroll_pinned: Mutex::new(false),
            rendered_rows: Mutex::new((0, 0)),
            rendered_width: Mutex::new(0),
        }
    }

    /// The number of content rows the box shows.
    ///
    /// A fixed box keeps its height, a capped box grows with the text up to
    /// the cap, and without either the box grows with the content.
    fn height_limit(&self) -> usize {
        self.options
            .content_height
            .or(self.options.max_content_height)
            .unwrap_or(usize::MAX)
            .max(1)
    }

    /// Create a new editor with default options.
    pub fn simple() -> Self {
        Self::new(
            EditorOptions::default(),
            EditorStyle::default(),
            Arc::new(Keybindings::new()),
        )
    }

    /// Set the text content.
    pub fn set_text(&self, text: &str) {
        self.set_text_placed(text, false);
    }

    /// Set the text content with the caret at its start.
    ///
    /// The history recall uses this, so a recalled entry can be edited from
    /// the beginning (the original's `setTextInternal(text, "start")`).
    pub fn set_text_at_start(&self, text: &str) {
        self.set_text_placed(text, true);
    }

    fn set_text_placed(&self, text: &str, at_start: bool) {
        let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
        if let Ok(mut state) = self.state.lock() {
            state.lines = if normalized.is_empty() {
                vec![String::new()]
            } else {
                normalized.split('\n').map(|s| s.to_string()).collect()
            };
            if state.lines.is_empty() {
                state.lines.push(String::new());
            }
            if at_start {
                state.cursor_row = 0;
                state.cursor_col = 0;
            } else {
                state.cursor_row = state.lines.len() - 1;
                state.cursor_col = state.lines[state.cursor_row].len();
            }
        }
        // A programmatic replacement discards any folded pastes: the new text
        // is the whole truth (mirrors upstream's `setText` clearing `pastes`).
        self.reset_pastes();
        if let Ok(mut guard) = self.scroll_offset.lock() {
            *guard = 0;
        }
        if let Ok(mut guard) = self.scroll_pinned.lock() {
            *guard = false;
        }
        // Mirrors native `setTextInternal`: programmatic replacement is a change.
        self.notify_change();
    }

    /// Get the text content **as shown**: folded large pastes appear as their
    /// `[paste #id …]` marker, not their full body. This is the right source
    /// for UI state that reasons about what is on screen (autocomplete,
    /// empty-checks). Use [`Self::get_expanded_text`] for anything that must
    /// see the user's real content.
    pub fn get_text(&self) -> String {
        self.state
            .lock()
            .map(|s| s.lines.join("\n"))
            .unwrap_or_default()
    }

    /// Get the text content **with folded pastes expanded** (upstream's
    /// `getExpandedText`): every `[paste #id …]` marker is replaced by the full
    /// pasted body. Submission, the external editor and extension reads all go
    /// through here so a folded paste is never sent truncated.
    pub fn get_expanded_text(&self) -> String {
        let document = self.get_text();
        let pastes = self.pastes.lock().map(|p| p.clone()).unwrap_or_default();
        expand_paste_markers(&document, &pastes)
    }

    /// Clear the folded-paste store and reset the id counter.
    fn reset_pastes(&self) {
        if let Ok(mut pastes) = self.pastes.lock() {
            pastes.clear();
        }
        if let Ok(mut counter) = self.paste_counter.lock() {
            *counter = 0;
        }
    }

    /// The folded-paste id whose marker starts exactly at byte offset
    /// `start` on line `row`, if any.
    fn paste_id_at_marker_start(&self, row: usize, start: usize) -> Option<u32> {
        let state = self.state.lock().ok()?;
        let line = state.lines.get(row)?;
        paste_marker_regex()
            .captures_iter(line)
            .find(|caps| caps.get(0).unwrap().start() == start)
            .and_then(|caps| caps[1].parse::<u32>().ok())
    }

    /// Drop a folded paste and renumber the higher ids down by one so the
    /// markers left in the document stay contiguous (upstream renumbers in
    /// `handleBackspace`). Also rewrites the surviving markers in place.
    fn remove_paste(&self, id: u32) {
        {
            let mut pastes = self.pastes.lock().unwrap();
            if pastes.remove(&id).is_none() {
                return;
            }
            let higher: Vec<u32> = pastes.keys().copied().filter(|k| *k > id).collect();
            for old in higher {
                if let Some(entry) = pastes.remove(&old) {
                    pastes.insert(old - 1, entry);
                }
            }
        }
        {
            let mut counter = self.paste_counter.lock().unwrap();
            *counter = counter.saturating_sub(1);
        }
        // Rewrite the markers still in the document: ids above the removed one
        // shift down by one, matching the renumbered store.
        if let Ok(mut state) = self.state.lock() {
            for line in state.lines.iter_mut() {
                *line = paste_marker_regex()
                    .replace_all(line, |caps: &regex::Captures| {
                        let n: u32 = caps[1].parse().unwrap_or(0);
                        if n <= id {
                            caps[0].to_string()
                        } else {
                            // Group 2 already carries the leading space + suffix.
                            let suffix = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                            format!("[paste #{}{suffix}]", n - 1)
                        }
                    })
                    .into_owned();
            }
        }
    }

    /// Fold a pasted block: short pastes are inserted verbatim; a block over
    /// the size threshold is stashed and replaced by a `[paste #id …]` marker
    /// so the input box stays readable. Mirrors upstream's `handlePaste`
    /// (fold when `>10` lines or `>1000` chars).
    ///
    /// A single-line pasted file path is special-cased by the caller (image
    /// attachment), so this only handles text.
    pub fn handle_paste(&self, text: &str) {
        // Decode the CSI-u `Ctrl+<letter>` form a client may hand us, and
        // normalize line endings + tabs (upstream's `normalizeText`).
        let decoded = decode_csi_u_ctrl(text)
            .replace("\r\n", "\n")
            .replace('\r', "\n")
            .replace('\t', "    ");
        // Drop control characters, keeping newlines (upstream filters
        // `char === "\n" || char.charCodeAt(0) >= 32`).
        let filtered: String = decoded
            .chars()
            .filter(|c| *c == '\n' || (*c as u32) >= 32)
            .collect();
        if filtered.is_empty() {
            return;
        }

        let line_count = filtered.split('\n').count();
        let char_count = filtered.chars().count();
        if line_count > PASTE_FOLD_LINE_THRESHOLD || char_count > PASTE_FOLD_CHAR_THRESHOLD {
            self.push_undo("insert");
            if self.has_selection() {
                self.delete_selection_no_undo();
            }
            let (id, by_lines, count) = {
                let mut counter = self.paste_counter.lock().unwrap();
                *counter += 1;
                let id = *counter;
                if line_count > PASTE_FOLD_LINE_THRESHOLD {
                    (id, true, line_count)
                } else {
                    (id, false, char_count)
                }
            };
            if let Ok(mut pastes) = self.pastes.lock() {
                pastes.insert(id, PasteEntry { content: filtered });
            }
            let marker = if by_lines {
                format!("[paste #{id} +{count} lines]")
            } else {
                format!("[paste #{id} {count} chars]")
            };
            self.insert_no_undo(&marker);
            *self.last_action.lock().unwrap() = Some("insert");
        } else {
            self.insert(&filtered);
        }
    }

    /// Clear the editor.
    pub fn clear(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.lines = vec![String::new()];
            state.cursor_row = 0;
            state.cursor_col = 0;
            state.selection_anchor = None;
        }
        self.reset_pastes();
        // Upstream's editor notifies change observers for programmatic clears
        // (`setTextInternal`), so derived UI state (bash-mode border color,
        // autocomplete) drops the stale draft. `submit()` relies on this to
        // reset the border after routing a `!command`.
        self.notify_change();
    }

    /// Set callback for when text is submitted (Enter pressed).
    pub fn on_submit(&self, callback: Arc<dyn Fn(&str) + Send + Sync>) {
        if let Ok(mut cb) = self.on_submit.lock() {
            *cb = Some(callback);
        }
    }

    /// Set callback for when text changes.
    pub fn on_change(&self, callback: Arc<dyn Fn(&str) + Send + Sync>) {
        if let Ok(mut cb) = self.on_change.lock() {
            *cb = Some(callback);
        }
    }

    /// Get cursor position.
    pub fn cursor_position(&self) -> (usize, usize) {
        self.state
            .lock()
            .map(|s| (s.cursor_row, s.cursor_col))
            .unwrap_or((0, 0))
    }

    /// Set the cursor position (clamped to text bounds), clearing any
    /// in-progress selection. Used by autocomplete to place the caret after
    /// accepting a suggestion (`set_text` resets the caret to the start).
    ///
    /// `col` is interpreted as a **byte** offset (callers in the autocomplete
    /// path pass byte indices from `String::len`/`char_indices`) and snapped to
    /// the nearest preceding char boundary so multibyte input never lands
    /// mid-character.
    pub fn set_cursor(&self, row: usize, col: usize) {
        if let Ok(mut state) = self.state.lock() {
            let row = row.min(state.lines.len().saturating_sub(1));
            let col = snap_boundary(&state.lines[row], col);
            state.cursor_row = row;
            state.cursor_col = col;
            state.selection_anchor = None;
        }
    }

    /// Snapshot the current text + caret state (for undo/redo), including the
    /// folded-paste store so undo can bring a dropped paste back.
    fn snapshot_state(&self) -> EditorSnapshot {
        let state = self.state.lock().unwrap();
        EditorSnapshot {
            lines: state.lines.clone(),
            cursor_row: state.cursor_row,
            cursor_col: state.cursor_col,
            pastes: self.pastes.lock().map(|p| p.clone()).unwrap_or_default(),
            paste_counter: self.paste_counter.lock().map(|c| *c).unwrap_or(0),
        }
    }

    /// Restore a snapshot, notifying change observers.
    fn restore_state(&self, snap: &EditorSnapshot) {
        if let Ok(mut state) = self.state.lock() {
            state.lines = snap.lines.clone();
            state.cursor_row = snap.cursor_row;
            state.cursor_col = snap.cursor_col;
            // Snapshots don't carry the selection; undo/redo ends it.
            state.selection_anchor = None;
        }
        if let Ok(mut pastes) = self.pastes.lock() {
            *pastes = snap.pastes.clone();
        }
        if let Ok(mut counter) = self.paste_counter.lock() {
            *counter = snap.paste_counter;
        }
        self.notify_change();
    }

    /// Record an undo snapshot before a mutation. `action` names the mutation
    /// kind: consecutive `"insert"` actions coalesce into a single undo entry
    /// (typing a word undoes as one step, mirroring the TS coalescing); any
    /// other mutation starts a fresh entry. A new mutation clears the redo
    /// stack (the classic undo/redo semantics).
    fn push_undo(&self, action: &'static str) {
        let coalesce = action == "insert" && *self.last_action.lock().unwrap() == Some("insert");
        if !coalesce {
            let snap = self.snapshot_state();
            if let Ok(mut stack) = self.undo_stack.lock() {
                stack.push(snap);
            }
            if let Ok(mut redo) = self.redo_stack.lock() {
                redo.clear();
            }
        }
        *self.last_action.lock().unwrap() = Some(action);
    }

    /// Undo the last mutation (Ctrl+-). Restores the prior snapshot; the
    /// undone state moves to the redo stack for Ctrl+R.
    pub fn undo(&self) {
        let popped = self.undo_stack.lock().unwrap().pop();
        let Some(snap) = popped else { return };
        // The current state is the redo target.
        self.redo_stack.lock().unwrap().push(self.snapshot_state());
        self.restore_state(&snap);
        *self.last_action.lock().unwrap() = None;
    }

    /// Redo the last undone mutation (Ctrl+R).
    pub fn redo(&self) {
        let popped = self.redo_stack.lock().unwrap().pop();
        let Some(snap) = popped else { return };
        self.undo_stack.lock().unwrap().push(self.snapshot_state());
        self.restore_state(&snap);
        *self.last_action.lock().unwrap() = None;
    }

    /// Push killed (deleted) text onto the kill ring, accumulating consecutive
    /// kills into one entry (mirrors the TS kill-ring semantics).
    fn kill(&self, text: String, prepend: bool) {
        if text.is_empty() {
            return;
        }
        let accumulate = *self.last_action.lock().unwrap() == Some("kill");
        if let Ok(mut ring) = self.kill_ring.lock() {
            ring.push(
                &text,
                PushOptions {
                    prepend,
                    accumulate,
                },
            );
        }
        *self.last_action.lock().unwrap() = Some("kill");
    }

    /// Yank (paste) the most recent kill at the cursor (Ctrl+Y). Replaces an
    /// active selection.
    pub fn yank(&self) {
        let text = self.kill_ring.lock().unwrap().peek().map(str::to_string);
        let Some(text) = text else { return };
        self.push_undo("yank");
        if self.has_selection() {
            self.delete_selection_no_undo();
        }
        self.insert_no_undo(&text);
        *self.last_action.lock().unwrap() = Some("yank");
    }

    /// Yank-pop: rotate the kill ring and yank the next entry (Alt+Y).
    pub fn yank_pop(&self) {
        if self.kill_ring.lock().unwrap().len() <= 1 {
            return;
        }
        self.kill_ring.lock().unwrap().rotate();
        self.yank();
    }

    // -------------------------------------------------------------------
    // Selection (Shift+arrows select, Ctrl+X/C/V cut/copy/paste).
    // -------------------------------------------------------------------

    /// Whether a selection is active.
    pub fn has_selection(&self) -> bool {
        self.state.lock().unwrap().selection_anchor.is_some()
    }

    /// The ordered selection span `(start_row, start_col, end_row, end_col)`
    /// with start <= end (byte offsets, both on char boundaries).
    fn selection_ordered(&self) -> Option<(usize, usize, usize, usize)> {
        let state = self.state.lock().unwrap();
        let (ar, ac) = state.selection_anchor?;
        let (br, bc) = (state.cursor_row, state.cursor_col);
        Some(if (ar, ac) <= (br, bc) {
            (ar, ac, br, bc)
        } else {
            (br, bc, ar, ac)
        })
    }

    /// The selected text ("\n"-joined across rows), if any.
    pub fn selected_text(&self) -> Option<String> {
        let (sr, sc, er, ec) = self.selection_ordered()?;
        let lines = self.state.lock().unwrap().lines.clone();
        if sr == er {
            Some(lines[sr][sc..ec].to_string())
        } else {
            let mut out = String::new();
            out.push_str(&lines[sr][sc..]);
            for r in sr + 1..er {
                out.push('\n');
                out.push_str(&lines[r]);
            }
            out.push('\n');
            out.push_str(&lines[er][..ec]);
            Some(out)
        }
    }

    /// The selection span on `row`, as `(start_col, end_col)` byte offsets,
    /// for render-time highlighting. `None` when the row is outside the span.
    fn selection_span_on_row(&self, state: &EditorState, row: usize) -> Option<(usize, usize)> {
        let (ar, ac) = state.selection_anchor?;
        let (br, bc) = (state.cursor_row, state.cursor_col);
        let (sr, sc, er, ec) = if (ar, ac) <= (br, bc) {
            (ar, ac, br, bc)
        } else {
            (br, bc, ar, ac)
        };
        if row < sr || row > er {
            return None;
        }
        if sr == er {
            (sc != ec).then_some((sc, ec))
        } else if row == sr {
            (sc < state.lines[row].len()).then_some((sc, state.lines[row].len()))
        } else if row == er {
            (ec > 0).then_some((0, ec))
        } else {
            (!state.lines[row].is_empty()).then_some((0, state.lines[row].len()))
        }
    }

    /// Seed the selection anchor at the current caret (Shift+direction start).
    fn begin_selection(&self) {
        let mut state = self.state.lock().unwrap();
        if state.selection_anchor.is_none() {
            state.selection_anchor = Some((state.cursor_row, state.cursor_col));
        }
    }

    /// Clear the active selection (plain cursor movement / edits).
    fn clear_selection(&self) {
        self.state.lock().unwrap().selection_anchor = None;
    }

    /// Delete the selected span, leaving the caret at its start. Pushes an
    /// undo snapshot; no-op without a selection.
    fn delete_selection(&self) {
        if !self.has_selection() {
            return;
        }
        self.push_undo("edit");
        self.delete_selection_no_undo();
    }

    /// Delete the selected span WITHOUT an undo snapshot (caller pushed one,
    /// e.g. a replace-through-insert coalesced with the insertion).
    fn delete_selection_no_undo(&self) {
        let (sr, sc, er, ec) = match self.selection_ordered() {
            Some(s) => s,
            None => return,
        };
        let mut state = self.state.lock().unwrap();
        if sr == er {
            state.lines[sr].replace_range(sc..ec, "");
            state.cursor_row = sr;
            state.cursor_col = sc;
        } else {
            let mut joined = state.lines[sr][..sc].to_string();
            joined.push_str(&state.lines[er][ec..]);
            state.lines.drain(sr + 1..=er);
            state.lines[sr] = joined;
            state.cursor_row = sr;
            state.cursor_col = sc;
        }
        state.selection_anchor = None;
        drop(state);
        self.notify_change();
    }

    /// Copy the selection onto the kill ring (Ctrl+C). No-op without one.
    pub fn copy_selection(&self) -> bool {
        let Some(text) = self.selected_text() else {
            return false;
        };
        if text.is_empty() {
            return false;
        }
        if let Ok(mut ring) = self.kill_ring.lock() {
            ring.push(&text, PushOptions::default());
        }
        true
    }

    /// Cut the selection (copy + delete, Ctrl+X). Returns whether anything
    /// was cut.
    pub fn cut_selection(&self) -> bool {
        if !self.copy_selection() {
            return false;
        }
        self.delete_selection();
        true
    }

    /// Insert text at cursor position. Replaces an active selection (one undo
    /// step: the snapshot is taken before the selection is deleted).
    pub fn insert(&self, text: &str) {
        self.push_undo("insert");
        if self.has_selection() {
            self.delete_selection_no_undo();
        }
        self.insert_no_undo(text);
    }

    /// Insert without an undo snapshot (caller pushed one — yank/replace
    /// paths). Notifies change observers.
    ///
    /// Line endings are normalized: `\r\n` and a lone `\r` are treated as one
    /// newline. Pasted Windows text (and the `Event::Paste` payload on Unix,
    /// which preserves CRLF) would otherwise insert literal carriage returns
    /// into the line buffer — they render as garbage and break `cursor_col`
    /// arithmetic on the next edit.
    fn insert_no_undo(&self, text: &str) {
        let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
        if let Ok(mut state) = self.state.lock() {
            for ch in normalized.chars() {
                if ch == '\n' {
                    // Split line at cursor
                    let row = state.cursor_row;
                    let col = state.cursor_col;
                    let current_line = &mut state.lines[row];
                    let after = current_line.split_off(col);
                    state.lines.insert(row + 1, after);
                    state.cursor_row += 1;
                    state.cursor_col = 0;
                } else {
                    let row = state.cursor_row;
                    let col = state.cursor_col;
                    state.lines[row].insert(col, ch);
                    // Advance by the BYTE length of the inserted char so
                    // `cursor_col` stays a valid char boundary (and a sound
                    // byte index for the next `String` mutation). The old
                    // `+= 1` was a char count and panicked on multibyte input
                    // the moment a second keystroke landed mid-character.
                    state.cursor_col += ch.len_utf8();
                }
            }
        }
        self.notify_change();
    }

    /// Delete character before cursor (Backspace). With a selection, deletes
    /// the selection instead.
    fn backspace(&self) {
        if self.has_selection() {
            self.delete_selection();
            return;
        }
        // Backspacing over a `[paste #id …]` marker deletes the whole marker
        // (and drops / renumbers the folded pastes). The marker is one atomic
        // unit — the user cannot nibble it into an orphaned placeholder.
        let deleted_marker = {
            let state = self.state.lock().unwrap();
            let row = state.cursor_row;
            (state.cursor_col > 0)
                .then(|| paste_marker_len_ending_at(&state.lines[row], state.cursor_col))
                .filter(|len| *len > 0)
                .map(|len| (row, state.cursor_col - len, len))
        };
        if let Some((row, start, len)) = deleted_marker {
            // Snapshot FIRST: `remove_paste` mutates the paste store and
            // renumbers the surviving markers, so undo must capture the
            // pre-deletion state to be able to bring them all back.
            self.push_undo("edit");
            let id = self.paste_id_at_marker_start(row, start);
            // Delete the marker text BEFORE renumbering, so the renumber pass
            // (which can change a marker's byte length when an id crosses
            // `#10 -> #9`) never has to keep a stale `start..start+len` valid.
            if let Ok(mut state) = self.state.lock() {
                state.lines[row].replace_range(start..start + len, "");
                state.cursor_col = start;
            }
            if let Some(id) = id {
                self.remove_paste(id);
            }
            self.notify_change();
            return;
        }
        self.push_undo("edit");
        if let Ok(mut state) = self.state.lock() {
            if state.cursor_col > 0 {
                let row = state.cursor_row;
                // Step back by the byte length of the char immediately
                // before the cursor, then remove that char. (`remove` takes
                // a byte index and must land on a boundary.) Compute the
                // length through a shared borrow first so the mutable borrow
                // for `remove` is the only outstanding alias.
                let prev_len = state.lines[row][..state.cursor_col]
                    .chars()
                    .last()
                    .map(|c| c.len_utf8())
                    .unwrap_or(0);
                let col = state.cursor_col - prev_len;
                state.lines[row].remove(col);
                state.cursor_col = col;
            } else if state.cursor_row > 0 {
                // Join with previous line
                let row = state.cursor_row;
                let current = state.lines.remove(row);
                state.cursor_row -= 1;
                let prev_row = state.cursor_row;
                state.cursor_col = state.lines[prev_row].len();
                state.lines[prev_row].push_str(&current);
            }
        }
        self.notify_change();
    }

    /// Delete character at cursor (Delete). With a selection, deletes the
    /// selection instead.
    fn delete(&self) {
        if self.has_selection() {
            self.delete_selection();
            return;
        }
        self.push_undo("edit");
        if let Ok(mut state) = self.state.lock() {
            let row = state.cursor_row;
            let line_len = state.lines[row].len();
            if state.cursor_col < line_len {
                let col = state.cursor_col;
                state.lines[row].remove(col);
            } else if row < state.lines.len() - 1 {
                // Join with next line
                let next = state.lines.remove(row + 1);
                state.lines[row].push_str(&next);
            }
        }
        self.notify_change();
    }

    /// Move cursor left.
    fn cursor_left(&self) {
        if let Ok(mut state) = self.state.lock() {
            if state.cursor_col > 0 {
                let row = state.cursor_row;
                let line = &state.lines[row];
                // A folded paste marker is atomic: step the whole marker.
                let marker = paste_marker_len_ending_at(line, state.cursor_col);
                if marker > 0 {
                    state.cursor_col -= marker;
                    return;
                }
                // Retrear by the byte length of the preceding char so the
                // caret stays on a char boundary.
                let prev_len = line[..state.cursor_col]
                    .chars()
                    .last()
                    .map(|c| c.len_utf8())
                    .unwrap_or(0);
                state.cursor_col -= prev_len;
            } else if state.cursor_row > 0 {
                state.cursor_row -= 1;
                state.cursor_col = state.lines[state.cursor_row].len();
            }
        }
    }

    /// Move cursor right.
    fn cursor_right(&self) {
        if let Ok(mut state) = self.state.lock() {
            let row = state.cursor_row;
            let line = &state.lines[row];
            if state.cursor_col < line.len() {
                // A folded paste marker is atomic: step the whole marker.
                for m in paste_marker_regex().find_iter(line) {
                    if m.start() == state.cursor_col {
                        state.cursor_col = m.end();
                        return;
                    }
                }
                // Advance by the byte length of the char at the cursor.
                let ch_len = line[state.cursor_col..]
                    .chars()
                    .next()
                    .map(|c| c.len_utf8())
                    .unwrap_or(0);
                state.cursor_col += ch_len;
            } else if row < state.lines.len() - 1 {
                state.cursor_row += 1;
                state.cursor_col = 0;
            }
        }
    }

    /// Move cursor up.
    fn cursor_up(&self) {
        if let Ok(mut state) = self.state.lock() {
            if state.cursor_row > 0 {
                state.cursor_row -= 1;
                let new_row = state.cursor_row;
                let max = state.lines[new_row].len();
                // The byte column may fall mid-character in the new (shorter
                // or differently-encoded) line; snap to a boundary.
                state.cursor_col = snap_boundary(&state.lines[new_row], state.cursor_col.min(max));
            }
        }
    }

    /// Move cursor down.
    fn cursor_down(&self) {
        if let Ok(mut state) = self.state.lock() {
            if state.cursor_row < state.lines.len() - 1 {
                state.cursor_row += 1;
                let new_row = state.cursor_row;
                let max = state.lines[new_row].len();
                state.cursor_col = snap_boundary(&state.lines[new_row], state.cursor_col.min(max));
            }
        }
    }

    /// Move cursor to start of line.
    fn cursor_home(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.cursor_col = 0;
        }
    }

    /// Move cursor to end of line.
    fn cursor_end(&self) {
        if let Ok(mut state) = self.state.lock() {
            let row = state.cursor_row;
            state.cursor_col = state.lines[row].len();
        }
    }

    /// Kill the word before the cursor (Ctrl+W / Alt+Backspace): Emacs
    /// backward-kill-word — skip the current word, then the intervening
    /// delimiters, landing on the previous word's start.
    fn kill_word_backward(&self) {
        self.push_undo("kill");
        let killed = if let Ok(mut state) = self.state.lock() {
            let row = state.cursor_row;
            let col = state.cursor_col;
            let start = crate::word_navigation::find_word_backward(&state.lines[row], col);
            let dead: String = state.lines[row].drain(start..col).collect();
            state.cursor_col = start;
            dead
        } else {
            String::new()
        };
        self.kill(killed, true);
        self.notify_change();
    }

    /// Kill the word after the cursor (Alt+D / Alt+Delete).
    fn kill_word_forward(&self) {
        self.push_undo("kill");
        let killed = if let Ok(mut state) = self.state.lock() {
            let row = state.cursor_row;
            let col = state.cursor_col;
            // Kill only the current word (not the trailing delimiter) —
            // `find_word_end` stops at the last word char.
            let end = crate::word_navigation::find_word_end(&state.lines[row], col);
            let dead: String = state.lines[row].drain(col..end).collect();
            dead
        } else {
            String::new()
        };
        self.kill(killed, false);
        self.notify_change();
    }

    /// Jump to the previous word boundary (Alt+Left).
    fn cursor_word_left(&self) {
        if let Ok(mut state) = self.state.lock() {
            let row = state.cursor_row;
            state.cursor_col =
                crate::word_navigation::find_word_backward(&state.lines[row], state.cursor_col);
        }
    }

    /// Jump to the next word boundary (Alt+Right).
    fn cursor_word_right(&self) {
        if let Ok(mut state) = self.state.lock() {
            let row = state.cursor_row;
            state.cursor_col =
                crate::word_navigation::find_word_forward(&state.lines[row], state.cursor_col);
        }
    }

    /// Page-scroll the editor caret up/down by a page (pi `tui.editor.pageUp/
    /// pageDown`): move the cursor row by a page and clamp the column to the
    /// target line (page = 10 rows; a terminal-height-aware version would need
    /// the viewport, which the component doesn't own).
    fn page_scroll(&self, dir: i32) {
        const PAGE: usize = 10;
        if let Ok(mut state) = self.state.lock() {
            let target = if dir > 0 {
                (state.cursor_row + PAGE).min(state.lines.len().saturating_sub(1))
            } else {
                state.cursor_row.saturating_sub(PAGE)
            };
            state.cursor_row = target;
            let max = state.lines[target].len();
            state.cursor_col = snap_boundary(&state.lines[target], state.cursor_col.min(max));
        }
    }

    /// Jump the caret to the next/previous occurrence of `target` (pi
    /// `jumpToChar`): scan the current line from after/before the caret, then
    /// onward/backward line by line. Byte-safe: `find`/`rfind` return char
    /// boundaries and all search offsets start on one.
    fn jump_to_char(&self, target: char, dir: i32) {
        let forward = dir > 0;
        let mut state = self.state.lock().unwrap();
        let start_row = state.cursor_row;
        let mut row = start_row;
        let step: isize = if forward { 1 } else { -1 };
        loop {
            let line = &state.lines[row];
            let search_from = if row == start_row {
                if forward {
                    (state.cursor_col + target.len_utf8()).min(line.len())
                } else {
                    state.cursor_col.saturating_sub(target.len_utf8())
                }
            } else if forward {
                0
            } else {
                line.len()
            };
            let found = if forward {
                line[search_from..].find(target).map(|i| search_from + i)
            } else {
                line[..search_from].rfind(target)
            };
            if let Some(idx) = found {
                state.cursor_row = row;
                state.cursor_col = idx;
                return;
            }
            let next = row as isize + step;
            if next < 0 || next >= state.lines.len() as isize {
                return;
            }
            row = next as usize;
        }
    }

    /// Set the working state. When Some, shows a spinner + elapsed time + message
    /// on the card's top row. When None, the top row is blank.
    pub fn set_working(&self, working: Option<WorkingState>) {
        if let Ok(mut guard) = self.working.lock() {
            *guard = working;
        }
    }

    /// Get the current working state, if any.
    pub fn working(&self) -> Option<WorkingState> {
        self.working.lock().ok().and_then(|guard| guard.clone())
    }

    /// Submit current text (Enter).
    fn submit(&self) {
        // Send the EXPANDED draft: a folded `[paste #id …]` marker must reach
        // the model as the user's real content, not the placeholder.
        let text = self.get_expanded_text();
        if let Ok(mut state) = self.state.lock() {
            if !text.is_empty() {
                state.history.push(text.clone());
                state.history_index = state.history.len();
            }
        }
        // Submitted text is committed — don't let Ctrl+- resurrect it.
        self.undo_stack.lock().unwrap().clear();
        self.redo_stack.lock().unwrap().clear();
        *self.last_action.lock().unwrap() = None;
        if let Ok(cb) = self.on_submit.lock() {
            if let Some(callback) = cb.as_ref() {
                callback(&text);
            }
        }
        self.clear();
    }

    /// Notify change callback.
    fn notify_change(&self) {
        if let Ok(cb) = self.on_change.lock() {
            if let Some(callback) = cb.as_ref() {
                let text = self.get_text();
                callback(&text);
            }
        }
    }

    /// Handle keyboard input.
    pub fn handle_key(&self, key: crossterm::event::KeyEvent) -> bool {
        // A key press moves the caret, so the view follows it again.
        if let Ok(mut guard) = self.scroll_pinned.lock() {
            *guard = false;
        }
        match (key.modifiers, key.code) {
            // Navigation — plain movement clears any active selection;
            // Shift+movement extends it.
            (KeyModifiers::NONE, KeyCode::Left) => {
                self.clear_selection();
                self.cursor_left();
            }
            (KeyModifiers::NONE, KeyCode::Right) => {
                self.clear_selection();
                self.cursor_right();
            }
            (KeyModifiers::NONE, KeyCode::Up) => {
                self.clear_selection();
                self.cursor_up();
            }
            (KeyModifiers::NONE, KeyCode::Down) => {
                self.clear_selection();
                self.cursor_down();
            }
            (KeyModifiers::NONE, KeyCode::Home) => {
                self.clear_selection();
                self.cursor_home();
            }
            (KeyModifiers::NONE, KeyCode::End) => {
                self.clear_selection();
                self.cursor_end();
            }
            (KeyModifiers::SHIFT, KeyCode::Left) => {
                self.begin_selection();
                self.cursor_left();
            }
            (KeyModifiers::SHIFT, KeyCode::Right) => {
                self.begin_selection();
                self.cursor_right();
            }
            (KeyModifiers::SHIFT, KeyCode::Up) => {
                self.begin_selection();
                self.cursor_up();
            }
            (KeyModifiers::SHIFT, KeyCode::Down) => {
                self.begin_selection();
                self.cursor_down();
            }
            (KeyModifiers::SHIFT, KeyCode::Home) => {
                self.begin_selection();
                self.cursor_home();
            }
            (KeyModifiers::SHIFT, KeyCode::End) => {
                self.begin_selection();
                self.cursor_end();
            }

            // Editing
            (KeyModifiers::NONE, KeyCode::Backspace) => self.backspace(),
            (KeyModifiers::NONE, KeyCode::Delete) => self.delete(),
            (KeyModifiers::NONE, KeyCode::Enter)
            | (KeyModifiers::NONE, KeyCode::Char('\n'))
            | (KeyModifiers::NONE, KeyCode::Char('\r')) => {
                // Submit on Enter (mirrors TS `tui.input.submit`). The
                // `Char('\n')`/`Char('\r')` forms cover a client whose terminal
                // hands us the codepoint directly (e.g. the kitty keyboard
                // protocol's CSI-u path); they used to fall through to the
                // generic char arm and insert a literal newline.
                self.submit();
            }
            // Shift+Enter inserts a newline (mirrors `tui.input.newLine`).
            (KeyModifiers::SHIFT, KeyCode::Enter)
            | (KeyModifiers::SHIFT, KeyCode::Char('\r'))
            | (KeyModifiers::SHIFT, KeyCode::Char('\n')) => self.insert("\n"),

            // Ctrl shortcuts
            (KeyModifiers::CONTROL, KeyCode::Char('a')) => self.cursor_home(),
            (KeyModifiers::CONTROL, KeyCode::Char('e')) => self.cursor_end(),
            (KeyModifiers::CONTROL, KeyCode::Char('k')) => {
                // Kill to end of line (push the killed text onto the ring).
                self.push_undo("kill");
                let killed = if let Ok(mut state) = self.state.lock() {
                    let row = state.cursor_row;
                    let col = state.cursor_col;
                    let dead: String = state.lines[row].drain(col..).collect();
                    state.lines[row].truncate(col);
                    dead
                } else {
                    String::new()
                };
                self.kill(killed, false);
                self.notify_change();
            }
            (KeyModifiers::CONTROL, KeyCode::Char('u')) => {
                // Kill to start of line (killed text prepends to the ring entry
                // so Ctrl+Y pastes it back in the same order).
                self.push_undo("kill");
                let killed = if let Ok(mut state) = self.state.lock() {
                    let row = state.cursor_row;
                    let col = state.cursor_col;
                    let before: String = state.lines[row].drain(..col).collect();
                    state.cursor_col = 0;
                    before
                } else {
                    String::new()
                };
                self.kill(killed, true);
                self.notify_change();
            }
            // Undo / redo (pi binds undo to Ctrl+-; Ctrl+R redo is a Rust port
            // convenience since pi has no redo binding).
            (KeyModifiers::CONTROL, KeyCode::Char('-')) => self.undo(),
            (KeyModifiers::CONTROL, KeyCode::Char('r')) => self.redo(),
            // Selection cut/copy/paste (Ctrl+X / Ctrl+C / Ctrl+V).
            (KeyModifiers::CONTROL, KeyCode::Char('x')) => {
                self.cut_selection();
            }
            (KeyModifiers::CONTROL, KeyCode::Char('c')) => {
                self.copy_selection();
            }
            (KeyModifiers::CONTROL, KeyCode::Char('v')) => {
                self.yank();
            }
            // Kill-ring yank (Ctrl+Y) / yank-pop (Alt+Y).
            (KeyModifiers::CONTROL, KeyCode::Char('y')) => self.yank(),
            (KeyModifiers::ALT, KeyCode::Char('y')) => self.yank_pop(),
            // Delete the word before the cursor, killing it (Alt+Backspace).
            (KeyModifiers::CONTROL, KeyCode::Char('w')) => self.kill_word_backward(),
            (KeyModifiers::ALT, KeyCode::Backspace) => self.kill_word_backward(),
            (KeyModifiers::ALT, KeyCode::Char('d')) | (KeyModifiers::ALT, KeyCode::Delete) => {
                self.kill_word_forward();
            }
            // Word navigation (Alt+Left / Alt+Right — pi's word-jump bindings).
            (KeyModifiers::ALT, KeyCode::Left) => self.cursor_word_left(),
            (KeyModifiers::ALT, KeyCode::Right) => self.cursor_word_right(),
            // Ctrl+J inserts a newline (pi tui.input.newLine alongside
            // Shift+Enter). Ctrl+D deletes the char forward (deleteCharForward).
            (KeyModifiers::CONTROL, KeyCode::Char('j')) => self.insert_no_undo(
                "
",
            ),
            (KeyModifiers::CONTROL, KeyCode::Char('d')) => self.delete(),
            // Editor page scroll (pi tui.editor.pageUp/pageDown — the
            // unmodified PageUp/Down are the alt-screen transcript scroll).
            (KeyModifiers::CONTROL, KeyCode::PageUp) => self.page_scroll(-1),
            (KeyModifiers::CONTROL, KeyCode::PageDown) => self.page_scroll(1),
            // Character jump mode (pi jumpForward/jumpBackward): Ctrl+] jumps
            // forward to the next typed char, Ctrl+Alt+] backward. NB: a
            // CONTROL|ALT pattern in a match arm is an or-pattern (matches
            // EITHER modifier), so the backward arm uses a guard.
            (_, KeyCode::Char(']')) if key.modifiers.contains(KeyModifiers::CONTROL) => {
                // Ctrl+Alt+] jumps backward, Ctrl+] forward. A bare CONTROL
                // arm wouldn't match the CONTROL|ALT combination.
                if key.modifiers.contains(KeyModifiers::ALT) {
                    *self.jump_mode.lock().unwrap() = Some(-1);
                } else {
                    *self.jump_mode.lock().unwrap() = Some(1);
                }
            }

            // Regular character input — unless a character jump is pending
            // (Ctrl+] / Ctrl+Alt+] consumed the key as the jump target).
            (KeyModifiers::NONE | KeyModifiers::SHIFT, KeyCode::Char(c)) => {
                let jump = self.jump_mode.lock().unwrap().take();
                match jump {
                    Some(dir) => self.jump_to_char(c, dir),
                    None => self.insert(&c.to_string()),
                }
            }

            _ => return false,
        }
        true
    }

    /// Scroll the text inside the box with the mouse wheel.
    ///
    /// The event is only taken when the box hides lines, so the wheel scrolls
    /// the content above the box while the text fits. The view stays where the
    /// wheel put it, until a key press moves the caret back into view.
    fn handle_wheel(&self, event: &MouseEvent) -> Option<MouseEventResult> {
        let (visible, total) = *self.rendered_rows.lock().ok()?;
        let max_scroll = total.saturating_sub(visible);
        if max_scroll == 0 {
            return None;
        }
        let delta = event.wheel_delta.unwrap_or(0);
        let current = *self.scroll_offset.lock().ok()?;
        let next = (current as i64 + delta as i64).clamp(0, max_scroll as i64) as usize;
        if next == current {
            return None;
        }
        if let Ok(mut guard) = self.scroll_offset.lock() {
            *guard = next;
        }
        if let Ok(mut guard) = self.scroll_pinned.lock() {
            *guard = true;
        }
        Some(MouseEventResult::handled())
    }

    /// Put the caret where the pointer clicked.
    ///
    /// The press and the release are left to the renderer, which turns them
    /// into a click when they land on the same cell.
    fn handle_click(&self, event: &MouseEvent) -> Option<MouseEventResult> {
        let state = self.state.lock().ok()?.clone();
        let layout_width = *self.rendered_width.lock().ok()?;
        let (visible, _total) = *self.rendered_rows.lock().ok()?;
        if event.y == 0 || event.y > visible {
            return Some(MouseEventResult {
                handled: true,
                focus: true,
                ..Default::default()
            });
        }
        let layout = self.layout_chunks(&state, layout_width);
        let scroll_offset = *self.scroll_offset.lock().ok()?;
        let index = scroll_offset + event.y - 1;
        let Some(chunk) = layout.get(index) else {
            return Some(MouseEventResult {
                handled: true,
                focus: true,
                ..Default::default()
            });
        };
        let padding_x = self
            .options
            .padding_x
            .min(event.width.saturating_sub(1) / 2);
        let content_width = event.width.saturating_sub(padding_x * 2).max(1);
        let prompt_width = crate::ansi::visible_width(&self.style.prompt)
            .min(content_width.saturating_sub(1));
        let target_column = event.x.saturating_sub(padding_x + prompt_width);
        let line = &state.lines[chunk.row];
        let chunk_text = &line[chunk.start..chunk.end];
        let mut visible_column = 0;
        let mut target_index = chunk_text.len();
        let mut last_grapheme_index = 0;
        for (grapheme_index, grapheme) in chunk_text.grapheme_indices(true) {
            let next_column = visible_column + crate::ansi::visible_width(grapheme);
            last_grapheme_index = grapheme_index;
            if target_column < next_column {
                target_index = grapheme_index;
                break;
            }
            visible_column = next_column;
        }
        let is_last_segment = layout
            .get(index + 1)
            .map(|next| next.row != chunk.row)
            .unwrap_or(true);
        if !is_last_segment && target_index == chunk_text.len() && !chunk_text.is_empty() {
            target_index = last_grapheme_index;
        }
        if let Ok(mut guard) = self.state.lock() {
            guard.cursor_row = chunk.row;
            guard.cursor_col = chunk.start + target_index;
            guard.selection_anchor = None;
        }
        if let Ok(mut guard) = self.scroll_pinned.lock() {
            *guard = false;
        }
        Some(MouseEventResult {
            handled: true,
            focus: true,
            ..Default::default()
        })
    }

    /// The rows the editor's text occupies: one row per wrapped chunk, with
    /// the caret on the row that holds it.
    fn layout_chunks(&self, state: &EditorState, layout_width: usize) -> Vec<LayoutChunk> {
        let mut layout: Vec<LayoutChunk> = Vec::new();
        for (row, line) in state.lines.iter().enumerate() {
            let ranges = wrap_line_ranges(line, layout_width);
            let last = ranges.len().saturating_sub(1);
            for (index, (start, end)) in ranges.into_iter().enumerate() {
                let mut cursor = None;
                if row == state.cursor_row {
                    let holds_caret = if index == last {
                        state.cursor_col >= start
                    } else {
                        state.cursor_col >= start && state.cursor_col < end
                    };
                    if holds_caret {
                        cursor = Some(state.cursor_col.saturating_sub(start));
                    }
                }
                layout.push(LayoutChunk {
                    row,
                    start,
                    end,
                    cursor,
                });
            }
        }
        layout
    }

    /// The input as the TypeScript original draws it: a filled card in the
    /// colour of the sent messages, the `> ` prompt in the left gutter and no
    /// horizontal rules (`editor.ts:602-628`, `634-770`).
    fn render_card(&self, width: usize) -> Vec<String> {
        let state = self.state.lock().map(|s| s.clone()).unwrap_or_default();
        let colors = crate::theme::theme().colors;

        let max_padding = width.saturating_sub(1) / 2;
        let padding_x = self.options.padding_x.min(max_padding);
        let content_width = width.saturating_sub(padding_x * 2).max(1);
        let prompt = self.style.prompt.clone();
        let prompt_width = crate::ansi::visible_width(&prompt).min(content_width.saturating_sub(1));
        let prompt_text = colors.accent.fg(&crate::utils::truncate_to_width(
            &prompt,
            prompt_width,
            "",
        ));
        let text_width = content_width.saturating_sub(prompt_width).max(1);
        let layout_width = text_width.saturating_sub(usize::from(padding_x == 0)).max(1);
        let left_pad = " ".repeat(padding_x);
        let right_pad = " ".repeat(padding_x);

        let layout = self.layout_chunks(&state, layout_width);

        let height_limit = self.height_limit();
        let visible_rows = match self.options.content_height {
            Some(fixed) => fixed.max(1),
            None => layout.len().min(height_limit).max(1),
        };
        let cursor_index = layout
            .iter()
            .position(|chunk| chunk.cursor.is_some())
            .unwrap_or(0);
        let mut scroll_offset = self.scroll_offset.lock().map(|o| *o).unwrap_or(0);
        let pinned = self.scroll_pinned.lock().map(|p| *p).unwrap_or(false);
        if !pinned {
            if cursor_index < scroll_offset {
                scroll_offset = cursor_index;
            } else if cursor_index >= scroll_offset + visible_rows {
                scroll_offset = cursor_index + 1 - visible_rows;
            }
        }
        let max_scroll = layout.len().saturating_sub(visible_rows);
        scroll_offset = scroll_offset.min(max_scroll);
        if let Ok(mut guard) = self.scroll_offset.lock() {
            *guard = scroll_offset;
        }
        let shown_rows = visible_rows.min(layout.len().saturating_sub(scroll_offset));
        if let Ok(mut guard) = self.rendered_rows.lock() {
            *guard = (shown_rows, layout.len());
        }
        if let Ok(mut guard) = self.rendered_width.lock() {
            *guard = layout_width;
        }

        let mut content_lines = Vec::new();
        for (index, chunk) in layout
            .iter()
            .enumerate()
            .skip(scroll_offset)
            .take(visible_rows)
        {
            let row_idx = chunk.row;
            let line = &state.lines[row_idx];
            let chunk_start = chunk.start;
            let chunk_end = chunk.end;
            let chunk_text = &line[chunk_start..chunk_end];
            let is_placeholder = chunk_text.is_empty()
                && row_idx == state.cursor_row
                && state.lines.len() == 1
                && self.options.placeholder.is_some();
            let mut content = chunk_text.to_string();
            let mut decorated = false;
            if let Some(cursor) = chunk.cursor {
                content = caret_decoration(&content, cursor, state.focused);
                decorated = true;
            }
            if is_placeholder {
                content = match &self.options.placeholder {
                    Some(placeholder) => format!("\x1b[2m{placeholder}\x1b[22m"),
                    None => String::new(),
                };
                decorated = false;
            }
            if let Some((sc, ec)) = self.selection_span_on_row(&state, row_idx) {
                let local_start = sc.max(chunk_start).min(chunk_end);
                let local_end = ec.max(chunk_start).min(chunk_end);
                if local_start < local_end {
                    let before = &line[chunk_start..local_start];
                    let sel = &line[local_start..local_end];
                    let after = &line[local_end..chunk_end];
                    content = format!("{before}\x1b[7m{sel}\x1b[27m{after}");
                    decorated = false;
                }
            }
            // The prompt sits in the gutter of the first line; the other
            // lines keep the gutter blank so the text stays aligned.
            let gutter = if row_idx == 0 && index == 0 {
                prompt_text.clone()
            } else {
                " ".repeat(prompt_width)
            };
            let visible_w = crate::ansi::visible_width(&content);
            let text_pad = text_width.saturating_sub(visible_w);
            let mut line_right_pad = right_pad.clone();
            if visible_w > text_width && padding_x > 0 {
                line_right_pad.pop();
            }
            let mut rendered = format!(
                "{left_pad}{gutter}{content}{}{line_right_pad}",
                " ".repeat(text_pad)
            );
            if state.focused && !decorated {
                if let Some(cursor) = chunk.cursor {
                    let cursor_col =
                        crate::ansi::visible_width(&chunk_text[..cursor.min(chunk_text.len())]);
                    rendered =
                        insert_cursor_marker(&rendered, padding_x + prompt_width + cursor_col);
                }
            }
            content_lines.push(rendered);
        }
        if content_lines.is_empty() {
            content_lines.push(format!(
                "{left_pad}{}{right_pad}",
                " ".repeat(content_width)
            ));
        }
        while content_lines.len() < visible_rows {
            content_lines.push(format!(
                "{left_pad}{}{right_pad}",
                " ".repeat(content_width)
            ));
        }

        let lines_below = layout.len().saturating_sub(scroll_offset + shown_rows);
        let mut lines = Vec::with_capacity(content_lines.len() + 2);
        let mut top = self.working_row();
        if self.options.show_scroll_hints && scroll_offset > 0 {
            top.push_str(&format!(" ↑ {scroll_offset} more"));
        }
        lines.push(top);
        lines.extend(content_lines);
        let bottom = if self.options.show_scroll_hints && lines_below > 0 {
            format!(" ↓ {lines_below} more")
        } else {
            String::new()
        };
        lines.push(bottom);

        let bg = colors.user_message_bg;
        lines
            .into_iter()
            .map(|line| {
                let visible = crate::ansi::visible_width(&line);
                let padded = format!("{line}{}", " ".repeat(width.saturating_sub(visible)));
                bg.bg(&padded)
            })
            .collect()
    }

    /// The card's top row: the working indicator, or blank when idle.
    fn working_row(&self) -> String {
        let working_state = self.working.lock().ok().and_then(|mut guard| {
            guard.as_mut().map(|state| {
                let snapshot = state.clone();
                state.frame = state.frame.wrapping_add(1);
                snapshot
            })
        });
        let Some(working) = working_state else {
            return String::new();
        };
        let colors = crate::theme::theme().colors;
        let frames = crate::loader::SPINNER_FRAMES;
        let spinner_char = frames[working.frame % frames.len()];
        let elapsed = working.started_at.elapsed();
        let elapsed_str = if elapsed.as_secs() >= 60 {
            format!("{}m{}s", elapsed.as_secs() / 60, elapsed.as_secs() % 60)
        } else {
            format!("{}s", elapsed.as_secs())
        };
        format!(
            "{} {} {}",
            colors.accent.fg(&spinner_char.to_string()),
            colors.muted.fg(&working.message),
            colors.muted.fg(&elapsed_str)
        )
    }
}

impl Component for Editor {
    fn render(&self, width: usize) -> Vec<String> {
        self.render_card(width)
    }

    fn invalidate(&self) {
        // Editor doesn't have external cache
    }

    fn handle_input(&self, _data: &str) -> bool {
        // Parse key event from crossterm format
        // This is a simplified version - in real usage, you'd receive KeyEvent directly
        false
    }

    fn handle_mouse(&self, event: &MouseEvent) -> Option<MouseEventResult> {
        if event.kind == MouseEventKind::Wheel {
            return self.handle_wheel(event);
        }
        if event.kind == MouseEventKind::Click && event.button == MouseButton::Left {
            return self.handle_click(event);
        }
        None
    }

    fn as_focusable(&self) -> Option<&dyn crate::component::Focusable> {
        Some(self)
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

impl Focusable for Editor {
    fn set_focused(&self, focused: bool) {
        if let Ok(mut state) = self.state.lock() {
            state.focused = focused;
        }
    }

    fn is_focused(&self) -> bool {
        self.state.lock().map(|s| s.focused).unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_input_is_a_card_with_the_prompt_in_the_gutter() {
        use crate::component::Component;
        let editor = Editor::simple();
        editor.set_text("hello");
        let lines = editor.render(40);
        assert_eq!(lines.len(), 3);
        let top = crate::strip_ansi(&lines[0]);
        let content = crate::strip_ansi(&lines[1]);
        let bottom = crate::strip_ansi(&lines[2]);
        assert_eq!(top.trim(), "", "top row: {top:?}");
        assert_eq!(bottom.trim(), "", "bottom row: {bottom:?}");
        assert!(!content.contains('─'), "the card has no rules: {content:?}");
        assert!(content.starts_with("> hello"), "content: {content}");
        assert_eq!(crate::ansi::visible_width(&lines[0]), 40);
        assert_eq!(crate::ansi::visible_width(&lines[1]), 40);
        assert_eq!(crate::ansi::visible_width(&lines[2]), 40);
    }

    #[test]
    fn the_card_is_filled_with_the_user_message_background() {
        use crate::component::Component;
        let colors = crate::theme::theme().colors;
        let editor = Editor::simple();
        editor.set_text("hello");
        let lines = editor.render(40);
        let background = colors.user_message_bg.to_bg();
        for line in &lines {
            assert!(
                line.contains(&background),
                "every row is filled with the user-message background: {line:?}"
            );
        }
        let prompt = colors.accent.fg("> ");
        assert!(
            lines[1].contains(&prompt),
            "the prompt is drawn in the accent colour: {:?}",
            lines[1]
        );
    }

    #[test]
    fn the_gutter_is_blank_on_the_lines_below_the_prompt() {
        use crate::component::Component;
        let editor = Editor::simple();
        editor.set_text("one\ntwo");
        let lines = editor.render(40);
        assert_eq!(lines.len(), 4);
        assert!(crate::strip_ansi(&lines[1]).starts_with("> one"));
        assert!(crate::strip_ansi(&lines[2]).starts_with("  two"));
    }

    #[test]
    fn the_cursor_marker_never_splits_an_escape_sequence() {
        let row = "\x1b[48;5;236m\x1b[38;5;108m> \x1b[0m\x1b[48;5;236m   ";
        let marked = insert_cursor_marker(row, 2);
        assert!(
            marked.starts_with("\x1b[48;5;236m\x1b[38;5;108m> "),
            "the escapes before the cursor must stay intact: {marked:?}"
        );
        assert_eq!(
            marked.matches("\x1b[48;5;236m").count(),
            2,
            "the background must not be split: {marked:?}"
        );
        let marker_at = marked.find(CURSOR_MARKER).expect("marker");
        assert!(
            marker_at > marked.rfind("\x1b[48;5;236m").expect("background"),
            "the marker must not land inside an escape: {marked:?}"
        );
        assert_eq!(
            crate::ansi::visible_width(&marked[..marker_at]),
            2,
            "the marker belongs behind the prompt: {marked:?}"
        );
    }

    #[test]
    fn working_spinner_advances_per_render_not_per_timer() {
        use crate::component::Component;
        let editor = Editor::simple();
        editor.set_working(Some(WorkingState {
            frame: 0,
            started_at: std::time::Instant::now(),
            message: "Working…".to_string(),
        }));

        // The indicator lives in the top border and reports the message.
        let first = crate::strip_ansi(&editor.render(60)[0]);
        assert!(first.contains("Working"), "top border: {first}");

        // Each render steps the frame, so repaints driven by streamed output
        // visibly advance the spinner; no timer is required for that.
        let frame_after_first = editor.working().expect("working state").frame;
        assert_eq!(frame_after_first, 1, "render must advance the frame once");
        let _ = editor.render(60);
        assert_eq!(editor.working().expect("working state").frame, 2);

        // Two renders of the same state differ on screen (spinner char moves).
        let a = crate::strip_ansi(&editor.render(60)[0]);
        let b = crate::strip_ansi(&editor.render(60)[0]);
        let spinner_of = |line: &str| line.chars().find(|c| "⠋⠘⠹⠸⠼⠴⠦⠧⠇⠏".contains(*c));
        assert_ne!(
            spinner_of(&a),
            spinner_of(&b),
            "consecutive renders must show different spinner frames: {a:?} vs {b:?}"
        );

        // Idle editors have no indicator.
        editor.set_working(None);
        let idle = crate::strip_ansi(&editor.render(60)[0]);
        assert!(!idle.contains("Working"), "idle border: {idle}");
    }

    #[test]
    fn working_spinner_uses_native_pi_frames_and_cadence() {
        // The editor used to hand-copy the frame list and drifted (`⠘` where
        // upstream has `⠙`), so the two indicators animated differently. Both
        // now share `SPINNER_FRAMES`.
        assert_eq!(crate::loader::SPINNER_FRAMES.len(), 10);
        assert_eq!(
            crate::loader::SPINNER_FRAMES.iter().collect::<String>(),
            "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
        );
        // 10 frames at 80ms = the 800ms full cycle upstream animates at.
        assert_eq!(crate::loader::SPINNER_FRAME_MS, 80);

        // The rendered indicator steps through exactly that list, in order.
        use crate::component::Component;
        let editor = Editor::simple();
        editor.set_working(Some(WorkingState {
            frame: 0,
            started_at: std::time::Instant::now(),
            message: "Working…".to_string(),
        }));
        let spinner_of = |line: &str| {
            let plain = crate::strip_ansi(line);
            crate::loader::SPINNER_FRAMES
                .iter()
                .copied()
                .find(|c| plain.contains(*c))
        };
        let mut seen = Vec::new();
        for _ in 0..10 {
            seen.push(spinner_of(&editor.render(60)[0]).expect("a spinner glyph"));
        }
        // The snapshot is taken before the advance, so the first paint shows
        // frame 0 — exactly upstream, whose `start()` paints frame 0 and then
        // steps on each interval. Ten paints therefore cover the whole cycle in
        // order and wrap back to the start.
        let expected: Vec<char> = crate::loader::SPINNER_FRAMES.to_vec();
        assert_eq!(seen, expected);
        assert_eq!(
            editor.working().expect("working").frame % crate::loader::SPINNER_FRAMES.len(),
            0,
            "ten paints must land back on the first frame"
        );
    }

    #[test]
    fn idle_cadence_matches_native_pi() {
        // One frame per `SPINNER_FRAME_MS` of wall clock when nothing else is
        // repainting. This is the property the tick task relies on: it only
        // requests a repaint, and the repaint advances exactly one frame. The
        // tick used to *also* advance the frame, which made the idle spinner
        // run at 40ms/frame — twice upstream's rate.
        use crate::component::Component;
        assert_eq!(crate::loader::SPINNER_FRAME_MS, 80);
        assert_eq!(
            crate::loader::SPINNER_FRAME_MS * crate::loader::SPINNER_FRAMES.len() as u64,
            800,
            "a full cycle should take 800ms, like upstream"
        );

        let editor = Editor::simple();
        editor.set_working(Some(WorkingState {
            frame: 0,
            started_at: std::time::Instant::now(),
            message: "Working…".to_string(),
        }));
        // One repaint == one frame, i.e. one tick advances the spinner once.
        let before = editor.working().expect("working").frame;
        let _ = editor.render(60);
        assert_eq!(editor.working().expect("working").frame, before + 1);
    }

    #[test]
    fn clear_and_set_text_notify_change_observers() {
        // Upstream's `setTextInternal` fires onChange for programmatic edits;
        // the bash-mode border and autocomplete rely on it to drop stale state.
        use std::sync::atomic::{AtomicUsize, Ordering};
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_cb = calls.clone();
        let editor = Editor::simple();
        editor.on_change(Arc::new(move |_text: &str| {
            calls_cb.fetch_add(1, Ordering::SeqCst);
        }));

        editor.set_text("!ls");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        editor.clear();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn snap_boundary_keeps_char_boundaries_including_end() {
        // The regression: a caret placed exactly at the END of the text (what
        // autocomplete accept does — `set_cursor(0, text.len())`) used to snap
        // one char EARLY, rendering "/mode|l" instead of "/model|".
        assert_eq!(snap_boundary("/mo", 3), 3);
        assert_eq!(snap_boundary("/model", 6), 6);
        assert_eq!(snap_boundary("hello", 5), 5);
        // Interior boundaries are kept as-is.
        assert_eq!(snap_boundary("/model", 0), 0);
        assert_eq!(snap_boundary("/model", 2), 2);
        // Out-of-range clamps to the end (a valid boundary).
        assert_eq!(snap_boundary("/mo", 99), 3);
    }

    #[test]
    fn snap_boundary_mid_multibyte_snaps_down_to_char_start() {
        // "你" occupies bytes 0..3: a position inside it must snap to 0.
        assert_eq!(snap_boundary("你", 1), 0);
        assert_eq!(snap_boundary("你", 2), 0);
        // Position after it (end of string) stays 3.
        assert_eq!(snap_boundary("你", 3), 3);
        // Mixed: "a你b" — 你 is bytes 1..4; end of string is 5.
        assert_eq!(snap_boundary("a你b", 5), 5);
        assert_eq!(snap_boundary("a你b", 2), 1);
    }

    #[test]
    fn left_arrow_keeps_text_in_render() {
        use crate::component::Component;
        use crossterm::event::{KeyCode, KeyModifiers};
        let mk = |m, c| crossterm::event::KeyEvent::new(c, m);
        let editor = Editor::simple();
        editor.set_focused(true);
        editor.insert("hello world");
        editor.handle_key(mk(KeyModifiers::NONE, KeyCode::Left));
        let rendered = editor.render(40).join(
            "
",
        );
        assert!(
            rendered.contains("hello"),
            "text must survive Left, got: {rendered:?}"
        );
    }
    #[test]
    fn test_char_jump_and_page_scroll() {
        use crossterm::event::{KeyCode, KeyModifiers};
        let mk = |m, c| crossterm::event::KeyEvent::new(c, m);
        let editor = Editor::simple();

        // Character jump: from the end, Ctrl+Alt+] then 'x' jumps backward to
        // the previous 'x' ("alpha xray xray" — the second "xray" starts at 11).
        editor.insert("alpha xray xray");
        editor.handle_key(mk(KeyModifiers::CONTROL | KeyModifiers::ALT, KeyCode::End)); // caret at end
        editor.handle_key(mk(
            KeyModifiers::CONTROL | KeyModifiers::ALT,
            KeyCode::Char(']'),
        ));
        // The next printable char is consumed as the jump target.
        editor.handle_key(mk(KeyModifiers::NONE, KeyCode::Char('x')));
        assert_eq!(editor.cursor_position(), (0, 11));

        // Page scroll on a multi-line buffer clamps to the last row.
        editor.set_text(
            "l0
l1
l2
l3
l4
l5
l6
l7
l8
l9
l10
l11
l12",
        );
        editor.set_cursor(0, 2);
        editor.handle_key(mk(KeyModifiers::CONTROL, KeyCode::PageDown));
        let (row, _) = editor.cursor_position();
        assert!(row >= 10, "page-down moves ~10 rows, got {row}");
        editor.handle_key(mk(KeyModifiers::CONTROL, KeyCode::PageUp));
        let (row2, _) = editor.cursor_position();
        assert!(row2 <= 2, "page-up returns near the start, got {row2}");
    }
    #[test]
    fn test_word_ops_and_new_keys() {
        use crossterm::event::{KeyCode, KeyModifiers};
        let mk = |m, c| crossterm::event::KeyEvent::new(c, m);
        let editor = Editor::simple();
        editor.insert("alpha beta gamma");

        // Ctrl+W kills the word before the cursor.
        editor.handle_key(mk(KeyModifiers::CONTROL, KeyCode::End));
        editor.handle_key(mk(KeyModifiers::CONTROL, KeyCode::Char('w')));
        assert_eq!(editor.get_text(), "alpha beta ");

        // Alt+Left jumps back a word; Alt+D kills the word after.
        editor.handle_key(mk(KeyModifiers::ALT, KeyCode::Left));
        assert_eq!(editor.cursor_position(), (0, 6));
        editor.handle_key(mk(KeyModifiers::ALT, KeyCode::Char('d')));
        assert_eq!(editor.get_text(), "alpha  ");

        // Ctrl+J inserts a newline.
        editor.set_text("a");
        editor.set_cursor(0, 1);
        editor.handle_key(mk(KeyModifiers::CONTROL, KeyCode::Char('j')));
        assert_eq!(
            editor.get_text(),
            "a
"
        );

        // Ctrl+D deletes the char forward (deleteCharForward).
        editor.set_text("abc");
        editor.set_cursor(0, 1);
        editor.handle_key(mk(KeyModifiers::CONTROL, KeyCode::Char('d')));
        assert_eq!(editor.get_text(), "ac");
    }
    #[test]
    fn test_selection_cut_copy_paste() {
        let editor = Editor::simple();
        editor.insert("hello world");
        // Caret to the start, then Shift+Right ×5 selects "hello".
        editor.handle_key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Home,
            crossterm::event::KeyModifiers::NONE,
        ));
        let shift_right = || {
            editor.handle_key(crossterm::event::KeyEvent::new(
                crossterm::event::KeyCode::Right,
                crossterm::event::KeyModifiers::SHIFT,
            ))
        };
        for _ in 0..5 {
            shift_right();
        }
        assert!(editor.has_selection());
        assert_eq!(editor.selected_text().as_deref(), Some("hello"));
        // Ctrl+C copies (selection intact), then plain Right clears it.
        editor.handle_key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Char('c'),
            crossterm::event::KeyModifiers::CONTROL,
        ));
        assert_eq!(editor.get_text(), "hello world");
        editor.handle_key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Right,
            crossterm::event::KeyModifiers::NONE,
        ));
        assert!(!editor.has_selection(), "plain movement clears selection");
        // Move to the end and yank the copied text.
        editor.handle_key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::End,
            crossterm::event::KeyModifiers::NONE,
        ));
        editor.handle_key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Char('v'),
            crossterm::event::KeyModifiers::CONTROL,
        ));
        assert_eq!(editor.get_text(), "hello worldhello");
    }

    #[test]
    fn test_selection_replace_and_cut() {
        let editor = Editor::simple();
        editor.insert("abcdef");
        // Caret to the start, then Shift+Right ×4 selects "abcd".
        editor.handle_key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Home,
            crossterm::event::KeyModifiers::NONE,
        ));
        for _ in 0..4 {
            editor.handle_key(crossterm::event::KeyEvent::new(
                crossterm::event::KeyCode::Right,
                crossterm::event::KeyModifiers::SHIFT,
            ));
        }
        // Backspace deletes the selection ("abcd" → "ef").
        editor.handle_key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Backspace,
            crossterm::event::KeyModifiers::NONE,
        ));
        assert_eq!(editor.get_text(), "ef", "backspace deletes the selection");
        // Undo restores it.
        editor.undo();
        assert_eq!(editor.get_text(), "abcdef");
        // Cut: return to the start, select "ab", Ctrl+X removes + kills it.
        editor.handle_key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Home,
            crossterm::event::KeyModifiers::NONE,
        ));
        for _ in 0..2 {
            editor.handle_key(crossterm::event::KeyEvent::new(
                crossterm::event::KeyCode::Right,
                crossterm::event::KeyModifiers::SHIFT,
            ));
        }
        editor.handle_key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Char('x'),
            crossterm::event::KeyModifiers::CONTROL,
        ));
        assert_eq!(editor.get_text(), "cdef");
        // Type over a selection replaces it.
        editor.handle_key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Right,
            crossterm::event::KeyModifiers::SHIFT,
        ));
        editor.insert("Z");
        assert_eq!(editor.get_text(), "Zdef", "typing replaces the selection");
    }
    #[test]
    fn test_undo_redo_roundtrip() {
        let editor = Editor::simple();
        editor.insert("hello");
        editor.insert(" world");
        // Consecutive inserts coalesce: one undo restores the empty state.
        assert_eq!(editor.get_text(), "hello world");
        editor.undo();
        assert_eq!(editor.get_text(), "", "coalesced inserts undo as one step");
        // Redo restores everything.
        editor.redo();
        assert_eq!(editor.get_text(), "hello world");
        // A fresh edit after undo clears redo.
        editor.undo();
        editor.insert("hi");
        editor.redo();
        assert_eq!(editor.get_text(), "hi", "new edit clears the redo stack");
    }

    #[test]
    fn test_kill_ring_yank() {
        let editor = Editor::simple();
        editor.insert("alpha beta gamma");
        // Ctrl+K kills to end of line.
        editor.set_cursor(0, 6); // after "alpha "
        let key = |m, c| crossterm::event::KeyEvent::new(c, m);
        editor.handle_key(key(
            crossterm::event::KeyModifiers::CONTROL,
            crossterm::event::KeyCode::Char('k'),
        ));
        assert_eq!(editor.get_text(), "alpha ");
        // Ctrl+Y yanks it back.
        editor.handle_key(key(
            crossterm::event::KeyModifiers::CONTROL,
            crossterm::event::KeyCode::Char('y'),
        ));
        assert_eq!(editor.get_text(), "alpha beta gamma");
    }

    #[test]
    fn test_undo_after_kill() {
        let editor = Editor::simple();
        editor.insert("hello world");
        editor.set_cursor(0, 5);
        editor.handle_key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Char('k'),
            crossterm::event::KeyModifiers::CONTROL,
        ));
        assert_eq!(editor.get_text(), "hello");
        editor.undo();
        assert_eq!(editor.get_text(), "hello world", "kill is undoable");
    }

    #[test]
    fn shift_enter_encodings_insert_newline_without_submitting() {
        use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
        for code in [KeyCode::Enter, KeyCode::Char('\r'), KeyCode::Char('\n')] {
            let editor = Editor::simple();
            editor.on_submit(Arc::new(|_| panic!("Shift+Enter must not submit")));
            editor.insert("draft");
            editor.handle_key(KeyEvent::new(code, KeyModifiers::SHIFT));
            assert_eq!(editor.get_text(), "draft\n");
        }
    }

    #[test]
    fn test_submit_clears_undo() {
        let editor = Editor::simple();
        editor.insert("committed");
        editor.handle_key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Enter,
            crossterm::event::KeyModifiers::NONE,
        ));
        editor.undo();
        assert_eq!(
            editor.get_text(),
            "",
            "submit clears undo so committed text stays committed"
        );
    }

    /// Regression: a remote/mobile client (SSH, soft keyboard) that encodes
    /// its Enter key as LF (0x0A) or CR (0x0D) sends it as a bare character
    /// event in raw mode. Those used to fall through to the generic char arm
    /// and insert a literal newline — "回车变成了换行，无法发送内容". They must
    /// submit just like `KeyCode::Enter`.
    #[test]
    fn test_remote_lf_cr_enter_submits() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        for code in [
            crossterm::event::KeyCode::Char('\n'),
            crossterm::event::KeyCode::Char('\r'),
        ] {
            let editor = Editor::simple();
            let submits = Arc::new(AtomicUsize::new(0));
            let submits_for_cb = submits.clone();
            editor.on_submit(Arc::new(move |_text: &str| {
                submits_for_cb.fetch_add(1, Ordering::SeqCst);
            }));
            editor.insert("hello");
            editor.handle_key(crossterm::event::KeyEvent::new(
                code,
                crossterm::event::KeyModifiers::NONE,
            ));
            assert_eq!(submits.load(Ordering::SeqCst), 1, "{code:?} must submit");
            assert_eq!(editor.get_text(), "", "editor cleared after submit");
        }
    }
    #[test]
    fn test_editor_text() {
        let editor = Editor::simple();
        editor.set_text("Hello");
        assert_eq!(editor.get_text(), "Hello");
    }

    #[test]
    fn test_editor_insert() {
        let editor = Editor::simple();
        editor.insert("Hello");
        assert_eq!(editor.get_text(), "Hello");
        editor.insert(" World");
        assert_eq!(editor.get_text(), "Hello World");
    }

    #[test]
    fn test_editor_clear() {
        let editor = Editor::simple();
        editor.set_text("Test");
        editor.clear();
        assert_eq!(editor.get_text(), "");
    }

    #[test]
    fn test_editor_render_draws_the_card() {
        // The editor renders the input as the original does: a filled card with
        // the `> ` prompt in the gutter and no horizontal rules (mirrors TS
        // editor.ts:602-628, 634-770).
        let editor = Editor::new(
            EditorOptions {
                padding_x: 1,
                ..Default::default()
            },
            EditorStyle::default(),
            Arc::new(Keybindings::new()),
        );
        editor.set_text("hi");
        let lines = editor.render(20);
        assert_eq!(lines.len(), 3, "expected [card top, content, card bottom]");
        let top = crate::ansi::strip_ansi(&lines[0]);
        let bottom = crate::ansi::strip_ansi(lines.last().unwrap());
        assert_eq!(top.trim(), "", "card top row: {top:?}");
        assert_eq!(bottom.trim(), "", "card bottom row: {bottom:?}");
        // The content line carries the text behind the prompt.
        let content = crate::ansi::strip_ansi(&lines[1]);
        assert!(
            content.contains("hi"),
            "content line missing text: {content:?}"
        );
        assert!(
            content.contains("> "),
            "content line must carry the prompt: {content:?}"
        );
        assert!(
            !content.contains('─'),
            "the card must not draw rules: {content:?}"
        );
    }

    #[test]
    fn test_editor_multibyte_no_panic() {
        // Inserting a multibyte char (读 = 3 bytes) and then a second char
        // used to panic: `cursor_col += 1` left the caret at byte 1, inside
        // '读', so the next `String::insert(1, …)` hit a char boundary. This
        // exercises the byte-cursor fix across insert + render + a second
        // keystroke.
        let editor = Editor::simple();
        editor.set_focused(true);
        editor.insert("读");
        editor.insert("a");
        editor.insert("书");
        assert_eq!(editor.get_text(), "读a书");
        // cursor_col should be at the end (byte offset 7: 读=3 + a=1 + 书=3).
        assert_eq!(editor.cursor_position(), (0, 7));
        // Render must not panic when placing the cursor marker on the row.
        let lines = editor.render(20);
        assert_eq!(
            lines.len(),
            3,
            "the card keeps [top row, content, bottom row]"
        );

        // Backspace / left/right must also stay on boundaries.
        editor.backspace(); // remove 书
        assert_eq!(editor.get_text(), "读a");
        editor.cursor_left(); // left of 'a'
        assert_eq!(editor.cursor_position(), (0, 3));
        editor.insert("b"); // insert between 读 and a
        assert_eq!(editor.get_text(), "读ba");
    }

    #[test]
    fn test_editor_wraps_long_draft_inside_width() {
        let editor = Editor::new(
            EditorOptions {
                padding_x: 1,
                ..Default::default()
            },
            EditorStyle::default(),
            Arc::new(Keybindings::new()),
        );
        editor.set_focused(true);
        editor.set_text("12345678901234567890");
        let lines = editor.render(10);
        assert_eq!(lines.len(), 6, "four wrapped content rows plus the card");
        for line in &lines {
            assert!(
                crate::ansi::visible_width(line) <= 10,
                "line escaped editor width: {line:?}"
            );
        }
        let rendered = crate::ansi::strip_ansi(&lines.join("\n"));
        assert!(rendered.contains("123456"));
        assert!(rendered.contains("345678"));
    }

    #[test]
    fn test_editor_preserves_trailing_newline() {
        let editor = Editor::simple();
        editor.set_text("first\n");
        assert_eq!(editor.get_text(), "first\n");
        assert_eq!(editor.cursor_position(), (1, 0));
    }

    #[test]
    fn setting_the_text_leaves_the_caret_at_the_end() {
        let editor = Editor::simple();
        editor.set_text("ab");
        assert_eq!(editor.cursor_position(), (0, 2));
        editor.set_text("one\ntwo");
        assert_eq!(editor.cursor_position(), (1, 3));
    }

    #[test]
    fn the_history_recall_keeps_its_own_placement() {
        let editor = Editor::simple();
        editor.set_text_at_start("ab");
        assert_eq!(editor.cursor_position(), (0, 0));
    }

    fn wrapped_chunks(line: &str, width: usize) -> Vec<String> {
        wrap_line_ranges(line, width)
            .into_iter()
            .map(|(start, end)| line[start..end].to_string())
            .collect()
    }

    #[test]
    fn the_editor_wrap_breaks_at_word_boundaries() {
        assert_eq!(
            wrapped_chunks("the quick brown fox jumps over the lazy dog", 20),
            vec!["the quick brown fox ", "jumps over the lazy ", "dog"]
        );
    }

    #[test]
    fn the_editor_wrap_matches_the_original_at_every_width() {
        let fox = "the quick brown fox jumps over the lazy dog";
        assert_eq!(
            wrapped_chunks(fox, 15),
            vec!["the quick ", "brown fox ", "jumps over the ", "lazy dog"]
        );
        assert_eq!(
            wrapped_chunks(fox, 16),
            vec!["the quick brown ", "fox jumps over ", "the lazy dog"]
        );
        assert_eq!(wrapped_chunks("hello world", 5), vec!["hello", " ", "world"]);
        assert_eq!(wrapped_chunks("one two three", 7), vec!["one ", "two ", "three"]);
        assert_eq!(
            wrapped_chunks("日本語のテキストです", 4),
            vec!["日本", "語の", "テキ", "スト", "です"]
        );
        assert_eq!(wrapped_chunks("abcdefghij", 5), vec!["abcde", "fghij"]);
    }

    #[test]
    fn the_editor_wrap_breaks_a_word_wider_than_the_row() {
        assert_eq!(
            wrapped_chunks("supercalifragilisticexpialidocious", 10),
            vec!["supercalif", "ragilistic", "expialidoc", "ious"]
        );
    }

    #[test]
    fn the_editor_wrap_breaks_between_cjk_characters() {
        assert_eq!(
            wrapped_chunks("日本語のテキストです", 5),
            vec!["日本", "語の", "テキ", "スト", "です"]
        );
    }

    #[test]
    fn the_editor_renders_the_draft_broken_at_word_boundaries() {
        let editor = Editor::new(
            EditorOptions {
                padding_x: 0,
                ..Default::default()
            },
            EditorStyle::default(),
            Arc::new(Keybindings::new()),
        );
        editor.set_text("the quick brown fox jumps over the lazy dog");
        let lines = editor.render(20);
        let rendered: Vec<String> = lines
            .iter()
            .map(|line| crate::ansi::strip_ansi(line).trim_end().to_string())
            .collect();
        assert_eq!(rendered[1], "> the quick brown");
        assert_eq!(rendered[2], "  fox jumps over");
        assert_eq!(rendered[3], "  the lazy dog");
    }

    #[test]
    fn the_input_box_caps_its_content_and_scrolls_inside() {
        let editor = Editor::new(
            EditorOptions {
                padding_x: 0,
                max_content_height: Some(12),
                ..Default::default()
            },
            EditorStyle::default(),
            Arc::new(Keybindings::new()),
        );
        let draft = (1..=30)
            .map(|line| format!("line {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        editor.set_text(&draft);
        editor.set_cursor(0, 0);
        let lines = editor.render(40);
        assert_eq!(lines.len(), 14, "12 content rows plus the card frame");
        let rendered = crate::ansi::strip_ansi(&lines.join("\n"));
        assert!(rendered.contains("line 1"));
        assert!(!rendered.contains("line 30"));
    }

    #[test]
    fn the_input_box_reports_the_hidden_lines() {
        let editor = Editor::new(
            EditorOptions {
                padding_x: 0,
                max_content_height: Some(4),
                show_scroll_hints: true,
                ..Default::default()
            },
            EditorStyle::default(),
            Arc::new(Keybindings::new()),
        );
        let draft = (1..=20)
            .map(|line| format!("line {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        editor.set_text(&draft);
        editor.set_cursor(0, 0);
        let lines = editor.render(40);
        let rendered: Vec<String> = lines
            .iter()
            .map(|line| crate::ansi::strip_ansi(line).trim_end().to_string())
            .collect();
        assert!(rendered[rendered.len() - 1].contains("↓ 16 more"), "{rendered:?}");
        assert!(!rendered[0].contains("↑"), "{rendered:?}");
    }

    #[test]
    fn the_caret_is_drawn_with_the_fake_cursor_markers() {
        let editor = Editor::new(
            EditorOptions {
                padding_x: 0,
                ..Default::default()
            },
            EditorStyle::default(),
            Arc::new(Keybindings::new()),
        );
        editor.set_focused(true);
        editor.set_text("abc");
        editor.set_cursor(0, 1);
        let lines = editor.render(20);
        let content = &lines[1];
        assert!(content.contains(crate::ansi::FAKE_CURSOR_START), "{content:?}");
        assert!(content.contains(crate::ansi::FAKE_CURSOR_END), "{content:?}");
        let start = content.find(crate::ansi::FAKE_CURSOR_START).unwrap();
        let end = content.find(crate::ansi::FAKE_CURSOR_END).unwrap();
        let between = &content[start + crate::ansi::FAKE_CURSOR_START.len()..end];
        assert_eq!(between, "b");
    }

    #[test]
    fn the_caret_at_the_end_of_the_line_is_a_reversed_space() {
        let editor = Editor::new(
            EditorOptions {
                padding_x: 0,
                ..Default::default()
            },
            EditorStyle::default(),
            Arc::new(Keybindings::new()),
        );
        editor.set_focused(true);
        editor.set_text("ab");
        editor.set_cursor(0, 2);
        let lines = editor.render(20);
        let content = &lines[1];
        let start = content.find(crate::ansi::FAKE_CURSOR_START).unwrap();
        let end = content.find(crate::ansi::FAKE_CURSOR_END).unwrap();
        let between = &content[start + crate::ansi::FAKE_CURSOR_START.len()..end];
        assert_eq!(between, " ");
    }

    #[test]
    fn a_click_in_the_input_moves_the_caret() {
        use crate::component::Component;
        let editor = Editor::new(
            EditorOptions {
                padding_x: 0,
                ..Default::default()
            },
            EditorStyle::default(),
            Arc::new(Keybindings::new()),
        );
        editor.set_text("hello world");
        editor.render(40);
        let mut event = MouseEvent::new(MouseEventKind::Click, MouseButton::Left, 5, 1);
        event.width = 40;
        event.height = 3;
        let result = editor.handle_mouse(&event).expect("handled");
        assert!(result.handled);
        assert!(result.focus);
        assert_eq!(editor.cursor_position(), (0, 3));
    }

    #[test]
    fn the_wheel_scrolls_the_overflowing_input() {
        use crate::component::Component;
        let editor = Editor::new(
            EditorOptions {
                padding_x: 0,
                max_content_height: Some(4),
                ..Default::default()
            },
            EditorStyle::default(),
            Arc::new(Keybindings::new()),
        );
        let draft = (1..=20)
            .map(|line| format!("line {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        editor.set_text(&draft);
        editor.set_cursor(0, 0);
        editor.render(40);
        let mut event = MouseEvent::new(MouseEventKind::Wheel, MouseButton::None, 0, 2);
        event.width = 40;
        event.height = 6;
        event.wheel_delta = Some(3);
        let result = editor.handle_mouse(&event).expect("handled");
        assert!(result.handled);
        let lines = editor.render(40);
        let rendered = crate::ansi::strip_ansi(&lines.join("\n"));
        assert!(rendered.contains("line 4"), "{rendered}");
        assert!(!rendered.contains("line 1"), "{rendered}");
    }

    #[test]
    fn test_autocomplete_cursor_origin() {
        // Origin of the autocomplete panic (autocomplete.rs:279, before the
        // fix): the editor handed back a byte `cursor_col` for multibyte
        // text, and the slash-command provider sliced `&input[..cursor]`
        // mid-character. A multibyte editor line must still round-trip
        // through `get_suggestions` without panicking.
        use crate::autocomplete::AutocompleteManager;

        let editor = Editor::simple();
        editor.set_text("读");
        editor.set_cursor(0, 3); // byte end of line
        let text = editor.get_text();
        let (_r, col) = editor.cursor_position();
        let cursor = col.min(text.len());
        let mgr = AutocompleteManager::new();

        // No slash prefix → None; must not panic on the multibyte slice.
        assert!(mgr.get_suggestions(&text, cursor).is_none());
        // And the slash path with a char-count overshoot also must not panic.
        editor.set_text("/读");
        editor.set_cursor(0, 4);
        let text2 = editor.get_text();
        let mgr2 = AutocompleteManager::new();
        let _ = mgr2.get_suggestions(&text2, 9); // overshoot past end
    }

    #[test]
    fn insert_normalizes_crlf_and_lone_cr_to_newlines() {
        // Pasted Windows text (and the Unix `Event::Paste` payload, which keeps
        // CRLF) used to insert literal `\r` bytes into the line buffer: they
        // render as garbage and desync `cursor_col` from the string length.
        let editor = Editor::simple();
        editor.insert("line1\r\nline2\rline3");
        assert_eq!(editor.get_text(), "line1\nline2\nline3");

        // The buffer is 3 lines and the cursor sits at the end of the last.
        let (row, col) = editor.cursor_position();
        assert_eq!((row, col), (2, "line3".len()));

        // Editing after a normalized paste stays sound (no mid-char split).
        editor.insert("!");
        assert_eq!(editor.get_text(), "line1\nline2\nline3!");
    }

    #[test]
    fn insert_of_a_lone_crlf_makes_exactly_one_newline() {
        let editor = Editor::simple();
        editor.insert("a\r\nb");
        assert_eq!(editor.get_text().matches('\n').count(), 1);
        assert_eq!(editor.get_text(), "a\nb");
    }

    // ---- Folded pastes (upstream `handlePaste` / `expandPasteMarkers`) ----

    #[test]
    fn short_paste_is_inserted_verbatim() {
        let editor = Editor::simple();
        editor.handle_paste("hello\nworld\nthird");
        assert_eq!(editor.get_text(), "hello\nworld\nthird");
        assert_eq!(editor.get_expanded_text(), "hello\nworld\nthird");
    }

    #[test]
    fn many_line_paste_folds_to_a_marker() {
        let editor = Editor::simple();
        let payload = (1..=12)
            .map(|i| format!("line {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        editor.handle_paste(&payload);

        // The document shows only the marker; the body is stashed.
        assert_eq!(editor.get_text(), "[paste #1 +12 lines]");
        // Submitting reveals the real content.
        assert_eq!(editor.get_expanded_text(), payload);
    }

    #[test]
    fn long_single_line_paste_folds_by_char_count() {
        let editor = Editor::simple();
        let payload = "x".repeat(2000);
        editor.handle_paste(&payload);
        assert_eq!(editor.get_text(), "[paste #1 2000 chars]");
        assert_eq!(editor.get_expanded_text(), payload);
    }

    #[test]
    fn pasted_crlf_and_tabs_are_normalized_before_folding() {
        let editor = Editor::simple();
        let payload = (1..=12)
            .map(|i| format!("a\tb{i}"))
            .collect::<Vec<_>>()
            .join("\r\n");
        editor.handle_paste(&payload);
        let expanded = editor.get_expanded_text();
        assert!(!expanded.contains('\r'), "CR must be normalized away");
        assert!(!expanded.contains('\t'), "tab must expand to spaces");
        assert!(expanded.contains("a    b1"), "tab becomes four spaces");
        assert_eq!(expanded.split('\n').count(), 12);
    }

    #[test]
    fn two_folded_pastes_get_distinct_ids_and_both_expand() {
        let editor = Editor::simple();
        let first = "1\n".repeat(11);
        let second = "2\n".repeat(11);
        editor.handle_paste(&first);
        editor.handle_paste(&second);
        assert_eq!(
            editor.get_text(),
            "[paste #1 +12 lines][paste #2 +12 lines]"
        );
        assert_eq!(editor.get_expanded_text(), format!("{first}{second}"));
    }

    #[test]
    fn backspace_over_a_folded_marker_drops_it_and_renumbers() {
        let editor = Editor::simple();
        let first = "a\n".repeat(11);
        let second = "b\n".repeat(11);
        editor.handle_paste(&first);
        editor.handle_paste(&second);
        assert_eq!(
            editor.get_text(),
            "[paste #1 +12 lines][paste #2 +12 lines]"
        );

        // Delete the FIRST marker: one step left lands the caret right after
        // marker #1 (markers are adjacent), and Backspace eats it whole.
        let _ = editor.handle_key(crossterm::event::KeyEvent::new(
            KeyCode::Left,
            KeyModifiers::NONE,
        ));
        let _ = editor.handle_key(crossterm::event::KeyEvent::new(
            KeyCode::Backspace,
            KeyModifiers::NONE,
        ));

        // Only the second survives, renumbered to #1, and it still expands.
        assert_eq!(editor.get_text(), "[paste #1 +12 lines]");
        assert_eq!(editor.get_expanded_text(), second);
    }

    #[test]
    fn undo_restores_a_backspaced_folded_paste() {
        let editor = Editor::simple();
        let payload = "line\n".repeat(11);
        editor.handle_paste(&payload);
        assert_eq!(editor.get_text(), "[paste #1 +12 lines]");

        let _ = editor.handle_key(crossterm::event::KeyEvent::new(
            KeyCode::Backspace,
            KeyModifiers::NONE,
        ));
        assert_eq!(editor.get_text(), "", "marker deleted");

        // Undo must resurrect both the marker AND its stashed body.
        editor.undo();
        assert_eq!(editor.get_text(), "[paste #1 +12 lines]");
        assert_eq!(editor.get_expanded_text(), payload);
    }

    #[test]
    fn cursor_arrows_step_over_a_marker_atomically() {
        let editor = Editor::simple();
        let payload = "z\n".repeat(11);
        editor.handle_paste(&payload);
        // Caret is after the marker; one step left must land BEFORE it.
        let _ = editor.handle_key(crossterm::event::KeyEvent::new(
            KeyCode::Left,
            KeyModifiers::NONE,
        ));
        assert_eq!(
            editor.cursor_position(),
            (0, 0),
            "left jumps the whole marker"
        );
        // And one step right must jump back over the whole marker.
        let _ = editor.handle_key(crossterm::event::KeyEvent::new(
            KeyCode::Right,
            KeyModifiers::NONE,
        ));
        assert_eq!(
            editor.cursor_position(),
            (0, "[paste #1 +12 lines]".len()),
            "right jumps the whole marker"
        );
    }

    #[test]
    fn clear_and_set_text_forget_folded_pastes() {
        let editor = Editor::simple();
        editor.handle_paste(&"m\n".repeat(11));
        editor.clear();
        assert_eq!(editor.get_text(), "");
        assert_eq!(editor.get_expanded_text(), "");

        editor.handle_paste(&"n\n".repeat(11));
        editor.set_text("fresh");
        // A programmatic replacement drops the store; a leftover marker would
        // otherwise expand against a stale body.
        assert_eq!(editor.get_text(), "fresh");
        assert_eq!(editor.get_expanded_text(), "fresh");
    }

    #[test]
    fn csi_u_ctrl_sequences_decode_then_drop_like_native_pi() {
        // `ESC[104;5u` is kitty CSI-u for Ctrl+H. Upstream decodes it to the
        // control char (104 - 96 = 8) and then its `charCode >= 32` filter
        // drops it, so a stream of them folds to nothing.
        let editor = Editor::simple();
        editor.handle_paste(&"\x1b[104;5u".repeat(1200));
        assert_eq!(editor.get_text(), "");
        assert_eq!(editor.get_expanded_text(), "");
    }
}
