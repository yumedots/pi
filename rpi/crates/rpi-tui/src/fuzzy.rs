//! Fuzzy matching utilities.
//!
//! Matches if all query characters appear in order (not necessarily consecutive).
//! Lower score = better match.

/// Result of a fuzzy match.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FuzzyMatch {
    /// Whether the pattern matches.
    pub matches: bool,
    /// Match score (lower is better).
    ///
    /// A float, like the original's: the score carries a fractional term
    /// (`i * 0.1`) that decides the order of two candidates whose integer
    /// parts are equal (`packages/tui/src/fuzzy.ts:44`).
    pub score: f64,
}

impl FuzzyMatch {
    /// Create a non-matching result.
    pub fn no_match() -> Self {
        Self {
            matches: false,
            score: 0.0,
        }
    }

    /// Create a matching result with the given score.
    pub fn with_score(score: f64) -> Self {
        Self {
            matches: true,
            score,
        }
    }
}

/// Perform fuzzy matching between a query and text.
/// Returns a FuzzyMatch with the result and score.
pub fn fuzzy_match(query: &str, text: &str) -> FuzzyMatch {
    let query_lower = query.to_lowercase();
    let text_lower = text.to_lowercase();

    // Try primary match first
    let primary_match = match_query(&query_lower, &text_lower);
    if primary_match.matches {
        return primary_match;
    }

    // Try swapped alphanumeric query (e.g., "2f" for "f2")
    if let Some(swapped) = swap_alphanumeric(&query_lower) {
        let swapped_match = match_query(&swapped, &text_lower);
        if swapped_match.matches {
            return FuzzyMatch::with_score(swapped_match.score + 5.0);
        }
    }

    primary_match
}

/// Internal matching function.
fn match_query(query: &str, text: &str) -> FuzzyMatch {
    if query.is_empty() {
        return FuzzyMatch::with_score(0.0);
    }

    let text_chars: Vec<char> = text.chars().collect();
    let query_chars: Vec<char> = query.chars().collect();

    if query_chars.len() > text_chars.len() {
        return FuzzyMatch::no_match();
    }

    let mut query_index = 0;
    let mut score: f64 = 0.0;
    let mut last_match_index: i32 = -1;
    let mut consecutive_matches = 0;

    for (i, &text_char) in text_chars.iter().enumerate() {
        if query_index >= query_chars.len() {
            break;
        }

        if text_char == query_chars[query_index] {
            // Check for word boundary
            let is_word_boundary = i == 0 || {
                let prev_char = text_chars[i - 1];
                is_word_boundary_char(prev_char)
            };

            // Reward consecutive matches. The first match of the query counts
            // as consecutive too: the original compares the match index with
            // the previous one, and the previous one starts at -1
            // (`packages/tui/src/fuzzy.ts:38`).
            if i as i32 == last_match_index + 1 {
                consecutive_matches += 1;
                score -= consecutive_matches as f64 * 5.0;
            } else {
                consecutive_matches = 0;
                // Penalize gaps
                if last_match_index >= 0 {
                    score += (i as i32 - last_match_index - 1) as f64 * 2.0;
                }
            }

            // Reward word boundary matches
            if is_word_boundary {
                score -= 10.0;
            }

            // Slight penalty for later matches
            score += i as f64 * 0.1;

            last_match_index = i as i32;
            query_index += 1;
        }
    }

    if query_index < query_chars.len() {
        return FuzzyMatch::no_match();
    }

    // Bonus for exact match
    if query == text {
        score -= 100.0;
    }

    FuzzyMatch::with_score(score)
}

/// Check if a character is a word boundary.
fn is_word_boundary_char(c: char) -> bool {
    c.is_whitespace() || matches!(c, '-' | '_' | '.' | '/' | ':')
}

/// Swap alphanumeric parts (e.g., "f2" -> "2f", "2file" -> "file2").
fn swap_alphanumeric(query: &str) -> Option<String> {
    let chars: Vec<char> = query.chars().collect();

    // Find the split point between letters and digits
    let mut letter_end = 0;
    let mut digit_start = 0;

    for (i, &c) in chars.iter().enumerate() {
        if c.is_ascii_lowercase() {
            letter_end = i + 1;
        } else if c.is_ascii_digit() {
            digit_start = i;
            break;
        }
    }

    // Check for pattern: letters followed by digits
    if letter_end > 0 && digit_start >= letter_end {
        let letters: String = chars[..letter_end].iter().collect();
        let digits: String = chars[digit_start..].iter().collect();
        return Some(format!("{}{}", digits, letters));
    }

    // Check for pattern: digits followed by letters
    let mut digit_end = 0;
    let mut letter_start = 0;

    for (i, &c) in chars.iter().enumerate() {
        if c.is_ascii_digit() {
            digit_end = i + 1;
        } else if c.is_ascii_lowercase() {
            letter_start = i;
            break;
        }
    }

    if digit_end > 0 && letter_start >= digit_end {
        let digits: String = chars[..digit_end].iter().collect();
        let letters: String = chars[letter_start..].iter().collect();
        return Some(format!("{}{}", letters, digits));
    }

    None
}

/// Filter and sort items by fuzzy match quality (best matches first).
/// Supports whitespace- and slash-separated tokens: all tokens must match.
pub fn fuzzy_filter<T, F>(items: &[T], query: &str, get_text: F) -> Vec<T>
where
    T: Clone,
    F: Fn(&T) -> &str,
{
    let query = query.trim();
    if query.is_empty() {
        return items.to_vec();
    }

    // Split query into tokens
    let tokens: Vec<&str> = query
        .split(|c: char| c.is_whitespace() || c == '/')
        .filter(|t| !t.is_empty())
        .collect();

    if tokens.is_empty() {
        return items.to_vec();
    }

    let mut results: Vec<(T, f64)> = Vec::new();

    for item in items {
        let text = get_text(item);
        let mut total_score: f64 = 0.0;
        let mut all_match = true;

        for token in &tokens {
            let match_result = fuzzy_match(token, text);
            if match_result.matches {
                total_score += match_result.score;
            } else {
                all_match = false;
                break;
            }
        }

        if all_match {
            results.push((item.clone(), total_score));
        }
    }

    // Sort by score (lower is better)
    results.sort_by(|a, b| a.1.total_cmp(&b.1));
    results.into_iter().map(|(item, _)| item).collect()
}

/// Filter items with owned strings.
pub fn fuzzy_filter_owned<T, F>(items: Vec<T>, query: &str, get_text: F) -> Vec<T>
where
    T: Clone,
    F: Fn(&T) -> String,
{
    let query = query.trim();
    if query.is_empty() {
        return items;
    }

    let tokens: Vec<&str> = query
        .split(|c: char| c.is_whitespace() || c == '/')
        .filter(|t| !t.is_empty())
        .collect();

    if tokens.is_empty() {
        return items;
    }

    let mut results: Vec<(T, f64)> = Vec::new();

    for item in items {
        let text = get_text(&item);
        let mut total_score: f64 = 0.0;
        let mut all_match = true;

        for token in &tokens {
            let match_result = fuzzy_match(token, &text);
            if match_result.matches {
                total_score += match_result.score;
            } else {
                all_match = false;
                break;
            }
        }

        if all_match {
            results.push((item, total_score));
        }
    }

    results.sort_by(|a, b| a.1.total_cmp(&b.1));
    results.into_iter().map(|(item, _)| item).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fuzzy_match_exact() {
        let result = fuzzy_match("hello", "hello world");
        assert!(result.matches);
        assert!(result.score < 0.0); // Should have a negative (good) score
    }

    #[test]
    fn test_fuzzy_match_partial() {
        let result = fuzzy_match("hlo", "hello");
        assert!(result.matches);
    }

    #[test]
    fn test_fuzzy_match_no_match() {
        let result = fuzzy_match("xyz", "hello");
        assert!(!result.matches);
    }

    #[test]
    fn test_fuzzy_match_word_boundary() {
        let result1 = fuzzy_match("hw", "hello world");
        let result2 = fuzzy_match("hw", "helloworld");
        assert!(result1.matches);
        assert!(result2.matches);
        // Word boundary match should have better (lower) score
        assert!(result1.score < result2.score);
    }

    #[test]
    fn test_fuzzy_filter() {
        let items = vec!["hello world", "goodbye world", "hello there"];
        let filtered = fuzzy_filter(&items, "hw", |s| *s);
        assert!(!filtered.is_empty());
        assert!(filtered.contains(&"hello world"));
    }

    #[test]
    fn test_fuzzy_filter_multiple_tokens() {
        let items = vec![
            "src/main.rs",
            "src/lib.rs",
            "test/main.rs",
            "docs/readme.md",
        ];
        let filtered = fuzzy_filter(&items, "src main", |s| *s);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0], "src/main.rs");
    }

    #[test]
    fn test_fuzzy_match_case_insensitive() {
        let result = fuzzy_match("HELLO", "hello world");
        assert!(result.matches);
    }

    #[test]
    fn test_swap_alphanumeric() {
        assert_eq!(swap_alphanumeric("f2"), Some("2f".to_string()));
        assert_eq!(swap_alphanumeric("2file"), Some("file2".to_string()));
        assert_eq!(swap_alphanumeric("abc"), None);
    }

    #[test]
    fn the_command_order_is_the_originals() {
        // The original's own filter over its builtin commands
        // (`packages/coding-agent/src/core/slash-commands.ts:21-47`): the query
        // "he" puts "hotkeys" first, because its match starts on the word
        // boundary, and "theme" second, because its matches are consecutive.
        let commands = [
            "settings",
            "model",
            "tree",
            "thinking",
            "scoped-models",
            "skills",
            "theme",
            "export",
            "import",
            "share",
            "bug",
            "copy",
            "name",
            "stats",
            "changelog",
            "hotkeys",
            "fork",
            "clone",
            "trust",
            "login",
            "logout",
            "new",
            "compact",
            "resume",
            "reload",
            "quit",
        ];
        let filtered = fuzzy_filter(&commands, "he", |name| *name);
        assert_eq!(filtered, ["hotkeys", "theme", "share", "changelog"]);
    }

    #[test]
    fn a_later_word_boundary_wins_over_an_earlier_plain_match() {
        // The original's filter orders "resume", "trust" and "hotkeys" for the
        // query "s" by the index of the match, not by the position of the word
        // in the list (`packages/tui/src/fuzzy.ts:44`).
        let commands = ["hotkeys", "trust", "resume"];
        let filtered = fuzzy_filter(&commands, "s", |name| *name);
        assert_eq!(filtered, ["resume", "trust", "hotkeys"]);
    }
}
