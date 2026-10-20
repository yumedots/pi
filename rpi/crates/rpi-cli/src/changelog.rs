//! Changelog parsing and the startup release note.
//!
//! The port shows the original's release notes: the changelog that ships with
//! the original, parsed with the original's rules, so the "What's New" note
//! and the `/changelog` listing read exactly like the original's.

use serde::{Deserialize, Serialize};

const BUNDLED_CHANGELOG: &str = include_str!("../embedded-docs/pi-changelog.md");

/// The repository the original's changelog links point at.
const REPO: &str = "earendil-works/pi";
/// The directory the original's changelog lives in, so relative links resolve.
const LINK_BASE_PATH: &str = "packages/coding-agent";
/// The repository the original was published under before the rename.
const LEGACY_REPO_PREFIX: &str = "https://github.com/badlogic/pi-mono";
const LEGACY_REPO_PREFIX_2: &str = "https://github.com/earendil-works/pi-mono";

/// One released version's changelog section.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChangelogEntry {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
    /// The section body, heading line included.
    pub content: String,
}

impl ChangelogEntry {
    /// The version of this entry, as `major.minor.patch`.
    pub fn version(&self) -> String {
        format!("{}.{}.{}", self.major, self.minor, self.patch)
    }
}

/// Parse a version heading like `## 1.2.3` or `## [1.2.3] - 2026-10-15`.
fn parse_version_heading(line: &str) -> Option<(u64, u64, u64)> {
    let rest = line.strip_prefix("## ")?.trim_start();
    let rest = rest.strip_prefix('[').unwrap_or(rest);
    let mut parts = rest.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch: String = parts
        .next()?
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    let patch = patch.parse().ok()?;
    Some((major, minor, patch))
}

/// Split a changelog into versioned entries, newest first.
///
/// The heading line stays in the entry body, so the rendered note carries the
/// original's `## [1.3.0] - 2026-10-15` line.
pub fn parse_changelog(text: &str) -> Vec<ChangelogEntry> {
    let mut entries: Vec<ChangelogEntry> = Vec::new();
    let mut current: Option<(u64, u64, u64)> = None;
    let mut collected: Vec<String> = Vec::new();

    for line in text.split('\n') {
        if line.starts_with("## ") {
            if let Some((major, minor, patch)) = current {
                if !collected.is_empty() {
                    entries.push(ChangelogEntry {
                        major,
                        minor,
                        patch,
                        content: collected.join("\n").trim().to_string(),
                    });
                }
            }
            collected = Vec::new();
            match parse_version_heading(line) {
                Some(version) => {
                    current = Some(version);
                    collected.push(line.to_string());
                }
                None => current = None,
            }
            continue;
        }
        if current.is_some() {
            collected.push(line.to_string());
        }
    }
    if let Some((major, minor, patch)) = current {
        if !collected.is_empty() {
            entries.push(ChangelogEntry {
                major,
                minor,
                patch,
                content: collected.join("\n").trim().to_string(),
            });
        }
    }
    entries
}

/// The release notes that ship with the port.
pub fn bundled_entries() -> Vec<ChangelogEntry> {
    parse_changelog(BUNDLED_CHANGELOG)
}

/// The version the original is at, taken from its newest release entry.
pub fn current_version() -> String {
    bundled_entries()
        .first()
        .map(ChangelogEntry::version)
        .unwrap_or_else(|| "0.0.0".to_string())
}

/// The entries newer than `last_version`, newest first.
pub fn new_entries(entries: &[ChangelogEntry], last_version: &str) -> Vec<ChangelogEntry> {
    let last = parse_version(last_version);
    entries
        .iter()
        .filter(|entry| {
            (
                entry.major,
                entry.minor,
                entry.patch,
            ) > (last.0, last.1, last.2)
        })
        .cloned()
        .collect()
}

fn parse_version(version: &str) -> (u64, u64, u64) {
    let mut parts = version.split('.');
    let major = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    let minor = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    let patch = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    (major, minor, patch)
}

/// Render entries as the original renders them, oldest first.
pub fn changelog_markdown(entries: &[ChangelogEntry]) -> String {
    let mut ordered: Vec<&ChangelogEntry> = entries.iter().collect();
    ordered.reverse();
    ordered
        .iter()
        .map(|entry| normalize_links(&entry.content, &entry.version()))
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Rewrite the relative links of a changelog body into repository links.
pub fn normalize_links(markdown: &str, version: &str) -> String {
    let tag = if version.starts_with('v') {
        version.to_string()
    } else {
        format!("v{version}")
    };
    let mut out = String::with_capacity(markdown.len());
    let mut rest = markdown;
    while let Some(start) = rest.find("](") {
        let (before, after) = rest.split_at(start);
        out.push_str(before);
        let after = &after[2..];
        let Some(end) = after.find(')') else {
            out.push_str("](");
            rest = after;
            continue;
        };
        let target = &after[..end];
        out.push_str("](");
        out.push_str(&normalize_link_target(target, &tag));
        out.push(')');
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

fn normalize_link_target(target: &str, tag: &str) -> String {
    let canonical = if let Some(rest) = target.strip_prefix(LEGACY_REPO_PREFIX) {
        format!("https://github.com/{REPO}{rest}")
    } else if let Some(rest) = target.strip_prefix(LEGACY_REPO_PREFIX_2) {
        format!("https://github.com/{REPO}{rest}")
    } else {
        target.to_string()
    };
    let repo_url = format!("https://github.com/{REPO}");
    let mut canonical = canonical;
    for route in ["blob", "tree"] {
        for branch in ["main", "master"] {
            let prefix = format!("{repo_url}/{route}/{branch}/");
            if let Some(rest) = canonical.strip_prefix(&prefix) {
                canonical = format!("{repo_url}/{route}/{tag}/{rest}");
            }
        }
    }
    if canonical.starts_with('#')
        || canonical.starts_with("//")
        || has_scheme(&canonical)
    {
        return canonical;
    }
    let (path_part, suffix) = split_target(&canonical);
    if path_part.is_empty() {
        return canonical;
    }
    let Some(repository_path) = resolve_repository_path(&path_part) else {
        return canonical;
    };
    let route = if is_directory_target(&path_part, &repository_path) {
        "tree"
    } else {
        "blob"
    };
    format!(
        "{repo_url}/{route}/{tag}/{}{suffix}",
        encode_uri(&repository_path)
    )
}

fn has_scheme(target: &str) -> bool {
    let mut chars = target.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphabetic() {
        return false;
    }
    for c in chars {
        if c == ':' {
            return true;
        }
        if !(c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.') {
            return false;
        }
    }
    false
}

fn split_target(target: &str) -> (String, String) {
    let hash = target.find('#');
    let before_hash = hash.map(|index| &target[..index]).unwrap_or(target);
    let fragment = hash.map(|index| &target[index..]).unwrap_or("");
    let query = before_hash.find('?');
    let path_part = query.map(|index| &before_hash[..index]).unwrap_or(before_hash);
    let query_part = query.map(|index| &before_hash[index..]).unwrap_or("");
    (
        path_part.to_string(),
        format!("{query_part}{fragment}"),
    )
}

fn resolve_repository_path(target: &str) -> Option<String> {
    let normalized = target.replace('\\', "/");
    let joined = if normalized.starts_with('/') {
        normalize_posix(normalized.trim_start_matches('/'))
    } else {
        normalize_posix(&format!("{LINK_BASE_PATH}/{normalized}"))
    };
    if joined == "." || joined.starts_with("../") || joined == ".." {
        return None;
    }
    Some(joined)
}

fn normalize_posix(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

fn is_directory_target(original: &str, repository_path: &str) -> bool {
    if original.ends_with('/') {
        return true;
    }
    let basename = repository_path.rsplit('/').next().unwrap_or("");
    !basename.contains('.')
}

fn encode_uri(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for byte in path.bytes() {
        let c = byte as char;
        if c.is_ascii_alphanumeric() || ";,/?:@&=+$-_.!~*'()#".contains(c) {
            out.push(c);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// The release note the startup screen shows.
#[derive(Debug, Default)]
pub struct StartupChangelog {
    pub markdown: Option<String>,
    pub version_to_record: Option<String>,
}

/// The original's rule: a fresh install records the version and shows nothing,
/// an upgrade shows the entries the user has not seen, and a resumed session
/// shows nothing at all.
pub fn startup_changelog(
    entries: &[ChangelogEntry],
    last_version: Option<&str>,
    current_version: &str,
    has_messages: bool,
) -> StartupChangelog {
    if has_messages {
        return StartupChangelog::default();
    }
    let Some(last_version) = last_version else {
        return StartupChangelog {
            markdown: None,
            version_to_record: Some(current_version.to_string()),
        };
    };
    let unseen = new_entries(entries, last_version);
    if unseen.is_empty() {
        return StartupChangelog::default();
    }
    StartupChangelog {
        markdown: Some(changelog_markdown(&unseen)),
        version_to_record: Some(current_version.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_original_headings() {
        let entries = parse_changelog(
            "## [Unreleased]\n\n- unreleased\n\n## [1.3.0] - 2026-10-15\n\n- current\n\n## [1.2.0] - 2026-10-12\n\n- previous",
        );
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].version(), "1.3.0");
        assert_eq!(entries[1].version(), "1.2.0");
        assert!(entries[0].content.starts_with("## [1.3.0] - 2026-10-15"));
        assert!(entries[0].content.contains("- current"));
        assert!(!entries[0].content.contains("- previous"));
    }

    #[test]
    fn bundled_entries_are_the_originals() {
        let entries = bundled_entries();
        assert!(!entries.is_empty());
        assert_eq!(current_version(), "1.3.0");
        assert!(entries[0].content.contains("## [1.3.0]"));
    }

    #[test]
    fn new_entries_are_the_ones_after_the_last_seen_version() {
        let entries = parse_changelog(
            "## [1.3.0]\n- current\n## [1.2.0]\n- previous\n## [1.1.0]\n- older",
        );
        let unseen = new_entries(&entries, "1.2.0");
        assert_eq!(unseen.len(), 1);
        assert_eq!(unseen[0].version(), "1.3.0");
        assert!(new_entries(&entries, "1.3.0").is_empty());
    }

    #[test]
    fn relative_links_point_at_the_repository() {
        let markdown = "See [the docs](docs/providers.md) and [the guide](docs/usage.md#model-options).";
        let normalized = normalize_links(markdown, "1.3.0");
        assert!(normalized.contains(
            "https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/providers.md"
        ));
        assert!(normalized.contains(
            "https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/usage.md#model-options"
        ));
    }

    #[test]
    fn absolute_links_are_left_alone() {
        let markdown = "[pi](https://pi.dev) and [anchor](#section)";
        assert_eq!(normalize_links(markdown, "1.3.0"), markdown);
    }

    #[test]
    fn a_fresh_install_records_the_version_without_a_note() {
        let entries = bundled_entries();
        let notice = startup_changelog(&entries, None, "1.3.0", false);
        assert!(notice.markdown.is_none());
        assert_eq!(notice.version_to_record.as_deref(), Some("1.3.0"));
    }

    #[test]
    fn an_upgrade_shows_the_unseen_entries() {
        let entries = bundled_entries();
        let notice = startup_changelog(&entries, Some("1.2.0"), "1.3.0", false);
        let markdown = notice.markdown.expect("a note");
        assert!(markdown.contains("## [1.3.0]"));
        assert!(!markdown.contains("## [1.2.0]"));
        assert_eq!(notice.version_to_record.as_deref(), Some("1.3.0"));
    }

    #[test]
    fn a_resumed_session_shows_nothing() {
        let entries = bundled_entries();
        let notice = startup_changelog(&entries, Some("1.2.0"), "1.3.0", true);
        assert!(notice.markdown.is_none());
        assert!(notice.version_to_record.is_none());
    }

    #[test]
    fn the_changelog_command_lists_the_oldest_entry_first() {
        let entries = bundled_entries();
        let markdown = changelog_markdown(&entries);
        let newest = entries.first().unwrap().version();
        let oldest = entries.last().unwrap().version();
        let newest_at = markdown
            .find(&format!("## [{newest}]"))
            .expect("the newest entry");
        let oldest_at = markdown
            .find(&format!("## [{oldest}]"))
            .expect("the oldest entry");
        assert!(oldest_at < newest_at, "the oldest entry comes first");
        assert!(markdown.contains("https://github.com/earendil-works/pi/"));
    }
}
