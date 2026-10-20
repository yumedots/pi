//! Settings selectors, model catalog filtering, and setting changes.

use super::*;

pub(super) fn scoped_catalog(
    catalog: &[rpi_ai::Model],
    current: &rpi_ai::Model,
) -> Vec<rpi_ai::Model> {
    let scoped = crate::settings::load_settings()
        .ok()
        .and_then(|s| s.scoped_models)
        .unwrap_or_default();
    if scoped.is_empty() {
        return catalog.to_vec();
    }
    let mut out: Vec<rpi_ai::Model> = catalog
        .iter()
        .filter(|m| {
            scoped.iter().any(|s| {
                s.eq_ignore_ascii_case(&m.id)
                    || s.eq_ignore_ascii_case(&format!("{}/{}", m.provider, m.id))
            })
        })
        .cloned()
        .collect();
    // Never strand the user: if the current model isn't in scope, keep it.
    if !out.contains(current) {
        out.push(current.clone());
    }
    out
}

/// Interactive `/settings` menu.
///
/// A [`SettingsList`] of editable settings (upstream's
/// `SettingsSelectorComponent`): Enter/Space cycles a row's value in place,
/// and a submenu row opens a nested list the settings list owns — Esc goes
/// back to the rows instead of closing the menu. Value changes apply
/// immediately where the running TUI can honor them and are always persisted
/// to `settings.json`, so rows that are resolved once at startup take effect
/// next launch.
pub(super) fn open_settings_selector(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    lane: &Arc<dyn AgentLane>,
    catalog: &[rpi_ai::Model],
    lane_model_id: &str,
    chat: &Arc<Container>,
) {
    let settings = crate::settings::load_settings().unwrap_or_default();
    let hide_thinking = state.hide_thinking();
    let show_images = state.show_images.lock().map(|guard| *guard).unwrap_or(true);
    let supports_images = rpi_tui::terminal_image::get_capabilities().protocol
        != rpi_tui::terminal_image::ImageProtocol::None;
    let rows = settings_menu_rows(
        &settings,
        hide_thinking,
        show_images,
        supports_images,
        lane_model_id,
        catalog,
    );

    // ---- submenu rows ----
    // The settings list owns its submenu, so the submenu is a component the
    // row builds. Each factory returns the component and its key router; the
    // list routes the keys while the submenu is open.
    let state_menu = state.clone();
    let chat_menu = chat.clone();
    let tui_menu = tui.clone();
    let mut items: Vec<SettingItem> = Vec::with_capacity(rows.len());
    for row in &rows {
        let mut item = row.to_item();
        if let Some(spec) = &row.submenu {
            let spec = spec.clone();
            let state_menu = state_menu.clone();
            let chat_menu = chat_menu.clone();
            let tui_menu = tui_menu.clone();
            item = item.with_submenu_factory(Arc::new(move |current, done| {
                    // The closure must be 'static: own the borrowed value.
                    let current = current.to_string();
                let spec = match &spec {
                    SettingsSubmenu::Rows { rows, .. } => SettingsSubmenu::Rows {
                        rows: rows.clone(),
                        on_change: Arc::new({
                            let state = state_menu.clone();
                            let chat = chat_menu.clone();
                            let tui = tui_menu.clone();
                            move |key: &str, value: &str| {
                                let mut settings = crate::settings::load_settings().unwrap_or_default();
                                let applied = apply_setting_change(&state, key, value, &mut settings);
                                let saved = crate::settings::save_settings(&settings);
                                if let Some(note) = applied {
                                    let suffix = if saved.is_ok() { "" } else { " (not saved)" };
                                    add_note_message(&chat, &format!("{note}{suffix}"));
                                }
                                tui.request_render(false);
                            }
                        }),
                    },
                    other => other.clone(),
                };
                let on_complete: Option<Arc<dyn Fn(&SubmenuContext) + Send + Sync>> = match &spec {
                    SettingsSubmenu::Steps { .. } => Some(Arc::new({
                        let state = state_menu.clone();
                        let chat = chat_menu.clone();
                        let tui = tui_menu.clone();
                        move |context: &SubmenuContext| {
                            apply_model_thinking_overrides(context, &state, &chat, &tui);
                        }
                    })),
                    _ => None,
                };
                let summary: Arc<dyn Fn(&SubmenuContext) -> String + Send + Sync> = match &spec {
                    SettingsSubmenu::Steps { .. } => Arc::new(|_context: &SubmenuContext| {
                        let settings = crate::settings::load_settings().unwrap_or_default();
                        model_thinking_overrides_summary(&settings)
                    }),
                    _ => Arc::new(move |_context: &SubmenuContext| current.to_string()),
                };
                let view = SettingsSubmenuView::new(spec, done.clone(), on_complete, summary);
                let view_for_keys = view.clone();
                rpi_tui::SubmenuView::new(
                    view.clone() as Arc<dyn Component>,
                    Arc::new(move |key: KeyEvent| {
                        let _ = view_for_keys.handle_key(key);
                    }),
                )
            }));
        }
        items.push(item);
    }

    let list = Arc::new(SettingsList::new(items).with_search());

    // ---- value rows ----
    // Apply live where possible, then persist so the choice survives a restart.
    let state_change = state.clone();
    let chat_change = chat.clone();
    let tui_change = tui.clone();
    list.on_change(Arc::new(move |key, value| {
        let mut settings = crate::settings::load_settings().unwrap_or_default();
        let applied = apply_setting_change(&state_change, key, value, &mut settings);
        let saved = crate::settings::save_settings(&settings);
        if let Some(note) = applied {
            let suffix = if saved.is_ok() { "" } else { " (not saved)" };
            add_note_message(&chat_change, &format!("{note}{suffix}"));
        }
        tui_change.request_render(false);
    }));

    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    list.on_cancel(Arc::new(move || {
        close_selector(&state_cancel, &ec_cancel, &editor_cancel, &tui_cancel);
    }));

    open_selector_with_view(
        state,
        editor_container,
        editor,
        tui,
        SelectorView::Settings(list.clone()),
        list,
        SelectorKind::Settings,
    );
}

/// Apply the per-model thinking override the stepped submenu chose.
fn apply_model_thinking_overrides(
    context: &SubmenuContext,
    state: &Arc<TuiState>,
    chat: &Arc<Container>,
    tui: &Arc<TuiAltScreen>,
) {
    let Some(model) = context.get("model") else {
        return;
    };
    let Some(level) = context.get("level") else {
        return;
    };
    let mut settings = crate::settings::load_settings().unwrap_or_default();
    let mut levels = settings.model_thinking_levels.clone().unwrap_or_default();
    if level == "__clear__" {
        levels.remove(model);
    } else {
        levels.insert(model.clone(), level.clone());
    }
    settings.model_thinking_levels = Some(levels);
    let saved = crate::settings::save_settings(&settings);
    let suffix = if saved.is_ok() { "" } else { " (not saved)" };
    if level == "__clear__" {
        add_note_message(chat, &format!("Thinking level for {model} cleared.{suffix}"));
    } else {
        add_note_message(
            chat,
            &format!("Thinking level for {model} set to {level}.{suffix}"),
        );
    }
    let _ = (state, tui);
}

/// `"true"` / `"false"` for a settings row value.
pub(super) fn bool_setting_value(value: bool) -> &'static str {
    if value {
        "true"
    } else {
        "false"
    }
}

/// Apply one `/settings` value change to the running TUI and to `settings`.
///
/// Returns a note to show in the transcript when the change is user-visible;
/// `None` for changes that only take effect on the next launch.
pub(super) fn apply_setting_change(
    state: &Arc<TuiState>,
    key: &str,
    value: &str,
    settings: &mut crate::settings::Settings,
) -> Option<String> {
    let as_bool = || value == "true";
    match key {
        // Live: hide/show thinking blocks in the transcript immediately.
        "hide-thinking" => {
            state.set_hide_thinking(as_bool());
            settings.hide_thinking_block = Some(as_bool());
            Some(format!(
                "Thinking blocks {}.",
                if as_bool() { "hidden" } else { "shown" }
            ))
        }
        // Live: the image flag is consulted when images would be rendered.
        "show-images" => {
            state.set_show_images(as_bool());
            let terminal = settings.terminal.get_or_insert_with(Default::default);
            terminal.show_images = Some(as_bool());
            settings.show_images = Some(as_bool());
            Some(format!(
                "Inline images {}.",
                if as_bool() { "enabled" } else { "disabled" }
            ))
        }
        // Live: read from `state` once per cache-miss notice.
        "cache-miss-notices" => {
            if let Ok(mut guard) = state.cache_miss_notices.lock() {
                *guard = as_bool();
            }
            settings.show_cache_miss_notices = Some(as_bool());
            Some(format!(
                "Cache miss notices {}.",
                if as_bool() { "enabled" } else { "disabled" }
            ))
        }
        // Live: read from settings on each selection mouse-up.
        "fullscreen-copy-on-select" => {
            settings.fullscreen_copy_on_select = Some(as_bool());
            Some(format!(
                "Copy on select {}.",
                if as_bool() { "enabled" } else { "disabled" }
            ))
        }
        // Live: the theme is applied to the running TUI.
        "theme" => {
            let preset = match value {
                "light" => Some(ThemePreset::Light),
                "monochrome" => Some(ThemePreset::Monochrome),
                "dark" => Some(ThemePreset::Dark),
                _ => None,
            };
            let Some(preset) = preset else {
                return Some(format!("Unknown theme `{value}`."));
            };
            apply_theme_preset(preset);
            state.theme_manager.apply_preset(preset);
            settings.theme = Some(value.to_string());
            Some(format!("Theme set to {value}."))
        }
        // Persisted only: resolved once at startup.
        "autocompact" => {
            let compaction = settings.compaction.get_or_insert_with(Default::default);
            compaction.enabled = Some(as_bool());
            None
        }
        "image-width-cells" => {
            let terminal = settings.terminal.get_or_insert_with(Default::default);
            terminal.image_width_cells = value.parse().ok();
            None
        }
        "auto-resize-images" => {
            let images = settings.images.get_or_insert_with(Default::default);
            images.auto_resize = Some(as_bool());
            None
        }
        "block-images" => {
            let images = settings.images.get_or_insert_with(Default::default);
            images.block_images = Some(as_bool());
            None
        }
        "skill-commands" => {
            settings.enable_skill_commands = Some(as_bool());
            None
        }
        "show-hardware-cursor" => {
            settings.show_hardware_cursor = Some(as_bool());
            None
        }
        "editor-padding" => {
            settings.editor_padding_x = value.parse().ok();
            None
        }
        "output-padding" => {
            settings.output_pad = value.parse().ok();
            None
        }
        "nerd-fonts" => {
            settings.nerd_fonts = Some(as_bool());
            None
        }
        "autocomplete-max-visible" => {
            settings.autocomplete_max_visible = value.parse().ok();
            None
        }
        "autocomplete-position" => {
            settings.autocomplete_position = Some(value.to_string());
            None
        }
        "clear-on-shrink" => {
            let terminal = settings.terminal.get_or_insert_with(Default::default);
            terminal.clear_on_shrink = Some(as_bool());
            None
        }
        "terminal-progress" => {
            let terminal = settings.terminal.get_or_insert_with(Default::default);
            terminal.show_terminal_progress = Some(as_bool());
            settings.show_terminal_progress = Some(as_bool());
            None
        }
        "three-d-empty-session" => {
            settings.three_d_empty_session = Some(as_bool());
            None
        }
        "steering-mode" => {
            settings.steering_mode = match value {
                "all" => Some(crate::settings::QueueModeSetting::All),
                _ => Some(crate::settings::QueueModeSetting::OneAtATime),
            };
            None
        }
        "follow-up-mode" => {
            settings.follow_up_mode = match value {
                "all" => Some(crate::settings::QueueModeSetting::All),
                _ => Some(crate::settings::QueueModeSetting::OneAtATime),
            };
            None
        }
        "transport" => {
            settings.transport = Some(value.to_string());
            None
        }
        "share-destination" => {
            settings.session_share_destination = Some(value.to_string());
            None
        }
        "http-idle-timeout" => {
            let timeout = http_idle_timeout_value(value);
            settings.http_idle_timeout = Some(match timeout {
                Some(0) => serde_json::Value::String("disabled".to_string()),
                Some(ms) => serde_json::json!(ms),
                None => serde_json::json!(300_000),
            });
            None
        }
        "cache-warming-mode" => {
            settings.cache_warming = Some(value.to_string());
            None
        }
        "mermaid-rendering" => {
            let markdown = settings.markdown.get_or_insert_with(Default::default);
            markdown.mermaid = Some(value.to_string());
            None
        }
        "collapse-changelog" => {
            settings.collapse_changelog = Some(as_bool());
            None
        }
        "quiet-startup" => {
            settings.quiet_startup = Some(value.to_string());
            None
        }
        "default-project-trust" => {
            settings.default_project_trust = Some(default_project_trust_value(value).to_string());
            None
        }
        "double-escape-action" => {
            settings.double_escape_action = Some(value.to_string());
            None
        }
        "tree-filter-mode" => {
            settings.tree_filter_mode = Some(value.to_string());
            None
        }
        "tui-mode" => {
            settings.tui_mode = Some(value.to_string());
            None
        }
        "fullscreen-exit-output" => {
            settings.fullscreen_exit_output = Some(value.to_string());
            None
        }
        "fullscreen-scrollbar" => {
            settings.fullscreen_scrollbar = Some(value.to_string());
            None
        }
        "fullscreen-wheel-scroll-lines" => {
            settings.fullscreen_wheel_scroll_lines = Some(match value {
                "auto" => serde_json::Value::String("auto".to_string()),
                other => serde_json::json!(other.parse::<u32>().unwrap_or(1)),
            });
            None
        }
        "anthropic-extra-usage" => {
            let warnings = settings.warnings.get_or_insert_with(Default::default);
            warnings.anthropic_extra_usage = Some(as_bool());
            Some(format!(
                "Anthropic extra usage warning {}.",
                if as_bool() { "enabled" } else { "disabled" }
            ))
        }
        _ => None,
    }
}

//// Choose the default model AND persist it (`/settings` → Default model):
/// applies live via `lane.set_model` and saves `defaultModel` to settings.json
//// Convert the authenticated runtime catalog into selector rows. Keep the
/// model id as the value so `/model <id>` and the selection callback share one
/// lookup path, while making the provider visible for OpenAI-compatible
/// gateways where the same model id may exist at multiple endpoints.
pub(super) fn model_selector_items(
    catalog: &[rpi_ai::Model],
    lane_model_id: &str,
    default_model: Option<&str>,
) -> Vec<SelectItem> {
    let mut seen = std::collections::HashSet::new();
    catalog
        .iter()
        .filter(|m| {
            seen.insert((
                m.api.clone(),
                m.provider.to_ascii_lowercase(),
                m.id.to_ascii_lowercase(),
            ))
        })
        .map(|m| {
            let identity = format!("{}/{}", m.provider, m.id);
            // The original's row is the model id, marked when it is the
            // current one (`components/model-selector.ts:187`).
            let marker = if m.id.eq_ignore_ascii_case(lane_model_id) {
                "\u{2713} "
            } else {
                "  "
            };
            let label = format!("{marker}{}", m.id);
            // The description is the provider, plus the default marker
            // (`components/model-selector.ts:188`).
            let mut description = format!("[{}]", m.provider);
            if default_model.is_some_and(|default| {
                default.eq_ignore_ascii_case(&m.id)
                    || default.eq_ignore_ascii_case(&identity)
            }) {
                description.push_str(" \u{b7} default");
            }
            // upstream ranks provider-prefixed queries first, so the bare id
            // is not the leading token (`getModelSelectorSearchText`).
            let name = if m.name.is_empty() {
                String::new()
            } else {
                format!(" {}", m.name)
            };
            let search_text = format!(
                "{} {}/{} {} {}{}",
                m.provider, m.provider, m.id, m.provider, m.id, name
            );
            // Value carries the provider-qualified identity so a bare model id
            // that exists at multiple endpoints can never resolve to the wrong
            // provider (`find_model_selector_match` understands both forms).
            SelectItem::new(&identity, &label)
                .with_description(&description)
                .with_search_text(&search_text)
        })
        .collect()
}

/// Resolve a selector input by either bare model id or the qualified
/// `provider/model` identity shown for gateway models. This keeps manual
/// `/model ...` input consistent with the rows rendered by the selector.
/// A bare id that matches more than one provider is ambiguous and resolves to
/// `None` (never silently the first match).
pub(super) fn find_model_selector_match(
    catalog: &[rpi_ai::Model],
    input: &str,
) -> Option<rpi_ai::Model> {
    let (provider, id) = input
        .split_once('/')
        .filter(|(provider, id)| !provider.is_empty() && !id.is_empty())
        .map_or((None, input), |(provider, id)| (Some(provider), id));
    let mut matches = catalog.iter().filter(|model| {
        model.id.eq_ignore_ascii_case(id)
            && provider.map_or(true, |provider| {
                model.provider.eq_ignore_ascii_case(provider)
                    || (provider.eq_ignore_ascii_case("anthropic")
                        && matches!(model.api, rpi_ai::Api::AnthropicMessages))
            })
    });
    match (matches.next(), matches.next()) {
        (Some(model), None) => Some(model.clone()),
        (None, None) if provider.is_some() => {
            let mut bare = catalog
                .iter()
                .filter(|model| model.id.eq_ignore_ascii_case(input));
            match (bare.next(), bare.next()) {
                (Some(model), None) => Some(model.clone()),
                _ => None,
            }
        }
        _ => None,
    }
}

/// Read declarations from the live session so `/reload` updates `/provider` too.
pub(super) fn current_provider_manifests(
    session: &crate::session::ExtensionSessionCell,
) -> Vec<rpi_extensions::ProviderManifest> {
    let session = session.lock().unwrap_or_else(|error| error.into_inner());
    crate::provider::manifests_from_session(&session)
}

pub(super) fn current_oauth_providers(
    session: &crate::session::ExtensionSessionCell,
) -> Vec<rpi_extensions::OAuthProviderInfo> {
    let session = session.lock().unwrap_or_else(|error| error.into_inner());
    session
        .snapshot_arc()
        .map(|snapshot| rpi_extensions::list_oauth_providers(&snapshot))
        .unwrap_or_default()
}

/// Build `/provider` rows from the full catalog, including packages without
/// credentials. Label each with its model count, origin, protocol and key policy.
pub(super) fn provider_selector_items(
    manifests: &[rpi_extensions::ProviderManifest],
    current_provider: Option<&str>,
) -> Vec<SelectItem> {
    let catalog = crate::provider::catalog_with_manifests(manifests).unwrap_or_default();
    let models_cfg = crate::config::load_models_config().unwrap_or_default();
    let auth = crate::config::read_auth().unwrap_or_default();
    let execution_catalog =
        crate::provider::execution_catalog_with_manifests(manifests).unwrap_or_default();

    let mut providers: Vec<(String, usize)> = Vec::new();
    for model in &catalog {
        match providers.iter_mut().find(|(id, _)| *id == model.provider) {
            Some(entry) => entry.1 += 1,
            None => providers.push((model.provider.clone(), 1)),
        }
    }

    providers
        .into_iter()
        .map(|(id, count)| {
            let label = provider_display_name(&id);
            let marker = if current_provider.is_some_and(|current| id.eq_ignore_ascii_case(current))
            {
                " (current)"
            } else {
                ""
            };
            let manifest = manifests.iter().find(|manifest| manifest.id == id);
            let (origin, protocol) = provider_origin_protocol(&id, &models_cfg, manifest);
            let credential =
                crate::credentials::resolve(&id, models_cfg.providers.get(&id), &auth, manifest);
            let key_status = match credential.source {
                crate::credentials::CredentialSource::Anonymous => "No key needed",
                crate::credentials::CredentialSource::Missing => {
                    if execution_catalog.iter().any(|model| {
                        model.provider == id
                            && crate::credentials::has_header_auth(model.headers.as_ref())
                    }) {
                        "Auth header configured"
                    } else {
                        "No key configured"
                    }
                }
                _ => "Key configured",
            };
            let description =
                format!("{count} model(s) · {origin} · {protocol} · {key_status}{marker}");
            SelectItem::new(&id, &label)
                .with_description(&description)
                .with_search_text(&format!("{label} {id} {origin} {protocol} {key_status}"))
        })
        .collect()
}

/// Build the provider rows shown by `/login`. Anonymous package providers are
/// intentionally omitted; built-in and configured providers remain available
/// even when they currently have no credential.
#[cfg(test)]
pub(super) fn login_provider_items(
    manifests: &[rpi_extensions::ProviderManifest],
) -> Vec<SelectItem> {
    login_provider_items_with_oauth(manifests, &[])
}

pub(super) fn login_provider_items_with_oauth(
    manifests: &[rpi_extensions::ProviderManifest],
    oauth_providers: &[rpi_extensions::OAuthProviderInfo],
) -> Vec<SelectItem> {
    let catalog = crate::provider::catalog_with_manifests(manifests).unwrap_or_default();
    let models_cfg = crate::config::load_models_config().unwrap_or_default();
    let auth = crate::config::read_auth().unwrap_or_default();
    let mut ids = Vec::new();
    for model in &catalog {
        if !ids.iter().any(|id: &String| id == &model.provider) {
            ids.push(model.provider.clone());
        }
    }
    for id in models_cfg.providers.keys() {
        if !ids.iter().any(|known| known == id) {
            ids.push(id.clone());
        }
    }
    for manifest in manifests {
        if !ids.iter().any(|known| known == &manifest.id) {
            ids.push(manifest.id.clone());
        }
    }
    for oauth in oauth_providers {
        if !ids.iter().any(|known| known == &oauth.id) {
            ids.push(oauth.id.clone());
        }
    }

    ids.into_iter()
        .filter_map(|id| {
            let manifest = manifests.iter().find(|manifest| manifest.id == id);
            let oauth = oauth_providers.iter().find(|oauth| oauth.id == id);
            let configured = models_cfg.providers.get(&id);
            let requires_auth = oauth.is_some()
                || manifest.map_or_else(
                    || {
                        crate::credentials::builtin_api_key_env(&id).is_some()
                            || configured.is_some_and(|provider| {
                                provider.api_key.is_some() || provider.auth_header.is_some()
                            })
                    },
                    |manifest| manifest.requires_auth,
                );
            if !requires_auth {
                return None;
            }
            let credential = crate::credentials::resolve(&id, configured, &auth, manifest);
            let source = credential.source;
            let env = manifest
                .and_then(|manifest| manifest.api_key_env.as_deref())
                .or_else(|| crate::credentials::builtin_api_key_env(&id));
            let description = if oauth.is_some() {
                match source {
                    crate::credentials::CredentialSource::Missing => {
                        "Not configured · sign in with OAuth".to_string()
                    }
                    crate::credentials::CredentialSource::StoredOauth => {
                        "Configured · OAuth".to_string()
                    }
                    crate::credentials::CredentialSource::Environment(name) => {
                        format!("Environment variable {name} · sign in again")
                    }
                    _ => "Configured · API key / OAuth".to_string(),
                }
            } else {
                let status = match source {
                    crate::credentials::CredentialSource::Missing => "Not configured".to_string(),
                    crate::credentials::CredentialSource::Environment(name) => {
                        format!("Environment variable {name} · sign in again")
                    }
                    _ => "Configured".to_string(),
                };
                match env {
                    Some(env) => format!("{status} · API key / {env}"),
                    None => format!("{status} · API key"),
                }
            };
            Some(
                SelectItem::new(&id, &provider_display_name(&id))
                    .with_description(&description)
                    .with_search_text(&format!(
                        "{} {id} {description} login oauth",
                        provider_display_name(&id)
                    )),
            )
        })
        .collect()
}

/// Dispatch without holding the input-slot lock: submit and escape callbacks
/// clear or replace that same slot synchronously (API-key and OAuth login).
pub(super) fn handle_provider_login_key(state: &TuiState, key: KeyEvent) -> bool {
    let input = state.active_provider_input.lock().unwrap().clone();
    let Some(input) = input else {
        return false;
    };
    input.handle_key(key);
    true
}

/// Open the masked API-key input for one provider and save it under that
/// provider's own auth.json entry. A successful save asks the main loop to
/// reload the provider catalog so the newly authenticated models become live.
pub(super) fn begin_provider_login(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    tx: &mpsc::UnboundedSender<TuiMessage>,
    extension_session: &crate::session::ExtensionSessionCell,
    provider_id: &str,
) {
    if current_oauth_providers(extension_session)
        .iter()
        .any(|provider| provider.id.eq_ignore_ascii_case(provider_id))
    {
        begin_provider_oauth_login(state, editor_container, editor, tui, tx, provider_id);
    } else {
        begin_api_key_login(state, editor_container, editor, tui, tx, provider_id);
    }
}

fn begin_api_key_login(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    tx: &mpsc::UnboundedSender<TuiMessage>,
    provider_id: &str,
) {
    let provider_id = provider_id.to_string();
    let input = Arc::new(Input::with_placeholder("Paste API key, then press Enter"));
    input.set_masked(true);
    input.set_focused(true);
    let title = format!("Login · {provider_id}");
    let question = format!("API key for {provider_id}");
    let frame = provider_form_frame(
        &title,
        &question,
        input.clone(),
        "Enter saves to auth.json · Esc cancels",
    );
    editor.set_focused(false);
    editor_container.clear();
    editor_container.add_child(frame);
    *state.active_provider_input.lock().unwrap() = Some(input.clone());
    tui.set_focus(Some(input.clone()));

    let state_submit = state.clone();
    let ec_submit = editor_container.clone();
    let editor_submit = editor.clone();
    let tui_submit = tui.clone();
    let tx_submit = tx.clone();
    let provider_submit = provider_id.clone();
    input.on_submit(Arc::new(move |text| {
        let key = text.trim();
        if key.is_empty() {
            add_error_message(
                &state_submit.chat_container,
                &format!("API key for {provider_submit} cannot be empty."),
            );
            tui_submit.request_render(false);
            return;
        }
        match crate::config::upsert_credential(
            &provider_submit,
            crate::config::Credential::ApiKey {
                key: Some(key.to_string()),
                env: None,
            },
        ) {
            Ok(()) => {
                add_note_message(
                    &state_submit.chat_container,
                    &format!("Saved credentials for {provider_submit}; reloading providers…"),
                );
                let _ = tx_submit.send(TuiMessage::ReloadExtensions);
                finish_provider_login(&state_submit, &ec_submit, &editor_submit, &tui_submit);
            }
            Err(error) => add_error_message(
                &state_submit.chat_container,
                &format!("Could not save {provider_submit} credentials: {error}"),
            ),
        }
        tui_submit.request_render(false);
    }));

    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    input.on_escape(Arc::new(move || {
        finish_provider_login(&state_cancel, &ec_cancel, &editor_cancel, &tui_cancel);
        add_note_message(&state_cancel.chat_container, "Provider login cancelled.");
    }));
    tui.request_render(false);
}

fn begin_provider_oauth_login(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    tx: &mpsc::UnboundedSender<TuiMessage>,
    provider_id: &str,
) {
    let flow_id = state
        .provider_auth_generation
        .fetch_add(1, std::sync::atomic::Ordering::AcqRel)
        .wrapping_add(1);
    state
        .provider_auth_flow_id
        .store(flow_id, std::sync::atomic::Ordering::Release);
    show_provider_auth_status(
        state,
        editor_container,
        editor,
        tui,
        &format!("Starting OAuth login for {provider_id}…"),
    );
    let _ = tx.send(TuiMessage::ProviderOAuthAction {
        provider: provider_id.to_string(),
        action: "begin".to_string(),
        input: serde_json::json!({}),
        purpose: ProviderOAuthPurpose::Login,
        flow_id,
    });
}
pub(super) fn show_provider_auth_status(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    message: &str,
) {
    let frame = provider_form_frame(
        "Provider authentication",
        message,
        Arc::new(Text::new("Please wait…", 0, 0)),
        "OAuth is running · wait for the provider response",
    );
    *state.active_provider_input.lock().unwrap() = None;
    editor.set_focused(false);
    editor_container.clear();
    editor_container.add_child(frame);
    tui.set_focus(None);
    tui.request_render(false);
}

pub(super) fn handle_provider_oauth_result(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    tx: &mpsc::UnboundedSender<TuiMessage>,
    provider: &str,
    action: &str,
    result: Result<serde_json::Value, String>,
    purpose: ProviderOAuthPurpose,
    flow_id: u64,
) {
    let value = match result {
        Ok(value) => value,
        Err(error) => {
            finish_provider_login(state, editor_container, editor, tui);
            add_error_message(
                &state.chat_container,
                &format!("OAuth {action} failed for {provider}: {error}"),
            );
            tui.request_render(false);
            return;
        }
    };
    let response = match rpi_extensions::OAuthActionResponse::parse(value) {
        Ok(response) => response,
        Err(error) => {
            finish_provider_login(state, editor_container, editor, tui);
            add_error_message(
                &state.chat_container,
                &format!("Invalid OAuth response from {provider}: {error}"),
            );
            tui.request_render(false);
            return;
        }
    };

    match (purpose, response.kind) {
        (ProviderOAuthPurpose::Login, rpi_extensions::OAuthResponseKind::Interaction) => {
            begin_provider_oauth_input(
                state,
                editor_container,
                editor,
                tui,
                tx,
                provider,
                response.payload,
                flow_id,
            );
        }
        (ProviderOAuthPurpose::Login, rpi_extensions::OAuthResponseKind::Credential) => {
            match response.credential() {
                Ok(Some(token)) => match crate::config::upsert_oauth_token(
                    provider,
                    token.access,
                    token.refresh,
                    token.expires_at,
                ) {
                    Ok(()) => {
                        finish_provider_login(state, editor_container, editor, tui);
                        add_note_message(
                            &state.chat_container,
                            &format!(
                                "OAuth credentials saved for {provider}; reloading providers…"
                            ),
                        );
                        let _ = tx.send(TuiMessage::ReloadExtensions);
                    }
                    Err(error) => {
                        finish_provider_login(state, editor_container, editor, tui);
                        add_error_message(
                            &state.chat_container,
                            &format!("Could not save OAuth credentials for {provider}: {error}"),
                        );
                    }
                },
                Ok(None) | Err(_) => {
                    finish_provider_login(state, editor_container, editor, tui);
                    add_error_message(
                        &state.chat_container,
                        &format!("OAuth login for {provider} returned no valid credential."),
                    );
                }
            }
            tui.request_render(false);
        }
        (ProviderOAuthPurpose::Login, rpi_extensions::OAuthResponseKind::Error)
        | (ProviderOAuthPurpose::Login, rpi_extensions::OAuthResponseKind::Success) => {
            finish_provider_login(state, editor_container, editor, tui);
            add_error_message(
                &state.chat_container,
                &format!("OAuth login for {provider} did not return credentials."),
            );
            tui.request_render(false);
        }
        (ProviderOAuthPurpose::Logout, rpi_extensions::OAuthResponseKind::Success) => {
            finish_provider_login(state, editor_container, editor, tui);
            match crate::config::delete_credential(provider) {
                Ok(true) => {
                    add_note_message(
                        &state.chat_container,
                        &format!("OAuth credentials revoked for {provider}; reloading providers…"),
                    );
                    let _ = tx.send(TuiMessage::ReloadExtensions);
                }
                Ok(false) => add_note_message(
                    &state.chat_container,
                    &format!("No saved credentials found for {provider}."),
                ),
                Err(error) => add_error_message(
                    &state.chat_container,
                    &format!("Could not remove {provider} credentials: {error}"),
                ),
            }
            tui.request_render(false);
        }
        (ProviderOAuthPurpose::Logout, _) => {
            finish_provider_login(state, editor_container, editor, tui);
            add_error_message(
                &state.chat_container,
                &format!(
                    "OAuth revoke for {provider} did not succeed; local credentials were kept."
                ),
            );
            tui.request_render(false);
        }
    }
}

fn begin_provider_oauth_input(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    tx: &mpsc::UnboundedSender<TuiMessage>,
    provider: &str,
    payload: serde_json::Value,
    flow_id: u64,
) {
    let display = payload.get("display").unwrap_or(&payload);
    let title = display
        .get("title")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("OAuth authorization");
    let mut details = Vec::new();
    let auth_url = display.get("url").and_then(serde_json::Value::as_str);
    if let Some(instructions) = display
        .get("instructions")
        .and_then(serde_json::Value::as_array)
    {
        details.extend(
            instructions
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_string),
        );
    }
    if details.is_empty() {
        details.push("Enter the authorization value returned by the provider.".to_string());
    }
    let body = Arc::new(Container::new());
    if let Some(url) = auth_url {
        body.add_child(Arc::new(rpi_tui::auth_url::AuthUrlComponent::new(url)));
    }
    if !details.is_empty() {
        body.add_child(Arc::new(Text::new(details.join("\n"), 0, 0)));
    }
    body.add_child(Arc::new(Spacer::new(1)));
    let input = Arc::new(Input::with_placeholder("Paste OAuth code or response"));
    input.set_focused(true);
    body.add_child(input.clone());
    let frame = provider_form_frame(
        &format!("OAuth login · {provider}"),
        title,
        body,
        "Enter submits · Esc cancels this OAuth flow",
    );
    *state.active_provider_input.lock().unwrap() = Some(input.clone());
    editor.set_focused(false);
    editor_container.clear();
    editor_container.add_child(frame);
    tui.set_focus(Some(input.clone()));

    let state_submit = state.clone();
    let ec_submit = editor_container.clone();
    let editor_submit = editor.clone();
    let tui_submit = tui.clone();
    let tx_submit = tx.clone();
    let provider_submit = provider.to_string();
    input.on_submit(Arc::new(move |text| {
        let value = text.trim();
        if value.is_empty() {
            add_error_message(&state_submit.chat_container, "OAuth input cannot be empty.");
            tui_submit.request_render(false);
            return;
        }
        show_provider_auth_status(
            &state_submit,
            &ec_submit,
            &editor_submit,
            &tui_submit,
            &format!("Completing OAuth login for {provider_submit}…"),
        );
        add_note_message(
            &state_submit.chat_container,
            &format!("Completing OAuth login for {provider_submit}…"),
        );
        let _ = tx_submit.send(TuiMessage::ProviderOAuthAction {
            provider: provider_submit.clone(),
            action: "exchange".to_string(),
            input: serde_json::json!({"value": value}),
            purpose: ProviderOAuthPurpose::Login,
            flow_id,
        });
    }));

    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    input.on_escape(Arc::new(move || {
        finish_provider_login(&state_cancel, &ec_cancel, &editor_cancel, &tui_cancel);
        add_note_message(&state_cancel.chat_container, "OAuth login cancelled.");
    }));
    tui.request_render(false);
}
pub(super) fn finish_provider_login(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
) {
    state
        .provider_auth_flow_id
        .store(0, std::sync::atomic::Ordering::Release);
    *state.active_provider_input.lock().unwrap() = None;
    editor_container.clear();
    editor_container.add_child(editor.clone());
    editor.set_focused(true);
    tui.set_focus(Some(editor.clone()));
    tui.request_render(false);
}
pub(super) fn stored_credential_items() -> Vec<SelectItem> {
    crate::config::read_auth()
        .unwrap_or_default()
        .into_iter()
        .map(|(id, credential)| {
            let kind = match credential {
                crate::config::Credential::ApiKey { .. } => "API key",
                crate::config::Credential::Oauth { .. } => "OAuth",
            };
            SelectItem::new(&id, &provider_display_name(&id))
                .with_description(&format!("{kind} · remove saved credentials"))
                .with_search_text(&format!(
                    "{} {id} {kind} logout",
                    provider_display_name(&id)
                ))
        })
        .collect()
}
/// The providers that can be removed: everything defined in `models.json`
/// (built-ins are compiled in and cannot be deleted).
pub(super) fn removable_provider_items() -> Vec<SelectItem> {
    let cfg = crate::config::load_models_config().unwrap_or_default();
    cfg.providers
        .iter()
        .map(|(id, provider)| {
            let label = provider_display_name(id);
            SelectItem::new(id, &label)
                .with_description(&format!(
                    "{} model(s) · will be removed from models.json",
                    provider.models.len()
                ))
                .with_search_text(&format!("{label} {id} remove delete"))
        })
        .collect()
}

/// Where a provider comes from and what wire protocol it speaks, for the
/// `/provider` description column.
fn provider_origin_protocol(
    id: &str,
    cfg: &crate::config::ModelsConfig,
    manifest: Option<&rpi_extensions::ProviderManifest>,
) -> (&'static str, &'static str) {
    if let Some(manifest) = manifest {
        let api = cfg
            .providers
            .get(id)
            .and_then(|provider| provider.api.as_deref())
            .or_else(|| manifest.models.first().map(|model| model.api.as_str()));
        let protocol = match api {
            Some("anthropic-messages") => "Anthropic compatible",
            Some("openai-completions" | "openai-responses") => "OpenAI compatible",
            _ => "Custom protocol",
        };
        return ("package", protocol);
    }
    match id.to_ascii_lowercase().as_str() {
        "anthropic" => ("Built-in", "Anthropic"),
        "openai" => ("Built-in", "OpenAI"),
        _ => {
            let protocol = cfg
                .providers
                .get(id)
                .and_then(|p| p.api.as_deref())
                .map(|api| match api {
                    "anthropic-messages" => "Anthropic compatible",
                    "openai-completions" | "openai-responses" => "OpenAI compatible",
                    _ => "Custom protocol",
                })
                .unwrap_or("Custom protocol");
            ("Custom", protocol)
        }
    }
}

/// Switch through the authenticated session catalog. Do not advertise success
/// or persist defaults until the live lane accepted the model.
pub(super) async fn switch_provider(
    input: &str,
    manifests: &[rpi_extensions::ProviderManifest],
    available: &[rpi_ai::Model],
    lane: &Arc<dyn AgentLane>,
) -> Result<(rpi_ai::Model, String), String> {
    let catalog =
        crate::provider::catalog_with_manifests(manifests).map_err(|error| error.to_string())?;
    let provider_id = canonicalize_provider_input(input, &catalog)?;
    let candidates: Vec<_> = available
        .iter()
        .filter(|model| model.provider == provider_id)
        .collect();
    if candidates.is_empty() {
        return Err(format!(
            "Provider \"{provider_id}\" has no authenticated model loaded in this session. Check rpi auth check --provider {provider_id}, then /reload and retry. The current provider is unchanged."
        ));
    }
    let mut settings = crate::settings::load_settings().map_err(|error| error.to_string())?;
    let config = crate::config::load_models_config().map_err(|error| error.to_string())?;
    let configured = config.providers.get(&provider_id);
    let matches_api = |model: &&rpi_ai::Model| {
        configured
            .and_then(|config| config.api.as_deref())
            .map_or(true, |api| model.api.as_str() == api)
    };
    let current = lane.get_model().await.map_err(|error| error.to_string())?;
    let saved: Vec<_> = candidates
        .iter()
        .copied()
        .filter(|model| {
            settings.default_provider.as_deref() == Some(provider_id.as_str())
                && settings
                    .default_model
                    .as_deref()
                    .is_some_and(|id| model.id.eq_ignore_ascii_case(id))
        })
        .collect();
    let model = candidates
        .iter()
        .copied()
        .find(|model| {
            model.provider == current.provider
                && model.api == current.api
                && model.id.eq_ignore_ascii_case(&current.id)
        })
        .or_else(|| saved.iter().copied().find(matches_api))
        .or_else(|| saved.first().copied())
        .or_else(|| {
            configured.and_then(|config| {
                config.models.first().and_then(|first| {
                    candidates
                        .iter()
                        .copied()
                        .filter(matches_api)
                        .find(|model| model.id.eq_ignore_ascii_case(&first.id))
                })
            })
        })
        .unwrap_or(candidates[0])
        .clone();
    lane.set_model(model.clone())
        .await
        .map_err(|error| error.to_string())?;
    settings.default_provider = Some(provider_id.clone());
    settings.default_model = Some(model.id.clone());
    let saved = match crate::settings::save_settings(&settings) {
        Ok(()) => "Default saved.".to_string(),
        Err(error) => format!("Changed for this session, but could not save the default: {error}"),
    };
    let note = format!(
        "Provider switched to {provider_id} (model {}) — applies to the next message. {saved}",
        model.id
    );
    Ok((model, note))
}

/// Persist a specific default provider + model pair after a live switch.
pub(super) fn set_default_model(provider_id: &str, model_id: &str) -> Result<String, String> {
    let mut settings = crate::settings::load_settings().unwrap_or_default();
    settings.default_provider = Some(provider_id.to_string());
    settings.default_model = Some(model_id.to_string());
    crate::settings::save_settings(&settings).map_err(|error| error.to_string())?;
    Ok(format!(
        "Default provider saved as {provider_id} (model {model_id})."
    ))
}

// ===========================================================================
// Interactive "Add provider" form (`/provider` → Add new provider)
// ===========================================================================

/// Start the guided provider form. Each step renders its OWN single-line input
/// in the editor slot (isolated from the chat editor); Enter advances, Esc (or
/// an empty submission) cancels, and the final step writes `models.json`.
pub(super) fn begin_provider_form(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
) {
    *state.provider_form.lock().unwrap() = Some(ProviderFormState::default());
    show_provider_form_step(state, editor_container, editor, tui);
}

/// Render the current form step in the editor slot. Choice-style steps (the
/// protocol step) render a select list; every other step renders a titled,
/// bordered single-line input.
fn show_provider_form_step(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
) {
    let Some(form) = state.provider_form.lock().unwrap().clone() else {
        return;
    };
    *state.active_provider_input.lock().unwrap() = None;
    *state.active_provider_select.lock().unwrap() = None;

    if form.step == ProviderFormStep::Api {
        show_provider_api_selector(state, editor_container, editor, tui);
    } else {
        show_provider_text_input(state, editor_container, editor, tui, &form);
    }
}

/// Render a text-style form step as a titled single-line input.
fn show_provider_text_input(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    form: &ProviderFormState,
) {
    let (step_label, question, placeholder) = provider_step_prompt(&form.step);

    let input = Arc::new(Input::with_placeholder(placeholder));
    input.set_focused(true);

    let frame = provider_form_frame(
        step_label,
        question,
        input.clone(),
        "Enter next · Esc cancels (empty Enter also cancels)",
    );
    editor_container.clear();
    editor_container.add_child(frame);
    *state.active_provider_input.lock().unwrap() = Some(input.clone());
    tui.set_focus(Some(input.clone()));

    let state_submit = state.clone();
    let ec_submit = editor_container.clone();
    let editor_submit = editor.clone();
    let tui_submit = tui.clone();
    input.on_submit(Arc::new(move |text: &str| {
        handle_provider_form_input(&state_submit, &ec_submit, &editor_submit, &tui_submit, text);
    }));

    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    input.on_escape(Arc::new(move || {
        cancel_provider_form(&state_cancel, &ec_cancel, &editor_cancel, &tui_cancel);
    }));
    tui.request_render(false);
}

/// Render the protocol step as a select list instead of a free-text input.
fn show_provider_api_selector(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
) {
    let items = vec![
        SelectItem::new("openai-completions", "OpenAI Completions")
            .with_description("OpenAI Chat Completions compatible API"),
        SelectItem::new("anthropic-messages", "Anthropic Messages")
            .with_description("Anthropic Messages compatible API"),
        SelectItem::new("openai-responses", "OpenAI Responses")
            .with_description("OpenAI Responses API"),
    ];
    let list = Arc::new(SelectList::new(items, 3));

    let frame = provider_form_frame(
        "Add provider · step 2/6",
        "Protocol — choose one with ↑/↓ and Enter",
        list.clone(),
        "Enter selects · Esc cancels",
    );
    editor_container.clear();
    editor_container.add_child(frame);
    *state.active_provider_select.lock().unwrap() = Some(list.clone());
    tui.set_focus(Some(list.clone()));

    let state_sel = state.clone();
    let ec_sel = editor_container.clone();
    let editor_sel = editor.clone();
    let tui_sel = tui.clone();
    list.on_select(Arc::new(move |item| {
        let Some(mut form) = state_sel.provider_form.lock().unwrap().take() else {
            return;
        };
        form.api = item.value.clone();
        form.step = ProviderFormStep::BaseUrl;
        *state_sel.provider_form.lock().unwrap() = Some(form);
        show_provider_form_step(&state_sel, &ec_sel, &editor_sel, &tui_sel);
    }));

    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    list.on_cancel(Arc::new(move || {
        cancel_provider_form(&state_cancel, &ec_cancel, &editor_cancel, &tui_cancel);
    }));
    tui.request_render(false);
}

/// Build the bordered frame shared by every provider-form step.
fn provider_form_frame(
    title: &str,
    question: &str,
    body: Arc<dyn Component>,
    hint: &str,
) -> Arc<Container> {
    let frame = Arc::new(Container::new());
    frame.add_child(Arc::new(DynamicBorder::new()));
    frame.add_child(Arc::new(Spacer::new(1)));
    frame.add_child(Arc::new(Text::new(title, 0, 0)));
    frame.add_child(Arc::new(Text::new(question, 0, 0)));
    frame.add_child(Arc::new(Spacer::new(1)));
    frame.add_child(body);
    frame.add_child(Arc::new(Spacer::new(1)));
    frame.add_child(Arc::new(Text::new(hint, 0, 0)));
    frame.add_child(Arc::new(Spacer::new(1)));
    frame.add_child(Arc::new(DynamicBorder::new()));
    frame
}

/// Prompt metadata for one form step: a heading, a question, and the input
/// placeholder.
fn provider_step_prompt(step: &ProviderFormStep) -> (&'static str, &'static str, &'static str) {
    match step {
        ProviderFormStep::Id => (
            "Add provider · step 1/6",
            "Provider id — a short unique name, e.g. openrouter.",
            "openrouter",
        ),
        ProviderFormStep::Api => (
            "Add provider · step 2/6",
            "Protocol — choose one below.",
            "",
        ),
        ProviderFormStep::BaseUrl => (
            "Add provider · step 3/6",
            "Base URL — OpenAI-compatible endpoints usually end in /v1.",
            "https://api.example.com/v1",
        ),
        ProviderFormStep::ApiKey => (
            "Add provider · step 4/6",
            "API key — a literal sk-… or an env reference like $SOME_API_KEY.",
            "$SOME_API_KEY",
        ),
        ProviderFormStep::ModelId => (
            "Add provider · step 5/6",
            "Model id — at least one.",
            "my-model",
        ),
        ProviderFormStep::ModelName => (
            "Add provider · step 6/6",
            "Model name — optional, empty keeps the id.",
            "My Model",
        ),
    }
}

/// Consume one input submission for the active form step, advancing to the
/// next step or writing `models.json` on the last one.
fn handle_provider_form_input(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    text: &str,
) {
    let Some(mut form) = state.provider_form.lock().unwrap().take() else {
        return;
    };
    let text = text.trim();

    // Empty submission cancels the form at any step.
    if text.is_empty() {
        cancel_provider_form(state, editor_container, editor, tui);
        return;
    }

    match form.step {
        ProviderFormStep::Id => {
            if provider_id_exists(text) {
                add_error_message(
                    &state.chat_container,
                    &format!("Provider \"{text}\" already exists. Choose another id."),
                );
                *state.provider_form.lock().unwrap() = Some(form);
                show_provider_form_step(state, editor_container, editor, tui);
                return;
            }
            form.id = text.to_string();
            form.step = ProviderFormStep::Api;
        }
        ProviderFormStep::Api => {
            // The protocol step is rendered as a select list, so a text
            // submission can only arrive here via a bug; re-show the selector
            // rather than panicking.
            *state.provider_form.lock().unwrap() = Some(form);
            show_provider_form_step(state, editor_container, editor, tui);
            return;
        }
        ProviderFormStep::BaseUrl => {
            if !is_valid_provider_url(text) {
                add_error_message(
                    &state.chat_container,
                    &format!("Invalid URL \"{text}\". It must start with http:// or https://."),
                );
                *state.provider_form.lock().unwrap() = Some(form);
                show_provider_form_step(state, editor_container, editor, tui);
                return;
            }
            form.base_url = text.to_string();
            form.step = ProviderFormStep::ApiKey;
        }
        ProviderFormStep::ApiKey => {
            form.api_key = text.to_string();
            form.step = ProviderFormStep::ModelId;
        }
        ProviderFormStep::ModelId => {
            form.model_id = text.to_string();
            form.step = ProviderFormStep::ModelName;
        }
        ProviderFormStep::ModelName => {
            form.model_name = text.to_string();
            match save_provider_from_form(&form) {
                Ok(note) => add_note_message(&state.chat_container, &note),
                Err(error) => add_error_message(&state.chat_container, &error),
            }
            finish_provider_form(state, editor_container, editor, tui);
            return;
        }
    }
    *state.provider_form.lock().unwrap() = Some(form);
    show_provider_form_step(state, editor_container, editor, tui);
}

/// Restore the chat editor and clear the form state (done or cancelled).
fn finish_provider_form(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
) {
    *state.provider_form.lock().unwrap() = None;
    *state.active_provider_input.lock().unwrap() = None;
    *state.active_provider_select.lock().unwrap() = None;
    // The form never shares the chat editor, so clear it on exit: any draft or
    // stray paste must not resurface as if the user typed it.
    editor.clear();
    editor_container.clear();
    editor_container.add_child(editor.clone());
    editor.set_focused(true);
    tui.set_focus(Some(editor.clone()));
    tui.request_render(false);
}

fn cancel_provider_form(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
) {
    add_note_message(&state.chat_container, "Provider add cancelled.");
    finish_provider_form(state, editor_container, editor, tui);
}

/// Whether a provider id is already taken in `models.json`.
pub(super) fn provider_id_exists(id: &str) -> bool {
    crate::config::load_models_config()
        .map(|cfg| cfg.providers.contains_key(id))
        .unwrap_or(false)
}

/// A provider base URL must carry an http(s) scheme; anything else is almost
/// certainly a paste/copy mistake.
pub(super) fn is_valid_provider_url(input: &str) -> bool {
    input.starts_with("http://") || input.starts_with("https://")
}

/// Remove a configured provider from `models.json` (built-ins cannot be
/// removed). Clears a saved default that pointed at the removed provider.
pub(super) fn remove_provider(input: &str) -> Result<String, String> {
    let mut cfg = crate::config::load_models_config().map_err(|error| error.to_string())?;
    let id = input.trim();
    if cfg.providers.shift_remove(id).is_none() {
        return Err(format!(
            "Provider \"{id}\" has no models.json configuration to remove. To remove an installed package, use rpi package unlink <name>."
        ));
    }
    crate::config::save_models_config(&cfg).map_err(|error| error.to_string())?;

    // Drop a saved default that referenced the removed provider so the next
    // launch falls back to auth-based selection instead of a stale id.
    let mut settings = crate::settings::load_settings().unwrap_or_default();
    if settings.default_provider.as_deref() == Some(id) {
        settings.default_provider = None;
        settings.default_model = None;
        let _ = crate::settings::save_settings(&settings);
    }
    Ok(format!("Removed models.json configuration for provider \"{id}\" — restart rpi to apply. Installed provider packages remain available; use rpi package unlink to remove a package."))
}

/// Write the completed form into `models.json` as a new provider with one
/// model.
pub(super) fn save_provider_from_form(form: &ProviderFormState) -> Result<String, String> {
    let mut cfg = crate::config::load_models_config().map_err(|error| error.to_string())?;
    let provider = crate::config::ProviderConfig {
        name: None,
        base_url: Some(form.base_url.clone()),
        api_key: Some(form.api_key.clone()),
        api: Some(form.api.clone()),
        headers: None,
        auth_header: None,
        models: vec![crate::config::ModelDefinition {
            id: form.model_id.clone(),
            name: if form.model_name.is_empty() {
                None
            } else {
                Some(form.model_name.clone())
            },
            base_url: None,
            reasoning: None,
            thinking_level_map: None,
            context_window: None,
            max_tokens: None,
            cost: None,
            input: None,
            headers: None,
            compat: None,
        }],
    };
    cfg.providers.insert(form.id.clone(), provider);
    crate::config::save_models_config(&cfg).map_err(|error| error.to_string())?;
    Ok(format!(
        "Added provider \"{}\" ({} · {} model) — restart rpi to use it.",
        form.id, form.api, form.model_id
    ))
}

/// Human-friendly label for a provider id.
fn provider_display_name(id: &str) -> String {
    match id.to_ascii_lowercase().as_str() {
        "anthropic" => "Anthropic".to_string(),
        "openai" => "OpenAI".to_string(),
        "openai-completions" => "OpenAI Completions".to_string(),
        "openai-responses" => "OpenAI Responses".to_string(),
        _ => id.to_string(),
    }
}

/// Resolve a `/provider <id>` input against the catalog's provider ids: exact
/// match wins, then a unique case-insensitive match, mirroring the CLI
/// `--provider` canonicalization without weakening provider identity.
pub(super) fn canonicalize_provider_input(
    input: &str,
    catalog: &[rpi_ai::Model],
) -> Result<String, String> {
    let mut ids: Vec<&str> = Vec::new();
    for model in catalog {
        if !ids.iter().any(|id| *id == model.provider) {
            ids.push(&model.provider);
        }
    }
    if let Some(id) = ids.iter().find(|id| **id == input) {
        return Ok(id.to_string());
    }
    let matches: Vec<&str> = ids
        .iter()
        .copied()
        .filter(|id| id.eq_ignore_ascii_case(input))
        .collect();
    match matches.as_slice() {
        [id] => Ok(id.to_string()),
        [] => Err(format!(
            "Unknown provider \"{input}\". Run /provider to browse available providers."
        )),
        _ => Err(format!(
            "Ambiguous provider \"{input}\": {}.",
            matches.join(", ")
        )),
    }
}

/// `/scoped-models`: a multi-toggle selector over the catalog. Selecting an
/// item toggles it in the in-progress set (the selector stays open); Esc saves
/// the set to settings.json and closes. The active scoped set is echoed after
/// each toggle so the user sees the current selection.
pub(super) fn open_scoped_models_selector(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    catalog: &[rpi_ai::Model],
    chat: &Arc<Container>,
) {
    if catalog.is_empty() {
        add_note_message(chat, "No models in the catalog.");
        tui.request_render(false);
        return;
    }
    // Seed the edit set from the saved scoped models.
    let seed: Vec<String> = crate::settings::load_settings()
        .ok()
        .and_then(|s| s.scoped_models)
        .unwrap_or_default();
    *state.scoped_edit.lock().unwrap() = Some(seed);

    let mut items: Vec<SelectItem> = Vec::new();
    for m in catalog {
        items.push(SelectItem::new(&m.id, &m.id));
    }
    let list = Arc::new(SelectList::new(items, 10));

    let state_sel = state.clone();
    let chat_sel = chat.clone();
    let tui_sel = tui.clone();
    list.on_select(Arc::new(move |item| {
        // Toggle the model in the in-progress set; the selector stays open.
        let mut set = state_sel.scoped_edit.lock().unwrap();
        let set = set.get_or_insert_with(Vec::new);
        if let Some(pos) = set.iter().position(|m| m.eq_ignore_ascii_case(&item.value)) {
            set.remove(pos);
            add_note_message(&chat_sel, &format!("{} removed — Esc to save", item.label));
        } else {
            set.push(item.value.clone());
            add_note_message(&chat_sel, &format!("{} added — Esc to save", item.label));
        }
        tui_sel.request_render(false);
    }));
    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    let chat_cancel = chat.clone();
    list.on_cancel(Arc::new(move || {
        // Save the edited set to settings.json and close.
        let set = state_cancel
            .scoped_edit
            .lock()
            .unwrap()
            .take()
            .unwrap_or_default();
        let mut settings = crate::settings::load_settings().unwrap_or_default();
        settings.scoped_models = if set.is_empty() {
            None
        } else {
            Some(set.clone())
        };
        match crate::settings::save_settings(&settings) {
            Ok(()) => {
                if set.is_empty() {
                    add_note_message(&chat_cancel, "Ctrl+P cycles all models (scope cleared).");
                } else {
                    add_note_message(
                        &chat_cancel,
                        &format!("Ctrl+P cycle scope: {}", set.join(", ")),
                    );
                }
            }
            Err(e) => add_error_message(&chat_cancel, &format!("Could not save settings: {e}")),
        }
        close_selector(&state_cancel, &ec_cancel, &editor_cancel, &tui_cancel);
    }));

    open_selector(
        state,
        editor_container,
        editor,
        tui,
        list,
        SelectorKind::ScopedModels,
    );
}
