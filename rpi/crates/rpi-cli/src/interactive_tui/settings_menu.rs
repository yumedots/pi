//! The `/settings` menu: pi's rows, and the generic submenu framework.
//!
//! Port of upstream's `components/settings-selector.ts` (the row list) and
//! `components/settings-submenu.ts` (`SelectSubmenu` and `SteppedSubmenu`).
//! The row list, the order and the wording are the product: the user reads
//! them.

use super::*;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// One row of the `/settings` menu.
#[derive(Clone)]
pub(super) struct SettingsRow {
    /// The row key; the settings field the row writes.
    pub key: String,
    /// The label the user reads.
    pub label: String,
    /// The value shown on the right of the row.
    pub value: String,
    /// The description under the selected row.
    pub description: Option<String>,
    /// The values Enter cycles through. Empty for a submenu row.
    pub values: Vec<String>,
    /// What the row opens. `None` for a value row.
    pub submenu: Option<SettingsSubmenu>,
}

impl SettingsRow {
    /// A row whose value cycles through `values`.
    pub(super) fn value_row(
        key: &str,
        label: &str,
        value: &str,
        description: &str,
        values: &[&str],
    ) -> Self {
        Self {
            key: key.to_string(),
            label: label.to_string(),
            value: value.to_string(),
            description: Some(description.to_string()),
            values: values.iter().map(|value| value.to_string()).collect(),
            submenu: None,
        }
    }

    /// A row that opens a submenu.
    pub(super) fn submenu_row(
        key: &str,
        label: &str,
        value: &str,
        description: &str,
        submenu: SettingsSubmenu,
    ) -> Self {
        Self {
            key: key.to_string(),
            label: label.to_string(),
            value: value.to_string(),
            description: Some(description.to_string()),
            values: Vec::new(),
            submenu: Some(submenu),
        }
    }

    /// The `SettingItem` the settings list renders.
    pub(super) fn to_item(&self) -> SettingItem {
        let mut item = SettingItem::new(&self.key, &self.label, &self.value);
        if let Some(description) = &self.description {
            item = item.with_description(description);
        }
        if !self.values.is_empty() {
            let refs: Vec<&str> = self.values.iter().map(String::as_str).collect();
            item = item.with_values(&refs);
        }
        item
    }
}

/// The selections made so far in a stepped submenu.
pub(super) type SubmenuContext = HashMap<String, String>;

/// One step of a stepped submenu.
#[derive(Clone)]
pub(super) struct SettingsSubmenuStep {
    /// The key the step's selection is stored under.
    pub key: String,
    /// The title at the top of the step.
    pub title: Arc<dyn Fn(&SubmenuContext) -> String + Send + Sync>,
    /// The description under the title.
    pub description: Arc<dyn Fn(&SubmenuContext) -> String + Send + Sync>,
    /// The options of the step.
    pub options: Arc<dyn Fn(&SubmenuContext) -> Vec<SelectItem> + Send + Sync>,
    /// The value preselected when the step opens.
    pub preselect: Option<Arc<dyn Fn(&SubmenuContext) -> Option<String> + Send + Sync>>,
    /// Whether the step's list has a search field.
    pub searchable: bool,
}

/// What a settings row opens.
#[derive(Clone)]
pub(super) enum SettingsSubmenu {
    /// A single list of options.
    Options {
        /// The title at the top of the list.
        title: String,
        /// The description under the title.
        description: String,
        /// The options.
        options: Vec<SelectItem>,
        /// The value preselected when the list opens.
        current: String,
        /// Whether the list has a search field.
        searchable: bool,
    },
    /// A chain of steps; each step's options depend on the earlier choices.
    Steps {
        /// The steps, in order.
        steps: Vec<SettingsSubmenuStep>,
        /// Start over after the last step instead of closing.
        loop_back: bool,
    },
    /// A nested settings list (upstream's `WarningSettingsSubmenu`).
    Rows {
        /// The rows of the nested list.
        rows: Vec<SettingsRow>,
        /// Applies a change made in the nested list.
        on_change: Arc<dyn Fn(&str, &str) + Send + Sync>,
    },
}

/// A rendered submenu: the component that draws it and the key router.
pub(super) struct SubmenuScreen {
    /// The component that renders the submenu.
    pub component: Arc<dyn Component>,
    /// Routes a key to the submenu.
    pub handle_key: Arc<dyn Fn(KeyEvent) + Send + Sync>,
}

/// The frame around a submenu's list: the title, the description, the
/// optional search field, the list and the hint line.
struct SubmenuFrame {
    title: String,
    description: String,
    list: Arc<SelectList>,
    search: Option<Arc<SearchableSelectList>>,
    hint: String,
}

impl Component for SubmenuFrame {
    fn render(&self, width: usize) -> Vec<String> {
        let colors = current_theme().colors;
        let mut lines: Vec<String> = Vec::new();
        if let Some(search) = &self.search {
            lines.extend(search.render(width));
        } else {
            if !self.title.is_empty() {
                lines.push(rpi_tui::utils::truncate_to_width(
                    &colors.accent.fg(&tui_bold(&self.title)),
                    width,
                    "",
                ));
            }
            if !self.description.is_empty() {
                lines.extend(Spacer::new(1).render(width));
                lines.push(rpi_tui::utils::truncate_to_width(&colors.muted.fg(&self.description), width, ""));
            }
            lines.extend(Spacer::new(1).render(width));
            lines.extend(self.list.render(width));
        }
        lines.extend(Spacer::new(1).render(width));
        lines.push(rpi_tui::utils::truncate_to_width(&colors.dim.fg(&self.hint), width, ""));
        lines
    }

    fn invalidate(&self) {
        if let Some(search) = &self.search {
            search.invalidate();
        } else {
            self.list.invalidate();
        }
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}

/// The component that renders a settings submenu.
///
/// A single-step submenu is one list of options. A stepped submenu is a chain
/// of lists: each step's options depend on the earlier choices, Esc goes back
/// one step and Esc on the first step closes the submenu.
pub(super) struct SettingsSubmenuView {
    spec: SettingsSubmenu,
    step: Mutex<usize>,
    context: Mutex<SubmenuContext>,
    screen: Mutex<SubmenuScreen>,
    done: rpi_tui::settings_list::SubmenuDone,
    on_complete: Option<Arc<dyn Fn(&SubmenuContext) + Send + Sync>>,
    summary: Arc<dyn Fn(&SubmenuContext) -> String + Send + Sync>,
}

impl SettingsSubmenuView {
    /// Build the submenu and its first step.
    pub(super) fn new(
        spec: SettingsSubmenu,
        done: rpi_tui::settings_list::SubmenuDone,
        on_complete: Option<Arc<dyn Fn(&SubmenuContext) + Send + Sync>>,
        summary: Arc<dyn Fn(&SubmenuContext) -> String + Send + Sync>,
    ) -> Arc<Self> {
        let view = Arc::new(Self {
            spec,
            step: Mutex::new(0),
            context: Mutex::new(HashMap::new()),
            screen: Mutex::new(SubmenuScreen {
                component: Arc::new(Text::new("", 0, 0)),
                handle_key: Arc::new(|_| {}),
            }),
            done,
            on_complete,
            summary,
        });
        let screen = Self::build_step(&view, 0);
        if let Ok(mut guard) = view.screen.lock() {
            *guard = screen;
        }
        view
    }

    /// Route a key to the current step.
    pub(super) fn handle_key(&self, key: KeyEvent) {
        let handler = self
            .screen
            .lock()
            .ok()
            .map(|guard| guard.handle_key.clone());
        if let Some(handler) = handler {
            handler(key);
        }
    }

    /// The step the submenu is on.
    pub(super) fn step(&self) -> usize {
        self.step.lock().map(|guard| *guard).unwrap_or(0)
    }

    /// The selections made so far.
    pub(super) fn context(&self) -> SubmenuContext {
        self.context.lock().map(|guard| guard.clone()).unwrap_or_default()
    }

    fn build_step(view: &Arc<Self>, step_index: usize) -> SubmenuScreen {
        match &view.spec {
            SettingsSubmenu::Options {
                title,
                description,
                options,
                current,
                searchable,
            } => {
                let title = title.clone();
                let description = description.clone();
                let options = options.clone();
                let current = current.clone();
                let searchable = *searchable;
                options_screen(
                    title,
                    description,
                    options,
                    current,
                    searchable,
                    {
                        let view = Arc::downgrade(view);
                        Arc::new(move |value: String| {
                            if let Some(view) = view.upgrade() {
                                view.complete(value);
                            }
                        })
                    },
                    {
                        let view = Arc::downgrade(view);
                        Arc::new(move || {
                            if let Some(view) = view.upgrade() {
                                view.close();
                            }
                        })
                    },
                )
            }
            SettingsSubmenu::Steps { steps, loop_back } => {
                let Some(step) = steps.get(step_index) else {
                    return options_screen(
                        String::new(),
                        String::new(),
                        Vec::new(),
                        String::new(),
                        false,
                        Arc::new(|_| {}),
                        Arc::new(|| {}),
                    );
                };
                let context = view.context();
                let title = (step.title)(&context);
                let description = (step.description)(&context);
                let options = (step.options)(&context);
                let current = step
                    .preselect
                    .as_ref()
                    .and_then(|preselect| preselect(&context))
                    .unwrap_or_default();
                let searchable = step.searchable;
                let key = step.key.clone();
                let key_for_cancel = key.clone();
                let last = step_index + 1 >= steps.len();
                let loop_back = *loop_back;
                options_screen(
                    title,
                    description,
                    options,
                    current,
                    searchable,
                    {
                        let view = Arc::downgrade(view);
                        Arc::new(move |value: String| {
                            let Some(view) = view.upgrade() else {
                                return;
                            };
                            if let Ok(mut context) = view.context.lock() {
                                context.insert(key.clone(), value);
                            }
                            if last {
                                view.complete_step(loop_back);
                            } else {
                                Self::go_to_step(&view, step_index + 1);
                            }
                        })
                    },
                    {
                        let view = Arc::downgrade(view);
                        Arc::new(move || {
                            let Some(view) = view.upgrade() else {
                                return;
                            };
                            Self::go_back(&view, step_index, &key_for_cancel);
                        })
                    },
                )
            }
            SettingsSubmenu::Rows { rows, on_change } => {
                let items: Vec<SettingItem> = rows.iter().map(SettingsRow::to_item).collect();
                let list = Arc::new(SettingsList::new(items));
                let on_change = on_change.clone();
                list.on_change(on_change);
                let done = view.done.clone();
                list.on_cancel(Arc::new(move || done(None)));
                let list_for_keys = list.clone();
                SubmenuScreen {
                    component: list.clone(),
                    handle_key: Arc::new(move |key: KeyEvent| list_for_keys.handle_key(key)),
                }
            }
        }
    }

    fn go_to_step(view: &Arc<Self>, step_index: usize) {
        let screen = Self::build_step(view, step_index);
        if let Ok(mut guard) = view.screen.lock() {
            *guard = screen;
        }
        if let Ok(mut step) = view.step.lock() {
            *step = step_index;
        }
    }

    fn complete(&self, value: String) {
        (self.done)(Some(value));
    }

    fn close(&self) {
        (self.done)(None);
    }

    fn complete_step(&self, loop_back: bool) {
        let context = self.context();
        if let Some(on_complete) = &self.on_complete {
            on_complete(&context);
        }
        let summary = (self.summary)(&context);
        (self.done)(Some(summary));
        if loop_back {
            if let Ok(mut guard) = self.context.lock() {
                guard.clear();
            }
        }
    }

    fn go_back(view: &Arc<Self>, step_index: usize, key: &str) {
        if step_index == 0 {
            (view.done)(None);
            return;
        }
        if let Ok(mut context) = view.context.lock() {
            context.remove(key);
        }
        Self::go_to_step(view, step_index - 1);
    }
}

impl Component for SettingsSubmenuView {
    fn render(&self, width: usize) -> Vec<String> {
        let component = self
            .screen
            .lock()
            .ok()
            .map(|guard| guard.component.clone());
        component.map(|component| component.render(width)).unwrap_or_default()
    }

    fn invalidate(&self) {
        let component = self
            .screen
            .lock()
            .ok()
            .map(|guard| guard.component.clone());
        if let Some(component) = component {
            component.invalidate();
        }
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}

/// One step of a submenu: a titled list of options.
fn options_screen(
    title: String,
    description: String,
    options: Vec<SelectItem>,
    current: String,
    searchable: bool,
    on_select: Arc<dyn Fn(String) + Send + Sync>,
    on_cancel: Arc<dyn Fn() + Send + Sync>,
) -> SubmenuScreen {
    let list = Arc::new(SelectList::new(options.clone(), options.len().clamp(1, 10)));
    if let Some(index) = options.iter().position(|item| item.value == current) {
        list.set_selected_index(index);
    }
    list.on_select(Arc::new(move |item| on_select(item.value.clone())));
    list.on_cancel(on_cancel);

    let hint = if searchable {
        "  Type to filter · Enter to select · Esc to go back"
    } else {
        "  Enter to select · Esc to go back"
    };

    if searchable {
        let search = Arc::new(SearchableSelectList::new(
            Some(&title),
            Some(&description),
            list.clone(),
        ));
        let search_for_keys = search.clone();
        SubmenuScreen {
            component: Arc::new(SubmenuFrame {
                title,
                description,
                list: list.clone(),
                search: Some(search),
                hint: hint.to_string(),
            }),
            handle_key: Arc::new(move |key: KeyEvent| search_for_keys.handle_key(key)),
        }
    } else {
        let list_for_keys = list.clone();
        SubmenuScreen {
            component: Arc::new(SubmenuFrame {
                title,
                description,
                list: list.clone(),
                search: None,
                hint: hint.to_string(),
            }),
            handle_key: Arc::new(move |key: KeyEvent| list_for_keys.handle_key(key)),
        }
    }
}

/// The themes the port can apply.
pub(super) fn available_theme_names() -> Vec<&'static str> {
    // pi's themes: the system theme (which follows the terminal's appearance)
    // and the built-in light and dark palettes
    // (`components/settings-selector.ts:216-231`).
    vec!["system", "dark", "light"]
}

/// pi's "automatic" row: the separate light and dark palettes, chosen by the
/// terminal's appearance (`components/settings-selector.ts:226-233`).
pub(super) const AUTOMATIC_THEME_VALUE: &str = "automatic";

/// The rows of the `/settings` menu, in pi's order.
///
/// The order, the wording and the options are pi's: the user reads them and
/// compares the two menus side by side. Upstream's list is
/// `components/settings-selector.ts:490-763` (the base rows) plus the rows
/// spliced in at `:770-901`.
pub(super) fn settings_menu_rows(
    settings: &crate::settings::Settings,
    hide_thinking: bool,
    show_images: bool,
    supports_images: bool,
    lane_model_id: &str,
    catalog: &[rpi_ai::Model],
) -> Vec<SettingsRow> {
    let current_theme = settings
        .theme
        .clone()
        .unwrap_or_else(|| "system".to_string());
    let follow_up_key = rpi_tui::key_text("app.message.followUp");
    let cycle_thinking_key = rpi_tui::key_text("app.thinking.cycle");
    let show_cache_miss = settings.show_cache_miss_notices.unwrap_or(false);

    let mut rows: Vec<SettingsRow> = Vec::new();

    rows.push(SettingsRow::value_row(
        "autocompact",
        "Auto-compact",
        if settings
            .compaction
            .as_ref()
            .and_then(|compaction| compaction.enabled)
            .unwrap_or(true)
        {
            "true"
        } else {
            "false"
        },
        "Automatically compact context when it gets too large",
        &["true", "false"],
    ));

    if supports_images {
        rows.push(SettingsRow::value_row(
            "show-images",
            "Show images",
            bool_setting_value(show_images),
            "Render images inline in terminal",
            &["true", "false"],
        ));
        rows.push(SettingsRow::value_row(
            "image-width-cells",
            "Image width",
            &settings
                .terminal
                .as_ref()
                .and_then(|terminal| terminal.image_width_cells)
                .unwrap_or(60)
                .to_string(),
            "Preferred inline image width in terminal cells",
            &["60", "80", "120"],
        ));
    }

    rows.push(SettingsRow::value_row(
        "auto-resize-images",
        "Auto-resize images",
        bool_setting_value(
            settings
                .images
                .as_ref()
                .and_then(|images| images.auto_resize)
                .unwrap_or(true),
        ),
        "Resize large images to 2000x2000 max for better model compatibility",
        &["true", "false"],
    ));
    rows.push(SettingsRow::value_row(
        "block-images",
        "Block images",
        bool_setting_value(
            settings
                .images
                .as_ref()
                .and_then(|images| images.block_images)
                .unwrap_or(false),
        ),
        "Prevent images from being sent to LLM providers",
        &["true", "false"],
    ));
    rows.push(SettingsRow::value_row(
        "skill-commands",
        "Skill commands",
        bool_setting_value(settings.enable_skill_commands.unwrap_or(true)),
        "Register skills as /skill:name commands",
        &["true", "false"],
    ));
    rows.push(SettingsRow::value_row(
        "show-hardware-cursor",
        "Show hardware cursor",
        bool_setting_value(settings.show_hardware_cursor.unwrap_or(false)),
        "Use the terminal cursor instead of Pi's drawn cursor",
        &["true", "false"],
    ));
    rows.push(SettingsRow::value_row(
        "editor-padding",
        "Editor padding",
        &settings.editor_padding_x.unwrap_or(0).to_string(),
        "Horizontal padding for input editor (0-3)",
        &["0", "1", "2", "3"],
    ));
    rows.push(SettingsRow::value_row(
        "output-padding",
        "Output padding",
        &settings.output_pad.unwrap_or(1).to_string(),
        "Horizontal padding for messages, tool output, and command output",
        &["0", "1"],
    ));
    rows.push(SettingsRow::value_row(
        "nerd-fonts",
        "Nerd Font glyphs",
        bool_setting_value(settings.nerd_fonts.unwrap_or(false)),
        "Show glyphs in front of the footer groups (needs a patched font)",
        &["true", "false"],
    ));
    rows.push(SettingsRow::value_row(
        "autocomplete-max-visible",
        "Autocomplete max items",
        &settings
            .autocomplete_max_visible
            .unwrap_or(5)
            .to_string(),
        "Max visible items in autocomplete dropdown (3-20)",
        &["3", "5", "7", "10", "15", "20"],
    ));
    rows.push(SettingsRow::value_row(
        "autocomplete-position",
        "Autocomplete position",
        settings
            .autocomplete_position
            .clone()
            .unwrap_or_else(|| "above".to_string())
            .as_str(),
        "Show the autocomplete list above or below the input",
        &["above", "below"],
    ));
    rows.push(SettingsRow::value_row(
        "clear-on-shrink",
        "Clear on shrink",
        bool_setting_value(
            settings
                .terminal
                .as_ref()
                .and_then(|terminal| terminal.clear_on_shrink)
                .unwrap_or(false),
        ),
        "Clear empty rows when content shrinks (may cause flicker)",
        &["true", "false"],
    ));
    rows.push(SettingsRow::value_row(
        "terminal-progress",
        "Terminal progress",
        bool_setting_value(settings.show_terminal_progress().unwrap_or(false)),
        "Show a progress line while the agent works",
        &["true", "false"],
    ));
    rows.push(SettingsRow::value_row(
        "three-d-empty-session",
        "3D empty session",
        bool_setting_value(settings.three_d_empty_session().unwrap_or(false)),
        "Show the spinning 3D pi logo with a centered input box while a session is empty",
        &["true", "false"],
    ));

    rows.push(SettingsRow::value_row(
        "steering-mode",
        "Steering mode",
        settings
            .steering_mode
            .map(|mode| mode.as_str())
            .unwrap_or("one-at-a-time"),
        "Enter while streaming queues steering messages. 'one-at-a-time': deliver one, wait for response. 'all': deliver all at once.",
        &["one-at-a-time", "all"],
    ));
    rows.push(SettingsRow::value_row(
        "follow-up-mode",
        "Follow-up mode",
        settings
            .follow_up_mode
            .map(|mode| mode.as_str())
            .unwrap_or("one-at-a-time"),
        &format!(
            "{follow_up_key} queues follow-up messages until agent stops. 'one-at-a-time': deliver one, wait for response. 'all': deliver all at once."
        ),
        &["one-at-a-time", "all"],
    ));
    rows.push(SettingsRow::value_row(
        "transport",
        "Transport",
        settings.transport.clone().unwrap_or_else(|| "auto".to_string()).as_str(),
        "Preferred transport for providers that support multiple transports",
        &["sse", "websocket", "websocket-cached", "auto"],
    ));
    rows.push(SettingsRow::value_row(
        "share-destination",
        "Session share destination",
        settings
            .session_share_destination
            .clone()
            .unwrap_or_else(|| "auto".to_string())
            .as_str(),
        "Where to upload sessions with /share (auto prefers Radius when authenticated, otherwise GitHub Gist)",
        &["auto", "gist", "radius"],
    ));
    rows.push(SettingsRow::value_row(
        "http-idle-timeout",
        "HTTP idle timeout",
        &format_http_idle_timeout(settings.http_idle_timeout_ms()),
        "Maximum idle gap while waiting for HTTP headers or body chunks. Disable for local models that pause longer than five minutes.",
        &["30 sec", "1 min", "2 min", "5 min", "disabled"],
    ));
    rows.push(SettingsRow::value_row(
        "cache-warming-mode",
        "Cache warming",
        settings
            .cache_warming
            .clone()
            .unwrap_or_else(|| "streaming".to_string())
            .as_str(),
        "off; streaming while the agent runs; idle also between runs while continuation stays profitable",
        &["off", "streaming", "idle"],
    ));
    rows.push(SettingsRow::value_row(
        "hide-thinking",
        "Hide thinking",
        bool_setting_value(hide_thinking),
        "Hide thinking blocks in assistant responses",
        &["true", "false"],
    ));
    rows.push(SettingsRow::value_row(
        "mermaid-rendering",
        "Mermaid diagrams",
        settings
            .markdown
            .as_ref()
            .and_then(|markdown| markdown.mermaid.clone())
            .unwrap_or_else(|| "streaming".to_string())
            .as_str(),
        "Render Mermaid code blocks as Unicode diagrams",
        &["off", "final", "streaming"],
    ));
    rows.push(SettingsRow::value_row(
        "cache-miss-notices",
        "Cache miss notices",
        bool_setting_value(show_cache_miss),
        "Show transcript notices for cache costs and provider recovery diagnostics",
        &["true", "false"],
    ));
    rows.push(SettingsRow::value_row(
        "collapse-changelog",
        "Collapse changelog",
        bool_setting_value(settings.collapse_changelog.unwrap_or(false)),
        "Show condensed changelog after updates",
        &["true", "false"],
    ));
    rows.push(SettingsRow::value_row(
        "quiet-startup",
        "Quiet startup",
        settings
            .quiet_startup
            .clone()
            .unwrap_or_else(|| "false".to_string())
            .as_str(),
        "Disable verbose printing at startup (header: keep only the startup header)",
        &["true", "header", "false"],
    ));
    rows.push(SettingsRow::value_row(
        "default-project-trust",
        "Default project trust",
        default_project_trust_label(
            settings
                .default_project_trust
                .clone()
                .unwrap_or_else(|| "ask".to_string())
                .as_str(),
        ),
        "Fallback behavior when no extension or saved trust decision decides project trust",
        &["Ask", "Always trust", "Never trust"],
    ));
    rows.push(SettingsRow::value_row(
        "double-escape-action",
        "Double-escape action",
        settings
            .double_escape_action
            .clone()
            .unwrap_or_else(|| "tree".to_string())
            .as_str(),
        "Action when pressing Escape twice with empty editor",
        &["tree", "fork", "none"],
    ));
    rows.push(SettingsRow::value_row(
        "tree-filter-mode",
        "Tree filter mode",
        settings
            .tree_filter_mode
            .clone()
            .unwrap_or_else(|| "default".to_string())
            .as_str(),
        "Default filter when opening /tree",
        &["default", "no-tools", "user-only", "labeled-only", "all"],
    ));
    rows.push(SettingsRow::submenu_row(
        "warnings",
        "Warnings",
        "configure",
        "Enable or disable individual warnings",
        SettingsSubmenu::Rows {
            rows: vec![SettingsRow::value_row(
                "anthropic-extra-usage",
                "Anthropic extra usage",
                bool_setting_value(
                    settings
                        .warnings
                        .as_ref()
                        .and_then(|warnings| warnings.anthropic_extra_usage)
                        .unwrap_or(true),
                ),
                "Warn when Anthropic subscription auth may use paid extra usage",
                &["true", "false"],
            )],
            on_change: Arc::new(|_key: &str, _value: &str| {}),
        },
    ));
    rows.push(SettingsRow::submenu_row(
        "model-thinking",
        "Default thinking level per model",
        &model_thinking_overrides_summary(settings),
        &format!(
            "Override the default thinking level for specific models. {cycle_thinking_key} cycles in-session."
        ),
        model_thinking_submenu(settings, catalog, lane_model_id),
    ));
    rows.push(SettingsRow::value_row(
        "tui-mode",
        "TUI mode",
        settings
            .tui_mode
            .clone()
            .unwrap_or_else(|| "fullscreen".to_string())
            .as_str(),
        "Interface layout; regular mode uses the terminal's normal scrollback",
        &["regular", "fullscreen"],
    ));
    rows.push(SettingsRow::value_row(
        "fullscreen-exit-output",
        "Fullscreen exit output",
        settings
            .fullscreen_exit_output
            .clone()
            .unwrap_or_else(|| "resume-hint".to_string())
            .as_str(),
        "Print the transcript or only a session resume hint when exiting fullscreen mode",
        &["transcript", "resume-hint"],
    ));
    rows.push(SettingsRow::value_row(
        "fullscreen-scrollbar",
        "Fullscreen scrollbar",
        settings
            .fullscreen_scrollbar
            .clone()
            .unwrap_or_else(|| "auto".to_string())
            .as_str(),
        "Scrollbar behavior in fullscreen mode; has no effect in regular mode",
        &["auto", "always", "hidden"],
    ));
    rows.push(SettingsRow::value_row(
        "fullscreen-copy-on-select",
        "Fullscreen copy on select",
        bool_setting_value(settings.fullscreen_copy_on_select.unwrap_or(true)),
        "Automatically copy selected text in fullscreen mode; disable to copy selections with Ctrl+X",
        &["true", "false"],
    ));
    rows.push(SettingsRow::value_row(
        "fullscreen-wheel-scroll-lines",
        "Fullscreen wheel scrolling",
        &fullscreen_wheel_scroll_lines_value(settings),
        "Lines per mouse-wheel event in fullscreen mode; 'auto' speeds up fast wheel spins where the terminal does not",
        &["auto", "1", "2", "3", "5", "10"],
    ));
    rows.push(SettingsRow::submenu_row(
        "theme",
        "Theme",
        &current_theme,
        "Color theme for the interface",
        SettingsSubmenu::Options {
            title: "Theme".to_string(),
            description: "Select a theme, or choose automatic to follow terminal appearance.".to_string(),
            options: theme_submenu_items(&current_theme),
            current: current_theme.clone(),
            searchable: false,
        },
    ));

    rows
}

/// pi's theme rows: the system theme, the automatic mode, then the rest.
///
/// The system theme carries the description "Follows the terminal's light or
/// dark mode" and the automatic row "Use separate themes for light and dark
/// terminal appearance" (`components/settings-selector.ts:216-233`).
pub(super) fn theme_submenu_items(current: &str) -> Vec<SelectItem> {
    let mut items: Vec<SelectItem> = Vec::new();
    let mut rest: Vec<SelectItem> = Vec::new();
    for name in available_theme_names() {
        let label = if name == current {
            format!("\u{2713} {name}")
        } else {
            format!("  {name}")
        };
        let item = if name == "system" {
            SelectItem::new(name, &label)
                .with_description("Follows the terminal's light or dark mode")
        } else {
            SelectItem::new(name, &label)
        };
        if name == "system" {
            items.push(item);
        } else {
            rest.push(item);
        }
    }
    items.push(
        SelectItem::new(AUTOMATIC_THEME_VALUE, "  automatic")
            .with_description("Use separate themes for light and dark terminal appearance"),
    );
    items.extend(rest);
    items
}

/// The label pi shows for a project trust value.
pub(super) fn default_project_trust_label(value: &str) -> &'static str {
    match value {
        "always" => "Always trust",
        "never" => "Never trust",
        _ => "Ask",
    }
}

/// The value pi stores for a project trust label.
pub(super) fn default_project_trust_value(label: &str) -> &'static str {
    match label {
        "Always trust" => "always",
        "Never trust" => "never",
        _ => "ask",
    }
}

/// The label of the HTTP idle timeout, in pi's wording.
pub(super) fn format_http_idle_timeout(timeout_ms: Option<i64>) -> String {
    match timeout_ms {
        Some(30_000) => "30 sec".to_string(),
        Some(60_000) => "1 min".to_string(),
        Some(120_000) => "2 min".to_string(),
        Some(300_000) => "5 min".to_string(),
        Some(0) => "disabled".to_string(),
        Some(ms) => format!("{} sec", ms / 1000),
        None => "5 min".to_string(),
    }
}

/// The value pi stores for an HTTP idle timeout label.
pub(super) fn http_idle_timeout_value(label: &str) -> Option<i64> {
    match label {
        "30 sec" => Some(30_000),
        "1 min" => Some(60_000),
        "2 min" => Some(120_000),
        "5 min" => Some(300_000),
        "disabled" => Some(0),
        _ => None,
    }
}

/// The value of the fullscreen wheel scrolling row.
pub(super) fn fullscreen_wheel_scroll_lines_value(settings: &crate::settings::Settings) -> String {
    match &settings.fullscreen_wheel_scroll_lines {
        Some(serde_json::Value::String(value)) => value.clone(),
        Some(serde_json::Value::Number(number)) => number.to_string(),
        _ => "auto".to_string(),
    }
}

/// The summary pi shows for the per-model thinking overrides.
pub(super) fn model_thinking_overrides_summary(settings: &crate::settings::Settings) -> String {
    let count = settings
        .model_thinking_levels
        .as_ref()
        .map(|levels| levels.len())
        .unwrap_or(0);
    if count == 0 {
        "none".to_string()
    } else {
        format!("{count} configured")
    }
}

/// The stepped submenu that configures the thinking level per model.
fn model_thinking_submenu(
    settings: &crate::settings::Settings,
    catalog: &[rpi_ai::Model],
    lane_model_id: &str,
) -> SettingsSubmenu {
    let overrides = settings.model_thinking_levels.clone().unwrap_or_default();
    let global_level = settings
        .default_thinking_level
        .clone()
        .unwrap_or_else(|| "off".to_string());
    let models: Vec<rpi_ai::Model> = catalog.to_vec();
    let current_model = lane_model_id.to_string();

    let models_for_step = models.clone();
    let models_for_step_preselect = models.clone();
    let current_for_step = current_model.clone();
    let overrides_for_step = overrides.clone();
    let model_step = SettingsSubmenuStep {
        key: "model".to_string(),
        title: Arc::new(|_context: &SubmenuContext| "Per-Model Thinking Level".to_string()),
        description: Arc::new(|_context: &SubmenuContext| "Select a model to configure".to_string()),
        options: Arc::new(move |context: &SubmenuContext| {
            let mut sorted = models_for_step.clone();
            sorted.sort_by(|a, b| {
                let a_current = a.id.eq_ignore_ascii_case(&current_for_step);
                let b_current = b.id.eq_ignore_ascii_case(&current_for_step);
                if a_current != b_current {
                    return if a_current {
                        std::cmp::Ordering::Less
                    } else {
                        std::cmp::Ordering::Greater
                    };
                }
                a.provider.cmp(&b.provider)
            });
            let items: Vec<SelectItem> = sorted
                .iter()
                .map(|model| {
                    let key = format!("{}/{}", model.provider, model.id);
                    let label = format!("{} [{}]", model.id, model.provider);
                    let mut item = SelectItem::new(&key, &label);
                    if let Some(level) = overrides_for_step.get(&key) {
                        item = item.with_description(level);
                    }
                    item
                })
                .collect();
            let _ = context;
            if items.is_empty() {
                vec![SelectItem::new(
                    "__none__",
                    "No models available",
                )
                .with_description("Log in to a provider or configure an API key first")]
            } else {
                items
            }
        }),
        preselect: Some(Arc::new(move |_context: &SubmenuContext| {
            let current: Vec<&rpi_ai::Model> = models_for_step_preselect
                .iter()
                .filter(|model| model.id.eq_ignore_ascii_case(&current_model))
                .collect();
            current
                .first()
                .map(|model| format!("{}/{}", model.provider, model.id))
        })),
        searchable: true,
    };

    let models_for_title = models.clone();
    let models_for_level = models.clone();
    let overrides_for_title = overrides.clone();
    let overrides_for_level = overrides.clone();
    let global_for_level = global_level.clone();
    let level_step = SettingsSubmenuStep {
        key: "level".to_string(),
        title: Arc::new(move |context: &SubmenuContext| {
            let key = context.get("model").cloned().unwrap_or_default();
            match models_for_title
                .iter()
                .find(|model| format!("{}/{}", model.provider, model.id) == key)
            {
                Some(model) => format!("Thinking Level for {} [{}]", model.id, model.provider),
                None => "Thinking Level".to_string(),
            }
        }),
        description: Arc::new(|_context: &SubmenuContext| {
            "Select default thinking level for this model".to_string()
        }),
        options: Arc::new(move |context: &SubmenuContext| {
            let key = context.get("model").cloned().unwrap_or_default();
            let Some(model) = models_for_level
                .iter()
                .find(|model| format!("{}/{}", model.provider, model.id) == key)
            else {
                return Vec::new();
            };
            let active = overrides_for_level.get(&key).cloned();
            let mut items: Vec<SelectItem> = model
                .supported_thinking_levels()
                .iter()
                .map(|level| {
                    let name = super::selectors::thinking_level_name(*level);
                    let label = if Some(name.to_string()) == active {
                        format!("✓ {name}")
                    } else {
                        format!("  {name}")
                    };
                    SelectItem::new(name, &label)
                        .with_description(super::selectors::thinking_level_description(*level))
                })
                .collect();
            if active.is_some() {
                items.push(
                    SelectItem::new("__clear__", "  (clear override)")
                        .with_description(&format!(
                            "Revert to global default ({global_for_level})"
                        )),
                );
            }
            items
        }),
        preselect: Some(Arc::new({
            let overrides = overrides_for_title.clone();
            move |context: &SubmenuContext| {
                let key = context.get("model").cloned().unwrap_or_default();
                overrides.get(&key).cloned()
            }
        })),
        searchable: false,
    };

    SettingsSubmenu::Steps {
        steps: vec![model_step, level_step],
        loop_back: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The rows pi's settings menu shows, in pi's order.
    ///
    /// Upstream's list is `components/settings-selector.ts:490-763` (the base
    /// rows) plus the rows spliced in at `:770-901`.
    const PI_ROWS: &[(&str, &str)] = &[
        ("autocompact", "Auto-compact"),
        ("show-images", "Show images"),
        ("image-width-cells", "Image width"),
        ("auto-resize-images", "Auto-resize images"),
        ("block-images", "Block images"),
        ("skill-commands", "Skill commands"),
        ("show-hardware-cursor", "Show hardware cursor"),
        ("editor-padding", "Editor padding"),
        ("output-padding", "Output padding"),
        ("nerd-fonts", "Nerd Font glyphs"),
        ("autocomplete-max-visible", "Autocomplete max items"),
        ("autocomplete-position", "Autocomplete position"),
        ("clear-on-shrink", "Clear on shrink"),
        ("terminal-progress", "Terminal progress"),
        ("three-d-empty-session", "3D empty session"),
        ("steering-mode", "Steering mode"),
        ("follow-up-mode", "Follow-up mode"),
        ("transport", "Transport"),
        ("share-destination", "Session share destination"),
        ("http-idle-timeout", "HTTP idle timeout"),
        ("cache-warming-mode", "Cache warming"),
        ("hide-thinking", "Hide thinking"),
        ("mermaid-rendering", "Mermaid diagrams"),
        ("cache-miss-notices", "Cache miss notices"),
        ("collapse-changelog", "Collapse changelog"),
        ("quiet-startup", "Quiet startup"),
        ("default-project-trust", "Default project trust"),
        ("double-escape-action", "Double-escape action"),
        ("tree-filter-mode", "Tree filter mode"),
        ("warnings", "Warnings"),
        ("model-thinking", "Default thinking level per model"),
        ("tui-mode", "TUI mode"),
        ("fullscreen-exit-output", "Fullscreen exit output"),
        ("fullscreen-scrollbar", "Fullscreen scrollbar"),
        ("fullscreen-copy-on-select", "Fullscreen copy on select"),
        ("fullscreen-wheel-scroll-lines", "Fullscreen wheel scrolling"),
        ("theme", "Theme"),
    ];

    fn rows() -> Vec<SettingsRow> {
        settings_menu_rows(
            &crate::settings::Settings::default(),
            true,
            true,
            true,
            "current-model",
            &[],
        )
    }

    #[test]
    fn the_menu_has_pis_rows_in_pis_order() {
        let rows = rows();
        let actual: Vec<(&str, &str)> = rows
            .iter()
            .map(|row| (row.key.as_str(), row.label.as_str()))
            .collect();
        assert_eq!(actual, PI_ROWS.to_vec());
    }

    #[test]
    fn the_three_d_empty_session_row_is_there() {
        let rows = rows();
        let row = rows
            .iter()
            .find(|row| row.key == "three-d-empty-session")
            .expect("the 3D empty session row");
        assert_eq!(row.label, "3D empty session");
        assert_eq!(
            row.description.as_deref(),
            Some("Show the spinning 3D pi logo with a centered input box while a session is empty")
        );
        assert_eq!(row.values, vec!["true".to_string(), "false".to_string()]);
    }

    #[test]
    fn the_quiet_startup_row_offers_pis_three_values() {
        let rows = rows();
        let row = rows
            .iter()
            .find(|row| row.key == "quiet-startup")
            .expect("the quiet startup row");
        assert_eq!(
            row.values,
            vec![
                "true".to_string(),
                "header".to_string(),
                "false".to_string()
            ]
        );
    }

    #[test]
    fn the_submenu_rows_open_a_submenu() {
        let rows = rows();
        for key in ["warnings", "model-thinking", "theme"] {
            let row = rows
                .iter()
                .find(|row| row.key == key)
                .unwrap_or_else(|| panic!("the {key} row"));
            assert!(row.submenu.is_some(), "{key} must open a submenu");
            assert!(row.values.is_empty(), "{key} must not cycle values");
        }
    }

    #[test]
    fn the_value_rows_cycle_pis_values() {
        let rows = rows();
        let row = rows
            .iter()
            .find(|row| row.key == "transport")
            .expect("the transport row");
        assert_eq!(
            row.values,
            vec![
                "sse".to_string(),
                "websocket".to_string(),
                "websocket-cached".to_string(),
                "auto".to_string()
            ]
        );
        let row = rows
            .iter()
            .find(|row| row.key == "default-project-trust")
            .expect("the project trust row");
        assert_eq!(row.value, "Ask");
        assert_eq!(
            row.values,
            vec![
                "Ask".to_string(),
                "Always trust".to_string(),
                "Never trust".to_string()
            ]
        );
    }

    #[test]
    fn the_http_idle_timeout_uses_pis_labels() {
        assert_eq!(format_http_idle_timeout(Some(30_000)), "30 sec");
        assert_eq!(format_http_idle_timeout(Some(60_000)), "1 min");
        assert_eq!(format_http_idle_timeout(Some(120_000)), "2 min");
        assert_eq!(format_http_idle_timeout(Some(300_000)), "5 min");
        assert_eq!(format_http_idle_timeout(Some(0)), "disabled");
        assert_eq!(http_idle_timeout_value("2 min"), Some(120_000));
        assert_eq!(http_idle_timeout_value("disabled"), Some(0));
    }

    #[test]
    fn the_project_trust_labels_map_back_to_values() {
        assert_eq!(default_project_trust_value("Always trust"), "always");
        assert_eq!(default_project_trust_value("Never trust"), "never");
        assert_eq!(default_project_trust_value("Ask"), "ask");
        assert_eq!(default_project_trust_label("always"), "Always trust");
    }
}
