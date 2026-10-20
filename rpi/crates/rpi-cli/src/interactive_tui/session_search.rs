//! Session search query language.
//!
//! Port of upstream `packages/coding-agent/src/modes/interactive/components/session-selector-search.ts`.
//!
//! A query is either a regex (`re:<pattern>`) or a list of tokens. Tokens are
//! fuzzy by default; a token wrapped in double quotes is a phrase that must
//! appear verbatim (case-insensitively, whitespace-normalised) in the session
//! text. Every token must match for the session to match; the score is the sum
//! of the per-token scores (lower is better).

use rpi_tui::fuzzy::fuzzy_match;

// ===========================================================================
// Query model
// ===========================================================================

/// How the session picker orders its rows (upstream's `SortMode`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SortMode {
    /// Upstream's default: tree-ordered rows (scored order while searching).
    Threaded,
    /// Newest first (upstream's `recent`).
    Recent,
    /// Best score first (upstream's `relevance`).
    Relevance,
}

/// Which sessions the picker shows (upstream's `NameFilter`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NameFilter {
    /// Every session.
    All,
    /// Only sessions that carry a name.
    Named,
}

/// How a single token is matched (upstream's token `kind`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TokenKind {
    /// Subsequence match, scored by the TUI fuzzy matcher.
    Fuzzy,
    /// Verbatim substring match.
    Phrase,
}

/// One token of a parsed query.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SearchToken {
    /// How the token is matched.
    pub kind: TokenKind,
    /// The token text.
    pub value: String,
}

/// Whether a query is matched as a regex or as tokens (upstream's `mode`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum QueryMode {
    /// Token mode.
    Tokens,
    /// Regex mode (`re:<pattern>`).
    Regex,
}

/// A parsed search query (upstream's `ParsedSearchQuery`).
#[derive(Clone, Debug)]
pub(crate) struct ParsedSearchQuery {
    /// Whether the query is a regex or a token list.
    pub mode: QueryMode,
    /// The tokens of a token-mode query.
    pub tokens: Vec<SearchToken>,
    /// The compiled pattern of a regex-mode query.
    pub regex: Option<Regex>,
    /// Set when parsing failed; the query then matches nothing.
    pub error: Option<String>,
}

/// The outcome of matching a session against a parsed query.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct MatchResult {
    /// Whether the session matches.
    pub matches: bool,
    /// Match score; lower is better (only meaningful when `matches`).
    pub score: f64,
}

/// A session row the picker can search.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SessionCandidate {
    /// The session id.
    pub id: String,
    /// The session name, when it has one.
    pub name: Option<String>,
    /// Every message of the session, flattened into text.
    pub all_messages_text: String,
    /// The session's working directory.
    pub cwd: String,
    /// The session's last modification time (epoch milliseconds).
    pub modified_ms: i64,
}

impl SessionCandidate {
    /// The text a query is matched against (upstream's `getSessionSearchText`).
    pub(crate) fn search_text(&self) -> String {
        format!(
            "{} {} {} {}",
            self.id,
            self.name.as_deref().unwrap_or(""),
            self.all_messages_text,
            self.cwd
        )
    }

    /// Whether the session carries a name (upstream's `hasSessionName`).
    pub(crate) fn has_name(&self) -> bool {
        self.name.as_ref().is_some_and(|n| !n.trim().is_empty())
    }
}

// ===========================================================================
// Query parsing
// ===========================================================================

/// Lowercase the text and collapse every whitespace run into a single space.
fn normalize_whitespace_lower(text: &str) -> String {
    text.to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Push the buffered token, if it is not blank.
fn flush_token(tokens: &mut Vec<SearchToken>, buf: &mut String, kind: TokenKind) {
    let value = buf.trim().to_string();
    buf.clear();
    if value.is_empty() {
        return;
    }
    tokens.push(SearchToken { kind, value });
}

/// Split a query into tokens, honouring `"…"` quoting.
fn tokenize(query: &str) -> (Vec<SearchToken>, bool) {
    let mut tokens: Vec<SearchToken> = Vec::new();
    let mut buf = String::new();
    let mut in_quote = false;

    for ch in query.chars() {
        if ch == '"' {
            if in_quote {
                flush_token(&mut tokens, &mut buf, TokenKind::Phrase);
                in_quote = false;
            } else {
                flush_token(&mut tokens, &mut buf, TokenKind::Fuzzy);
                in_quote = true;
            }
            continue;
        }
        if !in_quote && ch.is_whitespace() {
            flush_token(&mut tokens, &mut buf, TokenKind::Fuzzy);
            continue;
        }
        buf.push(ch);
    }

    if in_quote {
        return (tokens, true);
    }

    flush_token(&mut tokens, &mut buf, TokenKind::Fuzzy);
    (tokens, false)
}

/// Parse a search query into regex or token mode (upstream's `parseSearchQuery`).
pub(crate) fn parse_search_query(query: &str) -> ParsedSearchQuery {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return ParsedSearchQuery {
            mode: QueryMode::Tokens,
            tokens: Vec::new(),
            regex: None,
            error: None,
        };
    }

    if let Some(rest) = trimmed.strip_prefix("re:") {
        let pattern = rest.trim();
        if pattern.is_empty() {
            return ParsedSearchQuery {
                mode: QueryMode::Regex,
                tokens: Vec::new(),
                regex: None,
                error: Some("Empty regex".to_string()),
            };
        }
        return match Regex::new(pattern) {
            Ok(regex) => ParsedSearchQuery {
                mode: QueryMode::Regex,
                tokens: Vec::new(),
                regex: Some(regex),
                error: None,
            },
            Err(message) => ParsedSearchQuery {
                mode: QueryMode::Regex,
                tokens: Vec::new(),
                regex: None,
                error: Some(message),
            },
        };
    }

    let (mut tokens, unclosed_quote) = tokenize(trimmed);
    if unclosed_quote {
        tokens = trimmed
            .split_whitespace()
            .map(|value| SearchToken {
                kind: TokenKind::Fuzzy,
                value: value.to_string(),
            })
            .collect();
    }

    ParsedSearchQuery {
        mode: QueryMode::Tokens,
        tokens,
        regex: None,
        error: None,
    }
}

// ===========================================================================
// Matching
// ===========================================================================

/// The character index of `needle` inside `haystack`.
fn char_index_of(haystack: &str, needle: &str) -> Option<usize> {
    let byte_index = haystack.find(needle)?;
    Some(haystack[..byte_index].chars().count())
}

/// Match a session's search text against a parsed query.
pub(crate) fn match_session_text(text: &str, parsed: &ParsedSearchQuery) -> MatchResult {
    match parsed.mode {
        QueryMode::Regex => {
            let Some(regex) = parsed.regex.as_ref() else {
                return MatchResult {
                    matches: false,
                    score: 0.0,
                };
            };
            match regex.search(text) {
                Some(index) => MatchResult {
                    matches: true,
                    score: index as f64 * 0.1,
                },
                None => MatchResult {
                    matches: false,
                    score: 0.0,
                },
            }
        }
        QueryMode::Tokens => {
            if parsed.tokens.is_empty() {
                return MatchResult {
                    matches: true,
                    score: 0.0,
                };
            }

            let mut total_score = 0.0f64;
            let mut normalized_text: Option<String> = None;

            for token in &parsed.tokens {
                if token.kind == TokenKind::Phrase {
                    let text =
                        normalized_text.get_or_insert_with(|| normalize_whitespace_lower(text));
                    let phrase = normalize_whitespace_lower(&token.value);
                    if phrase.is_empty() {
                        continue;
                    }
                    match char_index_of(text, &phrase) {
                        Some(index) => total_score += index as f64 * 0.1,
                        None => {
                            return MatchResult {
                                matches: false,
                                score: 0.0,
                            }
                        }
                    }
                    continue;
                }

                let matched = fuzzy_match(&token.value, text);
                if !matched.matches {
                    return MatchResult {
                        matches: false,
                        score: 0.0,
                    };
                }
                total_score += matched.score as f64;
            }

            MatchResult {
                matches: true,
                score: total_score,
            }
        }
    }
}

// ===========================================================================
// Filtering and sorting
// ===========================================================================

/// Whether a session passes the name filter.
fn matches_name_filter(session: &SessionCandidate, filter: NameFilter) -> bool {
    match filter {
        NameFilter::All => true,
        NameFilter::Named => session.has_name(),
    }
}

/// Filter sessions by the query and order them by the sort mode.
///
/// An empty query only applies the name filter. `Recent` keeps the incoming
/// order, `Threaded` and `Relevance` order by ascending score with the newer
/// session first on a tie (upstream's `filterAndSortSessions`).
pub(crate) fn filter_and_sort(
    sessions: &[SessionCandidate],
    query: &str,
    sort_mode: SortMode,
    name_filter: NameFilter,
) -> Vec<SessionCandidate> {
    let name_filtered: Vec<&SessionCandidate> = sessions
        .iter()
        .filter(|session| matches_name_filter(session, name_filter))
        .collect();

    if query.trim().is_empty() {
        return name_filtered.into_iter().cloned().collect();
    }

    let parsed = parse_search_query(query);
    if parsed.error.is_some() {
        return Vec::new();
    }

    if sort_mode == SortMode::Recent {
        return name_filtered
            .into_iter()
            .filter(|session| match_session_text(&session.search_text(), &parsed).matches)
            .cloned()
            .collect();
    }

    let mut scored: Vec<(&SessionCandidate, f64)> = name_filtered
        .into_iter()
        .filter_map(|session| {
            let result = match_session_text(&session.search_text(), &parsed);
            if result.matches {
                Some((session, result.score))
            } else {
                None
            }
        })
        .collect();

    scored.sort_by(|a, b| {
        a.1.partial_cmp(&b.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.0.modified_ms.cmp(&a.0.modified_ms))
    });

    scored
        .into_iter()
        .map(|(session, _)| session.clone())
        .collect()
}

// ===========================================================================
// Regex subset
// ===========================================================================

/// One member of a character class.
#[derive(Clone, Debug, PartialEq, Eq)]
enum ClassItem {
    /// A single character.
    Char(char),
    /// An inclusive character range.
    Range(char, char),
    /// The complement of another member set (`\D`, `\W`, `\S`).
    Not(Vec<ClassItem>),
}

/// A node of the parsed regex tree.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Node {
    /// Matches the empty string.
    Empty,
    /// Matches one literal character.
    Literal(char),
    /// Matches any character.
    Any,
    /// Matches one character of a class.
    Class {
        /// Whether the class is negated (`[^…]`).
        negated: bool,
        /// The class members.
        items: Vec<ClassItem>,
    },
    /// Matches the start of the text.
    Start,
    /// Matches the end of the text.
    End,
    /// Matches every node in order.
    Concat(Vec<Node>),
    /// Matches one of the alternatives.
    Alt(Vec<Node>),
    /// Matches the inner node repeatedly.
    Repeat {
        /// The repeated node.
        node: Box<Node>,
        /// The minimum number of repetitions.
        min: u32,
        /// The maximum number of repetitions, if bounded.
        max: Option<u32>,
        /// Whether the repetition prefers more repetitions.
        greedy: bool,
    },
}

/// Compare two characters case-insensitively.
fn chars_eq_ci(a: char, b: char) -> bool {
    a == b || a.to_lowercase().eq(b.to_lowercase())
}

/// Whether a character falls into an inclusive range, case-insensitively.
fn in_range_ci(start: char, end: char, c: char) -> bool {
    if c >= start && c <= end {
        return true;
    }
    let lower = c.to_lowercase().next().unwrap_or(c);
    let upper = c.to_uppercase().next().unwrap_or(c);
    (lower >= start && lower <= end) || (upper >= start && upper <= end)
}

/// Whether a character is a member of a set of class members.
fn items_match(items: &[ClassItem], c: char) -> bool {
    items.iter().any(|item| match item {
        ClassItem::Char(expected) => chars_eq_ci(*expected, c),
        ClassItem::Range(start, end) => in_range_ci(*start, *end, c),
        ClassItem::Not(inner) => !items_match(inner, c),
    })
}

/// Whether a character is a member of a character class.
fn class_matches(items: &[ClassItem], negated: bool, c: char) -> bool {
    let hit = items_match(items, c);
    if negated {
        !hit
    } else {
        hit
    }
}

/// Every end position the node can reach from `pos`, best first.
fn match_all(node: &Node, text: &[char], pos: usize) -> Vec<usize> {
    match node {
        Node::Empty => vec![pos],
        Node::Literal(expected) => match text.get(pos) {
            Some(actual) if chars_eq_ci(*actual, *expected) => vec![pos + 1],
            _ => Vec::new(),
        },
        Node::Any => {
            if pos < text.len() {
                vec![pos + 1]
            } else {
                Vec::new()
            }
        }
        Node::Class { negated, items } => match text.get(pos) {
            Some(actual) if class_matches(items, *negated, *actual) => vec![pos + 1],
            _ => Vec::new(),
        },
        Node::Start => {
            if pos == 0 {
                vec![pos]
            } else {
                Vec::new()
            }
        }
        Node::End => {
            if pos == text.len() {
                vec![pos]
            } else {
                Vec::new()
            }
        }
        Node::Concat(nodes) => {
            let mut positions = vec![pos];
            for node in nodes {
                let mut next = Vec::new();
                for current in positions {
                    for end in match_all(node, text, current) {
                        next.push(end);
                    }
                }
                positions = next;
                if positions.is_empty() {
                    break;
                }
            }
            positions
        }
        Node::Alt(alternatives) => {
            let mut ends = Vec::new();
            for alternative in alternatives {
                for end in match_all(alternative, text, pos) {
                    ends.push(end);
                }
            }
            ends
        }
        Node::Repeat {
            node,
            min,
            max,
            greedy,
        } => repeat_positions(node, text, pos, *min, *max, *greedy),
    }
}

/// The end positions reachable by repeating `node` at least `min` times.
fn repeat_positions(
    node: &Node,
    text: &[char],
    pos: usize,
    min: u32,
    max: Option<u32>,
    greedy: bool,
) -> Vec<usize> {
    let max = max.unwrap_or(u32::MAX);
    let cap = text.len() as u32 + 2;

    let mut levels: Vec<Vec<usize>> = vec![vec![pos]];
    let mut count: u32 = 0;
    while count < max && count < cap {
        let previous = levels.last().cloned().unwrap_or_default();
        let mut next = Vec::new();
        for current in previous {
            for end in match_all(node, text, current) {
                if end != current {
                    next.push(end);
                }
            }
        }
        if next.is_empty() {
            break;
        }
        levels.push(next);
        count += 1;
    }

    let mut ends = Vec::new();
    if greedy {
        for level in levels.iter().skip(min as usize).rev() {
            ends.extend(level.iter().copied());
        }
    } else {
        for level in levels.iter().skip(min as usize) {
            ends.extend(level.iter().copied());
        }
    }
    ends
}

/// A parser for the supported regex subset.
struct PatternParser {
    chars: Vec<char>,
    pos: usize,
}

impl PatternParser {
    /// Parse the whole pattern.
    fn parse(pattern: &str) -> Result<Node, String> {
        let mut parser = PatternParser {
            chars: pattern.chars().collect(),
            pos: 0,
        };
        let node = parser.parse_alternation()?;
        if parser.pos < parser.chars.len() {
            return Err("Unmatched ')'".to_string());
        }
        Ok(node)
    }

    /// Look at the next character without consuming it.
    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    /// Consume the next character.
    fn next(&mut self) -> Option<char> {
        let ch = self.peek();
        if ch.is_some() {
            self.pos += 1;
        }
        ch
    }

    /// Parse `a|b|c`.
    fn parse_alternation(&mut self) -> Result<Node, String> {
        let mut alternatives = vec![self.parse_concat()?];
        while self.peek() == Some('|') {
            self.pos += 1;
            alternatives.push(self.parse_concat()?);
        }
        if alternatives.len() == 1 {
            Ok(alternatives.pop().unwrap_or(Node::Empty))
        } else {
            Ok(Node::Alt(alternatives))
        }
    }

    /// Parse a sequence of atoms.
    fn parse_concat(&mut self) -> Result<Node, String> {
        let mut nodes = Vec::new();
        while let Some(ch) = self.peek() {
            if ch == '|' || ch == ')' {
                break;
            }
            nodes.push(self.parse_repeat()?);
        }
        match nodes.len() {
            0 => Ok(Node::Empty),
            1 => Ok(nodes.pop().unwrap_or(Node::Empty)),
            _ => Ok(Node::Concat(nodes)),
        }
    }

    /// Parse an atom with an optional quantifier.
    fn parse_repeat(&mut self) -> Result<Node, String> {
        let atom = self.parse_atom()?;
        let Some(quantifier) = self.peek() else {
            return Ok(atom);
        };
        let (min, max) = match quantifier {
            '*' => (0, None),
            '+' => (1, None),
            '?' => (0, Some(1)),
            _ => return Ok(atom),
        };
        self.pos += 1;
        let greedy = if self.peek() == Some('?') {
            self.pos += 1;
            false
        } else {
            true
        };
        Ok(Node::Repeat {
            node: Box::new(atom),
            min,
            max,
            greedy,
        })
    }

    /// Parse a single atom.
    fn parse_atom(&mut self) -> Result<Node, String> {
        let Some(ch) = self.next() else {
            return Ok(Node::Empty);
        };
        match ch {
            '(' => {
                let node = self.parse_alternation()?;
                if self.next() != Some(')') {
                    return Err("Unterminated group".to_string());
                }
                Ok(node)
            }
            '[' => self.parse_class(),
            '.' => Ok(Node::Any),
            '^' => Ok(Node::Start),
            '$' => Ok(Node::End),
            '*' | '+' | '?' => Err("Nothing to repeat".to_string()),
            '\\' => {
                let Some(escaped) = self.next() else {
                    return Err("Trailing backslash".to_string());
                };
                Ok(escape_node(escaped))
            }
            other => Ok(Node::Literal(other)),
        }
    }

    /// Parse a `[…]` character class.
    fn parse_class(&mut self) -> Result<Node, String> {
        let negated = if self.peek() == Some('^') {
            self.pos += 1;
            true
        } else {
            false
        };

        let mut items: Vec<ClassItem> = Vec::new();
        let mut first = true;
        loop {
            let Some(ch) = self.next() else {
                return Err("Unterminated character class".to_string());
            };
            if ch == ']' && !first {
                break;
            }
            first = false;

            let low = if ch == '\\' {
                let Some(escaped) = self.next() else {
                    return Err("Trailing backslash".to_string());
                };
                match escape_node(escaped) {
                    Node::Literal(c) => c,
                    Node::Class {
                        negated: n,
                        items: inner,
                    } => {
                        if n {
                            items.push(ClassItem::Not(inner));
                        } else {
                            items.extend(inner);
                        }
                        continue;
                    }
                    _ => continue,
                }
            } else {
                ch
            };

            if self.peek() == Some('-') && self.chars.get(self.pos + 1).copied() != Some(']') {
                self.pos += 1;
                let Some(high) = self.next() else {
                    return Err("Unterminated character class".to_string());
                };
                let high = if high == '\\' {
                    let Some(escaped) = self.next() else {
                        return Err("Trailing backslash".to_string());
                    };
                    match escape_node(escaped) {
                        Node::Literal(c) => c,
                        _ => {
                            return Err("Invalid character range".to_string());
                        }
                    }
                } else {
                    high
                };
                if high < low {
                    return Err("Range out of order in character class".to_string());
                }
                items.push(ClassItem::Range(low, high));
            } else {
                items.push(ClassItem::Char(low));
            }
        }

        Ok(Node::Class { negated, items })
    }
}

/// The node an escape sequence stands for.
fn escape_node(escaped: char) -> Node {
    match escaped {
        'd' | 'D' => Node::Class {
            negated: escaped == 'D',
            items: vec![ClassItem::Range('0', '9')],
        },
        'w' | 'W' => Node::Class {
            negated: escaped == 'W',
            items: vec![
                ClassItem::Range('a', 'z'),
                ClassItem::Range('A', 'Z'),
                ClassItem::Range('0', '9'),
                ClassItem::Char('_'),
            ],
        },
        's' | 'S' => Node::Class {
            negated: escaped == 'S',
            items: vec![
                ClassItem::Char(' '),
                ClassItem::Char('\t'),
                ClassItem::Char('\n'),
                ClassItem::Char('\r'),
                ClassItem::Char('\u{0B}'),
                ClassItem::Char('\u{0C}'),
            ],
        },
        'n' => Node::Literal('\n'),
        'r' => Node::Literal('\r'),
        't' => Node::Literal('\t'),
        other => Node::Literal(other),
    }
}

/// A case-insensitive regular expression over the supported subset.
///
/// Supported: literal characters, `.`, `*`, `+`, `?`, character classes
/// (`[…]`, ranges, negation), the `\d`/`\w`/`\s` shorthands, groups,
/// `^`/`$` anchors and `|` alternatives.
#[derive(Clone, Debug)]
pub(crate) struct Regex {
    /// The source pattern.
    pattern: String,
    /// The parsed pattern.
    node: Node,
}

impl Regex {
    /// Compile a pattern, failing when it is outside the supported subset.
    pub(crate) fn new(pattern: &str) -> Result<Self, String> {
        let node = PatternParser::parse(pattern)?;
        Ok(Regex {
            pattern: pattern.to_string(),
            node,
        })
    }

    /// The source pattern.
    pub(crate) fn pattern(&self) -> &str {
        &self.pattern
    }

    /// Whether the pattern matches anywhere in the text.
    pub(crate) fn is_match(&self, text: &str) -> bool {
        self.search(text).is_some()
    }

    /// The character index of the leftmost match, if any.
    pub(crate) fn search(&self, text: &str) -> Option<usize> {
        let chars: Vec<char> = text.chars().collect();
        for start in 0..=chars.len() {
            if !match_all(&self.node, &chars, start).is_empty() {
                return Some(start);
            }
        }
        None
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(
        id: &str,
        name: Option<&str>,
        text: &str,
        cwd: &str,
        modified_ms: i64,
    ) -> SessionCandidate {
        SessionCandidate {
            id: id.to_string(),
            name: name.map(|n| n.to_string()),
            all_messages_text: text.to_string(),
            cwd: cwd.to_string(),
            modified_ms,
        }
    }

    #[test]
    fn parses_plain_query_into_fuzzy_tokens() {
        let parsed = parse_search_query("foo bar");
        assert_eq!(parsed.mode, QueryMode::Tokens);
        assert_eq!(parsed.tokens.len(), 2);
        assert!(parsed.tokens.iter().all(|t| t.kind == TokenKind::Fuzzy));
        assert_eq!(parsed.tokens[0].value, "foo");
        assert_eq!(parsed.tokens[1].value, "bar");
        assert!(parsed.regex.is_none());
        assert!(parsed.error.is_none());
    }

    #[test]
    fn parses_empty_query_into_no_tokens() {
        let parsed = parse_search_query("   ");
        assert_eq!(parsed.mode, QueryMode::Tokens);
        assert!(parsed.tokens.is_empty());
        assert!(parsed.error.is_none());
    }

    #[test]
    fn parses_regex_mode() {
        let parsed = parse_search_query("re:foo.*bar");
        assert_eq!(parsed.mode, QueryMode::Regex);
        assert!(parsed.regex.is_some());
        assert!(parsed.error.is_none());
    }

    #[test]
    fn rejects_empty_regex() {
        let parsed = parse_search_query("re:   ");
        assert_eq!(parsed.mode, QueryMode::Regex);
        assert!(parsed.regex.is_none());
        assert_eq!(parsed.error.as_deref(), Some("Empty regex"));
    }

    #[test]
    fn rejects_invalid_regex() {
        let parsed = parse_search_query("re:[unterminated");
        assert_eq!(parsed.mode, QueryMode::Regex);
        assert!(parsed.regex.is_none());
        assert!(parsed.error.is_some());
    }

    #[test]
    fn parses_quoted_phrase_tokens() {
        let parsed = parse_search_query("foo \"node cve\" bar");
        assert_eq!(parsed.tokens.len(), 3);
        assert_eq!(parsed.tokens[0].kind, TokenKind::Fuzzy);
        assert_eq!(parsed.tokens[0].value, "foo");
        assert_eq!(parsed.tokens[1].kind, TokenKind::Phrase);
        assert_eq!(parsed.tokens[1].value, "node cve");
        assert_eq!(parsed.tokens[2].kind, TokenKind::Fuzzy);
        assert_eq!(parsed.tokens[2].value, "bar");
    }

    #[test]
    fn unclosed_quote_falls_back_to_whitespace_tokens() {
        let parsed = parse_search_query("foo \"node cve");
        assert_eq!(parsed.mode, QueryMode::Tokens);
        assert_eq!(parsed.tokens.len(), 3);
        assert!(parsed.tokens.iter().all(|t| t.kind == TokenKind::Fuzzy));
        assert_eq!(parsed.tokens[0].value, "foo");
        assert_eq!(parsed.tokens[1].value, "\"node");
        assert_eq!(parsed.tokens[2].value, "cve");
    }

    #[test]
    fn phrase_token_matches_case_insensitively() {
        let parsed = parse_search_query("\"node cve\"");
        let result = match_session_text("id  Some NODE   CVE text", &parsed);
        assert!(result.matches);
    }

    #[test]
    fn phrase_token_that_does_not_match() {
        let parsed = parse_search_query("\"missing phrase\"");
        let result = match_session_text("id  some other text", &parsed);
        assert!(!result.matches);
        assert_eq!(result.score, 0.0);
    }

    #[test]
    fn fuzzy_token_that_does_not_match() {
        let parsed = parse_search_query("zzzqqq");
        let result = match_session_text("id some other text", &parsed);
        assert!(!result.matches);
    }

    #[test]
    fn every_token_must_match() {
        let parsed = parse_search_query("alpha zzzqqq");
        let result = match_session_text("id alpha text", &parsed);
        assert!(!result.matches);
    }

    #[test]
    fn regex_match_scores_by_index() {
        let parsed = parse_search_query("re:beta");
        let result = match_session_text("id alpha beta", &parsed);
        assert!(result.matches);
        assert!((result.score - 0.9).abs() < f64::EPSILON);
    }

    #[test]
    fn invalid_regex_matches_nothing() {
        let parsed = parse_search_query("re:[unterminated");
        let result = match_session_text("id alpha beta", &parsed);
        assert!(!result.matches);
    }

    #[test]
    fn empty_query_matches_everything() {
        let parsed = parse_search_query("");
        let result = match_session_text("anything", &parsed);
        assert!(result.matches);
        assert_eq!(result.score, 0.0);
    }

    #[test]
    fn recent_keeps_incoming_order() {
        let sessions = vec![
            candidate("a", Some("first"), "alpha", "/tmp", 30),
            candidate("b", Some("second"), "beta", "/tmp", 20),
            candidate("c", Some("third"), "alpine", "/tmp", 10),
        ];
        let filtered = filter_and_sort(&sessions, "al", SortMode::Recent, NameFilter::All);
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].id, "a");
        assert_eq!(filtered[1].id, "c");
    }

    #[test]
    fn relevance_sorts_by_score_with_newer_tie_break() {
        let sessions = vec![
            candidate("a", Some("first"), "alpha", "/tmp", 10),
            candidate("b", Some("second"), "beta", "/tmp", 20),
        ];
        let filtered = filter_and_sort(&sessions, "a", SortMode::Relevance, NameFilter::All);
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].id, "a");
        assert_eq!(filtered[1].id, "b");
    }

    #[test]
    fn relevance_tie_breaks_on_newer_modified() {
        let sessions = vec![
            candidate("a", None, "alpha", "/tmp", 10),
            candidate("b", None, "beta", "/tmp", 20),
        ];
        let filtered = filter_and_sort(
            &sessions,
            "re:alpha|beta",
            SortMode::Relevance,
            NameFilter::All,
        );
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].id, "b");
        assert_eq!(filtered[1].id, "a");
    }

    #[test]
    fn named_filter_drops_unnamed_sessions() {
        let sessions = vec![
            candidate("a", None, "alpha", "/tmp", 10),
            candidate("b", Some("   "), "beta", "/tmp", 20),
            candidate("c", Some("named"), "gamma", "/tmp", 30),
        ];
        let filtered = filter_and_sort(&sessions, "", SortMode::Recent, NameFilter::Named);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, "c");
    }

    #[test]
    fn invalid_regex_query_yields_no_sessions() {
        let sessions = vec![candidate("a", Some("first"), "alpha", "/tmp", 10)];
        let filtered = filter_and_sort(&sessions, "re:[bad", SortMode::Relevance, NameFilter::All);
        assert!(filtered.is_empty());
    }

    #[test]
    fn search_text_uses_id_name_text_and_cwd() {
        let session = candidate("id1", Some("name"), "body", "/tmp/dir", 0);
        assert_eq!(session.search_text(), "id1 name body /tmp/dir");
    }

    #[test]
    fn regex_matches_literals_case_insensitively() {
        let regex = Regex::new("Hello").expect("valid");
        assert_eq!(regex.search("say hello world"), Some(4));
        assert!(regex.is_match("SAY HELLO"));
        assert!(!regex.is_match("goodbye"));
    }

    #[test]
    fn regex_matches_dot_and_star() {
        let regex = Regex::new("a.c*").expect("valid");
        assert!(regex.is_match("abbb"));
        assert!(regex.is_match("ac"));
        assert!(!regex.is_match("b"));
    }

    #[test]
    fn regex_matches_plus_and_question_mark() {
        let regex = Regex::new("ab+c").expect("valid");
        assert!(regex.is_match("xabbbc"));
        assert!(!regex.is_match("xac"));
        let regex = Regex::new("colou?r").expect("valid");
        assert!(regex.is_match("color"));
        assert!(regex.is_match("colour"));
    }

    #[test]
    fn regex_matches_character_classes() {
        let regex = Regex::new("[a-c]x").expect("valid");
        assert!(regex.is_match("bx"));
        assert!(!regex.is_match("dx"));
        let negated = Regex::new("[^0-9]+").expect("valid");
        assert!(negated.is_match("abc"));
        assert!(negated.is_match("ab1"));
        assert!(!negated.is_match("12"));
    }

    #[test]
    fn regex_matches_anchors() {
        let regex = Regex::new("^abc$").expect("valid");
        assert!(regex.is_match("abc"));
        assert!(!regex.is_match("xabc"));
        assert!(!regex.is_match("abcx"));
    }

    #[test]
    fn regex_matches_alternatives() {
        let regex = Regex::new("cat|dog").expect("valid");
        assert!(regex.is_match("hotdog"));
        assert!(regex.is_match("cat"));
        assert!(!regex.is_match("bird"));
    }

    #[test]
    fn regex_matches_shorthand_classes() {
        let digits = Regex::new("\\d+").expect("valid");
        assert!(digits.is_match("abc123"));
        assert!(!digits.is_match("abc"));
        let non_digits = Regex::new("\\D+").expect("valid");
        assert!(non_digits.is_match("abc"));
        assert!(!non_digits.is_match("123"));
        let word = Regex::new("\\w+").expect("valid");
        assert!(word.is_match("a-b"));
        assert!(!word.is_match("---"));
    }

    #[test]
    fn regex_rejects_unsupported_patterns() {
        assert!(Regex::new("[unterminated").is_err());
        assert!(Regex::new("(unterminated").is_err());
        assert!(Regex::new("*leading").is_err());
        assert!(Regex::new("trailing\\").is_err());
        assert!(Regex::new("[z-a]").is_err());
    }

    #[test]
    fn regex_search_returns_leftmost_index() {
        let regex = Regex::new("beta").expect("valid");
        assert_eq!(regex.search("alpha beta beta"), Some(6));
    }
}
