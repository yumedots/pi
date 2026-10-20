//! Branch and compaction summary cards.
//!
//! Port of
//! `packages/coding-agent/src/modes/interactive/components/branch-summary-message.ts`
//! and
//! `packages/coding-agent/src/modes/interactive/components/compaction-summary-message.ts`.
//!
//! Both cards show a label, a blank line and either a collapsed hint or the
//! full summary. They use the same background colour as custom messages.

use std::any::Any;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use super::box_component::Box;
use super::component::{Component, MouseButton, MouseEvent, MouseEventKind, MouseEventResult};
use super::container::Container;
use super::markdown::Markdown;
use super::spacer::Spacer;
use super::text::Text;
use crate::ansi::bold;
use crate::keybinding_hints::key_text;
use crate::theme::{theme, theme_revision};

/// The label of the branch card.
pub const BRANCH_LABEL: &str = "[branch]";
/// The label of the compaction card.
pub const COMPACTION_LABEL: &str = "[compaction]";

/// Format a number with thousands separators, like `toLocaleString()`.
pub fn format_thousands(value: u64) -> String {
    let digits = value.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    let bytes = digits.as_bytes();
    for (index, byte) in bytes.iter().enumerate() {
        if index > 0 && (bytes.len() - index) % 3 == 0 {
            out.push(',');
        }
        out.push(*byte as char);
    }
    out
}

/// The content of a card, in its collapsed or expanded form.
enum Body {
    /// The collapsed hint line.
    Collapsed(String),
    /// The markdown source of the expanded summary.
    Expanded(String),
}

/// Build the card box for a label and a body.
fn build_box(label: &str, body: Body) -> Box {
    let colors = theme().colors;
    let content = Container::new();

    content.add_child(Arc::new(Text::new(
        colors.custom_message_label.fg(&bold(label)),
        0,
        0,
    )));
    content.add_child(Arc::new(Spacer::new(1)));

    match body {
        Body::Collapsed(text) => {
            content.add_child(Arc::new(Text::new(text, 0, 0)));
        }
        Body::Expanded(source) => {
            let markdown = Markdown::new(source, 0, 0)
                .with_base_style(colors.custom_message_text.to_fg());
            content.add_child(Arc::new(markdown));
        }
    }

    let bg = colors.custom_message_bg;
    let card = Box::new(1, 1);
    card.set_bg_fn(Some(Arc::new(move |text: &str| bg.bg(text))));
    card.add_child(Arc::new(content));
    card
}

/// The collapsed hint of the branch card.
fn branch_collapsed() -> String {
    let colors = theme().colors;
    format!(
        "{}{}{}",
        colors.custom_message_text.fg("Branch summary ("),
        colors.dim.fg(&key_text("app.tools.expand")),
        colors.custom_message_text.fg(" to expand)")
    )
}

/// The collapsed hint of the compaction card.
fn compaction_collapsed(tokens_before: u64) -> String {
    let colors = theme().colors;
    format!(
        "{}{}{}",
        colors
            .custom_message_text
            .fg(&format!("Compacted from {} tokens (", format_thousands(tokens_before))),
        colors.dim.fg(&key_text("app.tools.expand")),
        colors.custom_message_text.fg(" to expand)")
    )
}

/// Which kind of summary a card shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CardKind {
    /// A branch summary.
    Branch,
    /// A compaction summary.
    Compaction,
}

/// Shared state of a summary card.
struct CardState {
    kind: CardKind,
    summary: String,
    tokens_before: u64,
    expanded: Mutex<bool>,
    inner: Mutex<Box>,
    built_expanded: AtomicBool,
    built_revision: AtomicU64,
}

/// A branch summary card with collapsed/expanded state.
pub struct BranchSummaryCard {
    state: CardState,
}

/// A compaction summary card with collapsed/expanded state.
pub struct CompactionSummaryCard {
    state: CardState,
}

impl CardState {
    /// Build the box for the current expansion state.
    fn build(&self, expanded: bool) -> Box {
        match self.kind {
            CardKind::Branch => {
                if expanded {
                    build_box(
                        BRANCH_LABEL,
                        Body::Expanded(format!("**Branch Summary**\n\n{}", self.summary)),
                    )
                } else {
                    build_box(BRANCH_LABEL, Body::Collapsed(branch_collapsed()))
                }
            }
            CardKind::Compaction => {
                if expanded {
                    build_box(
                        COMPACTION_LABEL,
                        Body::Expanded(format!(
                            "**Compacted from {} tokens**\n\n{}",
                            format_thousands(self.tokens_before),
                            self.summary
                        )),
                    )
                } else {
                    build_box(
                        COMPACTION_LABEL,
                        Body::Collapsed(compaction_collapsed(self.tokens_before)),
                    )
                }
            }
        }
    }

    /// Render the card, rebuilding it when the state changed.
    fn render(&self, width: usize) -> Vec<String> {
        let expanded = self.expanded.lock().map(|e| *e).unwrap_or(false);
        let revision = theme_revision();
        if self.built_expanded.load(Ordering::Acquire) != expanded
            || self.built_revision.load(Ordering::Acquire) != revision
        {
            let built = self.build(expanded);
            if let Ok(mut inner) = self.inner.lock() {
                *inner = built;
            }
            self.built_expanded.store(expanded, Ordering::Release);
            self.built_revision.store(revision, Ordering::Release);
        }

        match self.inner.lock() {
            Ok(inner) => inner.render(width),
            Err(_) => Vec::new(),
        }
    }

    /// Set the expansion state.
    fn set_expanded(&self, expanded: bool) {
        if let Ok(mut current) = self.expanded.lock() {
            *current = expanded;
        }
    }

    /// The expansion state.
    fn is_expanded(&self) -> bool {
        self.expanded.lock().map(|e| *e).unwrap_or(false)
    }
}

impl BranchSummaryCard {
    /// Create a branch summary card.
    pub fn new(summary: &str) -> Self {
        Self {
            state: CardState {
                kind: CardKind::Branch,
                summary: summary.to_string(),
                tokens_before: 0,
                expanded: Mutex::new(false),
                inner: Mutex::new(build_box(
                    BRANCH_LABEL,
                    Body::Collapsed(branch_collapsed()),
                )),
                built_expanded: AtomicBool::new(false),
                built_revision: AtomicU64::new(theme_revision()),
            },
        }
    }
}

impl CompactionSummaryCard {
    /// Create a compaction summary card.
    pub fn new(summary: &str, tokens_before: u64) -> Self {
        Self {
            state: CardState {
                kind: CardKind::Compaction,
                summary: summary.to_string(),
                tokens_before,
                expanded: Mutex::new(false),
                inner: Mutex::new(build_box(
                    COMPACTION_LABEL,
                    Body::Collapsed(compaction_collapsed(tokens_before)),
                )),
                built_expanded: AtomicBool::new(false),
                built_revision: AtomicU64::new(theme_revision()),
            },
        }
    }
}

/// Toggle the card on a left click, like the original's mouse region.
fn toggle_on_click(
    event: &MouseEvent,
    expanded: &dyn Fn() -> bool,
    set_expanded: &dyn Fn(bool),
) -> Option<MouseEventResult> {
    if event.kind != MouseEventKind::Click || event.button != MouseButton::Left {
        return None;
    }
    set_expanded(!expanded());
    Some(MouseEventResult::handled())
}

impl Component for BranchSummaryCard {
    fn render(&self, width: usize) -> Vec<String> {
        self.state.render(width)
    }

    fn handle_mouse(&self, event: &MouseEvent) -> Option<MouseEventResult> {
        toggle_on_click(
            event,
            &|| self.state.is_expanded(),
            &|expanded| self.state.set_expanded(expanded),
        )
    }

    fn invalidate(&self) {
        // The card is rebuilt on the next render when the theme changed.
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

impl Component for CompactionSummaryCard {
    fn render(&self, width: usize) -> Vec<String> {
        self.state.render(width)
    }

    fn handle_mouse(&self, event: &MouseEvent) -> Option<MouseEventResult> {
        toggle_on_click(
            event,
            &|| self.state.is_expanded(),
            &|expanded| self.state.set_expanded(expanded),
        )
    }

    fn invalidate(&self) {
        // The card is rebuilt on the next render when the theme changed.
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

impl BranchSummaryCard {
    /// Expand or collapse the card.
    pub fn set_expanded(&self, expanded: bool) {
        self.state.set_expanded(expanded);
    }

    /// Whether the card is expanded.
    pub fn is_expanded(&self) -> bool {
        self.state.is_expanded()
    }
}

impl CompactionSummaryCard {
    /// Expand or collapse the card.
    pub fn set_expanded(&self, expanded: bool) {
        self.state.set_expanded(expanded);
    }

    /// Whether the card is expanded.
    pub fn is_expanded(&self) -> bool {
        self.state.is_expanded()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ansi::strip_ansi;

    fn plain(lines: &[String]) -> String {
        lines.iter().map(|l| strip_ansi(l)).collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn test_format_thousands() {
        assert_eq!(format_thousands(0), "0");
        assert_eq!(format_thousands(12), "12");
        assert_eq!(format_thousands(123), "123");
        assert_eq!(format_thousands(1234), "1,234");
        assert_eq!(format_thousands(12345), "12,345");
        assert_eq!(format_thousands(1234567), "1,234,567");
    }

    #[test]
    fn test_branch_card_collapsed() {
        let card = BranchSummaryCard::new("The summary text.");
        let lines = card.render(60);
        let text = plain(&lines);
        assert!(text.contains("[branch]"), "{text}");
        assert!(text.contains("Branch summary ("), "{text}");
        assert!(text.contains("to expand)"), "{text}");
        assert!(!card.is_expanded());
    }

    #[test]
    fn test_branch_card_expanded() {
        let card = BranchSummaryCard::new("The summary text.");
        card.set_expanded(true);
        assert!(card.is_expanded());
        let lines = card.render(60);
        let text = plain(&lines);
        assert!(text.contains("Branch Summary"), "{text}");
        assert!(text.contains("The summary text."), "{text}");
    }

    #[test]
    fn test_compaction_card_collapsed() {
        let card = CompactionSummaryCard::new("The summary text.", 12345);
        let lines = card.render(60);
        let text = plain(&lines);
        assert!(text.contains("[compaction]"), "{text}");
        assert!(text.contains("Compacted from 12,345 tokens ("), "{text}");
        assert!(text.contains("to expand)"), "{text}");
    }

    #[test]
    fn test_compaction_card_expanded() {
        let card = CompactionSummaryCard::new("The summary text.", 12345);
        card.set_expanded(true);
        let lines = card.render(60);
        let text = plain(&lines);
        assert!(text.contains("Compacted from 12,345 tokens"), "{text}");
        assert!(text.contains("The summary text."), "{text}");
    }

    #[test]
    fn test_click_toggles_the_card() {
        let card = BranchSummaryCard::new("The summary text.");
        let event = MouseEvent::new(MouseEventKind::Click, MouseButton::Left, 0, 0);
        let result = card.handle_mouse(&event);
        assert!(result.is_some());
        assert!(card.is_expanded());
        card.handle_mouse(&event);
        assert!(!card.is_expanded());
    }
}
