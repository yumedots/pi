# Screen parity index

Every screen of the TypeScript original and of the Rust port, captured as exact pane text.

- `ts/<screen>.txt` is the original's pane, `rust/<screen>.txt` is the port's.
- The pane was captured in a tmux session of 100x30, with the clock frozen
  through `scripts/parity/clock-preload.mjs`, and both sides were driven with the
  keystrokes in the *Keys (ts)* and *Keys (rust)* columns. Where the two
  programs reach the same screen by different keys, the column holds the keys
  that side needs.
- The diff ignores the parts that are fresh on every run (the random PKCE
  challenge and state, the pairing code, the session uuid, the export
  timestamp, the animation frame counter and a duration) and the per-side
  scratch path.
- The original's first paint races: the same screen captured twice starts with
  a blank line once and without it the next time, because the header is built
  after the terminal's colour reply. One leading blank line is dropped from
  both sides, so that race does not show up as a difference.
- `diffs/<screen>.diff` holds the line diff of the screens that differ.
- *Port file* names the file in the port that draws the screen, relative to
  `rpi/crates`.
- The port's panes were captured against the binary below; the original's
  against the TypeScript tree in `packages/coding-agent/src/cli.ts`.

  - port: `/Users/gabriel/pi-native/rpi/target-agents/debug/rpi (mtime 2026-10-21T01:04:43.207Z)`
  - original: `/Users/gabriel/pi/packages/coding-agent/src/cli.ts` (run with bun)

  The port's tree is edited in place, so re-run
  `node scripts/parity/screens/run.mjs rust` against a fresh binary and then
  `node scripts/parity/screens/diff.mjs` to refresh this index.

| Screen | Keys (ts) | Keys (rust) | Match | First differing line | Port file |
|---|---|---|---|---|---|
| `startup` |  |  | match |  | rpi-cli/src/interactive_tui/rendering.rs (add_welcome_message), rpi-tui/src/editor.rs (render_card), rpi-tui/src/footer.rs |
| `startup-3d` |  |  | match |  | rpi-tui/src/empty_session.rs (EmptySessionScreen), rpi-tui/src/logo3d.rs (Logo3d) |
| `first-run` |  |  | match |  | rpi-tui/src/first_run.rs (FirstRunDialog) |
| `trust-prompt` |  |  | differs | line 1: ts "  Trust project folder?" vs rust " ▀▀█  v1.3.0" | not implemented - rpi-cli/src/config.rs (the port does not gate project resources behind trust, so there is no prompt) |
| `trust-selector` | /trust Enter | /trust Enter | differs | line 10: ts "" vs rust " Current project marked trusted." | not implemented as a selector - rpi-cli/src/interactive_tui/commands.rs (TrustCommand only writes a note) |
| `login-methods` | /login Enter | /login Enter | differs | line 12: ts "" vs rust "Log in to provider" | rpi-cli/src/interactive_tui/settings.rs (begin_provider_login); rpi-cli/src/interactive_tui/radius_login.rs (RadiusLoginMenu) is not wired into /login |
| `login-providers-oauth` | /login Enter Enter | /login Enter Enter | not reachable on one side | The port has no OAuth providers: its /login lists every provider with its API key, and the OAuth providers come from extension manifests (none is installed). | rpi-cli/src/interactive_tui/selectors.rs (open_login_provider_selector), rpi-cli/src/interactive_tui/settings.rs (login_provider_items_with_oauth), rpi-tui/src/select_list.rs |
| `login-providers-api-key` | /login Enter Down Enter | /login Enter | differs | line 12: ts "" vs rust "Log in to provider" | rpi-cli/src/interactive_tui/selectors.rs (open_login_provider_selector), rpi-tui/src/searchable_select.rs |
| `login-api-key-entry` | /login Enter Down Enter Down Down Enter | /login Enter Down Enter | differs | line 19: ts "" vs rust "────────────────────────────────────────────────────────────────────────────────────────────────────" | rpi-cli/src/interactive_tui/settings.rs (begin_api_key_login, provider_form_frame), rpi-tui/src/input.rs |
| `login-oauth-methods` | /login Enter Enter Enter | /login Enter Enter Enter | not reachable on one side | The port has no OAuth providers: its /login lists every provider with its API key, and the OAuth providers come from extension manifests (none is installed). | rpi-cli/src/interactive_tui/settings.rs (begin_provider_oauth_input), rpi-cli/src/interactive_tui/radius_login.rs |
| `login-oauth-browser` | /login Enter Down Down Enter Enter | /login Enter Down Down Enter Enter | not reachable on one side | The port has no OAuth providers: its /login lists every provider with its API key, and the OAuth providers come from extension manifests (none is installed). | rpi-tui/src/auth_url.rs (AuthUrlComponent), rpi-cli/src/interactive_tui/settings.rs (begin_provider_oauth_input) |
| `login-oauth-code` | /login Enter Down Down Enter Down Enter | /login Enter Down Down Enter Down Enter | not reachable on one side | The port has no OAuth providers: its /login lists every provider with its API key, and the OAuth providers come from extension manifests (none is installed). | rpi-tui/src/auth_url.rs (AuthUrlComponent), rpi-cli/src/interactive_tui/settings.rs (show_provider_auth_status) |
| `login-oauth-code-entry` | /login Enter Enter Enter Down Enter | /login Enter Enter Enter Down Enter | not reachable on one side | The port has no OAuth providers: its /login lists every provider with its API key, and the OAuth providers come from extension manifests (none is installed). | rpi-cli/src/interactive_tui/settings.rs (begin_provider_oauth_input), rpi-tui/src/input.rs |
| `login-oauth-failure` | /login Enter Enter Enter Down Enter not-a-real-code Enter | /login Enter Enter Enter Down Enter not-a-real-code Enter | not reachable on one side | The port has no OAuth providers: its /login lists every provider with its API key, and the OAuth providers come from extension manifests (none is installed). | rpi-cli/src/interactive_tui/settings.rs (finish_provider_login, show_provider_auth_status) |
| `login-oauth-success` |  |  | not reachable | the token exchange needs the provider's token endpoint (claude.ai, radius.earendil.com), so offline the flow always ends in the failure screen |  |
| `model-selector` | /model Enter | /model Enter | differs | line 22: ts "" vs rust "Select model" | rpi-cli/src/interactive_tui/selectors.rs (open_model_selector), rpi-tui/src/select_list.rs |
| `model-search` | /model mock Enter | /model mock Enter | differs | line 22: ts "" vs rust "Select model" | rpi-cli/src/interactive_tui/selectors.rs (open_model_selector), rpi-tui/src/searchable_select.rs |
| `model-no-match` | /model gpt Enter | /model gpt Enter | differs | line 11: ts " Refreshing model catalogs…" vs rust "" | rpi-cli/src/interactive_tui/selectors.rs (open_model_selector) |
| `model-no-models` |  |  | differs | line 1: ts "Error: Unknown provider \"mock\". Use --list-models to see available providers/models." vs rust "Error: Model \"mock\" not found. Use --list-models to see available models." | rpi-cli/src/provider.rs (resolve), rpi-cli/src/config.rs (load_models_config) |
| `scoped-models` | /scoped-models Enter | /scoped-models Enter | differs | line 14: ts "────────────────────────────────────────────────────────────────────────────────────────────────────" vs rust "" | rpi-cli/src/interactive_tui/settings.rs (open_scoped_models_selector), rpi-tui/src/select_list.rs |
| `settings-list` | /settings Enter | /settings Enter | differs | line 11: ts "────────────────────────────────────────────────────────────────────────────────────────────────────" vs rust "" | rpi-cli/src/interactive_tui/settings.rs (open_settings_selector), rpi-cli/src/interactive_tui/settings_menu.rs (settings_menu_rows), rpi-tui/src/settings_list.rs |
| `settings-search` | /settings Enter theme | /settings Enter theme | differs | line 19: ts "────────────────────────────────────────────────────────────────────────────────────────────────────" vs rust "" | rpi-tui/src/settings_list.rs (SettingsList) |
| `settings-submenu-theme` | /settings Enter theme Enter | /settings Enter theme Enter | differs | line 17: ts "────────────────────────────────────────────────────────────────────────────────────────────────────" vs rust "" | rpi-cli/src/interactive_tui/settings_menu.rs (SettingsSubmenuView), rpi-tui/src/settings_list.rs |
| `settings-submenu-warnings` | /settings Enter warning Enter | /settings Enter warning Enter | differs | line 22: ts "────────────────────────────────────────────────────────────────────────────────────────────────────" vs rust "" | rpi-cli/src/interactive_tui/settings_menu.rs (SettingsSubmenuView), rpi-tui/src/settings_list.rs |
| `settings-submenu-thinking` | /settings Enter thinking Enter | /settings Enter thinking Enter | differs | line 10: ts "" vs rust " Thinking blocks shown." | rpi-cli/src/interactive_tui/settings_menu.rs (SettingsSubmenuView), rpi-tui/src/settings_list.rs |
| `settings-submenu-theme-automatic` | /settings Enter theme Enter Down Enter | /settings Enter theme Enter Down Enter | differs | line 10: ts "" vs rust " Theme set to light." |  |
| `settings-submenu-theme-light` | /settings Enter theme Enter Down Enter Enter | /settings Enter theme Enter Down Enter Enter | differs | line 10: ts "" vs rust " Theme set to light." |  |
| `session-menu` | hello world Enter /resume Enter | hello world Enter /resume Enter | differs | line 21: ts "  Sessions" vs rust "" | rpi-cli/src/interactive_tui/selectors.rs (open_session_selector), rpi-cli/src/interactive_tui/selector_keys.rs (session_menu_items), rpi-tui/src/searchable_select.rs |
| `session-search` | hello world Enter /resume Enter hello | hello world Enter /resume Enter hello | differs | line 21: ts "  Sessions" vs rust "" | rpi-tui/src/searchable_select.rs (SearchableSelectList); rpi-cli/src/interactive_tui/session_search.rs holds the query language but has no caller |
| `session-tree` | hello world Enter /tree Enter | hello world Enter /tree Enter | differs | line 1: ts " █▀ █ escape interrupt · ctrl+c twice to exit · / commands · ! bash · ctrl+o more" vs rust " ▀▀█  v1.3.0" | rpi-cli/src/interactive_tui/selectors.rs (open_tree_selector), rpi-cli/src/interactive_tui/selector_keys.rs (tree_menu_items) |
| `help-startup` | C-o | C-o | match |  | rpi-cli/src/interactive_tui/rendering.rs (compact_hints, add_welcome_message) |
| `hotkeys` | /hotkeys Enter | /hotkeys Enter | match |  | rpi-cli/src/interactive_tui/rendering.rs (add_hotkeys_message), rpi-tui/src/markdown.rs |
| `changelog` | /changelog Enter | /changelog Enter | match |  | rpi-cli/src/interactive_tui/rendering.rs (add_changelog_message), rpi-tui/src/markdown.rs |
| `version` |  |  | not reachable | the original has no /version command; the version is printed in the startup header (see the startup screen) and `pi --version` exits before the TUI opens |  |
| `quit-confirm` | C-c | C-c | match |  | rpi-cli/src/interactive_tui.rs (the ctrl+c handler), rpi-cli/src/interactive_tui/state.rs (show_warning) |
| `export-dialog` | hello world Enter /export Enter | hello world Enter /export Enter | differs | line 16: ts "" vs rust " Exported session to" | rpi-cli/src/interactive_tui/commands.rs (ExportCommand), rpi-cli/src/interactive_tui.rs (ExportSession), rpi-cli/src/export.rs |
| `transcript-plain` | hello world Enter | hello world Enter | match |  | rpi-cli/src/interactive_tui/rendering.rs (add_user_message), rpi-tui/src/user_message.rs, rpi-tui/src/assistant_message.rs |
| `transcript-tool` | read the fixture Enter | read the fixture Enter | match |  | rpi-tui/src/tool_execution.rs (ToolExecutionComponent), rpi-tui/src/tool_renderers.rs |
| `transcript-thinking` | hello world Enter | hello world Enter | match |  | rpi-tui/src/assistant_message.rs (AssistantBlock::Thinking) |
| `transcript-long` | show me a long answer Enter | show me a long answer Enter | match |  | rpi-tui/src/assistant_message.rs, rpi-tui/src/scroll_view.rs |
| `transcript-error` | hello world Enter | hello world Enter | differs | line 14: ts "" vs rust " Error: http transport error: error sending request for url" | rpi-cli/src/interactive_tui/rendering.rs (add_error_message) |
| `input-empty` |  |  | match |  | rpi-tui/src/editor.rs (Editor::render, render_card) |
| `input-text` | hello world | hello world | match |  | rpi-tui/src/editor.rs (Editor::render, render_card) |
| `input-autocomplete` | / | / | differs | line 25: ts "  (1/31)" vs rust "  (1/29)" | rpi-cli/src/interactive_tui/autocomplete.rs (render_autocomplete), rpi-tui/src/autocomplete.rs; the port lists 29 commands against the original's 31 - the original's built-in extensions add /llama and /mcp. Deliberate divergence (command surface port): the port has no llama.cpp router and no MCP management, so the two commands would be empty stubs; landing them is a feature task |
| `input-history` | hello world Enter Up | hello world Enter Up | match |  | rpi-tui/src/editor.rs (EditorState.history, Editor::handle_key) |
| `overlay-animation` | /overlay-animation Enter | /overlay-animation Enter | differs | line 7: ts "                         ╭────────────────────────────────────────────────╮" vs rust "" | rpi-tui/src/overlay.rs (OverlayManager); rpi-cli/src/js_extensions.rs (ui.custom installs an editor component, not a real overlay) |
| `overlay-doom` | /doom-overlay Enter | /doom-overlay Enter | differs | line 1: ts " ▀▀█  v1.3.0" vs rust " Pi can explain its own features and look up its docs. Ask it how to use or extend Pi." | rpi-tui/src/overlay.rs (OverlayManager); rpi-cli/src/js_extensions.rs (ui.custom installs an editor component, not a real overlay) |

14 match, 25 differ, 8 not reachable.

