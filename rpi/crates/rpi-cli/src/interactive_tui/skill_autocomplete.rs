//! Skill-mention autocomplete (`@name`).
//!
//! Mirrors the original's mention suggestions
//! (`packages/tui/src/autocomplete.ts:512` `getMentionSuggestions`): the loaded
//! skills are offered next to the file completions, fuzzy-matched on the skill
//! name without the `@`.

use rpi_harness::types::Skill;
use rpi_tui::fuzzy::fuzzy_filter;
use rpi_tui::{AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions};

/// The characters that end a token. Mirrors the TUI library's path delimiters.
const TOKEN_DELIMITERS: &[char] = &[' ', '\t', '"', '\'', '='];

/// Offers the loaded skills as `@name` completions.
pub struct SkillMentionAutocompleteProvider {
    skills: Vec<Skill>,
}

impl SkillMentionAutocompleteProvider {
    /// Build a provider over the loaded skills.
    pub fn new(skills: Vec<Skill>) -> Self {
        Self { skills }
    }
}

impl AutocompleteProvider for SkillMentionAutocompleteProvider {
    fn get_suggestions(&self, input: &str, cursor: usize) -> Option<AutocompleteSuggestions> {
        let mut cursor = cursor.min(input.len());
        while cursor > 0 && !input.is_char_boundary(cursor) {
            cursor -= 1;
        }
        let before_cursor = &input[..cursor];
        let mut start = 0;
        for (index, ch) in before_cursor.char_indices().rev() {
            if TOKEN_DELIMITERS.contains(&ch) {
                start = index + ch.len_utf8();
                break;
            }
        }
        let token = &before_cursor[start..];
        let Some(prefix) = token.strip_prefix('@') else {
            return None;
        };
        if prefix.contains('"') {
            return None;
        }
        let matched = fuzzy_filter(&self.skills, prefix, |skill| skill.name.as_str());
        if matched.is_empty() {
            return None;
        }
        let items = matched
            .into_iter()
            .map(|skill| {
                AutocompleteItem::new(&format!("@{}", skill.name))
                    .with_description(&skill.description)
                    .with_insert_space(false)
            })
            .collect();
        Some(AutocompleteSuggestions {
            items,
            start,
            end: cursor,
            is_path: false,
        })
    }

    fn name(&self) -> &str {
        "skill_mention"
    }
}
