//! Footer component for TUI.
//!
//! Based on TypeScript implementation:
//! `packages/coding-agent/src/modes/interactive/components/footer.ts`.
//!
//! Upstream renders a single status line:
//!
//! ```text
//! anthropic/claude-sonnet-5 / medium / ████░░░░░░ 42.0% 84,000 tokens   ~/proj:main • session • $0.421
//! ```
//!
//! * left — the model (provider-qualified), the thinking level, the context
//!   meter (a ten-cell block bar, the percentage and the exact token count),
//!   joined with ` / `;
//! * right — the working directory (home-relative), the git branch, the
//!   session name and the session cost, right-aligned.
//!
//! The line shrinks to fit the terminal: the path is shortened from the left,
//! then the session name, the branch and the path are dropped, then the
//! thinking level, then the model name. A second line carries the extension
//! statuses (upstream appends them the same way).

use std::any::Any;
use std::sync::Mutex;

use super::component::Component;
use crate::theme::theme;
use crate::utils::{truncate_to_width, visible_width};

/// Width of the context bar in cells.
pub const CONTEXT_BAR_WIDTH: usize = 10;

/// The eighth blocks, from empty to full, for the partly filled cell of the bar.
const BLOCK_PARTIALS: [&str; 7] = [
    "\u{258F}", "\u{258E}", "\u{258D}", "\u{258C}", "\u{258B}", "\u{258A}", "\u{2589}",
];

/// Separator between the groups on the left of the footer line.
const GROUP_SEPARATOR: &str = " / ";
/// Separator between the cwd and the git branch.
const PATH_SEPARATOR: &str = ":";
/// Separator between the path and the session name.
const SESSION_SEPARATOR: &str = " • ";
/// Minimum spaces between the left groups and the right-aligned path.
const MIN_PADDING: usize = 2;

/// Usage totals aggregated across the session (native `usage-totals.ts`).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct UsageTotals {
    pub input: i64,
    pub output: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    pub cost: f64,
}

impl UsageTotals {
    pub fn add(&mut self, input: i64, output: i64, cache_read: i64, cache_write: i64, cost: f64) {
        self.input += input;
        self.output += output;
        self.cache_read += cache_read;
        self.cache_write += cache_write;
        self.cost += cost;
    }
}

/// Format token counts for compact footer display (native `formatTokens`).
pub fn format_tokens(count: i64) -> String {
    if count < 1_000 {
        return count.to_string();
    }
    if count < 10_000 {
        return format!("{:.1}k", count as f64 / 1_000.0);
    }
    if count < 1_000_000 {
        return format!("{}k", (count as f64 / 1_000.0).round() as i64);
    }
    if count < 10_000_000 {
        return format!("{:.1}M", count as f64 / 1_000_000.0);
    }
    format!("{}M", (count as f64 / 1_000_000.0).round() as i64)
}

/// Format a token count exactly, with thousand separators (`198,234`).
pub fn format_exact_tokens(count: i64) -> String {
    let digits = count.unsigned_abs().to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, ch) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    if count < 0 {
        format!("-{out}")
    } else {
        out
    }
}

/// A filling bar for the context usage: full blocks for the used part, an
/// empty shade for the rest. The partly filled cell uses an eighth block, so
/// the bar shows fractions of a cell.
pub fn format_context_bar(percent: f64, width: usize) -> String {
    let clamped = percent.clamp(0.0, 100.0);
    let exact = (clamped / 100.0) * width as f64;
    let full = exact.floor().max(0.0) as usize;
    let fraction = exact - full as f64;
    let partial = if fraction > 0.0 {
        let index = ((fraction * BLOCK_PARTIALS.len() as f64).floor() as usize)
            .min(BLOCK_PARTIALS.len() - 1);
        BLOCK_PARTIALS[index]
    } else {
        ""
    };
    let empty = width.saturating_sub(full + usize::from(!partial.is_empty()));
    format!("{}{}{}", "█".repeat(full), partial, "░".repeat(empty))
}

/// Render a cwd home-relative (`~` prefix), matching native `formatCwdForFooter`.
pub fn format_cwd_for_footer(cwd: &str, home: Option<&str>) -> String {
    let Some(home) = home.filter(|h| !h.is_empty()) else {
        return cwd.to_string();
    };
    let home = home.trim_end_matches(['/', '\\']);
    if cwd == home {
        return "~".to_string();
    }
    for sep in ['/', '\\'] {
        let prefix = format!("{home}{sep}");
        if let Some(rest) = cwd.strip_prefix(&prefix) {
            return format!("~{sep}{rest}");
        }
    }
    cwd.to_string()
}

fn sanitize(text: &str) -> String {
    text.replace(['\r', '\n', '\t'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Nerd Font glyphs for the footer groups. They need a patched font, so they
/// are only used when the `nerdFonts` setting is on.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct FooterIcons {
    model: Option<&'static str>,
    thinking: Option<&'static str>,
    context: Option<&'static str>,
    path: Option<&'static str>,
    branch: Option<&'static str>,
    cost: Option<&'static str>,
}

const NERD_FONT_ICONS: FooterIcons = FooterIcons {
    model: Some("\u{F2DB}"),
    thinking: Some("\u{F0E7}"),
    context: Some("\u{F200}"),
    path: Some("\u{F07C}"),
    branch: Some("\u{F126}"),
    cost: Some("\u{F155}"),
};

/// Separators and icons for one footer line.
#[derive(Debug, Clone, Copy)]
struct FooterStyle {
    separator: &'static str,
    path_separator: &'static str,
    icons: FooterIcons,
}

const PLAIN_STYLE: FooterStyle = FooterStyle {
    separator: GROUP_SEPARATOR,
    path_separator: PATH_SEPARATOR,
    icons: FooterIcons {
        model: None,
        thinking: None,
        context: None,
        path: None,
        branch: None,
        cost: None,
    },
};

/// The icons separate the groups, so the gap between them is wider than in the
/// plain style.
const NERD_FONT_STYLE: FooterStyle = FooterStyle {
    separator: "  ",
    path_separator: "  ",
    icons: NERD_FONT_ICONS,
};

/// One group of the footer line, with an optional icon in front of it.
#[derive(Debug, Clone, Default)]
struct FooterGroup {
    text: String,
    icon: Option<&'static str>,
}

impl FooterGroup {
    fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            icon: None,
        }
    }
}

/// Prefix a group with its icon. An empty group stays empty.
fn with_icon(text: &str, icon: Option<&'static str>) -> String {
    if text.is_empty() {
        return String::new();
    }
    match icon {
        Some(icon) => format!("{icon} {text}"),
        None => text.to_string(),
    }
}

/// Shorten a path from the left so the tail (the project folder) stays
/// visible. Returns an empty string when the path cannot be shortened to
/// something readable.
fn truncate_cwd(cwd: &str, max_width: usize) -> String {
    if max_width == 0 {
        return String::new();
    }
    if visible_width(cwd) <= max_width {
        return cwd.to_string();
    }
    let segments: Vec<&str> = cwd.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
    for index in 1..segments.len() {
        let candidate = format!("…/{}", segments[index..].join("/"));
        if visible_width(&candidate) <= max_width {
            return candidate;
        }
    }
    let clipped = truncate_to_width(cwd, max_width, "…");
    if visible_width(&clipped) >= 4 {
        clipped
    } else {
        String::new()
    }
}

struct FooterFit {
    left: String,
    right: String,
}

/// The pieces of the footer line, assembled before the fit pass.
struct FooterParts {
    model_candidates: Vec<String>,
    thinking_group: Option<String>,
    context_group: FooterGroup,
    extra_groups: Vec<FooterGroup>,
    cwd: String,
    branch: Option<String>,
    session_name: Option<String>,
    cost_group: Option<FooterGroup>,
    style: FooterStyle,
}

fn fit_footer_line(parts: &FooterParts, width: usize) -> FooterFit {
    let mut best = FooterFit {
        left: String::new(),
        right: String::new(),
    };
    for model in &parts.model_candidates {
        let (fit, truncated) = fit_footer_line_with_model(parts, model, width);
        best = fit;
        if !truncated {
            break;
        }
    }
    best
}

fn fit_footer_line_with_model(
    parts: &FooterParts,
    model: &str,
    width: usize,
) -> (FooterFit, bool) {
    let style = parts.style;
    let mut model_group = model.to_string();
    let mut thinking = parts.thinking_group.clone();
    let mut path = parts.cwd.clone();
    let mut path_branch = parts.branch.clone();
    let mut path_session = parts.session_name.clone();

    let build_left = |model_group: &str, thinking: &Option<String>| -> String {
        let mut pieces: Vec<String> = Vec::new();
        let model_text = with_icon(model_group, style.icons.model);
        if !model_text.is_empty() {
            pieces.push(model_text);
        }
        if let Some(level) = thinking {
            let thinking_text = with_icon(level, style.icons.thinking);
            if !thinking_text.is_empty() {
                pieces.push(thinking_text);
            }
        }
        let context_text = with_icon(&parts.context_group.text, parts.context_group.icon);
        if !context_text.is_empty() {
            pieces.push(context_text);
        }
        for group in &parts.extra_groups {
            let group_text = with_icon(&group.text, group.icon);
            if !group_text.is_empty() {
                pieces.push(group_text);
            }
        }
        pieces.join(style.separator)
    };

    let build_right = |path: &str,
                       path_branch: &Option<String>,
                       path_session: &Option<String>|
     -> String {
        let path_text = with_icon(path, style.icons.path);
        let branch_text = path_branch
            .as_ref()
            .map(|branch| with_icon(branch, style.icons.branch))
            .unwrap_or_default();
        let path_group = [path_text, branch_text]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(style.path_separator);
        let mut pieces: Vec<String> = Vec::new();
        if !path_group.is_empty() {
            pieces.push(path_group);
        }
        if let Some(session) = path_session {
            if !session.is_empty() {
                pieces.push(session.clone());
            }
        }
        if let Some(cost) = &parts.cost_group {
            let cost_text = with_icon(&cost.text, cost.icon);
            if !cost_text.is_empty() {
                pieces.push(cost_text);
            }
        }
        pieces.join(SESSION_SEPARATOR)
    };

    let fits = |left: &str, right: &str| -> bool {
        let right_width = if right.is_empty() {
            0
        } else {
            MIN_PADDING + visible_width(right)
        };
        visible_width(left) + right_width <= width
    };

    let mut left = build_left(&model_group, &thinking);
    let mut right = build_right(&path, &path_branch, &path_session);

    if !fits(&left, &right) {
        path_session = None;
        right = build_right(&path, &path_branch, &path_session);
    }

    if !fits(&left, &right) {
        let fixed_width = visible_width(&left)
            + path_branch
                .as_ref()
                .map(|branch| style.path_separator.len() + visible_width(branch))
                .unwrap_or(0)
            + path_session
                .as_ref()
                .map(|session| SESSION_SEPARATOR.len() + visible_width(session))
                .unwrap_or(0)
            + parts
                .cost_group
                .as_ref()
                .map(|cost| SESSION_SEPARATOR.len() + visible_width(&cost.text))
                .unwrap_or(0);
        path = truncate_cwd(
            &parts.cwd,
            width.saturating_sub(MIN_PADDING).saturating_sub(fixed_width),
        );
        right = build_right(&path, &path_branch, &path_session);
    }

    if !fits(&left, &right) {
        path_branch = None;
        right = build_right(&path, &path_branch, &path_session);
    }
    if !fits(&left, &right) {
        path = String::new();
        right = build_right(&path, &path_branch, &path_session);
    }

    let mut truncated = false;
    if !fits(&left, &right) {
        thinking = None;
        left = build_left(&model_group, &thinking);
    }
    if !fits(&left, &right) {
        truncated = true;
        let mut rest: Vec<String> = Vec::new();
        let context_text = with_icon(&parts.context_group.text, parts.context_group.icon);
        if !context_text.is_empty() {
            rest.push(context_text);
        }
        for group in &parts.extra_groups {
            let group_text = with_icon(&group.text, group.icon);
            if !group_text.is_empty() {
                rest.push(group_text);
            }
        }
        let rest_text = rest.join(style.separator);
        let rest_width = visible_width(&rest_text);
        let icon_width = style
            .icons
            .model
            .map(|icon| visible_width(icon) + 1)
            .unwrap_or(0);
        let available = width as i64
            - visible_width(&right) as i64
            - if right.is_empty() { 0 } else { MIN_PADDING as i64 }
            - rest_width as i64
            - if rest_width == 0 {
                0
            } else {
                style.separator.len() as i64
            }
            - icon_width as i64;
        model_group = if available > 0 {
            truncate_to_width(&model_group, available as usize, "")
        } else {
            String::new()
        };
        left = build_left(&model_group, &thinking);
    }

    if visible_width(&left) > width {
        left = truncate_to_width(&left, width, "…");
    }

    (FooterFit { left, right }, truncated)
}

/// Footer component that displays status information.
pub struct FooterComponent {
    /// Transient run state (e.g. `Aborting…`). The host renders it in its
    /// status slot, upstream renders it in the status indicator, not in the
    /// footer line.
    status: Mutex<String>,
    /// Extension-provided status text (e.g. `langfuse ✓ (trace sent)`), driven
    /// by the host's `SetStatus` runtime action. Rendered after the footer line.
    extension_status: Mutex<String>,
    /// Model id.
    model: Mutex<String>,
    /// Provider id, shown in front of the model id.
    provider: Mutex<Option<String>>,
    /// Whether the model supports reasoning (the thinking level is only shown
    /// for such models).
    model_reasoning: Mutex<bool>,
    /// Thinking level shown after the model.
    thinking_level: Mutex<Option<String>>,
    /// The model a routed request went to (` → model`).
    routed_model: Mutex<Option<String>>,
    /// The thinking level a routed request used (` → level`).
    routed_thinking_level: Mutex<Option<String>>,
    /// Show Nerd Font glyphs in front of the footer groups.
    nerd_fonts: Mutex<bool>,
    /// Whether the provider is subscription-backed (renders the `(sub)` marker).
    using_subscription: Mutex<bool>,
    /// Working directory (unmodified).
    cwd: Mutex<Option<String>>,
    /// Home directory for `~`-relative rendering.
    home: Mutex<Option<String>>,
    /// Git branch, when inside a repository.
    git_branch: Mutex<Option<String>>,
    /// Session name.
    session_name: Mutex<Option<String>>,
    /// Aggregated usage totals.
    usage: Mutex<UsageTotals>,
    /// Context usage percent (0..=100), when known.
    context_percent: Mutex<Option<f64>>,
    /// Latest context-token count reported by an assistant response, when
    /// known. The percent is derived from this against `context_window`; `None`
    /// renders `?` (no post-compaction usage yet, or nothing reported).
    context_tokens: Mutex<Option<i64>>,
    /// Model context window in tokens (0 ⇒ unknown).
    context_window: Mutex<i64>,
}

impl FooterComponent {
    /// Create a new footer component.
    pub fn new() -> Self {
        Self {
            status: Mutex::new(String::new()),
            extension_status: Mutex::new(String::new()),
            model: Mutex::new(String::new()),
            provider: Mutex::new(None),
            model_reasoning: Mutex::new(false),
            thinking_level: Mutex::new(None),
            routed_model: Mutex::new(None),
            routed_thinking_level: Mutex::new(None),
            nerd_fonts: Mutex::new(false),
            using_subscription: Mutex::new(false),
            cwd: Mutex::new(None),
            home: Mutex::new(
                std::env::var("HOME")
                    .ok()
                    .or_else(|| std::env::var("USERPROFILE").ok()),
            ),
            git_branch: Mutex::new(None),
            session_name: Mutex::new(None),
            usage: Mutex::new(UsageTotals::default()),
            context_percent: Mutex::new(None),
            context_tokens: Mutex::new(None),
            context_window: Mutex::new(0),
        }
    }

    /// Set the status text (rendered by the host, not by the footer line).
    pub fn set_status(&self, status: &str) {
        if let Ok(mut s) = self.status.lock() {
            *s = status.to_string();
        }
    }

    /// Set the extension status text (empty clears it).
    pub fn set_extension_status(&self, status: &str) {
        if let Ok(mut s) = self.extension_status.lock() {
            *s = status.to_string();
        }
    }

    /// Set the model id.
    pub fn set_model(&self, model: &str) {
        if let Ok(mut m) = self.model.lock() {
            *m = model.to_string();
        }
    }

    /// Set the provider id shown in front of the model id.
    pub fn set_provider(&self, provider: Option<&str>) {
        if let Ok(mut p) = self.provider.lock() {
            *p = provider.map(|value| value.to_string());
        }
    }

    /// Declare whether the model supports reasoning. The thinking level is
    /// only shown for such models.
    pub fn set_model_reasoning(&self, reasoning: bool) {
        if let Ok(mut r) = self.model_reasoning.lock() {
            *r = reasoning;
        }
    }

    /// Set the thinking level shown after the model.
    pub fn set_thinking_level(&self, level: Option<&str>) {
        if let Ok(mut t) = self.thinking_level.lock() {
            *t = level.map(|s| s.to_string());
        }
    }

    /// Clear the thinking level.
    pub fn clear_thinking_level(&self) {
        if let Ok(mut t) = self.thinking_level.lock() {
            *t = None;
        }
    }

    /// Set the model a routed request went to (renders the ` → model` suffix).
    pub fn set_routed_model(&self, model: Option<&str>) {
        if let Ok(mut m) = self.routed_model.lock() {
            *m = model.map(|value| value.to_string());
        }
    }

    /// Set the thinking level a routed request used (renders ` → level`).
    pub fn set_routed_thinking_level(&self, level: Option<&str>) {
        if let Ok(mut l) = self.routed_thinking_level.lock() {
            *l = level.map(|value| value.to_string());
        }
    }

    /// Show Nerd Font glyphs in front of the footer groups.
    pub fn set_nerd_fonts(&self, enabled: bool) {
        if let Ok(mut n) = self.nerd_fonts.lock() {
            *n = enabled;
        }
    }

    /// Mark the provider as subscription-backed (renders the `(sub)` marker).
    pub fn set_using_subscription(&self, subscription: bool) {
        if let Ok(mut s) = self.using_subscription.lock() {
            *s = subscription;
        }
    }

    /// Set the working directory.
    pub fn set_cwd(&self, cwd: &str) {
        if let Ok(mut c) = self.cwd.lock() {
            *c = Some(cwd.to_string());
        }
    }

    /// Set the git branch shown next to the pwd.
    pub fn set_git_branch(&self, branch: Option<&str>) {
        if let Ok(mut b) = self.git_branch.lock() {
            *b = branch.map(|s| s.to_string());
        }
    }

    /// Set the session name shown after the branch.
    pub fn set_session_name(&self, name: Option<&str>) {
        if let Ok(mut n) = self.session_name.lock() {
            *n = name.map(|s| s.to_string());
        }
    }

    /// Replace the aggregated usage totals.
    pub fn set_usage(&self, totals: UsageTotals) {
        if let Ok(mut u) = self.usage.lock() {
            *u = totals;
        }
    }

    /// Add one turn's usage to the running totals.
    pub fn add_usage(&self, input: i64, output: i64, cache_read: i64, cache_write: i64, cost: f64) {
        if let Ok(mut u) = self.usage.lock() {
            u.add(input, output, cache_read, cache_write, cost);
        }
    }

    /// Set the context usage percent directly (the percent is normally derived
    /// from the reported token count).
    pub fn set_context_usage(&self, percent: Option<f64>, window: i64) {
        if let Ok(mut p) = self.context_percent.lock() {
            *p = percent;
        }
        if let Ok(mut w) = self.context_window.lock() {
            *w = window;
        }
    }

    /// Record the context-token count reported by the latest assistant
    /// response and recompute the displayed `%`. Pass `None` to reset the
    /// badge to `?` — e.g. after a compaction, when the last usage describes
    /// the pre-compaction context (mirrors pi's `percent: null`).
    pub fn set_context_tokens(&self, tokens: Option<i64>) {
        if let Ok(mut t) = self.context_tokens.lock() {
            *t = tokens;
        }
        self.recompute_context_percent();
    }

    /// Set the model's context window and recompute the `%` against the
    /// tracked token count (a model switch changes the denominator).
    pub fn set_context_window(&self, window: i64) {
        if let Ok(mut w) = self.context_window.lock() {
            *w = window;
        }
        self.recompute_context_percent();
    }

    /// Derive the context-usage percent from the tracked tokens/window.
    fn recompute_context_percent(&self) {
        let window = *self.context_window.lock().unwrap();
        let tokens = *self.context_tokens.lock().unwrap();
        let percent = match (tokens, window) {
            (Some(t), w) if t > 0 && w > 0 => Some(t as f64 / w as f64 * 100.0),
            _ => None,
        };
        if let Ok(mut p) = self.context_percent.lock() {
            *p = percent;
        }
    }

    /// Get the status text.
    pub fn get_status(&self) -> String {
        self.status.lock().unwrap().clone()
    }

    /// Get the model id.
    pub fn get_model(&self) -> String {
        self.model.lock().unwrap().clone()
    }

    /// The context meter text: the block bar, the percentage of the context
    /// window that is in use and the number of tokens in use. With no usage
    /// yet that is `0.0%` and `0 tokens` — the window's size is never shown.
    fn context_group(&self) -> (FooterGroup, Option<f64>) {
        let colors = theme().colors;
        let tokens = *self.context_tokens.lock().unwrap();
        let percent = *self.context_percent.lock().unwrap();

        let (percent_value, display) = match (percent, tokens) {
            (Some(percent), Some(tokens)) => {
                let bar = format_context_bar(percent, CONTEXT_BAR_WIDTH);
                (
                    Some(percent),
                    format!(
                        "{bar} {percent:.1}% {} tokens",
                        format_exact_tokens(tokens)
                    ),
                )
            }
            _ => {
                let bar = format_context_bar(0.0, CONTEXT_BAR_WIDTH);
                (Some(0.0), format!("{bar} 0.0% 0 tokens"))
            }
        };

        let styled = match percent_value {
            Some(percent) if percent > 90.0 => colors.error.fg(&display),
            Some(percent) if percent > 70.0 => colors.warning.fg(&display),
            _ => display,
        };

        (
            FooterGroup {
                text: styled,
                icon: None,
            },
            percent_value,
        )
    }

    /// The cost group (`$0.421`, `$0.000 (sub)`), when a cost is known or the
    /// provider is subscription-backed.
    fn cost_group(&self) -> Option<FooterGroup> {
        let usage = *self.usage.lock().unwrap();
        let subscription = *self.using_subscription.lock().unwrap();
        if usage.cost <= 0.0 && !subscription {
            return None;
        }
        let mut text = format!("${:.3}", usage.cost);
        if subscription {
            text.push_str(" (sub)");
        }
        Some(FooterGroup::new(text))
    }

    /// The thinking level group, only for models that support reasoning.
    fn thinking_group(&self) -> Option<String> {
        if !*self.model_reasoning.lock().unwrap() {
            return None;
        }
        let level = self
            .thinking_level
            .lock()
            .unwrap()
            .clone()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "off".to_string());
        Some(if level == "off" {
            "thinking off".to_string()
        } else {
            level
        })
    }
}

impl Default for FooterComponent {
    fn default() -> Self {
        Self::new()
    }
}

impl Component for FooterComponent {
    fn render(&self, width: usize) -> Vec<String> {
        let colors = theme().colors;
        let style = if *self.nerd_fonts.lock().unwrap() {
            NERD_FONT_STYLE
        } else {
            PLAIN_STYLE
        };

        let model = self.model.lock().unwrap().clone();
        let provider = self.provider.lock().unwrap().clone();
        let routed_suffix = self
            .routed_model
            .lock()
            .unwrap()
            .clone()
            .filter(|value| !value.is_empty())
            .map(|value| format!(" \u{2192} {value}"))
            .unwrap_or_default();
        let model_name = if model.is_empty() {
            "no-model".to_string()
        } else {
            model
        };
        let model_candidates = match provider.filter(|value| !value.is_empty()) {
            Some(provider) => vec![
                format!("{provider}/{model_name}{routed_suffix}"),
                format!("{model_name}{routed_suffix}"),
            ],
            None => vec![format!("{model_name}{routed_suffix}")],
        };

        let mut thinking_group = self.thinking_group();
        let thinking_level = self
            .thinking_level
            .lock()
            .unwrap()
            .clone()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "off".to_string());
        if let Some(routed) = self
            .routed_thinking_level
            .lock()
            .unwrap()
            .clone()
            .filter(|value| !value.is_empty())
        {
            if routed != thinking_level {
                thinking_group = Some(match thinking_group {
                    Some(level) => format!("{level} \u{2192} {routed}"),
                    None => routed,
                });
            }
        }

        let (mut context_group, _) = self.context_group();
        context_group.icon = style.icons.context;
        let mut cost_group = self.cost_group();
        if let Some(cost) = cost_group.as_mut() {
            cost.icon = style.icons.cost;
        }

        let cwd = self.cwd.lock().unwrap().clone().unwrap_or_default();
        let home = self.home.lock().unwrap().clone();
        let cwd = format_cwd_for_footer(&cwd, home.as_deref());
        let branch = self
            .git_branch
            .lock()
            .unwrap()
            .clone()
            .filter(|value| !value.is_empty());
        let session_name = self
            .session_name
            .lock()
            .unwrap()
            .clone()
            .filter(|value| !value.is_empty());

        let parts = FooterParts {
            model_candidates,
            thinking_group,
            context_group,
            extra_groups: Vec::new(),
            cwd,
            branch,
            session_name,
            cost_group,
            style,
        };

        let fit = fit_footer_line(&parts, width);
        let gap = width
            .saturating_sub(visible_width(&fit.left))
            .saturating_sub(visible_width(&fit.right));
        let footer_line = if fit.right.is_empty() {
            colors.dim.fg(&fit.left)
        } else {
            format!(
                "{}{}{}",
                colors.dim.fg(&fit.left),
                " ".repeat(gap),
                colors.dim.fg(&fit.right)
            )
        };

        let mut lines = vec![footer_line];

        let extension_status = self.extension_status.lock().unwrap().clone();
        if !extension_status.trim().is_empty() {
            let status_line = sanitize(&extension_status);
            lines.push(truncate_to_width(&status_line, width, &colors.dim.fg("...")));
        }

        lines
    }

    fn invalidate(&self) {
        // Footer has no cached state
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ansi::strip_ansi;

    /// The extension status (langfuse ✓ …) renders on its own line under the
    /// footer line.
    #[test]
    fn test_footer_with_extension_status() {
        let footer = FooterComponent::new();
        footer.set_status("Aborting…");
        footer.set_extension_status("langfuse ✓ (trace sent)");
        let lines = footer.render(120);
        assert_eq!(lines.len(), 2, "expected footer + status lines");
        let row = strip_ansi(&lines.join(" "));
        assert!(row.contains("langfuse ✓ (trace sent)"), "ext status lost: {row}");
        assert!(
            !strip_ansi(&lines[0]).contains("Aborting…"),
            "run status must not render in the footer line: {row}"
        );
    }

    #[test]
    fn test_footer_basic() {
        let footer = FooterComponent::new();
        footer.set_model("mock-1");
        footer.set_provider(Some("mock"));
        let lines = footer.render(80);
        assert_eq!(lines.len(), 1);
        let row = strip_ansi(&lines[0]);
        assert!(row.starts_with("mock/mock-1"), "model group: {row}");
    }

    #[test]
    fn footer_renders_the_context_bar_and_the_exact_token_count() {
        let footer = FooterComponent::new();
        footer.set_model("mock-1");
        footer.set_provider(Some("mock"));
        footer.set_context_window(128_000);
        footer.set_context_tokens(Some(49));
        let row = strip_ansi(&footer.render(100)[0]);
        assert!(
            row.starts_with("mock/mock-1 / \u{258F}\u{2591}\u{2591}\u{2591}\u{2591}\u{2591}\u{2591}\u{2591}\u{2591}\u{2591} 0.0% 49 tokens"),
            "context group: {row}"
        );
    }

    #[test]
    fn footer_renders_an_unknown_context_count() {
        let footer = FooterComponent::new();
        footer.set_model("mock-1");
        footer.set_context_window(128_000);
        let row = strip_ansi(&footer.render(100)[0]);
        assert!(
            row.starts_with("mock-1 / \u{2591}\u{2591}\u{2591}\u{2591}\u{2591}\u{2591}\u{2591}\u{2591}\u{2591}\u{2591} 0.0% 0 tokens"),
            "context group: {row}"
        );
        assert!(!row.contains("128,000"), "the window size is not shown: {row}");
    }

    #[test]
    fn footer_right_aligns_the_path_branch_session_and_cost() {
        let footer = FooterComponent::new();
        footer.set_model("mock-1");
        footer.set_cwd("/tmp/work");
        footer.set_git_branch(Some("main"));
        footer.set_session_name(Some("my-session"));
        footer.add_usage(10, 2, 0, 0, 0.421);
        let row = strip_ansi(&footer.render(100)[0]);
        assert!(
            row.ends_with("/tmp/work:main • my-session • $0.421"),
            "right side: {row}"
        );
    }

    #[test]
    fn footer_marks_subscription_providers() {
        let footer = FooterComponent::new();
        footer.set_model("mock-1");
        footer.set_using_subscription(true);
        let row = strip_ansi(&footer.render(100)[0]);
        assert!(row.contains("$0.000 (sub)"), "subscription marker: {row}");
    }

    #[test]
    fn footer_shows_the_routed_model_suffix() {
        let footer = FooterComponent::new();
        footer.set_model("mock-1");
        footer.set_provider(Some("mock"));
        footer.set_routed_model(Some("mock-2"));
        let row = strip_ansi(&footer.render(100)[0]);
        assert!(
            row.starts_with("mock/mock-1 \u{2192} mock-2"),
            "routed suffix: {row}"
        );
    }

    #[test]
    fn footer_shows_the_thinking_level_only_for_reasoning_models() {
        let footer = FooterComponent::new();
        footer.set_model("mock-1");
        footer.set_thinking_level(Some("medium"));
        let row = strip_ansi(&footer.render(100)[0]);
        assert!(!row.contains("medium"), "thinking level leaked: {row}");

        footer.set_model_reasoning(true);
        let row = strip_ansi(&footer.render(100)[0]);
        assert!(
            row.starts_with("mock-1 / medium / "),
            "thinking group: {row}"
        );
    }

    #[test]
    fn footer_shows_nerd_font_icons_when_enabled() {
        let footer = FooterComponent::new();
        footer.set_model("mock-1");
        footer.set_provider(Some("mock"));
        footer.set_nerd_fonts(true);
        let row = strip_ansi(&footer.render(100)[0]);
        assert!(row.starts_with("\u{F2DB} mock/mock-1"), "model icon: {row}");
        assert!(row.contains("\u{F200}"), "context icon: {row}");
    }

    #[test]
    fn test_footer_truncate() {
        let footer = FooterComponent::new();
        footer.set_model("a-very-long-model-name-that-does-not-fit");
        footer.set_provider(Some("a-very-long-provider-name"));
        footer.set_cwd("/home/user/some/deep/project/directory");
        footer.set_git_branch(Some("feature/a-very-long-branch-name"));
        footer.set_session_name(Some("a-very-long-session-name"));
        let lines = footer.render(40);
        for line in &lines {
            assert!(
                visible_width(line) <= 40,
                "row too wide: {}",
                visible_width(line)
            );
        }
    }

    #[test]
    fn context_badge_derives_percent_from_reported_tokens() {
        let footer = FooterComponent::new();
        footer.set_context_window(512_000);
        let stats = strip_ansi(&footer.render(120).join("\n"));
        assert!(stats.contains("0.0% 0 tokens"), "stats: {stats}");
        assert!(!stats.contains("512,000"), "stats: {stats}");

        footer.set_context_tokens(Some(256_000));
        let stats = strip_ansi(&footer.render(120).join("\n"));
        assert!(stats.contains("50.0% 256,000 tokens"), "stats: {stats}");

        footer.set_context_window(128_000);
        let stats = strip_ansi(&footer.render(120).join("\n"));
        assert!(stats.contains("200.0% 256,000 tokens"), "stats: {stats}");

        footer.set_context_tokens(None);
        let stats = strip_ansi(&footer.render(120).join("\n"));
        assert!(stats.contains("0.0% 0 tokens"), "stats: {stats}");
        assert!(!stats.contains("128,000"), "stats: {stats}");
    }

    #[test]
    fn format_tokens_compacts() {
        assert_eq!(format_tokens(999), "999");
        assert_eq!(format_tokens(1_500), "1.5k");
        assert_eq!(format_tokens(40_000), "40k");
        assert_eq!(format_tokens(2_500_000), "2.5M");
    }

    #[test]
    fn exact_tokens_use_thousand_separators() {
        assert_eq!(format_exact_tokens(49), "49");
        assert_eq!(format_exact_tokens(1_000), "1,000");
        assert_eq!(format_exact_tokens(198_234), "198,234");
        assert_eq!(format_exact_tokens(1_234_567), "1,234,567");
    }

    #[test]
    fn context_bar_uses_eighth_blocks() {
        assert_eq!(format_context_bar(0.0, 10), "\u{2591}".repeat(10));
        assert_eq!(format_context_bar(100.0, 10), "\u{2588}".repeat(10));
        assert_eq!(
            format_context_bar(0.038, 10),
            "\u{258F}\u{2591}\u{2591}\u{2591}\u{2591}\u{2591}\u{2591}\u{2591}\u{2591}\u{2591}"
        );
        assert_eq!(format_context_bar(50.0, 10), "\u{2588}".repeat(5) + &"\u{2591}".repeat(5));
    }

    #[test]
    fn cwd_home_relative() {
        assert_eq!(
            format_cwd_for_footer("/home/u/proj", Some("/home/u")),
            "~/proj"
        );
        assert_eq!(format_cwd_for_footer("/home/u", Some("/home/u")), "~");
        assert_eq!(format_cwd_for_footer("/other", Some("/home/u")), "/other");
        assert_eq!(format_cwd_for_footer("/x", None), "/x");
    }
}
