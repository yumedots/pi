//! Component trait and base types for TUI.
//!
//! Mirrors the TypeScript `Component` interface from `packages/tui/src/tui.ts`.

use std::any::Any;
use std::sync::Arc;

/// Mouse event type, mirroring upstream's `TuiMouseEventType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MouseEventKind {
    Press,
    Release,
    Move,
    Drag,
    Click,
    Wheel,
}

/// Mouse button, mirroring upstream's `TuiMouseButton`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MouseButton {
    Left,
    Middle,
    Right,
    None,
}

/// Normalized cell-based mouse event. Coordinates are zero-based.
#[derive(Debug, Clone, Copy)]
pub struct MouseEvent {
    pub kind: MouseEventKind,
    pub button: MouseButton,
    /// Coordinates local to the receiving component.
    pub x: usize,
    pub y: usize,
    /// Absolute terminal coordinates.
    pub screen_x: usize,
    pub screen_y: usize,
    /// Current component bounds.
    pub width: usize,
    pub height: usize,
    pub shift: bool,
    pub alt: bool,
    pub ctrl: bool,
    /// Logical lines. Negative values scroll up.
    pub wheel_delta: Option<i32>,
    /// Consecutive click count when the kind is `Click`.
    pub click_count: Option<u32>,
}

impl MouseEvent {
    /// Build an event at absolute terminal coordinates.
    pub fn new(kind: MouseEventKind, button: MouseButton, screen_x: usize, screen_y: usize) -> Self {
        Self {
            kind,
            button,
            x: screen_x,
            y: screen_y,
            screen_x,
            screen_y,
            width: 1,
            height: 1,
            shift: false,
            alt: false,
            ctrl: false,
            wheel_delta: None,
            click_count: None,
        }
    }
}

/// Result of a mouse handler.
#[derive(Debug, Clone, Copy, Default)]
pub struct MouseEventResult {
    /// Stop propagation and suppress renderer-level fallback behavior.
    pub handled: bool,
    /// Route subsequent drag and release events to this component.
    pub capture: bool,
    /// Give keyboard focus to this component.
    pub focus: bool,
    /// Explicitly request or suppress a render.
    pub render: Option<bool>,
}

impl MouseEventResult {
    /// A handled event that requests a repaint.
    pub fn handled() -> Self {
        Self {
            handled: true,
            ..Default::default()
        }
    }
}

/// Component interface - all components must implement this.
///
/// Components are the building blocks of the TUI. Each component can render
/// itself to a list of strings (one per line) for a given viewport width.
pub trait Component: Send + Sync {
    /// Render the component to lines for the given viewport width.
    ///
    /// # Arguments
    /// * `width` - Current viewport width in columns
    ///
    /// # Returns
    /// Array of strings, each representing a line
    fn render(&self, width: usize) -> Vec<String>;

    /// Optional handler for keyboard input when component has focus.
    ///
    /// # Arguments
    /// * `data` - Raw input data (key sequence)
    ///
    /// # Returns
    /// true if the input was consumed, false otherwise
    fn handle_input(&self, _data: &str) -> bool {
        false
    }

    /// If true, component receives key release events (Kitty protocol).
    /// Default is false - release events are filtered out.
    fn wants_key_release(&self) -> bool {
        false
    }

    /// Optional handler for normalized mouse events.
    ///
    /// Returning `None` leaves the event unhandled, so it keeps travelling to
    /// the next component under the pointer.
    fn handle_mouse(&self, _event: &MouseEvent) -> Option<MouseEventResult> {
        None
    }

    /// Focusable view of this component, when it can take keyboard focus.
    fn as_focusable(&self) -> Option<&dyn Focusable> {
        None
    }

    /// Apply the transcript's horizontal padding. The components that draw a
    /// padded block override it; the rest ignore it (upstream's `setOutputPad`).
    fn set_output_pad(&self, _pad: usize) {}

    /// Invalidate any cached rendering state.
    /// Called when theme changes or when component needs to re-render from scratch.
    fn invalidate(&self);

    /// Downcast to Any for runtime type checking.
    /// This enables the layout system to check for LayoutNodeProvider.
    fn as_any(&self) -> &dyn Any;
}

/// Interface for components that can receive focus and display a hardware cursor.
///
/// When focused, the component should emit `CURSOR_MARKER` at the cursor position
/// in its render output. TUI will find this marker and position the hardware
/// cursor there for proper IME candidate window positioning.
pub trait Focusable: Component {
    /// Set by TUI when focus changes. Component should emit CURSOR_MARKER when true.
    fn set_focused(&self, focused: bool);

    /// Check if the component is currently focused.
    fn is_focused(&self) -> bool;
}

/// Type alias for a reference-counted component.
pub type ComponentRef = Arc<dyn Component>;

/// Type alias for a reference-counted focusable component.
pub type FocusableRef = Arc<dyn Focusable>;

/// Cursor position marker - APC (Application Program Command) sequence.
/// This is a zero-width escape sequence that terminals ignore.
/// Components emit this at the cursor position when focused.
/// TUI finds and strips this marker, then positions the hardware cursor there.
pub const CURSOR_MARKER: &str = "\x1b_pi:c\x07";

/// Helper to check if a component implements Focusable.
pub fn is_focusable(component: &ComponentRef) -> bool {
    component
        .as_any()
        .downcast_ref::<Arc<dyn Focusable>>()
        .is_some()
        || component.as_any().type_id() == std::any::TypeId::of::<Arc<dyn Focusable>>()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[allow(dead_code)]
    struct TestComponent {
        content: String,
    }

    impl Component for TestComponent {
        fn render(&self, _width: usize) -> Vec<String> {
            vec![self.content.clone()]
        }

        fn invalidate(&self) {}

        fn as_any(&self) -> &dyn Any {
            self
        }
    }

    #[test]
    fn test_cursor_marker() {
        assert!(CURSOR_MARKER.starts_with("\x1b"));
        assert!(CURSOR_MARKER.ends_with("\x07"));
    }
}
