//! Settings list component.
//!
//! A list of settings with navigation, an optional search field, in-place value
//! cycling and nested submenus. Port of upstream's
//! `packages/tui/src/components/settings-list.ts`: Up/Down navigate, Enter (or
//! Space) activates the row — cycling to the next value, or opening the row's
//! submenu — and Esc cancels. The list owns the submenu: while one is open the
//! list renders it and routes every key to it, and closing it returns to the
//! rows.

use std::any::Any;
use std::sync::{Arc, Mutex};

use crossterm::event::{KeyCode, KeyEvent};

use super::component::{Component, Focusable};
use super::fuzzy::fuzzy_filter;
use super::input::Input;
use crate::apply_hover;
use crate::HoverableList;
use crate::{MouseButton, MouseEvent, MouseEventKind, MouseEventResult};
use crate::utils::{truncate_to_width, visible_width, wrap_text_with_ansi};

/// Closes a submenu. `Some(value)` applies the value to the row that opened it.
pub type SubmenuDone = Arc<dyn Fn(Option<String>) + Send + Sync>;

/// A submenu: the component that renders it and the key router that drives it.
pub struct SubmenuView {
    /// The component that renders the submenu.
    pub component: Arc<dyn Component>,
    /// Routes a key to the submenu.
    pub handle_key: Arc<dyn Fn(KeyEvent) + Send + Sync>,
}

impl SubmenuView {
    /// Build a submenu from a component and its key router.
    pub fn new(
        component: Arc<dyn Component>,
        handle_key: Arc<dyn Fn(KeyEvent) + Send + Sync>,
    ) -> Self {
        Self {
            component,
            handle_key,
        }
    }
}

/// Builds the submenu of a row. Receives the row's current value and the
/// callback that closes the submenu.
pub type SubmenuFactory = Arc<dyn Fn(&str, &SubmenuDone) -> SubmenuView + Send + Sync>;

/// A setting item.
#[derive(Clone)]
pub struct SettingItem {
    /// Setting key.
    pub key: String,
    /// Display label.
    pub label: String,
    /// Setting value.
    pub value: String,
    /// Description.
    pub description: Option<String>,
    /// Setting type.
    pub setting_type: SettingType,
    /// Values cycled through by [`SettingsList::activate`]. Empty for submenu
    /// triggers and read-only rows.
    pub values: Vec<String>,
    /// Whether activating the row should open a submenu rather than cycle
    /// `values`.
    pub has_submenu: bool,
    /// The factory that builds the row's submenu.
    pub submenu: Option<SubmenuFactory>,
}

impl std::fmt::Debug for SettingItem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SettingItem")
            .field("key", &self.key)
            .field("label", &self.label)
            .field("value", &self.value)
            .field("description", &self.description)
            .field("setting_type", &self.setting_type)
            .field("values", &self.values)
            .field("has_submenu", &self.has_submenu)
            .field("submenu", &self.submenu.is_some())
            .finish()
    }
}

impl SettingItem {
    /// Create a new setting item.
    pub fn new(key: &str, label: &str, value: &str) -> Self {
        Self {
            key: key.to_string(),
            label: label.to_string(),
            value: value.to_string(),
            description: None,
            setting_type: SettingType::String,
            values: Vec::new(),
            has_submenu: false,
            submenu: None,
        }
    }

    /// Add description.
    pub fn with_description(mut self, description: &str) -> Self {
        self.description = Some(description.to_string());
        self
    }

    /// Set setting type.
    pub fn with_type(mut self, setting_type: SettingType) -> Self {
        self.setting_type = setting_type;
        self
    }

    /// The cycle order for this row. Activating the row advances to the next
    /// value and fires `on_change`. Empty ⇒ the row is a submenu trigger or a
    /// read-only display.
    pub fn with_values(mut self, values: &[&str]) -> Self {
        self.values = values.iter().map(|v| v.to_string()).collect();
        self
    }

    /// Mark the row as a submenu trigger: activating it opens the submenu
    /// built by `factory` instead of cycling values.
    pub fn with_submenu_factory(mut self, factory: SubmenuFactory) -> Self {
        self.has_submenu = true;
        self.submenu = Some(factory);
        self
    }

    /// Mark the row as a submenu trigger without a factory. Activating it
    /// calls `on_select` instead of cycling values.
    pub fn with_submenu(mut self) -> Self {
        self.has_submenu = true;
        self
    }
}

/// Setting type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingType {
    /// String setting.
    String,
    /// Boolean setting.
    Boolean,
    /// Number setting.
    Number,
    /// Enum setting.
    Enum,
}

/// Settings list theme.
#[derive(Clone, Copy)]
pub struct SettingsListTheme {
    /// The label column.
    pub label: fn(&str, bool) -> String,
    /// The value column.
    pub value: fn(&str, bool) -> String,
    /// The description of the selected row.
    pub description: fn(&str) -> String,
    /// The cursor in front of the selected row.
    pub cursor: fn(&str) -> String,
    /// The hint line at the bottom.
    pub hint: fn(&str) -> String,
}

impl Default for SettingsListTheme {
    fn default() -> Self {
        Self {
            label: |text, selected| {
                if selected {
                    crate::theme::theme().colors.accent.fg(text)
                } else {
                    text.to_string()
                }
            },
            value: |text, selected| {
                if selected {
                    crate::theme::theme().colors.accent.fg(text)
                } else {
                    crate::theme::theme().colors.muted.fg(text)
                }
            },
            description: |text| crate::theme::theme().colors.dim.fg(text),
            cursor: |text| crate::theme::theme().colors.accent.fg(text),
            hint: |text| crate::theme::theme().colors.dim.fg(text),
        }
    }
}

/// The mutable state of a settings list, shared with the submenu's `done`
/// callback so a submenu can write back into the list that opened it.
struct SettingsState {
    settings: Mutex<Vec<SettingItem>>,
    filtered: Mutex<Vec<SettingItem>>,
    selected_index: Mutex<usize>,
    window_start: Mutex<usize>,
    filter: Mutex<String>,
    on_change: Mutex<Option<Arc<dyn Fn(&str, &str) + Send + Sync>>>,
    on_select: Mutex<Option<Arc<dyn Fn(&SettingItem) + Send + Sync>>>,
    on_cancel: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
    submenu: Mutex<Option<ActiveSubmenu>>,
    /// The row the pointer was pressed on, so the matching click activates
    /// that row and not the one the pointer ended on.
    mouse_pressed_index: Mutex<Option<usize>>,
}

struct ActiveSubmenu {
    view: SubmenuView,
    item_index: usize,
    key: String,
}

impl SettingsState {
    fn display_items(&self) -> Vec<SettingItem> {
        self.filtered
            .lock()
            .map(|items| items.clone())
            .unwrap_or_default()
    }

    fn set_filter(&self, filter: &str) {
        if let Ok(mut guard) = self.filter.lock() {
            *guard = filter.to_string();
        }
        self.refilter();
        if let Ok(mut index) = self.selected_index.lock() {
            *index = 0;
        }
        if let Ok(mut start) = self.window_start.lock() {
            *start = 0;
        }
    }

    fn refilter(&self) {
        let filter = self.filter.lock().map(|f| f.clone()).unwrap_or_default();
        if let Ok(settings) = self.settings.lock() {
            let filtered = fuzzy_filter(&*settings, &filter, |item| item.label.as_str());
            if let Ok(mut guard) = self.filtered.lock() {
                *guard = filtered;
            }
        }
    }

    fn set_item_value(&self, key: &str, value: &str) {
        if let Ok(mut settings) = self.settings.lock() {
            for setting in settings.iter_mut() {
                if setting.key == key {
                    setting.value = value.to_string();
                    break;
                }
            }
        }
        self.refilter();
    }

    fn close_submenu(&self) {
        let active = self.submenu.lock().ok().and_then(|mut guard| guard.take());
        if let Some(active) = active {
            if let Ok(mut index) = self.selected_index.lock() {
                *index = active.item_index.min(self.display_items().len().saturating_sub(1));
            }
        }
    }
}

/// Settings list component.
pub struct SettingsList {
    state: Arc<SettingsState>,
    max_visible: usize,
    theme: SettingsListTheme,
    search_input: Option<Arc<Input>>,
}

impl SettingsList {
    /// Create a new settings list.
    pub fn new(settings: Vec<SettingItem>) -> Self {
        Self {
            state: Arc::new(SettingsState {
                filtered: Mutex::new(settings.clone()),
                settings: Mutex::new(settings),
                selected_index: Mutex::new(0),
                window_start: Mutex::new(0),
                filter: Mutex::new(String::new()),
                on_change: Mutex::new(None),
                on_select: Mutex::new(None),
                on_cancel: Mutex::new(None),
                submenu: Mutex::new(None),
                mouse_pressed_index: Mutex::new(None),
            }),
            max_visible: 10,
            theme: SettingsListTheme::default(),
            search_input: None,
        }
    }

    /// Create with theme.
    pub fn with_theme(settings: Vec<SettingItem>, theme: SettingsListTheme) -> Self {
        let mut list = Self::new(settings);
        list.theme = theme;
        list
    }

    /// Enable the search field. Typing filters the rows by label.
    pub fn with_search(mut self) -> Self {
        let input = Arc::new(Input::new());
        let state = self.state.clone();
        input.on_change(Arc::new(move |value: &str| {
            state.set_filter(value);
        }));
        self.search_input = Some(input);
        self
    }

    /// The search field, when the list has one.
    pub fn search_input(&self) -> Option<&Arc<Input>> {
        self.search_input.as_ref()
    }

    /// Set filter.
    pub fn set_filter(&self, filter: &str) {
        if let Ok(mut f) = self.state.filter.lock() {
            *f = filter.to_string();
        }
        self.state.refilter();
        if let Ok(mut idx) = self.state.selected_index.lock() {
            *idx = 0;
        }
        if let Ok(mut start) = self.state.window_start.lock() {
            *start = 0;
        }
    }

    /// Every row, in menu order.
    pub fn items(&self) -> Vec<SettingItem> {
        self.state
            .settings
            .lock()
            .map(|items| items.clone())
            .unwrap_or_default()
    }

    /// The rows the current filter keeps.
    pub fn visible_items(&self) -> Vec<SettingItem> {
        self.state.display_items()
    }

    /// Get selected item.
    pub fn get_selected(&self) -> Option<SettingItem> {
        let idx = *self.state.selected_index.lock().ok()?;
        let filtered = self.state.filtered.lock().ok()?;
        filtered.get(idx).cloned()
    }

    /// Set selected index.
    pub fn set_selected(&self, index: usize) {
        if let Ok(mut idx) = self.state.selected_index.lock() {
            if let Ok(filtered) = self.state.filtered.lock() {
                *idx = index.min(filtered.len().saturating_sub(1));
            }
        }
    }

    /// Move selection up.
    pub fn move_up(&self) {
        if let Ok(mut idx) = self.state.selected_index.lock() {
            let len = self.state.display_items().len();
            if len > 0 {
                if *idx == 0 {
                    *idx = len - 1;
                } else {
                    *idx -= 1;
                }
            }
        }
        self.scroll_to_selection();
    }

    /// Move selection down.
    pub fn move_down(&self) {
        if let Ok(mut idx) = self.state.selected_index.lock() {
            let len = self.state.display_items().len();
            if len > 0 {
                if *idx >= len - 1 {
                    *idx = 0;
                } else {
                    *idx += 1;
                }
            }
        }
        self.scroll_to_selection();
    }

    /// Toggle boolean setting.
    pub fn toggle(&self) {
        if let Some(item) = self.get_selected() {
            if item.setting_type == SettingType::Boolean {
                let new_value = if item.value == "true" { "false" } else { "true" };
                self.update_value(&item.key, new_value);
                if let Ok(cb) = self.state.on_change.lock() {
                    if let Some(callback) = cb.as_ref() {
                        callback(&item.key, new_value);
                    }
                }
            }
        }
    }

    /// Update a setting value.
    pub fn update_value(&self, key: &str, value: &str) {
        self.state.set_item_value(key, value);
        if let Ok(mut idx) = self.state.selected_index.lock() {
            let len = self.state.display_items().len();
            *idx = (*idx).min(len.saturating_sub(1));
        }
    }

    /// Set change callback.
    pub fn on_change(&self, callback: Arc<dyn Fn(&str, &str) + Send + Sync>) {
        if let Ok(mut cb) = self.state.on_change.lock() {
            *cb = Some(callback);
        }
    }

    /// Set select callback.
    pub fn on_select(&self, callback: Arc<dyn Fn(&SettingItem) + Send + Sync>) {
        if let Ok(mut cb) = self.state.on_select.lock() {
            *cb = Some(callback);
        }
    }

    /// Set cancel callback (Esc). Upstream's `SettingsList.onCancel`.
    pub fn on_cancel(&self, callback: Arc<dyn Fn() + Send + Sync>) {
        if let Ok(mut cb) = self.state.on_cancel.lock() {
            *cb = Some(callback);
        }
    }

    /// Fire the cancel callback.
    pub fn cancel(&self) {
        if let Ok(cb) = self.state.on_cancel.lock() {
            if let Some(callback) = cb.as_ref() {
                callback();
            }
        }
    }

    /// Activate the selected row: open its submenu, or cycle to the next value.
    /// Mirrors upstream's `SettingsList.activateItem`.
    ///
    /// Returns the new value when a value was cycled.
    pub fn activate(&self) -> Option<(String, String)> {
        let display = self.state.display_items();
        let index = *self.state.selected_index.lock().ok()?;
        let item = display.get(index)?.clone();

        if item.has_submenu {
            if let Some(factory) = item.submenu.clone() {
                let state = self.state.clone();
                let key = item.key.clone();
                let done: SubmenuDone = Arc::new(move |value: Option<String>| {
                    if let Some(value) = value {
                        state.set_item_value(&key, &value);
                        if let Ok(cb) = state.on_change.lock() {
                            if let Some(callback) = cb.as_ref() {
                                callback(&key, &value);
                            }
                        }
                    }
                    state.close_submenu();
                });
                let view = factory(&item.value, &done);
                if let Ok(mut guard) = self.state.submenu.lock() {
                    *guard = Some(ActiveSubmenu {
                        view,
                        item_index: index,
                        key: item.key.clone(),
                    });
                }
            } else if let Ok(cb) = self.state.on_select.lock() {
                if let Some(callback) = cb.as_ref() {
                    callback(&item);
                }
            }
            return None;
        }

        if item.values.is_empty() {
            return None;
        }
        let current = item
            .values
            .iter()
            .position(|value| value == &item.value)
            .unwrap_or(item.values.len().saturating_sub(1));
        let next = item.values[(current + 1) % item.values.len()].clone();
        self.update_value(&item.key, &next);
        if let Ok(cb) = self.state.on_change.lock() {
            if let Some(callback) = cb.as_ref() {
                callback(&item.key, &next);
            }
        }
        Some((item.key, next))
    }

    /// Whether a submenu is open.
    pub fn has_open_submenu(&self) -> bool {
        self.state
            .submenu
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    /// The number of rendered rows above the first row: 2 when the search
    /// field is on (the search input and the blank line under it), 0 otherwise.
    pub fn row_offset(&self) -> usize {
        if self.search_input.is_some() {
            2
        } else {
            0
        }
    }

    /// The item index on the given rendered row, or `None` when the row holds
    /// no item.
    pub fn index_at_row(&self, row: usize) -> Option<usize> {
        let len = self.state.display_items().len();
        let (start, end) = self.visible_range(len);
        let index = start.checked_add(row)?.checked_sub(self.row_offset())?;
        if index < start || index >= end {
            None
        } else {
            Some(index)
        }
    }

    /// Move the selection without scrolling the window. A hover must not move
    /// the list out from under the pointer; the window follows on the next
    /// keyboard move. Returns whether the selection changed.
    pub fn select(&self, index: usize) -> bool {
        let len = self.state.display_items().len();
        if index >= len {
            return false;
        }
        let Ok(mut selected) = self.state.selected_index.lock() else {
            return false;
        };
        if *selected == index {
            return false;
        }
        *selected = index;
        true
    }

    /// Route a key: Up/Down navigate, Enter or Space activates, Esc cancels.
    /// Mirrors upstream's `SettingsList.handleInput`.
    pub fn handle_key(&self, key: KeyEvent) {
        let handler = self
            .state
            .submenu
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|active| active.view.handle_key.clone()));
        if let Some(handler) = handler {
            handler(key);
            return;
        }
        match key.code {
            KeyCode::Up => self.move_up(),
            KeyCode::Down => self.move_down(),
            KeyCode::Enter => {
                self.activate();
            }
            KeyCode::Char(' ') => {
                let search_is_empty = self
                    .search_input
                    .as_ref()
                    .map(|input| input.get_value().is_empty())
                    .unwrap_or(true);
                if search_is_empty {
                    self.activate();
                } else if let Some(input) = &self.search_input {
                    input.handle_key(key);
                }
            }
            KeyCode::Esc => self.cancel(),
            _ => {
                if let Some(input) = &self.search_input {
                    input.handle_key(key);
                }
            }
        }
    }

    /// The current value of `key`, if the row exists.
    pub fn value_of(&self, key: &str) -> Option<String> {
        let settings = self.state.settings.lock().ok()?;
        settings
            .iter()
            .find(|item| item.key == key)
            .map(|item| item.value.clone())
    }

    /// Replace every row (used to rebuild after an external settings change
    /// without reopening the selector).
    pub fn set_items(&self, settings: Vec<SettingItem>) {
        if let Ok(mut guard) = self.state.settings.lock() {
            *guard = settings;
        }
        self.state.refilter();
    }

    /// Confirm selection.
    pub fn confirm(&self) {
        if let Some(item) = self.get_selected() {
            if let Ok(cb) = self.state.on_select.lock() {
                if let Some(callback) = cb.as_ref() {
                    callback(&item);
                }
            }
        }
    }

    fn scroll_to_selection(&self) {
        let len = self.state.display_items().len();
        let selected = self.state.selected_index.lock().map(|guard| *guard).unwrap_or(0);
        if let Ok(mut start) = self.state.window_start.lock() {
            *start = selected
                .saturating_sub(self.max_visible / 2)
                .min(len.saturating_sub(self.max_visible));
        }
    }

    fn visible_range(&self, len: usize) -> (usize, usize) {
        let start = self
            .state
            .window_start
            .lock()
            .map(|start| *start)
            .unwrap_or(0)
            .min(len.saturating_sub(self.max_visible));
        (start, (start + self.max_visible).min(len))
    }

    fn add_hint_line(&self, lines: &mut Vec<String>, width: usize) {
        lines.push(String::new());
        let hint = if self.search_input.is_some() {
            "  Type to search · Enter/Space to change · Esc to cancel"
        } else {
            "  Enter/Space to change · Esc to cancel"
        };
        lines.push(truncate_to_width(&(self.theme.hint)(hint), width, ""));
    }
}

impl Component for SettingsList {
    fn render(&self, width: usize) -> Vec<String> {
        let component = self
            .state
            .submenu
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|active| active.view.component.clone()));
        if let Some(component) = component {
            return component.render(width);
        }

        let mut lines: Vec<String> = Vec::new();

        if let Some(input) = &self.search_input {
            lines.extend(input.render(width));
            lines.push(String::new());
        }

        let items = self.state
            .settings
            .lock()
            .map(|items| items.clone())
            .unwrap_or_default();
        if items.is_empty() {
            lines.push((self.theme.hint)("  No settings available"));
            self.add_hint_line(&mut lines, width);
            return lines;
        }

        let display = self.state.display_items();
        if display.is_empty() {
            lines.push(truncate_to_width(
                &(self.theme.hint)("  No matching settings"),
                width,
                "",
            ));
            self.add_hint_line(&mut lines, width);
            return lines;
        }

        let selected = self.state.selected_index.lock().map(|guard| *guard).unwrap_or(0);
        let (start, end) = self.visible_range(display.len());
        let max_label_width = items
            .iter()
            .map(|item| visible_width(&item.label))
            .max()
            .unwrap_or(0)
            .min(36);

        for (index, item) in display.iter().enumerate().take(end).skip(start) {
            let is_selected = index == selected;
            let prefix = if is_selected {
                (self.theme.cursor)("→ ")
            } else {
                "  ".to_string()
            };
            let label_padded = format!(
                "{}{}",
                item.label,
                " ".repeat(max_label_width.saturating_sub(visible_width(&item.label)))
            );
            let label_text = (self.theme.label)(&label_padded, is_selected);
            let separator = "  ";
            let used = visible_width(&prefix) + max_label_width + visible_width(separator);
            let value_max_width = width.saturating_sub(used + 2);
            let value_text = (self.theme.value)(
                &truncate_to_width(&item.value, value_max_width, ""),
                is_selected,
            );
            lines.push(truncate_to_width(
                &format!("{prefix}{label_text}{separator}{value_text}"),
                width,
                "",
            ));
        }

        if start > 0 || end < display.len() {
            let info = format!("  ({}/{})", selected + 1, display.len());
            lines.push(truncate_to_width(
                &(self.theme.hint)(&info),
                width.saturating_sub(2),
                "",
            ));
        }

        if let Some(item) = display.get(selected) {
            if let Some(description) = &item.description {
                lines.push(String::new());
                for line in wrap_text_with_ansi(description, width.saturating_sub(4)) {
                    lines.push((self.theme.description)(&format!("  {line}")));
                }
            }
        }

        self.add_hint_line(&mut lines, width);

        lines
    }

    fn invalidate(&self) {
        let component = self
            .state
            .submenu
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|active| active.view.component.clone()));
        if let Some(component) = component {
            component.invalidate();
        }
        if let Some(input) = &self.search_input {
            input.invalidate();
        }
    }

    fn handle_mouse(&self, event: &MouseEvent) -> Option<MouseEventResult> {
        if let Ok(guard) = self.state.submenu.lock() {
            if let Some(active) = guard.as_ref() {
                let result = active.view.component.handle_mouse(event)?;
                return Some(MouseEventResult {
                    focus: true,
                    ..result
                });
            }
        }

        if self.search_input.is_some() {
            if event.y == 0 {
                let input = self.search_input.as_ref()?;
                let result = input.handle_mouse(event)?;
                return Some(MouseEventResult {
                    focus: true,
                    ..result
                });
            }
            if event.y == 1 {
                return None;
            }
        }

        let display_len = self.state.display_items().len();
        if display_len == 0 {
            return None;
        }

        if event.kind == MouseEventKind::Wheel {
            let delta = event.wheel_delta.unwrap_or(0).signum();
            let previous = self.state.selected_index.lock().map(|g| *g).unwrap_or(0);
            let next = (previous as i64 + delta as i64).clamp(0, display_len as i64 - 1) as usize;
            if next != previous {
                if let Ok(mut guard) = self.state.selected_index.lock() {
                    *guard = next;
                }
                self.scroll_to_selection();
            }
            return Some(MouseEventResult {
                handled: true,
                render: Some(next != previous),
                ..Default::default()
            });
        }

        if apply_hover(event, self) {
            return Some(MouseEventResult {
                handled: true,
                render: Some(true),
                ..Default::default()
            });
        }

        if event.button != MouseButton::Left
            || (event.kind != MouseEventKind::Press && event.kind != MouseEventKind::Click)
        {
            return None;
        }
        let Some(item_index) = self.index_at_row(event.y) else {
            return None;
        };
        if event.kind == MouseEventKind::Press {
            if let Ok(mut guard) = self.state.mouse_pressed_index.lock() {
                *guard = Some(item_index);
            }
            self.select(item_index);
            return Some(MouseEventResult {
                handled: true,
                focus: true,
                ..Default::default()
            });
        }
        let clicked = self
            .state
            .mouse_pressed_index
            .lock()
            .ok()
            .and_then(|guard| *guard)
            .unwrap_or(item_index);
        if let Ok(mut guard) = self.state.mouse_pressed_index.lock() {
            *guard = None;
        }
        self.select(clicked);
        self.activate();
        Some(MouseEventResult::handled())
    }

    fn as_focusable(&self) -> Option<&dyn Focusable> {
        if self.search_input.is_some() {
            Some(self)
        } else {
            None
        }
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

impl HoverableList for SettingsList {
    fn index_at_row(&self, row: usize) -> Option<usize> {
        SettingsList::index_at_row(self, row)
    }

    fn select(&self, index: usize) -> bool {
        SettingsList::select(self, index)
    }
}

impl Focusable for SettingsList {
    fn set_focused(&self, focused: bool) {
        if let Some(input) = &self.search_input {
            input.set_focused(focused);
        }
    }

    fn is_focused(&self) -> bool {
        self.search_input
            .as_ref()
            .map(|input| input.is_focused())
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyModifiers;

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    fn three_rows() -> SettingsList {
        SettingsList::new(vec![
            SettingItem::new("a", "Alpha", "1"),
            SettingItem::new("b", "Beta", "2"),
            SettingItem::new("c", "Gamma", "3"),
        ])
    }

    #[test]
    fn hovering_a_row_moves_the_selection() {
        let list = three_rows();
        let event = MouseEvent::new(MouseEventKind::Move, MouseButton::None, 0, 2);
        let result = list.handle_mouse(&event).expect("handled");
        assert!(result.handled);
        assert_eq!(list.get_selected().map(|item| item.key), Some("c".to_string()));
    }

    #[test]
    fn a_drag_does_not_move_the_selection() {
        let list = three_rows();
        let event = MouseEvent::new(MouseEventKind::Drag, MouseButton::Left, 0, 2);
        assert!(list.handle_mouse(&event).is_none());
        assert_eq!(list.get_selected().map(|item| item.key), Some("a".to_string()));
    }

    #[test]
    fn a_click_on_a_row_activates_it() {
        let list = three_rows();
        let press = MouseEvent::new(MouseEventKind::Press, MouseButton::Left, 0, 1);
        let result = list.handle_mouse(&press).expect("handled");
        assert!(result.focus);
        assert_eq!(list.get_selected().map(|item| item.key), Some("b".to_string()));
        let click = MouseEvent::new(MouseEventKind::Click, MouseButton::Left, 0, 1);
        assert!(list.handle_mouse(&click).is_some());
    }

    #[test]
    fn test_settings_list_new() {
        let settings = vec![
            SettingItem::new("theme", "Theme", "dark"),
            SettingItem::new("font", "Font Size", "14"),
        ];
        let list = SettingsList::new(settings);

        let lines = list.render(60);
        assert!(!lines.is_empty());
    }

    #[test]
    fn test_settings_navigation() {
        let settings = vec![
            SettingItem::new("a", "A", "1"),
            SettingItem::new("b", "B", "2"),
        ];
        let list = SettingsList::new(settings);

        assert_eq!(list.get_selected().unwrap().key, "a");
        list.move_down();
        assert_eq!(list.get_selected().unwrap().key, "b");
        list.move_down();
        assert_eq!(list.get_selected().unwrap().key, "a");
    }

    #[test]
    fn test_settings_filter() {
        let settings = vec![
            SettingItem::new("theme", "Theme", "dark"),
            SettingItem::new("font", "Font Size", "14"),
        ];
        let list = SettingsList::new(settings);

        list.set_filter("theme");
        let selected = list.get_selected();
        assert!(selected.is_some());
        assert_eq!(selected.unwrap().key, "theme");
    }

    #[test]
    fn the_filter_matches_the_label_not_the_key() {
        let settings = vec![
            SettingItem::new("hide-thinking", "Hide thinking", "true"),
            SettingItem::new("three-d-empty-session", "3D empty session", "false"),
        ];
        let list = SettingsList::new(settings);
        list.set_filter("3D");
        let visible = list.visible_items();
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].key, "three-d-empty-session");
    }

    #[test]
    fn activate_cycles_values_and_fires_change() {
        let settings = vec![SettingItem::new("hide-thinking", "Hide thinking", "false")
            .with_values(&["true", "false"])];
        let list = SettingsList::new(settings);

        let changes: Arc<Mutex<Vec<(String, String)>>> = Arc::new(Mutex::new(Vec::new()));
        let changes_cb = changes.clone();
        list.on_change(Arc::new(move |key, value| {
            changes_cb
                .lock()
                .unwrap()
                .push((key.to_string(), value.to_string()));
        }));

        assert_eq!(
            list.activate(),
            Some(("hide-thinking".to_string(), "true".to_string()))
        );
        assert_eq!(list.value_of("hide-thinking").as_deref(), Some("true"));
        list.activate();
        assert_eq!(list.value_of("hide-thinking").as_deref(), Some("false"));
        assert_eq!(changes.lock().unwrap().len(), 2);
    }

    #[test]
    fn activating_a_value_preserves_the_cursor() {
        let settings = vec![
            SettingItem::new("a", "Auto-compact", "true").with_values(&["true", "false"]),
            SettingItem::new("b", "Steering mode", "all").with_values(&["all", "one-at-a-time"]),
            SettingItem::new("c", "Quiet startup", "false").with_values(&["true", "false"]),
        ];
        let list = SettingsList::new(settings);
        list.move_down();
        assert_eq!(list.get_selected().unwrap().key, "b");
        list.activate();
        assert_eq!(list.get_selected().unwrap().key, "b");
        assert_eq!(
            list.get_selected().unwrap().value,
            "one-at-a-time",
            "value should have cycled in place"
        );
    }

    #[test]
    fn submenu_row_calls_select_instead_of_cycling() {
        let settings = vec![SettingItem::new("theme", "Theme", "dark").with_submenu()];
        let list = SettingsList::new(settings);
        let opened: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let opened_cb = opened.clone();
        list.on_select(Arc::new(move |item| {
            opened_cb.lock().unwrap().push(item.key.clone());
        }));
        assert_eq!(list.activate(), None);
        assert_eq!(opened.lock().unwrap().as_slice(), ["theme"]);
        assert_eq!(list.value_of("theme").as_deref(), Some("dark"));
    }

    #[test]
    fn a_submenu_owns_the_list_until_it_is_done() {
        let submenu = Arc::new(crate::select_list::SelectList::new(
            vec![crate::select_list::SelectItem::new("dark", "Dark")],
            10,
        ));
        let submenu_for_keys = submenu.clone();
        let settings = vec![SettingItem::new("theme", "Theme", "dark").with_submenu_factory(
            Arc::new(move |_current: &str, done: &SubmenuDone| {
                let list = submenu_for_keys.clone();
                let done = done.clone();
                list.on_select(Arc::new(move |_item| done(Some("light".to_string()))));
                SubmenuView::new(
                    list.clone(),
                    Arc::new(move |key: KeyEvent| list.handle_key(key)),
                )
            }),
        )];
        let list = SettingsList::new(settings);
        list.activate();
        assert!(list.has_open_submenu());

        let lines = list.render(40);
        assert!(
            lines.iter().any(|line| line.contains("Dark")),
            "the submenu renders instead of the rows: {lines:?}"
        );

        list.handle_key(key(KeyCode::Enter));
        assert!(!list.has_open_submenu());
        assert_eq!(list.value_of("theme").as_deref(), Some("light"));
    }

    #[test]
    fn handle_key_routes_navigation_activation_and_cancel() {
        let settings = vec![
            SettingItem::new("a", "Alpha", "1").with_values(&["1", "2"]),
            SettingItem::new("b", "Beta", "x").with_values(&["x", "y"]),
        ];
        let list = SettingsList::new(settings);
        let cancelled = Arc::new(Mutex::new(false));
        let cancelled_cb = cancelled.clone();
        list.on_cancel(Arc::new(move || {
            *cancelled_cb.lock().unwrap() = true;
        }));

        list.handle_key(key(KeyCode::Down));
        assert_eq!(list.get_selected().unwrap().key, "b");
        list.handle_key(key(KeyCode::Char(' ')));
        assert_eq!(list.value_of("b").as_deref(), Some("y"));
        list.handle_key(key(KeyCode::Esc));
        assert!(*cancelled.lock().unwrap());
    }

    #[test]
    fn the_search_field_filters_the_rows() {
        let settings = vec![
            SettingItem::new("a", "Auto-compact", "true"),
            SettingItem::new("b", "3D empty session", "false"),
        ];
        let list = SettingsList::new(settings).with_search();
        list.handle_key(key(KeyCode::Char('3')));
        assert_eq!(list.visible_items().len(), 1);
        assert_eq!(list.visible_items()[0].key, "b");
    }

    #[test]
    fn the_render_shows_the_label_the_value_and_the_hint() {
        let settings = vec![SettingItem::new("autocompact", "Auto-compact", "true")
            .with_description("Automatically compact context when it gets too large")
            .with_values(&["true", "false"])];
        let list = SettingsList::new(settings);
        let lines = list.render(80);
        let joined = lines.join("\n");
        assert!(joined.contains("Auto-compact"), "{joined}");
        assert!(joined.contains("true"), "{joined}");
        assert!(joined.contains("Automatically compact context"), "{joined}");
        assert!(
            joined.contains("Enter/Space to change"),
            "{joined}"
        );
    }
}
