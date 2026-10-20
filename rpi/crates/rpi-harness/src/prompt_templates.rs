//! Mirrors `packages/agent/src/harness/prompt-templates.ts` — markdown
//! template loading + argument substitution + invocation formatting.
//!
//! Loads `.md` files (non-recursively from directories; explicit files),
//! parses YAML frontmatter for an optional `description` (falling back to the
//! first non-blank body line, truncated at 60 chars + `...`), and substitutes
//! positional argument placeholders (`$N`, `$ARGUMENTS`, `$@`, `${@:N}`,
//! `${@:N:L}`) via [`substitute_args`].
//!
//! The TS `yaml` parse is replaced by the shared minimal YAML-subset parser
//! ([`crate::frontmatter::parse_frontmatter`]); see the initial port notes (retired).

use std::sync::Arc;

use rpi_tools::env::{ExecutionEnv, FileKind};
use tokio_util::sync::CancellationToken;

use crate::frontmatter::parse_frontmatter;
use crate::types::PromptTemplate;

/// Stable diagnostic codes. Mirrors TS `PromptTemplateDiagnosticCode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptTemplateDiagnosticCode {
    FileInfoFailed,
    ListFailed,
    ReadFailed,
    ParseFailed,
}

impl PromptTemplateDiagnosticCode {
    pub fn as_str(self) -> &'static str {
        match self {
            PromptTemplateDiagnosticCode::FileInfoFailed => "file_info_failed",
            PromptTemplateDiagnosticCode::ListFailed => "list_failed",
            PromptTemplateDiagnosticCode::ReadFailed => "read_failed",
            PromptTemplateDiagnosticCode::ParseFailed => "parse_failed",
        }
    }
}

/// Warning produced while loading prompt templates. Mirrors TS
/// `PromptTemplateDiagnostic`.
#[derive(Debug, Clone, PartialEq)]
pub struct PromptTemplateDiagnostic {
    pub code: PromptTemplateDiagnosticCode,
    pub message: String,
    pub path: String,
}

/// Result of loading prompt templates. Mirrors the TS `loadPromptTemplates`
/// return shape.
#[derive(Debug, Clone, Default)]
pub struct LoadPromptTemplatesResult {
    pub prompt_templates: Vec<PromptTemplate>,
    pub diagnostics: Vec<PromptTemplateDiagnostic>,
    /// Structured winner/loser collision diagnostics (native
    /// `ResourceDiagnostic`).
    pub resource_diagnostics: Vec<crate::diagnostics::ResourceDiagnostic>,
}

/// Load prompt templates from one or more paths. Mirrors TS `loadPromptTemplates`.
///
/// Directory inputs load direct `.md` children non-recursively. File inputs
/// load explicit `.md` files. Missing paths (`not_found`) are skipped silently;
/// other `fileInfo`/list/read/parse failures become diagnostics.
pub async fn load_prompt_templates(
    env: &Arc<dyn ExecutionEnv>,
    paths: &[String],
) -> LoadPromptTemplatesResult {
    let mut prompt_templates = Vec::new();
    let mut diagnostics = Vec::new();
    for path in paths {
        let cancel = CancellationToken::new();
        let info = match env.file_info(path, Some(&cancel)).await {
            Ok(i) => i,
            Err(e) => {
                if e.code != rpi_tools::FileErrorCode::NotFound {
                    diagnostics.push(PromptTemplateDiagnostic {
                        code: PromptTemplateDiagnosticCode::FileInfoFailed,
                        message: e.message,
                        path: path.clone(),
                    });
                }
                continue;
            }
        };
        let kind = resolve_kind(env, &info, &mut diagnostics, &cancel).await;
        if kind == Some(FileKind::Directory) {
            let mut result = load_templates_from_dir(env, &info.path.to_string_lossy()).await;
            prompt_templates.append(&mut result.prompt_templates);
            diagnostics.append(&mut result.diagnostics);
        } else if kind == Some(FileKind::File) && info.name.ends_with(".md") {
            let mut result =
                load_template_from_file(env, &info.path.to_string_lossy(), &info.name).await;
            if let Some(t) = result.template.take() {
                prompt_templates.push(t);
            }
            diagnostics.append(&mut result.diagnostics);
        }
    }
    LoadPromptTemplatesResult {
        prompt_templates,
        diagnostics,
        ..Default::default()
    }
}

/// Load prompt templates from source-tagged paths. Mirrors TS
/// `loadSourcedPromptTemplates`. `S` is the caller-owned provenance type.
pub async fn load_sourced_prompt_templates<S: Clone>(
    env: &Arc<dyn ExecutionEnv>,
    inputs: &[SourcedTemplateInput<S>],
) -> SourcedLoadTemplatesResult<S> {
    let mut templates: Vec<SourcedTemplate<S>> = Vec::new();
    let mut diagnostics: Vec<SourcedTemplateDiagnostic<S>> = Vec::new();
    for input in inputs {
        let result = load_prompt_templates(env, std::slice::from_ref(&input.path)).await;
        for t in result.prompt_templates {
            templates.push(SourcedTemplate {
                template: t,
                source: input.source.clone(),
            });
        }
        for d in result.diagnostics {
            diagnostics.push(SourcedTemplateDiagnostic {
                diagnostic: d,
                source: input.source.clone(),
            });
        }
    }
    SourcedLoadTemplatesResult {
        templates,
        diagnostics,
    }
}

/// One source-tagged input. Mirrors TS `{ path: string; source: TSource }`.
#[derive(Debug, Clone)]
pub struct SourcedTemplateInput<S> {
    pub path: String,
    pub source: S,
}

/// A template paired with its source. Mirrors TS `{ promptTemplate, source }`.
#[derive(Debug, Clone)]
pub struct SourcedTemplate<S> {
    pub template: PromptTemplate,
    pub source: S,
}

/// A diagnostic paired with its source.
#[derive(Debug, Clone)]
pub struct SourcedTemplateDiagnostic<S> {
    pub diagnostic: PromptTemplateDiagnostic,
    pub source: S,
}

/// Result of `load_sourced_prompt_templates`.
#[derive(Debug, Clone, Default)]
pub struct SourcedLoadTemplatesResult<S> {
    pub templates: Vec<SourcedTemplate<S>>,
    pub diagnostics: Vec<SourcedTemplateDiagnostic<S>>,
}

async fn load_templates_from_dir(
    env: &Arc<dyn ExecutionEnv>,
    dir: &str,
) -> LoadPromptTemplatesResult {
    let mut prompt_templates = Vec::new();
    let mut diagnostics = Vec::new();
    let cancel = CancellationToken::new();
    let entries = match env.list_dir(dir, Some(&cancel)).await {
        Ok(e) => e,
        Err(e) => {
            diagnostics.push(PromptTemplateDiagnostic {
                code: PromptTemplateDiagnosticCode::ListFailed,
                message: e.message,
                path: dir.to_string(),
            });
            return LoadPromptTemplatesResult {
                prompt_templates,
                diagnostics,
                ..Default::default()
            };
        }
    };

    let mut sorted: Vec<_> = entries.iter().collect();
    sorted.sort_by(|a, b| a.name.cmp(&b.name));
    for entry in sorted {
        let kind = resolve_kind(env, entry, &mut diagnostics, &cancel).await;
        if kind != Some(FileKind::File) || !entry.name.ends_with(".md") {
            continue;
        }
        let mut result =
            load_template_from_file(env, &entry.path.to_string_lossy(), &entry.name).await;
        if let Some(t) = result.template.take() {
            prompt_templates.push(t);
        }
        diagnostics.append(&mut result.diagnostics);
    }
    LoadPromptTemplatesResult {
        prompt_templates,
        diagnostics,
        ..Default::default()
    }
}

struct LoadTemplateResult {
    template: Option<PromptTemplate>,
    diagnostics: Vec<PromptTemplateDiagnostic>,
}

async fn load_template_from_file(
    env: &Arc<dyn ExecutionEnv>,
    file_path: &str,
    file_name: &str,
) -> LoadTemplateResult {
    let mut diagnostics = Vec::new();
    let cancel = CancellationToken::new();
    let raw = match env.read_text_file(file_path, Some(&cancel)).await {
        Ok(s) => s,
        Err(e) => {
            diagnostics.push(PromptTemplateDiagnostic {
                code: PromptTemplateDiagnosticCode::ReadFailed,
                message: e.message,
                path: file_path.to_string(),
            });
            return LoadTemplateResult {
                template: None,
                diagnostics,
            };
        }
    };

    let (frontmatter, body) = match parse_frontmatter(&raw) {
        Ok(v) => v,
        Err(msg) => {
            diagnostics.push(PromptTemplateDiagnostic {
                code: PromptTemplateDiagnosticCode::ParseFailed,
                message: msg,
                path: file_path.to_string(),
            });
            return LoadTemplateResult {
                template: None,
                diagnostics,
            };
        }
    };

    // First non-blank body line (for description fallback).
    let first_line = body
        .lines()
        .find(|l| !l.trim().is_empty())
        .map(|s| s.to_string());
    let description = frontmatter
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            first_line.as_ref().map(|fl| {
                if fl.chars().count() > 60 {
                    let mut s: String = fl.chars().take(60).collect();
                    s.push_str("...");
                    s
                } else {
                    fl.clone()
                }
            })
        });

    let argument_hint = frontmatter
        .get("argument-hint")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    LoadTemplateResult {
        template: Some(PromptTemplate {
            // Mirrors TS `fileName.replace(/\.md$/i, "")` — a single
            // case-insensitive trailing `.md` strip. `ends_with(".md")` (case-
            // sensitive) gates entry above, so the case-insensitivity is moot in
            // practice; `strip_suffix` strips at most one occurrence (the TS
            // single-replace, NOT `trim_end_matches`'s repeated strip).
            name: file_name
                .strip_suffix(".md")
                .or_else(|| file_name.strip_suffix(".MD"))
                .unwrap_or(file_name)
                .to_string(),
            description,
            argument_hint,
            content: body,
            file_path: Some(file_path.to_string()),
        }),
        diagnostics,
    }
}

async fn resolve_kind(
    env: &Arc<dyn ExecutionEnv>,
    info: &rpi_tools::env::FileInfo,
    diagnostics: &mut Vec<PromptTemplateDiagnostic>,
    cancel: &CancellationToken,
) -> Option<FileKind> {
    if matches!(info.kind, FileKind::File | FileKind::Directory) {
        return Some(info.kind);
    }
    match env
        .canonical_path(&info.path.to_string_lossy(), Some(cancel))
        .await
    {
        Ok(canon) => match env.file_info(&canon.to_string_lossy(), Some(cancel)).await {
            Ok(target) => {
                if matches!(target.kind, FileKind::File | FileKind::Directory) {
                    Some(target.kind)
                } else {
                    None
                }
            }
            Err(e) => {
                if e.code != rpi_tools::FileErrorCode::NotFound {
                    diagnostics.push(PromptTemplateDiagnostic {
                        code: PromptTemplateDiagnosticCode::FileInfoFailed,
                        message: e.message,
                        path: info.path.to_string_lossy().to_string(),
                    });
                }
                None
            }
        },
        Err(e) => {
            if e.code != rpi_tools::FileErrorCode::NotFound {
                diagnostics.push(PromptTemplateDiagnostic {
                    code: PromptTemplateDiagnosticCode::FileInfoFailed,
                    message: e.message,
                    path: info.path.to_string_lossy().to_string(),
                });
            }
            None
        }
    }
}

/// Parse an argument string using simple shell-style single and double quotes.
/// Mirrors TS `parseCommandArgs`.
pub fn parse_command_args(args_string: &str) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut has_token = false;
    let mut in_quote: Option<char> = None;

    for ch in args_string.chars() {
        if let Some(q) = in_quote {
            if ch == q {
                in_quote = None;
            } else {
                current.push(ch);
            }
        } else if ch == '"' || ch == '\'' {
            in_quote = Some(ch);
            has_token = true;
        } else if ch.is_whitespace() {
            if has_token {
                args.push(std::mem::take(&mut current));
                has_token = false;
            }
        } else {
            current.push(ch);
            has_token = true;
        }
    }
    if has_token {
        args.push(current);
    }
    args
}

/// Substitute prompt-template placeholders with command arguments. Mirrors TS
/// `substituteArgs`.
///
/// The original scans the template once with
/// `/\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g`,
/// so the first alternative that matches at a position wins and the expanded
/// value is never re-scanned. The port reproduces that scan exactly:
///
/// - `${N:-default}` → `args[N-1]`, or `default` when it is missing/empty.
/// - `${@:-default}` / `${ARGUMENTS:-default}` → all args, or `default` when
///   they are empty.
/// - `${@:N}` → `args[N-1..].join(" ")`.
/// - `${@:N:L}` → `args[N-1..N-1+L].join(" ")`.
/// - `$N` → `args[N-1]` (empty when out of range).
/// - `$ARGUMENTS` / `$@` → `args.join(" ")`.
pub fn substitute_args(content: &str, args: &[String]) -> String {
    let all_args = args.join(" ");
    let chars: Vec<char> = content.chars().collect();
    let mut out = String::with_capacity(content.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] != '$' {
            out.push(chars[i]);
            i += 1;
            continue;
        }
        if let Some((replacement, next)) = match_default_form(&chars, i, args, &all_args) {
            out.push_str(&replacement);
            i = next;
            continue;
        }
        if let Some((replacement, next)) = match_slice_form(&chars, i, args) {
            out.push_str(&replacement);
            i = next;
            continue;
        }
        if let Some((replacement, next)) = match_simple_form(&chars, i, args, &all_args) {
            out.push_str(&replacement);
            i = next;
            continue;
        }
        out.push('$');
        i += 1;
    }
    out
}

/// `${<target>:-<default>}` — the first alternative of the original's regex.
fn match_default_form(
    chars: &[char],
    start: usize,
    args: &[String],
    all_args: &str,
) -> Option<(String, usize)> {
    if chars.get(start + 1) != Some(&'{') {
        return None;
    }
    let mut i = start + 2;
    let target_start = i;
    while i < chars.len() && chars[i].is_ascii_digit() {
        i += 1;
    }
    let target: String = if i > target_start {
        chars[target_start..i].iter().collect()
    } else if chars[i..].starts_with(&['A', 'R', 'G', 'U', 'M', 'E', 'N', 'T', 'S']) {
        i += 9;
        "ARGUMENTS".to_string()
    } else if chars.get(i) == Some(&'@') {
        i += 1;
        "@".to_string()
    } else {
        return None;
    };
    if chars.get(i) != Some(&':') || chars.get(i + 1) != Some(&'-') {
        return None;
    }
    i += 2;
    let default_start = i;
    while i < chars.len() && chars[i] != '}' {
        i += 1;
    }
    if chars.get(i) != Some(&'}') {
        return None;
    }
    let default_value: String = chars[default_start..i].iter().collect();
    let value = if target == "@" || target == "ARGUMENTS" {
        Some(all_args.to_string())
    } else {
        target
            .parse::<usize>()
            .ok()
            .and_then(|n| n.checked_sub(1))
            .and_then(|idx| args.get(idx))
            .cloned()
    };
    let replacement = match value {
        Some(v) if !v.is_empty() => v,
        _ => default_value,
    };
    Some((replacement, i + 1))
}

/// `${@:N}` / `${@:N:L}` — the second alternative of the original's regex.
fn match_slice_form(chars: &[char], start: usize, args: &[String]) -> Option<(String, usize)> {
    if chars.get(start + 1) != Some(&'{') || chars.get(start + 2) != Some(&'@') {
        return None;
    }
    if chars.get(start + 3) != Some(&':') {
        return None;
    }
    let mut i = start + 4;
    let digits_start = i;
    while i < chars.len() && chars[i].is_ascii_digit() {
        i += 1;
    }
    if i == digits_start {
        return None;
    }
    let first: usize = chars[digits_start..i]
        .iter()
        .collect::<String>()
        .parse()
        .unwrap_or(0);
    let mut length: Option<usize> = None;
    if chars.get(i) == Some(&':') {
        let length_start = i + 1;
        let mut j = length_start;
        while j < chars.len() && chars[j].is_ascii_digit() {
            j += 1;
        }
        if j == length_start {
            return None;
        }
        length = Some(
            chars[length_start..j]
                .iter()
                .collect::<String>()
                .parse()
                .unwrap_or(0),
        );
        i = j;
    }
    if chars.get(i) != Some(&'}') {
        return None;
    }
    let from = first.saturating_sub(1);
    let slice = match length {
        Some(len) => {
            let end = from.saturating_add(len).min(args.len());
            &args[from.min(args.len())..end]
        }
        None => {
            if from >= args.len() {
                &args[args.len()..]
            } else {
                &args[from..]
            }
        }
    };
    Some((slice.join(" "), i + 1))
}

/// `$ARGUMENTS` / `$@` / `$N` — the third alternative of the original's regex.
fn match_simple_form(
    chars: &[char],
    start: usize,
    args: &[String],
    all_args: &str,
) -> Option<(String, usize)> {
    if chars.get(start + 1) == Some(&'@') {
        return Some((all_args.to_string(), start + 2));
    }
    if chars[start + 1..].starts_with(&['A', 'R', 'G', 'U', 'M', 'E', 'N', 'T', 'S']) {
        return Some((all_args.to_string(), start + 10));
    }
    let mut i = start + 1;
    while i < chars.len() && chars[i].is_ascii_digit() {
        i += 1;
    }
    if i == start + 1 {
        return None;
    }
    let digits: String = chars[start + 1..i].iter().collect();
    let index = digits.parse::<usize>().ok().and_then(|n| n.checked_sub(1));
    let value = index.and_then(|idx| args.get(idx)).cloned().unwrap_or_default();
    Some((value, i))
}

/// Format a prompt-template invocation with positional arguments. Mirrors TS
/// `formatPromptTemplateInvocation`.
pub fn format_prompt_template_invocation(template: &PromptTemplate, args: &[String]) -> String {
    substitute_args(&template.content, args)
}

/// Expand a prompt template when the text names one. Mirrors TS
/// `expandPromptTemplate`.
///
/// The text must start with `/`; the first whitespace-delimited token is the
/// template name and the rest are the arguments. When no template matches, the
/// text is returned unchanged.
pub fn expand_prompt_template(text: &str, templates: &[PromptTemplate]) -> String {
    if !text.starts_with('/') {
        return text.to_string();
    }
    let rest = &text[1..];
    let name_end = rest.find(char::is_whitespace).unwrap_or(rest.len());
    let name = &rest[..name_end];
    if name.is_empty() {
        return text.to_string();
    }
    let args_string = rest[name_end..].trim_start();
    let Some(template) = templates.iter().find(|t| t.name == name) else {
        return text.to_string();
    };
    let args = parse_command_args(args_string);
    substitute_args(&template.content, &args)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_command_args_shell_style() {
        assert_eq!(parse_command_args("a b c"), vec!["a", "b", "c"]);
        assert_eq!(
            parse_command_args("'hello world' test"),
            vec!["hello world", "test"]
        );
        // Double quotes: the TS parser does NOT interpret backslash escapes, so
        // a `"` always toggles the quote state. `"a b"` -> ["a b"].
        assert_eq!(parse_command_args("\"a b\" c"), vec!["a b", "c"]);
        // A quote that opens then closes then re-opens collapses the gaps:
        // `"a"b"c"` -> a, b, c joined with no spaces => ["abc"].
        assert_eq!(parse_command_args("\"a\"b\"c\""), vec!["abc"]);
        assert_eq!(
            parse_command_args("  multi   space  "),
            vec!["multi", "space"]
        );
        assert_eq!(parse_command_args(""), Vec::<String>::new());
    }

    #[test]
    fn substitute_args_all_forms() {
        let args = vec!["hello".to_string(), "world".to_string(), "test".to_string()];
        assert_eq!(substitute_args("$1", &args), "hello");
        assert_eq!(substitute_args("$2 $3", &args), "world test");
        assert_eq!(substitute_args("${@:2}", &args), "world test");
        assert_eq!(substitute_args("${@:1:2}", &args), "hello world");
        assert_eq!(substitute_args("$ARGUMENTS", &args), "hello world test");
        assert_eq!(substitute_args("$@", &args), "hello world test");
        // Out-of-range $N → empty.
        assert_eq!(substitute_args("$9", &args), "");
        // $0 → empty (TS: args[-1] ?? "").
        assert_eq!(substitute_args("$0", &args), "");
    }

    #[test]
    fn substitute_args_does_not_re_expand() {
        // `$ARGUMENTS` expansion should not be re-scanned for `$N`. Here the
        // args contain a literal `$1` that must survive intact.
        let args = vec!["$1".to_string()];
        assert_eq!(substitute_args("$ARGUMENTS", &args), "$1");
    }

    #[test]
    fn substitute_args_empty_args_join() {
        let args: Vec<String> = Vec::new();
        assert_eq!(substitute_args("$1 $@", &args), " ");
        // `$1` → "" ; `$@` → "" ; joined by the literal space in the template.
    }

    #[test]
    fn format_invocation_substitutes() {
        let t = PromptTemplate {
            name: "one".to_string(),
            description: None,
            argument_hint: None,
            content: "$1 ${@:2} $ARGUMENTS".to_string(),
            file_path: None,
        };
        let out =
            format_prompt_template_invocation(&t, &["hello world".to_string(), "test".to_string()]);
        assert_eq!(out, "hello world test hello world test");
    }

    #[test]
    fn template_name_strips_md_extension() {
        // Mirrors TS `fileName.replace(/\.md$/i, "")` — single (not repeated)
        // case-insensitive trailing `.md` strip.
        assert_eq!(strip_md("foo.md"), "foo");
        assert_eq!(strip_md("foo.MD"), "foo");
        assert_eq!(strip_md("foo"), "foo");
        assert_eq!(strip_md("foo.md.md"), "foo.md"); // single replace, not trim_end
    }

    fn strip_md(name: &str) -> &str {
        name.strip_suffix(".md")
            .or_else(|| name.strip_suffix(".MD"))
            .unwrap_or(name)
    }
}
