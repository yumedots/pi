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
use super::keybindings;
use super::keybindings::Keybindings;
use crate::ansi::CURSOR_MARKER;
use crate::kill_ring::{KillRing, PushOptions};
use crate::loader::SpinnerTicker;
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
#[derive(Debug, Clone)]
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

impl Default for EditorOptions {
    fn default() -> Self {
        Self {
            padding_x: 0,
            autocomplete_max_visible: 5,
            placeholder: None,
            initial_text: None,
            content_height: None,
            max_content_height: None,
            // The original's editor reports the hidden lines by default
            // (packages/tui/src/components/editor.ts:455).
            show_scroll_hints: true,
        }
    }
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
    /// The moving end of the selection (row, col). The span is the two ends,
    /// so a plain caret move leaves the selection untouched — the original's
    /// selection belongs to the renderer and survives a caret move.
    selection_end: Option<(usize, usize)>,
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
            selection_end: None,
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

/// Whether a segment is a folded-paste marker (the original's
/// `isPasteMarker`, packages/tui/src/components/editor.ts:38).
fn is_paste_marker_segment(segment: &str) -> bool {
    segment.len() >= 10
        && paste_marker_regex()
            .find(segment)
            .map(|m| m.start() == 0 && m.end() == segment.len())
            .unwrap_or(false)
}

/// Split a logical editor line into terminal-width chunks. The editor keeps
/// logical lines for editing and cursor movement; wrapping is strictly a
/// rendering concern so a long draft cannot escape the bordered input box.
///
/// The split happens at word boundaries: a word that does not fit moves whole
/// to the next row, and only a word wider than the row is broken. A CJK run
/// may break between two characters. An atomic segment wider than the row (a
/// folded-paste marker in a narrow terminal) is re-wrapped at grapheme
/// granularity: it stays one unit for the caret, the split is visual only.
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
        let is_whitespace = !is_paste_marker_segment(grapheme)
            && grapheme.chars().any(char::is_whitespace);

        if current_width + grapheme_width > max_width {
            let backtrack = wrap_opportunity
                .filter(|(_, width)| current_width - width + grapheme_width <= max_width);
            if let Some((opportunity, width)) = backtrack {
                ranges.push((start, opportunity));
                start = opportunity;
                current_width -= width;
            } else if start < *index {
                ranges.push((start, *index));
                start = *index;
                current_width = 0;
            }
            wrap_opportunity = None;
        }

        if grapheme_width > max_width {
            let mut chunk_start = *index;
            let mut chunk_width = 0usize;
            for (offset, piece) in grapheme.grapheme_indices(true) {
                let piece_width = crate::ansi::visible_width(piece);
                if chunk_width > 0 && chunk_width + piece_width > max_width {
                    ranges.push((chunk_start, chunk_start + offset));
                    chunk_start += offset;
                    chunk_width = 0;
                }
                chunk_width += piece_width;
            }
            ranges.push((chunk_start, chunk_start + grapheme.len()));
            start = chunk_start + grapheme.len();
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

/// The caret must never sit inside a folded-paste marker: the marker is one
/// atomic unit, like the original's `segmentWithMarkers`
/// (packages/tui/src/components/editor.ts:60-115).
fn snap_out_of_paste_marker(line: &str, col: usize) -> usize {
    for capture in paste_marker_regex().find_iter(line) {
        if col > capture.start() && col < capture.end() {
            return capture.start();
        }
    }
    col
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

/// The number of UTF-16 code units in `text`.
///
/// The original measures the caret's column in UTF-16 code units
/// (packages/tui/src/components/editor.ts:1832); the port stores byte
/// offsets and converts to code units where the original's arithmetic
/// (the sticky column, the visual-line map) is in code units.
fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

/// The byte offset of the UTF-16 code-unit index `index` in `text`.
fn byte_offset_at_utf16(text: &str, index: usize) -> usize {
    let mut units = 0usize;
    for (offset, ch) in text.char_indices() {
        if units >= index {
            return offset;
        }
        units += ch.len_utf16();
    }
    text.len()
}

/// One visual (wrapped) line of the text: a byte range inside a logical row,
/// with its column measured in UTF-16 code units.
#[derive(Debug, Clone, Copy)]
struct VisualLine {
    /// The logical row the visual line belongs to.
    logical_line: usize,
    /// The byte offset of the visual line inside its logical row.
    start: usize,
    /// The byte offset just past the visual line.
    end: usize,
    /// The column of the visual line's start, in UTF-16 code units.
    start_col: usize,
    /// The length of the visual line, in UTF-16 code units.
    len: usize,
}

/// The visual (wrapped) lines of the text, the original's
/// `buildVisualLineMap` (packages/tui/src/components/editor.ts:2033).
fn build_visual_lines(lines: &[String], width: usize) -> Vec<VisualLine> {
    let mut result: Vec<VisualLine> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        for (start, end) in wrap_line_ranges(line, width) {
            result.push(VisualLine {
                logical_line: index,
                start,
                end,
                start_col: utf16_len(&line[..start]),
                len: utf16_len(&line[start..end]),
            });
        }
    }
    result
}

/// The index of the visual line holding the logical position `(line, col)`,
/// where `col` is a UTF-16 code-unit column (the original's
/// `findVisualLineAt`).
fn find_visual_line_at(lines: &[VisualLine], line: usize, col: usize) -> usize {
    for (index, visual) in lines.iter().enumerate() {
        if visual.logical_line != line {
            continue;
        }
        let offset = col.saturating_sub(visual.start_col);
        let is_last = lines
            .get(index + 1)
            .map(|next| next.logical_line != visual.logical_line)
            .unwrap_or(true);
        if offset < visual.len || (is_last && offset == visual.len) {
            return index;
        }
    }
    lines.len().saturating_sub(1)
}

/// The byte offset of the grapheme boundary before `col`, keeping a folded
/// paste marker whole (the original steps by grapheme, not by scalar).
fn prev_grapheme_offset(line: &str, col: usize) -> usize {
    let mut last_start = 0usize;
    for (index, segment) in editor_line_segments(line) {
        if index >= col {
            break;
        }
        last_start = index;
        if index + segment.len() > col {
            return index;
        }
    }
    last_start
}

/// The byte offset just past the grapheme that starts at `col`.
fn next_grapheme_offset(line: &str, col: usize) -> usize {
    for (index, segment) in editor_line_segments(line) {
        if index + segment.len() > col {
            return index + segment.len();
        }
    }
    line.len()
}

/// The byte ranges of the folded-paste markers in a line. The markers are
/// atomic for the word navigation (the original's `isAtomicSegment`).
fn marker_ranges(line: &str) -> Vec<(usize, usize)> {
    paste_marker_regex()
        .find_iter(line)
        .map(|capture| (capture.start(), capture.end()))
        .collect()
}

/// Whether a key event is exactly this code with these modifiers.
fn matches_key(key: &crossterm::event::KeyEvent, code: KeyCode, modifiers: KeyModifiers) -> bool {
    key.code == code && key.modifiers == modifiers
}

/// The printable character a key event carries, if any.
fn printable_char(key: crossterm::event::KeyEvent) -> Option<char> {
    match (key.modifiers, key.code) {
        (KeyModifiers::NONE | KeyModifiers::SHIFT, KeyCode::Char(c)) => Some(c),
        _ => None,
    }
}

/// Whether a pasted text starts like a file path (the original's
/// `/^[/~.]/` test in `handlePaste`).
fn starts_with_path(text: &str) -> bool {
    matches!(text.chars().next(), Some('/') | Some('~') | Some('.'))
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
    /// The keybinding registry every editor key is resolved through.
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
    working: Arc<Mutex<Option<WorkingState>>>,
    /// The ticker that advances the working indicator's spinner.
    ///
    /// The frame is a counter the ticker advances once per
    /// [`SPINNER_FRAME_MS`](crate::loader::SPINNER_FRAME_MS) — the animation
    /// runs at its own rate instead of following the paints that happen to
    /// occur.
    working_ticker: Mutex<Option<SpinnerTicker>>,
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
    /// The prompt history for ↑/↓ recall, newest entry first (the original's
    /// `history` array, `packages/tui/src/components/editor.ts:407`).
    history: Mutex<Vec<String>>,
    /// Browse index while recalling the history: -1 = not browsing, 0 = the
    /// most recent entry, 1 = the older one, and so on.
    history_index: Mutex<isize>,
    /// The editor state cloned when the history browsing starts, so leaving
    /// the browse mode restores the draft with its caret.
    history_draft: Mutex<Option<EditorSnapshot>>,
    /// The sticky column for the vertical cursor movement: the column the
    /// caret tries to return to after a shorter line clamped it.
    preferred_visual_col: Mutex<Option<usize>>,
    /// The pre-snap caret column, kept while the caret sits at the start of
    /// an atomic segment (a folded-paste marker), so the next vertical move
    /// can resolve the column it came from.
    snapped_from_cursor_col: Mutex<Option<usize>>,
    /// The number of terminal rows, used for the page size. `None` asks the
    /// terminal for its size.
    terminal_rows: Mutex<Option<usize>>,
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

/// Advance the working indicator's spinner by one frame.
///
/// The frame is a counter, not a function of the wall clock: the ticker calls
/// this once per interval, and a paint never does.
fn advance_working_frame(state: &mut Option<WorkingState>) {
    if let Some(state) = state.as_mut() {
        state.frame = state.frame.wrapping_add(1) % crate::loader::SPINNER_FRAMES.len();
    }
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
            undo_stack: Mutex::new(UndoStack::unbounded()),
            redo_stack: Mutex::new(Vec::new()),
            kill_ring: Mutex::new(KillRing::new()),
            last_action: Mutex::new(None),
            jump_mode: Mutex::new(None),
            working: Arc::new(Mutex::new(None)),
            working_ticker: Mutex::new(None),
            pastes: Mutex::new(HashMap::new()),
            paste_counter: Mutex::new(0),
            scroll_offset: Mutex::new(0),
            scroll_pinned: Mutex::new(false),
            rendered_rows: Mutex::new((0, 0)),
            rendered_width: Mutex::new(0),
            history: Mutex::new(Vec::new()),
            history_index: Mutex::new(-1),
            history_draft: Mutex::new(None),
            preferred_visual_col: Mutex::new(None),
            snapped_from_cursor_col: Mutex::new(None),
            terminal_rows: Mutex::new(None),
        }
    }

    /// Set the number of terminal rows the editor lays out for (the page
    /// size is `max(5, 30% of the rows)`).
    pub fn set_terminal_rows(&self, rows: usize) {
        if let Ok(mut guard) = self.terminal_rows.lock() {
            *guard = Some(rows);
        }
    }

    /// The number of content rows the box shows.
    ///
    /// A fixed box keeps its height, a capped box grows with the text up to
    /// the cap (itself capped at half the terminal), and without either the
    /// box shows 30% of the terminal, at least 5 rows — the original's rule
    /// (packages/tui/src/components/editor.ts:659-668).
    fn height_limit(&self) -> usize {
        let rows = self.terminal_row_count();
        let default_max = std::cmp::max(5, (rows as f64 * 0.3).floor() as usize);
        let capped = self
            .options
            .max_content_height
            .map(|max| std::cmp::min(max, std::cmp::max(5, rows / 2)));
        self.options
            .content_height
            .or(capped)
            .unwrap_or(default_max)
            .max(1)
    }

    /// The number of terminal rows the editor lays out for.
    ///
    /// The rows are handed in by the host ([`Self::set_terminal_rows`]); the
    /// fallback is the classic 24-row terminal. The editor never asks the
    /// terminal itself: a query from a component can block, and the host
    /// already knows the size.
    fn terminal_row_count(&self) -> usize {
        let rows = self.terminal_rows.lock().map(|rows| *rows).unwrap_or(None);
        match rows {
            Some(rows) if rows > 0 => rows,
            _ => 24,
        }
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
    /// The original's `setTextInternal(text, "start")`.
    pub fn set_text_at_start(&self, text: &str) {
        self.set_text_placed(text, true);
    }

    fn set_text_placed(&self, text: &str, at_start: bool) {
        let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
        // A programmatic replacement is an undoable change and leaves the
        // history browsing (the original's `setText`).
        self.exit_history_browsing();
        *self.last_action.lock().unwrap() = None;
        if self.get_text() != normalized {
            self.push_undo_snapshot();
        }
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

        // A paste is one undo unit and never coalesces with the typing
        // around it (the original resets `lastAction` and pushes exactly one
        // snapshot).
        self.exit_history_browsing();
        *self.last_action.lock().unwrap() = None;
        self.push_undo_snapshot();

        // A pasted path gets a leading space when the caret follows a word
        // character, so the path does not glue to the word before it (the
        // original's `handlePaste`).
        let filtered = if starts_with_path(&filtered) && self.char_before_cursor_is_word() {
            format!(" {filtered}")
        } else {
            filtered
        };

        let line_count = filtered.split('\n').count();
        let char_count = filtered.encode_utf16().count();
        if self.has_selection() {
            self.delete_selection_no_undo();
        }
        if line_count > PASTE_FOLD_LINE_THRESHOLD || char_count > PASTE_FOLD_CHAR_THRESHOLD {
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
        } else {
            self.insert_no_undo(&filtered);
        }
    }

    /// Whether the character before the caret is a word character.
    fn char_before_cursor_is_word(&self) -> bool {
        let state = self.state.lock().unwrap();
        if state.cursor_col == 0 {
            return false;
        }
        let row = state.cursor_row;
        state.lines[row][..state.cursor_col]
            .chars()
            .next_back()
            .map(|c| c.is_alphanumeric() || c == '_')
            .unwrap_or(false)
    }

    /// Clear the editor.
    pub fn clear(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.lines = vec![String::new()];
            state.cursor_row = 0;
            state.cursor_col = 0;
            state.selection_anchor = None;
            state.selection_end = None;
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
            let col = snap_out_of_paste_marker(&state.lines[row], col);
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

    /// Record an undo snapshot before a mutation. The snapshot is taken
    /// before the mutation, so undo restores the text, the caret, the folded
    /// pastes and the paste counter.
    fn push_undo_snapshot(&self) {
        let snap = self.snapshot_state();
        if let Ok(mut stack) = self.undo_stack.lock() {
            stack.push(snap);
        }
        if let Ok(mut redo) = self.redo_stack.lock() {
            redo.clear();
        }
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
        *self.preferred_visual_col.lock().unwrap() = None;
    }

    /// Redo the last undone mutation (Ctrl+R).
    pub fn redo(&self) {
        let popped = self.redo_stack.lock().unwrap().pop();
        let Some(snap) = popped else { return };
        self.undo_stack.lock().unwrap().push(self.snapshot_state());
        self.restore_state(&snap);
        *self.last_action.lock().unwrap() = None;
        *self.preferred_visual_col.lock().unwrap() = None;
    }

    /// Push killed (deleted) text onto the kill ring. `accumulate` says
    /// whether the entry joins the previous one: the original accumulates only
    /// when the **previous** action was a kill, so any other edit breaks the
    /// chain (packages/tui/src/components/editor.ts:1881).
    fn kill(&self, text: String, prepend: bool, accumulate: bool) {
        if text.is_empty() {
            return;
        }
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
        self.exit_history_browsing();
        self.push_undo_snapshot();
        if self.has_selection() {
            self.delete_selection_no_undo();
        }
        self.insert_no_undo(&text);
        *self.last_action.lock().unwrap() = Some("yank");
    }

    /// Yank-pop: delete the yanked text, rotate the kill ring and yank the
    /// next entry (Alt+Y). Only right after a yank, and only with more than
    /// one entry (the original's `yankPop`).
    pub fn yank_pop(&self) {
        if *self.last_action.lock().unwrap() != Some("yank") {
            return;
        }
        if self.kill_ring.lock().unwrap().len() <= 1 {
            return;
        }
        self.push_undo_snapshot();
        self.delete_yanked_text();
        self.kill_ring.lock().unwrap().rotate();
        let text = self.kill_ring.lock().unwrap().peek().map(str::to_string);
        if let Some(text) = text {
            self.insert_no_undo(&text);
        }
        *self.last_action.lock().unwrap() = Some("yank");
    }

    /// Delete the text the last yank inserted, so the yank-pop can replace
    /// it with the next ring entry (the original's `deleteYankedText`).
    fn delete_yanked_text(&self) {
        let Some(text) = self.kill_ring.lock().unwrap().peek().map(str::to_string) else {
            return;
        };
        let mut state = self.state.lock().unwrap();
        let row = state.cursor_row;
        let lines: Vec<&str> = text.split('\n').collect();
        if lines.len() == 1 {
            let len = text.len();
            if state.cursor_col >= len {
                let start = state.cursor_col - len;
                let end = state.cursor_col;
                let line = &mut state.lines[row];
                line.replace_range(start..end, "");
                state.cursor_col = start;
            }
            return;
        }
        let start_row = row.saturating_sub(lines.len() - 1);
        let start_col = state.lines[start_row]
            .len()
            .saturating_sub(lines[0].len());
        let after = state.lines[row][state.cursor_col..].to_string();
        let before = state.lines[start_row][..start_col].to_string();
        state.lines.drain(start_row..=row);
        state.lines.insert(start_row, before + &after);
        state.cursor_row = start_row;
        state.cursor_col = start_col;
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
    ///
    /// The span is the two ends of the selection, not the anchor and the
    /// caret: a plain caret move leaves the selection where it was.
    fn selection_ordered(&self) -> Option<(usize, usize, usize, usize)> {
        let state = self.state.lock().unwrap();
        let (ar, ac) = state.selection_anchor?;
        let (br, bc) = state.selection_end?;
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
        let (br, bc) = state.selection_end?;
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

    /// Seed the selection at the current caret (Shift+direction start).
    fn begin_selection(&self) {
        let mut state = self.state.lock().unwrap();
        if state.selection_anchor.is_none() {
            state.selection_anchor = Some((state.cursor_row, state.cursor_col));
            state.selection_end = Some((state.cursor_row, state.cursor_col));
        }
    }

    /// Extend the selection to the current caret (Shift+direction).
    fn extend_selection(&self) {
        let mut state = self.state.lock().unwrap();
        if state.selection_anchor.is_some() {
            state.selection_end = Some((state.cursor_row, state.cursor_col));
        }
    }

    /// Clear the active selection (an edit replaces it).
    fn clear_selection(&self) {
        let mut state = self.state.lock().unwrap();
        state.selection_anchor = None;
        state.selection_end = None;
    }

    /// Delete the selected span, leaving the caret at its start. Pushes an
    /// undo snapshot; no-op without a selection.
    fn delete_selection(&self) {
        if !self.has_selection() {
            return;
        }
        self.push_undo_snapshot();
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
        state.selection_end = None;
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
    ///
    /// This is the programmatic insertion (the original's
    /// `insertTextAtCursor`): it is atomic for undo and never coalesces with
    /// the typing around it.
    pub fn insert(&self, text: &str) {
        self.exit_history_browsing();
        self.push_undo_snapshot();
        *self.last_action.lock().unwrap() = None;
        if self.has_selection() {
            self.delete_selection_no_undo();
        }
        self.insert_no_undo(text);
    }

    /// Insert one typed character, with the original's fish-style undo
    /// coalescing: a snapshot is taken before a whitespace character and
    /// before the first character of a word, so "hello world" undoes as
    /// "hello" + " world" (packages/tui/src/components/editor.ts:1414).
    fn insert_character(&self, ch: char) {
        self.exit_history_browsing();
        let whitespace = ch.is_whitespace();
        let typing_word = *self.last_action.lock().unwrap() == Some("type-word");
        if whitespace || !typing_word {
            self.push_undo_snapshot();
        }
        *self.last_action.lock().unwrap() = Some("type-word");
        if self.has_selection() {
            self.delete_selection_no_undo();
        }
        self.insert_no_undo(&ch.to_string());
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
        self.exit_history_browsing();
        *self.last_action.lock().unwrap() = None;
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
            // renumbers the surviving pastes, so undo must capture the
            // pre-deletion state to be able to bring them all back.
            self.push_undo_snapshot();
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
        self.push_undo_snapshot();
        if let Ok(mut state) = self.state.lock() {
            if state.cursor_col > 0 {
                let row = state.cursor_row;
                // Step back over the grapheme immediately before the cursor
                // and remove it. (`replace_range` takes byte indices and must
                // land on a boundary.)
                let start = prev_grapheme_offset(&state.lines[row], state.cursor_col);
                let end = state.cursor_col;
                let line = &mut state.lines[row];
                line.replace_range(start..end, "");
                state.cursor_col = start;
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
        self.exit_history_browsing();
        *self.last_action.lock().unwrap() = None;
        if self.has_selection() {
            self.delete_selection();
            return;
        }
        self.push_undo_snapshot();
        if let Ok(mut state) = self.state.lock() {
            let row = state.cursor_row;
            let line_len = state.lines[row].len();
            if state.cursor_col < line_len {
                let col = state.cursor_col;
                let end = next_grapheme_offset(&state.lines[row], col);
                state.lines[row].replace_range(col..end, "");
            } else if row < state.lines.len() - 1 {
                // Join with next line
                let next = state.lines.remove(row + 1);
                state.lines[row].push_str(&next);
            }
        }
        self.notify_change();
    }

    /// Move cursor left: one grapheme, or to the end of the previous line.
    fn cursor_left(&self) {
        *self.last_action.lock().unwrap() = None;
        let mut state = self.state.lock().unwrap();
        if state.cursor_col > 0 {
            let row = state.cursor_row;
            let target = prev_grapheme_offset(&state.lines[row], state.cursor_col);
            self.set_cursor_col(&mut state, target);
        } else if state.cursor_row > 0 {
            state.cursor_row -= 1;
            let col = state.lines[state.cursor_row].len();
            self.set_cursor_col(&mut state, col);
        }
    }

    /// Move cursor right: one grapheme, or to the start of the next line.
    fn cursor_right(&self) {
        *self.last_action.lock().unwrap() = None;
        let mut state = self.state.lock().unwrap();
        let row = state.cursor_row;
        if state.cursor_col < state.lines[row].len() {
            let target = next_grapheme_offset(&state.lines[row], state.cursor_col);
            self.set_cursor_col(&mut state, target);
        } else if row < state.lines.len() - 1 {
            state.cursor_row += 1;
            self.set_cursor_col(&mut state, 0);
        } else {
            // At the end of the last line: remember the column so the
            // vertical movement returns to it (the original's
            // `preferredVisualCol`).
            let width = self.layout_width();
            let lines = build_visual_lines(&state.lines, width);
            let col = utf16_len(&state.lines[row]);
            let current = find_visual_line_at(&lines, row, col);
            let start_col = lines[current].start_col;
            *self.preferred_visual_col.lock().unwrap() = Some(col.saturating_sub(start_col));
        }
    }

    /// Move cursor up: the history on the first visual line, the line start
    /// at the top of a non-empty line, otherwise one visual line up.
    fn cursor_up(&self) {
        if self.is_on_first_visual_line() {
            let (empty, browsing, col) = {
                let state = self.state.lock().unwrap();
                let empty = state.lines.len() == 1 && state.lines[0].is_empty();
                let browsing = *self.history_index.lock().unwrap() > -1;
                (empty, browsing, state.cursor_col)
            };
            if empty || browsing || col == 0 {
                self.navigate_history(-1);
                return;
            }
            self.move_to_line_start();
            return;
        }
        self.move_cursor_vertical(-1);
    }

    /// Move cursor down: the history while browsing on the last visual line,
    /// the line end at the bottom, otherwise one visual line down.
    fn cursor_down(&self) {
        let browsing = *self.history_index.lock().unwrap() > -1;
        if browsing && self.is_on_last_visual_line() {
            self.navigate_history(1);
            return;
        }
        if self.is_on_last_visual_line() {
            self.move_to_line_end();
            return;
        }
        self.move_cursor_vertical(1);
    }

    /// Move cursor to start of line.
    fn cursor_home(&self) {
        self.move_to_line_start();
    }

    /// Move cursor to end of line.
    fn cursor_end(&self) {
        self.move_to_line_end();
    }

    /// Move the caret to the start of the current logical line.
    fn move_to_line_start(&self) {
        *self.last_action.lock().unwrap() = None;
        let mut state = self.state.lock().unwrap();
        self.set_cursor_col(&mut state, 0);
    }

    /// Move the caret to the end of the current logical line.
    fn move_to_line_end(&self) {
        *self.last_action.lock().unwrap() = None;
        let mut state = self.state.lock().unwrap();
        let row = state.cursor_row;
        let col = state.lines[row].len();
        self.set_cursor_col(&mut state, col);
    }

    /// Set the caret's column, clearing the sticky column and the snapped
    /// column (the original's `setCursorCol`).
    fn set_cursor_col(&self, state: &mut EditorState, col: usize) {
        state.cursor_col = col;
        *self.preferred_visual_col.lock().unwrap() = None;
        *self.snapped_from_cursor_col.lock().unwrap() = None;
    }

    /// The width the text is laid out at: the width of the last render.
    fn layout_width(&self) -> usize {
        let width = self.rendered_width.lock().map(|w| *w).unwrap_or(0);
        if width == 0 {
            80
        } else {
            width
        }
    }

    /// Whether the caret sits on the first visual (wrapped) line.
    fn is_on_first_visual_line(&self) -> bool {
        let state = self.state.lock().unwrap();
        let width = self.layout_width();
        let lines = build_visual_lines(&state.lines, width);
        if lines.is_empty() {
            return true;
        }
        let row = state.cursor_row;
        let col = utf16_len(&state.lines[row][..state.cursor_col]);
        find_visual_line_at(&lines, row, col) == 0
    }

    /// Whether the caret sits on the last visual (wrapped) line.
    fn is_on_last_visual_line(&self) -> bool {
        let state = self.state.lock().unwrap();
        let width = self.layout_width();
        let lines = build_visual_lines(&state.lines, width);
        if lines.is_empty() {
            return true;
        }
        let row = state.cursor_row;
        let col = utf16_len(&state.lines[row][..state.cursor_col]);
        find_visual_line_at(&lines, row, col) == lines.len() - 1
    }

    /// Move the caret one visual line up or down.
    fn move_cursor_vertical(&self, direction: i32) {
        *self.last_action.lock().unwrap() = None;
        let mut state = self.state.lock().unwrap();
        let width = self.layout_width();
        let lines = build_visual_lines(&state.lines, width);
        if lines.is_empty() {
            return;
        }
        let row = state.cursor_row;
        let col = utf16_len(&state.lines[row][..state.cursor_col]);
        let current = find_visual_line_at(&lines, row, col);
        let target = current as i32 + direction;
        if target < 0 || target as usize >= lines.len() {
            return;
        }
        self.move_to_visual_line(&mut state, &lines, current, target as usize);
    }

    /// Move the caret to a visual line, applying the sticky column.
    ///
    /// The original's `moveToVisualLine`
    /// (packages/tui/src/components/editor.ts:1704-1786).
    fn move_to_visual_line(
        &self,
        state: &mut EditorState,
        lines: &[VisualLine],
        current: usize,
        target: usize,
    ) {
        let current_line = lines[current];
        let target_line = lines[target];
        let snapped = *self.snapped_from_cursor_col.lock().unwrap();
        let current_visual_col = match snapped {
            Some(col) => col.saturating_sub(current_line.start_col),
            None => {
                let row = state.cursor_row;
                utf16_len(&state.lines[row][..state.cursor_col])
                    .saturating_sub(current_line.start_col)
            }
        };
        let source_is_last = current + 1 >= lines.len()
            || lines[current + 1].logical_line != current_line.logical_line;
        let source_max = if source_is_last {
            current_line.len
        } else {
            current_line.len.saturating_sub(1)
        };
        let target_is_last = target + 1 >= lines.len()
            || lines[target + 1].logical_line != target_line.logical_line;
        let target_max = if target_is_last {
            target_line.len
        } else {
            target_line.len.saturating_sub(1)
        };

        let move_to = self.compute_vertical_move_column(current_visual_col, source_max, target_max);

        state.cursor_row = target_line.logical_line;
        let logical = &state.lines[target_line.logical_line];
        let wanted = target_line.start_col + move_to;
        let clamped = wanted.min(utf16_len(logical));
        let mut byte = byte_offset_at_utf16(logical, clamped);
        // The caret never lands inside a folded-paste marker: it snaps to the
        // marker's start and remembers the column it came from.
        let mut snapped_to = None;
        for capture in paste_marker_regex().find_iter(logical) {
            let start_col = utf16_len(&logical[..capture.start()]);
            let end_col = utf16_len(&logical[..capture.end()]);
            if clamped > start_col && clamped < end_col {
                byte = capture.start();
                snapped_to = Some(clamped);
                break;
            }
        }
        state.cursor_col = byte;
        *self.snapped_from_cursor_col.lock().unwrap() = snapped_to;
    }

    /// The column a vertical move lands on, and whether the sticky column is
    /// kept. The original's `computeVerticalMoveColumn`
    /// (packages/tui/src/components/editor.ts:1795-1830).
    fn compute_vertical_move_column(
        &self,
        current_visual_col: usize,
        source_max: usize,
        target_max: usize,
    ) -> usize {
        let preferred = *self.preferred_visual_col.lock().unwrap();
        let cursor_in_middle = current_visual_col < source_max;
        let target_too_short = target_max < current_visual_col;

        let has_preferred = preferred.is_some() && !cursor_in_middle;
        if !has_preferred {
            if target_too_short {
                *self.preferred_visual_col.lock().unwrap() = Some(current_visual_col);
                return target_max;
            }
            *self.preferred_visual_col.lock().unwrap() = None;
            return current_visual_col;
        }

        let preferred = preferred.unwrap_or(0);
        let target_cant_fit_preferred = target_max < preferred;
        if target_too_short || target_cant_fit_preferred {
            return target_max;
        }
        *self.preferred_visual_col.lock().unwrap() = None;
        preferred
    }

    /// Kill the word before the cursor (Ctrl+W / Alt+Backspace): the
    /// original's `deleteWordBackwards`
    /// (packages/tui/src/components/editor.ts:1903-1946).
    fn kill_word_backward(&self) {
        self.exit_history_browsing();
        let was_kill = *self.last_action.lock().unwrap() == Some("kill");
        let (row, col, has_previous) = {
            let state = self.state.lock().unwrap();
            (state.cursor_row, state.cursor_col, state.cursor_row > 0)
        };
        if col == 0 {
            if !has_previous {
                return;
            }
            self.push_undo_snapshot();
            let killed = {
                let mut state = self.state.lock().unwrap();
                let current = state.lines.remove(row);
                state.cursor_row -= 1;
                let previous_row = state.cursor_row;
                let previous_len = state.lines[previous_row].len();
                state.lines[previous_row].push_str(&current);
                state.cursor_col = previous_len;
                "\n".to_string()
            };
            self.kill(killed, true, was_kill);
            self.notify_change();
            return;
        }
        self.push_undo_snapshot();
        let killed = {
            let mut state = self.state.lock().unwrap();
            let line = &state.lines[row];
            let markers = marker_ranges(line);
            let start = crate::word_navigation::find_word_backward_marked(line, col, &markers);
            let dead: String = line[start..col].to_string();
            state.lines[row].replace_range(start..col, "");
            state.cursor_col = start;
            dead
        };
        self.kill(killed, true, was_kill);
        self.notify_change();
    }

    /// Kill the word after the cursor (Alt+D / Alt+Delete): the original's
    /// `deleteWordForward` (packages/tui/src/components/editor.ts:1948-1988).
    fn kill_word_forward(&self) {
        self.exit_history_browsing();
        let was_kill = *self.last_action.lock().unwrap() == Some("kill");
        let (row, col, line_len, has_next) = {
            let state = self.state.lock().unwrap();
            (
                state.cursor_row,
                state.cursor_col,
                state.lines[state.cursor_row].len(),
                state.cursor_row + 1 < state.lines.len(),
            )
        };
        if col >= line_len {
            if !has_next {
                return;
            }
            self.push_undo_snapshot();
            let killed = {
                let mut state = self.state.lock().unwrap();
                let next = state.lines.remove(row + 1);
                state.lines[row].push_str(&next);
                "\n".to_string()
            };
            self.kill(killed, false, was_kill);
            self.notify_change();
            return;
        }
        self.push_undo_snapshot();
        let killed = {
            let mut state = self.state.lock().unwrap();
            let line = &state.lines[row];
            let markers = marker_ranges(line);
            let end = crate::word_navigation::find_word_forward_marked(line, col, &markers);
            let dead: String = line[col..end].to_string();
            state.lines[row].replace_range(col..end, "");
            dead
        };
        self.kill(killed, false, was_kill);
        self.notify_change();
    }

    /// Kill to the end of the line (Ctrl+K): the original's
    /// `deleteToEndOfLine` (packages/tui/src/components/editor.ts:1871-1900).
    fn delete_to_end_of_line(&self) {
        self.exit_history_browsing();
        let was_kill = *self.last_action.lock().unwrap() == Some("kill");
        let (row, col, line_len, has_next) = {
            let state = self.state.lock().unwrap();
            (
                state.cursor_row,
                state.cursor_col,
                state.lines[state.cursor_row].len(),
                state.cursor_row + 1 < state.lines.len(),
            )
        };
        if col < line_len {
            self.push_undo_snapshot();
            let killed = {
                let mut state = self.state.lock().unwrap();
                let dead = state.lines[row][col..].to_string();
                state.lines[row].truncate(col);
                dead
            };
            self.kill(killed, false, was_kill);
        } else if has_next {
            self.push_undo_snapshot();
            let killed = {
                let mut state = self.state.lock().unwrap();
                let next = state.lines.remove(row + 1);
                state.lines[row].push_str(&next);
                "\n".to_string()
            };
            self.kill(killed, false, was_kill);
        }
        self.notify_change();
    }

    /// Kill to the start of the line (Ctrl+U): the original's
    /// `deleteToStartOfLine` (packages/tui/src/components/editor.ts:1836-1869).
    fn delete_to_start_of_line(&self) {
        self.exit_history_browsing();
        let was_kill = *self.last_action.lock().unwrap() == Some("kill");
        let (row, col, has_previous) = {
            let state = self.state.lock().unwrap();
            (
                state.cursor_row,
                state.cursor_col,
                state.cursor_row > 0,
            )
        };
        if col > 0 {
            self.push_undo_snapshot();
            let killed = {
                let mut state = self.state.lock().unwrap();
                let dead = state.lines[row][..col].to_string();
                state.lines[row].replace_range(..col, "");
                state.cursor_col = 0;
                dead
            };
            self.kill(killed, true, was_kill);
        } else if has_previous {
            self.push_undo_snapshot();
            let killed = {
                let mut state = self.state.lock().unwrap();
                let current = state.lines.remove(row);
                state.cursor_row -= 1;
                let previous_row = state.cursor_row;
                let previous_len = state.lines[previous_row].len();
                state.lines[previous_row].push_str(&current);
                state.cursor_col = previous_len;
                "\n".to_string()
            };
            self.kill(killed, true, was_kill);
        }
        self.notify_change();
    }

    /// Jump to the previous word boundary (Alt+Left). At the start of a line
    /// the caret moves to the end of the previous one.
    fn cursor_word_left(&self) {
        *self.last_action.lock().unwrap() = None;
        let mut state = self.state.lock().unwrap();
        let row = state.cursor_row;
        if state.cursor_col == 0 {
            if row > 0 {
                state.cursor_row -= 1;
                let col = state.lines[state.cursor_row].len();
                self.set_cursor_col(&mut state, col);
            }
            return;
        }
        let markers = marker_ranges(&state.lines[row]);
        let target =
            crate::word_navigation::find_word_backward_marked(&state.lines[row], state.cursor_col, &markers);
        self.set_cursor_col(&mut state, target);
    }

    /// Jump to the next word boundary (Alt+Right). At the end of a line the
    /// caret moves to the start of the next one.
    fn cursor_word_right(&self) {
        *self.last_action.lock().unwrap() = None;
        let mut state = self.state.lock().unwrap();
        let row = state.cursor_row;
        if state.cursor_col >= state.lines[row].len() {
            if row < state.lines.len() - 1 {
                state.cursor_row += 1;
                self.set_cursor_col(&mut state, 0);
            }
            return;
        }
        let markers = marker_ranges(&state.lines[row]);
        let target =
            crate::word_navigation::find_word_forward_marked(&state.lines[row], state.cursor_col, &markers);
        self.set_cursor_col(&mut state, target);
    }

    /// Page-scroll the editor caret up/down by a page (pi `tui.editor.pageUp/
    /// pageDown`): a page of **visual** lines, `max(5, 30% of the rows)`.
    fn page_scroll(&self, dir: i32) {
        *self.last_action.lock().unwrap() = None;
        let page = self.page_size();
        let mut state = self.state.lock().unwrap();
        let width = self.layout_width();
        let lines = build_visual_lines(&state.lines, width);
        if lines.is_empty() {
            return;
        }
        let row = state.cursor_row;
        let col = utf16_len(&state.lines[row][..state.cursor_col]);
        let current = find_visual_line_at(&lines, row, col);
        let offset = dir * page as i32;
        let target = (current as i32 + offset).clamp(0, lines.len() as i32 - 1) as usize;
        self.move_to_visual_line(&mut state, &lines, current, target);
    }

    /// The number of visual lines a page covers: `max(5, 30% of the rows)`,
    /// the original's `pageScroll` (packages/tui/src/components/editor.ts:2172).
    fn page_size(&self) -> usize {
        let rows = self.terminal_row_count();
        std::cmp::max(5, (rows as f64 * 0.3).floor() as usize)
    }

    /// Jump the caret to the next/previous occurrence of `target` (pi
    /// `jumpToChar`): scan the current line from after/before the caret, then
    /// onward/backward line by line.
    ///
    /// The original searches in UTF-16 code units: forward it takes the first
    /// occurrence that starts at or after `cursorCol + 1`, backward the last
    /// one that starts at or before `cursorCol - 1` (the position is clamped
    /// at zero). The port keeps the caret in bytes, so the occurrences are
    /// matched by their byte offset and compared in code units.
    fn jump_to_char(&self, target: char, dir: i32) {
        *self.last_action.lock().unwrap() = None;
        let forward = dir > 0;
        let mut state = self.state.lock().unwrap();
        let start_row = state.cursor_row;
        let mut row = start_row;
        let step: isize = if forward { 1 } else { -1 };
        loop {
            let line = state.lines[row].clone();
            let on_start_row = row == start_row;
            let limit = if on_start_row {
                let current_col = utf16_len(&line[..state.cursor_col.min(line.len())]);
                if forward {
                    current_col.saturating_add(1)
                } else {
                    current_col.saturating_sub(1)
                }
            } else {
                0
            };
            let mut found = None;
            let mut units = 0usize;
            for (offset, ch) in line.char_indices() {
                if ch == target {
                    let hits = if on_start_row {
                        if forward {
                            units >= limit
                        } else {
                            units <= limit
                        }
                    } else {
                        true
                    };
                    if hits {
                        found = Some(offset);
                        if forward {
                            break;
                        }
                    }
                }
                units += ch.len_utf16();
            }
            if let Some(idx) = found {
                state.cursor_row = row;
                self.set_cursor_col(&mut state, idx);
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
    ///
    /// The spinner keeps its frame when a working state replaces another one:
    /// the frame is a counter the ticker advances, so a status refresh must
    /// not restart the animation.
    pub fn set_working(&self, working: Option<WorkingState>) {
        let previous_frame = self
            .working
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|state| state.frame));
        match working {
            Some(mut state) => {
                if let Some(frame) = previous_frame {
                    state.frame = frame;
                }
                if let Ok(mut guard) = self.working.lock() {
                    *guard = Some(state);
                }
                self.start_working_ticker();
            }
            None => {
                if let Ok(mut guard) = self.working.lock() {
                    *guard = None;
                }
                self.stop_working_ticker();
            }
        }
    }

    /// Get the current working state, if any.
    pub fn working(&self) -> Option<WorkingState> {
        self.working.lock().ok().and_then(|guard| guard.clone())
    }

    /// Advance the working indicator's spinner by one frame.
    ///
    /// One frame per [`SPINNER_FRAME_MS`](crate::loader::SPINNER_FRAME_MS):
    /// the ticker calls this, and a paint never does.
    pub fn advance_working_frame(&self) {
        if let Ok(mut guard) = self.working.lock() {
            advance_working_frame(&mut guard);
        }
    }

    /// Stop the working indicator's animation.
    ///
    /// The frame counter stops advancing; the indicator keeps its last frame.
    pub fn stop_working_animation(&self) {
        self.stop_working_ticker();
    }

    /// Run the working indicator's frame ticker, if it is not already running.
    fn start_working_ticker(&self) {
        let mut ticker = match self.working_ticker.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if ticker.is_some() {
            return;
        }
        let working = Arc::clone(&self.working);
        *ticker = Some(SpinnerTicker::start(
            crate::loader::SPINNER_FRAME_MS,
            move || {
                if let Ok(mut guard) = working.lock() {
                    advance_working_frame(&mut guard);
                }
            },
        ));
    }

    /// Stop the working indicator's frame ticker.
    fn stop_working_ticker(&self) {
        let mut ticker = match self.working_ticker.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if let Some(mut running) = ticker.take() {
            running.stop();
        }
    }

    /// Submit current text (Enter).
    ///
    /// The draft is expanded (a folded `[paste #id …]` marker must reach the
    /// model as the user's real content) and trimmed, then the editor is
    /// reset **before** the callback runs, so the app can keep the submitted
    /// text (the original's `submitValue`).
    fn submit(&self) {
        let text = self.get_expanded_text().trim().to_string();
        // Submitted text is committed — don't let Ctrl+- resurrect it.
        self.undo_stack.lock().unwrap().clear();
        self.redo_stack.lock().unwrap().clear();
        *self.last_action.lock().unwrap() = None;
        self.exit_history_browsing();
        self.clear();
        if let Ok(cb) = self.on_submit.lock() {
            if let Some(callback) = cb.as_ref() {
                callback(&text);
            }
        }
    }

    /// Record a submitted prompt in the history (the original's
    /// `addToHistory`, packages/tui/src/components/editor.ts:517).
    ///
    /// The entry is trimmed, empty and consecutive duplicates are skipped, the
    /// newest entry comes first and the history holds 100 entries.
    pub fn add_to_history(&self, text: &str) {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return;
        }
        let mut history = self.history.lock().unwrap();
        if history.first().map(|entry| entry.as_str()) == Some(trimmed) {
            return;
        }
        history.insert(0, trimmed.to_string());
        if history.len() > 100 {
            history.pop();
        }
    }

    /// The prompt history, newest entry first.
    pub fn history(&self) -> Vec<String> {
        self.history.lock().map(|history| history.clone()).unwrap_or_default()
    }

    /// Leave the history browsing: the next edit starts from the text the
    /// user typed (the original's `exitHistoryBrowsing`).
    fn exit_history_browsing(&self) {
        *self.history_index.lock().unwrap() = -1;
        *self.history_draft.lock().unwrap() = None;
    }

    /// Whether the editor is browsing the prompt history.
    pub fn is_browsing_history(&self) -> bool {
        *self.history_index.lock().unwrap() > -1
    }

    /// Walk the prompt history. `direction` is -1 (↑, older) or 1 (↓, newer).
    ///
    /// The original's `navigateHistory`
    /// (packages/tui/src/components/editor.ts:553): entering the browse mode
    /// snapshots the editor state, the recalled entry replaces the text (the
    /// caret at its start for ↑, at its end for ↓) and leaving the browse
    /// mode restores the draft with its caret.
    pub fn navigate_history(&self, direction: i32) {
        *self.last_action.lock().unwrap() = None;
        let history = self.history.lock().unwrap();
        if history.is_empty() {
            return;
        }
        let index = *self.history_index.lock().unwrap();
        let new_index = index - direction as isize;
        if new_index < -1 || new_index >= history.len() as isize {
            return;
        }
        if index == -1 && new_index >= 0 {
            // Entering the browse mode: snapshot the editor state, so the
            // draft (text **and** caret) can be restored.
            self.push_undo_snapshot();
            *self.history_draft.lock().unwrap() = Some(self.snapshot_state());
        }
        *self.history_index.lock().unwrap() = new_index;
        if new_index == -1 {
            let draft = self.history_draft.lock().unwrap().take();
            match draft {
                Some(draft) => {
                    self.restore_state(&draft);
                    *self.preferred_visual_col.lock().unwrap() = None;
                    *self.snapped_from_cursor_col.lock().unwrap() = None;
                    *self.scroll_offset.lock().unwrap() = 0;
                    *self.scroll_pinned.lock().unwrap() = false;
                    self.notify_change();
                }
                None => self.set_text_internal("", false),
            }
            return;
        }
        let text = history[new_index as usize].clone();
        drop(history);
        self.set_text_internal(&text, direction == -1);
    }

    /// Replace the text, placing the caret at its start (`at_start`) or at the
    /// end of the last line (the original's `setTextInternal`).
    fn set_text_internal(&self, text: &str, at_start: bool) {
        let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
        if let Ok(mut state) = self.state.lock() {
            state.lines = if normalized.is_empty() {
                vec![String::new()]
            } else {
                normalized.split('\n').map(|line| line.to_string()).collect()
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
        *self.scroll_offset.lock().unwrap() = 0;
        *self.scroll_pinned.lock().unwrap() = false;
        self.notify_change();
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
        *self.scroll_pinned.lock().unwrap() = false;
        let kb = self.keybindings.clone();

        let jump_direction = *self.jump_mode.lock().unwrap();
        if let Some(direction) = jump_direction {
            if kb.matches(&key, keybindings::keys::JUMP_FORWARD)
                || kb.matches(&key, keybindings::keys::JUMP_BACKWARD)
            {
                *self.jump_mode.lock().unwrap() = None;
                return true;
            }
            if let Some(ch) = printable_char(key) {
                *self.jump_mode.lock().unwrap() = None;
                self.jump_to_char(ch, direction);
                return true;
            }
            *self.jump_mode.lock().unwrap() = None;
        }

        // Shift+arrows extend the selection (a port-only feature: the
        // original's editor has no selection of its own).
        match (key.modifiers, key.code) {
            (KeyModifiers::SHIFT, KeyCode::Left) => {
                self.begin_selection();
                self.cursor_left();
                self.extend_selection();
                return true;
            }
            (KeyModifiers::SHIFT, KeyCode::Right) => {
                self.begin_selection();
                self.cursor_right();
                self.extend_selection();
                return true;
            }
            (KeyModifiers::SHIFT, KeyCode::Up) => {
                self.begin_selection();
                self.cursor_up();
                self.extend_selection();
                return true;
            }
            (KeyModifiers::SHIFT, KeyCode::Down) => {
                self.begin_selection();
                self.cursor_down();
                self.extend_selection();
                return true;
            }
            (KeyModifiers::SHIFT, KeyCode::Home) => {
                self.begin_selection();
                self.cursor_home();
                self.extend_selection();
                return true;
            }
            (KeyModifiers::SHIFT, KeyCode::End) => {
                self.begin_selection();
                self.cursor_end();
                self.extend_selection();
                return true;
            }
            _ => {}
        }

        // Ctrl+C belongs to the parent (the original ignores it in the
        // editor, so the app can copy the selection).
        if kb.matches(&key, keybindings::keys::INPUT_COPY) {
            return true;
        }

        // Undo (the original's `tui.editor.undo`).
        if kb.matches(&key, keybindings::keys::UNDO) {
            self.undo();
            return true;
        }

        // Deletions.
        if kb.matches(&key, keybindings::keys::DELETE_TO_LINE_END) {
            self.delete_to_end_of_line();
            return true;
        }
        if kb.matches(&key, keybindings::keys::DELETE_TO_LINE_START) {
            self.delete_to_start_of_line();
            return true;
        }
        if kb.matches(&key, keybindings::keys::DELETE_WORD_BACKWARD) {
            self.kill_word_backward();
            return true;
        }
        if kb.matches(&key, keybindings::keys::DELETE_WORD_FORWARD) {
            self.kill_word_forward();
            return true;
        }
        if kb.matches(&key, keybindings::keys::DELETE_CHAR_BACKWARD)
            || matches_key(&key, KeyCode::Backspace, KeyModifiers::SHIFT)
        {
            self.backspace();
            return true;
        }
        if kb.matches(&key, keybindings::keys::DELETE_CHAR_FORWARD)
            || matches_key(&key, KeyCode::Delete, KeyModifiers::SHIFT)
        {
            self.delete();
            return true;
        }

        // Kill-ring yank and yank-pop.
        if kb.matches(&key, keybindings::keys::YANK) {
            self.yank();
            return true;
        }
        if kb.matches(&key, keybindings::keys::YANK_POP) {
            self.yank_pop();
            return true;
        }

        // The dedicated history bindings browse the entries instead of moving
        // the caret.
        if kb.matches(&key, keybindings::keys::HISTORY_PREVIOUS) {
            self.navigate_history(-1);
            return true;
        }
        if kb.matches(&key, keybindings::keys::HISTORY_NEXT) {
            self.navigate_history(1);
            return true;
        }

        // Cursor movement.
        if kb.matches(&key, keybindings::keys::CURSOR_LINE_START) {
            self.move_to_line_start();
            return true;
        }
        if kb.matches(&key, keybindings::keys::CURSOR_WORD_LEFT) {
            self.cursor_word_left();
            return true;
        }
        if kb.matches(&key, keybindings::keys::CURSOR_WORD_RIGHT) {
            self.cursor_word_right();
            return true;
        }

        // A newline (Shift+Enter, Ctrl+J). A bare LF is a newline too: the
        // original reads "\n" as shift+enter.
        if kb.matches(&key, keybindings::keys::INPUT_NEW_LINE)
            || matches_key(&key, KeyCode::Char('\n'), KeyModifiers::NONE)
            || matches_key(&key, KeyCode::Char('\n'), KeyModifiers::SHIFT)
            || matches_key(&key, KeyCode::Char('\r'), KeyModifiers::SHIFT)
        {
            self.add_new_line();
            return true;
        }

        // Submit (Enter). A backslash before the caret turns the submit into
        // a newline (the original's `shouldSubmitOnBackslashEnter`).
        if kb.matches(&key, keybindings::keys::INPUT_SUBMIT)
            || matches_key(&key, KeyCode::Char('\r'), KeyModifiers::NONE)
        {
            if self.char_before_cursor_is_backslash() {
                self.backspace();
                self.add_new_line();
                return true;
            }
            self.submit();
            return true;
        }

        // Arrow navigation.
        if kb.matches(&key, keybindings::keys::CURSOR_UP) {
            self.cursor_up();
            return true;
        }
        if kb.matches(&key, keybindings::keys::CURSOR_DOWN) {
            self.cursor_down();
            return true;
        }
        if kb.matches(&key, keybindings::keys::CURSOR_RIGHT) {
            self.cursor_right();
            return true;
        }
        if kb.matches(&key, keybindings::keys::CURSOR_LEFT) {
            self.cursor_left();
            return true;
        }

        // Page up/down: a page of visual lines.
        if kb.matches(&key, keybindings::keys::EDITOR_PAGE_UP) {
            self.page_scroll(-1);
            return true;
        }
        if kb.matches(&key, keybindings::keys::EDITOR_PAGE_DOWN) {
            self.page_scroll(1);
            return true;
        }

        // Character jump mode.
        if kb.matches(&key, keybindings::keys::JUMP_FORWARD) {
            *self.jump_mode.lock().unwrap() = Some(1);
            return true;
        }
        if kb.matches(&key, keybindings::keys::JUMP_BACKWARD) {
            *self.jump_mode.lock().unwrap() = Some(-1);
            return true;
        }

        // Port-only conveniences the original has no binding for: the line
        // end, a redo, and the selection's cut and paste.
        match (key.modifiers, key.code) {
            (KeyModifiers::NONE, KeyCode::End) => {
                self.cursor_end();
                return true;
            }
            (KeyModifiers::CONTROL, KeyCode::Char('e')) => {
                self.cursor_end();
                return true;
            }
            (KeyModifiers::CONTROL, KeyCode::Char('r')) => {
                self.redo();
                return true;
            }
            (KeyModifiers::CONTROL, KeyCode::Char('x')) => {
                self.cut_selection();
                return true;
            }
            (KeyModifiers::CONTROL, KeyCode::Char('v')) => {
                self.yank();
                return true;
            }
            _ => {}
        }

        // Regular character input.
        if let Some(ch) = printable_char(key) {
            self.insert_character(ch);
            return true;
        }

        false
    }

    /// Split the line at the caret and move the caret to the start of the new
    /// line (the original's `addNewLine`).
    fn add_new_line(&self) {
        self.exit_history_browsing();
        *self.last_action.lock().unwrap() = None;
        self.push_undo_snapshot();
        if let Ok(mut state) = self.state.lock() {
            let row = state.cursor_row;
            let col = state.cursor_col;
            let current_line = &mut state.lines[row];
            let after = current_line.split_off(col);
            state.lines.insert(row + 1, after);
            state.cursor_row += 1;
            state.cursor_col = 0;
        }
        self.notify_change();
    }

    /// Whether the character right before the caret is a backslash.
    fn char_before_cursor_is_backslash(&self) -> bool {
        let state = self.state.lock().unwrap();
        if state.cursor_col == 0 {
            return false;
        }
        let row = state.cursor_row;
        state.lines[row][..state.cursor_col]
            .chars()
            .next_back()
            .map(|c| c == '\\')
            .unwrap_or(false)
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
            guard.cursor_col =
                snap_out_of_paste_marker(&guard.lines[chunk.row], guard.cursor_col);
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
    ///
    /// The spinner frame is read from the counter the ticker advances — the
    /// paint does not move the animation. The elapsed clock is read from the
    /// working state's start instant, so it shows the same value it always
    /// did: whole seconds, refreshed on every paint.
    fn working_row(&self) -> String {
        let working_state = self.working.lock().ok().and_then(|guard| guard.clone());
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
    fn the_working_spinner_advances_by_frame_not_by_render() {
        use crate::component::Component;
        let editor = Editor::simple();
        editor.set_working(Some(WorkingState {
            frame: 0,
            started_at: std::time::Instant::now(),
            message: "Working…".to_string(),
        }));
        // The frame is a counter the ticker advances; the test owns it from
        // here on.
        editor.stop_working_animation();
        let base = editor.working().expect("working state").frame;

        // The indicator lives in the top border and reports the message.
        let first = crate::strip_ansi(&editor.render(60)[0]);
        assert!(first.contains("Working"), "top border: {first}");

        // A paint does not move the animation: the frame comes from the
        // counter, not from the clock and not from the render.
        let _ = editor.render(60);
        assert_eq!(
            editor.working().expect("working state").frame,
            base,
            "a paint must not advance the frame"
        );

        // One interval moves the spinner exactly one frame.
        editor.advance_working_frame();
        assert_eq!(editor.working().expect("working state").frame, base + 1);
        let after = crate::strip_ansi(&editor.render(60)[0]);
        assert!(
            after.contains(crate::loader::SPINNER_FRAMES[(base + 1) % 10]),
            "the second frame must be on screen: {after}"
        );

        // Idle editors have no indicator.
        editor.set_working(None);
        let idle = crate::strip_ansi(&editor.render(60)[0]);
        assert!(!idle.contains("Working"), "idle border: {idle}");
    }

    #[test]
    fn the_working_spinner_follows_the_originals_frame_rule() {
        // upstream's `Loader`: the frame counter starts at zero when the
        // indicator starts and advances once per `SPINNER_FRAME_MS`, so the
        // frame after `k` intervals is the one `spinnerFrame(k * 80)` returns.
        use crate::component::Component;
        assert_eq!(crate::loader::SPINNER_FRAMES.len(), 10);
        assert_eq!(
            crate::loader::SPINNER_FRAMES.iter().collect::<String>(),
            "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
        );
        assert_eq!(crate::loader::SPINNER_FRAME_MS, 80);

        let editor = Editor::simple();
        editor.set_working(Some(WorkingState {
            frame: 0,
            started_at: std::time::Instant::now(),
            message: "Working…".to_string(),
        }));
        editor.stop_working_animation();
        let base = editor.working().expect("working").frame;
        let spinner_of = |line: &str| {
            let plain = crate::strip_ansi(line);
            crate::loader::SPINNER_FRAMES
                .iter()
                .copied()
                .find(|c| plain.contains(*c))
        };
        for k in 0..10usize {
            let elapsed = std::time::Duration::from_millis((base + k) as u64 * 80);
            assert_eq!(
                spinner_of(&editor.render(60)[0]),
                Some(crate::loader::spinner_frame_at(elapsed)),
                "frame {k} must match the original's rule"
            );
            editor.advance_working_frame();
        }
    }

    #[test]
    fn the_working_indicator_keeps_the_elapsed_clock() {
        // The clock shows whole seconds from the moment the indicator starts,
        // and minutes once the run passes a minute.
        use crate::component::Component;
        let editor = Editor::simple();
        editor.set_working(Some(WorkingState {
            frame: 0,
            started_at: std::time::Instant::now(),
            message: "Working…".to_string(),
        }));
        editor.stop_working_animation();
        let row = crate::strip_ansi(&editor.render(60)[0]);
        assert!(row.contains("0s"), "the clock starts at zero: {row}");

        editor.set_working(Some(WorkingState {
            frame: 0,
            started_at: std::time::Instant::now() - std::time::Duration::from_secs(7),
            message: "Working…".to_string(),
        }));
        let row = crate::strip_ansi(&editor.render(60)[0]);
        assert!(row.contains("7s"), "elapsed clock: {row}");

        editor.set_working(Some(WorkingState {
            frame: 0,
            started_at: std::time::Instant::now() - std::time::Duration::from_secs(65),
            message: "Working…".to_string(),
        }));
        let row = crate::strip_ansi(&editor.render(60)[0]);
        assert!(row.contains("1m5s"), "elapsed clock: {row}");
    }

    #[test]
    fn idle_cadence_matches_native_pi() {
        // One frame per `SPINNER_FRAME_MS`: ten frames make the 800ms cycle
        // upstream animates at.
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
        editor.stop_working_animation();
        let before = editor.working().expect("working").frame;
        let _ = editor.render(60);
        assert_eq!(
            editor.working().expect("working").frame,
            before,
            "a paint must not advance the frame"
        );
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

        // Page scroll on a multi-line buffer clamps to the last row. A page
        // is `max(5, 30% of the rows)` visual lines.
        editor.set_terminal_rows(40);
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
        // Ctrl+C belongs to the parent (the original ignores it in the
        // editor), so the text and the selection are untouched.
        editor.handle_key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Char('c'),
            crossterm::event::KeyModifiers::CONTROL,
        ));
        assert_eq!(editor.get_text(), "hello world");
        assert!(editor.has_selection(), "ctrl+c does not touch the selection");
        // A plain caret move does not end the selection either.
        editor.handle_key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Right,
            crossterm::event::KeyModifiers::NONE,
        ));
        assert!(editor.has_selection(), "plain movement keeps the selection");
        // Ctrl+X cuts the selection (a port-only command) and kills it.
        editor.handle_key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Char('x'),
            crossterm::event::KeyModifiers::CONTROL,
        ));
        assert_eq!(editor.get_text(), " world");
        // Ctrl+V yanks the killed text back.
        editor.handle_key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::End,
            crossterm::event::KeyModifiers::NONE,
        ));
        editor.handle_key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Char('v'),
            crossterm::event::KeyModifiers::CONTROL,
        ));
        assert_eq!(editor.get_text(), " worldhello");
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
        // A programmatic insertion is atomic: one undo restores the state
        // before it.
        assert_eq!(editor.get_text(), "hello world");
        editor.undo();
        assert_eq!(editor.get_text(), "hello");
        editor.undo();
        assert_eq!(editor.get_text(), "");
        // Redo restores everything.
        editor.redo();
        assert_eq!(editor.get_text(), "hello");
        editor.redo();
        assert_eq!(editor.get_text(), "hello world");
        // A fresh edit after undo clears redo.
        editor.undo();
        editor.insert("hi");
        let after_edit = editor.get_text();
        editor.redo();
        assert_eq!(
            editor.get_text(),
            after_edit,
            "new edit clears the redo stack"
        );
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

    /// The original reads a bare CR as the Enter key and a bare LF as
    /// shift+enter (packages/tui/src/keys.ts:1337): CR submits, LF inserts a
    /// newline. The port follows the original.
    #[test]
    fn a_bare_cr_submits_and_a_bare_lf_is_a_newline() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let editor = Editor::simple();
        let submits = Arc::new(AtomicUsize::new(0));
        let submits_for_cb = submits.clone();
        editor.on_submit(Arc::new(move |_text: &str| {
            submits_for_cb.fetch_add(1, Ordering::SeqCst);
        }));
        editor.insert("hello");
        editor.handle_key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Char('\r'),
            crossterm::event::KeyModifiers::NONE,
        ));
        assert_eq!(submits.load(Ordering::SeqCst), 1, "CR submits");
        assert_eq!(editor.get_text(), "", "editor cleared after submit");

        let editor = Editor::simple();
        editor.on_submit(Arc::new(|_| panic!("a bare LF must not submit")));
        editor.insert("hello");
        editor.handle_key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Char('\n'),
            crossterm::event::KeyModifiers::NONE,
        ));
        assert_eq!(editor.get_text(), "hello\n", "a bare LF inserts a newline");
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

    // ------------------------------------------------------------------
    // The parity tests: one per behaviour cluster, each pinned to the
    // original's rule (packages/tui/src/components/editor.ts).
    // ------------------------------------------------------------------

    /// A key event with the given modifiers and code.
    fn key(m: KeyModifiers, c: KeyCode) -> crossterm::event::KeyEvent {
        crossterm::event::KeyEvent::new(c, m)
    }

    #[test]
    fn the_editor_resolves_its_keys_through_the_keybinding_registry() {
        use crate::keybindings::KeyCombo;
        let mut keybindings = Keybindings::new();
        // Rebind the line start to ctrl+h and drop the default keys.
        keybindings.set(
            keybindings::keys::CURSOR_LINE_START,
            vec![KeyCombo::new(KeyCode::Char('h'), KeyModifiers::CONTROL)],
        );
        let editor = Editor::new(
            EditorOptions::default(),
            EditorStyle::default(),
            Arc::new(keybindings),
        );
        editor.insert("hello");
        editor.handle_key(key(KeyModifiers::CONTROL, KeyCode::Char('h')));
        assert_eq!(editor.cursor_position(), (0, 0), "the rebind moves the caret");
        // The default binding (Home) is gone with the rebind.
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::End));
        assert_eq!(editor.cursor_position(), (0, 5));
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Home));
        assert_eq!(editor.cursor_position(), (0, 5), "the default binding is gone");
    }

    #[test]
    fn the_arrows_step_by_grapheme() {
        let editor = Editor::simple();
        editor.insert("a\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}b");
        let end = editor.get_text().len();
        editor.set_cursor(0, end);
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Left));
        assert_eq!(editor.cursor_position(), (0, end - 1), "one grapheme back");
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Left));
        assert_eq!(
            editor.cursor_position().1,
            1,
            "the whole emoji is one step"
        );
    }

    #[test]
    fn the_vertical_movement_walks_visual_lines() {
        let editor = Editor::simple();
        editor.set_text("aaaa bbbb cccc dddd eeee ffff gggg");
        // The card is 20 cells wide: the text is laid out at 17 cells, so the
        // line wraps into three visual lines.
        editor.render(20);
        editor.set_cursor(0, 0);
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Down));
        assert_eq!(
            editor.cursor_position(),
            (0, 15),
            "↓ moves one visual line, not one logical line"
        );
    }

    #[test]
    fn the_vertical_movement_keeps_the_sticky_column() {
        let editor = Editor::simple();
        editor.set_text("abcdefghij\nab\nabcdefghij");
        editor.set_cursor(0, 8);
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Down));
        assert_eq!(editor.cursor_position(), (1, 2), "the short line clamps");
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Down));
        assert_eq!(
            editor.cursor_position(),
            (2, 8),
            "the sticky column is restored on the way back"
        );
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Up));
        assert_eq!(editor.cursor_position(), (1, 2), "the short line clamps again");
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Up));
        assert_eq!(editor.cursor_position(), (0, 8), "the column is back where it was");
    }

    #[test]
    fn up_on_the_first_line_goes_to_the_line_start_and_down_on_the_last_to_the_end() {
        let editor = Editor::simple();
        editor.set_text("hello");
        editor.set_cursor(0, 3);
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Up));
        assert_eq!(editor.cursor_position(), (0, 0), "↑ goes to the line start");
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Down));
        assert_eq!(editor.cursor_position(), (0, 5), "↓ goes to the line end");
    }

    #[test]
    fn the_history_recall_lives_in_the_editor() {
        let editor = Editor::simple();
        editor.add_to_history("first");
        editor.add_to_history("second");
        editor.add_to_history("second");
        editor.add_to_history("   ");
        assert_eq!(editor.history(), vec!["second", "first"], "duplicates skipped");

        // ↑ recalls the newest entry with the caret at its start.
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Up));
        assert_eq!(editor.get_text(), "second");
        assert_eq!(editor.cursor_position(), (0, 0));
        assert!(editor.is_browsing_history());

        // ↓ restores the draft, caret included.
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Down));
        assert_eq!(editor.get_text(), "");
        assert!(!editor.is_browsing_history());
    }

    #[test]
    fn the_history_recall_works_over_a_typed_draft_at_the_line_start() {
        let editor = Editor::simple();
        editor.add_to_history("older");
        editor.insert("draft");
        // The caret is not at the line start yet: ↑ goes to the line start.
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Up));
        assert_eq!(editor.get_text(), "draft");
        assert_eq!(editor.cursor_position(), (0, 0));
        // Now ↑ recalls the history over the typed draft.
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Up));
        assert_eq!(editor.get_text(), "older");
        // ↓ restores the draft with its caret.
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Down));
        assert_eq!(editor.get_text(), "draft");
        assert_eq!(editor.cursor_position(), (0, 0));
    }

    #[test]
    fn editing_while_browsing_leaves_the_browse_mode() {
        let editor = Editor::simple();
        editor.add_to_history("older");
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Up));
        assert!(editor.is_browsing_history());
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Char('x')));
        assert!(!editor.is_browsing_history(), "the edit leaves the browse mode");
        // The recalled entry is placed with the caret at its start, so the
        // edit lands in front of it (the original's `setTextInternal`,
        // packages/tui/src/components/editor.ts:573).
        assert_eq!(editor.get_text(), "xolder");
        assert_eq!(editor.cursor_position(), (0, 1));
    }

    #[test]
    fn the_undo_coalesces_fish_style() {
        let editor = Editor::simple();
        for ch in "hello world".chars() {
            editor.handle_key(key(KeyModifiers::NONE, KeyCode::Char(ch)));
        }
        assert_eq!(editor.get_text(), "hello world");
        editor.undo();
        assert_eq!(editor.get_text(), "hello", "the word undoes as one step");
        editor.undo();
        assert_eq!(editor.get_text(), "");
    }

    #[test]
    fn a_paste_is_one_undo_unit_and_never_coalesces_with_the_typing() {
        let editor = Editor::simple();
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Char('a')));
        editor.handle_paste("b");
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Char('c')));
        assert_eq!(editor.get_text(), "abc");
        editor.undo();
        assert_eq!(editor.get_text(), "ab", "the paste is its own undo unit");
        editor.undo();
        assert_eq!(editor.get_text(), "a");
        editor.undo();
        assert_eq!(editor.get_text(), "");
    }

    #[test]
    fn the_kill_accumulation_follows_the_previous_action() {
        let editor = Editor::simple();
        editor.set_text("one two");
        editor.set_cursor(0, 4);
        editor.handle_key(key(KeyModifiers::CONTROL, KeyCode::Char('k')));
        assert_eq!(editor.get_text(), "one ");
        // An edit breaks the accumulation chain.
        editor.set_cursor(0, 0);
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Char('x')));
        editor.handle_key(key(KeyModifiers::CONTROL, KeyCode::Char('k')));
        assert_eq!(editor.get_text(), "x");
        editor.handle_key(key(KeyModifiers::CONTROL, KeyCode::Char('y')));
        assert_eq!(
            editor.get_text(),
            "xone ",
            "the kill after an edit starts a new ring entry"
        );
    }

    #[test]
    fn the_kill_to_the_line_end_joins_the_next_line() {
        let editor = Editor::simple();
        editor.set_text("ab\ncd");
        editor.set_cursor(0, 2);
        editor.handle_key(key(KeyModifiers::CONTROL, KeyCode::Char('k')));
        assert_eq!(editor.get_text(), "abcd", "ctrl+k at the EOL joins the lines");
        assert_eq!(editor.cursor_position(), (0, 2), "the caret stays where it was");
        // ctrl+u at the line start kills the whole line.
        editor.handle_key(key(KeyModifiers::CONTROL, KeyCode::Char('u')));
        assert_eq!(editor.get_text(), "cd", "ctrl+u kills to the line start");
        assert_eq!(editor.cursor_position(), (0, 0));
    }

    #[test]
    fn the_kill_to_the_line_start_joins_the_previous_line() {
        let editor = Editor::simple();
        editor.set_text("ab\ncd");
        editor.set_cursor(1, 0);
        editor.handle_key(key(KeyModifiers::CONTROL, KeyCode::Char('u')));
        assert_eq!(editor.get_text(), "abcd", "ctrl+u at the BOL joins the lines");
        assert_eq!(editor.cursor_position(), (0, 2), "the caret lands at the join");
    }

    #[test]
    fn the_kill_word_back_at_the_line_start_joins_the_previous_line() {
        let editor = Editor::simple();
        editor.set_text("ab\ncd");
        editor.set_cursor(1, 0);
        editor.handle_key(key(KeyModifiers::CONTROL, KeyCode::Char('w')));
        assert_eq!(editor.get_text(), "abcd", "ctrl+w at the BOL joins the lines");
        assert_eq!(editor.cursor_position(), (0, 2), "the caret lands at the join");
    }

    #[test]
    fn the_yank_pop_replaces_the_yanked_text() {
        let editor = Editor::simple();
        editor.set_text("abc");
        editor.set_cursor(0, 2);
        editor.handle_key(key(KeyModifiers::CONTROL, KeyCode::Char('u')));
        assert_eq!(editor.get_text(), "c");
        // An edit breaks the kill chain, so the next kill is a new entry.
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Char('z')));
        editor.set_cursor(0, 1);
        editor.handle_key(key(KeyModifiers::CONTROL, KeyCode::Char('k')));
        assert_eq!(editor.get_text(), "z");
        editor.handle_key(key(KeyModifiers::CONTROL, KeyCode::Char('y')));
        assert_eq!(editor.get_text(), "zc");
        editor.handle_key(key(KeyModifiers::ALT, KeyCode::Char('y')));
        assert_eq!(
            editor.get_text(),
            "zab",
            "the yank-pop replaces the yanked text, it does not duplicate it"
        );
    }

    #[test]
    fn the_selection_survives_a_plain_caret_move() {
        let editor = Editor::simple();
        editor.insert("hello world");
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Home));
        for _ in 0..5 {
            editor.handle_key(key(KeyModifiers::SHIFT, KeyCode::Right));
        }
        assert_eq!(editor.selected_text().as_deref(), Some("hello"));
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Right));
        assert!(
            editor.has_selection(),
            "a plain caret move does not end the selection"
        );
        assert_eq!(editor.selected_text().as_deref(), Some("hello"));
    }

    #[test]
    fn a_pasted_path_gets_a_leading_space() {
        let editor = Editor::simple();
        editor.insert("foo");
        editor.handle_paste("/tmp/x");
        assert_eq!(editor.get_text(), "foo /tmp/x");
    }

    #[test]
    fn a_backslash_before_the_caret_turns_the_submit_into_a_newline() {
        let editor = Editor::simple();
        editor.on_submit(Arc::new(|_| panic!("the backslash swallows the submit")));
        editor.insert("a\\");
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Enter));
        assert_eq!(editor.get_text(), "a\n");
    }

    #[test]
    fn the_submit_sends_the_trimmed_text_and_clears_the_editor_first() {
        let editor = Editor::simple();
        let seen = Arc::new(std::sync::Mutex::new(String::new()));
        let seen_for_cb = seen.clone();
        editor.on_submit(Arc::new(move |text: &str| {
            *seen_for_cb.lock().unwrap() = text.to_string();
        }));
        editor.insert("  hello  ");
        editor.handle_key(key(KeyModifiers::NONE, KeyCode::Enter));
        assert_eq!(seen.lock().unwrap().clone(), "hello", "the text is trimmed");
        assert_eq!(editor.get_text(), "", "the editor is cleared");
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
    fn an_edit_ends_the_selection() {
        use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
        let editor = Editor::simple();
        editor.set_text("one\ntwo\nthree");
        editor.set_cursor(2, 0);
        // Shift+Up extends the selection up.
        editor.handle_key(KeyEvent::new(KeyCode::Up, KeyModifiers::SHIFT));
        assert!(editor.has_selection(), "shift+up selects");
        // A plain Up moves the cursor but leaves the selection: the span is
        // the two ends of the selection, not the anchor and the caret.
        editor.handle_key(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE));
        assert!(editor.has_selection(), "a plain move leaves the selection");
        assert_eq!(editor.cursor_position().0, 0);
        // An edit ends it.
        editor.handle_key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE));
        assert!(!editor.has_selection(), "an edit ends the selection");
    }

    #[test]
    fn the_word_moves_land_on_character_boundaries() {
        use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
        let editor = Editor::simple();
        editor.insert("héllo wörld");
        editor.set_cursor(0, 0);
        // "héllo" is six bytes: the caret is a byte offset, so a word move has
        // to land on a character boundary.
        editor.handle_key(KeyEvent::new(KeyCode::Right, KeyModifiers::ALT));
        assert_eq!(editor.cursor_position(), (0, 6));
        editor.handle_key(KeyEvent::new(KeyCode::Right, KeyModifiers::ALT));
        assert_eq!(editor.cursor_position(), (0, 13));
        editor.handle_key(KeyEvent::new(KeyCode::Left, KeyModifiers::ALT));
        assert_eq!(editor.cursor_position(), (0, 7));
        editor.handle_key(KeyEvent::new(KeyCode::Left, KeyModifiers::CONTROL));
        assert_eq!(editor.cursor_position(), (0, 0));
    }

    #[test]
    fn the_caret_never_lands_inside_a_folded_paste_marker() {
        let editor = Editor::simple();
        let payload = "x".repeat(2000);
        editor.handle_paste(&payload);
        let text = editor.get_text();
        let marker_start = text.find("[paste #").expect("a folded marker");
        let marker_end = marker_start + text[marker_start..].find(']').unwrap() + 1;
        editor.set_cursor(0, marker_start + 3);
        assert_eq!(
            editor.cursor_position().1,
            marker_start,
            "the caret snaps to the start of the marker"
        );
        editor.set_cursor(0, marker_end);
        assert_eq!(editor.cursor_position().1, marker_end);
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

    /// One step of a recorded editor session.
    enum Step {
        /// Set the text and walk the caret to `(line, col)`.
        Goto(&'static str, usize, usize),
        /// Add a history entry.
        History(&'static str),
        /// Type a literal string, one character at a time.
        Type(&'static str),
        /// Insert a literal string at the caret in one go.
        Insert(&'static str),
        /// Press a key.
        Key(KeyModifiers, KeyCode),
        /// Record the text and the caret.
        Check(&'static str, &'static str, (usize, usize)),
    }

    /// The editor sessions measured on the original's TypeScript editor
    /// (`packages/tui/src/components/editor.ts`), one row per cluster: the
    /// vertical movement, the history, the undo, the kill ring, the keybinding
    /// registry and the submit. The port must land on the same text and the
    /// same caret for every row.
    const ORIGINAL_SESSIONS: &[(&str, &[Step])] = &[
        (
            "the vertical movement keeps the sticky column",
            &[
                Step::Goto("abcdefghij\nab\nabcdefghij", 0, 8),
                Step::Check("start", "abcdefghij\nab\nabcdefghij", (0, 8)),
                Step::Key(KeyModifiers::NONE, KeyCode::Down),
                Step::Check("down1", "abcdefghij\nab\nabcdefghij", (1, 2)),
                Step::Key(KeyModifiers::NONE, KeyCode::Down),
                Step::Check("down2", "abcdefghij\nab\nabcdefghij", (2, 8)),
                Step::Key(KeyModifiers::NONE, KeyCode::Up),
                Step::Check("up1", "abcdefghij\nab\nabcdefghij", (1, 2)),
                Step::Key(KeyModifiers::NONE, KeyCode::Up),
                Step::Check("up2", "abcdefghij\nab\nabcdefghij", (0, 8)),
            ],
        ),
        (
            "the vertical movement clamps on a short line",
            &[
                Step::Goto("abcdefghij\nab\nabcdefghij", 2, 8),
                Step::Key(KeyModifiers::NONE, KeyCode::Up),
                Step::Check("up1", "abcdefghij\nab\nabcdefghij", (1, 2)),
                Step::Key(KeyModifiers::NONE, KeyCode::Up),
                Step::Check("up2", "abcdefghij\nab\nabcdefghij", (0, 8)),
                Step::Key(KeyModifiers::NONE, KeyCode::Down),
                Step::Check("down1", "abcdefghij\nab\nabcdefghij", (1, 2)),
                Step::Key(KeyModifiers::NONE, KeyCode::Down),
                Step::Check("down2", "abcdefghij\nab\nabcdefghij", (2, 8)),
            ],
        ),
        (
            "up on the first line goes to the line start",
            &[
                Step::Goto("hello", 0, 2),
                Step::Key(KeyModifiers::NONE, KeyCode::Up),
                Step::Check("up", "hello", (0, 0)),
                Step::Key(KeyModifiers::NONE, KeyCode::Down),
                Step::Check("down", "hello", (0, 5)),
            ],
        ),
        (
            "the history recalls the entries newest first",
            &[
                Step::History("first"),
                Step::History("second"),
                Step::History("second"),
                Step::History("   "),
                Step::Key(KeyModifiers::NONE, KeyCode::Up),
                Step::Check("up", "second", (0, 0)),
                Step::Key(KeyModifiers::NONE, KeyCode::Up),
                Step::Check("up2", "first", (0, 0)),
                Step::Key(KeyModifiers::NONE, KeyCode::Down),
                Step::Check("down", "second", (0, 6)),
                Step::Key(KeyModifiers::NONE, KeyCode::Down),
                Step::Check("down2", "", (0, 0)),
            ],
        ),
        (
            "the history recalls over a typed draft",
            &[
                Step::History("first"),
                Step::History("second"),
                Step::Type("dr"),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('a')),
                Step::Check("draft", "dr", (0, 0)),
                Step::Key(KeyModifiers::NONE, KeyCode::Up),
                Step::Check("up", "second", (0, 0)),
                Step::Key(KeyModifiers::NONE, KeyCode::Down),
                Step::Check("down", "dr", (0, 0)),
            ],
        ),
        (
            "the undo coalesces fish style",
            &[
                Step::Type("hello world"),
                Step::Check("typed", "hello world", (0, 11)),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('-')),
                Step::Check("undo1", "hello", (0, 5)),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('-')),
                Step::Check("undo2", "", (0, 0)),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('-')),
                Step::Check("undo3", "", (0, 0)),
            ],
        ),
        (
            "ctrl+k at the line end joins the next line",
            &[
                Step::Goto("ab\ncd", 0, 2),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('k')),
                Step::Check("eol", "abcd", (0, 2)),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('u')),
                Step::Check("bol", "cd", (0, 0)),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('y')),
                Step::Check("yank", "ab\ncd", (1, 0)),
            ],
        ),
        (
            "ctrl+u at the line start joins the previous line",
            &[
                Step::Goto("ab\ncd", 1, 0),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('u')),
                Step::Check("join", "abcd", (0, 2)),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('y')),
                Step::Check("yank", "ab\ncd", (1, 0)),
            ],
        ),
        (
            "ctrl+w at the line start joins the previous line",
            &[
                Step::Goto("ab\ncd", 1, 0),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('w')),
                Step::Check("join", "abcd", (0, 2)),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('y')),
                Step::Check("yank", "ab\ncd", (1, 0)),
            ],
        ),
        (
            "alt+d at the line end joins the next line",
            &[
                Step::Goto("ab\ncd", 0, 2),
                Step::Key(KeyModifiers::ALT, KeyCode::Char('d')),
                Step::Check("altd", "abcd", (0, 2)),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('y')),
                Step::Check("yank", "ab\ncd", (1, 0)),
            ],
        ),
        (
            "the kill ring accumulates over consecutive kills",
            &[
                Step::Goto("alpha beta", 0, 10),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('w')),
                Step::Check("w1", "alpha ", (0, 6)),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('w')),
                Step::Check("w2", "", (0, 0)),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('y')),
                Step::Check("yank", "alpha beta", (0, 10)),
            ],
        ),
        (
            "an edit breaks the kill ring's accumulation",
            &[
                Step::Goto("alpha beta", 0, 10),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('w')),
                Step::Insert("z"),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('k')),
                Step::Check("kill", "alpha z", (0, 7)),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('y')),
                Step::Check("yank", "alpha zbeta", (0, 11)),
            ],
        ),
        (
            "the keybinding registry resolves the editor's keys",
            &[
                Step::Goto("abc", 0, 3),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('a')),
                Step::Check("ctrla", "abc", (0, 0)),
                Step::Key(KeyModifiers::NONE, KeyCode::Right),
                Step::Key(KeyModifiers::NONE, KeyCode::Right),
                Step::Key(KeyModifiers::NONE, KeyCode::Right),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('b')),
                Step::Check("ctrlb", "abc", (0, 2)),
                Step::Key(KeyModifiers::CONTROL, KeyCode::Char('f')),
                Step::Check("ctrlf", "abc", (0, 3)),
            ],
        ),
        (
            "the word moves land where the original puts them",
            &[
                Step::Goto("alpha beta gamma", 0, 0),
                Step::Key(KeyModifiers::ALT, KeyCode::Left),
                Step::Check("altleft", "alpha beta gamma", (0, 0)),
                Step::Key(KeyModifiers::ALT, KeyCode::Right),
                Step::Check("altright", "alpha beta gamma", (0, 5)),
                Step::Key(KeyModifiers::ALT, KeyCode::Right),
                Step::Check("altright2", "alpha beta gamma", (0, 10)),
            ],
        ),
        (
            "a word move crosses the line boundary",
            &[
                Step::Goto("alpha\nbeta", 1, 0),
                Step::Key(KeyModifiers::ALT, KeyCode::Left),
                Step::Check("wordleft", "alpha\nbeta", (0, 5)),
                Step::Goto("alpha\nbeta", 0, 5),
                Step::Key(KeyModifiers::ALT, KeyCode::Right),
                Step::Check("wordright", "alpha\nbeta", (1, 0)),
            ],
        ),
        (
            "enter submits and clears the editor",
            &[
                Step::Type("hi"),
                Step::Key(KeyModifiers::NONE, KeyCode::Enter),
                Step::Check("enter", "", (0, 0)),
            ],
        ),
        (
            "a backslash before the caret turns the submit into a newline",
            &[
                Step::Type("hi\\"),
                Step::Key(KeyModifiers::NONE, KeyCode::Enter),
                Step::Check("backslash", "hi\n", (1, 0)),
            ],
        ),
    ];

    #[test]
    fn the_editor_matches_the_originals_measured_sessions() {
        for (name, steps) in ORIGINAL_SESSIONS {
            let editor = Editor::simple();
            for step in steps.iter() {
                match step {
                    Step::Goto(text, line, col) => {
                        editor.set_text(text);
                        let total = editor.get_text().lines().count().max(1);
                        for _ in 0..total.saturating_sub(1 + line) {
                            editor.handle_key(crossterm::event::KeyEvent::new(
                                KeyCode::Up,
                                KeyModifiers::NONE,
                            ));
                        }
                        editor.handle_key(crossterm::event::KeyEvent::new(
                            KeyCode::Char('a'),
                            KeyModifiers::CONTROL,
                        ));
                        for _ in 0..*col {
                            editor.handle_key(crossterm::event::KeyEvent::new(
                                KeyCode::Right,
                                KeyModifiers::NONE,
                            ));
                        }
                    }
                    Step::History(text) => editor.add_to_history(text),
                    Step::Type(text) => {
                        for ch in text.chars() {
                            editor.handle_key(crossterm::event::KeyEvent::new(
                                KeyCode::Char(ch),
                                KeyModifiers::NONE,
                            ));
                        }
                    }
                    Step::Insert(text) => editor.insert(text),
                    Step::Key(mods, code) => {
                        editor.handle_key(crossterm::event::KeyEvent::new(*code, *mods));
                    }
                    Step::Check(label, expected_text, expected_cursor) => {
                        assert_eq!(
                            &editor.get_text(),
                            expected_text,
                            "{name}: {label} text"
                        );
                        assert_eq!(
                            editor.cursor_position(),
                            *expected_cursor,
                            "{name}: {label} caret"
                        );
                    }
                }
            }
        }
    }
}
