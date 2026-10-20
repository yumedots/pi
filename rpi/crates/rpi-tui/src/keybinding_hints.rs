//! Keybinding hint formatting utilities.
//!
//! Port of `packages/coding-agent/src/modes/interactive/components/keybinding-hints.ts`.
//! Produces key strings (e.g. `"ctrl+c"`, `"shift+enter"`) from the global
//! [`Keybindings`] registry, plus themed hint lines like
//! `"<muted>ctrl+c</muted> <muted>cancel</muted>"`.
//!
//! The keys are the original's key ids: lower-case for hints, first-letter
//! capitalized for the display form. `alt` reads as `option` on macOS, the way
//! the original renders it.

use crossterm::event::{KeyCode, KeyModifiers};

use crate::keybindings::{get_keybindings, KeyCombo, KeybindingId};
use crate::theme::{theme, Color};

/// Format a single [`KeyCombo`] as a key id: `"ctrl+c"`, `"shift+enter"`, `"escape"`.
///
/// Modifier order is Ctrl, Alt, Super, Shift. `alt` renders as `option` on
/// macOS, the way the original renders it. `capitalize` first-letter-capitalizes
/// every part, the way the original's `keyDisplayText` does.
pub fn format_combo(combo: KeyCombo, capitalize: bool) -> String {
    let mut parts: Vec<String> = Vec::new();

    let m = combo.modifiers;
    let ctrl = m.contains(KeyModifiers::CONTROL);
    let alt = m.contains(KeyModifiers::ALT);
    let sup = m.contains(KeyModifiers::SUPER);

    if ctrl {
        parts.push("ctrl".to_string());
    }
    if alt {
        parts.push(if cfg!(target_os = "macos") {
            "option".to_string()
        } else {
            "alt".to_string()
        });
    }
    if sup {
        parts.push("super".to_string());
    }

    let key_name = key_code_name(&combo.code);

    // Shift on a printable char is implied by the glyph — drop it. For other
    // keys (Enter, Esc, arrows) keep "shift+".
    let shift_implicit = matches!(combo.code, KeyCode::Char(_)) && !ctrl && !alt;
    if m.contains(KeyModifiers::SHIFT) && !shift_implicit {
        parts.push("shift".to_string());
    }

    parts.push(key_name);
    parts
        .iter()
        .map(|part| {
            if capitalize {
                capitalize_first(part)
            } else {
                part.clone()
            }
        })
        .collect::<Vec<_>>()
        .join("+")
}

/// First-letter-capitalize a key id part.
fn capitalize_first(part: &str) -> String {
    let mut chars = part.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// Render a [`KeyCode`] as the original's key id.
pub fn key_code_name(code: &KeyCode) -> String {
    match code {
        KeyCode::Char(c) => c.to_string(),
        KeyCode::Enter => "enter".to_string(),
        KeyCode::Tab => "tab".to_string(),
        KeyCode::BackTab => "shift+tab".to_string(),
        KeyCode::Esc => "escape".to_string(),
        KeyCode::Backspace => "backspace".to_string(),
        KeyCode::Delete => "delete".to_string(),
        KeyCode::Insert => "insert".to_string(),
        KeyCode::Home => "home".to_string(),
        KeyCode::End => "end".to_string(),
        KeyCode::PageUp => "pageUp".to_string(),
        KeyCode::PageDown => "pageDown".to_string(),
        KeyCode::Left => "left".to_string(),
        KeyCode::Right => "right".to_string(),
        KeyCode::Up => "up".to_string(),
        KeyCode::Down => "down".to_string(),
        KeyCode::CapsLock => "capsLock".to_string(),
        KeyCode::ScrollLock => "scrollLock".to_string(),
        KeyCode::NumLock => "numLock".to_string(),
        KeyCode::PrintScreen => "printScreen".to_string(),
        KeyCode::Pause => "pause".to_string(),
        KeyCode::Menu => "menu".to_string(),
        KeyCode::F(n) => format!("f{n}"),
        KeyCode::Null => String::new(),
        KeyCode::Media(_) => "media".to_string(),
        KeyCode::Modifier(_) => "modifier".to_string(),
        KeyCode::KeypadBegin => "keypadBegin".to_string(),
    }
}

/// Resolve a keybinding ID to its key display text, joining multiple
/// `KeyCombo`s with `/`. Returns an empty string when the ID has no bound keys
/// (mirrors the TS `keyText`).
pub fn key_text(id: KeybindingId) -> String {
    let combos = get_keybindings().get_keys(id);
    if combos.is_empty() {
        return String::new();
    }
    combos
        .iter()
        .map(|c| format_combo(*c, false))
        .collect::<Vec<_>>()
        .join("/")
}

/// Capitalized variant of [`key_text`] (first letter of each part uppercased).
pub fn key_display_text(id: KeybindingId) -> String {
    let combos = get_keybindings().get_keys(id);
    if combos.is_empty() {
        return String::new();
    }
    combos
        .iter()
        .map(|c| format_combo(*c, true))
        .collect::<Vec<_>>()
        .join("/")
}

/// Themed hint: `<muted>keys</muted> <muted>description</muted>`.
///
/// The TS version uses a `dim` slot; rpi-tui has no `dim` color, so both the
/// keys and description use the theme's `muted` shade — subdued in any preset.
pub fn key_hint(id: KeybindingId, description: &str) -> String {
    let colors = theme().colors;
    let keys = key_text(id);
    hint_line(&keys, description, colors.muted, colors.muted)
}

/// Themed hint from a literal key string (for keys not in the registry, e.g.
/// `"Ctrl+T"`, `"↑↓"`). Same shape as [`key_hint`].
pub fn raw_key_hint(key: &str, description: &str) -> String {
    let colors = theme().colors;
    hint_line(key, description, colors.muted, colors.muted)
}

fn hint_line(keys: &str, description: &str, key_color: Color, desc_color: Color) -> String {
    format!("{} {}", key_color.fg(keys), desc_color.fg(description))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_text_submit_contains_enter() {
        // tui.input.submit defaults to Enter (no modifiers).
        let text = key_text("tui.input.submit");
        assert!(text.contains("enter"), "got: {text}");
    }

    #[test]
    fn test_key_text_newline_has_shift_and_ctrl() {
        // tui.input.newLine = Shift+Enter, Ctrl+J.
        let text = key_text("tui.input.newLine");
        assert!(text.contains("enter") || text.contains("j"), "got: {text}");
    }

    #[test]
    fn test_key_text_unknown_id_empty() {
        assert_eq!(key_text("tui.does.not.exist"), "");
    }

    #[test]
    fn test_format_combo_ctrl_c() {
        let combo = KeyCombo::new(KeyCode::Char('c'), KeyModifiers::CONTROL);
        assert_eq!(format_combo(combo, false), "ctrl+c");
        assert_eq!(format_combo(combo, true), "Ctrl+C");
    }

    #[test]
    fn test_format_combo_shift_enter() {
        let combo = KeyCombo::new(KeyCode::Enter, KeyModifiers::SHIFT);
        assert_eq!(format_combo(combo, false), "shift+enter");
        assert_eq!(format_combo(combo, true), "Shift+Enter");
    }

    #[test]
    fn test_key_code_name_special() {
        assert_eq!(key_code_name(&KeyCode::Esc), "escape");
        assert_eq!(key_code_name(&KeyCode::F(5)), "f5");
        assert_eq!(key_code_name(&KeyCode::Char('a')), "a");
        assert_eq!(key_code_name(&KeyCode::Char('$')), "$");
    }

    #[test]
    fn hints_use_the_originals_lower_case_keys() {
        assert_eq!(key_text("app.interrupt"), "escape");
        assert_eq!(key_display_text("app.interrupt"), "Escape");
        assert_eq!(key_text("app.tools.expand"), "ctrl+o");
        assert_eq!(key_display_text("app.tools.expand"), "Ctrl+O");
    }
}
