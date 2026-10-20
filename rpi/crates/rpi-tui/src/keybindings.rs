//! Keybinding system for TUI.
//!
//! Provides configurable keyboard shortcuts for TUI actions.
//! This is a 1:1 port of the TypeScript keybindings.ts

use std::collections::HashMap;

use crossterm::event::{KeyCode, KeyModifiers};

/// A keybinding identifier.
pub type KeybindingId = &'static str;

/// A key combination.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct KeyCombo {
    pub code: KeyCode,
    pub modifiers: KeyModifiers,
}

impl KeyCombo {
    /// Create a new key combination.
    pub fn new(code: KeyCode, modifiers: KeyModifiers) -> Self {
        Self { code, modifiers }
    }

    /// Create from just a key code (no modifiers).
    pub fn from_code(code: KeyCode) -> Self {
        Self {
            code,
            modifiers: KeyModifiers::NONE,
        }
    }

    /// Add Ctrl modifier.
    pub fn ctrl(self) -> Self {
        Self {
            modifiers: self.modifiers | KeyModifiers::CONTROL,
            ..self
        }
    }

    /// Add Shift modifier.
    pub fn shift(self) -> Self {
        Self {
            modifiers: self.modifiers | KeyModifiers::SHIFT,
            ..self
        }
    }

    /// Add Alt modifier.
    pub fn alt(self) -> Self {
        Self {
            modifiers: self.modifiers | KeyModifiers::ALT,
            ..self
        }
    }

    /// Add Super modifier.
    pub fn super_key(self) -> Self {
        Self {
            modifiers: self.modifiers | KeyModifiers::SUPER,
            ..self
        }
    }

    /// Human-readable key text for hints (mirrors upstream's `formatKeyText`,
    /// e.g. `Alt+Q`, `Ctrl+Shift+F`, `Enter`). Modifiers are ordered
    /// Ctrl, Alt, Shift, Super.
    pub fn display(&self) -> String {
        let mut parts: Vec<String> = Vec::new();
        if self.modifiers.contains(KeyModifiers::CONTROL) {
            parts.push("Ctrl".into());
        }
        if self.modifiers.contains(KeyModifiers::ALT) {
            parts.push("Alt".into());
        }
        // `BackTab` already carries the shift; don't render it twice.
        if self.modifiers.contains(KeyModifiers::SHIFT) && self.code != KeyCode::BackTab {
            parts.push("Shift".into());
        }
        if self.modifiers.contains(KeyModifiers::SUPER) {
            parts.push("Super".into());
        }
        let key = match self.code {
            KeyCode::Char(c) => c.to_uppercase().to_string(),
            KeyCode::Enter => "Enter".into(),
            KeyCode::Esc => "Esc".into(),
            KeyCode::Tab | KeyCode::BackTab => "Tab".into(),
            KeyCode::Backspace => "Backspace".into(),
            KeyCode::Delete => "Delete".into(),
            KeyCode::Insert => "Insert".into(),
            KeyCode::Up => "Up".into(),
            KeyCode::Down => "Down".into(),
            KeyCode::Left => "Left".into(),
            KeyCode::Right => "Right".into(),
            KeyCode::Home => "Home".into(),
            KeyCode::End => "End".into(),
            KeyCode::PageUp => "PageUp".into(),
            KeyCode::PageDown => "PageDown".into(),
            other => format!("{other:?}"),
        };
        parts.push(key);
        parts.join("+")
    }
}

/// Keybinding definition.
#[derive(Debug, Clone)]
pub struct KeybindingDefinition {
    pub default_keys: Vec<KeyCombo>,
    pub description: Option<&'static str>,
}

/// Keybinding conflict.
#[derive(Debug, Clone)]
pub struct KeybindingConflict {
    pub key: KeyCombo,
    pub keybindings: Vec<KeybindingId>,
}

/// Keybindings manager.
#[derive(Clone)]
pub struct Keybindings {
    definitions: HashMap<KeybindingId, KeybindingDefinition>,
    user_bindings: HashMap<KeybindingId, Vec<KeyCombo>>,
    keys_by_id: HashMap<KeybindingId, Vec<KeyCombo>>,
    conflicts: Vec<KeybindingConflict>,
}

impl Keybindings {
    /// Create a new keybindings manager with default bindings.
    pub fn new() -> Self {
        let definitions = Self::default_definitions();
        let keys_by_id = definitions
            .iter()
            .map(|(id, def)| (*id, def.default_keys.clone()))
            .collect();
        Self {
            definitions,
            user_bindings: HashMap::new(),
            keys_by_id,
            conflicts: Vec::new(),
        }
    }

    /// Get default keybinding definitions.
    fn default_definitions() -> HashMap<KeybindingId, KeybindingDefinition> {
        use KeyCode::*;
        use KeyModifiers as M;

        let mut map = HashMap::new();

        // Application-level actions. These IDs and their default keys match
        // upstream, so a copied settings.json overrides them the same way.
        map.insert(
            "app.interrupt",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Esc, M::NONE)],
                description: Some("Cancel or abort"),
            },
        );
        map.insert(
            "app.quit",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('c'), M::CONTROL)],
                description: Some("Exit (press twice)"),
            },
        );
        map.insert(
            "app.exit",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('d'), M::CONTROL)],
                description: Some("Exit when editor is empty"),
            },
        );
        map.insert(
            "app.model.select",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('l'), M::CONTROL)],
                description: Some("Open model selector"),
            },
        );
        map.insert(
            "app.model.cycleForward",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('p'), M::CONTROL)],
                description: Some("Cycle to next model"),
            },
        );
        map.insert(
            "app.model.cycleBackward",
            KeybindingDefinition {
                // Upstream: `alt+p` on Windows, `shift+ctrl+p` elsewhere.
                default_keys: vec![if cfg!(windows) {
                    KeyCombo::new(Char('p'), M::ALT)
                } else {
                    KeyCombo::new(Char('p'), M::CONTROL | M::SHIFT)
                }],
                description: Some("Cycle to previous model"),
            },
        );
        map.insert(
            "app.tools.expand",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('o'), M::CONTROL)],
                description: Some("Toggle tool output"),
            },
        );
        map.insert(
            "app.thinking.toggle",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('t'), M::CONTROL)],
                description: Some("Toggle thinking blocks"),
            },
        );
        map.insert(
            "app.editor.external",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('g'), M::CONTROL)],
                description: Some("Open external editor"),
            },
        );
        map.insert(
            "app.thinking.cycle",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Tab, M::SHIFT)],
                description: Some("Cycle thinking level"),
            },
        );
        map.insert(
            "app.clipboard.pasteImage",
            KeybindingDefinition {
                // Upstream: `alt+v` on Windows, `ctrl+v` elsewhere.
                default_keys: if cfg!(windows) {
                    vec![KeyCombo::new(Char('v'), M::ALT)]
                } else {
                    vec![KeyCombo::new(Char('v'), M::CONTROL)]
                },
                description: Some("Paste files on macOS, images, or text from clipboard"),
            },
        );
        map.insert(
            "app.suspend",
            KeybindingDefinition {
                // Upstream binds no key on Windows at all.
                default_keys: if cfg!(windows) {
                    vec![]
                } else {
                    vec![KeyCombo::new(Char('z'), M::CONTROL)]
                },
                description: Some("Suspend to background"),
            },
        );
        map.insert(
            "app.message.followUp",
            KeybindingDefinition {
                // Upstream: `ctrl+q` on Windows, `alt+enter` elsewhere.
                default_keys: if cfg!(windows) {
                    vec![KeyCombo::new(Char('q'), M::CONTROL)]
                } else {
                    vec![KeyCombo::new(Enter, M::ALT)]
                },
                description: Some("Queue follow-up message"),
            },
        );
        map.insert(
            "app.message.dequeue",
            KeybindingDefinition {
                // Upstream: `alt+q` on Windows, `alt+up` elsewhere.
                default_keys: vec![if cfg!(windows) {
                    KeyCombo::new(Char('q'), M::ALT)
                } else {
                    KeyCombo::new(Up, M::ALT)
                }],
                description: Some("Restore queued messages"),
            },
        );
        map.insert(
            "app.message.copy",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('x'), M::CONTROL)],
                description: Some("Copy selection or last assistant message"),
            },
        );
        map.insert(
            "app.thinking.save",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('s'), M::CONTROL)],
                description: Some("Save thinking level"),
            },
        );
        map.insert(
            "app.session.toggleNamedFilter",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('n'), M::CONTROL)],
                description: Some("Toggle named session filter"),
            },
        );
        map.insert(
            "app.session.new",
            KeybindingDefinition {
                default_keys: vec![],
                description: Some("Start a new session"),
            },
        );
        map.insert(
            "app.session.tree",
            KeybindingDefinition {
                default_keys: vec![],
                description: Some("Open session tree"),
            },
        );
        map.insert(
            "app.session.fork",
            KeybindingDefinition {
                default_keys: vec![],
                description: Some("Fork current session"),
            },
        );
        map.insert(
            "app.session.resume",
            KeybindingDefinition {
                default_keys: vec![],
                description: Some("Resume a session"),
            },
        );
        map.insert(
            "app.tree.foldOrUp",
            KeybindingDefinition {
                // Upstream: `alt+left` first on macOS, `ctrl+left` first elsewhere.
                default_keys: if cfg!(target_os = "macos") {
                    vec![
                        KeyCombo::new(Left, M::ALT),
                        KeyCombo::new(Left, M::CONTROL),
                    ]
                } else {
                    vec![
                        KeyCombo::new(Left, M::CONTROL),
                        KeyCombo::new(Left, M::ALT),
                    ]
                },
                description: Some("Fold tree branch or move up"),
            },
        );
        map.insert(
            "app.tree.unfoldOrDown",
            KeybindingDefinition {
                // Upstream: `alt+right` first on macOS, `ctrl+right` first elsewhere.
                default_keys: if cfg!(target_os = "macos") {
                    vec![
                        KeyCombo::new(Right, M::ALT),
                        KeyCombo::new(Right, M::CONTROL),
                    ]
                } else {
                    vec![
                        KeyCombo::new(Right, M::CONTROL),
                        KeyCombo::new(Right, M::ALT),
                    ]
                },
                description: Some("Unfold tree branch or move down"),
            },
        );
        map.insert(
            "app.tree.editLabel",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('l'), M::SHIFT)],
                description: Some("Edit tree label"),
            },
        );
        map.insert(
            "app.tree.toggleLabelTimestamp",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('t'), M::SHIFT)],
                description: Some("Toggle tree label timestamps"),
            },
        );
        map.insert(
            "app.session.togglePath",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('p'), M::CONTROL)],
                description: Some("Toggle session path display"),
            },
        );
        map.insert(
            "app.session.toggleSort",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('s'), M::CONTROL)],
                description: Some("Toggle session sort mode"),
            },
        );
        map.insert(
            "app.session.rename",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('r'), M::CONTROL)],
                description: Some("Rename session"),
            },
        );
        map.insert(
            "app.session.delete",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('d'), M::CONTROL)],
                description: Some("Delete session"),
            },
        );
        map.insert(
            "app.session.deleteNoninvasive",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Backspace, M::CONTROL)],
                description: Some("Delete session when query is empty"),
            },
        );
        map.insert(
            "app.models.save",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('s'), M::CONTROL)],
                description: Some("Save model selection"),
            },
        );
        map.insert(
            "app.models.enableAll",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('a'), M::CONTROL)],
                description: Some("Enable all models"),
            },
        );
        map.insert(
            "app.models.clearAll",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('x'), M::CONTROL)],
                description: Some("Clear all models"),
            },
        );
        map.insert(
            "app.models.toggleProvider",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('p'), M::CONTROL)],
                description: Some("Toggle all models for provider"),
            },
        );
        map.insert(
            "app.models.reorderUp",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Up, M::ALT)],
                description: Some("Move model up in order"),
            },
        );
        map.insert(
            "app.models.reorderDown",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Down, M::ALT)],
                description: Some("Move model down in order"),
            },
        );
        map.insert(
            "app.tree.filter.default",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('d'), M::CONTROL)],
                description: Some("Tree filter: default view"),
            },
        );
        map.insert(
            "app.tree.filter.noTools",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('t'), M::CONTROL)],
                description: Some("Tree filter: hide tool results"),
            },
        );
        map.insert(
            "app.tree.filter.userOnly",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('u'), M::CONTROL)],
                description: Some("Tree filter: user messages only"),
            },
        );
        map.insert(
            "app.tree.filter.labeledOnly",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('l'), M::CONTROL)],
                description: Some("Tree filter: labeled entries only"),
            },
        );
        map.insert(
            "app.tree.filter.all",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('a'), M::CONTROL)],
                description: Some("Tree filter: show all entries"),
            },
        );
        map.insert(
            "app.tree.filter.cycleForward",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('o'), M::CONTROL)],
                description: Some("Tree filter: cycle forward"),
            },
        );
        map.insert(
            "app.tree.filter.cycleBackward",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('o'), M::CONTROL | M::SHIFT)],
                description: Some("Tree filter: cycle backward"),
            },
        );

        // Editor navigation and editing
        map.insert(
            "tui.editor.cursorUp",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Up, M::NONE)],
                description: Some("Move cursor up"),
            },
        );
        map.insert(
            "tui.editor.cursorDown",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Down, M::NONE)],
                description: Some("Move cursor down"),
            },
        );
        map.insert(
            "tui.editor.historyPrevious",
            KeybindingDefinition {
                default_keys: vec![],
                description: Some("Select previous prompt history entry"),
            },
        );
        map.insert(
            "tui.editor.historyNext",
            KeybindingDefinition {
                default_keys: vec![],
                description: Some("Select next prompt history entry"),
            },
        );
        map.insert(
            "tui.editor.cursorLeft",
            KeybindingDefinition {
                default_keys: vec![
                    KeyCombo::new(Left, M::NONE),
                    KeyCombo::new(Char('b'), M::CONTROL),
                ],
                description: Some("Move cursor left"),
            },
        );
        map.insert(
            "tui.editor.cursorRight",
            KeybindingDefinition {
                default_keys: vec![
                    KeyCombo::new(Right, M::NONE),
                    KeyCombo::new(Char('f'), M::CONTROL),
                ],
                description: Some("Move cursor right"),
            },
        );
        map.insert(
            "tui.editor.cursorWordLeft",
            KeybindingDefinition {
                default_keys: vec![
                    KeyCombo::new(Left, M::ALT),
                    KeyCombo::new(Left, M::CONTROL),
                    KeyCombo::new(Char('b'), M::ALT),
                ],
                description: Some("Move cursor word left"),
            },
        );
        map.insert(
            "tui.editor.cursorWordRight",
            KeybindingDefinition {
                default_keys: vec![
                    KeyCombo::new(Right, M::ALT),
                    KeyCombo::new(Right, M::CONTROL),
                    KeyCombo::new(Char('f'), M::ALT),
                ],
                description: Some("Move cursor word right"),
            },
        );
        map.insert(
            "tui.editor.cursorLineStart",
            KeybindingDefinition {
                default_keys: vec![
                    KeyCombo::new(Home, M::NONE),
                    KeyCombo::new(Char('a'), M::CONTROL),
                ],
                description: Some("Move to line start"),
            },
        );
        map.insert(
            "tui.editor.jumpForward",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char(']'), M::CONTROL)],
                description: Some("Jump forward to character"),
            },
        );
        map.insert(
            "tui.editor.jumpBackward",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char(']'), M::CONTROL | M::ALT)],
                description: Some("Jump backward to character"),
            },
        );
        map.insert(
            "tui.editor.pageUp",
            KeybindingDefinition {
                default_keys: vec![
                    KeyCombo::new(PageUp, M::NONE),
                    KeyCombo::new(PageUp, M::CONTROL),
                ],
                description: Some("Page up"),
            },
        );
        map.insert(
            "tui.editor.pageDown",
            KeybindingDefinition {
                default_keys: vec![
                    KeyCombo::new(PageDown, M::NONE),
                    KeyCombo::new(PageDown, M::CONTROL),
                ],
                description: Some("Page down"),
            },
        );
        map.insert(
            "tui.editor.deleteCharBackward",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Backspace, M::NONE)],
                description: Some("Delete character backward"),
            },
        );
        map.insert(
            "tui.editor.deleteCharForward",
            KeybindingDefinition {
                default_keys: vec![
                    KeyCombo::new(Delete, M::NONE),
                    KeyCombo::new(Char('d'), M::CONTROL),
                ],
                description: Some("Delete character forward"),
            },
        );
        map.insert(
            "tui.editor.deleteWordBackward",
            KeybindingDefinition {
                default_keys: vec![
                    KeyCombo::new(Char('w'), M::CONTROL),
                    KeyCombo::new(Backspace, M::ALT),
                ],
                description: Some("Delete word backward"),
            },
        );
        map.insert(
            "tui.editor.deleteWordForward",
            KeybindingDefinition {
                default_keys: vec![
                    KeyCombo::new(Char('d'), M::ALT),
                    KeyCombo::new(Delete, M::ALT),
                ],
                description: Some("Delete word forward"),
            },
        );
        map.insert(
            "tui.editor.deleteToLineStart",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('u'), M::CONTROL)],
                description: Some("Delete to line start"),
            },
        );
        map.insert(
            "tui.editor.deleteToLineEnd",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('k'), M::CONTROL)],
                description: Some("Delete to line end"),
            },
        );
        map.insert(
            "tui.editor.yank",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('y'), M::CONTROL)],
                description: Some("Yank"),
            },
        );
        map.insert(
            "tui.editor.yankPop",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('y'), M::ALT)],
                description: Some("Yank pop"),
            },
        );
        map.insert(
            "tui.editor.undo",
            KeybindingDefinition {
                // Upstream: `ctrl+z` on Windows, `ctrl+-` elsewhere.
                default_keys: if cfg!(windows) {
                    vec![KeyCombo::new(Char('z'), M::CONTROL)]
                } else {
                    vec![KeyCombo::new(Char('-'), M::CONTROL)]
                },
                description: Some("Undo"),
            },
        );

        // Generic input actions
        map.insert(
            "tui.input.newLine",
            KeybindingDefinition {
                default_keys: vec![
                    KeyCombo::new(Enter, M::SHIFT),
                    KeyCombo::new(Char('j'), M::CONTROL),
                ],
                description: Some("Insert newline"),
            },
        );
        map.insert(
            "tui.input.submit",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Enter, M::NONE)],
                description: Some("Submit input"),
            },
        );
        map.insert(
            "tui.input.tab",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Tab, M::NONE)],
                description: Some("Tab / autocomplete"),
            },
        );
        map.insert(
            "tui.input.copy",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('c'), M::CONTROL)],
                description: Some("Copy selection"),
            },
        );

        // Generic selection actions
        map.insert(
            "tui.select.up",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Up, M::NONE)],
                description: Some("Move selection up"),
            },
        );
        map.insert(
            "tui.select.down",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Down, M::NONE)],
                description: Some("Move selection down"),
            },
        );
        map.insert(
            "tui.select.pageUp",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(PageUp, M::NONE)],
                description: Some("Selection page up"),
            },
        );
        map.insert(
            "tui.select.pageDown",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(PageDown, M::NONE)],
                description: Some("Selection page down"),
            },
        );
        map.insert(
            "tui.select.confirm",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Enter, M::NONE)],
                description: Some("Confirm selection"),
            },
        );
        map.insert(
            "tui.select.cancel",
            KeybindingDefinition {
                default_keys: vec![
                    KeyCombo::new(Esc, M::NONE),
                    KeyCombo::new(Char('c'), M::CONTROL),
                ],
                description: Some("Cancel selection"),
            },
        );

        // Alternate-screen viewport navigation
        map.insert(
            "tui.altScreen.pageUp",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(PageUp, M::NONE)],
                description: Some("Scroll viewport up one page"),
            },
        );
        map.insert(
            "tui.altScreen.pageDown",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(PageDown, M::NONE)],
                description: Some("Scroll viewport down one page"),
            },
        );
        map.insert(
            "tui.altScreen.halfPageUp",
            KeybindingDefinition {
                default_keys: vec![],
                description: Some("Scroll viewport up half a page"),
            },
        );
        map.insert(
            "tui.altScreen.halfPageDown",
            KeybindingDefinition {
                default_keys: vec![],
                description: Some("Scroll viewport down half a page"),
            },
        );
        map.insert(
            "tui.altScreen.lineUp",
            KeybindingDefinition {
                default_keys: vec![],
                description: Some("Scroll viewport up one line"),
            },
        );
        map.insert(
            "tui.altScreen.lineDown",
            KeybindingDefinition {
                default_keys: vec![],
                description: Some("Scroll viewport down one line"),
            },
        );
        map.insert(
            "tui.altScreen.previousPrompt",
            KeybindingDefinition {
                // Upstream: `ctrl+up` alone on Windows, the shifted and plain
                // arrows elsewhere.
                default_keys: if cfg!(windows) {
                    vec![KeyCombo::new(Up, M::CONTROL)]
                } else {
                    vec![
                        KeyCombo::new(Up, M::CONTROL | M::SHIFT),
                        KeyCombo::new(Up, M::CONTROL),
                    ]
                },
                description: Some("Jump to previous semantic prompt"),
            },
        );
        map.insert(
            "tui.altScreen.nextPrompt",
            KeybindingDefinition {
                // Upstream: `ctrl+down` alone on Windows, the shifted and plain
                // arrows elsewhere.
                default_keys: if cfg!(windows) {
                    vec![KeyCombo::new(Down, M::CONTROL)]
                } else {
                    vec![
                        KeyCombo::new(Down, M::CONTROL | M::SHIFT),
                        KeyCombo::new(Down, M::CONTROL),
                    ]
                },
                description: Some("Jump to next semantic prompt"),
            },
        );
        map.insert(
            "tui.altScreen.search",
            KeybindingDefinition {
                // Upstream: `ctrl+f` on Windows, `ctrl+shift+f` elsewhere.
                default_keys: if cfg!(windows) {
                    vec![KeyCombo::new(Char('f'), M::CONTROL)]
                } else {
                    vec![KeyCombo::new(Char('f'), M::CONTROL | M::SHIFT)]
                },
                description: Some("Search the primary scroll view"),
            },
        );
        map.insert(
            "tui.altScreen.searchNext",
            KeybindingDefinition {
                default_keys: vec![
                    KeyCombo::new(Enter, M::NONE),
                    KeyCombo::new(Char('g'), M::CONTROL),
                ],
                description: Some("Select the next search match"),
            },
        );
        map.insert(
            "tui.altScreen.searchPrevious",
            KeybindingDefinition {
                default_keys: vec![
                    KeyCombo::new(Enter, M::SHIFT),
                    KeyCombo::new(Char('g'), M::CONTROL | M::SHIFT),
                ],
                description: Some("Select the previous search match"),
            },
        );
        map.insert(
            "tui.altScreen.searchClose",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Esc, M::NONE)],
                description: Some("Close transcript search"),
            },
        );
        map.insert(
            "tui.altScreen.top",
            KeybindingDefinition {
                default_keys: vec![],
                description: Some("Scroll viewport to top"),
            },
        );
        map.insert(
            "tui.altScreen.bottom",
            KeybindingDefinition {
                default_keys: vec![KeyCombo::new(Char('e'), M::CONTROL)],
                description: Some("Scroll viewport to bottom"),
            },
        );

        map
    }

    /// Check if a key event matches a keybinding.
    pub fn matches(&self, event: &crossterm::event::KeyEvent, binding_id: KeybindingId) -> bool {
        if let Some(combos) = self.keys_by_id.get(binding_id) {
            let combo = KeyCombo::new(event.code, event.modifiers);
            return combos.contains(&combo);
        }
        false
    }

    /// Get the keybinding ID for a key event.
    pub fn get_binding(&self, event: &crossterm::event::KeyEvent) -> Option<KeybindingId> {
        let combo = KeyCombo::new(event.code, event.modifiers);
        for (id, combos) in &self.keys_by_id {
            if combos.contains(&combo) {
                return Some(*id);
            }
        }
        None
    }

    /// Get keys for a keybinding.
    pub fn get_keys(&self, binding_id: KeybindingId) -> Vec<KeyCombo> {
        self.keys_by_id.get(binding_id).cloned().unwrap_or_default()
    }

    /// Get definition for a keybinding.
    pub fn get_definition(&self, binding_id: KeybindingId) -> Option<&KeybindingDefinition> {
        self.definitions.get(binding_id)
    }

    /// Every registered keybinding id.
    pub fn ids(&self) -> Vec<KeybindingId> {
        let mut ids: Vec<KeybindingId> = self.definitions.keys().copied().collect();
        ids.sort_unstable();
        ids
    }

    /// Get conflicts.
    pub fn get_conflicts(&self) -> &[KeybindingConflict] {
        &self.conflicts
    }

    /// Set user bindings.
    pub fn set_user_bindings(&mut self, user_bindings: HashMap<KeybindingId, Vec<KeyCombo>>) {
        self.user_bindings = user_bindings;
        self.rebuild();
    }

    /// Rebuild the keybindings after user bindings change.
    fn rebuild(&mut self) {
        self.keys_by_id.clear();
        self.conflicts.clear();

        // Track which keys are claimed by which keybindings
        let mut key_claims: HashMap<KeyCombo, Vec<KeybindingId>> = HashMap::new();

        for (id, def) in &self.definitions {
            let keys = if let Some(user_keys) = self.user_bindings.get(id) {
                user_keys.clone()
            } else {
                def.default_keys.clone()
            };

            // Track claims
            for key in &keys {
                key_claims.entry(*key).or_default().push(*id);
            }

            self.keys_by_id.insert(*id, keys);
        }

        // Find conflicts
        for (key, claimants) in key_claims {
            if claimants.len() > 1 {
                self.conflicts.push(KeybindingConflict {
                    key,
                    keybindings: claimants,
                });
            }
        }
    }

    /// Set a single keybinding.
    pub fn set(&mut self, binding_id: KeybindingId, combos: Vec<KeyCombo>) {
        self.user_bindings.insert(binding_id, combos);
        self.rebuild();
    }
}

impl Default for Keybindings {
    fn default() -> Self {
        Self::new()
    }
}

/// Global keybindings manager.
static GLOBAL_KEYBINDINGS: std::sync::OnceLock<std::sync::Mutex<Keybindings>> =
    std::sync::OnceLock::new();

/// Set global keybindings.
pub fn set_keybindings(keybindings: Keybindings) {
    let guard = GLOBAL_KEYBINDINGS.get_or_init(|| std::sync::Mutex::new(Keybindings::new()));
    if let Ok(mut kb) = guard.lock() {
        *kb = keybindings;
    }
}

/// Get global keybindings.
pub fn get_keybindings() -> std::sync::MutexGuard<'static, Keybindings> {
    let guard = GLOBAL_KEYBINDINGS.get_or_init(|| std::sync::Mutex::new(Keybindings::new()));
    guard.lock().expect("Failed to lock global keybindings")
}

/// Predefined keybinding IDs.
pub mod keys {
    use super::KeybindingId;

    pub const INTERRUPT: KeybindingId = "app.interrupt";
    pub const QUIT: KeybindingId = "app.quit";
    pub const EXIT: KeybindingId = "app.exit";
    pub const SUSPEND: KeybindingId = "app.suspend";
    pub const THINKING_CYCLE: KeybindingId = "app.thinking.cycle";
    pub const THINKING_SAVE: KeybindingId = "app.thinking.save";
    pub const MODEL_CYCLE_FORWARD: KeybindingId = "app.model.cycleForward";
    pub const MODEL_CYCLE_BACKWARD: KeybindingId = "app.model.cycleBackward";
    pub const MODEL_SELECT: KeybindingId = "app.model.select";
    pub const TOOLS_EXPAND: KeybindingId = "app.tools.expand";
    pub const THINKING_TOGGLE: KeybindingId = "app.thinking.toggle";
    pub const SESSION_TOGGLE_NAMED_FILTER: KeybindingId = "app.session.toggleNamedFilter";
    pub const EXTERNAL_EDITOR: KeybindingId = "app.editor.external";
    pub const MESSAGE_COPY: KeybindingId = "app.message.copy";
    pub const MESSAGE_FOLLOW_UP: KeybindingId = "app.message.followUp";
    pub const DEQUEUE: KeybindingId = "app.message.dequeue";
    pub const PASTE_IMAGE: KeybindingId = "app.clipboard.pasteImage";
    pub const SESSION_NEW: KeybindingId = "app.session.new";
    pub const SESSION_TREE: KeybindingId = "app.session.tree";
    pub const SESSION_FORK: KeybindingId = "app.session.fork";
    pub const SESSION_RESUME: KeybindingId = "app.session.resume";
    pub const TREE_FOLD_OR_UP: KeybindingId = "app.tree.foldOrUp";
    pub const TREE_UNFOLD_OR_DOWN: KeybindingId = "app.tree.unfoldOrDown";
    pub const TREE_EDIT_LABEL: KeybindingId = "app.tree.editLabel";
    pub const TREE_TOGGLE_LABEL_TIMESTAMP: KeybindingId = "app.tree.toggleLabelTimestamp";
    pub const SESSION_TOGGLE_PATH: KeybindingId = "app.session.togglePath";
    pub const SESSION_TOGGLE_SORT: KeybindingId = "app.session.toggleSort";
    pub const SESSION_RENAME: KeybindingId = "app.session.rename";
    pub const SESSION_DELETE: KeybindingId = "app.session.delete";
    pub const SESSION_DELETE_NONINVASIVE: KeybindingId = "app.session.deleteNoninvasive";
    pub const MODELS_SAVE: KeybindingId = "app.models.save";
    pub const MODELS_ENABLE_ALL: KeybindingId = "app.models.enableAll";
    pub const MODELS_CLEAR_ALL: KeybindingId = "app.models.clearAll";
    pub const MODELS_TOGGLE_PROVIDER: KeybindingId = "app.models.toggleProvider";
    pub const MODELS_REORDER_UP: KeybindingId = "app.models.reorderUp";
    pub const MODELS_REORDER_DOWN: KeybindingId = "app.models.reorderDown";
    pub const TREE_FILTER_DEFAULT: KeybindingId = "app.tree.filter.default";
    pub const TREE_FILTER_NO_TOOLS: KeybindingId = "app.tree.filter.noTools";
    pub const TREE_FILTER_USER_ONLY: KeybindingId = "app.tree.filter.userOnly";
    pub const TREE_FILTER_LABELED_ONLY: KeybindingId = "app.tree.filter.labeledOnly";
    pub const TREE_FILTER_ALL: KeybindingId = "app.tree.filter.all";
    pub const TREE_FILTER_CYCLE_FORWARD: KeybindingId = "app.tree.filter.cycleForward";
    pub const TREE_FILTER_CYCLE_BACKWARD: KeybindingId = "app.tree.filter.cycleBackward";

    // Editor
    pub const CURSOR_UP: KeybindingId = "tui.editor.cursorUp";
    pub const CURSOR_DOWN: KeybindingId = "tui.editor.cursorDown";
    pub const HISTORY_PREVIOUS: KeybindingId = "tui.editor.historyPrevious";
    pub const HISTORY_NEXT: KeybindingId = "tui.editor.historyNext";
    pub const CURSOR_LEFT: KeybindingId = "tui.editor.cursorLeft";
    pub const CURSOR_RIGHT: KeybindingId = "tui.editor.cursorRight";
    pub const CURSOR_WORD_LEFT: KeybindingId = "tui.editor.cursorWordLeft";
    pub const CURSOR_WORD_RIGHT: KeybindingId = "tui.editor.cursorWordRight";
    pub const CURSOR_LINE_START: KeybindingId = "tui.editor.cursorLineStart";
    pub const JUMP_FORWARD: KeybindingId = "tui.editor.jumpForward";
    pub const JUMP_BACKWARD: KeybindingId = "tui.editor.jumpBackward";
    pub const EDITOR_PAGE_UP: KeybindingId = "tui.editor.pageUp";
    pub const EDITOR_PAGE_DOWN: KeybindingId = "tui.editor.pageDown";
    pub const DELETE_CHAR_BACKWARD: KeybindingId = "tui.editor.deleteCharBackward";
    pub const DELETE_CHAR_FORWARD: KeybindingId = "tui.editor.deleteCharForward";
    pub const DELETE_WORD_BACKWARD: KeybindingId = "tui.editor.deleteWordBackward";
    pub const DELETE_WORD_FORWARD: KeybindingId = "tui.editor.deleteWordForward";
    pub const DELETE_TO_LINE_START: KeybindingId = "tui.editor.deleteToLineStart";
    pub const DELETE_TO_LINE_END: KeybindingId = "tui.editor.deleteToLineEnd";
    pub const YANK: KeybindingId = "tui.editor.yank";
    pub const YANK_POP: KeybindingId = "tui.editor.yankPop";
    pub const UNDO: KeybindingId = "tui.editor.undo";

    // Input
    pub const INPUT_NEW_LINE: KeybindingId = "tui.input.newLine";
    pub const INPUT_SUBMIT: KeybindingId = "tui.input.submit";
    pub const INPUT_TAB: KeybindingId = "tui.input.tab";
    pub const INPUT_COPY: KeybindingId = "tui.input.copy";

    // Select
    pub const SELECT_UP: KeybindingId = "tui.select.up";
    pub const SELECT_DOWN: KeybindingId = "tui.select.down";
    pub const SELECT_PAGE_UP: KeybindingId = "tui.select.pageUp";
    pub const SELECT_PAGE_DOWN: KeybindingId = "tui.select.pageDown";
    pub const SELECT_CONFIRM: KeybindingId = "tui.select.confirm";
    pub const SELECT_CANCEL: KeybindingId = "tui.select.cancel";

    // Alt screen
    pub const PAGE_UP: KeybindingId = "tui.altScreen.pageUp";
    pub const PAGE_DOWN: KeybindingId = "tui.altScreen.pageDown";
    pub const HALF_PAGE_UP: KeybindingId = "tui.altScreen.halfPageUp";
    pub const HALF_PAGE_DOWN: KeybindingId = "tui.altScreen.halfPageDown";
    pub const LINE_UP: KeybindingId = "tui.altScreen.lineUp";
    pub const LINE_DOWN: KeybindingId = "tui.altScreen.lineDown";
    pub const PREVIOUS_PROMPT: KeybindingId = "tui.altScreen.previousPrompt";
    pub const NEXT_PROMPT: KeybindingId = "tui.altScreen.nextPrompt";
    pub const SEARCH: KeybindingId = "tui.altScreen.search";
    pub const SEARCH_NEXT: KeybindingId = "tui.altScreen.searchNext";
    pub const SEARCH_PREVIOUS: KeybindingId = "tui.altScreen.searchPrevious";
    pub const SEARCH_CLOSE: KeybindingId = "tui.altScreen.searchClose";
    pub const TOP: KeybindingId = "tui.altScreen.top";
    pub const BOTTOM: KeybindingId = "tui.altScreen.bottom";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keybindings_new() {
        let kb = Keybindings::new();
        assert!(kb.definitions.len() > 0);
    }

    #[test]
    fn test_matches() {
        let kb = Keybindings::new();
        let event = crossterm::event::KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE);
        assert!(kb.matches(&event, keys::INPUT_SUBMIT));
    }

    #[test]
    fn test_get_keys() {
        let kb = Keybindings::new();
        let keys = kb.get_keys(keys::CURSOR_LEFT);
        assert!(!keys.is_empty());
    }

    #[test]
    fn key_combo_display_formats_hints() {
        assert_eq!(
            KeyCombo::new(KeyCode::Char('q'), KeyModifiers::ALT).display(),
            "Alt+Q"
        );
        assert_eq!(
            KeyCombo::new(
                KeyCode::Char('f'),
                KeyModifiers::CONTROL | KeyModifiers::SHIFT
            )
            .display(),
            "Ctrl+Shift+F"
        );
        assert_eq!(
            KeyCombo::new(KeyCode::Enter, KeyModifiers::NONE).display(),
            "Enter"
        );
        assert_eq!(
            KeyCombo::new(KeyCode::Up, KeyModifiers::ALT).display(),
            "Alt+Up"
        );
    }

    #[test]
    fn dequeue_binding_has_a_platform_default() {
        let kb = Keybindings::new();
        let keys = kb.get_keys(keys::DEQUEUE);
        assert_eq!(keys.len(), 1);
        if cfg!(windows) {
            assert_eq!(keys[0].display(), "Alt+Q");
        } else {
            assert_eq!(keys[0].display(), "Alt+Up");
        }
    }

    #[test]
    fn dequeue_matches_its_platform_default_event() {
        // Guards the hotkey itself: a real Alt+Q (Windows) / Alt+Up (elsewhere)
        // event must resolve to `app.message.dequeue`, since the TUI key loop
        // routes the "edit queued messages" action solely through this match.
        let kb = Keybindings::new();
        let event = if cfg!(windows) {
            crossterm::event::KeyEvent::new(KeyCode::Char('q'), KeyModifiers::ALT)
        } else {
            crossterm::event::KeyEvent::new(KeyCode::Up, KeyModifiers::ALT)
        };
        assert!(kb.matches(&event, keys::DEQUEUE));
    }

    /// Every id the original registers, with its default keys and its
    /// description. Mirrors `packages/coding-agent/src/core/keybindings.ts`
    /// (the `KEYBINDINGS` export: the TUI registry plus the app registry).
    fn original_registry() -> Vec<(KeybindingId, Vec<KeyCombo>, Option<&'static str>)> {
        use KeyCode::*;
        use KeyModifiers as M;
        let ctrl = M::CONTROL;
        let shift = M::SHIFT;
        let alt = M::ALT;
        let none = M::NONE;
        let ch = |c: char, modifiers: KeyModifiers| KeyCombo::new(Char(c), modifiers);
        vec![
            (
                "app.interrupt",
                vec![KeyCombo::new(Esc, none)],
                Some("Cancel or abort"),
            ),
            (
                "app.quit",
                vec![ch('c', ctrl)],
                Some("Exit (press twice)"),
            ),
            (
                "app.exit",
                vec![ch('d', ctrl)],
                Some("Exit when editor is empty"),
            ),
            (
                "app.suspend",
                if cfg!(windows) {
                    vec![]
                } else {
                    vec![ch('z', ctrl)]
                },
                Some("Suspend to background"),
            ),
            (
                "app.thinking.cycle",
                vec![KeyCombo::new(Tab, shift)],
                Some("Cycle thinking level"),
            ),
            (
                "app.thinking.save",
                vec![ch('s', ctrl)],
                Some("Save thinking level"),
            ),
            (
                "app.model.cycleForward",
                vec![ch('p', ctrl)],
                Some("Cycle to next model"),
            ),
            (
                "app.model.cycleBackward",
                if cfg!(windows) {
                    vec![ch('p', alt)]
                } else {
                    vec![ch('p', ctrl | shift)]
                },
                Some("Cycle to previous model"),
            ),
            (
                "app.model.select",
                vec![ch('l', ctrl)],
                Some("Open model selector"),
            ),
            (
                "app.tools.expand",
                vec![ch('o', ctrl)],
                Some("Toggle tool output"),
            ),
            (
                "app.thinking.toggle",
                vec![ch('t', ctrl)],
                Some("Toggle thinking blocks"),
            ),
            (
                "app.session.toggleNamedFilter",
                vec![ch('n', ctrl)],
                Some("Toggle named session filter"),
            ),
            (
                "app.editor.external",
                vec![ch('g', ctrl)],
                Some("Open external editor"),
            ),
            (
                "app.message.copy",
                vec![ch('x', ctrl)],
                Some("Copy selection or last assistant message"),
            ),
            (
                "app.message.followUp",
                if cfg!(windows) {
                    vec![ch('q', ctrl)]
                } else {
                    vec![KeyCombo::new(Enter, alt)]
                },
                Some("Queue follow-up message"),
            ),
            (
                "app.message.dequeue",
                if cfg!(windows) {
                    vec![ch('q', alt)]
                } else {
                    vec![KeyCombo::new(Up, alt)]
                },
                Some("Restore queued messages"),
            ),
            (
                "app.clipboard.pasteImage",
                if cfg!(windows) {
                    vec![ch('v', alt)]
                } else {
                    vec![ch('v', ctrl)]
                },
                Some("Paste files on macOS, images, or text from clipboard"),
            ),
            ("app.session.new", vec![], Some("Start a new session")),
            ("app.session.tree", vec![], Some("Open session tree")),
            ("app.session.fork", vec![], Some("Fork current session")),
            ("app.session.resume", vec![], Some("Resume a session")),
            (
                "app.tree.foldOrUp",
                if cfg!(target_os = "macos") {
                    vec![KeyCombo::new(Left, alt), KeyCombo::new(Left, ctrl)]
                } else {
                    vec![KeyCombo::new(Left, ctrl), KeyCombo::new(Left, alt)]
                },
                Some("Fold tree branch or move up"),
            ),
            (
                "app.tree.unfoldOrDown",
                if cfg!(target_os = "macos") {
                    vec![KeyCombo::new(Right, alt), KeyCombo::new(Right, ctrl)]
                } else {
                    vec![KeyCombo::new(Right, ctrl), KeyCombo::new(Right, alt)]
                },
                Some("Unfold tree branch or move down"),
            ),
            (
                "app.tree.editLabel",
                vec![ch('l', shift)],
                Some("Edit tree label"),
            ),
            (
                "app.tree.toggleLabelTimestamp",
                vec![ch('t', shift)],
                Some("Toggle tree label timestamps"),
            ),
            (
                "app.session.togglePath",
                vec![ch('p', ctrl)],
                Some("Toggle session path display"),
            ),
            (
                "app.session.toggleSort",
                vec![ch('s', ctrl)],
                Some("Toggle session sort mode"),
            ),
            (
                "app.session.rename",
                vec![ch('r', ctrl)],
                Some("Rename session"),
            ),
            (
                "app.session.delete",
                vec![ch('d', ctrl)],
                Some("Delete session"),
            ),
            (
                "app.session.deleteNoninvasive",
                vec![KeyCombo::new(Backspace, ctrl)],
                Some("Delete session when query is empty"),
            ),
            (
                "app.models.save",
                vec![ch('s', ctrl)],
                Some("Save model selection"),
            ),
            (
                "app.models.enableAll",
                vec![ch('a', ctrl)],
                Some("Enable all models"),
            ),
            (
                "app.models.clearAll",
                vec![ch('x', ctrl)],
                Some("Clear all models"),
            ),
            (
                "app.models.toggleProvider",
                vec![ch('p', ctrl)],
                Some("Toggle all models for provider"),
            ),
            (
                "app.models.reorderUp",
                vec![KeyCombo::new(Up, alt)],
                Some("Move model up in order"),
            ),
            (
                "app.models.reorderDown",
                vec![KeyCombo::new(Down, alt)],
                Some("Move model down in order"),
            ),
            (
                "app.tree.filter.default",
                vec![ch('d', ctrl)],
                Some("Tree filter: default view"),
            ),
            (
                "app.tree.filter.noTools",
                vec![ch('t', ctrl)],
                Some("Tree filter: hide tool results"),
            ),
            (
                "app.tree.filter.userOnly",
                vec![ch('u', ctrl)],
                Some("Tree filter: user messages only"),
            ),
            (
                "app.tree.filter.labeledOnly",
                vec![ch('l', ctrl)],
                Some("Tree filter: labeled entries only"),
            ),
            (
                "app.tree.filter.all",
                vec![ch('a', ctrl)],
                Some("Tree filter: show all entries"),
            ),
            (
                "app.tree.filter.cycleForward",
                vec![ch('o', ctrl)],
                Some("Tree filter: cycle forward"),
            ),
            (
                "app.tree.filter.cycleBackward",
                vec![ch('o', ctrl | shift)],
                Some("Tree filter: cycle backward"),
            ),
            (
                "tui.editor.cursorUp",
                vec![KeyCombo::new(Up, none)],
                Some("Move cursor up"),
            ),
            (
                "tui.editor.cursorDown",
                vec![KeyCombo::new(Down, none)],
                Some("Move cursor down"),
            ),
            (
                "tui.editor.historyPrevious",
                vec![],
                Some("Select previous prompt history entry"),
            ),
            (
                "tui.editor.historyNext",
                vec![],
                Some("Select next prompt history entry"),
            ),
            (
                "tui.editor.cursorLeft",
                vec![KeyCombo::new(Left, none), ch('b', ctrl)],
                Some("Move cursor left"),
            ),
            (
                "tui.editor.cursorRight",
                vec![KeyCombo::new(Right, none), ch('f', ctrl)],
                Some("Move cursor right"),
            ),
            (
                "tui.editor.cursorWordLeft",
                vec![
                    KeyCombo::new(Left, alt),
                    KeyCombo::new(Left, ctrl),
                    ch('b', alt),
                ],
                Some("Move cursor word left"),
            ),
            (
                "tui.editor.cursorWordRight",
                vec![
                    KeyCombo::new(Right, alt),
                    KeyCombo::new(Right, ctrl),
                    ch('f', alt),
                ],
                Some("Move cursor word right"),
            ),
            (
                "tui.editor.cursorLineStart",
                vec![KeyCombo::new(Home, none), ch('a', ctrl)],
                Some("Move to line start"),
            ),
            (
                "tui.editor.jumpForward",
                vec![ch(']', ctrl)],
                Some("Jump forward to character"),
            ),
            (
                "tui.editor.jumpBackward",
                vec![ch(']', ctrl | alt)],
                Some("Jump backward to character"),
            ),
            (
                "tui.editor.pageUp",
                vec![KeyCombo::new(PageUp, none), KeyCombo::new(PageUp, ctrl)],
                Some("Page up"),
            ),
            (
                "tui.editor.pageDown",
                vec![KeyCombo::new(PageDown, none), KeyCombo::new(PageDown, ctrl)],
                Some("Page down"),
            ),
            (
                "tui.editor.deleteCharBackward",
                vec![KeyCombo::new(Backspace, none)],
                Some("Delete character backward"),
            ),
            (
                "tui.editor.deleteCharForward",
                vec![KeyCombo::new(Delete, none), ch('d', ctrl)],
                Some("Delete character forward"),
            ),
            (
                "tui.editor.deleteWordBackward",
                vec![ch('w', ctrl), KeyCombo::new(Backspace, alt)],
                Some("Delete word backward"),
            ),
            (
                "tui.editor.deleteWordForward",
                vec![ch('d', alt), KeyCombo::new(Delete, alt)],
                Some("Delete word forward"),
            ),
            (
                "tui.editor.deleteToLineStart",
                vec![ch('u', ctrl)],
                Some("Delete to line start"),
            ),
            (
                "tui.editor.deleteToLineEnd",
                vec![ch('k', ctrl)],
                Some("Delete to line end"),
            ),
            ("tui.editor.yank", vec![ch('y', ctrl)], Some("Yank")),
            ("tui.editor.yankPop", vec![ch('y', alt)], Some("Yank pop")),
            (
                "tui.editor.undo",
                if cfg!(windows) {
                    vec![ch('z', ctrl)]
                } else {
                    vec![ch('-', ctrl)]
                },
                Some("Undo"),
            ),
            (
                "tui.input.newLine",
                vec![KeyCombo::new(Enter, shift), ch('j', ctrl)],
                Some("Insert newline"),
            ),
            (
                "tui.input.submit",
                vec![KeyCombo::new(Enter, none)],
                Some("Submit input"),
            ),
            (
                "tui.input.tab",
                vec![KeyCombo::new(Tab, none)],
                Some("Tab / autocomplete"),
            ),
            (
                "tui.input.copy",
                vec![ch('c', ctrl)],
                Some("Copy selection"),
            ),
            (
                "tui.select.up",
                vec![KeyCombo::new(Up, none)],
                Some("Move selection up"),
            ),
            (
                "tui.select.down",
                vec![KeyCombo::new(Down, none)],
                Some("Move selection down"),
            ),
            (
                "tui.select.pageUp",
                vec![KeyCombo::new(PageUp, none)],
                Some("Selection page up"),
            ),
            (
                "tui.select.pageDown",
                vec![KeyCombo::new(PageDown, none)],
                Some("Selection page down"),
            ),
            (
                "tui.select.confirm",
                vec![KeyCombo::new(Enter, none)],
                Some("Confirm selection"),
            ),
            (
                "tui.select.cancel",
                vec![KeyCombo::new(Esc, none), ch('c', ctrl)],
                Some("Cancel selection"),
            ),
            (
                "tui.altScreen.pageUp",
                vec![KeyCombo::new(PageUp, none)],
                Some("Scroll viewport up one page"),
            ),
            (
                "tui.altScreen.pageDown",
                vec![KeyCombo::new(PageDown, none)],
                Some("Scroll viewport down one page"),
            ),
            (
                "tui.altScreen.halfPageUp",
                vec![],
                Some("Scroll viewport up half a page"),
            ),
            (
                "tui.altScreen.halfPageDown",
                vec![],
                Some("Scroll viewport down half a page"),
            ),
            (
                "tui.altScreen.lineUp",
                vec![],
                Some("Scroll viewport up one line"),
            ),
            (
                "tui.altScreen.lineDown",
                vec![],
                Some("Scroll viewport down one line"),
            ),
            (
                "tui.altScreen.previousPrompt",
                if cfg!(windows) {
                    vec![KeyCombo::new(Up, ctrl)]
                } else {
                    vec![KeyCombo::new(Up, ctrl | shift), KeyCombo::new(Up, ctrl)]
                },
                Some("Jump to previous semantic prompt"),
            ),
            (
                "tui.altScreen.nextPrompt",
                if cfg!(windows) {
                    vec![KeyCombo::new(Down, ctrl)]
                } else {
                    vec![KeyCombo::new(Down, ctrl | shift), KeyCombo::new(Down, ctrl)]
                },
                Some("Jump to next semantic prompt"),
            ),
            (
                "tui.altScreen.search",
                if cfg!(windows) {
                    vec![ch('f', ctrl)]
                } else {
                    vec![ch('f', ctrl | shift)]
                },
                Some("Search the primary scroll view"),
            ),
            (
                "tui.altScreen.searchNext",
                vec![KeyCombo::new(Enter, none), ch('g', ctrl)],
                Some("Select the next search match"),
            ),
            (
                "tui.altScreen.searchPrevious",
                vec![KeyCombo::new(Enter, shift), ch('g', ctrl | shift)],
                Some("Select the previous search match"),
            ),
            (
                "tui.altScreen.searchClose",
                vec![KeyCombo::new(Esc, none)],
                Some("Close transcript search"),
            ),
            (
                "tui.altScreen.top",
                vec![],
                Some("Scroll viewport to top"),
            ),
            (
                "tui.altScreen.bottom",
                vec![ch('e', ctrl)],
                Some("Scroll viewport to bottom"),
            ),
        ]
    }

    #[test]
    fn registry_matches_the_original() {
        let kb = Keybindings::new();
        let expected = original_registry();
        let mut missing = Vec::new();
        let mut different = Vec::new();
        for (id, keys, description) in &expected {
            let Some(definition) = kb.get_definition(id) else {
                missing.push(*id);
                continue;
            };
            if definition.default_keys != *keys {
                different.push((*id, definition.default_keys.clone(), keys.clone()));
            }
            if definition.description != *description {
                different.push((*id, definition.default_keys.clone(), keys.clone()));
            }
        }
        assert!(missing.is_empty(), "missing ids: {missing:?}");
        assert!(
            different.is_empty(),
            "different defaults or descriptions: {different:?}"
        );
        let expected_ids: Vec<KeybindingId> = expected.iter().map(|(id, _, _)| *id).collect();
        let mut actual_ids = kb.ids();
        actual_ids.sort_unstable();
        let mut expected_ids = expected_ids;
        expected_ids.sort_unstable();
        assert_eq!(
            actual_ids, expected_ids,
            "the registry must hold exactly the original's ids"
        );
    }
}
