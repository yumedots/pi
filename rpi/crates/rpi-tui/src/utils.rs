//! Utilities for TUI rendering.
//!
//! Provides functions for text manipulation with ANSI awareness.

use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

/// Get the visible width of a string, ignoring ANSI escape sequences.
///
/// The width is measured on the whole text, so an emoji cluster counts as the
/// two columns it occupies instead of one column per code point.
pub fn visible_width(s: &str) -> usize {
    crate::ansi::visible_width(s)
}

/// The pieces of a line: the escape sequences and the grapheme clusters
/// between them. A cluster is never split, so an emoji keeps its shape.
enum LineAtom<'a> {
    Escape(&'a str),
    Grapheme(&'a str),
}

/// Take one escape sequence from the front of `s`.
pub(crate) fn take_escape_sequence(s: &str) -> Option<(&str, &str)> {
    let bytes = s.as_bytes();
    if bytes.first() != Some(&0x1b) {
        return None;
    }
    match bytes.get(1) {
        Some(b'[') => {
            let mut index = 2;
            while index < bytes.len() {
                let byte = bytes[index];
                index += 1;
                if (0x40..=0x7e).contains(&byte) {
                    return Some((&s[..index], &s[index..]));
                }
            }
            None
        }
        Some(b']') | Some(b'_') | Some(b'P') | Some(b'^') => {
            let mut index = 2;
            while index < bytes.len() {
                let byte = bytes[index];
                index += 1;
                if byte == 0x07 {
                    return Some((&s[..index], &s[index..]));
                }
                if byte == 0x1b && bytes.get(index) == Some(&b'\\') {
                    return Some((&s[..index + 1], &s[index + 1..]));
                }
            }
            None
        }
        Some(_) => Some((&s[..2], &s[2..])),
        None => None,
    }
}

/// Split a line into its escape sequences and grapheme clusters.
fn line_atoms(text: &str) -> Vec<LineAtom<'_>> {
    let mut atoms = Vec::new();
    let mut rest = text;
    while !rest.is_empty() {
        if let Some((escape, remainder)) = take_escape_sequence(rest) {
            atoms.push(LineAtom::Escape(escape));
            rest = remainder;
            continue;
        }
        let grapheme = rest.graphemes(true).next().unwrap_or_default();
        atoms.push(LineAtom::Grapheme(grapheme));
        rest = &rest[grapheme.len()..];
    }
    atoms
}

/// Slice a string by column positions, accounting for ANSI codes.
/// Returns the portion of the string that fits within start_col..end_col.
pub fn slice_by_column(s: &str, start_col: usize, max_cols: usize, pad: bool) -> String {
    let mut result = String::new();
    let mut col = 0;
    let mut pending_styles = String::new();

    for atom in line_atoms(s) {
        match atom {
            LineAtom::Escape(escape) => {
                pending_styles.push_str(escape);
            }
            LineAtom::Grapheme(grapheme) => {
                if grapheme.chars().all(char::is_control) {
                    continue;
                }
                let grapheme_width = crate::ansi::visible_width(grapheme);
                if col >= start_col && col < start_col + max_cols {
                    result.push_str(&pending_styles);
                    pending_styles.clear();
                    result.push_str(grapheme);
                }
                col += grapheme_width;
            }
        }
    }

    if pad && col < start_col + max_cols {
        let padding = start_col + max_cols - col;
        for _ in 0..padding {
            result.push(' ');
        }
    }

    result
}

/// Truncate a string to fit within a maximum width.
/// Returns the truncated string with optional suffix.
pub fn truncate_to_width(s: &str, max_width: usize, suffix: &str) -> String {
    if max_width == 0 {
        return String::new();
    }

    let width = visible_width(s);
    if width <= max_width {
        return s.to_string();
    }

    let suffix_width = visible_width(suffix);
    let target_width = max_width.saturating_sub(suffix_width);

    if target_width == 0 {
        return suffix.to_string();
    }

    // Check if input has ANSI codes
    let has_ansi = s.contains("\x1b");

    let mut result = String::new();
    let mut current_width = 0;
    let mut style_stack = String::new();

    for atom in line_atoms(s) {
        match atom {
            LineAtom::Escape(escape) => {
                style_stack.push_str(escape);
            }
            LineAtom::Grapheme(grapheme) => {
                if grapheme.chars().all(char::is_control) {
                    continue;
                }
                let grapheme_width = crate::ansi::visible_width(grapheme);
                if current_width + grapheme_width > target_width {
                    break;
                }
                result.push_str(&style_stack);
                style_stack.clear();
                result.push_str(grapheme);
                current_width += grapheme_width;
            }
        }
    }

    // Add suffix
    result.push_str(suffix);

    // Only reset style if input had ANSI codes
    if has_ansi {
        result.push_str("\x1b[0m");
    }
    result
}

/// Strip ANSI escape sequences from a string.
pub fn strip_ansi(s: &str) -> String {
    if s.contains("\x1b_") || s.contains("\x1b]") {
        return crate::ansi::strip_ansi(s);
    }
    let mut result = String::new();
    let mut in_escape = false;
    let mut chars = s.chars().peekable();

    while let Some(c) = chars.next() {
        if in_escape {
            // OSC ends with BEL or ST
            if c == '\x07' {
                in_escape = false;
            } else if c == '\\' && chars.peek() == Some(&'\\') {
                chars.next();
                in_escape = false;
            }
            // CSI ends with byte in 0x40-0x7E
            else if c >= '@' && c <= '~' && c != '[' {
                in_escape = false;
            }
            // OSC
            else if c == ']' {
                while let Some(&next) = chars.peek() {
                    chars.next();
                    if next == '\x07' {
                        break;
                    } else if next == '\x1b' && chars.peek() == Some(&'\\') {
                        chars.next();
                        break;
                    }
                }
                in_escape = false;
            }
            continue;
        }

        if c == '\x1b' {
            in_escape = true;
            continue;
        }

        result.push(c);
    }

    result
}

/// Length in bytes of the escape sequence starting at `pos`, or `None` when
/// there is none. Mirrors the original's `ansiCodeLength`.
fn ansi_code_length(s: &str, pos: usize) -> Option<usize> {
    let bytes = s.as_bytes();
    if bytes.get(pos) != Some(&0x1b) {
        return None;
    }
    match bytes.get(pos + 1) {
        Some(b'[') => {
            let mut index = pos + 2;
            while index < bytes.len() {
                let byte = bytes[index];
                index += 1;
                if matches!(byte, b'm' | b'G' | b'K' | b'H' | b'J') {
                    return Some(index - pos);
                }
            }
            None
        }
        Some(b']') | Some(b'_') => {
            let mut index = pos + 2;
            while index < bytes.len() {
                let byte = bytes[index];
                index += 1;
                if byte == 0x07 {
                    return Some(index - pos);
                }
                if byte == 0x1b && bytes.get(index) == Some(&b'\\') {
                    return Some(index + 1 - pos);
                }
            }
            None
        }
        _ => None,
    }
}

/// An OSC 8 hyperlink that is currently open.
#[derive(Debug, Clone)]
struct ActiveHyperlink {
    params: String,
    url: String,
    bel_terminated: bool,
}

/// The hyperlink an OSC 8 sequence opens. `None` (inner) means the sequence
/// closes a hyperlink; `None` (outer) means it is not an OSC 8 sequence.
fn parse_osc8_hyperlink(code: &str) -> Option<Option<ActiveHyperlink>> {
    let rest = code.strip_prefix("\x1b]8;")?;
    let (body, bel_terminated) = if let Some(body) = rest.strip_suffix('\x07') {
        (body, true)
    } else if let Some(body) = rest.strip_suffix("\x1b\\") {
        (body, false)
    } else {
        return Some(None);
    };
    let Some(separator) = body.find(';') else {
        return Some(None);
    };
    let url = &body[separator + 1..];
    if url.is_empty() {
        return Some(None);
    }
    Some(Some(ActiveHyperlink {
        params: body[..separator].to_string(),
        url: url.to_string(),
        bel_terminated,
    }))
}

/// The OSC 8 sequence that opens a hyperlink.
fn format_osc8_hyperlink(link: &ActiveHyperlink) -> String {
    let terminator = if link.bel_terminated { "\x07" } else { "\x1b\\" };
    format!("\x1b]8;{};{}{}", link.params, link.url, terminator)
}

/// Tracks the active ANSI state of a line so a wrapped row can re-open the
/// styles that were in force where it broke.
#[derive(Debug, Clone, Default)]
struct AnsiCodeTracker {
    bold: bool,
    dim: bool,
    italic: bool,
    underline: bool,
    blink: bool,
    inverse: bool,
    hidden: bool,
    strikethrough: bool,
    fg_color: Option<String>,
    bg_color: Option<String>,
    hyperlink: Option<ActiveHyperlink>,
}

impl AnsiCodeTracker {
    /// Fold one escape sequence into the tracked state.
    fn process(&mut self, code: &str) {
        if let Some(hyperlink) = parse_osc8_hyperlink(code) {
            self.hyperlink = hyperlink;
            return;
        }
        let Some(params) = code.strip_prefix("\x1b[").and_then(|rest| rest.strip_suffix('m')) else {
            return;
        };
        if params.is_empty() || params == "0" {
            self.reset();
            return;
        }
        let parts: Vec<&str> = params.split(';').collect();
        let mut index = 0;
        while index < parts.len() {
            let Ok(number) = parts[index].parse::<u32>() else {
                index += 1;
                continue;
            };
            if number == 38 || number == 48 {
                if parts.get(index + 1) == Some(&"5") && parts.get(index + 2).is_some() {
                    let color = format!("{};5;{}", parts[index], parts[index + 2]);
                    if number == 38 {
                        self.fg_color = Some(color);
                    } else {
                        self.bg_color = Some(color);
                    }
                    index += 3;
                    continue;
                }
                if parts.get(index + 1) == Some(&"2") && parts.get(index + 4).is_some() {
                    let color = format!(
                        "{};2;{};{};{}",
                        parts[index], parts[index + 2], parts[index + 3], parts[index + 4]
                    );
                    if number == 38 {
                        self.fg_color = Some(color);
                    } else {
                        self.bg_color = Some(color);
                    }
                    index += 5;
                    continue;
                }
            }
            match number {
                0 => self.reset(),
                1 => self.bold = true,
                2 => self.dim = true,
                3 => self.italic = true,
                4 => self.underline = true,
                5 => self.blink = true,
                7 => self.inverse = true,
                8 => self.hidden = true,
                9 => self.strikethrough = true,
                21 => self.bold = false,
                22 => {
                    self.bold = false;
                    self.dim = false;
                }
                23 => self.italic = false,
                24 => self.underline = false,
                25 => self.blink = false,
                27 => self.inverse = false,
                28 => self.hidden = false,
                29 => self.strikethrough = false,
                39 => self.fg_color = None,
                49 => self.bg_color = None,
                30..=37 | 90..=97 => self.fg_color = Some(number.to_string()),
                40..=47 | 100..=107 => self.bg_color = Some(number.to_string()),
                _ => {}
            }
            index += 1;
        }
    }

    fn reset(&mut self) {
        self.bold = false;
        self.dim = false;
        self.italic = false;
        self.underline = false;
        self.blink = false;
        self.inverse = false;
        self.hidden = false;
        self.strikethrough = false;
        self.fg_color = None;
        self.bg_color = None;
    }

    /// The escape sequence that re-opens the tracked styles.
    fn active_codes(&self) -> String {
        let mut codes: Vec<&str> = Vec::new();
        if self.bold {
            codes.push("1");
        }
        if self.dim {
            codes.push("2");
        }
        if self.italic {
            codes.push("3");
        }
        if self.underline {
            codes.push("4");
        }
        if self.blink {
            codes.push("5");
        }
        if self.inverse {
            codes.push("7");
        }
        if self.hidden {
            codes.push("8");
        }
        if self.strikethrough {
            codes.push("9");
        }
        if let Some(fg) = &self.fg_color {
            codes.push(fg);
        }
        if let Some(bg) = &self.bg_color {
            codes.push(bg);
        }
        let mut result = if codes.is_empty() {
            String::new()
        } else {
            format!("\x1b[{}m", codes.join(";"))
        };
        if let Some(link) = &self.hyperlink {
            result.push_str(&format_osc8_hyperlink(link));
        }
        result
    }

    /// The escape sequence that closes the styles that must not bleed past the
    /// end of a row.
    fn line_end_reset(&self) -> String {
        let mut result = String::new();
        if self.underline {
            result.push_str("\x1b[24m");
        }
        if let Some(link) = &self.hyperlink {
            result.push_str(if link.bel_terminated {
                "\x1b]8;;\x07"
            } else {
                "\x1b]8;;\x1b\\"
            });
        }
        result
    }
}

/// Fold every escape sequence of a text into the tracker.
fn update_tracker_from_text(text: &str, tracker: &mut AnsiCodeTracker) {
    let mut index = 0;
    while index < text.len() {
        if let Some(length) = ansi_code_length(text, index) {
            tracker.process(&text[index..index + length]);
            index += length;
        } else {
            index += 1;
        }
    }
}

/// Whether a grapheme may be broken away from its neighbours, as the original
/// does for CJK runs.
pub(crate) fn is_cjk_break(segment: &str) -> bool {
    if segment.is_ascii() {
        return false;
    }
    static RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(
            r"[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]",
        )
        .expect("cjk break regex")
    });
    RE.is_match(segment)
}

/// Split text into word and space tokens, keeping the escape sequences
/// attached to the visible content they style.
fn split_into_tokens_with_ansi(text: &str) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut pending_ansi = String::new();
    let mut current_is_space: Option<bool> = None;
    let bytes = text.as_bytes();
    let mut index = 0;

    while index < text.len() {
        if let Some(length) = ansi_code_length(text, index) {
            pending_ansi.push_str(&text[index..index + length]);
            index += length;
            continue;
        }

        let mut end = index + 1;
        while end < text.len() {
            if bytes[end] == 0x1b && ansi_code_length(text, end).is_some() {
                break;
            }
            end += 1;
        }
        let chunk = &text[index..end];
        for segment in chunk.graphemes(true) {
            let segment_is_space = segment == " ";
            if !segment_is_space && is_cjk_break(segment) {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
                let mut token = std::mem::take(&mut pending_ansi);
                token.push_str(segment);
                tokens.push(token);
                continue;
            }
            if !current.is_empty() && current_is_space != Some(!segment_is_space) {
                tokens.push(std::mem::take(&mut current));
            }
            if !pending_ansi.is_empty() {
                current.push_str(&pending_ansi);
                pending_ansi.clear();
            }
            current_is_space = Some(!segment_is_space);
            current.push_str(segment);
        }
        index = end;
    }

    if !pending_ansi.is_empty() {
        if !current.is_empty() {
            current.push_str(&pending_ansi);
        } else if let Some(last) = tokens.last_mut() {
            last.push_str(&pending_ansi);
        } else {
            current.push_str(&pending_ansi);
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

/// Break a word that is wider than the row into grapheme-sized pieces.
fn break_long_word(word: &str, width: usize, tracker: &mut AnsiCodeTracker) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    let mut current_line = tracker.active_codes();
    let mut current_width = 0usize;
    let bytes = word.as_bytes();
    let mut index = 0;

    while index < word.len() {
        if let Some(length) = ansi_code_length(word, index) {
            let code = &word[index..index + length];
            current_line.push_str(code);
            tracker.process(code);
            index += length;
            continue;
        }
        let mut end = index + 1;
        while end < word.len() {
            if bytes[end] == 0x1b && ansi_code_length(word, end).is_some() {
                break;
            }
            end += 1;
        }
        for grapheme in word[index..end].graphemes(true) {
            if grapheme.is_empty() {
                continue;
            }
            let grapheme_width = crate::ansi::visible_width(grapheme);
            if current_width + grapheme_width > width {
                let line_end_reset = tracker.line_end_reset();
                if !line_end_reset.is_empty() {
                    current_line.push_str(&line_end_reset);
                }
                lines.push(std::mem::take(&mut current_line));
                current_line = tracker.active_codes();
                current_width = 0;
            }
            current_line.push_str(grapheme);
            current_width += grapheme_width;
        }
        index = end;
    }

    if !current_line.is_empty() {
        lines.push(current_line);
    }
    if lines.is_empty() {
        vec![String::new()]
    } else {
        lines
    }
}

/// Wrap one line of text, breaking at word boundaries.
fn wrap_single_line(line: &str, width: usize) -> Vec<String> {
    if line.is_empty() {
        return vec![String::new()];
    }
    if crate::ansi::visible_width(line) <= width {
        return vec![line.to_string()];
    }

    let mut wrapped: Vec<String> = Vec::new();
    let mut tracker = AnsiCodeTracker::default();
    let tokens = split_into_tokens_with_ansi(line);
    let mut current_line = String::new();
    let mut current_visible_length = 0usize;

    for token in &tokens {
        let token_visible_length = crate::ansi::visible_width(token);
        let is_whitespace = token.trim().is_empty();

        if token_visible_length > width && !is_whitespace {
            if !current_line.is_empty() {
                let line_end_reset = tracker.line_end_reset();
                if !line_end_reset.is_empty() {
                    current_line.push_str(&line_end_reset);
                }
                wrapped.push(std::mem::take(&mut current_line));
                current_visible_length = 0;
            }
            let broken = break_long_word(token, width, &mut tracker);
            let last = broken.len().saturating_sub(1);
            for (position, part) in broken.iter().enumerate() {
                if position < last {
                    wrapped.push(part.clone());
                } else {
                    current_line = part.clone();
                    current_visible_length = crate::ansi::visible_width(&current_line);
                }
            }
            continue;
        }

        let total_needed = current_visible_length + token_visible_length;
        if total_needed > width && current_visible_length > 0 {
            let mut line_to_wrap = current_line.trim_end().to_string();
            let line_end_reset = tracker.line_end_reset();
            if !line_end_reset.is_empty() {
                line_to_wrap.push_str(&line_end_reset);
            }
            wrapped.push(line_to_wrap);
            current_line = tracker.active_codes();
            if is_whitespace {
                current_visible_length = 0;
            } else {
                current_line.push_str(token);
                current_visible_length = token_visible_length;
            }
        } else {
            current_line.push_str(token);
            current_visible_length += token_visible_length;
        }
        update_tracker_from_text(token, &mut tracker);
    }

    if !current_line.is_empty() {
        wrapped.push(current_line);
    }

    if wrapped.is_empty() {
        vec![String::new()]
    } else {
        wrapped
            .into_iter()
            .map(|line| line.trim_end().to_string())
            .collect()
    }
}

/// Wrap text to fit within a maximum width, preserving ANSI codes.
///
/// Words are kept whole: a word that does not fit moves to the next line and
/// only a word wider than the row is broken. The active ANSI state carries
/// across the break, so a coloured run stays coloured on the next row.
pub fn wrap_text_with_ansi(s: &str, max_width: usize) -> Vec<String> {
    if s.is_empty() || max_width == 0 {
        return vec![String::new()];
    }

    let normalized = s.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines: Vec<String> = Vec::new();
    let mut tracker = AnsiCodeTracker::default();

    for input_line in normalized.split('\n') {
        let mut combined = if lines.is_empty() {
            String::new()
        } else {
            tracker.active_codes()
        };
        combined.push_str(input_line);
        lines.extend(wrap_single_line(&combined, max_width));
        update_tracker_from_text(input_line, &mut tracker);
    }

    if lines.is_empty() {
        lines.push(String::new());
    }

    lines
}

/// Get the grapheme segmenter for Unicode-aware text handling.
pub fn get_grapheme_segmenter() -> GraphemeSegmenter {
    GraphemeSegmenter
}

/// Grapheme segmenter wrapper.
pub struct GraphemeSegmenter;

impl GraphemeSegmenter {
    /// Segment a string into graphemes.
    pub fn segment<'a>(&'a self, s: &'a str) -> impl Iterator<Item = Grapheme<'a>> + 'a {
        s.graphemes(true).enumerate().map(|(idx, g)| Grapheme {
            segment: g,
            index: idx,
        })
    }
}

/// A grapheme cluster.
#[derive(Debug, Clone)]
pub struct Grapheme<'a> {
    pub segment: &'a str,
    pub index: usize,
}

/// Check if a character is whitespace.
pub fn is_whitespace_char(c: char) -> bool {
    c.is_whitespace() || c == '\t' || c == '\n' || c == '\r'
}

/// Get an OSC 8 hyperlink at a specific column position.
pub fn get_osc8_link_at_column(s: &str, column: usize) -> Option<String> {
    let mut col = 0;
    let mut in_escape = false;
    let mut in_osc8 = false;
    let mut osc8_link = String::new();
    let mut chars = s.chars().peekable();

    while let Some(c) = chars.next() {
        if in_escape {
            if c == ']' {
                // OSC start - check for OSC 8
                let mut osc_content = String::new();
                while let Some(&next) = chars.peek() {
                    chars.next();
                    if next == '\x07' {
                        break;
                    } else if next == '\x1b' && chars.peek() == Some(&'\\') {
                        chars.next();
                        break;
                    }
                    osc_content.push(next);
                }
                // OSC 8 format: 8;params;uri
                if osc_content.starts_with("8;") {
                    in_osc8 = true;
                    if let Some(uri_start) = osc_content[2..].find(';').map(|index| index + 3) {
                        if uri_start < osc_content.len() {
                            osc8_link = osc_content[uri_start..].to_string();
                        }
                    }
                }
                in_escape = false;
                continue;
            } else if c >= '@' && c <= '~' && c != '[' {
                in_escape = false;
            }
            continue;
        }

        if c == '\x1b' {
            in_escape = true;
            continue;
        }

        if c < ' ' || c == '\x7f' {
            continue;
        }

        if col == column && in_osc8 && !osc8_link.is_empty() {
            return Some(osc8_link);
        }

        col += UnicodeWidthStr::width(c.to_string().as_str());
    }

    None
}

/// Apply background color to a line, respecting existing styling.
pub fn apply_background_to_line(
    line: &str,
    width: usize,
    bg_fn: impl Fn(&str) -> String,
) -> String {
    let line_width = visible_width(line);
    let padding = " ".repeat(width.saturating_sub(line_width));
    let padded = format!("{}{}", line, padding);
    bg_fn(&padded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_visible_width() {
        assert_eq!(visible_width("Hello"), 5);
        assert_eq!(visible_width("\x1b[31mHello\x1b[0m"), 5);
        assert_eq!(visible_width("你好"), 4); // Chinese characters are wide
    }

    #[test]
    fn test_truncate_to_width() {
        assert_eq!(truncate_to_width("Hello World", 5, ""), "Hello");
        assert_eq!(truncate_to_width("Hello World", 8, "..."), "Hello...");
    }

    #[test]
    fn test_strip_ansi() {
        assert_eq!(strip_ansi("\x1b[31mHello\x1b[0m"), "Hello");
        assert_eq!(strip_ansi("\x1b[1;31mWorld\x1b[0m"), "World");
    }

    #[test]
    fn test_wrap_text() {
        let lines = wrap_text_with_ansi("Hello World", 5);
        assert_eq!(lines, vec!["Hello", "World"]);
    }

    #[test]
    fn the_wrap_breaks_at_word_boundaries() {
        assert_eq!(
            wrap_text_with_ansi("The quick brown fox jumps over the lazy dog", 12),
            vec!["The quick", "brown fox", "jumps over", "the lazy dog"]
        );
    }

    #[test]
    fn a_word_longer_than_the_row_is_broken() {
        assert_eq!(
            wrap_text_with_ansi("supercalifragilistic", 5),
            vec!["super", "calif", "ragil", "istic"]
        );
    }

    #[test]
    fn a_cjk_run_breaks_between_characters() {
        assert_eq!(
            wrap_text_with_ansi("你好世界你好世界", 4),
            vec!["你好", "世界", "你好", "世界"]
        );
        assert_eq!(wrap_text_with_ansi("a 你好 b", 4), vec!["a 你", "好 b"]);
    }

    #[test]
    fn trailing_whitespace_never_starts_a_line() {
        assert_eq!(
            wrap_text_with_ansi("one   two three", 5),
            vec!["one", "two", "three"]
        );
    }

    #[test]
    fn the_ansi_state_carries_across_the_wrap() {
        let lines = wrap_text_with_ansi("\x1b[31mred text here\x1b[0m", 6);
        assert_eq!(lines.len(), 3);
        assert!(lines[0].starts_with("\x1b[31mred"));
        assert!(lines[1].starts_with("\x1b[31mtext"));
        assert!(lines[2].starts_with("\x1b[31mhere"));
        for line in &lines {
            assert!(crate::ansi::visible_width(line) <= 6);
        }
    }

    #[test]
    fn the_underline_starts_on_the_row_that_carries_the_styled_text() {
        let underline_on = "\x1b[4m";
        let underline_off = "\x1b[24m";
        let url = "https://example.com/very/long/path/that/will/wrap";
        let text = format!("read this thread {underline_on}{url}{underline_off}");
        let wrapped = wrap_text_with_ansi(&text, 40);
        assert_eq!(wrapped[0], "read this thread");
        assert!(wrapped[1].starts_with(underline_on), "{wrapped:?}");
        assert!(wrapped[1].contains("https://"), "{wrapped:?}");
    }

    #[test]
    fn the_underline_reset_does_not_follow_a_space() {
        let underline_on = "\x1b[4m";
        let underline_off = "\x1b[24m";
        let text = format!("{underline_on}underlined text here {underline_off}more");
        let wrapped = wrap_text_with_ansi(&text, 18);
        assert!(!wrapped[0].contains(&format!(" {underline_off}")), "{wrapped:?}");
    }

    #[test]
    fn an_underlined_row_ends_with_the_underline_reset_and_not_a_full_reset() {
        let underline_on = "\x1b[4m";
        let underline_off = "\x1b[24m";
        let url = "https://example.com/very/long/path/that/will/definitely/wrap";
        let text = format!("prefix {underline_on}{url}{underline_off} suffix");
        let wrapped = wrap_text_with_ansi(&text, 30);
        for line in wrapped.iter().skip(1).take(wrapped.len().saturating_sub(2)) {
            if line.contains(underline_on) {
                assert!(line.ends_with(underline_off), "{wrapped:?}");
                assert!(!line.ends_with("\x1b[0m"), "{wrapped:?}");
            }
        }
    }

    #[test]
    fn a_background_colour_survives_the_wrap_without_a_full_reset() {
        let background = "\x1b[44m";
        let text = format!("{background}hello world this is blue background text\x1b[0m");
        let wrapped = wrap_text_with_ansi(&text, 15);
        for line in &wrapped {
            assert!(line.contains(background), "{wrapped:?}");
        }
        for line in wrapped.iter().take(wrapped.len().saturating_sub(1)) {
            assert!(!line.ends_with("\x1b[0m"), "{wrapped:?}");
        }
    }

    #[test]
    fn a_underline_inside_a_background_resets_only_the_underline() {
        let underline_on = "\x1b[4m";
        let underline_off = "\x1b[24m";
        let text = format!(
            "\x1b[41mprefix {underline_on}UNDERLINED_CONTENT_THAT_WRAPS{underline_off} suffix\x1b[0m"
        );
        let wrapped = wrap_text_with_ansi(&text, 20);
        for line in &wrapped {
            let has_background =
                line.contains("[41m") || line.contains(";41m") || line.contains("[41;");
            assert!(has_background, "{wrapped:?}");
        }
        for line in wrapped.iter().take(wrapped.len().saturating_sub(1)) {
            let underlined =
                line.contains("[4m") || line.contains("[4;") || line.contains(";4m");
            if underlined && !line.contains(underline_off) {
                assert!(line.ends_with(underline_off), "{wrapped:?}");
                assert!(!line.ends_with("\x1b[0m"), "{wrapped:?}");
            }
        }
    }

    #[test]
    fn a_plain_text_row_never_exceeds_the_width() {
        for line in wrap_text_with_ansi("hello world this is a test", 10) {
            assert!(crate::ansi::visible_width(&line) <= 10, "{line:?}");
        }
    }

    #[test]
    fn the_line_endings_are_all_a_break() {
        assert_eq!(
            wrap_text_with_ansi("first\nsecond\r\nthird\rfourth", 80),
            vec!["first", "second", "third", "fourth"]
        );
    }

    #[test]
    fn the_ansi_state_survives_every_line_ending() {
        assert_eq!(
            wrap_text_with_ansi("\x1b[31mfirst\r\nsecond\rthird\x1b[0m", 80),
            vec!["\x1b[31mfirst", "\x1b[31msecond", "\x1b[31mthird\x1b[0m"]
        );
    }

    #[test]
    fn a_cjk_run_breaks_after_latin_text() {
        assert_eq!(
            wrap_text_with_ansi(
                "This is an example 中文汉字测试段落内容中文汉字测试段落内容.",
                40
            ),
            vec![
                "This is an example 中文汉字测试段落内容",
                "中文汉字测试段落内容."
            ]
        );
    }

    #[test]
    fn an_emoji_cluster_measures_two_columns() {
        assert_eq!(visible_width("👨‍👩‍👧"), 2);
        assert_eq!(visible_width("👍🏽"), 2);
        assert_eq!(visible_width("❤️"), 2);
        assert_eq!(visible_width("\x1b[31m👨‍👩‍👧\x1b[0m"), 2);
        assert_eq!(visible_width("\x1b[31m👍🏽\x1b[0m"), 2);
        assert_eq!(visible_width("\x1b[31m❤️\x1b[0m"), 2);
    }

    #[test]
    fn a_truncation_never_cuts_an_emoji_cluster() {
        assert_eq!(truncate_to_width("👨‍👩‍👧x", 2, ""), "👨‍👩‍👧");
        assert_eq!(truncate_to_width("a👨‍👩‍👧", 2, ""), "a");
        assert_eq!(truncate_to_width("👍🏽👍🏽", 3, ""), "👍🏽");
        assert_eq!(truncate_to_width("👨‍👩‍👧", 2, "…"), "👨‍👩‍👧");
    }

    #[test]
    fn a_slice_never_cuts_an_emoji_cluster() {
        assert_eq!(slice_by_column("a👨‍👩‍👧b", 1, 2, false), "👨‍👩‍👧");
        assert_eq!(slice_by_column("a👨‍👩‍👧b", 0, 1, false), "a");
        assert_eq!(slice_by_column("a👍🏽b", 1, 2, false), "👍🏽");
    }
}
