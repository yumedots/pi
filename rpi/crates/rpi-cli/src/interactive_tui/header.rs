//! The startup header: pi's mark, the version, the key hints, and the
//! expanded help the `app.tools.expand` binding toggles.
//!
//! Port of upstream's `BuiltInHeader` (`interactive-mode.ts:256-268`) and the
//! header text it renders (`interactive-mode.ts:1123-1169`). Upstream keeps the
//! header in its own container so it can re-render expanded; the port keeps the
//! same component so the mark can also be clicked.

use std::any::Any;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use rpi_tui::component::{Component, MouseEvent, MouseEventKind, MouseEventResult};
use rpi_tui::keybinding_hints::{key_hint, key_text, raw_key_hint};
use rpi_tui::keybindings::keys;
use rpi_tui::theme::theme;

/// The original's mark: four cells wide, two lines tall, in its own colours.
fn pi_logo_lines() -> (String, String) {
    let coral = rpi_tui::ansi::foreground_rgb(228, 138, 122);
    let blue = rpi_tui::ansi::foreground_rgb(79, 142, 179);
    let yellow = rpi_tui::ansi::foreground_rgb(234, 182, 93);
    let blue_background = rpi_tui::ansi::background_rgb(79, 142, 179);
    let reset = "\u{1b}[0m";
    let top = format!("{coral}{blue_background}▀{reset}{coral}▀█{reset} ");
    let bottom = format!("{blue}█▀{reset} {yellow}█{reset}");
    (top, bottom)
}

/// The original's compact startup hints, joined by a middot.
fn compact_hints() -> String {
    [
        format!("{} interrupt", key_text(keys::INTERRUPT)),
        "ctrl+c twice to exit".to_string(),
        "/ commands".to_string(),
        "! bash".to_string(),
        format!("{} more", key_text(keys::TOOLS_EXPAND)),
    ]
    .join(" · ")
}

/// The original's expanded startup hints, one line each.
fn expanded_hints() -> Vec<String> {
    vec![
        key_hint(keys::INTERRUPT, "to interrupt"),
        raw_key_hint(&format!("{} twice", key_text(keys::QUIT)), "to exit"),
        key_hint(keys::EXIT, "to exit (empty)"),
        key_hint(keys::SUSPEND, "to suspend"),
        key_hint("tui.editor.deleteToLineEnd", "to delete to end"),
        key_hint(keys::THINKING_CYCLE, "to cycle thinking level"),
        raw_key_hint(
            &format!(
                "{}/{}",
                key_text(keys::MODEL_CYCLE_FORWARD),
                key_text(keys::MODEL_CYCLE_BACKWARD)
            ),
            "to cycle models",
        ),
        key_hint(keys::MODEL_SELECT, "to select model"),
        key_hint(keys::TOOLS_EXPAND, "to expand tools"),
        key_hint(keys::THINKING_TOGGLE, "to expand thinking"),
        key_hint(keys::EXTERNAL_EDITOR, "for external editor"),
        raw_key_hint("/", "for commands"),
        raw_key_hint("!", "to run bash"),
        raw_key_hint("!!", "to run bash (no context)"),
        key_hint(keys::MESSAGE_FOLLOW_UP, "to queue follow-up"),
        key_hint(keys::DEQUEUE, "to edit all queued messages"),
        key_hint(
            keys::PASTE_IMAGE,
            "to paste files on macOS, images, or text",
        ),
        raw_key_hint("drop files", "to attach"),
    ]
}

/// The note the original prints under the startup hints.
const ONBOARDING: &str =
    "Pi can explain its own features and look up its docs. Ask it how to use or extend Pi.";

/// The callback the mark's click fires: the top-left cell of the mark.
pub(super) type LogoClickHandler = Arc<dyn Fn(usize, usize) + Send + Sync>;

/// The startup header: the compact form by default, the expanded help behind
/// `app.tools.expand`.
pub(super) struct StartupHeader {
    expanded: AtomicBool,
    visible: AtomicBool,
    version: String,
    on_logo_click: Mutex<Option<LogoClickHandler>>,
}

impl StartupHeader {
    /// A header for the given version, collapsed.
    pub(super) fn new(version: String, visible: bool) -> Self {
        Self {
            expanded: AtomicBool::new(false),
            visible: AtomicBool::new(visible),
            version,
            on_logo_click: Mutex::new(None),
        }
    }

    /// Whether the header is shown at all (`quietStartup` hides it).
    pub(super) fn is_visible(&self) -> bool {
        self.visible.load(Ordering::Relaxed)
    }

    /// Whether the header shows the expanded help.
    pub(super) fn is_expanded(&self) -> bool {
        self.expanded.load(Ordering::Relaxed)
    }

    /// Show the expanded help or the compact hints.
    pub(super) fn set_expanded(&self, expanded: bool) {
        self.expanded.store(expanded, Ordering::Relaxed);
    }

    /// The handler the mark's click fires.
    pub(super) fn set_logo_click(&self, handler: Option<LogoClickHandler>) {
        if let Ok(mut slot) = self.on_logo_click.lock() {
            *slot = handler;
        }
    }

    /// The header's lines: the mark with the version, the hints, and the
    /// onboarding note.
    fn lines(&self) -> Vec<String> {
        let colors = theme().colors;
        let (top, bottom) = pi_logo_lines();
        let mut lines = Vec::new();
        lines.push(format!("{top} {}", colors.dim.fg(&format!("v{}", self.version))));
        if self.is_expanded() {
            let hints = expanded_hints();
            lines.push(format!("{bottom} {}", hints.first().cloned().unwrap_or_default()));
            for hint in hints.iter().skip(1) {
                lines.push(hint.clone());
            }
        } else {
            lines.push(format!(
                "{bottom} {}",
                colors.muted.fg(&compact_hints())
            ));
            lines.push(colors.dim.fg(&format!(
                "Press {} to show full startup help.",
                key_text(keys::TOOLS_EXPAND)
            )));
        }
        lines.push(String::new());
        lines.push(colors.dim.fg(ONBOARDING));
        lines
    }
}

impl Component for StartupHeader {
    fn render(&self, _width: usize) -> Vec<String> {
        if !self.is_visible() {
            return Vec::new();
        }
        self.lines()
            .into_iter()
            .map(|line| format!(" {line}"))
            .collect()
    }

    fn handle_mouse(&self, event: &MouseEvent) -> Option<MouseEventResult> {
        if !matches!(event.kind, MouseEventKind::Press | MouseEventKind::Click) {
            return None;
        }
        if event.y > 1 || event.x < 1 || event.x > 4 {
            return None;
        }
        if event.kind == MouseEventKind::Click {
            let handler = self.on_logo_click.lock().ok().and_then(|slot| slot.clone());
            if let Some(handler) = handler {
                handler(event.screen_x - event.x + 1, event.screen_y - event.y);
            }
        }
        Some(MouseEventResult::handled())
    }

    fn invalidate(&self) {}

    fn as_any(&self) -> &dyn Any {
        self
    }
}

/// Add the header to the transcript, with the blank rows the original's header
/// container wraps it in.
pub(super) fn add_startup_header(container: &Arc<rpi_tui::container::Container>, header: &Arc<StartupHeader>) {
    if !header.is_visible() {
        return;
    }
    container.add_child(Arc::new(rpi_tui::spacer::Spacer::new(1)));
    container.add_child(header.clone());
    container.add_child(Arc::new(rpi_tui::spacer::Spacer::new(1)));
}

#[cfg(test)]
mod tests {
    use super::*;
    use rpi_tui::component::{MouseEvent, MouseEventKind};

    fn header() -> StartupHeader {
        StartupHeader::new("1.3.0".to_string(), true)
    }

    #[test]
    fn the_compact_header_is_the_originals_five_lines() {
        let header = header();
        let lines = header.render(100);
        assert_eq!(lines.len(), 5);
        assert!(lines[0].contains("v1.3.0"));
        assert!(lines[1].contains("escape interrupt"));
        assert!(lines[1].contains("ctrl+o more"));
        assert!(lines[2].contains("Press ctrl+o to show full startup help."));
        assert!(lines[4].contains("Pi can explain its own features"));
    }

    #[test]
    fn the_expanded_header_lists_every_binding() {
        let mut header = header();
        header.set_expanded(true);
        let lines: Vec<String> = header
            .render(100)
            .iter()
            .map(|line| rpi_tui::strip_ansi(line))
            .collect();
        assert_eq!(lines.len(), 21);
        assert!(lines[1].contains("escape to interrupt"), "{}", lines[1]);
        assert!(lines[2].contains("ctrl+c twice to exit"), "{}", lines[2]);
        assert!(lines[3].contains("ctrl+d to exit (empty)"), "{}", lines[3]);
        assert!(lines[4].contains("ctrl+z to suspend"), "{}", lines[4]);
        assert!(lines[5].contains("ctrl+k to delete to end"), "{}", lines[5]);
        assert!(
            lines[6].contains("shift+tab to cycle thinking level"),
            "{}",
            lines[6]
        );
        assert!(
            lines[7].contains("ctrl+p/shift+ctrl+p to cycle models"),
            "{}",
            lines[7]
        );
        assert!(lines[8].contains("ctrl+l to select model"), "{}", lines[8]);
        assert!(lines[9].contains("ctrl+o to expand tools"), "{}", lines[9]);
        assert!(lines[10].contains("ctrl+t to expand thinking"), "{}", lines[10]);
        assert!(lines[11].contains("ctrl+g for external editor"), "{}", lines[11]);
        assert!(lines[12].contains("/ for commands"), "{}", lines[12]);
        assert!(lines[13].contains("! to run bash"), "{}", lines[13]);
        assert!(lines[14].contains("!! to run bash (no context)"), "{}", lines[14]);
        assert!(
            lines[15].contains("option+enter to queue follow-up"),
            "{}",
            lines[15]
        );
        assert!(
            lines[16].contains("option+up to edit all queued messages"),
            "{}",
            lines[16]
        );
        assert!(
            lines[17].contains("ctrl+v to paste files on macOS, images, or text"),
            "{}",
            lines[17]
        );
        assert!(lines[18].contains("drop files to attach"), "{}", lines[18]);
        assert!(lines[19].trim().is_empty(), "{}", lines[19]);
        assert!(lines[20].contains("Pi can explain its own features"), "{}", lines[20]);
    }

    #[test]
    fn the_mark_is_clickable_and_the_click_reports_its_cell() {
        let header = header();
        let seen = Arc::new(Mutex::new(None));
        let sink = seen.clone();
        header.set_logo_click(Some(Arc::new(move |column, row| {
            *sink.lock().unwrap() = Some((column, row));
        })));
        let event = MouseEvent {
            kind: MouseEventKind::Click,
            x: 2,
            y: 0,
            screen_x: 12,
            screen_y: 40,
            ..MouseEvent::new(MouseEventKind::Click, rpi_tui::component::MouseButton::Left, 12, 40)
        };
        assert!(header.handle_mouse(&event).is_some());
        assert_eq!(*seen.lock().unwrap(), Some((11, 40)));
    }

    #[test]
    fn a_click_below_the_mark_is_not_the_logo() {
        let header = header();
        let event = MouseEvent {
            kind: MouseEventKind::Click,
            x: 2,
            y: 2,
            ..MouseEvent::new(MouseEventKind::Click, rpi_tui::component::MouseButton::Left, 2, 2)
        };
        assert!(header.handle_mouse(&event).is_none());
    }
}
