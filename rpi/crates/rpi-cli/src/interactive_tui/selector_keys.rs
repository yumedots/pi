//! The app keybindings that belong to an open selector.
//!
//! Upstream routes them inside the component that owns the screen: the session
//! menu (`app.session.*`), the tree selector (`app.tree.*`), the scoped-models
//! selector (`app.models.*`) and the thinking selector
//! (`app.thinking.save`). The port's selectors are plain lists, so the ids are
//! matched here and the list is refreshed in place.

use super::*;

use std::path::{Path, PathBuf};

use rpi_tui::keybindings::keys;

/// Route an app keybinding to the open selector. Returns `true` when the key
/// was consumed.
pub(super) fn handle_selector_key(
    state: &Arc<TuiState>,
    bindings: &rpi_tui::Keybindings,
    key: &crossterm::event::KeyEvent,
    lane: &Arc<dyn AgentLane>,
    catalog: &Arc<std::sync::RwLock<Vec<rpi_ai::Model>>>,
    tui: &Arc<TuiAltScreen>,
) -> bool {
    let Some((view, kind)) = state.active_selector.lock().unwrap().clone() else {
        return false;
    };
    match kind {
        SelectorKind::Session => session_menu_key(state, bindings, key, &view, tui),
        SelectorKind::Tree => tree_menu_key(state, bindings, key, &view, lane, tui),
        SelectorKind::ScopedModels => models_key(state, bindings, key, &view, catalog, tui),
        SelectorKind::Thinking => thinking_key(state, bindings, key, &view, tui),
        _ => false,
    }
}

/// The highlighted row of a selector.
fn selected_item(view: &SelectorView) -> Option<SelectItem> {
    match view {
        SelectorView::List(list) => list.get_selected_item(),
        SelectorView::Searchable(searchable) => searchable.list().get_selected_item(),
        SelectorView::Settings(_) => None,
        SelectorView::Trust(_) => None,
    }
}

/// Replace the rows of a selector, keeping the search query applied.
fn refresh_items(view: &SelectorView, items: Vec<SelectItem>) {
    match view {
        SelectorView::List(list) => list.set_items(items),
        SelectorView::Searchable(searchable) => searchable.set_items(items),
        SelectorView::Settings(_) => {}
        SelectorView::Trust(_) => {}
    }
}

/// The search box's text (empty for a selector without one).
fn search_value(view: &SelectorView) -> String {
    match view {
        SelectorView::Searchable(searchable) => searchable.input().get_value(),
        _ => String::new(),
    }
}

/// Put text into the search box.
fn set_search_value(view: &SelectorView, value: &str) {
    if let SelectorView::Searchable(searchable) = view {
        searchable.input().set_value(value);
    }
}

/// The highlighted row's index in the filtered list.
fn selected_index(view: &SelectorView) -> usize {
    match view {
        SelectorView::List(list) => list.selected_index(),
        SelectorView::Searchable(searchable) => searchable.list().selected_index(),
        SelectorView::Settings(_) => 0,
        SelectorView::Trust(_) => 0,
    }
}

/// Move the highlighted row to `index` in the filtered list.
fn set_selected_index(view: &SelectorView, index: usize) {
    match view {
        SelectorView::List(list) => list.set_selected_index(index),
        SelectorView::Searchable(searchable) => searchable.list().set_selected_index(index),
        SelectorView::Settings(_) => {}
        SelectorView::Trust(_) => {}
    }
}

// ===========================================================================
// Session menu — app.session.*
// ===========================================================================

/// The session menu's own keybindings (upstream's `SessionMenuComponent`).
fn session_menu_key(
    state: &Arc<TuiState>,
    bindings: &rpi_tui::Keybindings,
    key: &crossterm::event::KeyEvent,
    view: &SelectorView,
    tui: &Arc<TuiAltScreen>,
) -> bool {
    // A pending delete swallows every key until it is confirmed or cancelled.
    if let Some(stem) = state.session_menu.lock().unwrap().pending_delete.clone() {
        if key.code == KeyCode::Enter {
            delete_session(state, &stem, tui);
        } else if key.code == KeyCode::Esc {
            state.session_menu.lock().unwrap().pending_delete = None;
            state.clear_warning();
            tui.request_render(false);
        }
        return true;
    }
    // While renaming, the search box holds the new name.
    if state.session_menu.lock().unwrap().renaming.is_some() {
        if key.code == KeyCode::Enter {
            let name = search_value(view).trim().to_string();
            finish_rename(state, view, tui, name);
            return true;
        }
        if key.code == KeyCode::Esc {
            state.session_menu.lock().unwrap().renaming = None;
            set_search_value(view, "");
            tui.request_render(false);
            return true;
        }
    }
    if keybinding_matches(bindings, key, keys::SESSION_TOGGLE_SORT) {
        let mut menu = state.session_menu.lock().unwrap();
        menu.sort = match menu.sort {
            SessionSort::Recent => SessionSort::Oldest,
            SessionSort::Oldest => SessionSort::Recent,
        };
        drop(menu);
        refresh_session_menu(state, view, tui);
        return true;
    }
    if keybinding_matches(bindings, key, keys::SESSION_TOGGLE_PATH) {
        let mut menu = state.session_menu.lock().unwrap();
        menu.show_path = !menu.show_path;
        drop(menu);
        refresh_session_menu(state, view, tui);
        return true;
    }
    if keybinding_matches(bindings, key, keys::SESSION_TOGGLE_NAMED_FILTER) {
        let mut menu = state.session_menu.lock().unwrap();
        menu.named_only = !menu.named_only;
        drop(menu);
        refresh_session_menu(state, view, tui);
        return true;
    }
    if keybinding_matches(bindings, key, keys::SESSION_RENAME) {
        let Some(entry) = selected_entry(state, view) else {
            return true;
        };
        state.session_menu.lock().unwrap().renaming = Some(entry.stem.clone());
        set_search_value(view, entry.row.name().as_deref().unwrap_or_default());
        tui.request_render(false);
        return true;
    }
    if keybinding_matches(bindings, key, keys::SESSION_DELETE) {
        start_delete(state, view, tui);
        return true;
    }
    if keybinding_matches(bindings, key, keys::SESSION_DELETE_NONINVASIVE) {
        // Only when the search box is empty; otherwise the key belongs to it.
        if search_value(view).is_empty() {
            start_delete(state, view, tui);
            return true;
        }
        return false;
    }
    false
}

/// The session the highlighted row points at.
fn selected_entry(state: &Arc<TuiState>, view: &SelectorView) -> Option<SessionMenuEntry> {
    let item = selected_item(view)?;
    let menu = state.session_menu.lock().unwrap();
    menu.entries
        .iter()
        .find(|entry| entry.stem == item.value)
        .cloned()
}

/// Ask for the delete confirmation (upstream's `startDeleteConfirmation`).
fn start_delete(state: &Arc<TuiState>, view: &SelectorView, tui: &Arc<TuiAltScreen>) {
    let Some(entry) = selected_entry(state, view) else {
        return;
    };
    state.session_menu.lock().unwrap().pending_delete = Some(entry.stem.clone());
    state.show_warning("Delete session? Enter · Esc");
    tui.request_render(false);
}

/// Delete the confirmed session file and refresh the list.
fn delete_session(state: &Arc<TuiState>, stem: &str, tui: &Arc<TuiAltScreen>) {
    state.session_menu.lock().unwrap().pending_delete = None;
    state.clear_warning();
    let path = {
        let menu = state.session_menu.lock().unwrap();
        menu.entries
            .iter()
            .find(|entry| entry.stem == stem)
            .map(|entry| entry.path.clone())
    };
    let Some(path) = path else {
        return;
    };
    match std::fs::remove_file(&path) {
        Ok(()) => add_note_message(&state.chat_container, "Session deleted."),
        Err(error) => add_error_message(
            &state.chat_container,
            &format!("Failed to delete session: {error}"),
        ),
    }
    let view = state
        .active_selector
        .lock()
        .unwrap()
        .as_ref()
        .map(|(view, _)| view.clone());
    if let Some(view) = view {
        refresh_session_menu(state, &view, tui);
    }
}

/// Write the new name into the session file (upstream's `renameSession`).
fn finish_rename(
    state: &Arc<TuiState>,
    view: &SelectorView,
    tui: &Arc<TuiAltScreen>,
    name: String,
) {
    let stem = state.session_menu.lock().unwrap().renaming.take();
    state.session_menu.lock().unwrap().renaming = None;
    set_search_value(view, "");
    let Some(stem) = stem else {
        return;
    };
    let path = {
        let menu = state.session_menu.lock().unwrap();
        menu.entries
            .iter()
            .find(|entry| entry.stem == stem)
            .map(|entry| entry.path.clone())
    };
    let Some(path) = path else {
        return;
    };
    if name.is_empty() {
        add_note_message(&state.chat_container, "Session name unchanged.");
        return;
    }
    match rename_session_file(&path, &name) {
        Ok(()) => add_note_message(&state.chat_container, &format!("Session renamed to {name}.")),
        Err(error) => add_error_message(
            &state.chat_container,
            &format!("Could not rename session: {error}"),
        ),
    }
    refresh_session_menu(state, view, tui);
}

/// Append a `name` fact to a saved session file.
fn rename_session_file(path: &Path, name: &str) -> Result<(), String> {
    use rpi_harness::session::jsonl::JsonlSessionStorage;
    use rpi_harness::session::memory::SystemClock;
    use rpi_harness::session::session::DefaultIdGenerator;
    use rpi_harness::session::Session;
    use rpi_tools::{FileSystem, OsExecutionEnv};

    let path = path.to_path_buf();
    let name = name.to_string();
    let handle = tokio::runtime::Handle::try_current().map_err(|error| error.to_string())?;
    handle.block_on(async move {
        let dir = path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        let fs: Arc<dyn FileSystem> = Arc::new(OsExecutionEnv::with_cwd(dir));
        let storage = JsonlSessionStorage::load(
            fs,
            &path.to_string_lossy(),
            Arc::new(SystemClock),
            Arc::new(DefaultIdGenerator::new()),
        )
        .await
        .map_err(|error| error.to_string())?;
        let session = Session::new(Arc::new(storage), None);
        session
            .set_name(Some(name.as_str()))
            .await
            .map_err(|error| error.to_string())
    })
}

/// Re-read the session directory and rebuild the rows.
fn refresh_session_menu(
    state: &Arc<TuiState>,
    view: &SelectorView,
    tui: &Arc<TuiAltScreen>,
) {
    let (entries, items) = {
        let menu = state.session_menu.lock().unwrap();
        let entries = session_menu_entries(&menu.dir, &menu);
        // The titles of the rows the list shows.
        resolve_entry_titles(&entries, 0..SESSION_MENU_ROWS);
        let items = session_menu_items(&entries, menu.show_path);
        (entries, items)
    };
    state.session_menu.lock().unwrap().entries = entries;
    refresh_items(view, items);
    tui.request_render(false);
}

/// How many session rows the picker shows at once.
pub(super) const SESSION_MENU_ROWS: usize = 10;

/// The listed sessions, in display order.
///
/// The rows come from the session files' headers; their titles are read when
/// the rows are drawn, so a directory with thousands of sessions opens as fast
/// as one with ten.
pub(super) fn session_menu_entries(dir: &Path, menu: &SessionMenuState) -> Vec<SessionMenuEntry> {
    let mut rows = crate::session_index::list_session_rows(dir);
    if menu.sort == SessionSort::Oldest {
        rows.reverse();
    }
    if menu.named_only {
        // The named filter needs every session's name, and a name is recorded
        // in the session's body.
        crate::session_index::resolve_all_titles(&rows);
        rows.retain(|row| row.name().is_some());
    }
    rows.into_iter()
        .map(|row| {
            let stem = row
                .path()
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("(unnamed)")
                .to_string();
            let path = row.path().to_path_buf();
            SessionMenuEntry { stem, path, row }
        })
        .collect()
}

/// Read the titles of the rows in `range`, and only those.
///
/// Returns `true` when a row had to be read, so the caller knows the rows it
/// drew changed.
pub(super) fn resolve_entry_titles(
    entries: &[SessionMenuEntry],
    range: std::ops::Range<usize>,
) -> bool {
    let end = range.end.min(entries.len());
    let start = range.start.min(end);
    let mut resolved = false;
    for entry in &entries[start..end] {
        if !entry.row.header_only() && !entry.row.is_resolved() {
            entry.row.title();
            resolved = true;
        }
    }
    resolved
}

/// Read the titles of every row, and only those.
pub(super) fn resolve_all_entry_titles(entries: &[SessionMenuEntry]) -> bool {
    resolve_entry_titles(entries, 0..entries.len())
}

/// The session rows, with the metadata column the toggles switch between.
pub(super) fn session_menu_items(
    entries: &[SessionMenuEntry],
    show_path: bool,
) -> Vec<SelectItem> {
    entries
        .iter()
        .map(|entry| {
            let id_tail = entry.stem.rsplit('_').next().unwrap_or(&entry.stem);
            let metadata = if show_path {
                shorten_home_path(&entry.path)
            } else {
                crate::session::short_session_id(id_tail).to_string()
            };
            let description = format!(
                "{} · {}",
                crate::session::format_session_bytes(entry.row.bytes()),
                metadata
            );
            let label = entry
                .row
                .resolved_title()
                .unwrap_or_else(|| entry.stem.clone());
            SelectItem::new(&entry.stem, &label)
                .with_description(&description)
                .with_search_text(&format!("{} {}", label, entry.stem))
        })
        .collect()
}

/// Read the titles of the session rows the list shows, and redraw the rows
/// when a title was read.
///
/// A search needs every title, so a query reads them all; browsing reads only
/// the rows on screen.
pub(super) fn refresh_session_menu_titles(
    state: &Arc<TuiState>,
    view: &SelectorView,
    tui: &Arc<TuiAltScreen>,
) {
    let query = search_value(view);
    let (start, end) = view.visible_range();
    let menu = state.session_menu.lock().unwrap();
    let changed = if query.is_empty() {
        resolve_entry_titles(&menu.entries, start..end)
    } else {
        resolve_all_entry_titles(&menu.entries)
    };
    if !changed {
        return;
    }
    let items = session_menu_items(&menu.entries, menu.show_path);
    let selected = selected_index(view);
    drop(menu);
    refresh_items(view, items);
    set_selected_index(view, selected);
    tui.request_render(false);
}

/// `~/…` for a path under the home directory.
fn shorten_home_path(path: &Path) -> String {
    let text = path.to_string_lossy().into_owned();
    match std::env::var_os("HOME") {
        Some(home) => {
            let home = home.to_string_lossy().into_owned();
            if !home.is_empty() && text.starts_with(&home) {
                format!("~{}", &text[home.len()..])
            } else {
                text
            }
        }
        None => text,
    }
}

// ===========================================================================
// Tree selector — app.tree.*
// ===========================================================================

/// The tree selector's own keybindings (upstream's `TreeList`).
fn tree_menu_key(
    state: &Arc<TuiState>,
    bindings: &rpi_tui::Keybindings,
    key: &crossterm::event::KeyEvent,
    view: &SelectorView,
    lane: &Arc<dyn AgentLane>,
    tui: &Arc<TuiAltScreen>,
) -> bool {
    // While editing a label, the search box holds the new label.
    if state.tree_menu.lock().unwrap().editing_label {
        if key.code == KeyCode::Enter {
            let label = search_value(view).trim().to_string();
            finish_label_edit(state, view, lane, tui, label);
            return true;
        }
        if key.code == KeyCode::Esc {
            {
                let mut menu = state.tree_menu.lock().unwrap();
                menu.editing_label = false;
                menu.editing_label_id = None;
            }
            set_search_value(view, "");
            tui.request_render(false);
            return true;
        }
    }
    if keybinding_matches(bindings, key, keys::TREE_FILTER_DEFAULT) {
        set_tree_filter(state, view, tui, |filter| {
            *filter = TreeFilter::Default;
        });
        return true;
    }
    if keybinding_matches(bindings, key, keys::TREE_FILTER_NO_TOOLS) {
        set_tree_filter(state, view, tui, |filter| {
            *filter = if *filter == TreeFilter::NoTools {
                TreeFilter::Default
            } else {
                TreeFilter::NoTools
            };
        });
        return true;
    }
    if keybinding_matches(bindings, key, keys::TREE_FILTER_USER_ONLY) {
        set_tree_filter(state, view, tui, |filter| {
            *filter = if *filter == TreeFilter::UserOnly {
                TreeFilter::Default
            } else {
                TreeFilter::UserOnly
            };
        });
        return true;
    }
    if keybinding_matches(bindings, key, keys::TREE_FILTER_LABELED_ONLY) {
        set_tree_filter(state, view, tui, |filter| {
            *filter = if *filter == TreeFilter::LabeledOnly {
                TreeFilter::Default
            } else {
                TreeFilter::LabeledOnly
            };
        });
        return true;
    }
    if keybinding_matches(bindings, key, keys::TREE_FILTER_ALL) {
        set_tree_filter(state, view, tui, |filter| {
            *filter = if *filter == TreeFilter::All {
                TreeFilter::Default
            } else {
                TreeFilter::All
            };
        });
        return true;
    }
    if keybinding_matches(bindings, key, keys::TREE_FILTER_CYCLE_FORWARD) {
        set_tree_filter(state, view, tui, |filter| {
            *filter = filter.cycle_forward();
        });
        return true;
    }
    if keybinding_matches(bindings, key, keys::TREE_FILTER_CYCLE_BACKWARD) {
        set_tree_filter(state, view, tui, |filter| {
            *filter = filter.cycle_backward();
        });
        return true;
    }
    if keybinding_matches(bindings, key, keys::TREE_TOGGLE_LABEL_TIMESTAMP) {
        {
            let mut menu = state.tree_menu.lock().unwrap();
            menu.show_label_timestamps = !menu.show_label_timestamps;
        }
        refresh_tree_menu(state, view, tui);
        return true;
    }
    if keybinding_matches(bindings, key, keys::TREE_EDIT_LABEL) {
        let Some(entry) = selected_tree_entry(state, view) else {
            return true;
        };
        {
            let mut menu = state.tree_menu.lock().unwrap();
            menu.editing_label = true;
            menu.editing_label_id = Some(entry.id.clone());
        }
        set_search_value(view, entry.label_text.as_deref().unwrap_or_default());
        tui.request_render(false);
        return true;
    }
    // The port's tree is a flat list, so folding has no subtree to hide:
    // upstream falls back to moving the selection when the node is not
    // foldable, which is what these two do here.
    if keybinding_matches(bindings, key, keys::TREE_FOLD_OR_UP) {
        move_tree_selection(view, -1);
        return true;
    }
    if keybinding_matches(bindings, key, keys::TREE_UNFOLD_OR_DOWN) {
        move_tree_selection(view, 1);
        return true;
    }
    false
}

/// Change the tree's filter mode and refresh the rows.
fn set_tree_filter(
    state: &Arc<TuiState>,
    view: &SelectorView,
    tui: &Arc<TuiAltScreen>,
    change: impl FnOnce(&mut TreeFilter),
) {
    {
        let mut menu = state.tree_menu.lock().unwrap();
        change(&mut menu.filter);
    }
    refresh_tree_menu(state, view, tui);
}

/// The tree row the selection points at.
fn selected_tree_entry(state: &Arc<TuiState>, view: &SelectorView) -> Option<TreeMenuEntry> {
    let item = selected_item(view)?;
    let menu = state.tree_menu.lock().unwrap();
    menu.entries
        .iter()
        .find(|entry| entry.id == item.value)
        .cloned()
}

/// Re-apply the tree's filter and rebuild the rows.
fn refresh_tree_menu(
    state: &Arc<TuiState>,
    view: &SelectorView,
    tui: &Arc<TuiAltScreen>,
) {
    let items = {
        let menu = state.tree_menu.lock().unwrap();
        tree_menu_items(&menu.entries, menu.filter, menu.show_label_timestamps)
    };
    refresh_items(view, items);
    tui.request_render(false);
}

/// The tree rows the filter admits.
pub(super) fn tree_menu_items(
    entries: &[TreeMenuEntry],
    filter: TreeFilter,
    show_label_timestamps: bool,
) -> Vec<SelectItem> {
    entries
        .iter()
        .filter(|entry| tree_entry_visible(entry, filter))
        .map(|entry| {
            let description = match (&entry.label_text, show_label_timestamps) {
                (Some(label), true) => match entry.label_timestamp {
                    Some(timestamp) => format!("[{label}] {}", format_label_time(timestamp)),
                    None => format!("[{label}]"),
                },
                (Some(label), false) => format!("[{label}]"),
                (None, _) => entry.description.clone(),
            };
            SelectItem::new(&entry.id, &entry.label)
                .with_description(&description)
                .with_search_text(&entry.search_text)
        })
        .collect()
}

/// Whether a tree entry passes the filter (upstream's `applyFilter`).
fn tree_entry_visible(entry: &TreeMenuEntry, filter: TreeFilter) -> bool {
    // Upstream drops the usage entries in every mode.
    if entry.is_usage {
        return false;
    }
    match filter {
        TreeFilter::Default => !entry.is_settings,
        TreeFilter::NoTools => !entry.is_settings && !entry.is_tool_result,
        TreeFilter::UserOnly => entry.is_user,
        TreeFilter::LabeledOnly => entry.label_text.is_some(),
        TreeFilter::All => true,
    }
}

/// `MM:DD` for a label timestamp (upstream renders the same).
fn format_label_time(timestamp_ms: i64) -> String {
    let seconds = timestamp_ms.div_euclid(1000);
    let minutes = seconds.div_euclid(60);
    let hours = minutes.div_euclid(60) % 24;
    let days = minutes.div_euclid(1440);
    let _ = hours;
    format!("{:02}:{:02}", days % 30, minutes % 60)
}

/// Store the new label on the selected entry (upstream's `updateNodeLabel`).
fn finish_label_edit(
    state: &Arc<TuiState>,
    view: &SelectorView,
    lane: &Arc<dyn AgentLane>,
    tui: &Arc<TuiAltScreen>,
    label: String,
) {
    let entry_id = {
        let mut menu = state.tree_menu.lock().unwrap();
        menu.editing_label = false;
        menu.editing_label_id.take()
    };
    set_search_value(view, "");
    let Some(entry_id) = entry_id else {
        return;
    };
    let lane = lane.clone();
    let chat = state.chat_container.clone();
    let tui_edit = tui.clone();
    tokio::spawn(async move {
        let label = if label.is_empty() { None } else { Some(label) };
        match lane.set_label(&entry_id, label.as_deref()).await {
            Ok(()) => {
                add_note_message(&chat, "Label updated.");
            }
            Err(error) => {
                add_error_message(&chat, &format!("Could not set label: {error}"));
            }
        }
        tui_edit.request_render(false);
    });
}

/// Move the tree selection by `delta` rows.
fn move_tree_selection(view: &SelectorView, delta: i64) {
    let index = selected_index(view) as i64;
    let next = (index + delta).max(0) as usize;
    match view {
        SelectorView::List(list) => list.set_selected_index(next),
        SelectorView::Searchable(searchable) => searchable.list().set_selected_index(next),
        SelectorView::Settings(_) => {}
        SelectorView::Trust(_) => {}
    }
}

// ===========================================================================
// Scoped models selector — app.models.*
// ===========================================================================

/// The scoped-models selector's own keybindings (upstream's
/// `ScopedModelsSelectorComponent`).
fn models_key(
    state: &Arc<TuiState>,
    bindings: &rpi_tui::Keybindings,
    key: &crossterm::event::KeyEvent,
    view: &SelectorView,
    catalog: &Arc<std::sync::RwLock<Vec<rpi_ai::Model>>>,
    tui: &Arc<TuiAltScreen>,
) -> bool {
    let catalog = catalog
        .read()
        .unwrap_or_else(|error| error.into_inner())
        .clone();
    if keybinding_matches(bindings, key, keys::MODELS_SAVE) {
        save_scoped_models(state, tui);
        return true;
    }
    if keybinding_matches(bindings, key, keys::MODELS_ENABLE_ALL) {
        let all: Vec<String> = catalog.iter().map(|model| model.id.clone()).collect();
        *state.scoped_edit.lock().unwrap() = Some(all);
        tui.request_render(false);
        return true;
    }
    if keybinding_matches(bindings, key, keys::MODELS_CLEAR_ALL) {
        *state.scoped_edit.lock().unwrap() = Some(Vec::new());
        tui.request_render(false);
        return true;
    }
    if keybinding_matches(bindings, key, keys::MODELS_TOGGLE_PROVIDER) {
        let Some(item) = selected_item(view) else {
            return true;
        };
        let Some(provider) = catalog
            .iter()
            .find(|model| model.id == item.value)
            .map(|model| model.provider.clone())
        else {
            return true;
        };
        let provider_ids: Vec<String> = catalog
            .iter()
            .filter(|model| model.provider == provider)
            .map(|model| model.id.clone())
            .collect();
        let mut edit = state.scoped_edit.lock().unwrap();
        let set = edit.get_or_insert_with(Vec::new);
        let enabled = provider_ids.iter().all(|id| set.iter().any(|s| s == id));
        if enabled {
            set.retain(|id| !provider_ids.iter().any(|other| other == id));
        } else {
            for id in &provider_ids {
                if !set.iter().any(|other| other == id) {
                    set.push(id.clone());
                }
            }
        }
        drop(edit);
        tui.request_render(false);
        return true;
    }
    let up = keybinding_matches(bindings, key, keys::MODELS_REORDER_UP);
    let down = keybinding_matches(bindings, key, keys::MODELS_REORDER_DOWN);
    if up || down {
        let Some(item) = selected_item(view) else {
            return true;
        };
        let mut edit = state.scoped_edit.lock().unwrap();
        if let Some(set) = edit.as_mut() {
            if let Some(position) = set.iter().position(|id| id == &item.value) {
                let target = if up {
                    position.checked_sub(1)
                } else if position + 1 < set.len() {
                    Some(position + 1)
                } else {
                    None
                };
                if let Some(target) = target {
                    set.swap(position, target);
                }
            }
        }
        drop(edit);
        tui.request_render(false);
        return true;
    }
    false
}

/// Persist the cycle scope to the settings (upstream's `onPersist`).
fn save_scoped_models(state: &Arc<TuiState>, tui: &Arc<TuiAltScreen>) {
    let set = state.scoped_edit.lock().unwrap().clone().unwrap_or_default();
    let mut settings = crate::settings::load_settings().unwrap_or_default();
    settings.scoped_models = if set.is_empty() { None } else { Some(set.clone()) };
    match crate::settings::save_settings(&settings) {
        Ok(()) => add_note_message(&state.chat_container, "Model selection saved to settings"),
        Err(error) => add_error_message(
            &state.chat_container,
            &format!("Could not save settings: {error}"),
        ),
    }
    tui.request_render(false);
}

// ===========================================================================
// Thinking selector — app.thinking.save
// ===========================================================================

/// The thinking selector's own keybindings (upstream's
/// `ThinkingSelectorComponent`).
fn thinking_key(
    state: &Arc<TuiState>,
    bindings: &rpi_tui::Keybindings,
    key: &crossterm::event::KeyEvent,
    view: &SelectorView,
    tui: &Arc<TuiAltScreen>,
) -> bool {
    if keybinding_matches(bindings, key, keys::THINKING_SAVE) {
        let Some(item) = selected_item(view) else {
            return true;
        };
        let mut settings = crate::settings::load_settings().unwrap_or_default();
        settings.default_thinking_level = Some(item.value.clone());
        match crate::settings::save_settings(&settings) {
            Ok(()) => add_note_message(
                &state.chat_container,
                &format!("Default thinking level: {}", item.label),
            ),
            Err(error) => add_error_message(
                &state.chat_container,
                &format!("Could not save settings: {error}"),
            ),
        }
        tui.request_render(false);
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::interactive_tui::tests::test_tui_state;

    fn test_tui() -> Arc<TuiAltScreen> {
        Arc::new(TuiAltScreen::new(
            Box::new(ProcessTerminal::new()),
            true,
            None,
        ))
    }

    fn open(state: &Arc<TuiState>, kind: SelectorKind, items: Vec<SelectItem>) -> SelectorView {
        let view = SelectorView::List(Arc::new(SelectList::new(items, 10)));
        *state.active_selector.lock().unwrap() = Some((view.clone(), kind));
        view
    }

    fn model(id: &str, provider: &str) -> rpi_ai::Model {
        rpi_ai::Model::new(
            id,
            id,
            rpi_ai::types::Api::AnthropicMessages,
            provider,
            "https://example.invalid",
        )
    }

    /// The session menu's own ids reach the session menu's own actions.
    #[tokio::test]
    async fn session_menu_keys_reach_the_session_actions() {
        let state = test_tui_state();
        let tui = test_tui();
        let harness = AgentHarness::create(Default::default()).await.unwrap();
        let lane: Arc<dyn AgentLane> = harness.lane("main");
        let catalog = Arc::new(std::sync::RwLock::new(Vec::new()));
        let bindings = rpi_tui::Keybindings::new();
        let _view = open(
            &state,
            SelectorKind::Session,
            vec![SelectItem::new("s1", "Session one")],
        );

        // `app.session.toggleSort` (Ctrl+S) flips the sort mode.
        let key = KeyEvent::new(KeyCode::Char('s'), KeyModifiers::CONTROL);
        assert!(handle_selector_key(
            &state,
            &bindings,
            &key,
            &lane,
            &catalog,
            &tui
        ));
        assert_eq!(state.session_menu.lock().unwrap().sort, SessionSort::Oldest);

        // `app.session.togglePath` (Ctrl+P) flips the path column.
        let key = KeyEvent::new(KeyCode::Char('p'), KeyModifiers::CONTROL);
        assert!(handle_selector_key(
            &state,
            &bindings,
            &key,
            &lane,
            &catalog,
            &tui
        ));
        assert!(state.session_menu.lock().unwrap().show_path);

        // `app.session.toggleNamedFilter` (Ctrl+N) flips the named filter.
        let key = KeyEvent::new(KeyCode::Char('n'), KeyModifiers::CONTROL);
        assert!(handle_selector_key(
            &state,
            &bindings,
            &key,
            &lane,
            &catalog,
            &tui
        ));
        assert!(state.session_menu.lock().unwrap().named_only);
    }

    /// The tree selector's filter ids reach the tree filter.
    #[tokio::test]
    async fn tree_filter_keys_reach_the_tree_filter() {
        let state = test_tui_state();
        let tui = test_tui();
        let harness = AgentHarness::create(Default::default()).await.unwrap();
        let lane: Arc<dyn AgentLane> = harness.lane("main");
        let catalog = Arc::new(std::sync::RwLock::new(Vec::new()));
        let bindings = rpi_tui::Keybindings::new();
        {
            let mut menu = state.tree_menu.lock().unwrap();
            menu.entries = vec![
                TreeMenuEntry {
                    id: "e1".into(),
                    label: "message #1".into(),
                    description: "e1".into(),
                    search_text: "message 1 e1".into(),
                    label_text: None,
                    label_timestamp: None,
                    is_user: true,
                    is_tool_result: false,
                    is_settings: false,
                    is_usage: false,
                },
                TreeMenuEntry {
                    id: "e2".into(),
                    label: "message #2".into(),
                    description: "e2".into(),
                    search_text: "message 2 e2".into(),
                    label_text: None,
                    label_timestamp: None,
                    is_user: false,
                    is_tool_result: true,
                    is_settings: false,
                    is_usage: false,
                },
            ];
        }
        let _view = open(
            &state,
            SelectorKind::Tree,
            vec![SelectItem::new("e1", "message #1"), SelectItem::new("e2", "message #2")],
        );

        // `app.tree.filter.noTools` (Ctrl+T) hides the tool results.
        let key = KeyEvent::new(KeyCode::Char('t'), KeyModifiers::CONTROL);
        assert!(handle_selector_key(
            &state,
            &bindings,
            &key,
            &lane,
            &catalog,
            &tui
        ));
        assert_eq!(
            state.tree_menu.lock().unwrap().filter,
            TreeFilter::NoTools
        );

        // `app.tree.filter.cycleForward` (Ctrl+O) moves on to the next mode.
        let key = KeyEvent::new(KeyCode::Char('o'), KeyModifiers::CONTROL);
        assert!(handle_selector_key(
            &state,
            &bindings,
            &key,
            &lane,
            &catalog,
            &tui
        ));
        assert_eq!(
            state.tree_menu.lock().unwrap().filter,
            TreeFilter::UserOnly
        );

        // `app.tree.filter.default` (Ctrl+D) goes back to the default view.
        let key = KeyEvent::new(KeyCode::Char('d'), KeyModifiers::CONTROL);
        assert!(handle_selector_key(
            &state,
            &bindings,
            &key,
            &lane,
            &catalog,
            &tui
        ));
        assert_eq!(
            state.tree_menu.lock().unwrap().filter,
            TreeFilter::Default
        );
    }

    /// The scoped-models ids reach the cycle scope.
    #[tokio::test]
    async fn models_keys_reach_the_cycle_scope() {
        let state = test_tui_state();
        let tui = test_tui();
        let harness = AgentHarness::create(Default::default()).await.unwrap();
        let lane: Arc<dyn AgentLane> = harness.lane("main");
        let catalog = Arc::new(std::sync::RwLock::new(vec![
            model("m1", "alpha"),
            model("m2", "alpha"),
            model("m3", "beta"),
        ]));
        let bindings = rpi_tui::Keybindings::new();
        let _view = open(
            &state,
            SelectorKind::ScopedModels,
            vec![
                SelectItem::new("m1", "m1"),
                SelectItem::new("m2", "m2"),
                SelectItem::new("m3", "m3"),
            ],
        );

        // `app.models.enableAll` (Ctrl+A) enables every model.
        let key = KeyEvent::new(KeyCode::Char('a'), KeyModifiers::CONTROL);
        assert!(handle_selector_key(
            &state,
            &bindings,
            &key,
            &lane,
            &catalog,
            &tui
        ));
        assert_eq!(
            state.scoped_edit.lock().unwrap().clone(),
            Some(vec!["m1".to_string(), "m2".to_string(), "m3".to_string()])
        );

        // `app.models.clearAll` (Ctrl+X) clears the scope.
        let key = KeyEvent::new(KeyCode::Char('x'), KeyModifiers::CONTROL);
        assert!(handle_selector_key(
            &state,
            &bindings,
            &key,
            &lane,
            &catalog,
            &tui
        ));
        assert_eq!(
            state.scoped_edit.lock().unwrap().clone(),
            Some(Vec::new())
        );

        // `app.models.toggleProvider` (Ctrl+P) toggles the selected model's
        // provider — the first row is an `alpha` model.
        let key = KeyEvent::new(KeyCode::Char('p'), KeyModifiers::CONTROL);
        assert!(handle_selector_key(
            &state,
            &bindings,
            &key,
            &lane,
            &catalog,
            &tui
        ));
        assert_eq!(
            state.scoped_edit.lock().unwrap().clone(),
            Some(vec!["m1".to_string(), "m2".to_string()])
        );

        // `app.models.reorderDown` (Alt+Down) moves the selected model down.
        let key = KeyEvent::new(KeyCode::Down, KeyModifiers::ALT);
        assert!(handle_selector_key(
            &state,
            &bindings,
            &key,
            &lane,
            &catalog,
            &tui
        ));
        assert_eq!(
            state.scoped_edit.lock().unwrap().clone(),
            Some(vec!["m2".to_string(), "m1".to_string()])
        );
    }
}
