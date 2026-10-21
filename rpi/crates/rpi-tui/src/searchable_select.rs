//! Searchable select list — a titled select list with a fuzzy-filter input.
//!
//! Port of upstream's `SelectSubmenu` (`components/settings-submenu.ts`) with
//! `searchable: true`. Typing filters the list through [`SelectList::set_filter`]
//! while arrow keys, Enter, and Esc keep their list semantics, so the widget
//! behaves like a plain [`SelectList`] until the user types.
//!
//! The wrapper owns the search [`Input`] and the inner list; callers register
//! `on_select` / `on_cancel` on the list they pass in, exactly as they would for
//! a bare `SelectList`.

use std::any::Any;
use std::sync::{Arc, Mutex};

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

use super::component::{Component, Focusable, MouseEvent, MouseEventResult};
use crate::ansi::bold;
use crate::input::Input;
use crate::select_list::{SelectItem, SelectList};
use crate::spacer::Spacer;
use crate::theme::theme;
use crate::utils::truncate_to_width;

/// A select list preceded by a search input that fuzzy-filters its items.
pub struct SearchableSelectList {
    title: Option<String>,
    description: Option<String>,
    input: Arc<Input>,
    list: Arc<SelectList>,
    focused: Mutex<bool>,
    /// First row of the list inside this widget, tracked at render time so a
    /// mouse event can be routed to the list.
    list_top: Mutex<usize>,
    /// pi's menu framework (`packages/tui/src/components/menu.ts`): the title,
    /// the search field, the list, the footer and the hint, with no blank rows
    /// between them and no description.
    menu: bool,
    /// The line under the list (pi's `setFooterText`).
    footer: Mutex<Option<String>>,
    /// The line under the footer (pi's `hintLine`).
    hint: Mutex<Option<String>>,
    /// The hint line, rendered verbatim (no indent).
    hint_line: Mutex<Option<String>>,
}

impl SearchableSelectList {
    /// Wrap `list` with a search input. `title` / `description` are optional
    /// header rows (upstream's `SelectSubmenu` shows both).
    pub fn new(title: Option<&str>, description: Option<&str>, list: Arc<SelectList>) -> Self {
        let input = Arc::new(Input::new());
        // Every text edit re-filters the list. `Input::on_change` fires after
        // the state lock is released, so this can safely read the value.
        let list_for_change = list.clone();
        input.on_change(Arc::new(move |value: &str| {
            list_for_change.set_filter(value);
        }));
        Self {
            title: title.map(str::to_string),
            description: description.map(str::to_string),
            input,
            list,
            focused: Mutex::new(false),
            list_top: Mutex::new(0),
            menu: false,
            footer: Mutex::new(None),
            hint: Mutex::new(None),
            hint_line: Mutex::new(None),
        }
    }

    /// Lay the widget out as pi's menu framework: the title, the search field,
    /// the list, the footer and the hint.
    pub fn with_menu_layout(mut self) -> Self {
        self.menu = true;
        self.description = None;
        self.input.set_placeholder("Search");
        self
    }

    /// The line under the list (pi's `setFooterText`).
    pub fn set_footer_text(&self, text: Option<String>) {
        if let Ok(mut footer) = self.footer.lock() {
            *footer = text;
        }
    }

    /// The line under the footer (pi's `hintLine`).
    pub fn set_hint(&self, text: Option<String>) {
        if let Ok(mut hint) = self.hint.lock() {
            *hint = text;
        }
    }

    /// The hint line, rendered verbatim.
    ///
    /// pi's `MenuComponent.hintLine()` returns the line as it is
    /// (`packages/coding-agent/src/modes/interactive/components/menu.ts:192`),
    /// and only the *default* hint carries the two-space indent in its own
    /// text — the login method screen's hint has none.
    pub fn set_hint_line(&self, text: Option<String>) {
        if let Ok(mut hint) = self.hint_line.lock() {
            *hint = text;
        }
    }

    /// Replace the list's items, keeping the current search query applied.
    pub fn set_items(&self, items: Vec<SelectItem>) {
        self.list.set_items(items);
        self.list.set_filter(&self.input.get_value());
    }

    /// The wrapped list. Callers register `on_select` / `on_cancel` here.
    pub fn list(&self) -> &Arc<SelectList> {
        &self.list
    }

    /// The search input (for tests / programmatic prefills).
    pub fn input(&self) -> &Arc<Input> {
        &self.input
    }

    /// Prefill the search box and apply the filter. Used when a slash command
    /// was given a search term that did not match exactly (upstream's
    /// `initialSearchInput`).
    pub fn set_search_text(&self, text: &str) {
        self.input.set_value(text);
        self.list.set_filter(text);
    }

    /// Route a key to the list or the search box.
    ///
    /// List semantics win for navigation/confirm/cancel and for the Emacs-style
    /// list bindings; everything else (printable characters, backspace,
    /// caret movement) edits the filter.
    pub fn handle_key(&self, key: KeyEvent) {
        if Self::key_belongs_to_list(key, self.list.is_multi_select()) {
            self.list.handle_key(key);
        } else {
            self.input.handle_key(key);
        }
    }

    /// Whether `key` should drive the list instead of the search box.
    fn key_belongs_to_list(key: KeyEvent, multi_select: bool) -> bool {
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
        match key.code {
            KeyCode::Esc | KeyCode::Enter | KeyCode::Up | KeyCode::Down => true,
            KeyCode::PageUp | KeyCode::PageDown => true,
            // Space toggles in multi-select; otherwise it is a search char.
            KeyCode::Char(' ') => multi_select,
            // `SelectList`'s Ctrl+K/J/P/N navigation.
            KeyCode::Char('k') | KeyCode::Char('p') => ctrl,
            KeyCode::Char('j') | KeyCode::Char('n') => ctrl,
            _ => false,
        }
    }
}

impl Component for SearchableSelectList {
    fn render(&self, width: usize) -> Vec<String> {
        let colors = theme().colors;
        let mut lines: Vec<String> = Vec::new();

        if self.menu {
            if let Some(title) = &self.title {
                lines.push(truncate_to_width(
                    &colors.muted.fg(&format!("  {title}")),
                    width,
                    "…",
                ));
            }
            lines.extend(self.input.render(width));
            if let Ok(mut list_top) = self.list_top.lock() {
                *list_top = lines.len();
            }
            lines.extend(self.list.render(width));
            if let Ok(footer) = self.footer.lock() {
                if let Some(text) = footer.as_ref() {
                    lines.push(truncate_to_width(
                        &colors.muted.fg(&format!("  {text}")),
                        width,
                        "…",
                    ));
                }
            }
            if let Ok(hint) = self.hint.lock() {
                if let Some(text) = hint.as_ref() {
                    lines.push(truncate_to_width(
                        &colors.dim.fg(&format!("  {text}")),
                        width,
                        "…",
                    ));
                }
            }
            if let Ok(hint) = self.hint_line.lock() {
                if let Some(text) = hint.as_ref() {
                    lines.push(truncate_to_width(&colors.dim.fg(text), width, "…"));
                }
            }
            return lines;
        }

        if let Some(title) = &self.title {
            let styled = colors.accent.fg(&bold(title));
            lines.push(truncate_to_width(&styled, width, "…"));
        }
        if let Some(description) = &self.description {
            if !description.is_empty() {
                if self.title.is_some() {
                    lines.extend(Spacer::new(1).render(width));
                }
                let styled = colors.muted.fg(description);
                lines.push(truncate_to_width(&styled, width, "…"));
            }
        }

        lines.extend(Spacer::new(1).render(width));
        // Render the search row through `Text` so long queries wrap inside the
        // width instead of overflowing the frame.
        let search = self.input.render(width);
        lines.extend(search);
        lines.extend(Spacer::new(1).render(width));
        if let Ok(mut list_top) = self.list_top.lock() {
            *list_top = lines.len();
        }
        lines.extend(self.list.render(width));
        lines
    }

    fn handle_mouse(&self, event: &MouseEvent) -> Option<MouseEventResult> {
        let list_top = self.list_top.lock().map(|top| *top).unwrap_or(0);
        if event.y < list_top {
            return None;
        }
        let translated = MouseEvent {
            y: event.y - list_top,
            ..*event
        };
        self.list.handle_mouse(&translated)
    }

    fn invalidate(&self) {
        self.input.invalidate();
        self.list.invalidate();
    }

    fn as_focusable(&self) -> Option<&dyn crate::component::Focusable> {
        Some(self)
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

impl Focusable for SearchableSelectList {
    fn set_focused(&self, focused: bool) {
        if let Ok(mut guard) = self.focused.lock() {
            *guard = focused;
        }
        // The search box holds the caret whenever the selector is focused, so
        // the hardware cursor lands in the query (IME candidate positioning).
        self.input.set_focused(focused);
    }

    fn is_focused(&self) -> bool {
        self.focused.lock().map(|guard| *guard).unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::select_list::SelectItem;
    use crossterm::event::KeyEvent;

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    fn list() -> Arc<SelectList> {
        Arc::new(SelectList::new(
            vec![
                SelectItem::new("claude-sonnet", "Claude Sonnet"),
                SelectItem::new("gpt-5", "GPT-5"),
                SelectItem::new("deepseek-chat", "DeepSeek Chat"),
            ],
            10,
        ))
    }

    #[test]
    fn typing_filters_the_list() {
        let widget = SearchableSelectList::new(Some("Model"), None, list());
        for ch in "deep".chars() {
            widget.handle_key(key(KeyCode::Char(ch)));
        }
        assert_eq!(widget.input().get_value(), "deep");
        let selected = widget.list().get_selected_item().expect("a match");
        assert_eq!(selected.value, "deepseek-chat");
    }

    #[test]
    fn backspace_restores_earlier_matches() {
        let widget = SearchableSelectList::new(None, None, list());
        for ch in "gpt".chars() {
            widget.handle_key(key(KeyCode::Char(ch)));
        }
        assert_eq!(widget.list().get_selected_item().unwrap().value, "gpt-5");
        widget.handle_key(key(KeyCode::Backspace));
        assert_eq!(widget.input().get_value(), "gp");
        // Still matching; clearing fully restores everything.
        widget.handle_key(key(KeyCode::Backspace));
        widget.handle_key(key(KeyCode::Backspace));
        assert_eq!(widget.input().get_value(), "");
        assert_eq!(
            widget.list().get_selected_item().unwrap().value,
            "claude-sonnet"
        );
    }

    #[test]
    fn navigation_keys_move_the_list_not_the_caret() {
        let widget = SearchableSelectList::new(None, None, list());
        widget.handle_key(key(KeyCode::Down));
        assert_eq!(widget.list().get_selected_item().unwrap().value, "gpt-5");
        assert_eq!(widget.input().get_value(), "");
        widget.handle_key(key(KeyCode::Up));
        assert_eq!(
            widget.list().get_selected_item().unwrap().value,
            "claude-sonnet"
        );
        assert_eq!(widget.input().get_value(), "");
    }

    #[test]
    fn enter_and_esc_reach_the_list_callbacks() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let widget = SearchableSelectList::new(None, None, list());
        let selected = Arc::new(AtomicUsize::new(0));
        let selected_cb = selected.clone();
        widget.list().on_select(Arc::new(move |_item| {
            selected_cb.fetch_add(1, Ordering::SeqCst);
        }));
        let cancelled = Arc::new(AtomicUsize::new(0));
        let cancelled_cb = cancelled.clone();
        widget.list().on_cancel(Arc::new(move || {
            cancelled_cb.fetch_add(1, Ordering::SeqCst);
        }));

        widget.handle_key(key(KeyCode::Enter));
        assert_eq!(selected.load(Ordering::SeqCst), 1);
        widget.handle_key(key(KeyCode::Esc));
        assert_eq!(cancelled.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn search_text_matches_label_and_provider_not_just_value() {
        // `search_text` is what enables matching a display name or provider.
        let items = vec![SelectItem::new("claude-sonnet-5", "Claude Sonnet 5")
            .with_search_text("anthropic anthropic/claude-sonnet-5 Claude Sonnet 5")];
        let widget = SearchableSelectList::new(None, None, Arc::new(SelectList::new(items, 10)));
        for ch in "anthropic".chars() {
            widget.handle_key(key(KeyCode::Char(ch)));
        }
        assert!(widget.list().get_selected_item().is_some());
    }

    #[test]
    fn set_search_text_prefills_and_filters() {
        let widget = SearchableSelectList::new(None, None, list());
        widget.set_search_text("gpt");
        assert_eq!(widget.input().get_value(), "gpt");
        assert_eq!(widget.list().get_selected_item().unwrap().value, "gpt-5");
    }

    #[test]
    fn renders_title_description_and_search_row() {
        let widget = SearchableSelectList::new(Some("Pick"), Some("Choose one"), list());
        let rendered = crate::strip_ansi(&widget.render(60).join("\n"));
        assert!(rendered.contains("Pick"), "{rendered}");
        assert!(rendered.contains("Choose one"), "{rendered}");
        assert!(rendered.contains("Claude Sonnet"), "{rendered}");
    }

    #[test]
    fn a_click_on_a_row_reaches_the_list() {
        use crate::component::{MouseButton, MouseEvent, MouseEventKind};

        let widget = SearchableSelectList::new(Some("Pick"), None, list());
        widget.render(60);
        let list_top = *widget.list_top.lock().unwrap();
        let press = MouseEvent::new(MouseEventKind::Press, MouseButton::Left, 0, list_top + 1);
        assert!(widget.handle_mouse(&press).is_some());
        assert_eq!(widget.list().get_selected_item().unwrap().value, "gpt-5");
    }

    #[test]
    fn a_click_above_the_list_is_not_a_list_click() {
        use crate::component::{MouseButton, MouseEvent, MouseEventKind};

        let widget = SearchableSelectList::new(Some("Pick"), None, list());
        widget.render(60);
        let press = MouseEvent::new(MouseEventKind::Press, MouseButton::Left, 0, 0);
        assert!(widget.handle_mouse(&press).is_none());
    }
}
