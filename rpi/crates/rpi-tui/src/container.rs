//! Container component that holds multiple child components.

use std::any::Any;
use std::sync::{Arc, Mutex};

use super::component::{Component, MouseEvent, MouseEventResult};
use super::mouse::dispatch_mouse_event;

/// Container - a component that contains other components.
///
/// Children are rendered in order, vertically stacked.
#[derive(Clone)]
pub struct Container {
    children: Arc<Mutex<Vec<Arc<dyn Component>>>>,
    /// Height of every child of the last render, used to route a mouse event
    /// to the child under the pointer.
    child_heights: Arc<Mutex<Vec<usize>>>,
}

impl Container {
    /// Create a new empty container.
    pub fn new() -> Self {
        Self {
            children: Arc::new(Mutex::new(Vec::new())),
            child_heights: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Add a child component.
    pub fn add_child(&self, component: Arc<dyn Component>) {
        if let Ok(mut children) = self.children.lock() {
            children.push(component);
        }
    }

    /// Remove a child component.
    pub fn remove_child(&self, component: &Arc<dyn Component>) {
        if let Ok(mut children) = self.children.lock() {
            children.retain(|c| !Arc::ptr_eq(c, component));
        }
    }

    /// Clear all children.
    pub fn clear(&self) {
        if let Ok(mut children) = self.children.lock() {
            children.clear();
        }
    }

    /// Get the number of children.
    pub fn child_count(&self) -> usize {
        self.children.lock().map(|c| c.len()).unwrap_or(0)
    }

    /// Get a clone of the children list.
    pub fn get_children(&self) -> Vec<Arc<dyn Component>> {
        self.children.lock().map(|c| c.clone()).unwrap_or_default()
    }
}

impl Default for Container {
    fn default() -> Self {
        Self::new()
    }
}

impl Component for Container {
    fn render(&self, width: usize) -> Vec<String> {
        let mut lines = Vec::new();
        let mut heights = Vec::new();

        if let Ok(children) = self.children.lock() {
            for child in children.iter() {
                let child_lines = child.render(width);
                heights.push(child_lines.len());
                lines.extend(child_lines);
            }
        }
        if let Ok(mut stored) = self.child_heights.lock() {
            *stored = heights;
        }

        lines
    }

    fn handle_mouse(&self, event: &MouseEvent) -> Option<MouseEventResult> {
        let children = self.get_children();
        let heights = self
            .child_heights
            .lock()
            .map(|heights| heights.clone())
            .unwrap_or_default();
        if heights.len() != children.len() {
            return None;
        }
        let mut row = 0;
        for (child, height) in children.iter().zip(heights.iter()) {
            if event.y >= row && event.y < row + *height {
                let local = MouseEvent {
                    y: event.y - row,
                    height: *height,
                    ..*event
                };
                return dispatch_mouse_event(child, &local).map(|dispatched| dispatched.result);
            }
            row += *height;
        }
        None
    }

    fn invalidate(&self) {
        if let Ok(children) = self.children.lock() {
            for child in children.iter() {
                child.invalidate();
            }
        }
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component::{MouseEvent, MouseEventKind, MouseEventResult};

    struct Clickable {
        clicks: Arc<Mutex<usize>>,
    }

    impl Component for Clickable {
        fn render(&self, _width: usize) -> Vec<String> {
            vec!["clickable".to_string()]
        }

        fn handle_mouse(&self, event: &MouseEvent) -> Option<MouseEventResult> {
            if event.kind != MouseEventKind::Click {
                return None;
            }
            *self.clicks.lock().unwrap() += 1;
            Some(MouseEventResult::handled())
        }

        fn invalidate(&self) {}

        fn as_any(&self) -> &dyn Any {
            self
        }
    }

    #[test]
    fn a_click_reaches_the_child_under_the_pointer() {
        let clicks = Arc::new(Mutex::new(0));
        let container = Container::new();
        container.add_child(Arc::new(crate::Text::new("first", 0, 0)));
        container.add_child(Arc::new(Clickable {
            clicks: clicks.clone(),
        }));
        container.render(20);

        let click = MouseEvent::new(MouseEventKind::Click, crate::component::MouseButton::Left, 0, 1);
        assert!(container.handle_mouse(&click).is_some());
        assert_eq!(*clicks.lock().unwrap(), 1);
    }

    #[test]
    fn a_click_below_every_child_is_ignored() {
        let clicks = Arc::new(Mutex::new(0));
        let container = Container::new();
        container.add_child(Arc::new(Clickable {
            clicks: clicks.clone(),
        }));
        container.render(20);

        let click = MouseEvent::new(MouseEventKind::Click, crate::component::MouseButton::Left, 0, 5);
        assert!(container.handle_mouse(&click).is_none());
        assert_eq!(*clicks.lock().unwrap(), 0);
    }
}
