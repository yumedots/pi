//! Earendil announcement banner.
//!
//! Port of
//! `packages/coding-agent/src/modes/interactive/components/earendil-announcement.ts`.
//!
//! The original also renders a bundled PNG (`clankolas.png`) between the blog
//! link and the closing border. The port has no bundled asset, so the image
//! slot stays empty but the blank lines around it are kept.

use std::any::Any;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use super::component::Component;
use super::container::Container;
use super::dynamic_border::DynamicBorder;
use super::spacer::Spacer;
use super::text::Text;
use crate::ansi::bold;
use crate::theme::{theme, theme_revision};

/// The blog post the banner links to.
pub const BLOG_URL: &str = "https://mariozechner.at/posts/2026-04-08-ive-sold-out/";

/// The title of the banner.
pub const TITLE: &str = "pi has joined Earendil";

/// Build the banner content.
fn build_container() -> Container {
    let colors = theme().colors;
    let container = Container::new();

    container.add_child(Arc::new(DynamicBorder::with_color(colors.accent)));
    container.add_child(Arc::new(Text::new(
        bold(&colors.accent.fg(TITLE)),
        1,
        0,
    )));
    container.add_child(Arc::new(Spacer::new(1)));
    container.add_child(Arc::new(Text::new(
        colors.muted.fg("Read the blog post:"),
        1,
        0,
    )));
    container.add_child(Arc::new(Text::new(colors.md_link.fg(BLOG_URL), 1, 0)));
    container.add_child(Arc::new(Spacer::new(1)));
    container.add_child(Arc::new(Spacer::new(1)));
    container.add_child(Arc::new(DynamicBorder::with_color(colors.accent)));

    container
}

/// The Earendil announcement banner.
pub struct AnnouncementComponent {
    container: Mutex<Container>,
    built_revision: AtomicU64,
}

impl AnnouncementComponent {
    /// Create the announcement banner.
    pub fn new() -> Self {
        Self {
            container: Mutex::new(build_container()),
            built_revision: AtomicU64::new(theme_revision()),
        }
    }
}

impl Default for AnnouncementComponent {
    fn default() -> Self {
        Self::new()
    }
}

impl Component for AnnouncementComponent {
    fn render(&self, width: usize) -> Vec<String> {
        let revision = theme_revision();
        if self.built_revision.load(Ordering::Acquire) != revision {
            if let Ok(mut container) = self.container.lock() {
                *container = build_container();
            }
            self.built_revision.store(revision, Ordering::Release);
        }

        match self.container.lock() {
            Ok(container) => container.render(width),
            Err(_) => Vec::new(),
        }
    }

    fn invalidate(&self) {
        // The content is rebuilt on the next render when the theme changed.
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ansi::strip_ansi;

    #[test]
    fn test_renders_title_link_and_borders() {
        let component = AnnouncementComponent::new();
        let lines = component.render(60);
        let plain: Vec<String> = lines.iter().map(|l| strip_ansi(l)).collect();
        let text = plain.join("\n");

        assert!(text.contains(TITLE), "missing title in:\n{text}");
        assert!(text.contains("Read the blog post:"), "missing intro in:\n{text}");
        assert!(text.contains(BLOG_URL), "missing url in:\n{text}");

        let borders = plain
            .iter()
            .filter(|line| !line.is_empty() && line.chars().all(|c| c == '─'))
            .count();
        assert_eq!(borders, 2, "expected two borders in:\n{text}");
    }

    #[test]
    fn test_borders_use_the_accent_color() {
        let component = AnnouncementComponent::new();
        let lines = component.render(40);
        let accent = theme().colors.accent.to_fg();
        assert!(lines[0].contains(&accent), "top border is not accent");
        let last = lines.last().unwrap();
        assert!(last.contains(&accent), "bottom border is not accent");
    }

    #[test]
    fn test_layout_has_the_blank_lines_around_the_image_slot() {
        let component = AnnouncementComponent::new();
        let lines = component.render(60);
        let plain: Vec<String> = lines.iter().map(|l| strip_ansi(l)).collect();

        let title_index = plain
            .iter()
            .position(|line| line.contains(TITLE))
            .expect("title line");
        let url_index = plain
            .iter()
            .position(|line| line.contains(BLOG_URL))
            .expect("url line");

        assert!(plain[title_index + 1].trim().is_empty(), "expected blank line");
        assert_eq!(plain[url_index + 1].trim(), "", "expected blank line");
        assert_eq!(plain[url_index + 2].trim(), "", "expected blank line");
    }
}
