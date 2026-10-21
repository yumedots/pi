//! The project trust prompt and the `/trust` selector.
//!
//! Port of upstream's `TrustSelectorComponent`
//! (`components/trust-selector.ts`) and the startup prompt
//! (`core/project-trust.ts:26-40`): the same options, the same order and the
//! same wording.

use std::any::Any;
use std::sync::{Arc, Mutex};

use rpi_tui::component::{Component, MouseEvent, MouseEventResult};
use rpi_tui::container::Container;
use rpi_tui::select_list::{SelectItem, SelectList};
use rpi_tui::spacer::Spacer;
use rpi_tui::text::Text;
use rpi_tui::theme::theme;
use rpi_tui::TUI;

/// One trust choice: the label the user reads and what it saves.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct TrustOption {
    /// The row's label.
    pub(super) label: String,
    /// Whether the project is trusted after the choice.
    pub(super) trusted: bool,
    /// The decisions to store: the path and whether it is trusted. An empty
    /// list means "this session only" (nothing is written).
    pub(super) updates: Vec<(String, Option<bool>)>,
}

/// The trust choices for a folder, in upstream's order
/// (`core/trust-manager.ts:67-97`).
pub(super) fn trust_options(cwd: &std::path::Path, session_only: bool) -> Vec<TrustOption> {
    let trust_path = normalize_cwd(cwd);
    let mut options = vec![TrustOption {
        label: "Trust".to_string(),
        trusted: true,
        updates: vec![(trust_path.clone(), Some(true))],
    }];
    if let Some(parent) = parent_path(cwd) {
        options.push(TrustOption {
            label: format!("Trust parent folder ({parent})"),
            trusted: true,
            updates: vec![(parent, Some(true)), (trust_path.clone(), None)],
        });
    }
    if session_only {
        options.push(TrustOption {
            label: "Trust (this session only)".to_string(),
            trusted: true,
            updates: Vec::new(),
        });
    }
    options.push(TrustOption {
        label: "Do not trust".to_string(),
        trusted: false,
        updates: vec![(trust_path, Some(false))],
    });
    if session_only {
        options.push(TrustOption {
            label: "Do not trust (this session only)".to_string(),
            trusted: false,
            updates: Vec::new(),
        });
    }
    options
}

/// The folder's own path, canonical when it exists.
fn normalize_cwd(cwd: &std::path::Path) -> String {
    std::fs::canonicalize(cwd)
        .unwrap_or_else(|_| cwd.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

/// The parent folder, when the path has one.
fn parent_path(cwd: &std::path::Path) -> Option<String> {
    let trust_path = std::fs::canonicalize(cwd).unwrap_or_else(|_| cwd.to_path_buf());
    let parent = trust_path.parent()?;
    if parent == trust_path {
        return None;
    }
    Some(parent.to_string_lossy().into_owned())
}

/// The prompt upstream shows when the decision is undecided
/// (`core/project-trust.ts:26-28`).
pub(super) fn trust_prompt_message(cwd: &std::path::Path) -> String {
    format!(
        "Trust project folder?\n{}\n\nThis allows pi to load .pi settings and resources, install missing project packages, and execute project extensions.",
        cwd.display()
    )
}

/// The startup trust prompt: the message, the search field and the options.
///
/// Upstream's `ui.select` draws the message as the menu's title and the
/// options as the rows, so the prompt is the shared menu framework with the
/// message as its title (`core/project-trust.ts:33-40`).
pub(super) struct TrustPrompt {
    message: String,
    options: Vec<TrustOption>,
    list: Arc<SelectList>,
    input: Arc<rpi_tui::input::Input>,
    on_select: Mutex<Option<Arc<dyn Fn(Option<TrustOption>) + Send + Sync>>>,
    on_cancel: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
}

impl TrustPrompt {
    /// The prompt for a folder, with the session-only choices.
    pub(super) fn new(cwd: &std::path::Path) -> Self {
        let options = trust_options(cwd, true);
        let items: Vec<SelectItem> = options
            .iter()
            .map(|option| SelectItem::new(&option.label, &option.label))
            .collect();
        let list = Arc::new(SelectList::new(items, 10));
        // The menu framework's search field (`components/menu.ts:82-88`).
        let input = Arc::new(rpi_tui::input::Input::with_placeholder("Search"));
        let list_for_change = list.clone();
        input.on_change(Arc::new(move |value: &str| {
            list_for_change.set_filter(value);
        }));
        Self {
            message: trust_prompt_message(cwd),
            options,
            list,
            input,
            on_select: Mutex::new(None),
            on_cancel: Mutex::new(None),
        }
    }

    /// The callback that fires when a choice is confirmed.
    pub(super) fn on_select(
        &self,
        callback: Arc<dyn Fn(Option<TrustOption>) + Send + Sync>,
    ) {
        if let Ok(mut slot) = self.on_select.lock() {
            *slot = Some(callback);
        }
    }

    /// The callback that fires when the prompt is cancelled.
    pub(super) fn on_cancel(&self, callback: Arc<dyn Fn() + Send + Sync>) {
        if let Ok(mut slot) = self.on_cancel.lock() {
            *slot = Some(callback);
        }
    }

    /// The chosen option.
    pub(super) fn selected(&self) -> Option<TrustOption> {
        let item = self.list.get_selected_item()?;
        self.options
            .iter()
            .find(|option| option.label == item.value)
            .cloned()
    }

    /// Confirm the highlighted choice.
    pub(super) fn confirm(&self) {
        let chosen = self.selected();
        let callback = self.on_select.lock().ok().and_then(|slot| slot.clone());
        if let Some(callback) = callback {
            callback(chosen);
        }
    }

    /// Cancel the prompt: the project stays untrusted.
    pub(super) fn cancel(&self) {
        let callback = self.on_cancel.lock().ok().and_then(|slot| slot.clone());
        if let Some(callback) = callback {
            callback();
        }
    }

    /// Route a key: the arrows move, Enter confirms and Esc cancels.
    pub(super) fn handle_key(&self, key: crossterm::event::KeyEvent) {
        use crossterm::event::KeyCode;
        match key.code {
            KeyCode::Up | KeyCode::Down => self.list.handle_key(key),
            KeyCode::Enter => self.confirm(),
            KeyCode::Esc => self.cancel(),
            _ => self.input.handle_key(key),
        }
    }
}

impl Component for TrustPrompt {
    fn render(&self, width: usize) -> Vec<String> {
        let colors = theme().colors;
        let mut lines: Vec<String> = Vec::new();
        // The message is the menu's title: the first line is indented, the
        // rest are not, and the text wraps at the width.
        let message = format!("  {}", self.message);
        for line in message.split('\n') {
            if line.is_empty() {
                lines.push(String::new());
                continue;
            }
            for wrapped in rpi_tui::utils::wrap_text_with_ansi(line, width) {
                lines.push(colors.muted.fg(&wrapped));
            }
        }
        lines.extend(self.input.render(width));
        lines.extend(self.list.render(width));
        lines.push(colors.dim.fg("↑↓ navigate  enter select  escape/ctrl+c cancel"));
        lines
    }

    fn handle_mouse(&self, event: &MouseEvent) -> Option<MouseEventResult> {
        self.list.handle_mouse(event)
    }

    fn invalidate(&self) {
        self.list.invalidate();
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

/// The `/trust` screen: the frame, the folder, the saved decision, the
/// current session and the options.
///
/// Port of upstream's `TrustSelectorComponent`
/// (`components/trust-selector.ts:49-105`).
pub(super) struct TrustSelector {
    cwd: String,
    saved_decision: Option<(String, bool)>,
    project_trusted: bool,
    options: Vec<TrustOption>,
    selected: Mutex<usize>,
    on_select: Mutex<Option<Arc<dyn Fn(Option<TrustOption>) + Send + Sync>>>,
    on_cancel: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
}

impl TrustSelector {
    /// The selector for a folder, with the saved decision and the session's
    /// trust state.
    pub(super) fn new(
        cwd: &std::path::Path,
        saved_decision: Option<(String, bool)>,
        project_trusted: bool,
    ) -> Self {
        Self {
            cwd: normalize_cwd(cwd),
            saved_decision,
            project_trusted,
            options: trust_options(cwd, false),
            selected: Mutex::new(0),
            on_select: Mutex::new(None),
            on_cancel: Mutex::new(None),
        }
    }

    /// The callback that fires when a choice is confirmed.
    pub(super) fn on_select(
        &self,
        callback: Arc<dyn Fn(Option<TrustOption>) + Send + Sync>,
    ) {
        if let Ok(mut slot) = self.on_select.lock() {
            *slot = Some(callback);
        }
    }

    /// The callback that fires when the screen is cancelled.
    pub(super) fn on_cancel(&self, callback: Arc<dyn Fn() + Send + Sync>) {
        if let Ok(mut slot) = self.on_cancel.lock() {
            *slot = Some(callback);
        }
    }

    /// Confirm the highlighted choice.
    pub(super) fn confirm(&self) {
        let chosen = self.selected();
        let callback = self.on_select.lock().ok().and_then(|slot| slot.clone());
        if let Some(callback) = callback {
            callback(chosen);
        }
    }

    /// Cancel the screen.
    pub(super) fn cancel(&self) {
        let callback = self.on_cancel.lock().ok().and_then(|slot| slot.clone());
        if let Some(callback) = callback {
            callback();
        }
    }

    /// The chosen option.
    pub(super) fn selected(&self) -> Option<TrustOption> {
        let index = *self.selected.lock().ok()?;
        self.options.get(index).cloned()
    }

    /// Move the selection.
    pub(super) fn move_selection(&self, delta: i32) {
        let len = self.options.len();
        if len == 0 {
            return;
        }
        if let Ok(mut selected) = self.selected.lock() {
            let next = (*selected as i32 + delta).rem_euclid(len as i32);
            *selected = next as usize;
        }
    }

    /// Route a key: the arrows move, Enter confirms and Esc cancels
    /// (`components/trust-selector.ts:107-130`).
    pub(super) fn handle_key(&self, key: crossterm::event::KeyEvent) {
        use crossterm::event::KeyCode;
        match key.code {
            KeyCode::Up => self.move_selection(-1),
            KeyCode::Down => self.move_selection(1),
            KeyCode::Enter => self.confirm(),
            KeyCode::Esc => self.cancel(),
            _ => {}
        }
    }

    /// The saved decision as upstream writes it
    /// (`components/trust-selector.ts:21-29`).
    fn format_decision(&self) -> String {
        let Some((path, trusted)) = &self.saved_decision else {
            return "none".to_string();
        };
        let label = if *trusted { "trusted" } else { "untrusted" };
        if *path != self.cwd {
            return format!("{label} (inherited from {path})");
        }
        format!("{label} ({path})")
    }
}

impl Component for TrustSelector {
    fn render(&self, width: usize) -> Vec<String> {
        let colors = theme().colors;
        let mut lines: Vec<String> = Vec::new();
        lines.extend(rpi_tui::dynamic_border::DynamicBorder::new().render(width));
        lines.extend(Spacer::new(1).render(width));
        lines.push(format!(" {}", rpi_tui::bold(&colors.accent.fg("Project trust"))));
        lines.push(format!(" {}", colors.muted.fg(&self.cwd)));
        lines.extend(Spacer::new(1).render(width));
        lines.push(format!(
            " {}",
            colors.muted.fg(&format!("Saved decision: {}", self.format_decision()))
        ));
        lines.push(format!(
            " {}",
            colors
                .muted
                .fg(&format!(
                    "Current session: {}",
                    if self.project_trusted {
                        "trusted"
                    } else {
                        "untrusted"
                    }
                ))
        ));
        lines.extend(Spacer::new(1).render(width));
        let selected = *self
            .selected
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        for (index, option) in self.options.iter().enumerate() {
            let is_selected = index == selected;
            let prefix = if is_selected { "→ " } else { "  " };
            let label = if is_selected {
                colors.accent.fg(&option.label)
            } else {
                colors.text.fg(&option.label)
            };
            lines.push(format!(" {prefix}{label}"));
        }
        lines.extend(Spacer::new(1).render(width));
        lines.push(format!(
            " {}",
            colors.dim.fg("↑↓ navigate  enter save  escape/ctrl+c cancel")
        ));
        lines.extend(Spacer::new(1).render(width));
        lines.extend(rpi_tui::dynamic_border::DynamicBorder::new().render(width));
        lines
    }

    fn invalidate(&self) {}

    fn as_any(&self) -> &dyn Any {
        self
    }
}

/// The rows of a trust option list, for the shared select list.
pub(super) fn trust_items(options: &[TrustOption]) -> Vec<SelectItem> {
    options
        .iter()
        .map(|option| SelectItem::new(&option.label, &option.label))
        .collect()
}

/// A container with the trust options as rows.
pub(super) fn trust_container(options: Vec<TrustOption>) -> Arc<Container> {
    let container = Arc::new(Container::new());
    for item in trust_items(&options) {
        container.add_child(Arc::new(Text::new(item.label, 1, 0)));
    }
    container
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_options_are_upstreams_five_in_order() {
        let dir = std::env::temp_dir().join("rpi-trust-options");
        std::fs::create_dir_all(&dir).unwrap();
        let options = trust_options(&dir, true);
        let labels: Vec<&str> = options.iter().map(|option| option.label.as_str()).collect();
        assert_eq!(labels[0], "Trust");
        assert!(labels[1].starts_with("Trust parent folder ("));
        assert_eq!(labels[2], "Trust (this session only)");
        assert_eq!(labels[3], "Do not trust");
        assert_eq!(labels[4], "Do not trust (this session only)");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_selector_omits_the_session_only_choices() {
        let dir = std::env::temp_dir().join("rpi-trust-selector");
        std::fs::create_dir_all(&dir).unwrap();
        let options = trust_options(&dir, false);
        assert_eq!(options.len(), 3);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_prompt_carries_the_message_and_the_rows() {
        let dir = std::env::temp_dir().join("rpi-trust-prompt");
        std::fs::create_dir_all(&dir).unwrap();
        let prompt = TrustPrompt::new(&dir);
        let lines = prompt.render(100);
        let plain: Vec<String> = lines.iter().map(|line| rpi_tui::strip_ansi(line)).collect();
        assert!(plain[0].starts_with("  Trust project folder?"), "{:?}", plain[0]);
        assert!(plain.iter().any(|line| line.contains("→ Trust")), "{:?}", plain);
        assert!(
            plain
                .iter()
                .any(|line| line.contains("↑↓ navigate  enter select  escape/ctrl+c cancel")),
            "{:?}",
            plain
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}

/// Open the `/trust` screen: the frame, the folder, the saved decision and
/// the trust choices.
pub(super) fn open_trust_selector(ctx: &super::CommandContext) {
    use rpi_tui::container::Container;
    use rpi_tui::dynamic_border::DynamicBorder;

    let cwd = ctx.cwd.clone();
    let saved = crate::config::read_trust()
        .ok()
        .and_then(|store| {
            store
                .get(&normalize_cwd(&cwd))
                .copied()
                .flatten()
                .map(|trusted| (normalize_cwd(&cwd), trusted))
        });
    let selector = Arc::new(TrustSelector::new(&cwd, saved, session_trust(&cwd)));
    let state = ctx.state.clone();
    let editor_container = ctx.editor_container.clone();
    let editor = ctx.editor.clone();
    let tui = ctx.tui.clone();
    let chat = ctx.chat.clone();

    let state_select = state.clone();
    let editor_select = editor_container.clone();
    let editor_select = editor_select.clone();
    let editor_for_select = editor.clone();
    let tui_select = tui.clone();
    let chat_select = chat.clone();
    let cwd_select = cwd.clone();
    selector.on_select(Arc::new(move |chosen| {
        if let Some(option) = chosen {
            for (path, decision) in &option.updates {
                if let Err(error) = crate::config::set_project_trust(
                    std::path::Path::new(path),
                    *decision,
                ) {
                    super::rendering::add_error_message(
                        &chat_select,
                        &format!("Could not save trust decision: {error}"),
                    );
                }
            }
            let label = if option.trusted { "trusted" } else { "untrusted" };
            super::rendering::add_note_message(
                &chat_select,
                &format!("Current project marked {label}."),
            );
        }
        let _ = &cwd_select;
        super::selectors::close_selector(
            &state_select,
            &editor_select,
            &editor_for_select,
            &tui_select,
        );
    }));
    let state_cancel = state.clone();
    let editor_cancel = editor_container.clone();
    let editor_cancel = editor_cancel.clone();
    let editor_for_cancel = editor.clone();
    let tui_cancel = tui.clone();
    selector.on_cancel(Arc::new(move || {
        super::selectors::close_selector(
            &state_cancel,
            &editor_cancel,
            &editor_for_cancel,
            &tui_cancel,
        );
    }));

    // Upstream's frame: a `DynamicBorder` above and below the screen
    // (`components/trust-selector.ts:66`, `:104`).
    editor_container.clear();
    editor_container.add_child(Arc::new(DynamicBorder::new()));
    editor_container.add_child(selector.clone());
    editor_container.add_child(Arc::new(DynamicBorder::new()));
    *state.active_selector.lock().unwrap() = Some((
        super::state::SelectorView::Trust(selector.clone()),
        super::state::SelectorKind::Trust,
    ));
    tui.set_focus(Some(selector.clone()));
    tui.request_render(false);
}

/// Whether the project is trusted for this session, the way the startup
/// resolves it (`session.rs:2000`).
pub(super) fn session_trust(cwd: &std::path::Path) -> bool {
    if !crate::config::has_trust_requiring_project_resources(cwd) {
        return true;
    }
    if let Ok(Some(decision)) = crate::config::nearest_project_trust_decision(cwd) {
        return decision;
    }
    crate::settings::load_settings()
        .ok()
        .and_then(|settings| settings.default_project_trust)
        .map(|value| value == "always")
        .unwrap_or(false)
}

/// Whether the startup has to ask for the project's trust.
///
/// Upstream asks when the folder holds trust-requiring resources, no decision
/// is stored and `defaultProjectTrust` is `ask`
/// (`core/project-trust.ts:47-85`).
pub(super) fn trust_prompt_needed(cwd: &std::path::Path) -> bool {
    if !crate::config::has_trust_requiring_project_resources(cwd) {
        return false;
    }
    if crate::config::nearest_project_trust_decision(cwd)
        .ok()
        .flatten()
        .is_some()
    {
        return false;
    }
    crate::settings::load_settings()
        .ok()
        .and_then(|settings| settings.default_project_trust)
        .map(|value| value == "ask")
        .unwrap_or(true)
}

/// Store a trust choice (`core/project-trust.ts:42-46`).
pub(super) fn apply_trust_choice(
    option: &TrustOption,
    cwd: &std::path::Path,
    chat: &std::sync::Arc<rpi_tui::container::Container>,
) {
    for (path, decision) in &option.updates {
        if let Err(error) = crate::config::set_project_trust(std::path::Path::new(path), *decision)
        {
            super::rendering::add_error_message(
                chat,
                &format!("Could not save trust decision: {error}"),
            );
        }
    }
    let label = if option.trusted { "trusted" } else { "untrusted" };
    super::rendering::add_note_message(chat, &format!("Current project marked {label}."));
    let _ = cwd;
}
