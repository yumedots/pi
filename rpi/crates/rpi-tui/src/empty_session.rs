//! The empty-session screen: the spinning logo above a greeting and a centred input box.
//!
//! Port of `packages/coding-agent/src/modes/interactive/components/empty-session-screen.ts`
//! and the `Centered` wrapper next to it. The block is centred in the height the
//! caller reports, so it sits in the middle of the screen instead of at the top.

use std::any::Any;
use std::sync::Arc;

use crate::ansi::visible_width;
use crate::component::Component;

/// Width of the input box on the empty-session screen.
pub const EMPTY_SESSION_EDITOR_WIDTH: usize = 72;

/// Renders a child at a fixed maximum width, centred in the available width.
pub struct Centered {
    child: Arc<dyn Component>,
    max_width: usize,
}

impl Centered {
    /// A child rendered at `max_width` columns at most, centred in the viewport.
    pub fn new(child: Arc<dyn Component>, max_width: usize) -> Self {
        Self { child, max_width }
    }

    /// Width the child is rendered at.
    pub fn inner_width(&self, width: usize) -> usize {
        width.min(self.max_width).max(1)
    }

    /// Empty columns in front of the child.
    pub fn pad_left(&self, width: usize) -> usize {
        width.saturating_sub(self.inner_width(width)) / 2
    }
}

impl Component for Centered {
    fn render(&self, width: usize) -> Vec<String> {
        let inner = self.inner_width(width);
        let pad = " ".repeat(self.pad_left(width));
        self.child
            .render(inner)
            .into_iter()
            .map(|line| format!("{pad}{line}"))
            .collect()
    }

    fn invalidate(&self) {
        self.child.invalidate();
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

/// The empty-session screen: the spinning logo above a greeting and a centred
/// input box, the whole block centred in the screen.
pub struct EmptySessionScreen {
    logo: Arc<dyn Component>,
    greeting: String,
    editor: Arc<dyn Component>,
    available_height: Arc<dyn Fn() -> usize + Send + Sync>,
}

impl EmptySessionScreen {
    /// The screen, with the height the caller reports for the centring.
    pub fn new(
        logo: Arc<dyn Component>,
        greeting: String,
        editor: Arc<dyn Component>,
        available_height: Arc<dyn Fn() -> usize + Send + Sync>,
    ) -> Self {
        Self {
            logo,
            greeting,
            editor,
            available_height,
        }
    }

    /// The greeting above the input box.
    pub fn greeting(&self) -> &str {
        &self.greeting
    }
}

impl Component for EmptySessionScreen {
    fn render(&self, width: usize) -> Vec<String> {
        let logo_lines = self.logo.render(width);
        let pad = " ".repeat(width.saturating_sub(visible_width(&self.greeting)) / 2);
        let greeting = vec![crate::theme::theme().colors.muted.fg(&format!(
            "{pad}{}",
            self.greeting
        ))];
        let editor_lines = self.editor.render(width);
        let mut content = logo_lines;
        content.push(String::new());
        content.extend(greeting);
        content.push(String::new());
        content.extend(editor_lines);
        let height = content.len().max((self.available_height)());
        let top = height.saturating_sub(content.len()) / 2;
        let mut lines = vec![String::new(); top];
        lines.extend(content);
        lines
    }

    fn invalidate(&self) {
        self.logo.invalidate();
        self.editor.invalidate();
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixed(Vec<String>);

    impl Component for Fixed {
        fn render(&self, _width: usize) -> Vec<String> {
            self.0.clone()
        }
        fn invalidate(&self) {}
        fn as_any(&self) -> &dyn Any {
            self
        }
    }

    fn screen(greeting: &str, logo_lines: usize, editor_lines: Vec<String>, height: usize) -> EmptySessionScreen {
        let logo = Arc::new(Fixed(vec![String::new(); logo_lines]));
        let editor = Arc::new(Fixed(editor_lines));
        EmptySessionScreen::new(
            logo,
            greeting.to_string(),
            editor,
            Arc::new(move || height),
        )
    }

    #[test]
    fn the_greeting_is_centred_in_the_width() {
        let screen = screen(
            "Hi Gabriel, what are we building today?",
            1,
            vec!["> ".to_string()],
            10,
        );
        let lines = screen.render(100);
        let index = lines
            .iter()
            .position(|line| line.contains("Hi Gabriel"))
            .expect("the greeting is on screen");
        let greeting = crate::strip_ansi(&lines[index]);
        assert_eq!(
            greeting.trim_start_matches(' '),
            "Hi Gabriel, what are we building today?"
        );
        assert_eq!(greeting.len() - greeting.trim_start_matches(' ').len(), 30);
    }

    #[test]
    fn the_block_is_centred_in_the_height() {
        let screen = screen("Hi there", 1, vec!["> ".to_string()], 10);
        let lines = screen.render(40);
        assert_eq!(lines.len(), 7);
        assert_eq!(lines[0], "");
        assert_eq!(lines[1], "");
        assert_eq!(crate::strip_ansi(&lines[4]).trim(), "Hi there");
    }

    #[test]
    fn the_editor_follows_the_greeting_after_a_blank_line() {
        let screen = screen(
            "Hi there",
            2,
            vec![String::new(), "> ".to_string()],
            12,
        );
        let lines = screen.render(40);
        let greeting = lines.iter().position(|line| line.contains("Hi there")).unwrap();
        assert_eq!(lines[greeting + 1], "");
        assert_eq!(lines[greeting + 2], "");
        assert_eq!(lines[greeting + 3], "> ");
    }

    #[test]
    fn a_centered_child_is_rendered_at_its_max_width() {
        let child = Arc::new(Fixed(vec!["x".to_string()]));
        let centered = Centered::new(child, 72);
        assert_eq!(centered.inner_width(100), 72);
        assert_eq!(centered.pad_left(100), 14);
        assert_eq!(centered.render(100), vec!["              x".to_string()]);
        assert_eq!(centered.inner_width(40), 40);
        assert_eq!(centered.pad_left(40), 0);
    }
}
