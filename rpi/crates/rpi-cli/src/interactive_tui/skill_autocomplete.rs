//! Skill-mention autocomplete (`@name`).
//!
//! Mirrors the original's mention suggestions
//! (`packages/tui/src/autocomplete.ts:512` `getMentionSuggestions`): the loaded
//! skills are offered next to the file completions, fuzzy-matched on the skill
//! name without the `@`.
//!
//! The original shows the two together for one `@` query — the mentions first,
//! then the files (`packages/tui/src/autocomplete.ts:330-345`):
//!
//! ```ts
//! const mentionSuggestions = this.getMentionSuggestions(rawPrefix);
//! const fileSuggestions = await this.getFuzzyFileSuggestions(rawPrefix, {…});
//! const suggestions = [...mentionSuggestions, ...fileSuggestions];
//! ```
//!
//! The port splits the original's single provider in two, so this provider
//! takes the file provider and merges its rows into the same list.

use std::sync::Arc;

use rpi_harness::types::Skill;
use rpi_tui::fuzzy::fuzzy_filter;
use rpi_tui::{AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions};

/// The characters that end a token. Mirrors the TUI library's path delimiters.
const TOKEN_DELIMITERS: &[char] = &[' ', '\t', '"', '\'', '='];

/// Offers the loaded skills as `@name` completions, together with the file
/// completions for the same `@` query.
pub struct SkillMentionAutocompleteProvider {
    skills: Vec<Skill>,
    /// The file provider whose rows join the mention rows.
    files: Option<Arc<dyn AutocompleteProvider>>,
}

impl SkillMentionAutocompleteProvider {
    /// Build a provider over the loaded skills.
    pub fn new(skills: Vec<Skill>) -> Self {
        Self {
            skills,
            files: None,
        }
    }

    /// Add the file provider whose rows are offered alongside the mentions.
    pub fn with_files(mut self, files: Arc<dyn AutocompleteProvider>) -> Self {
        self.files = Some(files);
        self
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
        let mut items: Vec<AutocompleteItem> = matched
            .into_iter()
            .map(|skill| {
                AutocompleteItem::new(&format!("@{}", skill.name))
                    .with_description(&skill.description)
                    .with_insert_space(false)
            })
            .collect();
        // The file rows join the mention rows for the same query, the mentions
        // first. The file provider completes the token *after* the `@`, so its
        // rows are rebased onto the mention's span and carry the `@` in their
        // value — the original's `buildCompletionValue` does the same
        // (`packages/tui/src/autocomplete.ts:143-160`).
        if let Some(files) = &self.files {
            if let Some(file_suggestions) = files.get_suggestions(input, cursor) {
                for item in file_suggestions.items {
                    items.push(AutocompleteItem::new(&format!("@{}", item.text)).with_insert_space(
                        item.insert_space,
                    ));
                }
            }
        }
        if items.is_empty() {
            return None;
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use rpi_tui::FilePathAutocompleteProvider;

    fn skill(name: &str) -> Skill {
        Skill {
            name: name.to_string(),
            description: format!("Do the {name} thing"),
            content: String::new(),
            file_path: String::new(),
            disable_model_invocation: None,
        }
    }

    /// A query that matches both a skill and a file returns both, the skill
    /// first (`packages/tui/src/autocomplete.ts:330-345`).
    #[test]
    fn a_skill_and_a_file_are_both_offered_the_skill_first() {
        let tmp = std::env::temp_dir().join("rpi-skill-mention-merge-test");
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(tmp.join("docs.txt"), "x").unwrap();
        let provider = SkillMentionAutocompleteProvider::new(vec![skill("docs")]).with_files(Arc::new(
            FilePathAutocompleteProvider::with_root(tmp.clone()),
        ));
        let suggestions = provider
            .get_suggestions("@do", 3)
            .expect("the skill and the file both match");
        let texts: Vec<&str> = suggestions
            .items
            .iter()
            .map(|item| item.text.as_str())
            .collect();
        assert_eq!(texts[0], "@docs", "the mention comes first");
        assert!(
            texts.iter().any(|text| text.contains("docs.txt")),
            "the file is offered too, got {texts:?}"
        );
        std::fs::remove_dir_all(&tmp).ok();
    }

    /// A query that matches only a file still offers the file.
    #[test]
    fn a_file_alone_is_offered() {
        let tmp = std::env::temp_dir().join("rpi-skill-mention-file-only-test");
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(tmp.join("notes.txt"), "x").unwrap();
        let provider = SkillMentionAutocompleteProvider::new(Vec::new()).with_files(Arc::new(
            FilePathAutocompleteProvider::with_root(tmp.clone()),
        ));
        let suggestions = provider.get_suggestions("@no", 3).expect("the file matches");
        assert!(
            suggestions
                .items
                .iter()
                .any(|item| item.text.contains("notes.txt")),
            "the file is offered, got {:?}",
            suggestions.items
        );
        std::fs::remove_dir_all(&tmp).ok();
    }

    /// Without a file provider the mentions are offered on their own.
    #[test]
    fn the_mentions_are_offered_without_the_files() {
        let provider = SkillMentionAutocompleteProvider::new(vec![skill("docs")]);
        let suggestions = provider.get_suggestions("@do", 3).expect("the skill matches");
        assert_eq!(suggestions.items.len(), 1);
        assert_eq!(suggestions.items[0].text, "@docs");
    }
}
