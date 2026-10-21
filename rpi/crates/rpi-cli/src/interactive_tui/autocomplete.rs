//! Completion suggestions and editor cursor operations.

use super::*;

// ===========================================================================
// Autocomplete
// ===========================================================================

/// The selection value that means "the user dismissed the popup".
///
/// The port draws the suggestion list from the provider on every keystroke, so
/// "closed" is not a state of the list itself. The marker stands in for
/// upstream's `autocompleteState = null`: it survives until the text changes
/// (which re-renders the list) and keeps a dismissed popup from accepting a
/// suggestion on Enter.
pub(super) const AUTOCOMPLETE_DISMISSED: usize = usize::MAX;

/// What Enter did with the open suggestion list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum AcceptOutcome {
    /// No popup was open, or the completion is not in a context where upstream
    /// shows one. The key is the caller's to handle.
    None,
    /// The highlighted item was accepted and the text is a `/` command, so the
    /// Enter also submits it (upstream falls through to submit for a command
    /// completion).
    SlashCommand,
    /// The highlighted item was accepted and the text is not a command, so the
    /// Enter does not submit.
    Completed,
}

/// Refresh the autocomplete suggestion list from the current editor text +
/// cursor. Renders the suggestions into `autocomplete_container` (above the
/// editor) or clears it when there are none.
pub(super) fn refresh_autocomplete(state: &Arc<TuiState>, editor: &Arc<Editor>) {
    let text = editor.get_text();
    let cursor = editor_cursor_offset(editor, &text);
    let suggestions = state.autocomplete.get_suggestions(&text, cursor);
    render_autocomplete(state, suggestions);
}

/// Convert the editor's logical `(row, byte-column)` caret into the absolute
/// byte offset expected by autocomplete providers.
pub(super) fn editor_cursor_offset(editor: &Editor, text: &str) -> usize {
    let (row, col) = editor.cursor_position();
    let mut offset = 0;
    for (index, line) in text.split('\n').enumerate() {
        if index == row {
            return (offset + col.min(line.len())).min(text.len());
        }
        offset = offset.saturating_add(line.len() + 1);
    }
    text.len()
}

/// Restore an editor caret from an absolute byte offset after autocomplete
/// replaces a span in a multi-line draft.
pub(super) fn set_editor_cursor_offset(editor: &Editor, text: &str, offset: usize) {
    let offset = offset.min(text.len());
    let mut consumed = 0;
    for (row, line) in text.split('\n').enumerate() {
        let end = consumed + line.len();
        if offset <= end {
            editor.set_cursor(row, offset - consumed);
            return;
        }
        consumed += line.len() + 1;
    }
    let last_row = text.bytes().filter(|byte| *byte == b'\n').count();
    editor.set_cursor(
        last_row,
        text.rsplit('\n').next().map(str::len).unwrap_or(0),
    );
}

/// Render (or clear) the autocomplete suggestion list into the container.
///
/// The original builds the popup's list as a `SelectList`
/// (`packages/tui/src/components/editor.ts:2451-2452`) and renders it at the
/// editor's own width, so the popup shows the same `(n/m)` counter, the same
/// label column and the same wrap-around as every other list. The rows come
/// from the provider and the highlight from `state.autocomplete_selection`, so
/// the row the popup highlights is the row the accept path takes.
pub(super) fn render_autocomplete(
    state: &Arc<TuiState>,
    suggestions: Option<AutocompleteSuggestions>,
) {
    state.autocomplete_container.clear();
    let Some(sugg) = suggestions else {
        *state.autocomplete_selection.lock().unwrap() = 0;
        return;
    };
    if sugg.items.is_empty() {
        *state.autocomplete_selection.lock().unwrap() = 0;
        return;
    }
    let total = sugg.items.len();
    let selection = {
        let mut sel = state.autocomplete_selection.lock().unwrap();
        // A dismissed list reopens on the first item when the text changes.
        *sel = if *sel == AUTOCOMPLETE_DISMISSED {
            0
        } else {
            (*sel).min(total.saturating_sub(1))
        };
        *sel
    };
    // The rows: the bare label for display, the text for the accept.
    let items: Vec<rpi_tui::SelectItem> = sugg
        .items
        .iter()
        .map(|item| {
            rpi_tui::SelectItem::new(&item.text, bare_label(item))
                .with_description(item.description.as_deref().unwrap_or(""))
        })
        .collect();
    // The original gives its command list the narrower column
    // (`packages/tui/src/components/editor.ts:2451`); every other list keeps
    // the default.
    let mut layout = rpi_tui::SelectListLayoutOptions::default();
    if is_command_context(&sugg) {
        layout.min_primary_column_width = Some(12);
        layout.max_primary_column_width = Some(32);
    }
    state
        .autocomplete_container
        .add_child(Arc::new(AutocompletePopup {
            items,
            selection,
            max_visible: state.autocomplete_max_visible,
            layout,
            fallback_width: state.viewport_width(),
        }));
}

/// The popup's rows, rendered as a `SelectList` at the width the layout gives
/// the popup — the original's shape: the editor owns the list and renders it
/// at its own width (`packages/tui/src/components/editor.ts:2451-2452`).
///
/// The rows are rendered here rather than pre-rendered into the container,
/// because a row laid out at one width and drawn at another wraps: the
/// description ends up on a second line and the row is broken.
struct AutocompletePopup {
    items: Vec<rpi_tui::SelectItem>,
    selection: usize,
    max_visible: usize,
    layout: rpi_tui::SelectListLayoutOptions,
    /// The width the popup falls back to when the layout gives it none: the
    /// editor's own width, the way the original's editor renders its list.
    fallback_width: usize,
}

impl Component for AutocompletePopup {
    fn render(&self, width: usize) -> Vec<String> {
        let width = if width == 0 { self.fallback_width } else { width };
        let mut list = rpi_tui::SelectList::new(self.items.clone(), self.max_visible);
        list.set_layout(self.layout.clone());
        // Setting the index also centres the window on it, so the highlighted
        // row is the one the popup shows.
        list.set_selected_index(self.selection);
        list.render(width)
    }

    fn invalidate(&self) {}

    fn as_any(&self) -> &(dyn std::any::Any + 'static) {
        self
    }
}

/// Whether the completion is a `/` command list, the one the original gives
/// its narrower label column (`packages/tui/src/components/editor.ts:2451`).
fn is_command_context(sugg: &AutocompleteSuggestions) -> bool {
    sugg.items
        .first()
        .map(|item| item.text.starts_with('/'))
        .unwrap_or(false)
}

/// The row label of an autocomplete item. The original's command rows show the
/// bare command name, without the leading slash
/// (`packages/tui/src/autocomplete.ts:352-360`).
fn bare_label(item: &rpi_tui::autocomplete::AutocompleteItem) -> &str {
    item.display_text().trim_start_matches('/')
}

/// Whether a completion is in a context where upstream shows a popup the user
/// picks from with the keyboard.
///
/// Upstream's editor opens the list for a `/` command, an `@` mention, or a
/// path — a token with a separator in it
/// (`packages/tui/src/autocomplete.ts:412-424`). A bare word is not a
/// completion there, so its Enter still sends the message.
pub(super) fn is_explicit_completion(text: &str, start: usize, end: usize) -> bool {
    let start = start.min(text.len());
    let end = end.clamp(start, text.len());
    let span = &text[start..end];
    let before = &text[..start];
    span.contains('/') || span.starts_with('@') || before.ends_with('@')
}

/// Replace the completed span with the suggestion's text and report the caret
/// offset that follows the inserted text.
///
/// `start`/`end` are byte offsets emitted by the providers on char boundaries,
/// so the slices are sound for multibyte input. The text *after* the replaced
/// span is kept: a mid-line completion must not drop the rest of the line.
pub(super) fn apply_completion(
    text: &str,
    start: usize,
    end: usize,
    suggestion: &str,
    insert_space: bool,
) -> (String, usize) {
    let start = start.min(text.len());
    let end = end.clamp(start, text.len());
    let mut replaced = String::with_capacity(text.len() + suggestion.len());
    replaced.push_str(&text[..start]);
    replaced.push_str(suggestion);
    replaced.push_str(&text[end..]);
    let space = if insert_space && !replaced.ends_with('/') {
        1
    } else {
        0
    };
    if space > 0 {
        replaced.push(' ');
    }
    let caret = (start + suggestion.len() + space).min(replaced.len());
    (replaced, caret)
}

/// Accept the highlighted autocomplete suggestion: replace `text[start..end]`
/// with the suggestion text, reposition the caret, and clear the suggestion
/// list. Returns `true` if a suggestion was accepted.
pub(super) fn accept_top_suggestion(state: &Arc<TuiState>, editor: &Arc<Editor>) -> bool {
    let text = editor.get_text();
    let cursor = editor_cursor_offset(editor, &text);
    let Some(sugg) = state.autocomplete.get_suggestions(&text, cursor) else {
        return false;
    };
    if sugg.items.is_empty() {
        return false;
    }
    let index = {
        let sel = *state.autocomplete_selection.lock().unwrap();
        if sel == AUTOCOMPLETE_DISMISSED {
            return false;
        }
        sel.min(sugg.items.len().saturating_sub(1))
    };
    let Some(item) = sugg.items.get(index) else {
        return false;
    };
    let (replaced, caret) = apply_completion(
        &text,
        sugg.start,
        sugg.end,
        &item.text,
        item.insert_space,
    );
    editor.set_text(&replaced);
    set_editor_cursor_offset(editor, &replaced, caret);
    state.autocomplete_container.clear();
    *state.autocomplete_selection.lock().unwrap() = 0;
    true
}

/// Accept the highlighted suggestion for an Enter keypress.
///
/// Upstream's editor binds `tui.select.confirm` (Enter) to the open
/// suggestion list: the highlighted item is applied, and for a `/` command the
/// Enter then submits the command as well. A completion that is not a command
/// (a path or an `@` mention) is applied without submitting.
pub(super) fn accept_highlighted_suggestion(
    state: &Arc<TuiState>,
    editor: &Arc<Editor>,
) -> AcceptOutcome {
    let text = editor.get_text();
    let cursor = editor_cursor_offset(editor, &text);
    let Some(sugg) = state.autocomplete.get_suggestions(&text, cursor) else {
        return AcceptOutcome::None;
    };
    if sugg.items.is_empty() {
        return AcceptOutcome::None;
    }
    if !is_explicit_completion(&text, sugg.start, sugg.end) {
        return AcceptOutcome::None;
    }
    let index = {
        let sel = *state.autocomplete_selection.lock().unwrap();
        if sel == AUTOCOMPLETE_DISMISSED {
            return AcceptOutcome::None;
        }
        sel.min(sugg.items.len().saturating_sub(1))
    };
    let Some(item) = sugg.items.get(index) else {
        return AcceptOutcome::None;
    };
    let (replaced, caret) = apply_completion(
        &text,
        sugg.start,
        sugg.end,
        &item.text,
        item.insert_space,
    );
    // A `/` command completion also submits the command; a path or a mention
    // completion only fills the text. The command provider is the only one
    // whose completion starts with a slash (the path provider's own rows never
    // do, and it marks them with `is_path`).
    let is_command = !sugg.is_path && text[sugg.start.min(text.len())..].starts_with('/');
    editor.set_text(&replaced);
    set_editor_cursor_offset(editor, &replaced, caret);
    state.autocomplete_container.clear();
    *state.autocomplete_selection.lock().unwrap() = 0;
    if is_command {
        AcceptOutcome::SlashCommand
    } else {
        AcceptOutcome::Completed
    }
}

/// Close the suggestion list without changing the editor text.
///
/// The list is redrawn from the provider on the next keystroke, so the
/// dismissal is recorded in the selection and cleared by that redraw.
pub(super) fn close_autocomplete(state: &Arc<TuiState>) {
    state.autocomplete_container.clear();
    *state.autocomplete_selection.lock().unwrap() = AUTOCOMPLETE_DISMISSED;
}

/// Whether a suggestion list is open for the current draft.
///
/// The list is open when the provider has rows for the text under the caret
/// and the completion is one the user picks from (a `/` command, an `@`
/// mention or a path) — the same contexts upstream opens its list in.
pub(super) fn autocomplete_is_open(state: &Arc<TuiState>, editor: &Arc<Editor>) -> bool {
    let text = editor.get_text();
    let cursor = editor_cursor_offset(editor, &text);
    let Some(sugg) = state.autocomplete.get_suggestions(&text, cursor) else {
        return false;
    };
    if sugg.items.is_empty() {
        return false;
    }
    is_explicit_completion(&text, sugg.start, sugg.end)
}

/// Move the autocomplete highlight up (`direction < 0`) or down (`direction > 0`)
/// and re-render the list. Returns `true` when the key was consumed.
///
/// Only takes over the arrow keys in an explicit completion context (`/` or
/// `@` prefix); a bare-word path completion (e.g. a draft containing `docs`)
/// must NOT swallow ↑/↓, which the editor uses for cursor/history movement.
pub(super) fn navigate_autocomplete(
    state: &Arc<TuiState>,
    editor: &Arc<Editor>,
    direction: i32,
) -> bool {
    let text = editor.get_text();
    let cursor = editor_cursor_offset(editor, &text);
    let Some(sugg) = state.autocomplete.get_suggestions(&text, cursor) else {
        return false;
    };
    if sugg.items.is_empty() {
        return false;
    }
    if !is_explicit_completion(&text, sugg.start, sugg.end) {
        return false;
    }
    {
        let mut sel = state.autocomplete_selection.lock().unwrap();
        if *sel == AUTOCOMPLETE_DISMISSED {
            return false;
        }
        let last = sugg.items.len().saturating_sub(1);
        // The original's list wraps: `↓` past the last entry returns to the
        // first and `↑` before the first goes to the last
        // (`packages/tui/src/components/select-list.ts:196-212`).
        if direction < 0 {
            *sel = if *sel == 0 { last } else { *sel - 1 };
        } else {
            *sel = if *sel >= last { 0 } else { *sel + 1 };
        }
    }
    render_autocomplete(state, Some(sugg));
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_completion_replaces_the_span_and_keeps_the_rest_of_the_line() {
        let (text, caret) = apply_completion("say /mo now", 4, 7, "/model", false);
        assert_eq!(text, "say /model now");
        assert_eq!(caret, 10);
    }

    #[test]
    fn apply_completion_adds_the_space_the_item_asks_for() {
        let (text, caret) = apply_completion("@fi", 0, 3, "@file.txt", true);
        assert_eq!(text, "@file.txt ");
        assert_eq!(caret, 10);
    }

    #[test]
    fn apply_completion_keeps_a_directory_open_for_more_completion() {
        let (text, _) = apply_completion("src/", 0, 4, "src/lib/", false);
        assert_eq!(text, "src/lib/");
    }

    #[test]
    fn only_a_command_a_mention_or_a_path_is_an_explicit_completion() {
        assert!(is_explicit_completion("/mod", 0, 4));
        assert!(is_explicit_completion("@fi", 0, 3));
        assert!(is_explicit_completion("say @fi", 4, 7));
        assert!(is_explicit_completion("src/li", 0, 6));
        assert!(!is_explicit_completion("docs", 0, 4));
        assert!(!is_explicit_completion("say docs", 4, 8));
    }

    /// The popup shows the original's `(n/m)` counter
    /// (`packages/tui/src/components/select-list.ts:126-131`).
    #[test]
    fn the_popup_shows_the_counter() {
        let state = crate::interactive_tui::tests::autocomplete_test_state(5);
        let commands: Vec<rpi_tui::SlashCommand> = (0..7)
            .map(|i| rpi_tui::SlashCommand {
                name: format!("/choice{i}"),
                description: format!("choice {i}"),
                argument_hint: None,
            })
            .collect();
        state
            .autocomplete
            .set_provider(Arc::new(rpi_tui::SlashCommandAutocompleteProvider::new(
                commands,
            )));
        let editor = Arc::new(Editor::simple());
        editor.set_text("/");
        editor.set_cursor(0, 1);
        refresh_autocomplete(&state, &editor);
        let rendered = state
            .autocomplete_container
            .render(80)
            .join("\n");
        assert!(
            rendered.contains("(1/7)"),
            "the popup must show the counter, got:\n{rendered}"
        );
    }

    /// The popup renders its rows in the dock, at the width the layout gives
    /// it.
    ///
    /// The rows are drawn by the popup itself, at the width the layout hands
    /// it — the original's shape, where the editor owns the list and renders it
    /// at its own width (`packages/tui/src/components/editor.ts:2451-2452`).
    /// A row laid out at one width and drawn at another wraps, and the popup
    /// then shows a broken row instead of the list.
    #[test]
    fn the_popup_renders_its_rows_in_the_dock() {
        use rpi_tui::render_layout_frame;

        let state = crate::interactive_tui::tests::autocomplete_test_state(5);
        let commands: Vec<rpi_tui::SlashCommand> = (0..7)
            .map(|i| rpi_tui::SlashCommand {
                name: format!("/choice{i}"),
                description: format!("choice {i}"),
                argument_hint: None,
            })
            .collect();
        state
            .autocomplete
            .set_provider(Arc::new(rpi_tui::SlashCommandAutocompleteProvider::new(
                commands,
            )));
        let editor = Arc::new(Editor::simple());
        editor.set_text("/");
        editor.set_cursor(0, 1);
        refresh_autocomplete(&state, &editor);

        // The dock the popup lives in: above the editor.
        let editor_container = Arc::new(Container::new());
        editor_container.add_child(editor.clone());
        let dock = Arc::new(VStack::from_children(vec![
            StackChild::Entry(StackEntry::new(state.autocomplete_container.clone())),
            StackChild::Entry(
                StackEntry::new(editor_container)
                    .shrink(0)
                    .min_size(3),
            ),
        ]));
        let frame = render_layout_frame(dock, 80, 10);
        let plain: String = frame
            .lines
            .iter()
            .map(|line| rpi_tui::strip_ansi(line))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            plain.contains("choice0"),
            "the popup must show its rows, got:\n{plain}"
        );
        assert!(
            plain.contains("choice 0"),
            "the popup must show the descriptions, got:\n{plain}"
        );
        assert!(
            plain.contains("(1/7)"),
            "the popup must show the counter, got:\n{plain}"
        );
    }

    /// The original's list wraps: `↓` past the last entry returns to the first
    /// (`packages/tui/src/components/select-list.ts:203-210`).
    #[test]
    fn the_popup_wraps_around() {
        let state = crate::interactive_tui::tests::autocomplete_test_state(5);
        let commands: Vec<rpi_tui::SlashCommand> = (0..3)
            .map(|i| rpi_tui::SlashCommand {
                name: format!("/choice{i}"),
                description: format!("choice {i}"),
                argument_hint: None,
            })
            .collect();
        state
            .autocomplete
            .set_provider(Arc::new(rpi_tui::SlashCommandAutocompleteProvider::new(
                commands,
            )));
        let editor = Arc::new(Editor::simple());
        editor.set_text("/");
        editor.set_cursor(0, 1);
        refresh_autocomplete(&state, &editor);
        // ↓ twice reaches the last entry, ↓ once more wraps to the first.
        assert!(navigate_autocomplete(&state, &editor, 1));
        assert!(navigate_autocomplete(&state, &editor, 1));
        assert_eq!(*state.autocomplete_selection.lock().unwrap(), 2);
        assert!(navigate_autocomplete(&state, &editor, 1));
        assert_eq!(
            *state.autocomplete_selection.lock().unwrap(),
            0,
            "↓ past the last entry must wrap to the first"
        );
        // ↑ before the first wraps to the last.
        assert!(navigate_autocomplete(&state, &editor, -1));
        assert_eq!(
            *state.autocomplete_selection.lock().unwrap(),
            2,
            "↑ before the first entry must wrap to the last"
        );
    }
}
