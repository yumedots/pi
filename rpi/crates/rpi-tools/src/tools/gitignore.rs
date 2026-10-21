//! `.gitignore` matching for the read-only search tools.
//!
//! Mirrors what ripgrep (pi's `grep`) and fd (pi's `find`) do: the ignore
//! files are honoured inside a git repository and ignored outside one, a rule
//! in a directory applies to that directory and everything below it, and the
//! deepest ignore file that matches a path wins.

use std::sync::Arc;

use globset::{Glob, GlobMatcher};
use tokio_util::sync::CancellationToken;

use crate::env::ExecutionEnv;

/// What a set of rules says about one path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Decision {
    /// A rule excludes the path.
    Ignored,
    /// A `!` rule re-includes the path.
    Whitelisted,
}

/// One parsed `.gitignore` line.
#[derive(Clone)]
struct IgnoreEntry {
    matcher: GlobMatcher,
    /// `true` for a `!` rule.
    whitelist: bool,
    /// `true` for a rule that only matches directories.
    dir_only: bool,
}

/// The rules of a single `.gitignore` file.
#[derive(Clone, Default)]
pub struct IgnoreRules {
    entries: Vec<IgnoreEntry>,
}

impl IgnoreRules {
    /// Parse the content of a `.gitignore` file.
    pub fn parse(content: &str) -> Self {
        let entries = content.lines().filter_map(parse_line).collect();
        Self { entries }
    }

    /// The decision the rules give for `path`, which is relative to the
    /// directory the ignore file lives in.
    fn classify(&self, path: &str, is_dir: bool) -> Option<Decision> {
        // A path under an excluded directory stays excluded: git does not
        // re-include it, so the ancestors are checked first.
        let mut parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
        while parts.len() > 1 {
            parts.pop();
            let ancestor = parts.join("/");
            if self.decide(&ancestor, true) == Some(Decision::Ignored) {
                return Some(Decision::Ignored);
            }
        }
        self.decide(path, is_dir)
    }

    /// The last matching rule wins, as in git.
    fn decide(&self, path: &str, is_dir: bool) -> Option<Decision> {
        let mut decision = None;
        for entry in &self.entries {
            if entry.dir_only && !is_dir {
                continue;
            }
            if entry.matcher.is_match(path) {
                decision = Some(if entry.whitelist {
                    Decision::Whitelisted
                } else {
                    Decision::Ignored
                });
            }
        }
        decision
    }
}

/// Parse one `.gitignore` line into a rule.
fn parse_line(line: &str) -> Option<IgnoreEntry> {
    let mut pattern = line.trim_end();
    if pattern.is_empty() || pattern.starts_with('#') {
        return None;
    }
    let whitelist = if let Some(rest) = pattern.strip_prefix('!') {
        pattern = rest;
        true
    } else {
        false
    };
    let dir_only = if let Some(rest) = pattern.strip_suffix('/') {
        pattern = rest;
        true
    } else {
        false
    };
    // A leading slash, or a slash anywhere in the pattern, anchors it to the
    // ignore file's directory; a plain name matches at any depth.
    let anchored = pattern.starts_with('/') || pattern.contains('/');
    let pattern = pattern.strip_prefix('/').unwrap_or(pattern);
    if pattern.is_empty() {
        return None;
    }
    let glob = if anchored {
        pattern.to_string()
    } else {
        format!("**/{pattern}")
    };
    Some(IgnoreEntry {
        matcher: Glob::new(&glob).ok()?.compile_matcher(),
        whitelist,
        dir_only,
    })
}

/// The ignore rules that apply to a walk, one level per directory that holds
/// a `.gitignore`.
#[derive(Clone, Default)]
pub struct IgnoreContext {
    levels: Vec<(String, IgnoreRules)>,
}

impl IgnoreContext {
    /// The context for a walk that starts at `root`.
    ///
    /// Like ripgrep and fd, the ignore files only count inside a git
    /// repository: outside one the context stays empty.
    pub async fn load(
        env: &Arc<dyn ExecutionEnv>,
        root: &str,
        cancel: Option<&CancellationToken>,
    ) -> Self {
        let mut context = Self::default();
        let Some(repo_root) = find_git_root(env, root, cancel).await else {
            return context;
        };
        for dir in dir_chain(&repo_root, root) {
            context = context.with_dir(env, &dir, cancel).await;
        }
        context
    }

    /// The context for the children of `dir`: the current levels plus the
    /// `.gitignore` of `dir`, if it has one.
    pub async fn with_dir(
        &self,
        env: &Arc<dyn ExecutionEnv>,
        dir: &str,
        cancel: Option<&CancellationToken>,
    ) -> Self {
        let mut context = self.clone();
        let path = format!("{}/.gitignore", dir.trim_end_matches('/'));
        if let Ok(content) = env.read_text_file(&path, cancel).await {
            let rules = IgnoreRules::parse(&content);
            if !rules.entries.is_empty() {
                context.levels.push((dir.trim_end_matches('/').to_string(), rules));
            }
        }
        context
    }

    /// Whether `path` is excluded. The deepest ignore file with a matching
    /// rule wins, as in git.
    pub fn is_ignored(&self, path: &str, is_dir: bool) -> bool {
        for (dir, rules) in self.levels.iter().rev() {
            let Some(relative) = strip_dir_prefix(path, dir) else {
                continue;
            };
            match rules.classify(&relative, is_dir) {
                Some(Decision::Ignored) => return true,
                Some(Decision::Whitelisted) => return false,
                None => {}
            }
        }
        false
    }
}

/// The path of `path` relative to `dir`, or `None` when `path` is not below it.
fn strip_dir_prefix(path: &str, dir: &str) -> Option<String> {
    let dir = dir.trim_end_matches('/');
    if dir.is_empty() {
        return Some(path.to_string());
    }
    path.strip_prefix(dir)
        .and_then(|rest| rest.strip_prefix('/'))
        .map(|rest| rest.to_string())
}

/// Walk up from `start` looking for the `.git` of a repository. Mirrors the
/// repository check ripgrep and fd do before they honour the ignore files.
async fn find_git_root(
    env: &Arc<dyn ExecutionEnv>,
    start: &str,
    cancel: Option<&CancellationToken>,
) -> Option<String> {
    let mut current = start.trim_end_matches('/').to_string();
    loop {
        let git = format!("{current}/.git");
        if env.exists(&git, cancel).await.unwrap_or(false) {
            return Some(current);
        }
        let parent = match current.rfind('/') {
            Some(index) if index > 0 => current[..index].to_string(),
            Some(_) => "/".to_string(),
            None => return None,
        };
        if parent == current {
            return None;
        }
        current = parent;
    }
}

/// The directories from `root` down to `leaf`, `root` first.
fn dir_chain(root: &str, leaf: &str) -> Vec<String> {
    let root = root.trim_end_matches('/');
    let leaf = leaf.trim_end_matches('/');
    let mut chain = Vec::new();
    let mut current = leaf.to_string();
    loop {
        chain.push(current.clone());
        if current == root {
            break;
        }
        let parent = match current.rfind('/') {
            Some(index) if index > 0 => current[..index].to_string(),
            _ => break,
        };
        current = parent;
    }
    chain.reverse();
    chain
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ignored(rules: &IgnoreRules, path: &str, is_dir: bool) -> bool {
        matches!(rules.classify(path, is_dir), Some(Decision::Ignored))
    }

    #[test]
    fn a_plain_name_matches_at_any_depth() {
        let rules = IgnoreRules::parse("node_modules\n");
        assert!(ignored(&rules, "node_modules", true));
        assert!(ignored(&rules, "packages/app/node_modules", true));
        assert!(ignored(&rules, "packages/app/node_modules/lib/index.js", false));
        assert!(!ignored(&rules, "packages/app/src/index.js", false));
    }

    #[test]
    fn an_anchored_name_only_matches_at_the_root() {
        let rules = IgnoreRules::parse("/build\n");
        assert!(ignored(&rules, "build", true));
        assert!(!ignored(&rules, "packages/app/build", true));
    }

    #[test]
    fn a_slash_in_the_pattern_anchors_it() {
        let rules = IgnoreRules::parse("src/generated\n");
        assert!(ignored(&rules, "src/generated", true));
        assert!(!ignored(&rules, "packages/app/src/generated", true));
    }

    #[test]
    fn a_directory_rule_leaves_a_file_of_the_same_name_alone() {
        let rules = IgnoreRules::parse("build/\n");
        assert!(ignored(&rules, "build", true));
        assert!(!ignored(&rules, "build", false));
    }

    #[test]
    fn a_negation_re_includes() {
        let rules = IgnoreRules::parse("*.log\n!keep.log\n");
        assert!(ignored(&rules, "debug.log", false));
        assert!(!ignored(&rules, "keep.log", false));
    }

    #[test]
    fn the_last_matching_rule_wins() {
        let rules = IgnoreRules::parse("*.log\n!keep.log\nkeep.log\n");
        assert!(ignored(&rules, "keep.log", false));
    }

    #[test]
    fn comments_and_blank_lines_are_skipped() {
        let rules = IgnoreRules::parse("# a comment\n\n   \n");
        assert!(rules.entries.is_empty());
    }

    #[test]
    fn a_path_under_an_excluded_directory_stays_excluded() {
        let rules = IgnoreRules::parse("dist\n");
        assert!(ignored(&rules, "dist/app/main.js", false));
    }

    #[test]
    fn the_deepest_ignore_file_wins() {
        let mut context = IgnoreContext::default();
        context.levels.push((
            "/repo".to_string(),
            IgnoreRules::parse("*.log\n"),
        ));
        context.levels.push((
            "/repo/sub".to_string(),
            IgnoreRules::parse("!keep.log\n"),
        ));
        assert!(context.is_ignored("/repo/other.log", false));
        assert!(!context.is_ignored("/repo/sub/keep.log", false));
        assert!(context.is_ignored("/repo/sub/other.log", false));
    }

    #[test]
    fn the_chain_runs_from_the_root_down_to_the_leaf() {
        let chain = dir_chain("/repo", "/repo/a/b");
        assert_eq!(chain, vec!["/repo", "/repo/a", "/repo/a/b"]);
    }
}
