//! SelectList component - a selectable list with filtering.
//!
//! Provides a list of items that can be navigated and selected.

use std::any::Any;
use std::sync::{Arc, Mutex};

use super::component::{Component, MouseButton, MouseEvent, MouseEventKind, MouseEventResult};
use super::fuzzy::fuzzy_filter;
use super::list_hover::{apply_hover, HoverableList};
use crate::utils::{truncate_to_width, visible_width};

const DEFAULT_PRIMARY_COLUMN_WIDTH: usize = 32;
const PRIMARY_COLUMN_GAP: usize = 2;
const MIN_DESCRIPTION_WIDTH: usize = 10;

/// A select list item.
#[derive(Debug, Clone)]
pub struct SelectItem {
    /// The value (returned on selection).
    pub value: String,
    /// Display label.
    pub label: String,
    /// Optional description.
    pub description: Option<String>,
    /// Optional extra text used ONLY by fuzzy filtering. Lets a searchable
    /// selector match on the display name, provider, or a qualified id while
    /// `value` stays the stable selection key (upstream's
    /// `getModelSelectorSearchText`). Falls back to `value` when unset.
    pub search_text: Option<String>,
}

impl SelectItem {
    /// Create a new select item.
    pub fn new(value: &str, label: &str) -> Self {
        Self {
            value: value.to_string(),
            label: label.to_string(),
            description: None,
            search_text: None,
        }
    }

    /// Add a description.
    pub fn with_description(mut self, description: &str) -> Self {
        self.description = Some(description.to_string());
        self
    }

    /// Add the text fuzzy filtering should match against (instead of `value`).
    pub fn with_search_text(mut self, search_text: &str) -> Self {
        self.search_text = Some(search_text.to_string());
        self
    }

    /// The string fuzzy filtering matches against.
    pub fn search_key(&self) -> &str {
        self.search_text.as_deref().unwrap_or(&self.value)
    }

    /// Get the display value (label or value).
    pub fn display_value(&self) -> &str {
        if self.label.is_empty() {
            &self.value
        } else {
            &self.label
        }
    }
}

/// Theme for select list.
#[derive(Debug, Clone)]
pub struct SelectListTheme {
    /// Style for selected item prefix.
    pub selected_prefix: fn(&str) -> String,
    /// Style for selected item text.
    pub selected_text: fn(&str) -> String,
    /// Style for description text.
    pub description: fn(&str) -> String,
    /// Style for scroll info.
    pub scroll_info: fn(&str) -> String,
    /// Style for no match message.
    pub no_match: fn(&str) -> String,
}

impl Default for SelectListTheme {
    fn default() -> Self {
        Self {
            selected_prefix: |s| crate::theme::theme().colors.accent.fg(s),
            selected_text: |s| crate::theme::theme().colors.accent.fg(s),
            description: |s| crate::theme::theme().colors.muted.fg(s),
            scroll_info: |s| crate::theme::theme().colors.muted.fg(s),
            no_match: |s| crate::theme::theme().colors.muted.fg(s),
        }
    }
}

/// Layout options for select list.
#[derive(Clone)]
pub struct SelectListLayoutOptions {
    /// Minimum width for the primary column.
    pub min_primary_column_width: Option<usize>,
    /// Maximum width for the primary column.
    pub max_primary_column_width: Option<usize>,
    /// Custom truncation function.
    pub truncate_primary: Option<Arc<dyn Fn(&str, usize, usize) -> String + Send + Sync>>,
}

impl Default for SelectListLayoutOptions {
    fn default() -> Self {
        Self {
            min_primary_column_width: None,
            max_primary_column_width: None,
            truncate_primary: None,
        }
    }
}

impl SelectListLayoutOptions {
    /// The width of the primary column for a list showing these labels.
    ///
    /// The original's rule (`packages/tui/src/components/select-list.ts:288-307`):
    /// the widest label plus the gap, clamped to the layout's bounds. The
    /// slash-command list uses `{ min: 12, max: 32 }`
    /// (`packages/tui/src/components/editor.ts:286-288`).
    pub fn column_width(&self, labels: &[&str]) -> usize {
        let (min_width, max_width) = primary_column_bounds(self);
        let widest = labels
            .iter()
            .map(|label| visible_width(label) + PRIMARY_COLUMN_GAP)
            .max()
            .unwrap_or(DEFAULT_PRIMARY_COLUMN_WIDTH);
        widest.clamp(min_width, max_width)
    }
}

/// The primary column's bounds: the layout's min and max, in order.
fn primary_column_bounds(layout: &SelectListLayoutOptions) -> (usize, usize) {
    let raw_min = layout
        .min_primary_column_width
        .or(layout.max_primary_column_width)
        .unwrap_or(DEFAULT_PRIMARY_COLUMN_WIDTH);
    let raw_max = layout
        .max_primary_column_width
        .or(layout.min_primary_column_width)
        .unwrap_or(DEFAULT_PRIMARY_COLUMN_WIDTH);

    let min = raw_min.min(raw_max).max(1);
    let max = raw_min.max(raw_max).max(1);
    (min, max)
}

/// SelectList component.
pub struct SelectList {
    items: Mutex<Vec<SelectItem>>,
    filtered_items: Mutex<Vec<SelectItem>>,
    selected_index: Mutex<usize>,
    /// Top of the visible window. Tracked separately from the selection so a
    /// hover can move the selection without scrolling the list out from under
    /// the pointer.
    window_start: Mutex<usize>,
    /// Item the mouse pressed on, used when the click is delivered later.
    mouse_pressed_index: Mutex<Option<usize>>,
    /// Values toggled in multi-select mode. Values (rather than indexes) are
    /// retained so filtering does not lose the user's selections.
    selected_values: Mutex<std::collections::HashSet<String>>,
    multi_select: bool,
    max_visible: usize,
    theme: SelectListTheme,
    layout: SelectListLayoutOptions,
    on_select: Mutex<Option<Arc<dyn Fn(&SelectItem) + Send + Sync>>>,
    on_multi_select: Mutex<Option<Arc<dyn Fn(&[SelectItem]) + Send + Sync>>>,
    on_cancel: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
    on_selection_change: Mutex<Option<Arc<dyn Fn(&SelectItem) + Send + Sync>>>,
}

impl SelectList {
    /// Create a new select list.
    pub fn new(items: Vec<SelectItem>, max_visible: usize) -> Self {
        Self {
            filtered_items: Mutex::new(items.clone()),
            items: Mutex::new(items),
            selected_index: Mutex::new(0),
            window_start: Mutex::new(0),
            mouse_pressed_index: Mutex::new(None),
            selected_values: Mutex::new(std::collections::HashSet::new()),
            multi_select: false,
            max_visible,
            theme: SelectListTheme::default(),
            layout: SelectListLayoutOptions::default(),
            on_select: Mutex::new(None),
            on_multi_select: Mutex::new(None),
            on_cancel: Mutex::new(None),
            on_selection_change: Mutex::new(None),
        }
    }

    /// Create a select list with a theme.
    pub fn with_theme(items: Vec<SelectItem>, max_visible: usize, theme: SelectListTheme) -> Self {
        Self {
            filtered_items: Mutex::new(items.clone()),
            items: Mutex::new(items),
            selected_index: Mutex::new(0),
            window_start: Mutex::new(0),
            mouse_pressed_index: Mutex::new(None),
            selected_values: Mutex::new(std::collections::HashSet::new()),
            multi_select: false,
            max_visible,
            theme,
            layout: SelectListLayoutOptions::default(),
            on_select: Mutex::new(None),
            on_multi_select: Mutex::new(None),
            on_cancel: Mutex::new(None),
            on_selection_change: Mutex::new(None),
        }
    }

    /// Override the primary/description column layout. The session picker uses
    /// this to widen the primary column so a preview is not clipped to the
    /// 32-column default.
    pub fn set_layout(&mut self, layout: SelectListLayoutOptions) {
        self.layout = layout;
    }

    /// Create a selector that permits selecting several options with Space
    /// before submitting with Enter. Existing single-select selectors should
    /// continue using [`Self::new`].
    pub fn new_multi(items: Vec<SelectItem>, max_visible: usize) -> Self {
        let mut list = Self::new(items, max_visible);
        list.multi_select = true;
        list
    }

    /// Whether this list is in multi-select mode.
    pub fn is_multi_select(&self) -> bool {
        self.multi_select
    }

    /// Set a callback invoked with all toggled options when Enter is pressed.
    pub fn on_multi_select(&self, callback: Arc<dyn Fn(&[SelectItem]) + Send + Sync>) {
        if let Ok(mut cb) = self.on_multi_select.lock() {
            *cb = Some(callback);
        }
    }

    /// Return the currently toggled options, preserving the source order.
    pub fn get_selected_items(&self) -> Vec<SelectItem> {
        let selected = self.selected_values.lock().ok();
        let items = self.items.lock().ok();
        match (selected, items) {
            (Some(selected), Some(items)) => items
                .iter()
                .filter(|item| selected.contains(&item.value))
                .cloned()
                .collect(),
            _ => Vec::new(),
        }
    }

    /// Toggle the currently highlighted option. No-op for a regular selector.
    pub fn toggle_selected(&self) {
        if !self.multi_select {
            return;
        }
        let Some(item) = self.get_selected_item() else {
            return;
        };
        if let Ok(mut selected) = self.selected_values.lock() {
            if !selected.insert(item.value.clone()) {
                selected.remove(&item.value);
            }
        }
    }

    /// Whether an item is currently toggled in multi-select mode.
    fn is_selected_value(&self, value: &str) -> bool {
        self.selected_values
            .lock()
            .map(|values| values.contains(value))
            .unwrap_or(false)
    }

    /// Replace the list's items. The caller re-applies the filter when the
    /// list is searchable, so the visible rows follow the new items.
    pub fn set_items(&self, items: Vec<SelectItem>) {
        if let Ok(mut stored) = self.items.lock() {
            *stored = items.clone();
        }
        if let Ok(mut filtered) = self.filtered_items.lock() {
            *filtered = items;
        }
        if let Ok(mut index) = self.selected_index.lock() {
            *index = 0;
        }
        if let Ok(mut start) = self.window_start.lock() {
            *start = 0;
        }
    }

    /// Set the filter text.
    pub fn set_filter(&self, filter: &str) {
        if let Ok(items) = self.items.lock() {
            let filtered = fuzzy_filter(&items, filter, |item| item.search_key());
            if let Ok(mut filtered_items) = self.filtered_items.lock() {
                *filtered_items = filtered;
            }
        }
        // Reset selection when filter changes
        if let Ok(mut index) = self.selected_index.lock() {
            *index = 0;
        }
        if let Ok(mut start) = self.window_start.lock() {
            *start = 0;
        }
    }

    /// The index of the highlighted row in the filtered list.
    pub fn selected_index(&self) -> usize {
        self.selected_index.lock().map(|index| *index).unwrap_or(0)
    }

    /// Set the selected index.
    pub fn set_selected_index(&self, index: usize) {
        if let Ok(mut current) = self.selected_index.lock() {
            if let Ok(filtered) = self.filtered_items.lock() {
                *current = index.min(filtered.len().saturating_sub(1));
            }
        }
        self.scroll_to_selection();
    }

    /// Get the selected item.
    pub fn get_selected_item(&self) -> Option<SelectItem> {
        let index = self.selected_index.lock().ok()?;
        let filtered = self.filtered_items.lock().ok()?;
        filtered.get(*index).cloned()
    }

    /// Set callback for when an item is selected.
    pub fn on_select(&self, callback: Arc<dyn Fn(&SelectItem) + Send + Sync>) {
        if let Ok(mut cb) = self.on_select.lock() {
            *cb = Some(callback);
        }
    }

    /// Set callback for when cancelled.
    pub fn on_cancel(&self, callback: Arc<dyn Fn() + Send + Sync>) {
        if let Ok(mut cb) = self.on_cancel.lock() {
            *cb = Some(callback);
        }
    }

    /// Set callback for when selection changes.
    pub fn on_selection_change(&self, callback: Arc<dyn Fn(&SelectItem) + Send + Sync>) {
        if let Ok(mut cb) = self.on_selection_change.lock() {
            *cb = Some(callback);
        }
    }

    /// Handle key input.
    pub fn handle_key(&self, key: crossterm::event::KeyEvent) {
        use crossterm::event::{KeyCode, KeyModifiers};

        match key.code {
            KeyCode::Up => {
                self.move_up();
            }
            KeyCode::Down => {
                self.move_down();
            }
            KeyCode::Enter => {
                self.confirm();
            }
            KeyCode::Char(' ') if self.multi_select => {
                self.toggle_selected();
            }
            KeyCode::Esc => {
                self.cancel();
            }
            KeyCode::Char('k') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.move_up();
            }
            KeyCode::Char('j') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.move_down();
            }
            KeyCode::Char('p') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.move_up();
            }
            KeyCode::Char('n') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.move_down();
            }
            KeyCode::PageUp => {
                // Page up in the list (tui.select.pageUp).
                for _ in 0..self.max_visible.saturating_sub(1) {
                    self.move_up();
                }
            }
            KeyCode::PageDown => {
                // Page down in the list (tui.select.pageDown).
                for _ in 0..self.max_visible.saturating_sub(1) {
                    self.move_down();
                }
            }
            _ => {}
        }
    }

    /// Move selection up.
    fn move_up(&self) {
        if let Ok(mut index) = self.selected_index.lock() {
            if let Ok(filtered) = self.filtered_items.lock() {
                if filtered.is_empty() {
                    return;
                }
                if *index == 0 {
                    *index = filtered.len() - 1;
                } else {
                    *index -= 1;
                }
                if let Some(item) = filtered.get(*index) {
                    self.notify_selection_change(item);
                }
            }
        }
        self.scroll_to_selection();
    }

    /// Move selection down.
    fn move_down(&self) {
        if let Ok(mut index) = self.selected_index.lock() {
            if let Ok(filtered) = self.filtered_items.lock() {
                if filtered.is_empty() {
                    return;
                }
                if *index >= filtered.len() - 1 {
                    *index = 0;
                } else {
                    *index += 1;
                }
                if let Some(item) = filtered.get(*index) {
                    self.notify_selection_change(item);
                }
            }
        }
        self.scroll_to_selection();
    }

    /// Visible range of the list: the first and one-past-last item index.
    pub fn visible_range(&self) -> (usize, usize) {
        let len = self
            .filtered_items
            .lock()
            .map(|filtered| filtered.len())
            .unwrap_or(0);
        let start = self
            .window_start
            .lock()
            .map(|start| *start)
            .unwrap_or(0)
            .min(len.saturating_sub(self.max_visible));
        (start, (start + self.max_visible).min(len))
    }

    /// Center the visible window on the selection.
    ///
    /// Keyboard navigation calls this so the selection stays in view; a hover
    /// does not, so the row under the pointer stays under the pointer.
    fn scroll_to_selection(&self) {
        let len = self
            .filtered_items
            .lock()
            .map(|filtered| filtered.len())
            .unwrap_or(0);
        if len <= self.max_visible {
            if let Ok(mut start) = self.window_start.lock() {
                *start = 0;
            }
            return;
        }
        let selected = self
            .selected_index
            .lock()
            .map(|index| *index)
            .unwrap_or(0);
        let start = selected
            .saturating_sub(self.max_visible / 2)
            .min(len - self.max_visible);
        if let Ok(mut window) = self.window_start.lock() {
            *window = start;
        }
    }

    /// Confirm selection.
    fn confirm(&self) {
        if self.multi_select {
            let selected = self.get_selected_items();
            // A bare Enter is still useful when the user did not press Space:
            // treat the highlighted row as the sole answer, matching native
            // selector ergonomics while retaining explicit multi-toggle UX.
            let selected = if selected.is_empty() {
                self.get_selected_item().into_iter().collect::<Vec<_>>()
            } else {
                selected
            };
            if let Ok(cb) = self.on_multi_select.lock() {
                if let Some(callback) = cb.as_ref() {
                    callback(&selected);
                }
            }
            return;
        }
        if let Some(item) = self.get_selected_item() {
            if let Ok(cb) = self.on_select.lock() {
                if let Some(callback) = cb.as_ref() {
                    callback(&item);
                }
            }
        }
    }

    /// Cancel selection.
    fn cancel(&self) {
        if let Ok(cb) = self.on_cancel.lock() {
            if let Some(callback) = cb.as_ref() {
                callback();
            }
        }
    }

    /// Notify selection change.
    fn notify_selection_change(&self, item: &SelectItem) {
        if let Ok(cb) = self.on_selection_change.lock() {
            if let Some(callback) = cb.as_ref() {
                callback(item);
            }
        }
    }

    /// Notify the listener about the currently selected item.
    fn notify_selected_item(&self) {
        if let Some(item) = self.get_selected_item() {
            self.notify_selection_change(&item);
        }
    }

    /// Move the selection to an index without moving the visible window.
    fn select_index(&self, index: usize) -> bool {
        let Ok(mut selected) = self.selected_index.lock() else {
            return false;
        };
        let Ok(filtered) = self.filtered_items.lock() else {
            return false;
        };
        if filtered.is_empty() {
            return false;
        }
        let index = index.min(filtered.len() - 1);
        if *selected == index {
            return false;
        }
        *selected = index;
        true
    }

    /// Get primary column width.
    fn get_primary_column_width(&self, filtered: &[SelectItem]) -> usize {
        let labels: Vec<&str> = filtered.iter().map(|item| item.display_value()).collect();
        self.layout.column_width(&labels)
    }

    /// Get primary column bounds.
    fn get_primary_column_bounds(&self) -> (usize, usize) {
        primary_column_bounds(&self.layout)
    }

    /// Render an item.
    fn render_item(
        &self,
        item: &SelectItem,
        is_selected: bool,
        width: usize,
        primary_column_width: usize,
    ) -> String {
        let prefix = if self.multi_select {
            let marker = if self.is_selected_value(&item.value) {
                "x"
            } else {
                " "
            };
            if is_selected {
                format!("→ [{}] ", marker)
            } else {
                format!("  [{}] ", marker)
            }
        } else if is_selected {
            "→ ".to_string()
        } else {
            "  ".to_string()
        };
        let prefix_width = visible_width(&prefix);

        // Handle description
        if let Some(ref description) = item.description {
            if width > 40 {
                let effective_primary =
                    primary_column_width.min(width.saturating_sub(prefix_width + 4));
                let max_primary = effective_primary.saturating_sub(PRIMARY_COLUMN_GAP).max(1);

                let truncated_value =
                    self.truncate_primary(item, is_selected, max_primary, effective_primary);
                let value_width = visible_width(&truncated_value);
                let spacing = " ".repeat(effective_primary.saturating_sub(value_width).max(1));

                let desc_start = prefix_width + value_width + spacing.len();
                let remaining = width.saturating_sub(desc_start + 2);

                if remaining > MIN_DESCRIPTION_WIDTH {
                    let truncated_desc =
                        truncate_to_width(&normalize_single_line(description), remaining, "");
                    if is_selected {
                        return (self.theme.selected_text)(&format!(
                            "{}{}{}{}",
                            prefix, truncated_value, spacing, truncated_desc
                        ));
                    }
                    let desc_text =
                        (self.theme.description)(&format!("{}{}", spacing, truncated_desc));
                    return format!("{}{}{}", prefix, truncated_value, desc_text);
                }
            }
        }

        // No description or not enough space
        let max_width = width.saturating_sub(prefix_width + 2);
        let truncated = self.truncate_primary(item, is_selected, max_width, max_width);

        if is_selected {
            (self.theme.selected_text)(&format!("{}{}", prefix, truncated))
        } else {
            format!("{}{}", prefix, truncated)
        }
    }

    /// Truncate primary text.
    fn truncate_primary(
        &self,
        item: &SelectItem,
        _is_selected: bool,
        max_width: usize,
        column_width: usize,
    ) -> String {
        let display = item.display_value();

        if let Some(ref truncate_fn) = self.layout.truncate_primary {
            truncate_fn(display, max_width, column_width)
        } else {
            truncate_to_width(display, max_width, "")
        }
    }
}

impl Component for SelectList {
    fn render(&self, width: usize) -> Vec<String> {
        let filtered = if let Ok(filtered) = self.filtered_items.lock() {
            filtered.clone()
        } else {
            return Vec::new();
        };

        let mut lines = Vec::new();

        if filtered.is_empty() {
            lines.push((self.theme.no_match)("  No matching commands"));
            return lines;
        }

        let selected = self
            .selected_index
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let primary_column_width = self.get_primary_column_width(&filtered);

        // Calculate visible range with scrolling
        let (start_index, end_index) = self.visible_range();

        // Render visible items
        for i in start_index..end_index {
            if let Some(item) = filtered.get(i) {
                let is_selected = i == *selected;
                lines.push(self.render_item(item, is_selected, width, primary_column_width));
            }
        }

        // Add scroll indicator if needed
        if start_index > 0 || end_index < filtered.len() {
            let scroll_text = format!("  ({}/{})", *selected + 1, filtered.len());
            lines.push((self.theme.scroll_info)(&truncate_to_width(
                &scroll_text,
                width.saturating_sub(2),
                "",
            )));
        }

        lines
    }

    fn invalidate(&self) {
        // No cached state
    }

    fn handle_mouse(&self, event: &MouseEvent) -> Option<MouseEventResult> {
        let filtered_len = self
            .filtered_items
            .lock()
            .map(|filtered| filtered.len())
            .unwrap_or(0);
        if filtered_len == 0 {
            return None;
        }
        if event.kind == MouseEventKind::Wheel {
            let Some(delta) = event.wheel_delta else {
                return None;
            };
            if delta == 0 {
                return None;
            }
            let step = if delta < 0 { -1 } else { 1 };
            let previous = self
                .selected_index
                .lock()
                .map(|index| *index)
                .unwrap_or(0);
            let next = previous
                .saturating_add_signed(step)
                .min(filtered_len - 1);
            if let Ok(mut index) = self.selected_index.lock() {
                *index = next;
            }
            if next == previous {
                return Some(MouseEventResult {
                    handled: true,
                    render: Some(false),
                    ..Default::default()
                });
            }
            self.scroll_to_selection();
            self.notify_selected_item();
            return Some(MouseEventResult::handled());
        }
        if apply_hover(event, self) {
            self.notify_selected_item();
            return Some(MouseEventResult::handled());
        }
        if event.button != MouseButton::Left
            || (event.kind != MouseEventKind::Press && event.kind != MouseEventKind::Click)
        {
            return None;
        }
        let (start_index, end_index) = self.visible_range();
        let item_index = start_index + event.y;
        if item_index < start_index || item_index >= end_index {
            return None;
        }
        if event.kind == MouseEventKind::Press {
            if let Ok(mut pressed) = self.mouse_pressed_index.lock() {
                *pressed = Some(item_index);
            }
            let changed = self.select_index(item_index);
            if changed {
                self.notify_selected_item();
            }
            return Some(MouseEventResult {
                handled: true,
                focus: true,
                ..Default::default()
            });
        }
        let clicked_index = self
            .mouse_pressed_index
            .lock()
            .ok()
            .and_then(|pressed| *pressed)
            .unwrap_or(item_index);
        if let Ok(mut pressed) = self.mouse_pressed_index.lock() {
            *pressed = None;
        }
        let changed = self.select_index(clicked_index);
        if changed {
            self.notify_selected_item();
        }
        if let Ok(filtered) = self.filtered_items.lock() {
            if let Some(item) = filtered.get(clicked_index) {
                let item = item.clone();
                if let Ok(cb) = self.on_select.lock() {
                    if let Some(callback) = cb.as_ref() {
                        callback(&item);
                    }
                }
            }
        }
        Some(MouseEventResult::handled())
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

impl HoverableList for SelectList {
    fn index_at_row(&self, row: usize) -> Option<usize> {
        let (start_index, end_index) = self.visible_range();
        let index = start_index + row;
        if index >= start_index && index < end_index {
            Some(index)
        } else {
            None
        }
    }

    fn select(&self, index: usize) -> bool {
        self.select_index(index)
    }
}

/// Normalize text to a single line.
fn normalize_single_line(text: &str) -> String {
    text.replace(|c: char| c == '\r' || c == '\n', " ")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_column_is_the_widest_label_plus_the_gap() {
        // The original's rule
        // (`packages/tui/src/components/select-list.ts:288-307`): the widest
        // label plus the gap of two, clamped to the layout's bounds.
        let layout = SelectListLayoutOptions {
            min_primary_column_width: Some(12),
            max_primary_column_width: Some(32),
            truncate_primary: None,
        };
        assert_eq!(layout.column_width(&["settings"]), 12);
        assert_eq!(layout.column_width(&["scoped-models"]), 15);
        // A label wider than the cap is clamped to it.
        assert_eq!(
            layout.column_width(&["a-command-name-far-wider-than-the-cap"]),
            32
        );
    }

    #[test]
    fn the_column_clamps_to_the_layouts_bounds() {
        let narrow = SelectListLayoutOptions {
            min_primary_column_width: Some(4),
            max_primary_column_width: Some(8),
            truncate_primary: None,
        };
        assert_eq!(narrow.column_width(&["ab"]), 4);
        assert_eq!(narrow.column_width(&["abcdefghijkl"]), 8);
    }

    #[test]
    fn test_select_list_new() {
        let items = vec![SelectItem::new("one", "One"), SelectItem::new("two", "Two")];
        let list = SelectList::new(items, 5);

        let lines = list.render(40);
        assert_eq!(lines.len(), 2);
    }

    #[test]
    fn test_select_list_filter() {
        let items = vec![
            SelectItem::new("apple", "Apple"),
            SelectItem::new("banana", "Banana"),
            SelectItem::new("apricot", "Apricot"),
        ];
        let list = SelectList::new(items, 5);

        list.set_filter("ap");
        let lines = list.render(40);
        assert_eq!(lines.len(), 2); // Apple and Apricot
    }

    #[test]
    fn empty_list_says_no_matching_commands() {
        let list = SelectList::new(vec![SelectItem::new("one", "One")], 5);
        list.set_filter("nothing matches this");
        let lines = list.render(40);
        assert_eq!(crate::utils::strip_ansi(&lines[0]), "  No matching commands");
    }

    #[test]
    fn test_select_list_navigation() {
        let items = vec![SelectItem::new("one", "One"), SelectItem::new("two", "Two")];
        let list = SelectList::new(items, 5);

        assert_eq!(list.get_selected_item().unwrap().value, "one");

        list.set_selected_index(1);
        assert_eq!(list.get_selected_item().unwrap().value, "two");
    }

    #[test]
    fn test_select_item() {
        let item = SelectItem::new("value", "Label").with_description("Description");

        assert_eq!(item.value, "value");
        assert_eq!(item.label, "Label");
        assert_eq!(item.description, Some("Description".to_string()));
        assert_eq!(item.display_value(), "Label");
    }

    #[test]
    fn hovering_a_row_moves_the_selection() {
        let list = SelectList::new(
            vec![
                SelectItem::new("one", "One"),
                SelectItem::new("two", "Two"),
                SelectItem::new("three", "Three"),
            ],
            5,
        );
        let event = MouseEvent::new(MouseEventKind::Move, MouseButton::None, 0, 2);
        assert!(list.handle_mouse(&event).is_some());
        assert_eq!(list.get_selected_item().unwrap().value, "three");
    }

    #[test]
    fn a_click_confirms_the_item_under_the_pointer() {
        let list = SelectList::new(
            vec![
                SelectItem::new("one", "One"),
                SelectItem::new("two", "Two"),
                SelectItem::new("three", "Three"),
            ],
            5,
        );
        let confirmed = Arc::new(Mutex::new(Vec::<String>::new()));
        let confirmed_copy = confirmed.clone();
        list.on_select(Arc::new(move |item: &SelectItem| {
            confirmed_copy.lock().unwrap().push(item.value.clone());
        }));

        let press = MouseEvent::new(MouseEventKind::Press, MouseButton::Left, 0, 1);
        assert!(list.handle_mouse(&press).is_some());
        assert_eq!(list.get_selected_item().unwrap().value, "two");

        let click = MouseEvent::new(MouseEventKind::Click, MouseButton::Left, 0, 1);
        assert!(list.handle_mouse(&click).is_some());
        assert_eq!(confirmed.lock().unwrap().as_slice(), &["two".to_string()]);
    }

    #[test]
    fn a_hover_keeps_the_visible_window_in_place() {
        let items: Vec<SelectItem> = (0..20)
            .map(|index| SelectItem::new(&format!("item-{index}"), &format!("Item {index}")))
            .collect();
        let list = SelectList::new(items, 5);
        let event = MouseEvent::new(MouseEventKind::Move, MouseButton::None, 0, 4);
        list.handle_mouse(&event);
        assert_eq!(list.visible_range(), (0, 5));
        assert_eq!(list.get_selected_item().unwrap().value, "item-4");
    }

    #[test]
    fn test_multi_select_toggle_and_submit() {
        use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
        let list = SelectList::new_multi(
            vec![SelectItem::new("one", "One"), SelectItem::new("two", "Two")],
            5,
        );
        let submitted = Arc::new(Mutex::new(Vec::<String>::new()));
        let submitted_copy = submitted.clone();
        list.on_multi_select(Arc::new(move |items| {
            *submitted_copy.lock().unwrap() = items.iter().map(|item| item.value.clone()).collect();
        }));

        list.handle_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::NONE));
        list.handle_key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE));
        list.handle_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::NONE));
        list.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert_eq!(
            submitted.lock().unwrap().as_slice(),
            &["one".to_string(), "two".to_string()]
        );
        assert!(list.render(40)[0].contains("[x]"));
    }
}
