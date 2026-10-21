//! A clickable indicator composited inside the primary transcript viewport.
use std::sync::{Arc, Mutex};

use crossterm::event::{MouseButton, MouseEvent, MouseEventKind};

use crate::layout::{composite_tui_line, LayoutBox, LayoutFrame, LayoutRect};
use crate::utils::{truncate_to_width, visible_width};

type Label = Arc<dyn Fn() -> String + Send + Sync>;

#[derive(Default)]
struct State {
    label: Option<Label>,
    rect: Option<LayoutRect>,
}

#[derive(Default)]
pub(crate) struct JumpToEnd {
    state: Mutex<State>,
}

impl JumpToEnd {
    pub fn set_label(&self, label: Option<Label>) {
        let mut state = self.state.lock().unwrap();
        state.label = label;
        state.rect = None;
    }

    pub fn paint(&self, frame: &LayoutFrame, screen: &mut [String], has_overlay: bool) {
        let label = {
            let mut state = self.state.lock().unwrap();
            state.rect = None;
            state.label.clone()
        };
        let Some(label) = label else {
            return;
        };
        let Some(scroll) = &frame.primary_scroll_view else {
            return;
        };
        if has_overlay || !scroll.follows_end() || scroll.is_following_end() {
            return;
        }
        let Some(view) = primary_box(&frame.root) else {
            return;
        };
        let clip = view.clip;
        if clip.width == 0 || clip.height == 0 {
            return;
        }
        // The label lands on the row below the transcript, so it does not paint
        // over the last row of it. Without room there it stays on that row.
        // (packages/tui/src/tui-alt-screen.ts:1684-1687, the app's
        // `scrollToEndIndicatorPlacement: "below-scroll-view"`.)
        let below = clip.y + clip.height < screen.len();
        let row = if below {
            clip.y + clip.height
        } else {
            clip.y + clip.height - 1
        };
        let Some(line) = screen.get_mut(row) else {
            return;
        };
        // Graphics placements and cursor-bearing components own their rows.
        if line.contains("\x1b_G")
            || line.contains("\x1b]1337;File=")
            || line.contains(crate::ansi::CURSOR_MARKER)
        {
            return;
        }
        // Below the scroll view the label is anchored to the right edge of the
        // screen; on the last row of the view it stops at the scrollbar column
        // so it does not move when the scrollbar appears.
        // (packages/tui/src/tui-alt-screen.ts:1689-1698.)
        let scrollbar = (scroll.is_scrollbar_visible() && view.rect.width > 0)
            .then_some(view.rect.x + view.rect.width.saturating_sub(1))
            .filter(|column| *column >= clip.x && *column < clip.x + clip.width);
        let right_edge = if below {
            frame.width
        } else {
            scrollbar.unwrap_or(clip.x + clip.width)
        };
        let label = truncate_to_width(&label(), right_edge.saturating_sub(clip.x), "");
        let width = visible_width(&label);
        if width == 0 {
            return;
        }
        let column = right_edge - width;
        *line = composite_tui_line(line, &label, column, width, frame.width);
        self.state.lock().unwrap().rect = Some(LayoutRect::new(column, row, width, 1));
    }

    pub fn hit(&self, event: &MouseEvent) -> bool {
        event.kind == MouseEventKind::Down(MouseButton::Left)
            && self
                .state
                .lock()
                .unwrap()
                .rect
                .is_some_and(|rect| rect.contains(event.column as usize, event.row as usize))
    }
}

fn primary_box(node: &LayoutBox) -> Option<&LayoutBox> {
    if node
        .scroll_view
        .as_ref()
        .is_some_and(|scroll| scroll.is_primary())
    {
        return Some(node);
    }
    node.children.iter().find_map(primary_box)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scroll_view::ScrollbarMode;
    use crate::{
        Component, FollowMode, ScrollView, ScrollViewOptions, StackChild, StackEntry, Text, VStack,
    };
    use crossterm::event::KeyModifiers;

    fn scene(
        width: usize,
        follow: FollowMode,
        scrollbar: ScrollbarMode,
    ) -> (Arc<ScrollView>, Arc<dyn Component>, JumpToEnd) {
        let text = Arc::new(Text::new(
            (1..=20)
                .map(|n| format!("line {n}"))
                .collect::<Vec<_>>()
                .join("\n"),
            0,
            0,
        ));
        let scroll = Arc::new(ScrollView::new(
            text,
            ScrollViewOptions {
                primary: true,
                follow,
                scrollbar,
                ..Default::default()
            },
        ));
        let root: Arc<dyn Component> = Arc::new(VStack::from_children(vec![
            StackChild::Entry(StackEntry::new(scroll.clone()).basis(0).grow(1).min_size(1)),
            StackChild::Entry(StackEntry::new(Arc::new(Text::new("editor\nfooter", 0, 0)))),
        ]));
        crate::layout::render_layout_frame(root.clone(), width, 6);
        let indicator = JumpToEnd::default();
        indicator.set_label(Some(Arc::new(|| " ↓ Jump to end ".to_owned())));
        (scroll, root, indicator)
    }

    #[test]
    fn the_indicator_is_below_the_transcript_and_only_the_label_captures_presses() {
        let (scroll, root, indicator) = scene(30, FollowMode::End, ScrollbarMode::Hidden);
        let frame = crate::layout::render_layout_frame(root.clone(), 30, 6);
        let mut lines = frame.lines.clone();
        indicator.paint(&frame, &mut lines, false);
        assert!(indicator.state.lock().unwrap().rect.is_none());
        scroll.scroll_by(-3);
        let frame = crate::layout::render_layout_frame(root, 30, 6);
        let mut lines = frame.lines.clone();
        indicator.paint(&frame, &mut lines, false);
        // The label lands on the row below the transcript, so it does not
        // paint over the last row of it.
        assert!(lines[4].contains("Jump to end"), "{lines:?}");
        assert!(!lines[3].contains("Jump to end"), "{lines:?}");
        assert_eq!(lines[5].trim_end(), "footer");
        let rect = indicator.state.lock().unwrap().rect.unwrap();
        assert_eq!(rect.y, 4);
        let mut mouse = MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: rect.x as u16,
            row: rect.y as u16,
            modifiers: KeyModifiers::NONE,
        };
        assert!(indicator.hit(&mouse));
        mouse.column = (rect.x + rect.width) as u16;
        assert!(!indicator.hit(&mouse));
        mouse.column = rect.x as u16;
        for kind in [
            MouseEventKind::Up(MouseButton::Left),
            MouseEventKind::Drag(MouseButton::Left),
            MouseEventKind::Down(MouseButton::Right),
        ] {
            mouse.kind = kind;
            assert!(!indicator.hit(&mouse));
        }
    }

    #[test]
    fn a_wide_label_below_the_transcript_spans_to_the_screen_edge() {
        for width in [1, 2, 5, 30] {
            let (scroll, root, indicator) = scene(width, FollowMode::End, ScrollbarMode::Always);
            scroll.scroll_by(-3);
            let frame = crate::layout::render_layout_frame(root, width, 6);
            indicator.set_label(Some(Arc::new(|| "跳到末尾".repeat(20))));
            let mut lines = frame.lines.clone();
            indicator.paint(&frame, &mut lines, false);
            let rect = indicator.state.lock().unwrap().rect;
            if let Some(rect) = rect {
                // Below the scroll view the label reaches the screen edge: the
                // scrollbar does not reach there.
                assert_eq!(rect.x + rect.width, width, "the label ends at the edge");
                assert!(visible_width(&lines[rect.y]) <= width);
            }
        }
    }

    #[test]
    fn the_indicator_is_right_aligned_next_to_a_fixed_sidebar() {
        use crate::HStack;
        let (scroll, _, indicator) = scene(37, FollowMode::End, ScrollbarMode::Hidden);
        scroll.scroll_by(-3);
        indicator.set_label(Some(Arc::new(|| " Jump ".to_owned())));
        let root = Arc::new(HStack::from_entries(vec![
            StackEntry::new(Arc::new(Text::new("bar", 0, 0))).basis(3),
            StackEntry::new(scroll).basis(0).grow(1),
        ]));
        let frame = crate::layout::render_layout_frame(root, 40, 4);
        let mut lines = frame.lines.clone();
        indicator.paint(&frame, &mut lines, false);
        let rect = indicator.state.lock().unwrap().rect.unwrap();
        // The scroll view fills the height here, so there is no row below it
        // and the label stays on its last row, anchored to the screen edge.
        assert_eq!(rect.x + rect.width, 40);
        assert_eq!(rect.y, 3);
        let visible = crate::ansi::strip_ansi(&lines[3]);
        assert_eq!(visible.find(" Jump ").unwrap(), rect.x);
    }

    #[test]
    fn non_following_views_modal_overlays_and_image_rows_have_no_indicator() {
        let (scroll, root, indicator) = scene(40, FollowMode::None, ScrollbarMode::Hidden);
        let frame = crate::layout::render_layout_frame(root, 40, 6);
        let mut lines = frame.lines.clone();
        indicator.paint(&frame, &mut lines, false);
        assert!(indicator.state.lock().unwrap().rect.is_none());
        assert!(!scroll.follows_end());
        let (scroll, root, indicator) = scene(40, FollowMode::End, ScrollbarMode::Hidden);
        scroll.scroll_by(-3);
        let frame = crate::layout::render_layout_frame(root, 40, 6);
        let mut lines = frame.lines.clone();
        indicator.paint(&frame, &mut lines, true);
        assert!(indicator.state.lock().unwrap().rect.is_none());
        // The row the label would land on owns the image, so it is left alone.
        lines[4] = "\x1b_Ga=T;image\x1b\\".to_owned();
        indicator.paint(&frame, &mut lines, false);
        assert!(indicator.state.lock().unwrap().rect.is_none());
        assert_eq!(lines[4], "\x1b_Ga=T;image\x1b\\");
    }
}
