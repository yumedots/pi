//! Word navigation utilities for text editing.
//!
//! Provides functions for finding word boundaries in text.

use unicode_segmentation::UnicodeSegmentation;

/// Characters that are considered word boundaries.
const WORD_BOUNDARY_CHARS: &[char] = &[
    ' ', '\t', '\n', '\r', '-', '_', '.', '/', ':', '\\', '(', ')', '[', ']', '{', '}', '<', '>',
    '=', '+', '*', '&', '|', '!', '@', '#', '$', '%', '^', '~', '`', ',', ';', '"', '\'',
];

/// Check if a character is a word boundary.
pub fn is_word_boundary(c: char) -> bool {
    WORD_BOUNDARY_CHARS.contains(&c)
}

/// Check if a character is a word character.
pub fn is_word_char(c: char) -> bool {
    !is_word_boundary(c)
}

/// The kinds of segment a text is split into, the way the original's
/// `Intl.Segmenter` splits it at word granularity.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum SegmentKind {
    /// A word-like run.
    Word,
    /// A run of whitespace.
    Whitespace,
    /// A run of punctuation.
    Punctuation,
    /// An atomic segment (a folded-paste marker), the original's
    /// `isAtomicSegment`.
    Atomic,
}

/// One segment of a text.
#[derive(Clone, Copy)]
struct Segment {
    kind: SegmentKind,
    /// The byte offset of the segment in the text.
    start: usize,
    /// The length of the segment in bytes.
    len: usize,
}

/// Split a text into word-like, whitespace and punctuation segments.
///
/// The word segmentation attaches a space to one of its neighbours; the
/// original's segmenter keeps the whitespace on its own, and so does this.
fn segments(text: &str) -> Vec<Segment> {
    let mut result: Vec<Segment> = Vec::new();
    for (index, word) in text.split_word_bound_indices() {
        if word.chars().all(char::is_whitespace) {
            result.push(Segment {
                kind: SegmentKind::Whitespace,
                start: index,
                len: word.len(),
            });
            continue;
        }
        let leading = word.len() - word.trim_start().len();
        let trailing = word.len() - word.trim_end().len();
        if leading > 0 {
            result.push(Segment {
                kind: SegmentKind::Whitespace,
                start: index,
                len: leading,
            });
        }
        let core = &word[leading..word.len() - trailing];
        if !core.is_empty() {
            result.push(Segment {
                kind: classify(core),
                start: index + leading,
                len: core.len(),
            });
        }
        if trailing > 0 {
            result.push(Segment {
                kind: SegmentKind::Whitespace,
                start: index + word.len() - trailing,
                len: trailing,
            });
        }
    }
    result
}

/// Split a text into segments, keeping the atomic ranges (the folded-paste
/// markers) whole.
///
/// The original segments the text with `Intl.Segmenter` and merges the
/// markers into single segments
/// (packages/tui/src/components/editor.ts:50-113), so a marker is one unit
/// for the word navigation.
fn segments_with_atomic(text: &str, atomic: &[(usize, usize)]) -> Vec<Segment> {
    if atomic.is_empty() {
        return segments(text);
    }
    let mut result: Vec<Segment> = Vec::new();
    let mut cursor = 0usize;
    for &(start, end) in atomic {
        if start < cursor || start >= text.len() {
            continue;
        }
        let end = end.min(text.len());
        for segment in segments(&text[cursor..start]) {
            result.push(Segment {
                kind: segment.kind,
                start: segment.start + cursor,
                len: segment.len,
            });
        }
        result.push(Segment {
            kind: SegmentKind::Atomic,
            start,
            len: end - start,
        });
        cursor = end;
    }
    for segment in segments(&text[cursor..]) {
        result.push(Segment {
            kind: segment.kind,
            start: segment.start + cursor,
            len: segment.len,
        });
    }
    result
}

/// Classify a segment: the original's `Intl.Segmenter` marks a segment
/// word-like when it carries letters or numbers.
fn classify(segment: &str) -> SegmentKind {
    if segment.chars().all(char::is_whitespace) {
        SegmentKind::Whitespace
    } else if segment.chars().any(char::is_alphanumeric) {
        SegmentKind::Word
    } else {
        SegmentKind::Punctuation
    }
}

/// The end (a byte offset in the segment) of the last ASCII punctuation char.
fn last_punctuation_end(segment: &str) -> Option<usize> {
    let mut end = None;
    for (index, c) in segment.char_indices() {
        if is_punctuation(c) {
            end = Some(index + c.len_utf8());
        }
    }
    end
}

/// The start (a byte offset in the segment) of the first ASCII punctuation char.
fn first_punctuation_start(segment: &str) -> Option<usize> {
    segment
        .char_indices()
        .find(|(_, c)| is_punctuation(*c))
        .map(|(index, _)| index)
}

/// An ASCII punctuation char, the original's `PUNCTUATION_REGEX`
/// (packages/tui/src/utils.ts:1006).
fn is_punctuation(c: char) -> bool {
    WORD_BOUNDARY_CHARS.contains(&c) && !c.is_whitespace()
}

/// Find the position before the previous word, in bytes.
///
/// The original's `findWordBackward` (packages/tui/src/word-navigation.ts:40-79):
/// skip the trailing whitespace, then stop at the word or the punctuation
/// boundary.
pub fn find_word_backward(text: &str, position: usize) -> usize {
    find_word_backward_marked(text, position, &[])
}

/// Find the position before the previous word, in bytes, treating the atomic
/// ranges (the folded-paste markers) as one segment each.
pub fn find_word_backward_marked(text: &str, position: usize, atomic: &[(usize, usize)]) -> usize {
    if position == 0 {
        return 0;
    }
    let before = &text[..position];
    let mut segments = segments_with_atomic(before, atomic);
    let mut cursor = position;

    while let Some(last) = segments.last() {
        if last.kind != SegmentKind::Whitespace {
            break;
        }
        cursor -= last.len;
        segments.pop();
    }

    let Some(last) = segments.last().copied() else {
        return cursor;
    };
    match last.kind {
        SegmentKind::Atomic => {
            cursor -= last.len;
        }
        SegmentKind::Word => {
            // Inside a word-like segment the ASCII punctuation still counts as
            // a boundary: stop right after its last punctuation.
            let segment = &before[last.start..last.start + last.len];
            match last_punctuation_end(segment) {
                Some(end) => cursor -= last.len - end,
                None => cursor -= last.len,
            }
        }
        SegmentKind::Punctuation => {
            // Skip the whole punctuation run.
            while let Some(last) = segments.last() {
                if last.kind != SegmentKind::Punctuation {
                    break;
                }
                cursor -= last.len;
                segments.pop();
            }
        }
        SegmentKind::Whitespace => {}
    }

    cursor
}

/// Find the position after the current word, in bytes.
///
/// The original's `findWordForward` (packages/tui/src/word-navigation.ts:84-118):
/// skip the leading whitespace, then stop at the end of the word — or at its
/// first ASCII punctuation.
pub fn find_word_forward(text: &str, position: usize) -> usize {
    find_word_forward_marked(text, position, &[])
}

/// Find the position after the current word, in bytes, treating the atomic
/// ranges (the folded-paste markers) as one segment each.
pub fn find_word_forward_marked(text: &str, position: usize, atomic: &[(usize, usize)]) -> usize {
    if position >= text.len() {
        return text.len();
    }
    let after = &text[position..];
    let shifted: Vec<(usize, usize)> = atomic
        .iter()
        .filter(|(start, end)| *start >= position && *end <= text.len())
        .map(|(start, end)| (start - position, end - position))
        .collect();
    let mut segments = segments_with_atomic(after, &shifted);
    let mut cursor = position;

    while let Some(first) = segments.first() {
        if first.kind != SegmentKind::Whitespace {
            break;
        }
        cursor += first.len;
        segments.remove(0);
    }

    let Some(first) = segments.first().copied() else {
        return cursor;
    };
    match first.kind {
        SegmentKind::Atomic => {
            cursor += first.len;
        }
        SegmentKind::Word => {
            let segment = &after[first.start..first.start + first.len];
            match first_punctuation_start(segment) {
                Some(index) => cursor += index,
                None => cursor += first.len,
            }
        }
        SegmentKind::Punctuation => {
            // Skip the whole punctuation run.
            while let Some(first) = segments.first() {
                if first.kind != SegmentKind::Punctuation {
                    break;
                }
                cursor += first.len;
                segments.remove(0);
            }
        }
        SegmentKind::Whitespace => {}
    }

    cursor
}

/// Find the end of the current word from the given position, in bytes.
/// Returns the byte offset just after the last character of the word.
pub fn find_word_end(text: &str, position: usize) -> usize {
    let mut cursor = position;
    while cursor < text.len() {
        let c = text[cursor..].chars().next().unwrap_or(' ');
        if !(c.is_whitespace() || is_word_boundary(c)) {
            break;
        }
        cursor += c.len_utf8();
    }
    while cursor < text.len() {
        let c = text[cursor..].chars().next().unwrap_or(' ');
        if is_word_boundary(c) {
            break;
        }
        cursor += c.len_utf8();
    }
    cursor
}

/// Find the end of the previous word.
/// Returns the index just after the last character of the previous word.
pub fn find_prev_word_end(text: &str, position: usize) -> usize {
    if position == 0 {
        return 0;
    }

    let chars: Vec<char> = text.chars().collect();
    let mut index = position.saturating_sub(1);

    // Skip any whitespace or boundary characters going backward
    while index > 0 && (chars[index].is_whitespace() || is_word_boundary(chars[index])) {
        index -= 1;
    }

    // Now we're at the end of a word, find its start
    let end = index + 1;
    while index > 0 && is_word_char(chars[index.saturating_sub(1)]) {
        index -= 1;
    }

    end
}

/// Find the start of the current line (for multi-line text).
pub fn find_line_start(text: &str, position: usize) -> usize {
    if position == 0 {
        return 0;
    }

    // Work with byte positions, converting as needed
    let byte_pos = text
        .char_indices()
        .nth(position)
        .map(|(i, _)| i)
        .unwrap_or(text.len());

    // Find the previous newline
    text[..byte_pos]
        .rfind('\n')
        .map(|i| {
            // Convert byte position to char position
            text[..i].chars().count() + 1
        })
        .unwrap_or(0)
}

/// Find the end of the current line (for multi-line text).
/// Returns the position of the newline or end of text.
pub fn find_line_end(text: &str, position: usize) -> usize {
    let chars: Vec<char> = text.chars().collect();
    let mut index = position;

    while index < chars.len() && chars[index] != '\n' {
        index += 1;
    }

    index
}

/// Get the current word at the given position.
/// Returns (start, end) indices of the word.
pub fn get_current_word_range(text: &str, position: usize) -> (usize, usize) {
    let chars: Vec<char> = text.chars().collect();

    if position >= chars.len() {
        return (position, position);
    }

    // If we're on a boundary character, return just that character
    if is_word_boundary(chars[position]) {
        return (position, position + 1);
    }

    // Find word start
    let mut start = position;
    while start > 0 && is_word_char(chars[start.saturating_sub(1)]) {
        start -= 1;
    }

    // Find word end
    let mut end = position;
    while end < chars.len() && is_word_char(chars[end]) {
        end += 1;
    }

    (start, end)
}

/// Check if we're at the start of a word.
pub fn is_at_word_start(text: &str, position: usize) -> bool {
    if position == 0 {
        return true;
    }

    let chars: Vec<char> = text.chars().collect();
    if position >= chars.len() {
        return false;
    }

    // Either previous char is a boundary or we're at position 0
    is_word_char(chars[position]) && is_word_boundary(chars[position - 1])
}

/// Check if we're at the end of a word.
pub fn is_at_word_end(text: &str, position: usize) -> bool {
    if position == 0 {
        return false;
    }

    let chars: Vec<char> = text.chars().collect();
    if position > chars.len() {
        return false;
    }

    // Current position is after a word char and next is a boundary or end
    let prev_is_word = is_word_char(chars[position - 1]);
    let next_is_boundary = position >= chars.len() || is_word_boundary(chars[position]);

    prev_is_word && next_is_boundary
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_word_backward() {
        // The original's values (packages/tui/src/word-navigation.ts:40-79).
        let text = "hello world";
        assert_eq!(find_word_backward(text, 11), 6); // Before "world"
        assert_eq!(find_word_backward(text, 6), 0); // Before "hello"
        assert_eq!(find_word_backward(text, 0), 0); // At start
        assert_eq!(find_word_backward("foo.bar", 4), 3); // Before the dot
        assert_eq!(find_word_backward("a-b", 3), 2); // Before the dash
    }

    #[test]
    fn test_find_word_forward() {
        // The original's values (packages/tui/src/word-navigation.ts:84-118).
        let text = "hello world";
        assert_eq!(find_word_forward(text, 0), 5); // The end of "hello"
        assert_eq!(find_word_forward(text, 5), 11); // The end of "world"
        assert_eq!(find_word_forward(text, 11), 11); // At end
        assert_eq!(find_word_forward("foo.bar", 0), 3); // Before the dot
    }

    #[test]
    fn test_find_word_end() {
        let text = "hello world";
        assert_eq!(find_word_end(text, 0), 5); // End of "hello"
        assert_eq!(find_word_end(text, 6), 11); // End of "world"
    }

    #[test]
    fn test_word_boundaries() {
        assert!(is_word_boundary(' '));
        assert!(is_word_boundary('.'));
        assert!(is_word_boundary('/'));
        assert!(!is_word_boundary('a'));
        assert!(!is_word_boundary('1'));
    }

    #[test]
    fn test_get_current_word_range() {
        let text = "hello world";
        assert_eq!(get_current_word_range(text, 0), (0, 5));
        assert_eq!(get_current_word_range(text, 2), (0, 5));
        assert_eq!(get_current_word_range(text, 6), (6, 11));
        assert_eq!(get_current_word_range(text, 8), (6, 11));
    }

    #[test]
    fn test_special_characters() {
        // The original's values (packages/tui/src/word-navigation.ts:84-118).
        let text = "hello.world";
        assert_eq!(find_word_forward(text, 0), 5); // The end of "hello"
        assert_eq!(find_word_forward(text, 5), 6); // Before the dot
    }

    #[test]
    fn test_find_line_start() {
        let text = "hello\nworld";
        assert_eq!(find_line_start(text, 0), 0);
        assert_eq!(find_line_start(text, 6), 6); // Start of "world"
        assert_eq!(find_line_start(text, 8), 6); // Still start of "world"
    }

    #[test]
    fn test_find_line_end() {
        let text = "hello\nworld";
        assert_eq!(find_line_end(text, 0), 5); // End of "hello" (before \n)
        assert_eq!(find_line_end(text, 6), 11); // End of "world"
    }
}
