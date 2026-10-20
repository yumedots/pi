//! First-run setup dialog: the theme picker shown on the very first launch.
//!
//! Port of `packages/coding-agent/src/modes/interactive/components/first-time-setup.ts`.

use std::any::Any;
use std::sync::{Arc, Mutex};

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

use super::component::Component;
use crate::ansi::bold;
use crate::keybinding_hints::{key_hint, raw_key_hint};
use crate::keybindings::keys;
use crate::theme::theme;

/// The block logo the dialog opens with.
const LOGO_LINES: [&str; 4] = ["██████", "██  ██", "████  ██", "██    ██"];

/// One selectable row of the dialog.
#[derive(Debug, Clone)]
pub struct FirstRunOption {
    /// The text shown in the list.
    pub label: String,
    /// The value handed back to the submit callback.
    pub value: String,
}

impl FirstRunOption {
    pub fn new(value: &str, label: &str) -> Self {
        Self {
            label: label.to_string(),
            value: value.to_string(),
        }
    }
}

/// The first-run dialog: pick a theme, or skip the setup.
pub struct FirstRunDialog {
    options: Vec<FirstRunOption>,
    index: Mutex<usize>,
    finished: Mutex<bool>,
    on_submit: Mutex<Option<Arc<dyn Fn(&FirstRunOption) + Send + Sync>>>,
    on_cancel: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
    on_preview: Mutex<Option<Arc<dyn Fn(&FirstRunOption) + Send + Sync>>>,
}

impl FirstRunDialog {
    pub fn new(options: Vec<FirstRunOption>) -> Self {
        Self {
            options,
            index: Mutex::new(0),
            finished: Mutex::new(false),
            on_submit: Mutex::new(None),
            on_cancel: Mutex::new(None),
            on_preview: Mutex::new(None),
        }
    }

    /// Called with the option under the cursor whenever it moves.
    pub fn on_preview(&self, callback: impl Fn(&FirstRunOption) + Send + Sync + 'static) {
        if let Ok(mut slot) = self.on_preview.lock() {
            *slot = Some(Arc::new(callback));
        }
    }

    /// Called with the chosen option when the user confirms.
    pub fn on_submit(&self, callback: impl Fn(&FirstRunOption) + Send + Sync + 'static) {
        if let Ok(mut slot) = self.on_submit.lock() {
            *slot = Some(Arc::new(callback));
        }
    }

    /// Called when the user skips the setup.
    pub fn on_cancel(&self, callback: impl Fn() + Send + Sync + 'static) {
        if let Ok(mut slot) = self.on_cancel.lock() {
            *slot = Some(Arc::new(callback));
        }
    }

    /// Whether the dialog was confirmed or skipped.
    pub fn is_finished(&self) -> bool {
        self.finished.lock().map(|done| *done).unwrap_or(false)
    }

    /// The option the cursor is on.
    pub fn selected(&self) -> Option<&FirstRunOption> {
        let index = self.index.lock().ok()?.clone();
        self.options.get(index)
    }

    /// Handle a key press. Up/Down (or j/k) move the cursor, Enter confirms,
    /// Esc (or Ctrl+C) skips the setup.
    pub fn handle_key(&self, key: KeyEvent) {
        match key.code {
            KeyCode::Up => self.move_selection(-1),
            KeyCode::Down => self.move_selection(1),
            KeyCode::Char('k') if key.modifiers.is_empty() => self.move_selection(-1),
            KeyCode::Char('j') if key.modifiers.is_empty() => self.move_selection(1),
            KeyCode::Enter => self.submit(),
            KeyCode::Esc => self.cancel(),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => self.cancel(),
            _ => {}
        }
    }

    fn move_selection(&self, delta: isize) {
        if self.options.is_empty() {
            return;
        }
        let mut moved = false;
        if let Ok(mut index) = self.index.lock() {
            let len = self.options.len() as isize;
            let next = (*index as isize + delta).rem_euclid(len);
            if next as usize != *index {
                *index = next as usize;
                moved = true;
            }
        }
        if !moved {
            return;
        }
        let callback = self.on_preview.lock().ok().and_then(|slot| slot.clone());
        if let (Some(callback), Some(option)) = (callback, self.selected()) {
            callback(option);
        }
    }

    fn submit(&self) {
        if self.is_finished() {
            return;
        }
        let callback = self.on_submit.lock().ok().and_then(|slot| slot.clone());
        if let (Some(callback), Some(option)) = (callback, self.selected()) {
            callback(option);
        }
        if let Ok(mut done) = self.finished.lock() {
            *done = true;
        }
    }

    fn cancel(&self) {
        if self.is_finished() {
            return;
        }
        let callback = self.on_cancel.lock().ok().and_then(|slot| slot.clone());
        if let Some(callback) = callback {
            callback();
        }
        if let Ok(mut done) = self.finished.lock() {
            *done = true;
        }
    }
}

impl Component for FirstRunDialog {
    fn render(&self, width: usize) -> Vec<String> {
        let colors = theme().colors;
        let mut lines: Vec<String> = Vec::new();
        lines.extend(crate::dynamic_border::DynamicBorder::new().render(width));
        lines.push(String::new());
        for logo in LOGO_LINES {
            lines.push(format!(" {}", colors.accent.fg(logo)));
        }
        lines.push(String::new());
        lines.push(format!(
            " {}",
            colors.accent.fg(&bold("Welcome to pi, the minimal coding agent."))
        ));
        lines.push(String::new());
        lines.push(format!(" {}", colors.text.fg("Pick a theme.")));
        lines.push(String::new());
        let selected = self.index.lock().map(|index| *index).unwrap_or(0);
        for (index, option) in self.options.iter().enumerate() {
            if index == selected {
                lines.push(format!(
                    " {}",
                    colors.accent.fg(&format!("→ {}", option.label))
                ));
            } else {
                lines.push(format!("   {}", colors.text.fg(&option.label)));
            }
        }
        lines.push(String::new());
        lines.push(format!(
            " {}",
            format!(
                "{}  {}  {}",
                raw_key_hint("↑↓", "navigate"),
                key_hint(keys::SELECT_CONFIRM, "continue"),
                key_hint(keys::SELECT_CANCEL, "skip setup"),
            )
        ));
        lines.push(String::new());
        lines.extend(crate::dynamic_border::DynamicBorder::new().render(width));
        lines
    }

    fn invalidate(&self) {}

    fn as_any(&self) -> &dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ansi::strip_ansi;
    use crossterm::event::KeyModifiers;

    fn dialog() -> FirstRunDialog {
        FirstRunDialog::new(vec![
            FirstRunOption::new("dark", "Dark"),
            FirstRunOption::new("light", "Light"),
        ])
    }

    #[test]
    fn renders_the_welcome_text_and_the_options() {
        let lines = dialog().render(60);
        let plain: Vec<String> = lines.iter().map(|line| strip_ansi(line)).collect();
        assert!(plain.iter().any(|line| line.contains("Welcome to pi, the minimal coding agent.")));
        assert!(plain.iter().any(|line| line.contains("Pick a theme.")));
        assert!(plain.iter().any(|line| line.trim() == "→ Dark"));
        assert!(plain.iter().any(|line| line.trim() == "Light"));
    }

    #[test]
    fn down_and_up_move_the_cursor() {
        let dialog = dialog();
        dialog.handle_key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE));
        assert_eq!(dialog.selected().map(|option| option.value.as_str()), Some("light"));
        dialog.handle_key(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE));
        assert_eq!(dialog.selected().map(|option| option.value.as_str()), Some("dark"));
    }

    #[test]
    fn enter_submits_the_selected_option() {
        let dialog = dialog();
        let submitted = Arc::new(Mutex::new(String::new()));
        let sink = submitted.clone();
        dialog.on_submit(move |option| {
            *sink.lock().unwrap() = option.value.clone();
        });
        dialog.handle_key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE));
        dialog.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(submitted.lock().unwrap().as_str(), "light");
        assert!(dialog.is_finished());
    }

    #[test]
    fn escape_skips_the_setup() {
        let dialog = dialog();
        let cancelled = Arc::new(Mutex::new(false));
        let flag = cancelled.clone();
        dialog.on_cancel(move || {
            *flag.lock().unwrap() = true;
        });
        dialog.handle_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(*cancelled.lock().unwrap());
        assert!(dialog.is_finished());
    }
}
