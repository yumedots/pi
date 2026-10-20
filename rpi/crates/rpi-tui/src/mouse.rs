//! Mouse dispatch helpers and the clickable region wrapper.
//!
//! Mirrors upstream's `dispatchMouseEvent` / `retargetMouseEvent`
//! (`packages/tui/src/tui.ts`) and `MouseRegion`
//! (`packages/tui/src/components/mouse-region.ts`).

use std::any::Any;
use std::sync::Arc;

use crate::component::{Component, MouseEvent, MouseEventResult};

/// Metadata about the component a mouse event was dispatched to.
#[derive(Clone)]
pub struct MouseDispatchTarget {
    pub component: Arc<dyn Component>,
    pub origin_x: usize,
    pub origin_y: usize,
    pub width: usize,
    pub height: usize,
}

/// Result of dispatching an event to a concrete component.
pub struct MouseDispatchResult {
    pub result: MouseEventResult,
    pub target: MouseDispatchTarget,
}

/// Dispatch an event to a component and retain the exact target and
/// coordinate transform.
pub fn dispatch_mouse_event(
    component: &Arc<dyn Component>,
    event: &MouseEvent,
) -> Option<MouseDispatchResult> {
    let result = component.handle_mouse(event)?;
    if !result.handled && !result.capture && !result.focus {
        return None;
    }
    Some(MouseDispatchResult {
        result,
        target: MouseDispatchTarget {
            component: component.clone(),
            origin_x: event.screen_x.saturating_sub(event.x),
            origin_y: event.screen_y.saturating_sub(event.y),
            width: event.width,
            height: event.height,
        },
    })
}

/// Recreate local coordinates for a previously dispatched mouse target.
pub fn retarget_mouse_event(event: &MouseEvent, target: &MouseDispatchTarget) -> MouseEvent {
    MouseEvent {
        x: event.screen_x.saturating_sub(target.origin_x),
        y: event.screen_y.saturating_sub(target.origin_y),
        width: target.width,
        height: target.height,
        ..*event
    }
}

/// Callback invoked by [`MouseRegion`] when the wrapped component did not
/// handle the event.
pub type MouseRegionHandler = Arc<dyn Fn(&MouseEvent) -> Option<MouseEventResult> + Send + Sync>;

/// Adds mouse handling to an existing component without changing its
/// rendering.
pub struct MouseRegion {
    child: Arc<dyn Component>,
    on_mouse: MouseRegionHandler,
}

impl MouseRegion {
    /// Wrap `child` and call `on_mouse` for events the child does not handle.
    pub fn new(child: Arc<dyn Component>, on_mouse: MouseRegionHandler) -> Self {
        Self { child, on_mouse }
    }

    /// The wrapped component.
    pub fn child(&self) -> &Arc<dyn Component> {
        &self.child
    }
}

impl Component for MouseRegion {
    fn render(&self, width: usize) -> Vec<String> {
        self.child.render(width)
    }

    fn handle_mouse(&self, event: &MouseEvent) -> Option<MouseEventResult> {
        match dispatch_mouse_event(&self.child, event) {
            Some(dispatched) => Some(dispatched.result),
            None => (self.on_mouse)(event),
        }
    }

    fn invalidate(&self) {
        self.child.invalidate();
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component::MouseEventKind;
    use std::sync::Mutex;

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
    fn mouse_region_forwards_to_the_child_first() {
        let clicks = Arc::new(Mutex::new(0));
        let child: Arc<dyn Component> = Arc::new(Clickable {
            clicks: clicks.clone(),
        });
        let region = MouseRegion::new(
            child,
            Arc::new(|_event: &MouseEvent| Some(MouseEventResult::handled())),
        );
        let event = MouseEvent::new(MouseEventKind::Click, crate::component::MouseButton::Left, 3, 4);
        assert!(region.handle_mouse(&event).is_some());
        assert_eq!(*clicks.lock().unwrap(), 1);
    }

    #[test]
    fn mouse_region_falls_back_to_its_own_handler() {
        struct Plain;
        impl Component for Plain {
            fn render(&self, _width: usize) -> Vec<String> {
                vec!["plain".to_string()]
            }
            fn invalidate(&self) {}
            fn as_any(&self) -> &dyn Any {
                self
            }
        }
        let region = MouseRegion::new(
            Arc::new(Plain),
            Arc::new(|event: &MouseEvent| {
                if event.kind == MouseEventKind::Click {
                    Some(MouseEventResult::handled())
                } else {
                    None
                }
            }),
        );
        let press = MouseEvent::new(MouseEventKind::Press, crate::component::MouseButton::Left, 0, 0);
        assert!(region.handle_mouse(&press).is_none());
        let click = MouseEvent::new(MouseEventKind::Click, crate::component::MouseButton::Left, 0, 0);
        assert!(region.handle_mouse(&click).is_some());
    }

    #[test]
    fn dispatch_keeps_the_target_for_later_drag_and_release_events() {
        let clicks = Arc::new(Mutex::new(0));
        let component: Arc<dyn Component> = Arc::new(Clickable {
            clicks: clicks.clone(),
        });
        let mut event = MouseEvent::new(MouseEventKind::Click, crate::component::MouseButton::Left, 7, 9);
        event.x = 2;
        event.y = 3;
        let dispatched = dispatch_mouse_event(&component, &event).expect("handled");
        assert_eq!(dispatched.target.origin_x, 5);
        assert_eq!(dispatched.target.origin_y, 6);

        let release = MouseEvent::new(MouseEventKind::Release, crate::component::MouseButton::Left, 8, 9);
        let retargeted = retarget_mouse_event(&release, &dispatched.target);
        assert_eq!(retargeted.x, 3);
        assert_eq!(retargeted.y, 3);
        assert_eq!(retargeted.screen_x, 8);
    }
}
