//! Text component for simple text rendering.

use std::sync::{Arc, Mutex};

use std::any::Any;

use super::component::Component;

/// Simple text component with optional padding.
pub struct Text {
    content: Mutex<String>,
    padding_x: usize,
    padding_y: usize,
    /// Paints the row with a background, like the original's `customBgFn`.
    background: Mutex<Option<Arc<dyn Fn(&str) -> String + Send + Sync>>>,
    /// Render cache keyed by (content, width). A finalized `Text` row is
    /// re-rendered on every repaint of a long transcript; caching the wrapped
    /// lines keeps that cheap. Mirrors upstream `Text.cachedText/cachedLines`.
    cache: Mutex<Option<TextCache>>,
}

#[derive(Clone)]
struct TextCache {
    content: String,
    width: usize,
    theme_revision: u64,
    lines: Vec<String>,
}

impl Text {
    /// Create a new text component.
    pub fn new(content: impl Into<String>, padding_x: usize, padding_y: usize) -> Self {
        Self {
            content: Mutex::new(content.into()),
            padding_x,
            padding_y,
            background: Mutex::new(None),
            cache: Mutex::new(None),
        }
    }

    /// Paint every row with a background, like the original's
    /// `setCustomBgFn`.
    pub fn set_background(&self, background: Option<Arc<dyn Fn(&str) -> String + Send + Sync>>) {
        if let Ok(mut guard) = self.background.lock() {
            *guard = background;
        }
        self.invalidate();
    }

    /// Set the text content.
    pub fn set_text(&self, text: impl Into<String>) {
        if let Ok(mut content) = self.content.lock() {
            *content = text.into();
        }
        if let Ok(mut cache) = self.cache.lock() {
            *cache = None;
        }
    }

    /// Get the text content.
    pub fn get_text(&self) -> String {
        self.content.lock().map(|c| c.clone()).unwrap_or_default()
    }
}

impl Component for Text {
    fn render(&self, width: usize) -> Vec<String> {
        let content = self.content.lock().map(|c| c.clone()).unwrap_or_default();
        let theme_revision = crate::theme::theme_revision();

        if let Ok(cache) = self.cache.lock() {
            if let Some(cached) = cache.as_ref() {
                if cached.width == width
                    && cached.content == content
                    && cached.theme_revision == theme_revision
                {
                    return cached.lines.clone();
                }
            }
        }

        let mut lines = Vec::new();

        // A blank text draws nothing at all.
        if content.trim().is_empty() {
            if let Ok(mut cache) = self.cache.lock() {
                *cache = Some(TextCache {
                    content,
                    width,
                    theme_revision,
                    lines: Vec::new(),
                });
            }
            return Vec::new();
        }

        // The margins sit on both sides, so the text wraps inside them.
        let padding_x = self.padding_x.min(width.saturating_sub(1) / 2);
        let content_width = width.saturating_sub(padding_x * 2).max(1);
        let left_margin = " ".repeat(padding_x);
        let right_margin = " ".repeat(padding_x);

        let normalized = content.replace('\t', "   ");
        for line in crate::utils::wrap_text_with_ansi(&normalized, content_width) {
            let with_margins = format!("{left_margin}{line}{right_margin}");
            let visible = crate::ansi::visible_width(&with_margins);
            let padded = format!("{with_margins}{}", " ".repeat(width.saturating_sub(visible)));
            let background = self.background.lock().ok().and_then(|guard| guard.clone());
            match background {
                Some(background) => lines.push(background(&padded)),
                None => lines.push(padded),
            }
        }

        let empty_line = " ".repeat(width);
        let mut result = Vec::with_capacity(lines.len() + self.padding_y * 2);
        for _ in 0..self.padding_y {
            result.push(empty_line.clone());
        }
        result.extend(lines);
        for _ in 0..self.padding_y {
            result.push(empty_line.clone());
        }
        let lines = if result.is_empty() {
            vec![String::new()]
        } else {
            result
        };

        if let Ok(mut cache) = self.cache.lock() {
            *cache = Some(TextCache {
                content,
                width,
                theme_revision,
                lines: lines.clone(),
            });
        }
        lines
    }

    fn invalidate(&self) {
        if let Ok(mut cache) = self.cache.lock() {
            *cache = None;
        }
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component::Component;

    #[test]
    fn the_text_insets_both_sides_and_pads_the_row() {
        let warning = "Warning: tmux extended-keys is off. Modified Enter keys may not work. Add `set -g extended-keys on` to ~/.tmux.conf and restart tmux.";
        let text = Text::new(warning, 1, 0);
        let lines = text.render(100);
        assert_eq!(lines.len(), 2);
        // The text wraps inside the margins, so the row is 98 columns wide.
        assert!(lines[0].starts_with(' '), "{:?}", lines[0]);
        assert!(lines[0].trim_end().ends_with("extended-keys"), "{:?}", lines[0]);
        assert_eq!(crate::ansi::visible_width(&lines[0]), 100);
        assert_eq!(crate::ansi::visible_width(&lines[1]), 100);
        assert!(lines[1].starts_with(" on`"), "{:?}", lines[1]);
    }

    #[test]
    fn a_blank_text_draws_nothing() {
        let text = Text::new("   ", 1, 1);
        assert!(text.render(40).is_empty());
    }

    #[test]
    fn the_background_paints_the_whole_row() {
        let text = Text::new("hi", 0, 0);
        text.set_background(Some(Arc::new(|line: &str| format!("\x1b[44m{line}\x1b[0m"))));
        let lines = text.render(10);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].starts_with("\x1b[44m"), "{:?}", lines[0]);
        assert_eq!(crate::ansi::visible_width(&lines[0]), 10);
    }

    /// Regression: rendering a line wider than the layout column used to
    /// byte-slice `padded[..width]` and panic mid-character on multi-byte
    /// chars — "end byte index 120 is not a char boundary; it is inside
    /// '⏎' (bytes 119..122)". Truncation must never split a char: it keeps
    /// whole chars whose visible width fits the column.
    #[test]
    fn render_truncates_multibyte_at_char_boundary() {
        let t = Text::new("x⏎y", 0, 0);
        // Width 1: only 'x' fits (the 3-byte ⏎ is dropped whole, never split).
        let out = t.render(1);
        assert_eq!(out[0], "x");
        // Width 2: 'x' + '⏎' (⏎ is visible-width 1) — whole chars only.
        let out = t.render(2);
        assert_eq!(out[0], "x⏎");
        // Width 3: everything fits unchanged.
        let out = t.render(3);
        assert_eq!(out[0], "x⏎y");
    }

    #[test]
    fn render_keeps_ansi_and_truncates() {
        let styled = "\x1b[31mred\x1b[0m text";
        let t = Text::new(styled, 0, 0);
        let out = t.render(3);
        // No panic on ANSI content; visible width respected.
        assert!(crate::ansi::visible_width(&out[0]) <= 3);
    }
}
