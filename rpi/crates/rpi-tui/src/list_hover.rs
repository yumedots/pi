//! Hover-to-select support for lists.
//!
//! Mirrors upstream's `packages/tui/src/components/list-hover.ts`.

use crate::component::{MouseEvent, MouseEventKind};

/// A list whose selection can be moved with the mouse pointer.
pub trait HoverableList {
    /// Index of the item on the given row, or `None` when the row holds no item.
    fn index_at_row(&self, row: usize) -> Option<usize>;

    /// Move the selection to an index. Returns true when the selection changed.
    fn select(&self, index: usize) -> bool;
}

/// Move a list's selection to the item under the mouse pointer.
///
/// Only pointer motion with no button held counts as a hover. A drag carries a
/// button and belongs to the component that captured the press, so it must not
/// move the selection here.
///
/// Returns true when the selection changed, so the caller can repaint.
pub fn apply_hover(event: &MouseEvent, list: &dyn HoverableList) -> bool {
    if event.kind != MouseEventKind::Move {
        return false;
    }
    let Some(index) = list.index_at_row(event.y) else {
        return false;
    };
    list.select(index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component::MouseButton;
    use std::sync::Mutex;

    struct List {
        rows: Vec<usize>,
        selected: Mutex<usize>,
    }

    impl HoverableList for List {
        fn index_at_row(&self, row: usize) -> Option<usize> {
            self.rows.get(row).copied()
        }

        fn select(&self, index: usize) -> bool {
            let mut selected = self.selected.lock().unwrap();
            if *selected == index {
                return false;
            }
            *selected = index;
            true
        }
    }

    fn list(rows: Vec<usize>) -> List {
        List {
            rows,
            selected: Mutex::new(0),
        }
    }

    #[test]
    fn hover_moves_the_selection() {
        let list = list(vec![0, 1, 2]);
        let event = MouseEvent::new(MouseEventKind::Move, MouseButton::None, 0, 2);
        assert!(apply_hover(&event, &list));
        assert_eq!(*list.selected.lock().unwrap(), 2);
    }

    #[test]
    fn a_drag_does_not_move_the_selection() {
        let list = list(vec![0, 1, 2]);
        let event = MouseEvent::new(MouseEventKind::Drag, MouseButton::Left, 0, 2);
        assert!(!apply_hover(&event, &list));
        assert_eq!(*list.selected.lock().unwrap(), 0);
    }

    #[test]
    fn a_row_without_an_item_is_ignored() {
        let list = list(vec![0]);
        let event = MouseEvent::new(MouseEventKind::Move, MouseButton::None, 0, 5);
        assert!(!apply_hover(&event, &list));
    }
}
