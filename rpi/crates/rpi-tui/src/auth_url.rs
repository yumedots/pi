//! Sign-in URL with a click hint and a copy hint.
//!
//! Port of `packages/coding-agent/src/modes/interactive/components/auth-url.ts`.
//!
//! Hosts call [`AuthUrlComponent::set_hint`] when `app.message.copy` is
//! pressed, since a long URL wraps and often cannot be selected or clicked as
//! a whole (SSH, tmux).

use std::any::Any;
use std::sync::Arc;

use super::component::Component;
use super::container::Container;
use super::text::Text;
use crate::ansi::hyperlink;
use crate::keybinding_hints::key_text;
use crate::theme::theme;

/// The click hint, per platform.
fn click_hint() -> &'static str {
    if cfg!(target_os = "macos") {
        "Cmd+click to open"
    } else {
        "Ctrl+click to open"
    }
}

/// The default suffix: the copy key hint.
fn default_suffix() -> String {
    let colors = theme().colors;
    format!(
        "{}{}",
        colors.dim.fg(&key_text("app.message.copy")),
        colors.muted.fg(" to copy")
    )
}

/// A sign-in URL with a click hint and a copy hint.
pub struct AuthUrlComponent {
    container: Container,
    url: String,
    hint: Arc<Text>,
}

impl AuthUrlComponent {
    /// Create the component for `url`.
    pub fn new(url: impl Into<String>) -> Self {
        let url = url.into();
        let colors = theme().colors;

        let container = Container::new();
        container.add_child(Arc::new(Text::new(
            colors.accent.fg(&hyperlink(&url, &url)),
            1,
            0,
        )));
        let hint = Arc::new(Text::new("", 1, 0));
        container.add_child(hint.clone());

        let component = Self {
            container,
            url,
            hint,
        };
        component.set_hint(&default_suffix());
        component
    }

    /// The URL shown by the component.
    pub fn url(&self) -> &str {
        &self.url
    }

    /// Replace the suffix of the hint line.
    ///
    /// The text is used verbatim, so a caller can pass a pre-colored status
    /// like `theme().colors.success.fg("Copied URL to clipboard")`.
    pub fn set_hint(&self, text: &str) {
        let colors = theme().colors;
        let hint = format!(
            "{} {} {}",
            colors.dim.fg(&hyperlink(&self.url, click_hint())),
            colors.dim.fg("•"),
            text
        );
        self.hint.set_text(hint);
    }
}

impl Component for AuthUrlComponent {
    fn render(&self, width: usize) -> Vec<String> {
        self.container.render(width)
    }

    fn invalidate(&self) {
        // The children cache their own output.
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ansi::strip_ansi;

    const URL: &str = "https://example.com/auth?code=abc123";

    #[test]
    fn test_renders_the_url_and_the_hints() {
        let component = AuthUrlComponent::new(URL);
        let lines = component.render(80);
        assert_eq!(lines.len(), 2);

        let first = strip_ansi(&lines[0]);
        assert!(first.contains(URL), "missing url in: {first}");

        let second = strip_ansi(&lines[1]);
        let expected_click = if cfg!(target_os = "macos") {
            "Cmd+click to open"
        } else {
            "Ctrl+click to open"
        };
        assert!(second.contains(expected_click), "missing click hint: {second}");
        assert!(second.contains('•'), "missing separator: {second}");
        assert!(second.contains("to copy"), "missing copy hint: {second}");
    }

    #[test]
    fn test_url_is_a_hyperlink() {
        let component = AuthUrlComponent::new(URL);
        let lines = component.render(80);
        assert!(lines[0].contains("\x1b]8;;"), "url is not a hyperlink");
        assert!(lines[1].contains("\x1b]8;;"), "click hint is not a hyperlink");
    }

    #[test]
    fn test_url_accessor() {
        let component = AuthUrlComponent::new(URL);
        assert_eq!(component.url(), URL);
    }

    #[test]
    fn test_set_hint_replaces_the_suffix() {
        let component = AuthUrlComponent::new(URL);
        component.set_hint("Copied URL to clipboard");
        let lines = component.render(80);
        let second = strip_ansi(&lines[1]);
        assert!(second.contains("Copied URL to clipboard"), "{second}");
        assert!(!second.contains("to copy"), "{second}");
    }
}
