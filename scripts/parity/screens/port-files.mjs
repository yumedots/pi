/**
 * The file in the Rust port that draws each screen. Used by the index, so a
 * porter can go straight to the code behind a differing screen.
 *
 * Paths are relative to /Users/gabriel/pi-native/rpi/crates.
 */
export const PORT_FILES = {
	startup: "rpi-cli/src/interactive_tui/rendering.rs (add_welcome_message), rpi-tui/src/editor.rs (render_card), rpi-tui/src/footer.rs",
	"startup-3d": "rpi-tui/src/empty_session.rs (EmptySessionScreen), rpi-tui/src/logo3d.rs (Logo3d)",
	"first-run": "rpi-tui/src/first_run.rs (FirstRunDialog)",
	"trust-prompt":
		"not implemented - rpi-cli/src/config.rs (the port does not gate project resources behind trust, so there is no prompt)",
	"trust-selector":
		"not implemented as a selector - rpi-cli/src/interactive_tui/commands.rs (TrustCommand only writes a note)",
	"login-methods":
		"rpi-cli/src/interactive_tui/settings.rs (begin_provider_login); rpi-cli/src/interactive_tui/radius_login.rs (RadiusLoginMenu) is not wired into /login",
	"login-providers-oauth":
		"rpi-cli/src/interactive_tui/selectors.rs (open_login_provider_selector), rpi-cli/src/interactive_tui/settings.rs (login_provider_items_with_oauth), rpi-tui/src/select_list.rs",
	"login-providers-api-key":
		"rpi-cli/src/interactive_tui/selectors.rs (open_login_provider_selector), rpi-tui/src/searchable_select.rs",
	"login-api-key-entry":
		"rpi-cli/src/interactive_tui/settings.rs (begin_api_key_login, provider_form_frame), rpi-tui/src/input.rs",
	"login-oauth-methods":
		"rpi-cli/src/interactive_tui/settings.rs (begin_provider_oauth_input), rpi-cli/src/interactive_tui/radius_login.rs",
	"login-oauth-browser": "rpi-tui/src/auth_url.rs (AuthUrlComponent), rpi-cli/src/interactive_tui/settings.rs (begin_provider_oauth_input)",
	"login-oauth-code": "rpi-tui/src/auth_url.rs (AuthUrlComponent), rpi-cli/src/interactive_tui/settings.rs (show_provider_auth_status)",
	"login-oauth-code-entry":
		"rpi-cli/src/interactive_tui/settings.rs (begin_provider_oauth_input), rpi-tui/src/input.rs",
	"login-oauth-failure": "rpi-cli/src/interactive_tui/settings.rs (finish_provider_login, show_provider_auth_status)",
	"model-selector": "rpi-cli/src/interactive_tui/selectors.rs (open_model_selector), rpi-tui/src/select_list.rs",
	"model-search": "rpi-cli/src/interactive_tui/selectors.rs (open_model_selector), rpi-tui/src/searchable_select.rs",
	"model-no-match": "rpi-cli/src/interactive_tui/selectors.rs (open_model_selector)",
	"model-no-models": "rpi-cli/src/provider.rs (resolve), rpi-cli/src/config.rs (load_models_config)",
	"scoped-models": "rpi-cli/src/interactive_tui/settings.rs (open_scoped_models_selector), rpi-tui/src/select_list.rs",
	"settings-list":
		"rpi-cli/src/interactive_tui/settings.rs (open_settings_selector), rpi-cli/src/interactive_tui/settings_menu.rs (settings_menu_rows), rpi-tui/src/settings_list.rs",
	"settings-search": "rpi-tui/src/settings_list.rs (SettingsList)",
	"settings-submenu-theme": "rpi-cli/src/interactive_tui/settings_menu.rs (SettingsSubmenuView), rpi-tui/src/settings_list.rs",
	"settings-submenu-warnings": "rpi-cli/src/interactive_tui/settings_menu.rs (SettingsSubmenuView), rpi-tui/src/settings_list.rs",
	"settings-submenu-thinking": "rpi-cli/src/interactive_tui/settings_menu.rs (SettingsSubmenuView), rpi-tui/src/settings_list.rs",
	"session-menu":
		"rpi-cli/src/interactive_tui/selectors.rs (open_session_selector), rpi-cli/src/interactive_tui/selector_keys.rs (session_menu_items), rpi-tui/src/searchable_select.rs",
	"session-search":
		"rpi-tui/src/searchable_select.rs (SearchableSelectList); rpi-cli/src/interactive_tui/session_search.rs holds the query language but has no caller",
	"session-tree":
		"rpi-cli/src/interactive_tui/selectors.rs (open_tree_selector), rpi-cli/src/interactive_tui/selector_keys.rs (tree_menu_items)",
	"help-startup": "rpi-cli/src/interactive_tui/rendering.rs (compact_hints, add_welcome_message)",
	hotkeys: "rpi-cli/src/interactive_tui/rendering.rs (add_hotkeys_message), rpi-tui/src/markdown.rs",
	changelog: "rpi-cli/src/interactive_tui/rendering.rs (add_changelog_message), rpi-tui/src/markdown.rs",
	"quit-confirm": "rpi-cli/src/interactive_tui.rs (the ctrl+c handler), rpi-cli/src/interactive_tui/state.rs (show_warning)",
	"export-dialog":
		"rpi-cli/src/interactive_tui/commands.rs (ExportCommand), rpi-cli/src/interactive_tui.rs (ExportSession), rpi-cli/src/export.rs",
	"transcript-plain":
		"rpi-cli/src/interactive_tui/rendering.rs (add_user_message), rpi-tui/src/user_message.rs, rpi-tui/src/assistant_message.rs",
	"transcript-tool": "rpi-tui/src/tool_execution.rs (ToolExecutionComponent), rpi-tui/src/tool_renderers.rs",
	"transcript-thinking": "rpi-tui/src/assistant_message.rs (AssistantBlock::Thinking)",
	"transcript-long": "rpi-tui/src/assistant_message.rs, rpi-tui/src/scroll_view.rs",
	"transcript-error": "rpi-cli/src/interactive_tui/rendering.rs (add_error_message)",
	"input-empty": "rpi-tui/src/editor.rs (Editor::render, render_card)",
	"input-text": "rpi-tui/src/editor.rs (Editor::render, render_card)",
	"input-autocomplete": "rpi-cli/src/interactive_tui/autocomplete.rs (render_autocomplete), rpi-tui/src/autocomplete.rs",
	"input-history": "rpi-tui/src/editor.rs (EditorState.history, Editor::handle_key)",
	"overlay-animation":
		"rpi-tui/src/overlay.rs (OverlayManager); rpi-cli/src/js_extensions.rs (ui.custom installs an editor component, not a real overlay)",
	"overlay-doom":
		"rpi-tui/src/overlay.rs (OverlayManager); rpi-cli/src/js_extensions.rs (ui.custom installs an editor component, not a real overlay)",
};
