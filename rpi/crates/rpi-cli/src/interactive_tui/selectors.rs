//! Editor-swapping selectors for models, sessions, themes, thinking, tools, and images.

use super::*;
use crate::credentials::ProviderAuthType;

// ===========================================================================
// Selectors — editor-container swap (TS showSelector pattern)
// ===========================================================================

/// Swap the `editor_container`'s child (the editor) for a `SelectList`,
/// hiding the editor while the selector is open. Records the selector in
/// `state.active_selector` so the key loop routes to it.
pub(super) fn open_selector(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    list: Arc<SelectList>,
    kind: SelectorKind,
) {
    open_selector_with_view(
        state,
        editor_container,
        editor,
        tui,
        SelectorView::List(list.clone()),
        list,
        kind,
    );
}

/// Open a searchable selector: the list plus a fuzzy-filter search box.
///
/// Returns the wrapper so callers can prefill the query (upstream's
/// `initialSearchInput`). Mirrors `SelectSubmenu` with `searchable: true`.
pub(super) fn open_searchable_selector(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    title: Option<&str>,
    description: Option<&str>,
    list: Arc<SelectList>,
    kind: SelectorKind,
) -> Arc<SearchableSelectList> {
    let searchable = Arc::new(SearchableSelectList::new(title, description, list));
    open_selector_with_view(
        state,
        editor_container,
        editor,
        tui,
        SelectorView::Searchable(searchable.clone()),
        searchable.clone(),
        kind,
    );
    // `TuiAltScreen::set_focus` only records the focused component; components
    // manage their own focus flag. Without this the search caret never renders
    // (and IME candidate positioning stays on the editor's old caret).
    searchable.set_focused(true);
    searchable
}

/// Open a selector that follows pi's menu framework
/// (`packages/tui/src/components/menu.ts`): the title, the search field, the
/// list, the footer and the hint.
pub(super) fn open_menu_selector(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    title: &str,
    list: Arc<SelectList>,
    kind: SelectorKind,
) -> Arc<SearchableSelectList> {
    let searchable = Arc::new(
        SearchableSelectList::new(Some(title), None, list).with_menu_layout(),
    );
    open_selector_with_view(
        state,
        editor_container,
        editor,
        tui,
        SelectorView::Searchable(searchable.clone()),
        searchable.clone(),
        kind,
    );
    searchable.set_focused(true);
    searchable
}

/// Give the pane to the transcript when the 3-D empty-session screen owns it.
///
/// The screen takes the whole layout root while the session is empty, so
/// anything that shows itself in the transcript — a selector, or a note about
/// an empty list — has to take the pane over first, or it is drawn behind the
/// logo.
pub(super) fn take_pane_from_empty_session(tui: &Arc<TuiAltScreen>) {
    if super::EMPTY_SESSION_ACTIVE.load(std::sync::atomic::Ordering::SeqCst) {
        super::EMPTY_SESSION_ACTIVE.store(false, std::sync::atomic::Ordering::SeqCst);
        if let Some(root) = super::NORMAL_ROOT.lock().unwrap().clone() {
            tui.set_layout_root(Some(root));
        }
    }
}

/// Open a selector with an optional framed view. Native extension selectors
/// wrap the list with a title and hint while built-in selectors keep the list
/// as the complete view.
///
/// `view_router` receives keys (a bare list, or a searchable wrapper) while
/// `view` is what renders — the two are the same object for every built-in
/// selector, but extension selectors frame a plain list.
pub(super) fn open_selector_with_view<V: Component + 'static>(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    view_router: SelectorView,
    view: Arc<V>,
    kind: SelectorKind,
) {
    // The 3-D empty-session screen owns the whole pane; a selector takes it
    // over, the way the original's startup screen gives the pane up.
    take_pane_from_empty_session(tui);

    // Dispatch ui_prompt_start event
    dispatch_ui_prompt_event(state);

    // Unfocus the editor so its cursor marker doesn't render behind the list.
    editor.set_focused(false);
    // A selector replaces the editor slot. Drop stale slash/@file
    // suggestions so they cannot reappear after the selector closes.
    state.autocomplete_container.clear();
    // Swap: clear the container and add the selector view.
    editor_container.clear();
    editor_container.add_child(view.clone());
    *state.active_selector.lock().unwrap() = Some((view_router, kind));
    let focused: Arc<dyn Component> = view;
    tui.set_focus(Some(focused));
    tui.request_render(false);
}

/// Restore the editor into the `editor_container` and clear the active
/// selector. Called by selector `on_cancel` and the Esc handler.
pub(super) fn close_selector(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
) {
    // Dispatch ui_prompt_end event
    dispatch_ui_prompt_event_end(state);

    editor_container.clear();
    editor_container.add_child(editor.clone());
    state.autocomplete_container.clear();
    editor.set_focused(true);
    *state.active_selector.lock().unwrap() = None;
    *state.active_extension_cancel.lock().unwrap() = None;
    tui.set_focus(Some(editor.clone()));
    tui.request_render(false);
}

/// Build + open the `/model` selector. Items are the resolved catalog (display
/// label = model name; description = id), with the current model marked.
/// Selecting applies the model **live** via `lane.set_model` (takes effect on
/// the next user message — the in-flight run's config is already snapshotted),
/// updates the footer, and notes the next-prompt effect.
pub(super) fn open_model_selector(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    catalog: &[rpi_ai::Model],
    lane: &Arc<dyn AgentLane>,
    lane_model_id: &str,
    chat: &Arc<Container>,
    initial_search: Option<&str>,
    has_scoped_models: bool,
) -> Option<Arc<SearchableSelectList>> {
    let default_model = crate::settings::load_settings()
        .ok()
        .and_then(|settings| settings.default_model);
    let items = model_selector_items(catalog, lane_model_id, default_model.as_deref());
    if items.is_empty() {
        add_note_message(chat, &crate::auth_guidance::no_models_available_message());
        tui.request_render(false);
        return None;
    }
    let list = Arc::new(SelectList::new(items, 10));

    // Capture the catalog + lane so the on_select closure can resolve the
    // chosen Model and apply it. `on_select` fires on the blocking key thread,
    // so the async `set_model` runs on a spawned task (matches Ctrl+P).
    let catalog_arc = catalog.to_vec();
    let state_sel = state.clone();
    let ec_sel = editor_container.clone();
    let editor_sel = editor.clone();
    let tui_sel = tui.clone();
    let chat_sel = chat.clone();
    let lane_sel = lane.clone();
    list.on_select(Arc::new(move |item| {
        let Some(model) = find_model_selector_match(&catalog_arc, &item.value) else {
            add_note_message(
                &chat_sel,
                &format!("Model {} not found in catalog.", item.label),
            );
            close_selector(&state_sel, &ec_sel, &editor_sel, &tui_sel);
            return;
        };

        let lane = lane_sel.clone();
        let state = state_sel.clone();
        let tui = tui_sel.clone();
        tokio::spawn(async move {
            report_model_selection(&lane, &state, &tui, model, false).await;
        });
        close_selector(&state_sel, &ec_sel, &editor_sel, &tui_sel);
    }));
    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    list.on_cancel(Arc::new(move || {
        close_selector(&state_cancel, &ec_cancel, &editor_cancel, &tui_cancel);
    }));

    // The line above the list: the scope when scoped models exist, otherwise
    // the hint about the configured providers
    // (`components/model-selector.ts:87-95`).
    let title = if has_scoped_models {
        "Scope: all | scoped"
    } else {
        "Only showing models from configured providers. Use /login to add providers."
    };
    let searchable = open_menu_selector(
        state,
        editor_container,
        editor,
        tui,
        title,
        list,
        SelectorKind::Model,
    );
    // The line under the list: the refresh status
    // (`components/model-selector.ts:96-108`).
    searchable.set_footer_text(Some("Model catalogs refreshed.".to_string()));
    // The hint line (`components/model-selector.ts:110-116`).
    searchable.set_hint(Some(
        [
            format!("{} to select", rpi_tui::key_display_text("tui.select.confirm")),
            format!(
                "{} to set as default",
                rpi_tui::key_display_text("app.models.save")
            ),
            format!("{} to cancel", rpi_tui::key_display_text("tui.select.cancel")),
        ]
        .join(" · "),
    ));
    if let Some(term) = initial_search {
        searchable.set_search_text(term);
    }
    Some(searchable)
}

/// Resolve a hot-cycle against the live lane, including authenticated models
/// from other providers. Keep the actual current model when it is off-scope.
pub(super) async fn cycle_model(
    lane: &Arc<dyn AgentLane>,
    catalog: &[rpi_ai::Model],
    backwards: bool,
) -> Result<Option<rpi_ai::Model>, String> {
    if catalog.is_empty() {
        return Ok(None);
    }
    let current = lane.get_model().await.map_err(|error| error.to_string())?;
    let scope = scoped_catalog(catalog, &current);
    Ok(if backwards {
        cycle_prev_model(&scope, &current)
    } else {
        cycle_next_model(&scope, &current)
    })
}

/// Commit UI/default changes only after the live lane accepts the model.
pub(super) async fn apply_model_selection(
    lane: &Arc<dyn AgentLane>,
    state: &Arc<TuiState>,
    model: rpi_ai::Model,
    save_default: bool,
) -> Result<String, String> {
    let current = lane.get_model().await.map_err(|error| error.to_string())?;
    lane.set_model(model.clone())
        .await
        .map_err(|error| format!("Could not switch model: {error}"))?;
    state.set_current_model(&model);
    let mut note = format!(
        "Model set to {}/{} — applies to the next message.",
        model.provider, model.id
    );
    if save_default || current.provider != model.provider {
        match set_default_model(&model.provider, &model.id) {
            Ok(_) => note.push_str(" Default saved."),
            Err(error) => note.push_str(&format!(" Could not save the default: {error}")),
        }
    }
    Ok(note)
}

pub(super) async fn report_model_selection(
    lane: &Arc<dyn AgentLane>,
    state: &Arc<TuiState>,
    tui: &Arc<TuiAltScreen>,
    model: rpi_ai::Model,
    save_default: bool,
) {
    match apply_model_selection(lane, state, model, save_default).await {
        Ok(note) => add_note_message(&state.chat_container, &note),
        Err(error) => add_error_message(&state.chat_container, &error),
    }
    tui.request_render(false);
}

/// Cycle after the current provider/API/model identity, wrapping to the first.
/// An empty catalog returns `None`; a missing anchor returns the first entry.
pub(super) fn cycle_next_model(
    catalog: &[rpi_ai::Model],
    current: &rpi_ai::Model,
) -> Option<rpi_ai::Model> {
    if catalog.is_empty() {
        return None;
    }
    let idx = catalog.iter().position(|m| {
        m.provider == current.provider
            && m.api == current.api
            && m.id.eq_ignore_ascii_case(&current.id)
    });
    match idx {
        Some(i) => {
            let next = (i + 1) % catalog.len();
            Some(catalog[next].clone())
        }
        None => Some(catalog[0].clone()),
    }
}

/// Cycle before the current provider/API/model identity, wrapping to the last —
/// the mirror of [`cycle_next_model`] for the previous-model hotkey.
pub(super) fn cycle_prev_model(
    catalog: &[rpi_ai::Model],
    current: &rpi_ai::Model,
) -> Option<rpi_ai::Model> {
    if catalog.is_empty() {
        return None;
    }
    let idx = catalog.iter().position(|m| {
        m.provider == current.provider
            && m.api == current.api
            && m.id.eq_ignore_ascii_case(&current.id)
    });
    match idx {
        Some(i) => {
            let prev = (i + catalog.len() - 1) % catalog.len();
            Some(catalog[prev].clone())
        }
        None => Some(catalog[0].clone()),
    }
}

/// Build + open the `/session` selector. Lists JSONL session files under the
/// default session dir (`<cwd>/.rpi/sessions`
/// fallback), newest-first, labelled with the session name or first prompt so
/// two sessions are distinguishable. Header-only sessions are skipped: there is
/// nothing to switch to.
pub(super) fn open_session_selector(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    cwd: &std::path::Path,
    tx: &mpsc::UnboundedSender<TuiMessage>,
) {
    let dir = crate::session::default_session_dir(cwd);
    let items = {
        let mut menu = state.session_menu.lock().unwrap();
        menu.dir = dir.clone();
        let entries = session_menu_entries(&dir, &menu);
        // The titles of the rows the list shows.
        resolve_entry_titles(&entries, 0..SESSION_MENU_ROWS);
        let items = session_menu_items(&entries, menu.show_path);
        menu.entries = entries;
        items
    };
    if items.is_empty() {
        take_pane_from_empty_session(tui);
        add_note_message(
            &state.chat_container,
            "No saved sessions found. Sessions are created automatically in interactive mode.",
        );
        tui.request_render(false);
        return;
    }
    let mut list = SelectList::new(items, 10);
    list.set_layout(rpi_tui::SelectListLayoutOptions {
        min_primary_column_width: Some(56),
        max_primary_column_width: Some(72),
        truncate_primary: None,
    });
    let list = Arc::new(list);

    let state_sel = state.clone();
    let ec_sel = editor_container.clone();
    let editor_sel = editor.clone();
    let tui_sel = tui.clone();
    let tx_sel = tx.clone();
    list.on_select(Arc::new(move |item| {
        // Close the selector first, then ask the async loop to hot-switch:
        // opening the session file + swapping the harness backing is async
        // (repo list/open) and must not run on the blocking key thread.
        close_selector(&state_sel, &ec_sel, &editor_sel, &tui_sel);
        let _ = tx_sel.send(TuiMessage::SwitchSession(item.value.clone()));
    }));
    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    list.on_cancel(Arc::new(move || {
        close_selector(&state_cancel, &ec_cancel, &editor_cancel, &tui_cancel);
    }));

    open_searchable_selector(
        state,
        editor_container,
        editor,
        tui,
        Some("Resume session"),
        Some("Type to filter sessions"),
        list,
        SelectorKind::Session,
    );
}

pub(super) fn custom_entry_display_text(
    custom_type: &str,
    data: Option<&serde_json::Value>,
) -> Option<String> {
    let data = data?;
    let text = data
        .get("summary")
        .or_else(|| data.get("text"))
        .or_else(|| data.get("output"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())?;
    let label = match custom_type {
        "compactionSummary" => "Compaction summary",
        "branchSummary" => "Branch summary",
        "bashExecution" => "Command output",
        other => other,
    };
    Some(format!("{label}: {text}"))
}

/// Open a selector for the current session's persisted entry tree. Selecting a
/// message moves the main lane leaf to that entry, then the caller reloads the
/// visible branch from durable storage.
pub(super) async fn open_tree_selector(
    harness: &AgentHarness,
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    chat: &Arc<Container>,
    tx: &mpsc::UnboundedSender<TuiMessage>,
) {
    let entries = match harness
        .session()
        .view("main")
        .find_entries(&EntryQuery {
            order: Some(EntryOrder::OldestFirst),
            ..Default::default()
        })
        .await
    {
        Ok(entries) => entries,
        Err(error) => {
            take_pane_from_empty_session(tui);
            add_error_message(chat, &format!("Could not read session tree: {error}"));
            tui.request_render(false);
            return;
        }
    };
    let current = harness.session().get_leaf_id().await.ok().flatten();
    let mut menu_entries: Vec<TreeMenuEntry> = Vec::new();
    for entry in &entries {
        let label = if current.as_deref() == Some(entry.id()) {
            format!("{} #{} (current)", entry.entry_type(), entry.seq())
        } else {
            format!("{} #{}", entry.entry_type(), entry.seq())
        };
        let short_id = &entry.id()[..entry.id().len().min(12)];
        // Search on the entry type, sequence, and id so `/tree` stays
        // usable in long sessions.
        let search_text = format!("{} {} {}", entry.entry_type(), entry.seq(), entry.id());
        let role = entry.message_role();
        let label_text = harness.session().get_label(entry.id()).await.ok().flatten();
        menu_entries.push(TreeMenuEntry {
            id: entry.id().to_string(),
            label,
            description: short_id.to_string(),
            search_text,
            label_timestamp: label_text.as_ref().map(|_| entry.base().timestamp),
            label_text,
            is_user: matches!(role, Some(rpi_agent::message::AgentMessageRole::User)),
            is_tool_result: matches!(
                role,
                Some(rpi_agent::message::AgentMessageRole::ToolResult)
            ),
            // Upstream's `isSettingsEntry`: the entries the default view hides.
            is_settings: matches!(
                entry.entry_type(),
                "label"
                    | "context_edit"
                    | "custom"
                    | "model_change"
                    | "thinking_level_change"
                    | "session_info"
            ),
            is_usage: entry.entry_type() == "usage",
        });
    }
    let items = {
        let mut menu = state.tree_menu.lock().unwrap();
        menu.entries = menu_entries;
        // `treeFilterMode`: the filter `/tree` opens with (upstream's
        // `interactive-mode.ts:5466`).
        menu.filter = TreeFilter::from_setting(
            &crate::settings::load_settings()
                .ok()
                .map(|settings| settings.tree_filter_mode().to_string())
                .unwrap_or_else(|| "default".to_string()),
        );
        tree_menu_items(&menu.entries, menu.filter, menu.show_label_timestamps)
    };
    if items.is_empty() {
        take_pane_from_empty_session(tui);
        add_note_message(chat, "The current session has no entries to navigate.");
        tui.request_render(false);
        return;
    }
    let list = Arc::new(SelectList::new(items, 12));
    let state_sel = state.clone();
    let ec_sel = editor_container.clone();
    let editor_sel = editor.clone();
    let tui_sel = tui.clone();
    let tx_sel = tx.clone();
    list.on_select(Arc::new(move |item| {
        let _ = tx_sel.send(TuiMessage::NavigateTree(item.value.clone()));
        close_selector(&state_sel, &ec_sel, &editor_sel, &tui_sel);
    }));
    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    list.on_cancel(Arc::new(move || {
        close_selector(&state_cancel, &ec_cancel, &editor_cancel, &tui_cancel);
    }));
    open_searchable_selector(
        state,
        editor_container,
        editor,
        tui,
        Some("Session tree"),
        Some("Type to filter by entry type, sequence, or id"),
        list,
        SelectorKind::Tree,
    );
}

/// The themes the `/theme` picker offers: the system theme first, then the
/// presets by name (the original's `getAvailableThemes` order).
fn theme_selector_names() -> Vec<&'static str> {
    let mut names = vec!["system"];
    names.extend(super::settings_menu::available_theme_names());
    names
}

/// The rows of the `/theme` picker: the theme names, with the current one
/// marked (the original's `name === current ? "(current)" : undefined`).
fn theme_selector_items(current: &str) -> Vec<SelectItem> {
    theme_selector_names()
        .into_iter()
        .map(|name| {
            let item = SelectItem::new(name, name);
            if name == current {
                item.with_description("(current)")
            } else {
                item
            }
        })
        .collect()
}

/// The theme the app runs with, from the saved setting. The system theme is
/// the default (the original's `getThemeSelection() || SYSTEM_THEME_NAME`).
fn current_theme_name() -> String {
    let saved = crate::settings::load_settings()
        .ok()
        .and_then(|settings| settings.theme)
        .unwrap_or_default();
    if theme_selector_names().contains(&saved.as_str()) {
        saved
    } else {
        "system".to_string()
    }
}

/// Apply a theme by name: a preset, or the system theme, which follows the
/// terminal's light/dark appearance.
fn apply_theme_by_name(state: &Arc<TuiState>, name: &str) {
    let preset = match name {
        "light" => Some(ThemePreset::Light),
        "monochrome" => Some(ThemePreset::Monochrome),
        "dark" => Some(ThemePreset::Dark),
        _ => None,
    };
    match preset {
        Some(preset) => {
            apply_theme_preset(preset);
            state.theme_manager.apply_preset(preset);
        }
        None => {
            state.theme_manager.follow_terminal();
            rpi_tui::global_theme_manager().follow_terminal();
        }
    }
}

/// Build + open the `/theme` selector.
///
/// The original's `showThemeSelector` (`interactive-mode.ts:5631-5663`): a
/// menu titled "Theme" that lists the available themes with the current one
/// marked, previews the theme under the cursor, saves the choice when it is
/// confirmed, and restores the previous theme when it is cancelled.
pub(super) fn open_theme_selector(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
) {
    let current = current_theme_name();
    let items = theme_selector_items(&current);
    let list = Arc::new(SelectList::new(items, 10));

    let preview_state = state.clone();
    list.on_selection_change(Arc::new(move |item: &SelectItem| {
        apply_theme_by_name(&preview_state, &item.value);
    }));

    let state_sel = state.clone();
    let ec_sel = editor_container.clone();
    let editor_sel = editor.clone();
    let tui_sel = tui.clone();
    list.on_select(Arc::new(move |item| {
        apply_theme_by_name(&state_sel, &item.value);
        let mut settings = crate::settings::load_settings().unwrap_or_default();
        settings.theme = Some(item.value.clone());
        let _ = crate::settings::save_settings(&settings);
        close_selector(&state_sel, &ec_sel, &editor_sel, &tui_sel);
        tui_sel.render_now(true);
    }));
    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    list.on_cancel(Arc::new(move || {
        // The preview is undone on cancel: the theme that was active when the
        // picker opened comes back.
        apply_theme_by_name(&state_cancel, &current);
        close_selector(&state_cancel, &ec_cancel, &editor_cancel, &tui_cancel);
        tui_cancel.render_now(true);
    }));

    let menu = open_menu_selector(
        state,
        editor_container,
        editor,
        tui,
        "Theme",
        list,
        SelectorKind::Theme,
    );
    menu.set_hint(Some(
        [
            "Type to search".to_string(),
            format!("{} select", rpi_tui::key_display_text("tui.select.confirm")),
            format!("{} cancel", rpi_tui::key_display_text("tui.select.cancel")),
        ]
        .join(" · "),
    ));
}

/// Sentinel value for the "Add new provider" row in the `/provider` picker.
const ADD_PROVIDER_VALUE: &str = "__add_provider__";
/// Sentinel value for the "Remove provider" row in the `/provider` picker.
const REMOVE_PROVIDER_VALUE: &str = "__remove_provider__";

/// Pick a provider for the current session; the async loop applies and saves it.
pub(super) fn open_provider_selector(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    extension_session: &crate::session::ExtensionSessionCell,
    tx: &mpsc::UnboundedSender<TuiMessage>,
    current_provider: Option<&str>,
) {
    let mut items = provider_selector_items(
        &current_provider_manifests(extension_session),
        current_provider,
    );
    if items.is_empty() {
        add_note_message(
            &state.chat_container,
            "No providers available. Use \"Add new provider\" to configure one in ~/.rpi/agent/models.json.",
        );
        tui.request_render(false);
        return;
    }
    // The trailing actions turn the picker into a small management surface.
    items.push(
        SelectItem::new(ADD_PROVIDER_VALUE, "＋ Add new provider")
            .with_description("Interactive form → writes ~/.rpi/agent/models.json")
            .with_search_text("add new provider"),
    );
    items.push(
        SelectItem::new(REMOVE_PROVIDER_VALUE, "− Remove provider configuration")
            .with_description("Delete a models.json provider")
            .with_search_text("remove delete provider"),
    );
    let list = Arc::new(SelectList::new(items, 10));

    let state_sel = state.clone();
    let ec_sel = editor_container.clone();
    let editor_sel = editor.clone();
    let tui_sel = tui.clone();
    let tx_sel = tx.clone();
    list.on_select(Arc::new(move |item| {
        if item.value == ADD_PROVIDER_VALUE {
            close_selector(&state_sel, &ec_sel, &editor_sel, &tui_sel);
            begin_provider_form(&state_sel, &ec_sel, &editor_sel, &tui_sel);
            return;
        }
        if item.value == REMOVE_PROVIDER_VALUE {
            close_selector(&state_sel, &ec_sel, &editor_sel, &tui_sel);
            open_provider_remove_selector(&state_sel, &ec_sel, &editor_sel, &tui_sel);
            return;
        }
        let _ = tx_sel.send(TuiMessage::SwitchProvider(item.value.clone()));
        close_selector(&state_sel, &ec_sel, &editor_sel, &tui_sel);
    }));
    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    list.on_cancel(Arc::new(move || {
        close_selector(&state_cancel, &ec_cancel, &editor_cancel, &tui_cancel);
    }));

    // Searchable like `/model` so the selector carries a title, a filter box,
    // and the Enter/Esc affordances instead of a bare list.
    open_searchable_selector(
        state,
        editor_container,
        editor,
        tui,
        Some("Select provider"),
        Some("Type to filter providers · Enter selects · Esc cancels"),
        list,
        SelectorKind::Provider,
    );
}

/// The `/login` method screen — the first screen pi's `/login` shows.
///
/// Mirrors `showLoginAuthTypeSelector`
/// (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:5878`):
/// the title, one row per login method, and the Radius row with its status
/// suffix. `provider_options` narrows the screen to one provider, the way
/// `/login <provider>` does.
pub(super) fn open_login_method_selector(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    extension_session: &crate::session::ExtensionSessionCell,
    tx: &mpsc::UnboundedSender<TuiMessage>,
    provider_options: Option<Vec<LoginProviderOption>>,
) {
    let narrowed = provider_options.is_some();
    let options = match provider_options {
        Some(options) => options,
        None => {
            let manifests = current_provider_manifests(extension_session);
            let oauth_providers = current_oauth_providers(extension_session);
            login_provider_options(&manifests, &oauth_providers)
        }
    };

    let title = match (narrowed, options.first()) {
        (true, Some(option)) => format!("Select authentication method for {}:", option.name),
        _ => "Select authentication method:".to_string(),
    };

    let mut items: Vec<SelectItem> = Vec::new();
    if options
        .iter()
        .any(|option| option.auth_type == ProviderAuthType::OAuth)
    {
        items.push(SelectItem::new(
            OAUTH_LOGIN_METHOD,
            "Sign in with an account",
        ));
    }
    if options
        .iter()
        .any(|option| option.auth_type == ProviderAuthType::ApiKey)
    {
        items.push(SelectItem::new(
            API_KEY_LOGIN_METHOD,
            "Sign in with an API key",
        ));
    }
    // The top-level screen offers Radius directly, as its last option.
    let radius = if narrowed {
        None
    } else {
        options
            .iter()
            .find(|option| {
                option.id == RADIUS_PROVIDER_ID && option.auth_type == ProviderAuthType::OAuth
            })
            .cloned()
    };
    if let Some(radius) = radius.as_ref() {
        let label = format!(
            "Sign in with Radius{}",
            format_login_provider_status(radius)
        );
        items.push(SelectItem::new(RADIUS_LOGIN_METHOD, &label));
    }
    if items.is_empty() {
        add_note_message(&state.chat_container, "No login methods available.");
        tui.request_render(false);
        return;
    }

    let list = Arc::new(SelectList::new(items, 10));
    let state_sel = state.clone();
    let ec_sel = editor_container.clone();
    let editor_sel = editor.clone();
    let tui_sel = tui.clone();
    let tx_sel = tx.clone();
    let extension_session_sel = extension_session.clone();
    list.on_select(Arc::new(move |item| {
        close_selector(&state_sel, &ec_sel, &editor_sel, &tui_sel);
        match item.value.as_str() {
            OAUTH_LOGIN_METHOD => open_login_provider_selector(
                &state_sel,
                &ec_sel,
                &editor_sel,
                &tui_sel,
                &extension_session_sel,
                &tx_sel,
                Some(ProviderAuthType::OAuth),
                None,
            ),
            API_KEY_LOGIN_METHOD => open_login_provider_selector(
                &state_sel,
                &ec_sel,
                &editor_sel,
                &tui_sel,
                &extension_session_sel,
                &tx_sel,
                Some(ProviderAuthType::ApiKey),
                None,
            ),
            _ => begin_provider_login(
                &state_sel,
                &ec_sel,
                &editor_sel,
                &tui_sel,
                &tx_sel,
                &extension_session_sel,
                RADIUS_PROVIDER_ID,
            ),
        }
    }));
    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    list.on_cancel(Arc::new(move || {
        close_selector(&state_cancel, &ec_cancel, &editor_cancel, &tui_cancel);
    }));

    let menu = open_menu_selector(
        state,
        editor_container,
        editor,
        tui,
        &title,
        list,
        SelectorKind::Provider,
    );
    menu.set_hint_line(Some(
        "↑↓ navigate  enter select  escape/ctrl+c cancel".to_string(),
    ));
}

/// The value of the "Sign in with an account" row.
const OAUTH_LOGIN_METHOD: &str = "__login_oauth__";
/// The value of the "Sign in with an API key" row.
const API_KEY_LOGIN_METHOD: &str = "__login_api_key__";
/// The value of the "Sign in with Radius" row.
const RADIUS_LOGIN_METHOD: &str = "__login_radius__";
/// pi's Radius provider id.
const RADIUS_PROVIDER_ID: &str = "radius";

/// Pick a provider for `/login`, then run its OAuth or API-key flow.
///
/// Mirrors pi's `showLoginProviderSelector`
/// (`interactive-mode.ts:5949`): the title, the provider rows and the menu
/// hint.
pub(super) fn open_login_provider_selector(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    extension_session: &crate::session::ExtensionSessionCell,
    tx: &mpsc::UnboundedSender<TuiMessage>,
    auth_type: Option<ProviderAuthType>,
    initial_search: Option<&str>,
) {
    let manifests = current_provider_manifests(extension_session);
    let oauth_providers = current_oauth_providers(extension_session);
    let options = login_provider_options(&manifests, &oauth_providers);
    let items = login_provider_rows(&options, auth_type);
    if items.is_empty() {
        let message = match auth_type {
            Some(ProviderAuthType::OAuth) => "No account providers available.",
            Some(ProviderAuthType::ApiKey) => "No API key providers available.",
            None => "No login providers available.",
        };
        add_note_message(&state.chat_container, message);
        tui.request_render(false);
        return;
    }
    let list = Arc::new(SelectList::new(items, 10));
    let state_sel = state.clone();
    let ec_sel = editor_container.clone();
    let editor_sel = editor.clone();
    let tui_sel = tui.clone();
    let tx_sel = tx.clone();
    let extension_session_sel = extension_session.clone();
    list.on_select(Arc::new(move |item| {
        close_selector(&state_sel, &ec_sel, &editor_sel, &tui_sel);
        begin_provider_login(
            &state_sel,
            &ec_sel,
            &editor_sel,
            &tui_sel,
            &tx_sel,
            &extension_session_sel,
            &item.value,
        );
    }));
    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    list.on_cancel(Arc::new(move || {
        close_selector(&state_cancel, &ec_cancel, &editor_cancel, &tui_cancel);
    }));
    let menu = open_menu_selector(
        state,
        editor_container,
        editor,
        tui,
        "Select provider to configure:",
        list,
        SelectorKind::Provider,
    );
    menu.set_hint(Some(
        [
            "Type to search".to_string(),
            format!("{} select", rpi_tui::key_display_text("tui.select.confirm")),
            format!("{} cancel", rpi_tui::key_display_text("tui.select.cancel")),
        ]
        .join(" · "),
    ));
    if let Some(search) = initial_search {
        menu.set_search_text(search);
    }
}
pub(super) fn open_logout_provider_selector(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    tx: &mpsc::UnboundedSender<TuiMessage>,
) {
    let items = stored_credential_items();
    if items.is_empty() {
        add_note_message(
            &state.chat_container,
            "No stored credentials to remove. /logout only removes credentials saved by /login; environment variables and models.json config are unchanged.",
        );
        tui.request_render(false);
        return;
    }
    let list = Arc::new(SelectList::new(items, 10));
    let state_sel = state.clone();
    let ec_sel = editor_container.clone();
    let editor_sel = editor.clone();
    let tui_sel = tui.clone();
    let tx_sel = tx.clone();
    list.on_select(Arc::new(move |item| {
        let _ = tx_sel.send(TuiMessage::LogoutProvider(item.value.clone()));
        close_selector(&state_sel, &ec_sel, &editor_sel, &tui_sel);
    }));
    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    list.on_cancel(Arc::new(move || {
        close_selector(&state_cancel, &ec_cancel, &editor_cancel, &tui_cancel);
    }));
    let menu = open_menu_selector(
        state,
        editor_container,
        editor,
        tui,
        "Select provider to logout:",
        list,
        SelectorKind::Provider,
    );
    menu.set_hint(Some(
        [
            "Type to search".to_string(),
            format!("{} select", rpi_tui::key_display_text("tui.select.confirm")),
            format!("{} cancel", rpi_tui::key_display_text("tui.select.cancel")),
        ]
        .join(" · "),
    ));
}
/// Open the "remove provider" picker: lists only the providers defined in
/// `models.json` (built-ins cannot be removed), and deletes the chosen one.
pub(super) fn open_provider_remove_selector(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
) {
    let items = removable_provider_items();
    if items.is_empty() {
        add_note_message(
            &state.chat_container,
            "No removable providers. Only providers defined in ~/.rpi/agent/models.json can be removed.",
        );
        tui.request_render(false);
        return;
    }
    let list = Arc::new(SelectList::new(items, 10));

    let state_sel = state.clone();
    let ec_sel = editor_container.clone();
    let editor_sel = editor.clone();
    let tui_sel = tui.clone();
    let chat_sel = state.chat_container.clone();
    list.on_select(Arc::new(move |item| {
        match remove_provider(&item.value) {
            Ok(note) => add_note_message(&chat_sel, &note),
            Err(error) => add_error_message(&chat_sel, &error),
        }
        close_selector(&state_sel, &ec_sel, &editor_sel, &tui_sel);
    }));
    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    list.on_cancel(Arc::new(move || {
        close_selector(&state_cancel, &ec_cancel, &editor_cancel, &tui_cancel);
    }));

    open_searchable_selector(
        state,
        editor_container,
        editor,
        tui,
        Some("Remove provider"),
        Some("Type to filter · Enter deletes · Esc cancels"),
        list,
        SelectorKind::Provider,
    );
}

// ===========================================================================
// Feasible selectors — /thinking, /tools, /images
// ===========================================================================

/// One-line descriptions for each thinking level, ported from
/// thinking-selector.ts (the TS `getThinkingLevelDescription` table).
pub(super) fn thinking_level_description(level: rpi_ai::types::ThinkingLevel) -> &'static str {
    use rpi_ai::types::ThinkingLevel::*;
    match level {
        Off => "No reasoning",
        Minimal => "Very brief reasoning (~1k tokens)",
        Low => "Light reasoning (~2k tokens)",
        Medium => "Moderate reasoning (~8k tokens)",
        High => "Deep reasoning (~16k tokens)",
        Xhigh => "Extra-high reasoning (~32k tokens)",
        Max => "Maximum reasoning",
    }
}

/// The lowercase serialized name of a [`ThinkingLevel`] (matches its
/// `#[serde(rename_all = "lowercase")]` form): "off", "minimal", … "max".
pub(super) fn thinking_level_name(level: rpi_ai::types::ThinkingLevel) -> &'static str {
    use rpi_ai::types::ThinkingLevel::*;
    match level {
        Off => "off",
        Minimal => "minimal",
        Low => "low",
        Medium => "medium",
        High => "high",
        Xhigh => "xhigh",
        Max => "max",
    }
}

/// Parse a thinking-level name back to the enum (case-insensitive). Returns
/// `None` for an unknown name; used by the `/thinking` selector callback.
pub(super) fn thinking_level_from_name(name: &str) -> Option<rpi_ai::types::ThinkingLevel> {
    use rpi_ai::types::ThinkingLevel::*;
    match name.to_ascii_lowercase().as_str() {
        "off" => Some(Off),
        "minimal" => Some(Minimal),
        "low" => Some(Low),
        "medium" => Some(Medium),
        "high" => Some(High),
        "xhigh" => Some(Xhigh),
        "max" => Some(Max),
        _ => None,
    }
}

/// Build + open the `/thinking` selector. Items are the levels the current
/// model supports (`Model::supported_thinking_levels`), each with a
/// description; the current level (read beforehand via `lane.get_thinking_level`)
/// is preselected. Selecting applies it live via `lane.set_thinking_level`.
///
/// `on_select` fires on the blocking key thread, so it can't await
/// `lane.get_thinking_level()` to know the current level — the opener resolves
/// it first (best-effort) and preselects; the toggle on_select just applies
/// whatever was picked.
pub(super) fn open_thinking_selector(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    lane: &Arc<dyn AgentLane>,
    catalog: &[rpi_ai::Model],
    lane_model_id: &str,
    chat: &Arc<Container>,
) {
    // Find the current model in the catalog to read its supported levels. If
    // absent, fall back to all levels so the selector still opens.
    let model = catalog
        .iter()
        .find(|m| m.id.eq_ignore_ascii_case(lane_model_id));
    let levels: Vec<rpi_ai::types::ThinkingLevel> = model
        .map(|m| m.supported_thinking_levels())
        .unwrap_or_else(|| {
            use rpi_ai::types::ThinkingLevel::*;
            vec![Off, Minimal, Low, Medium, High]
        });
    let mut items: Vec<SelectItem> = Vec::new();
    for lvl in &levels {
        let name = thinking_level_name(*lvl);
        items.push(SelectItem::new(name, name).with_description(thinking_level_description(*lvl)));
    }
    if items.is_empty() {
        add_note_message(chat, "This model has no supported thinking levels.");
        tui.request_render(false);
        return;
    }
    let list = Arc::new(SelectList::new(items, 10));

    let state_sel = state.clone();
    let ec_sel = editor_container.clone();
    let editor_sel = editor.clone();
    let tui_sel = tui.clone();
    let chat_sel = chat.clone();
    let lane_sel = lane.clone();
    list.on_select(Arc::new(move |item| {
        let Some(level) = thinking_level_from_name(&item.value) else {
            add_note_message(
                &chat_sel,
                &format!("Unknown thinking level: {}.", item.label),
            );
            close_selector(&state_sel, &ec_sel, &editor_sel, &tui_sel);
            return;
        };
        let lane = lane_sel.clone();
        let footer_sel = state_sel.footer.clone();
        tokio::spawn(async move {
            let _ = lane.set_thinking_level(level).await;
        });
        // Reflect the chosen level in the footer's model suffix (pi parity:
        // `model • thinking off` / `model • medium`). The shown text for the
        // Off level is "off", matching the TS `thinkingLevel === "off"` branch.
        footer_sel.set_thinking_level(Some(thinking_level_name(level)));
        add_note_message(&chat_sel, &format!("Thinking set to {}.", item.label));
        close_selector(&state_sel, &ec_sel, &editor_sel, &tui_sel);
    }));
    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    list.on_cancel(Arc::new(move || {
        close_selector(&state_cancel, &ec_cancel, &editor_cancel, &tui_cancel);
    }));

    open_selector(
        state,
        editor_container,
        editor,
        tui,
        list,
        SelectorKind::Thinking,
    );
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_theme_picker_lists_the_themes_with_the_current_one_marked() {
        let items = theme_selector_items("light");
        let names: Vec<&str> = items.iter().map(|item| item.value.as_str()).collect();
        assert_eq!(names, vec!["system", "dark", "light", "monochrome"]);
        let current = items
            .iter()
            .find(|item| item.value == "light")
            .expect("the light theme");
        assert_eq!(current.description.as_deref(), Some("(current)"));
        let other = items
            .iter()
            .find(|item| item.value == "dark")
            .expect("the dark theme");
        assert_eq!(other.description, None);
    }
}
