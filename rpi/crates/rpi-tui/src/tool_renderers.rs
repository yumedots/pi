//! Per-tool renderers — the Rust port of the TypeScript renderers in
//! `packages/coding-agent/src/core/tools/renderers/`.
//!
//! Upstream lets a tool definition carry a `renderCall` / `renderResult`
//! pair: the tool panel draws the call header and the result body with it and
//! falls back to a generic name+args panel for a tool that has none. This
//! module holds the built-in renderers for the tools the Rust port ships
//! (`read`, `write`, `bash`, `grep`, `find`, `ls`, `edit`) and the registry
//! that maps a tool name to its renderer.

use crate::ansi::bold;
use crate::keybinding_hints::key_text;
use crate::syntax_highlight::Highlighter;
use crate::theme::{Theme, ThemeColors};
use crate::visual_truncate::truncate_to_visual_lines;

/// Default byte limit of a tool result. Mirrors TS `DEFAULT_MAX_BYTES`.
const DEFAULT_MAX_BYTES: u64 = 50 * 1024;

/// Default line limit of a tool result. Mirrors TS `DEFAULT_MAX_LINES`.
const DEFAULT_MAX_LINES: u64 = 2000;

/// Collapsed preview of a bash result, in visual lines. Mirrors TS
/// `BASH_PREVIEW_LINES`.
const BASH_PREVIEW_LINES: usize = 5;

/// File names that upstream renders as a compact "read resource" call.
const COMPACT_RESOURCE_FILE_NAMES: [&str; 5] = [
    "AGENTS.override.md",
    "AGENTS.md",
    "AGENTS.MD",
    "CLAUDE.md",
    "CLAUDE.MD",
];

/// Everything a renderer needs to draw one tool call.
pub struct ToolRenderContext<'a> {
    /// The tool call arguments, as raw JSON.
    pub args: &'a str,
    /// The tool result text, when the tool already produced one.
    pub result: Option<&'a str>,
    /// Whether the result is an error.
    pub is_error: bool,
    /// Whether the tool result is still streaming.
    pub is_partial: bool,
    /// Whether the panel is expanded.
    pub expanded: bool,
    /// The session working directory, used to resolve relative paths.
    pub cwd: &'a str,
    /// The width the result body is rendered at, in columns.
    pub width: usize,
    /// How long the tool ran, in milliseconds.
    pub duration_ms: Option<u64>,
    /// The tool result details, as raw JSON.
    pub details: Option<&'a str>,
}

/// A tool's presentation: the call header and the result body.
///
/// Both methods return the plain text of the block; the tool panel wraps it
/// and paints the panel background, the way upstream's `Text` children sit
/// inside the tool panel's box.
pub trait ToolRenderer: Send + Sync {
    /// The call header — the tool name and its arguments.
    fn render_call(&self, ctx: &ToolRenderContext<'_>, theme: &Theme) -> String;

    /// The result body. An empty string draws nothing.
    fn render_result(&self, ctx: &ToolRenderContext<'_>, theme: &Theme) -> String;
}

/// The built-in renderer of a tool name, mirroring upstream's
/// `withBuiltInRenderers`. `None` means the tool has no renderer and the
/// panel draws its generic name+args block.
pub fn builtin_renderer(tool_name: &str) -> Option<Box<dyn ToolRenderer>> {
    match tool_name {
        "read" => Some(Box::new(ReadRenderer)),
        "write" => Some(Box::new(WriteRenderer)),
        "bash" | "powershell" => Some(Box::new(ShellRenderer {
            prompt: if tool_name == "powershell" { "PS>" } else { "$" },
        })),
        "grep" => Some(Box::new(GrepRenderer)),
        "find" => Some(Box::new(FindRenderer)),
        "ls" => Some(Box::new(LsRenderer)),
        "edit" => Some(Box::new(EditRenderer)),
        _ => None,
    }
}

// -- shared helpers ---------------------------------------------------------

/// A tool argument as upstream's `str()` sees it: a string, a missing value
/// (which upstream renders as an empty string) or a value of the wrong type
/// (which upstream renders as `[invalid arg]`).
enum TsStr {
    Missing,
    Text(String),
    Invalid,
}

impl TsStr {
    /// The upstream `str()` result: `None` is the "invalid" case.
    fn as_text(&self) -> Option<String> {
        match self {
            TsStr::Missing => Some(String::new()),
            TsStr::Text(text) => Some(text.clone()),
            TsStr::Invalid => None,
        }
    }
}

fn ts_str_value(value: Option<&json::Value>) -> TsStr {
    match value {
        None | Some(json::Value::Null) => TsStr::Missing,
        Some(json::Value::Str(text)) => TsStr::Text(text.clone()),
        Some(_) => TsStr::Invalid,
    }
}

/// The tool call arguments, parsed.
struct Args {
    value: Option<json::Value>,
}

impl Args {
    fn new(text: &str) -> Args {
        Args {
            value: json::parse(text),
        }
    }

    fn get(&self, key: &str) -> Option<&json::Value> {
        self.value.as_ref().and_then(|value| value.get(key))
    }

    fn ts_str(&self, key: &str) -> TsStr {
        ts_str_value(self.get(key))
    }

    /// The path of the file the tool works on: `file_path ?? path`.
    fn path(&self) -> TsStr {
        let file_path = self.ts_str("file_path");
        if matches!(file_path, TsStr::Missing) {
            self.ts_str("path")
        } else {
            file_path
        }
    }

    /// A numeric argument, accepting the numeric strings upstream accepts.
    fn number(&self, key: &str) -> Option<f64> {
        match self.get(key)? {
            json::Value::Num(number) => Some(*number),
            json::Value::Str(text) => text.trim().parse::<f64>().ok(),
            _ => None,
        }
    }
}

/// Upstream's `[invalid arg]` marker.
fn invalid_arg(theme: &Theme) -> String {
    theme.colors.error.fg("[invalid arg]")
}

/// Upstream's `keyHint("app.tools.expand", "to expand")`.
fn expand_hint(theme: &Theme) -> String {
    format!(
        "{}{}",
        theme.colors.dim.fg(&key_text("app.tools.expand")),
        theme.colors.muted.fg(" to expand")
    )
}

/// Upstream's `renderToolPath`: the accent-coloured path, `...` for an empty
/// path and `[invalid arg]` for a path that is not a string.
fn render_tool_path(
    raw_path: Option<String>,
    theme: &Theme,
    empty_fallback: Option<&str>,
) -> String {
    let Some(raw_path) = raw_path else {
        return invalid_arg(theme);
    };
    let value = if raw_path.is_empty() {
        empty_fallback.unwrap_or("")
    } else {
        raw_path.as_str()
    };
    if value.is_empty() {
        return theme.colors.tool_output.fg("...");
    }
    theme.colors.accent.fg(&shorten_path(value))
}

/// Upstream's `shortenPath`: the home directory becomes `~`.
fn shorten_path(path: &str) -> String {
    let home = home_dir();
    if !home.is_empty() && path.starts_with(&home) {
        return format!("~{}", &path[home.len()..]);
    }
    path.to_string()
}

/// The home directory of the current user.
fn home_dir() -> String {
    std::env::var("HOME").unwrap_or_default()
}

/// Upstream's `replaceTabs`: a tab becomes three spaces.
fn replace_tabs(text: &str) -> String {
    text.replace('\t', "   ")
}

/// Upstream's `normalizeDisplayText`: carriage returns are dropped.
fn normalize_display_text(text: &str) -> String {
    text.replace('\r', "")
}

/// Drop the trailing empty lines of a block.
fn trim_trailing_empty_lines(lines: Vec<String>) -> Vec<String> {
    let mut end = lines.len();
    while end > 0 && lines[end - 1].is_empty() {
        end -= 1;
    }
    lines.into_iter().take(end).collect()
}

/// Upstream's `formatSize`.
fn format_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{bytes}B")
    } else if bytes < 1024 * 1024 {
        format!("{:.1}KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1}MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

/// Upstream's `formatToolDuration`.
fn format_tool_duration(ms: u64) -> String {
    let seconds = ms as f64 / 1000.0;
    if seconds < 60.0 {
        return format!("{seconds:.1}s");
    }
    let total_seconds = seconds.floor() as u64;
    let minutes = total_seconds / 60;
    let remainder = total_seconds % 60;
    if minutes < 60 {
        return format!("{minutes}m {remainder}s");
    }
    format!("{}h {}m {}s", minutes / 60, minutes % 60, remainder)
}

/// Upstream's `getLanguageFromPath`: the language of a file, by extension.
fn get_language_from_path(path: &str) -> Option<String> {
    let ext = path.rsplit('.').next()?.to_lowercase();
    let language = match ext.as_str() {
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "py" => "python",
        "rb" => "ruby",
        "rs" => "rust",
        "go" => "go",
        "java" => "java",
        "kt" => "kotlin",
        "swift" => "swift",
        "c" | "h" => "c",
        "cpp" | "cc" | "cxx" | "hpp" => "cpp",
        "cs" => "csharp",
        "php" => "php",
        "sh" | "bash" | "zsh" => "bash",
        "fish" => "fish",
        "ps1" => "powershell",
        "sql" => "sql",
        "html" | "htm" => "html",
        "css" => "css",
        "scss" | "sass" => "scss",
        "less" => "less",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "md" | "markdown" => "markdown",
        "xml" => "xml",
        _ => return None,
    };
    Some(language.to_string())
}

/// Highlight a block of code, the way upstream's `highlightCode` does.
fn highlight_lines(code: &str, language: &str, colors: &ThemeColors) -> Vec<String> {
    let mut highlighter = Highlighter::new(language);
    code.split('\n')
        .map(|line| highlighter.highlight(line, colors))
        .collect()
}

/// The number of a numeric argument, formatted the way JavaScript prints it.
fn format_number(number: f64) -> String {
    if number.fract() == 0.0 && number.abs() < 1e15 {
        format!("{}", number as i64)
    } else {
        format!("{number}")
    }
}

/// The basename of a path.
fn basename(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rsplit_once('/') {
        Some((_, name)) => name.to_string(),
        None => trimmed.to_string(),
    }
}

/// The directory of a path.
fn dirname(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rsplit_once('/') {
        Some((dir, _)) => {
            if dir.is_empty() {
                "/".to_string()
            } else {
                dir.to_string()
            }
        }
        None => String::new(),
    }
}

/// Resolve a path against the working directory, the way upstream's
/// `resolveToCwd` does.
fn resolve_to_cwd(path: &str, cwd: &str) -> String {
    let expanded = if let Some(rest) = path.strip_prefix('~') {
        if rest.is_empty() || rest.starts_with('/') {
            format!("{}{}", home_dir(), rest)
        } else {
            path.to_string()
        }
    } else {
        path.to_string()
    };
    if expanded.starts_with('/') {
        normalize_path(&expanded)
    } else {
        normalize_path(&format!("{}/{}", cwd.trim_end_matches('/'), expanded))
    }
}

/// Collapse `.` and `..` segments of a path.
fn normalize_path(path: &str) -> String {
    let mut segments: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            other => segments.push(other),
        }
    }
    if path.starts_with('/') {
        format!("/{}", segments.join("/"))
    } else {
        segments.join("/")
    }
}

/// The path relative to the working directory, or the absolute path when the
/// file lives outside it. Upstream's `formatPathRelativeToCwdOrAbsolute`.
fn format_path_relative_to_cwd_or_absolute(absolute: &str, cwd: &str) -> String {
    let cwd = cwd.trim_end_matches('/');
    if !cwd.is_empty() {
        if let Some(rest) = absolute.strip_prefix(&format!("{cwd}/")) {
            return rest.to_string();
        }
    }
    absolute.to_string()
}

// -- the read tool ----------------------------------------------------------

/// Upstream's `formatReadLineRange`: the `:start` / `:start-end` suffix.
fn format_read_line_range(offset: Option<f64>, limit: Option<f64>) -> String {
    if offset.is_none() && limit.is_none() {
        return String::new();
    }
    let start = match offset {
        Some(offset) => offset,
        None => 1.0,
    };
    if !start.is_finite() {
        return String::new();
    }
    let Some(limit) = limit else {
        return format!(":{}", format_number(start));
    };
    if !limit.is_finite() {
        return String::new();
    }
    let end = start + limit - 1.0;
    if end == 0.0 {
        format!(":{}", format_number(start))
    } else {
        format!(":{}-{}", format_number(start), format_number(end))
    }
}

/// The read line range, in the warning colour.
fn styled_read_line_range(args: &Args, theme: &Theme) -> String {
    let range = format_read_line_range(args.number("offset"), args.number("limit"));
    if range.is_empty() {
        String::new()
    } else {
        theme.colors.warning.fg(&range)
    }
}

/// The kind of a compact read call.
enum CompactKind {
    Resource,
    Skill,
}

/// A compact read call — a file upstream shows in a shortened form.
struct CompactRead {
    kind: CompactKind,
    label: String,
}

/// Classify a read the way upstream's `getCompactReadClassification` does.
///
/// Upstream also classifies reads of its own package documentation; the Rust
/// port has no package root to compare against, so only the skill and the
/// resource files are classified.
fn compact_read_classification(args: &Args, cwd: &str) -> Option<CompactRead> {
    let raw_path = args.path().as_text()?;
    if raw_path.is_empty() {
        return None;
    }
    let absolute = resolve_to_cwd(&raw_path, cwd);
    let file_name = basename(&absolute);
    if file_name == "SKILL.md" {
        let parent = basename(&dirname(&absolute));
        let label = if parent.is_empty() {
            file_name
        } else {
            parent
        };
        return Some(CompactRead {
            kind: CompactKind::Skill,
            label,
        });
    }
    if COMPACT_RESOURCE_FILE_NAMES.contains(&file_name.as_str()) {
        return Some(CompactRead {
            kind: CompactKind::Resource,
            label: format_path_relative_to_cwd_or_absolute(&absolute, cwd),
        });
    }
    None
}

/// The compact read call header.
fn format_compact_read_call(compact: &CompactRead, args: &Args, theme: &Theme) -> String {
    let range = styled_read_line_range(args, theme);
    let expand = theme
        .colors
        .dim
        .fg(&format!(" ({} to expand)", key_text("app.tools.expand")));
    match compact.kind {
        CompactKind::Skill => format!(
            "{}{}{}",
            theme
                .colors
                .custom_message_label
                .fg(&bold(&format!("@{}", compact.label))),
            range,
            expand
        ),
        CompactKind::Resource => format!(
            "{} {}{}{}",
            theme.colors.tool_title.fg(&bold("read resource")),
            theme.colors.accent.fg(&compact.label),
            range,
            expand
        ),
    }
}

/// The `read` tool.
struct ReadRenderer;

impl ToolRenderer for ReadRenderer {
    fn render_call(&self, ctx: &ToolRenderContext<'_>, theme: &Theme) -> String {
        let args = Args::new(ctx.args);
        if !ctx.expanded {
            if let Some(compact) = compact_read_classification(&args, ctx.cwd) {
                return format_compact_read_call(&compact, &args, theme);
            }
        }
        let path = render_tool_path(args.path().as_text(), theme, None);
        format!(
            "{} {}{}",
            theme.colors.tool_title.fg(&bold("read")),
            path,
            styled_read_line_range(&args, theme)
        )
    }

    fn render_result(&self, ctx: &ToolRenderContext<'_>, theme: &Theme) -> String {
        if !ctx.expanded && !ctx.is_error {
            return String::new();
        }
        let args = Args::new(ctx.args);
        let output = ctx.result.unwrap_or("");
        let language = if ctx.is_error {
            None
        } else {
            args.path()
                .as_text()
                .and_then(|path| get_language_from_path(&path))
        };
        let rendered = match &language {
            Some(language) => highlight_lines(&replace_tabs(output), language, &theme.colors),
            None => output.split('\n').map(str::to_string).collect(),
        };
        let lines = trim_trailing_empty_lines(rendered);
        let max_lines = if ctx.expanded {
            lines.len()
        } else {
            10
        };
        let shown = lines.len().min(max_lines);
        let mut text = format!(
            "\n{}",
            lines[..shown]
                .iter()
                .map(|line| {
                    if language.is_some() {
                        replace_tabs(line)
                    } else {
                        theme.colors.tool_output.fg(&replace_tabs(line))
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        );
        let remaining = lines.len() - shown;
        if remaining > 0 {
            text.push_str(&theme.colors.muted.fg(&format!(
                "\n... ({remaining} more lines,"
            )));
            text.push(' ');
            text.push_str(&expand_hint(theme));
            text.push_str(&theme.colors.muted.fg(")"));
        }
        let truncation = Truncation::from_details(ctx.details);
        if let Some(truncation) = truncation.filter(|truncation| truncation.truncated) {
            if truncation.first_line_exceeds_limit {
                text.push_str(&format!(
                    "\n{}",
                    theme.colors.warning.fg(&format!(
                        "[First line exceeds {} limit]",
                        format_size(truncation.max_bytes.unwrap_or(DEFAULT_MAX_BYTES))
                    ))
                ));
            } else if truncation.truncated_by.as_deref() == Some("lines") {
                text.push_str(&format!(
                    "\n{}",
                    theme.colors.warning.fg(&format!(
                        "[Truncated: showing {} of {} lines ({} line limit)]",
                        truncation.output_lines.unwrap_or(0),
                        truncation.total_lines.unwrap_or(0),
                        truncation.max_lines.unwrap_or(DEFAULT_MAX_LINES)
                    ))
                ));
            } else {
                text.push_str(&format!(
                    "\n{}",
                    theme.colors.warning.fg(&format!(
                        "[Truncated: {} lines shown ({} limit)]",
                        truncation.output_lines.unwrap_or(0),
                        format_size(truncation.max_bytes.unwrap_or(DEFAULT_MAX_BYTES))
                    ))
                ));
            }
        }
        text
    }
}

// -- the write tool ---------------------------------------------------------

/// The `write` tool.
struct WriteRenderer;

impl ToolRenderer for WriteRenderer {
    fn render_call(&self, ctx: &ToolRenderContext<'_>, theme: &Theme) -> String {
        let args = Args::new(ctx.args);
        let path = render_tool_path(args.path().as_text(), theme, None);
        let mut text = format!("{} {}", theme.colors.tool_title.fg(&bold("write")), path);
        match args.ts_str("content") {
            TsStr::Invalid => {
                text.push_str(&format!(
                    "\n\n{}",
                    theme
                        .colors
                        .error
                        .fg("[invalid content arg - expected string]")
                ));
            }
            TsStr::Text(content) if !content.is_empty() => {
                let language = args
                    .path()
                    .as_text()
                    .and_then(|path| get_language_from_path(&path));
                let display = normalize_display_text(&content);
                let rendered = match &language {
                    Some(language) => highlight_lines(&replace_tabs(&display), language, &theme.colors),
                    None => display.split('\n').map(str::to_string).collect(),
                };
                let lines = trim_trailing_empty_lines(rendered);
                let total_lines = lines.len();
                let max_lines = if ctx.expanded {
                    total_lines
                } else {
                    10
                };
                let shown = total_lines.min(max_lines);
                text.push_str(&format!(
                    "\n\n{}",
                    lines[..shown]
                        .iter()
                        .map(|line| {
                            if language.is_some() {
                                line.clone()
                            } else {
                                theme.colors.tool_output.fg(&replace_tabs(line))
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                ));
                let remaining = total_lines - shown;
                if remaining > 0 {
                    text.push_str(&theme.colors.muted.fg(&format!(
                        "\n... ({remaining} more lines, {total_lines} total,"
                    )));
                    text.push(' ');
                    text.push_str(&expand_hint(theme));
                    text.push_str(&theme.colors.muted.fg(")"));
                }
            }
            _ => {}
        }
        text
    }

    fn render_result(&self, ctx: &ToolRenderContext<'_>, theme: &Theme) -> String {
        if !ctx.is_error {
            return String::new();
        }
        let output = ctx.result.unwrap_or("");
        if output.is_empty() {
            return String::new();
        }
        format!("\n{}", theme.colors.error.fg(output))
    }
}

// -- the shell tools --------------------------------------------------------

/// The `bash` and `powershell` tools, which differ only in their prompt.
struct ShellRenderer {
    prompt: &'static str,
}

impl ToolRenderer for ShellRenderer {
    fn render_call(&self, ctx: &ToolRenderContext<'_>, theme: &Theme) -> String {
        let args = Args::new(ctx.args);
        let command = match args.ts_str("command") {
            TsStr::Invalid => invalid_arg(theme),
            TsStr::Missing => theme.colors.tool_output.fg("..."),
            TsStr::Text(text) if text.is_empty() => theme.colors.tool_output.fg("..."),
            TsStr::Text(text) => text,
        };
        let mut text = theme
            .colors
            .tool_title
            .fg(&bold(&format!("{} {}", self.prompt, command)));
        if let Some(timeout) = args.number("timeout") {
            if timeout != 0.0 {
                text.push_str(&theme.colors.muted.fg(&format!(" (timeout {}s)", format_number(timeout))));
            }
        }
        text
    }

    fn render_result(&self, ctx: &ToolRenderContext<'_>, theme: &Theme) -> String {
        let mut text = String::new();
        let output = ctx.result.unwrap_or("").trim();
        if !output.is_empty() {
            let styled = output
                .split('\n')
                .map(|line| theme.colors.tool_output.fg(line))
                .collect::<Vec<_>>()
                .join("\n");
            if ctx.expanded {
                text.push('\n');
                text.push_str(&styled);
            } else {
                text.push('\n');
                let preview = truncate_to_visual_lines(&styled, BASH_PREVIEW_LINES, ctx.width, 0);
                if preview.skipped_count > 0 {
                    text.push_str(&theme.colors.muted.fg(&format!(
                        "... ({} earlier lines,",
                        preview.skipped_count
                    )));
                    text.push(' ');
                    text.push_str(&expand_hint(theme));
                    text.push_str(&theme.colors.muted.fg(")"));
                    text.push('\n');
                }
                text.push_str(&preview.visual_lines.join("\n"));
            }
        }
        let truncation = Truncation::from_details(ctx.details);
        let full_output_path = full_output_path(ctx.details);
        if truncation.as_ref().is_some_and(|truncation| truncation.truncated)
            || full_output_path.is_some()
        {
            let mut warnings: Vec<String> = Vec::new();
            if let Some(path) = full_output_path {
                warnings.push(format!("Full output: {path}"));
            }
            if let Some(truncation) = truncation {
                if truncation.truncated {
                    if truncation.truncated_by.as_deref() == Some("lines") {
                        warnings.push(format!(
                            "Truncated: showing {} of {} lines",
                            truncation.output_lines.unwrap_or(0),
                            truncation.total_lines.unwrap_or(0)
                        ));
                    } else {
                        warnings.push(format!(
                            "Truncated: {} lines shown ({} limit)",
                            truncation.output_lines.unwrap_or(0),
                            format_size(truncation.max_bytes.unwrap_or(DEFAULT_MAX_BYTES))
                        ));
                    }
                }
            }
            if !warnings.is_empty() {
                text.push_str(&format!(
                    "\n{}",
                    theme.colors.warning.fg(&format!("[{}]", warnings.join(". ")))
                ));
            }
        }
        if let Some(duration_ms) = ctx.duration_ms {
            text.push_str(&format!(
                "\n{}",
                theme.colors.muted.fg(&format!(
                    "{} {}",
                    if ctx.is_partial { "Elapsed" } else { "Took" },
                    format_tool_duration(duration_ms)
                ))
            ));
        }
        text
    }
}

// -- the grep tool ----------------------------------------------------------

/// The `grep` tool.
struct GrepRenderer;

impl ToolRenderer for GrepRenderer {
    fn render_call(&self, ctx: &ToolRenderContext<'_>, theme: &Theme) -> String {
        let args = Args::new(ctx.args);
        let pattern = match args.ts_str("pattern") {
            TsStr::Invalid => invalid_arg(theme),
            TsStr::Missing | TsStr::Text(_) => {
                let pattern = args.ts_str("pattern").as_text().unwrap_or_default();
                theme.colors.accent.fg(&format!("/{pattern}/"))
            }
        };
        let path = match args.ts_str("path") {
            TsStr::Invalid => invalid_arg(theme),
            TsStr::Missing => ".".to_string(),
            TsStr::Text(path) => shorten_path(if path.is_empty() { "." } else { &path }),
        };
        let mut text = format!(
            "{} {}{}",
            theme.colors.tool_title.fg(&bold("grep")),
            pattern,
            theme.colors.tool_output.fg(&format!(" in {path}"))
        );
        if let Some(glob) = args.ts_str("glob").as_text() {
            if !glob.is_empty() {
                text.push_str(&theme.colors.tool_output.fg(&format!(" ({glob})")));
            }
        }
        if let Some(limit) = args.number("limit") {
            text.push_str(&theme.colors.tool_output.fg(&format!(" limit {}", format_number(limit))));
        }
        text
    }

    fn render_result(&self, ctx: &ToolRenderContext<'_>, theme: &Theme) -> String {
        let mut text = String::new();
        let output = ctx.result.unwrap_or("").trim();
        if !output.is_empty() {
            let lines: Vec<&str> = output.split('\n').collect();
            let max_lines = if ctx.expanded {
                lines.len()
            } else {
                15
            };
            let shown = lines.len().min(max_lines);
            text.push('\n');
            text.push_str(
                &lines[..shown]
                    .iter()
                    .map(|line| theme.colors.tool_output.fg(line))
                    .collect::<Vec<_>>()
                    .join("\n"),
            );
            let remaining = lines.len() - shown;
            if remaining > 0 {
                text.push_str(&theme.colors.muted.fg(&format!(
                    "\n... ({remaining} more lines,"
                )));
                text.push(' ');
                text.push_str(&expand_hint(theme));
                text.push_str(&theme.colors.muted.fg(")"));
            }
        }
        let details = Details::new(ctx.details);
        let match_limit = details.number("matchLimitReached");
        let lines_truncated = details.flag("linesTruncated").unwrap_or(false);
        let truncation = Truncation::from_details(ctx.details);
        let truncated = truncation.as_ref().is_some_and(|truncation| truncation.truncated);
        if match_limit.is_some() || truncated || lines_truncated {
            let mut warnings: Vec<String> = Vec::new();
            if let Some(limit) = match_limit {
                warnings.push(format!("{} matches limit", format_number(limit)));
            }
            if truncated {
                warnings.push(format!(
                    "{} limit",
                    format_size(
                        truncation
                            .as_ref()
                            .and_then(|t| t.max_bytes)
                            .unwrap_or(DEFAULT_MAX_BYTES)
                    )
                ));
            }
            if lines_truncated {
                warnings.push("some lines truncated".to_string());
            }
            text.push_str(&format!(
                "\n{}",
                theme
                    .colors
                    .warning
                    .fg(&format!("[Truncated: {}]", warnings.join(", ")))
            ));
        }
        text
    }
}

// -- the find tool ----------------------------------------------------------

/// The `find` tool.
struct FindRenderer;

impl ToolRenderer for FindRenderer {
    fn render_call(&self, ctx: &ToolRenderContext<'_>, theme: &Theme) -> String {
        let args = Args::new(ctx.args);
        let pattern = match args.ts_str("pattern") {
            TsStr::Invalid => invalid_arg(theme),
            TsStr::Missing | TsStr::Text(_) => {
                let pattern = args.ts_str("pattern").as_text().unwrap_or_default();
                theme.colors.accent.fg(&pattern)
            }
        };
        let path = match args.ts_str("path") {
            TsStr::Invalid => invalid_arg(theme),
            TsStr::Missing => ".".to_string(),
            TsStr::Text(path) => shorten_path(if path.is_empty() { "." } else { &path }),
        };
        let mut text = format!(
            "{} {}{}",
            theme.colors.tool_title.fg(&bold("find")),
            pattern,
            theme.colors.tool_output.fg(&format!(" in {path}"))
        );
        if let Some(limit) = args.number("limit") {
            text.push_str(&theme.colors.tool_output.fg(&format!(" (limit {})", format_number(limit))));
        }
        text
    }

    fn render_result(&self, ctx: &ToolRenderContext<'_>, theme: &Theme) -> String {
        let mut text = String::new();
        let output = ctx.result.unwrap_or("").trim();
        if !output.is_empty() {
            let lines: Vec<&str> = output.split('\n').collect();
            let max_lines = if ctx.expanded {
                lines.len()
            } else {
                20
            };
            let shown = lines.len().min(max_lines);
            text.push('\n');
            text.push_str(
                &lines[..shown]
                    .iter()
                    .map(|line| theme.colors.tool_output.fg(line))
                    .collect::<Vec<_>>()
                    .join("\n"),
            );
            let remaining = lines.len() - shown;
            if remaining > 0 {
                text.push_str(&theme.colors.muted.fg(&format!(
                    "\n... ({remaining} more lines,"
                )));
                text.push(' ');
                text.push_str(&expand_hint(theme));
                text.push_str(&theme.colors.muted.fg(")"));
            }
        }
        let details = Details::new(ctx.details);
        let result_limit = details.number("resultLimitReached");
        let truncation = Truncation::from_details(ctx.details);
        let truncated = truncation.as_ref().is_some_and(|truncation| truncation.truncated);
        if result_limit.is_some() || truncated {
            let mut warnings: Vec<String> = Vec::new();
            if let Some(limit) = result_limit {
                warnings.push(format!("{} results limit", format_number(limit)));
            }
            if truncated {
                warnings.push(format!(
                    "{} limit",
                    format_size(
                        truncation
                            .as_ref()
                            .and_then(|t| t.max_bytes)
                            .unwrap_or(DEFAULT_MAX_BYTES)
                    )
                ));
            }
            text.push_str(&format!(
                "\n{}",
                theme
                    .colors
                    .warning
                    .fg(&format!("[Truncated: {}]", warnings.join(", ")))
            ));
        }
        text
    }
}

// -- the ls tool ------------------------------------------------------------

/// The `ls` tool.
struct LsRenderer;

impl ToolRenderer for LsRenderer {
    fn render_call(&self, ctx: &ToolRenderContext<'_>, theme: &Theme) -> String {
        let args = Args::new(ctx.args);
        let path = render_tool_path(args.ts_str("path").as_text(), theme, Some("."));
        let mut text = format!("{} {}", theme.colors.tool_title.fg(&bold("ls")), path);
        if let Some(limit) = args.number("limit") {
            text.push_str(&theme.colors.tool_output.fg(&format!(" (limit {})", format_number(limit))));
        }
        text
    }

    fn render_result(&self, ctx: &ToolRenderContext<'_>, theme: &Theme) -> String {
        let mut text = String::new();
        let output = ctx.result.unwrap_or("").trim();
        if !output.is_empty() {
            let lines: Vec<&str> = output.split('\n').collect();
            let max_lines = if ctx.expanded {
                lines.len()
            } else {
                20
            };
            let shown = lines.len().min(max_lines);
            text.push('\n');
            text.push_str(
                &lines[..shown]
                    .iter()
                    .map(|line| theme.colors.tool_output.fg(line))
                    .collect::<Vec<_>>()
                    .join("\n"),
            );
            let remaining = lines.len() - shown;
            if remaining > 0 {
                text.push_str(&theme.colors.muted.fg(&format!(
                    "\n... ({remaining} more lines,"
                )));
                text.push(' ');
                text.push_str(&expand_hint(theme));
                text.push_str(&theme.colors.muted.fg(")"));
            }
        }
        let details = Details::new(ctx.details);
        let entry_limit = details.number("entryLimitReached");
        let truncation = Truncation::from_details(ctx.details);
        let truncated = truncation.as_ref().is_some_and(|truncation| truncation.truncated);
        if entry_limit.is_some() || truncated {
            let mut warnings: Vec<String> = Vec::new();
            if let Some(limit) = entry_limit {
                warnings.push(format!("{} entries limit", format_number(limit)));
            }
            if truncated {
                warnings.push(format!(
                    "{} limit",
                    format_size(
                        truncation
                            .as_ref()
                            .and_then(|t| t.max_bytes)
                            .unwrap_or(DEFAULT_MAX_BYTES)
                    )
                ));
            }
            text.push_str(&format!(
                "\n{}",
                theme
                    .colors
                    .warning
                    .fg(&format!("[Truncated: {}]", warnings.join(", ")))
            ));
        }
        text
    }
}

// -- the edit tool ----------------------------------------------------------

/// The `edit` tool.
struct EditRenderer;

impl ToolRenderer for EditRenderer {
    fn render_call(&self, ctx: &ToolRenderContext<'_>, theme: &Theme) -> String {
        let args = Args::new(ctx.args);
        let path = render_tool_path(args.path().as_text(), theme, None);
        format!("{} {}", theme.colors.tool_title.fg(&bold("edit")), path)
    }

    fn render_result(&self, ctx: &ToolRenderContext<'_>, theme: &Theme) -> String {
        if !ctx.is_error {
            return String::new();
        }
        let output = ctx.result.unwrap_or("");
        if output.is_empty() {
            return String::new();
        }
        theme.colors.error.fg(output)
    }
}

// -- the tool result details ------------------------------------------------

/// The tool result details, parsed.
struct Details {
    value: Option<json::Value>,
}

impl Details {
    fn new(text: Option<&str>) -> Details {
        Details {
            value: text.and_then(json::parse),
        }
    }

    fn flag(&self, key: &str) -> Option<bool> {
        match self.value.as_ref().and_then(|value| value.get(key)) {
            Some(json::Value::Bool(flag)) => Some(*flag),
            _ => None,
        }
    }

    fn number(&self, key: &str) -> Option<f64> {
        match self.value.as_ref().and_then(|value| value.get(key)) {
            Some(json::Value::Num(number)) => Some(*number),
            _ => None,
        }
    }

    fn string(&self, key: &str) -> Option<String> {
        match self.value.as_ref().and_then(|value| value.get(key)) {
            Some(json::Value::Str(text)) => Some(text.clone()),
            _ => None,
        }
    }
}

/// The truncation metadata of a tool result.
struct Truncation {
    truncated: bool,
    first_line_exceeds_limit: bool,
    truncated_by: Option<String>,
    output_lines: Option<u64>,
    total_lines: Option<u64>,
    max_bytes: Option<u64>,
    max_lines: Option<u64>,
}

impl Truncation {
    fn from_details(details: Option<&str>) -> Option<Truncation> {
        let details = Details::new(details);
        let truncation = details.value.as_ref().and_then(|value| value.get("truncation"))?;
        let flag = |key: &str| match truncation.get(key) {
            Some(json::Value::Bool(flag)) => *flag,
            _ => false,
        };
        let number = |key: &str| match truncation.get(key) {
            Some(json::Value::Num(number)) => Some(*number as u64),
            _ => None,
        };
        let text = |key: &str| match truncation.get(key) {
            Some(json::Value::Str(text)) => Some(text.clone()),
            _ => None,
        };
        Some(Truncation {
            truncated: flag("truncated"),
            first_line_exceeds_limit: flag("firstLineExceedsLimit"),
            truncated_by: text("truncatedBy"),
            output_lines: number("outputLines"),
            total_lines: number("totalLines"),
            max_bytes: number("maxBytes"),
            max_lines: number("maxLines"),
        })
    }
}

/// The path of the full output file of a truncated result.
fn full_output_path(details: Option<&str>) -> Option<String> {
    Details::new(details).string("fullOutputPath")
}

// -- a minimal JSON reader --------------------------------------------------

/// A minimal JSON reader. `rpi-tui` deliberately has no serde dependency, so
/// the renderers read the tool arguments and the tool result details with
/// this scanner.
mod json {
    /// A JSON value.
    #[derive(Debug, Clone, PartialEq)]
    pub enum Value {
        Null,
        Bool(bool),
        Num(f64),
        Str(String),
        Arr(Vec<Value>),
        Obj(Vec<(String, Value)>),
    }

    impl Value {
        /// The member of an object.
        pub fn get(&self, key: &str) -> Option<&Value> {
            match self {
                Value::Obj(entries) => entries
                    .iter()
                    .find(|(name, _)| name == key)
                    .map(|(_, value)| value),
                _ => None,
            }
        }
    }

    /// Parse a JSON document.
    pub fn parse(text: &str) -> Option<Value> {
        let mut parser = Parser {
            chars: text.chars().collect(),
            pos: 0,
        };
        parser.skip_whitespace();
        let value = parser.value()?;
        parser.skip_whitespace();
        if parser.pos != parser.chars.len() {
            return None;
        }
        Some(value)
    }

    struct Parser {
        chars: Vec<char>,
        pos: usize,
    }

    impl Parser {
        fn skip_whitespace(&mut self) {
            while self
                .chars
                .get(self.pos)
                .is_some_and(|c| c.is_whitespace())
            {
                self.pos += 1;
            }
        }

        fn peek(&self) -> Option<char> {
            self.chars.get(self.pos).copied()
        }

        fn value(&mut self) -> Option<Value> {
            self.skip_whitespace();
            match self.peek()? {
                '{' => self.object(),
                '[' => self.array(),
                '"' => self.string().map(Value::Str),
                't' => self.literal("true").map(|_| Value::Bool(true)),
                'f' => self.literal("false").map(|_| Value::Bool(false)),
                'n' => self.literal("null").map(|_| Value::Null),
                _ => self.number(),
            }
        }

        fn literal(&mut self, text: &str) -> Option<()> {
            for expected in text.chars() {
                if self.peek()? != expected {
                    return None;
                }
                self.pos += 1;
            }
            Some(())
        }

        fn number(&mut self) -> Option<Value> {
            let start = self.pos;
            while let Some(c) = self.peek() {
                if c.is_ascii_digit() || matches!(c, '.' | 'e' | 'E' | '+' | '-') {
                    self.pos += 1;
                } else {
                    break;
                }
            }
            if start == self.pos {
                return None;
            }
            let text: String = self.chars[start..self.pos].iter().collect();
            text.parse::<f64>().ok().map(Value::Num)
        }

        fn string(&mut self) -> Option<String> {
            if self.peek()? != '"' {
                return None;
            }
            self.pos += 1;
            let mut out = String::new();
            loop {
                let c = self.peek()?;
                self.pos += 1;
                match c {
                    '"' => return Some(out),
                    '\\' => {
                        let escape = self.peek()?;
                        self.pos += 1;
                        out.push(match escape {
                            'n' => '\n',
                            't' => '\t',
                            'r' => '\r',
                            'b' => '\u{8}',
                            'f' => '\u{c}',
                            '"' => '"',
                            '\\' => '\\',
                            '/' => '/',
                            'u' => {
                                let hex: String = self.chars.get(self.pos..self.pos + 4)?.iter().collect();
                                self.pos += 4;
                                char::from_u32(u32::from_str_radix(&hex, 16).ok()?)?
                            }
                            other => other,
                        });
                    }
                    other => out.push(other),
                }
            }
        }

        fn array(&mut self) -> Option<Value> {
            self.pos += 1;
            let mut items = Vec::new();
            self.skip_whitespace();
            if self.peek()? == ']' {
                self.pos += 1;
                return Some(Value::Arr(items));
            }
            loop {
                items.push(self.value()?);
                self.skip_whitespace();
                match self.peek()? {
                    ',' => self.pos += 1,
                    ']' => {
                        self.pos += 1;
                        return Some(Value::Arr(items));
                    }
                    _ => return None,
                }
            }
        }

        fn object(&mut self) -> Option<Value> {
            self.pos += 1;
            let mut entries = Vec::new();
            self.skip_whitespace();
            if self.peek()? == '}' {
                self.pos += 1;
                return Some(Value::Obj(entries));
            }
            loop {
                self.skip_whitespace();
                let key = self.string()?;
                self.skip_whitespace();
                if self.peek()? != ':' {
                    return None;
                }
                self.pos += 1;
                let value = self.value()?;
                entries.push((key, value));
                self.skip_whitespace();
                match self.peek()? {
                    ',' => self.pos += 1,
                    '}' => {
                        self.pos += 1;
                        return Some(Value::Obj(entries));
                    }
                    _ => return None,
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ansi::strip_ansi;

    fn context<'a>(
        args: &'a str,
        result: Option<&'a str>,
        expanded: bool,
        is_error: bool,
    ) -> ToolRenderContext<'a> {
        ToolRenderContext {
            args,
            result,
            is_error,
            is_partial: false,
            expanded,
            cwd: "/tmp/work",
            width: 100,
            duration_ms: None,
            details: None,
        }
    }

    fn call(name: &str, args: &str) -> String {
        let theme = Theme::default();
        let renderer = builtin_renderer(name).expect("a renderer");
        strip_ansi(&renderer.render_call(&context(args, None, false, false), &theme))
    }

    fn result(name: &str, args: &str, output: &str, expanded: bool) -> String {
        let theme = Theme::default();
        let renderer = builtin_renderer(name).expect("a renderer");
        strip_ansi(&renderer.render_result(
            &context(args, Some(output), expanded, false),
            &theme,
        ))
    }

    #[test]
    fn the_builtin_tools_have_a_renderer_and_the_others_have_none() {
        for name in ["read", "write", "bash", "grep", "find", "ls", "edit"] {
            assert!(builtin_renderer(name).is_some(), "{name}");
        }
        assert!(builtin_renderer("powershell").is_some());
        assert!(builtin_renderer("todo").is_none());
        assert!(builtin_renderer("some_extension_tool").is_none());
    }

    #[test]
    fn read_call_shows_the_path() {
        assert_eq!(call("read", r#"{"path":"tool-input.txt"}"#), "read tool-input.txt");
        assert_eq!(call("read", r#"{"file_path":"a/b.rs"}"#), "read a/b.rs");
    }

    #[test]
    fn read_call_shows_the_line_range() {
        assert_eq!(call("read", r#"{"path":"a.txt","offset":5}"#), "read a.txt:5");
        assert_eq!(
            call("read", r#"{"path":"a.txt","offset":5,"limit":10}"#),
            "read a.txt:5-14"
        );
        assert_eq!(
            call("read", r#"{"path":"a.txt","limit":3}"#),
            "read a.txt:1-3"
        );
    }

    #[test]
    fn read_call_of_a_skill_is_compact() {
        assert_eq!(
            call("read", r#"{"path":"/tmp/work/skills/demo/SKILL.md"}"#),
            "@demo (ctrl+o to expand)"
        );
        assert_eq!(
            call("read", r#"{"path":"/tmp/work/AGENTS.md"}"#),
            "read resource AGENTS.md (ctrl+o to expand)"
        );
    }

    #[test]
    fn read_result_is_hidden_until_the_panel_is_expanded() {
        assert_eq!(result("read", r#"{"path":"a.txt"}"#, "hello\nworld", false), "");
        assert_eq!(
            result("read", r#"{"path":"a.txt"}"#, "hello\nworld", true),
            "\nhello\nworld"
        );
    }

    #[test]
    fn read_result_previews_ten_lines_and_hints_at_the_rest() {
        // A read result is only drawn when the panel is expanded or the read
        // failed, so the ten-line preview shows up on a failed read.
        let theme = Theme::default();
        let renderer = builtin_renderer("read").expect("a renderer");
        let output = (1..=15).map(|n| format!("line {n}")).collect::<Vec<_>>().join("\n");
        let mut ctx = context(r#"{"path":"a.txt"}"#, Some(&output), false, true);
        ctx.is_error = true;
        let rendered = strip_ansi(&renderer.render_result(&ctx, &theme));
        assert!(rendered.starts_with("\nline 1\n"), "{rendered}");
        assert!(rendered.contains("\nline 10\n"), "{rendered}");
        assert!(!rendered.contains("line 11"), "{rendered}");
        assert!(rendered.ends_with("... (5 more lines, ctrl+o to expand)"), "{rendered}");
    }

    #[test]
    fn write_call_shows_the_content() {
        assert_eq!(call("write", r#"{"path":"a.txt"}"#), "write a.txt");
        assert_eq!(
            call("write", r#"{"path":"a.txt","content":"one\ntwo"}"#),
            "write a.txt\n\none\ntwo"
        );
    }

    #[test]
    fn write_call_reports_a_content_that_is_not_a_string() {
        assert_eq!(
            call("write", r#"{"path":"a.txt","content":12}"#),
            "write a.txt\n\n[invalid content arg - expected string]"
        );
    }

    #[test]
    fn write_result_is_only_drawn_for_an_error() {
        assert_eq!(result("write", r#"{"path":"a.txt"}"#, "boom", false), "");
        let theme = Theme::default();
        let renderer = builtin_renderer("write").expect("a renderer");
        let mut ctx = context(r#"{"path":"a.txt"}"#, Some("boom"), false, true);
        ctx.is_error = true;
        assert_eq!(
            strip_ansi(&renderer.render_result(&ctx, &theme)),
            "\nboom"
        );
    }

    #[test]
    fn bash_call_shows_the_command_and_the_timeout() {
        assert_eq!(call("bash", r#"{"command":"ls -la"}"#), "$ ls -la");
        assert_eq!(
            call("bash", r#"{"command":"ls -la","timeout":30}"#),
            "$ ls -la (timeout 30s)"
        );
        assert_eq!(call("bash", r#"{"command":""}"#), "$ ...");
        assert_eq!(
            call("powershell", r#"{"command":"Get-ChildItem"}"#),
            "PS> Get-ChildItem"
        );
    }

    #[test]
    fn bash_result_previews_the_tail_of_the_output() {
        let output = (1..=7).map(|n| format!("line {n}")).collect::<Vec<_>>().join("\n");
        let rendered = result("bash", r#"{"command":"ls"}"#, &output, false);
        assert!(rendered.starts_with("\n... (2 earlier lines, ctrl+o to expand)\n"));
        assert!(rendered.contains("line 7"));
        assert!(!rendered.contains("line 1"));
    }

    #[test]
    fn grep_call_shows_the_pattern_and_the_path() {
        assert_eq!(call("grep", r#"{"pattern":"foo"}"#), "grep /foo/ in .");
        assert_eq!(
            call("grep", r#"{"pattern":"foo","path":"src","glob":"*.ts"}"#),
            "grep /foo/ in src (*.ts)"
        );
        assert_eq!(
            call("grep", r#"{"pattern":"foo","path":"src","limit":5}"#),
            "grep /foo/ in src limit 5"
        );
    }

    #[test]
    fn grep_result_previews_fifteen_lines() {
        let output = (1..=20).map(|n| format!("line {n}")).collect::<Vec<_>>().join("\n");
        let rendered = result("grep", r#"{"pattern":"x"}"#, &output, false);
        assert!(rendered.contains("\nline 15\n"));
        assert!(!rendered.contains("line 16"));
        assert!(rendered.ends_with("... (5 more lines, ctrl+o to expand)"));
    }

    #[test]
    fn find_call_shows_the_pattern_and_the_path() {
        assert_eq!(call("find", r#"{"pattern":"*.rs"}"#), "find *.rs in .");
        assert_eq!(
            call("find", r#"{"pattern":"*.rs","path":"src","limit":3}"#),
            "find *.rs in src (limit 3)"
        );
    }

    #[test]
    fn find_result_previews_twenty_lines() {
        let output = (1..=25).map(|n| format!("line {n}")).collect::<Vec<_>>().join("\n");
        let rendered = result("find", r#"{"pattern":"x"}"#, &output, false);
        assert!(rendered.contains("\nline 20\n"), "{rendered}");
        assert!(!rendered.contains("line 21"), "{rendered}");
        assert!(rendered.ends_with("... (5 more lines, ctrl+o to expand)"), "{rendered}");
    }

    #[test]
    fn ls_result_previews_twenty_lines() {
        let output = (1..=25).map(|n| format!("entry {n}")).collect::<Vec<_>>().join("\n");
        let rendered = result("ls", "{}", &output, false);
        assert!(rendered.contains("\nentry 20\n"), "{rendered}");
        assert!(!rendered.contains("entry 21"), "{rendered}");
        assert!(rendered.ends_with("... (5 more lines, ctrl+o to expand)"), "{rendered}");
    }

    #[test]
    fn ls_call_shows_the_path() {
        assert_eq!(call("ls", "{}"), "ls .");
        assert_eq!(call("ls", r#"{"path":"src"}"#), "ls src");
        assert_eq!(call("ls", r#"{"path":"src","limit":2}"#), "ls src (limit 2)");
    }

    #[test]
    fn edit_call_shows_the_path() {
        assert_eq!(call("edit", r#"{"path":"a.txt"}"#), "edit a.txt");
    }
}
