//! Interactive mode for pi-cli.
//!
//! Full-screen terminal UI with a streaming transcript, an editor, a live
//! status indicator, and tool-execution display. Mirrors the TypeScript
//! `packages/coding-agent/src/modes/interactive/interactive-mode.ts` event→UI
//! mapping (`handleEvent`), driven by the live `AgentEvent` stream the harness
//! emits via the `BroadcastEmitter` installed in [`crate::session`].
//!
//! This host module owns startup and input dispatch. Feature implementations live
//! in `interactive_tui/`: commands, extensions, settings, sessions, state, run,
//! events, selectors, autocomplete, and rendering. Regression tests live in tests.rs.
//!
//! Key architecture facts (see the initial port notes (retired)):
//! - `TuiAltScreen::start()` still has a readerless companion, so this module
//!   owns a `spawn_blocking` crossterm `read()` loop for key dispatch and a
//!   `tokio::spawn` task that drains `broadcast::Receiver<AgentEvent>` into UI
//!   mutations.
//! - The layout root is built ONCE at startup (mirrors the TS
//!   `fullscreenLayoutRoot`); per-message we mutate only `chat_container` /
//!   `status_container` / `autocomplete_container` children and call
//!   `request_render(false)` so the differential renderer repaints just the
//!   changed rows.
//! - Selectors (`/model` `/session` `/theme`) are implemented by **swapping the
//!   `editor_container` child** (the TS `showSelector` swap pattern,
//!   `interactive-mode.ts:4354-4377`) — the `show_overlay` stub is avoided
//!   entirely. An `active_selector` state field holds the live `SelectList`;
//!   while it is `Some` the key loop routes to it first and restores the editor
//!   on done/cancel.

// Feature modules share the host state; their helpers stay private to this TUI.
mod extensions;
use extensions::*;
pub(crate) use extensions::{ask_user_frame, parse_ask_user_prompt, AskUserPrompt};
mod commands;
use commands::*;
mod settings;
use settings::*;
mod settings_menu;
use settings_menu::*;
mod sessions;
use sessions::*;
mod run;
use run::*;
mod events;
use events::*;
mod selectors;
use selectors::*;
mod selector_keys;
use selector_keys::*;
mod autocomplete;
use autocomplete::*;
mod skill_autocomplete;
use skill_autocomplete::*;
mod config_selector;
use config_selector::*;
mod radius_login;
use radius_login::*;
mod session_search;
use session_search::*;
mod rendering;
use rendering::*;
mod header;
use header::*;
mod empty_session;
mod panels;
mod pet;
mod progress;
mod side_questions;

#[cfg(test)]
mod tests;

mod state;
pub(crate) use state::configured_keybindings;
use state::*;

use std::collections::HashMap;
use std::io::IsTerminal;
use std::sync::{Arc, LazyLock, Mutex};

use base64::Engine;
use crossterm::event::{Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use tokio::sync::{broadcast, mpsc};
use tokio_util::sync::CancellationToken;

use rpi_agent::{AgentEvent, AgentMessage};
use rpi_ai::types::{AssistantMessage, Content, UserMessage};
use rpi_harness::agent_harness::{AgentHarness, AgentLane, HarnessRunOutcome};
use rpi_harness::session::types::{Entry, EntryOrder, EntryQuery};
use rpi_tui::scroll_view::{OverscrollMode, ScrollbarMode};
#[cfg(test)]
use rpi_tui::strip_ansi;
use rpi_tui::{
    apply_theme_preset, AltScreenSearch, AssistantBlock, AssistantMessageComponent,
    AssistantMessageOptions, AutocompleteManager, AutocompleteSuggestions, BashExecutionComponent,
    BashTruncation, Centered, CombinedAutocompleteProvider, Component, Container, DynamicBorder,
    Editor, EditorOptions, EditorStyle, EmptySessionScreen, FilePathAutocompleteProvider, Focusable,
    FollowMode, FooterComponent, FirstRunDialog, Image, ImageOptions, Input, Loader, Markdown, ProcessTerminal,
    ScrollView, ScrollViewOptions, SearchBar, SearchableSelectList, SelectItem, SelectList,
    SettingItem, SettingsList, SlashCommand as SlashCommandEntry,
    SlashCommandAutocompleteProvider, Spacer, StackChild, StackEntry, StatusIndicator, Text,
    ThemeManager, ThemePreset, ToolExecutionComponent, ToolStatus, TuiAltScreen,
    UserMessageComponent, VStack, WorkingState, EMPTY_SESSION_EDITOR_WIDTH, TUI,
};
use rpi_tui::bold as tui_bold;
use rpi_tui::theme as current_theme;

#[allow(unused_imports)]
use rpi_tui::BashStatus;

use crate::args::Args;
use crate::session_driver::{assistant_blocks, assistant_tool_calls};
use crate::transcript_view::UiEvent;

/// B5e: the markdown-transformer trait object the assistant-message render path
/// applies to raw text BEFORE the [`Markdown`] renderer styles it. A plain
/// `Fn(&str) -> String` (NO `rpi-extensions` types) so `rpi-tui` stays free of
/// an `rpi-extensions` dep — `rpi-cli` (which already depends on
/// `rpi-extensions`) builds the closure from the live `RegistrySnapshot` and
/// hands the trait object to `AssistantMessageComponent::set_markdown_transformer`.
type MarkdownTransformer = Arc<dyn Fn(&str) -> String + Send + Sync>;

/// A synchronous rendezvous between the Node runtime-request thread and the
/// blocking TUI key loop. Node's `ctx.ui.*` methods are promises, so the host
/// request must remain pending while the user interacts with the native
/// B5e: build the `AssistantMessageComponent` markdown-transformer closure the
/// render path applies to raw assistant text before styling. Wraps any plugin
/// `register_markdown_transformer` handlers registered in `snapshot` (chained
/// in registration order: each handler's output feeds the next). `None` when
/// no markdown transformers are registered (the component defaults to the
/// identity transform + this avoids a closure allocation on the hot render
/// path).
///
/// The closure captures an `Arc<RegistrySnapshot>` clone so it outlives the
/// borrow that built it (the snapshot's `active` flag guards dispatch in
/// `emit_resources_discover`/event translation; a reloaded session's old
/// snapshot flips false, so a stale closure no-ops rather than driving a
/// half-swapped registry — the transformer falls back to the input unchanged
/// on an inactive snapshot, matching the plugin's per-handler skip-on-error).
///
/// This is the cycle-free seam: `rpi-tui` takes a `Fn(&str) -> String` trait
/// object (no `rpi-extensions` dep); `rpi-cli` (which already depends on
/// `rpi-extensions`) builds the closure from the live `RegistrySnapshot`. The
/// calling pattern mirrors `plugin_stub_smoke.rs`'s direct `RenderFn` round-
/// trip (input `{"markdown":…}` → `render_fn` → reclaim `out` via the plugin's
/// `free_string` → parse `{"markdown":…}`).
fn build_markdown_transformer(
    snapshot: Option<std::sync::Arc<rpi_extensions::RegistrySnapshot>>,
) -> Option<MarkdownTransformer> {
    let snapshot = snapshot?;
    // Pre-check: if no markdown renderers are registered, return None so the
    // component uses the identity path (no per-delta closure call). The
    // renderers list is a per-call `renderers_of` clone; snapshotting it once
    // here keeps the closure cheap on the hot path.
    let renderers = snapshot.renderers_of(rpi_extensions::RegisteredRendererKind::Markdown);
    if renderers.is_empty() {
        return None;
    }
    Some(Arc::new(move |raw: &str| -> String {
        transform_markdown_chain(&snapshot, &renderers, raw)
    }))
}

/// Drive the markdown-transformer chain for one input string. Each registered
/// handler receives the previous handler's output (or the raw input for the
/// first), as a `{"markdown": <text>}` JSON envelope; its `RenderFn` returns
/// `{"markdown": <transformed>}` (rc=0) or an error (rc!=0). On any failure —
/// nonzero rc, a panic across the FFI (caught), a missing `markdown` field, or
/// an inactive snapshot — the chain short-circuits to the current text
/// unchanged (per-handler skip-on-error, mirroring pi's `runner.ts` fan-out).
fn transform_markdown_chain(
    snapshot: &rpi_extensions::RegistrySnapshot,
    renderers: &[rpi_extensions::RegisteredRenderer],
    raw: &str,
) -> String {
    // A stale snapshot (post-/reload) must not drive a swapped-out registry.
    // The renderers were captured from this snapshot; if it has gone inactive,
    // fall back to the raw input so the UI never renders stale-transformed text
    // from a dead plugin.
    if !snapshot.is_active() {
        return raw.to_string();
    }

    let mut current = raw.to_string();
    for renderer in renderers {
        let input = match serde_json::to_string(&serde_json::json!({ "markdown": current })) {
            Ok(s) => s,
            Err(_) => return current, // serialize failure — keep current, stop chain
        };
        // SAFETY: `render_fn` is a plugin-provided `extern "C" fn` over a
        // borrowed `StbStringRef` + an out-param. The plugin warrants
        // `poll`/`render` are non-blocking + thread-safe (the same contract
        // the tool adapter relies on). `user_data` is the plugin's opaque
        // pointer, stable for the registry lifetime (the keepalive keeps the
        // cdylib mapped). We reclaim `out` via the plugin's `free_string`
        // exactly once. The whole call is `catch_unwind`-wrapped — a plugin
        // panic must not unwind across the FFI boundary (same policy as the
        // tool partial cb + the runtime_action trampoline).
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut out = rpi_plugin_sdk::StbString::empty();
            let rc = (renderer.render_fn)(
                rpi_plugin_sdk::StbStringRef::from_str(&input),
                &mut out as *mut rpi_plugin_sdk::StbString,
                renderer.user_data,
            );
            // SAFETY: the callback transfers a live output to its producer.
            let out = unsafe {
                rpi_plugin_sdk::callbacks::OwnedString::from_raw(
                    out,
                    Some(renderer.plugin_free_string),
                )
            };
            let text = if rc == 0 {
                let s = out.to_string_lossy();
                Some(s)
            } else {
                None
            };
            // The owner reclaims output regardless of rc, including an error
            // response a plugin wrote before returning nonzero.
            text
        }));
        let out_text = match outcome {
            Ok(Some(s)) => s,
            Ok(None) => return current, // rc != 0 — skip this handler, keep current
            Err(_) => return current,   // panic — skip, keep current (do not abort: the
                                         // render path is not the action trampoline; a panicking transformer
                                         // degrades to identity rather than killing the process. Logged via
                                         // the `tracing` crate's panic hook.)
        };
        // Parse `{"markdown": <text>}`; lenient — a missing/non-string field
        // keeps the current text (skip this handler).
        let next = serde_json::from_str::<serde_json::Value>(&out_text)
            .ok()
            .and_then(|v| {
                v.get("markdown")
                    .and_then(|m| m.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or(current);
        current = next;
    }
    current
}

// ===========================================================================
// Slash commands — trait + registry
// ===========================================================================
//
// Each built-in slash command is one `impl SlashCommand`. The commands are
// registered at startup into a [`CommandRegistry`] (one source of truth) that
// serves both dispatch ("given this token, run the command") and autocomplete
// ("list the visible commands"). This replaces the old two-list + sync-test
// arrangement, where `handle_slash_command` and `v1_slash_commands()` had to be
// kept in lock-step by hand.
//
// `execute` runs on the blocking key/compose thread (the editor `on_submit`
// callback and the Ctrl+L hotkey both land there), so it MUST stay synchronous:
//   - commands needing async (`set_model`/`set_thinking_level`/`set_active_tools`)
//     `tokio::spawn` the work and return immediately;
//   - commands needing the main async loop (`compact`/`copy`/`exit`/`clear`/
//     `user-input`) signal it via `ctx.tx.send(TuiMessage::…)`;
//   - everything else mutates the chat container + requests a render directly.

/// The borrowed world a slash command runs against. All fields are `Arc` (or a
/// cheap `String` snapshot), so one `CommandContext` clones freely into each
/// command without per-capture ceremony — this struct is exactly the set of
/// `*_for_cb` clones the old submit closure used to make individually.
#[derive(Clone)]
struct CommandContext {
    chat: Arc<Container>,
    tui: Arc<TuiAltScreen>,
    tx: mpsc::UnboundedSender<TuiMessage>,
    state: Arc<TuiState>,
    editor: Arc<Editor>,
    editor_container: Arc<Container>,
    lane: Arc<dyn AgentLane>,
    model_catalog: Arc<std::sync::RwLock<Vec<rpi_ai::Model>>>,
    cwd: std::path::PathBuf,
    /// Loaded resources for /context; refreshed after successful /reload.
    resources: Arc<Mutex<rpi_harness::types::AgentHarnessResources>>,
    /// B5d: the reload context `/reload` drives. `Arc<ReloadContext>` so the
    /// blocking submit thread can cheaply clone it into the `ReloadCommand`
    /// without an `.await` (the command can't drive reload directly — it signals
    /// the main loop via `TuiMessage::ReloadExtensions`, which awaits the shared
    /// `reload_extension_resources` routine on the async runtime).
    reload_context: Arc<crate::session::ReloadContext>,
    /// The product-layer session (`AgentSession`). Commands that need durable
    /// reads, export, or usage stats go through this instead of reaching into
    /// the harness directly, so the product surface is one object.
    session: Arc<crate::agent_session::AgentSession>,
}

/// One slash command.
trait SlashCommand: Send + Sync {
    /// Canonical name, with the leading `/` (e.g. "/model").
    fn name(&self) -> &str;
    /// Aliases, also `/`-prefixed. Matched alongside `name()` during dispatch.
    /// Use [`SlashCommand::alias_visible`] to also surface an alias in the
    /// `/`-autocomplete list (most aliases stay hidden).
    fn aliases(&self) -> &'static [&'static str] {
        &[]
    }
    /// Whether the canonical name appears in the `/` autocomplete list. Hidden
    /// commands (`/context`, `/name`, …) return `false`.
    fn visible(&self) -> bool {
        true
    }
    /// Aliases that should also appear in the `/` autocomplete list. Defaults to
    /// none — most aliases (`/q`, `/m`, `/think`, `/resume`, `/v`) are kept off
    /// the list to keep it short. `/new` and `/quit` override this to surface.
    fn alias_visible(&self) -> &'static [&'static str] {
        &[]
    }
    /// Description shown in autocomplete and `/help`. A non-empty description is
    /// required to surface in autocomplete even when `visible()` is true.
    fn description(&self) -> &'static str {
        ""
    }
    /// Argument hint shown in the autocomplete row, e.g. "<provider/model>".
    /// The row renders "<hint> — <description>" when this is set.
    fn argument_hint(&self) -> Option<&'static str> {
        None
    }
    fn description_owned(&self) -> String {
        self.description().to_string()
    }
    /// Execute the command. Only invoked for inputs starting with `/` whose
    /// first token matches `name()` or an alias. `args` is the whitespace-
    /// trimmed remainder after the command token ("" when none). Must stay
    /// synchronous (see the module-level note) — async work goes through
    /// `ctx.tx.send(TuiMessage::…)` or `tokio::spawn`.
    fn execute(&self, ctx: &CommandContext, args: &str);
}

/// Holds all registered slash commands; the single source of truth for both
/// dispatch and the autocomplete list.
struct CommandRegistry {
    commands: Vec<Arc<dyn SlashCommand>>,
}

impl CommandRegistry {
    fn new() -> Self {
        Self {
            commands: Vec::new(),
        }
    }

    fn register(&mut self, cmd: Arc<dyn SlashCommand>) {
        self.commands.push(cmd);
    }

    /// Find the command whose `name()` or an alias matches `token` (e.g. "/q").
    /// `token` is the first whitespace-delimited word of the input, `/`-prefixed.
    fn find(&self, token: &str) -> Option<&Arc<dyn SlashCommand>> {
        self.commands
            .iter()
            .find(|c| c.name() == token || c.aliases().contains(&token))
    }

    /// The autocomplete entries, derived from the registry so it can never drift
    /// from what dispatch recognizes. Surfaces the canonical name when
    /// `visible()` + non-empty description, plus any `alias_visible()` entries.
    /// Order = registration order; built-ins are registered before templates,
    /// so they win on a fuzzy tie (unchanged).
    fn visible_entries(&self) -> Vec<SlashCommandEntry> {
        let mut out: Vec<SlashCommandEntry> = Vec::new();
        for c in &self.commands {
            let description = c.description_owned();
            if c.visible() && !description.is_empty() {
                out.push(SlashCommandEntry {
                    name: c.name().into(),
                    description: description.clone(),
                    // The row shows the argument hint in front of the
                    // description (`<hint> — <description>`); the tui library
                    // builds that text from the two parts.
                    argument_hint: c.argument_hint().map(str::to_string),
                });
            }
            // Surfaced aliases share the command's description.
            for alias in c.alias_visible() {
                out.push(SlashCommandEntry {
                    name: (*alias).into(),
                    description: description.clone(),
                    argument_hint: c.argument_hint().map(str::to_string),
                });
            }
        }
        out
    }
}

/// Dispatch a ui_prompt_start event to extensions.
fn dispatch_ui_prompt_event(state: &TuiState) {
    use rpi_plugin_sdk::EventTag;

    if let Ok(session) = state.extension_session.lock() {
        if let Some(snapshot) = session.snapshot_arc() {
            rpi_extensions::dispatch_empty_event(&snapshot, EventTag::UiPromptStart);
        }
    }
}

/// Dispatch a ui_prompt_end event to extensions.
fn dispatch_ui_prompt_event_end(state: &TuiState) {
    use rpi_plugin_sdk::EventTag;

    if let Ok(session) = state.extension_session.lock() {
        if let Some(snapshot) = session.snapshot_arc() {
            rpi_extensions::dispatch_empty_event(&snapshot, EventTag::UiPromptEnd);
        }
    }
}

/// Canonical key name for a key event, matching the vocabulary
/// [`parse_configured_key`] accepts (`"space"`, `"enter"`, `"f1"`, `"a"`).
/// `None` for keys that cannot be named (media keys, unknown codes).
fn key_shortcut_name(code: KeyCode) -> Option<&'static str> {
    Some(match code {
        KeyCode::Char(' ') => "space",
        KeyCode::Enter => "enter",
        KeyCode::Esc => "escape",
        KeyCode::Tab => "tab",
        KeyCode::BackTab => "backtab",
        KeyCode::Backspace => "backspace",
        KeyCode::Delete => "delete",
        KeyCode::Up => "up",
        KeyCode::Down => "down",
        KeyCode::Left => "left",
        KeyCode::Right => "right",
        KeyCode::Home => "home",
        KeyCode::End => "end",
        KeyCode::PageUp => "pageup",
        KeyCode::PageDown => "pagedown",
        _ => return None,
    })
}

/// Lower-case name for a printable ASCII key (`a`, `1`, `,`), or `None` when the
/// key needs a dedicated name from [`key_shortcut_name`].
fn char_shortcut_name(ch: char) -> Option<String> {
    if ch.is_ascii_graphic() {
        Some(ch.to_ascii_lowercase().to_string())
    } else {
        None
    }
}

/// Route one key event to extension `Input` handlers when the key is claimed as
/// a shortcut. Returns `true` when the key was claimed (the caller must then
/// skip normal editor handling).
///
/// Only keys an extension explicitly claimed via `register_shortcut` are
/// routed. Function keys also work with a draft; other shortcuts require an
/// empty editor so they never steal ordinary typing. Press **and** Release (and Repeat) are dispatched, which is
/// what lets a push-to-talk extension measure how long a key was held — the
/// normal editor path deliberately drops Release.
fn dispatch_key_event(state: &TuiState, key: &KeyEvent, editor: &Editor) -> bool {
    use rpi_plugin_sdk::EventTag;

    let owned_release = key.kind == KeyEventKind::Release
        && state
            .extension_claimed_keys
            .lock()
            .unwrap()
            .remove(&key.code);
    // Modal input owns its keys, including function keys and cancellation.
    // The draft editor can be empty even while the dialog has text/focus.
    if !owned_release
        && (state.extension_dialog_open() || state.selector_open() || state.search.is_active())
    {
        return false;
    }

    let name = key_shortcut_name(key.code)
        .map(str::to_string)
        .or_else(|| match key.code {
            KeyCode::Char(ch) => char_shortcut_name(ch),
            KeyCode::F(n) => Some(format!("f{n}")),
            _ => None,
        });
    let Some(name) = name else {
        return false;
    };

    let Ok(session) = state.extension_session.lock() else {
        return false;
    };
    let Some(snapshot) = session.snapshot_arc() else {
        return false;
    };
    // Nothing claimed this key (or nobody subscribes to Input) — not ours.
    if !snapshot.has_shortcut(&name) || snapshot.handlers_for(EventTag::Input).is_empty() {
        return false;
    }
    // Function keys do not insert text. Other keys belong to the draft editor
    // while composing (space especially).
    if !owned_release && !editor.get_text().is_empty() && !matches!(key.code, KeyCode::F(_)) {
        return false;
    }

    let kind = match key.kind {
        KeyEventKind::Press => "press",
        KeyEventKind::Repeat => "repeat",
        KeyEventKind::Release => "release",
    };
    let payload = serde_json::json!({
        "type": "key",
        "key": name,
        "kind": kind,
        "ctrl": key.modifiers.contains(KeyModifiers::CONTROL),
        "alt": key.modifiers.contains(KeyModifiers::ALT),
        "shift": key.modifiers.contains(KeyModifiers::SHIFT),
    })
    .to_string();
    // The handler decides whether it actually wants the key: it returns the
    // `CLAIMED` code while its feature is active and `CONTINUE` otherwise, so a
    // registered-but-disabled shortcut (push-to-talk toggled off) still lets the
    // key reach the editor normally.
    let claimed =
        rpi_extensions::dispatch_data_event_claiming(&snapshot, EventTag::Input, &payload);
    if claimed && key.kind == KeyEventKind::Press {
        state
            .extension_claimed_keys
            .lock()
            .unwrap()
            .insert(key.code);
    }
    claimed
}

/// Expand a skill command and a prompt template in the submitted text.
///
/// The original expands in `AgentSession.prompt` **and** in the queueing path
/// (`packages/coding-agent/src/core/agent-session.ts:2258`), so a message typed
/// while the agent is running is expanded too. The port expands in the
/// harness's `prompt_text` (the idle path) and here (the queueing path).
fn expand_for_resources(ctx: &CommandContext, text: &str) -> String {
    let resources = match ctx.resources.lock() {
        Ok(resources) => resources,
        Err(_) => return text.to_string(),
    };
    let expanded = match resources.skills.as_deref() {
        Some(skills) => rpi_harness::skills::expand_skill_command(text, skills),
        None => text.to_string(),
    };
    match resources.prompt_templates.as_deref() {
        Some(templates) => rpi_harness::prompt_templates::expand_prompt_template(&expanded, templates),
        None => expanded,
    }
}

/// The autocomplete description of a prompt template.
///
/// Mirrors the original's rendering (`packages/tui/src/autocomplete.ts:355`):
/// the argument hint comes first, separated by an em dash, and the description
/// follows. A template with no description shows only the hint.
fn template_autocomplete_description(template: &rpi_harness::types::PromptTemplate) -> String {
    let description = template
        .description
        .clone()
        .unwrap_or_else(|| "Expand prompt template".to_string());
    match template.argument_hint.as_deref() {
        Some(hint) if !hint.is_empty() => {
            if description.is_empty() {
                hint.to_string()
            } else {
                format!("{hint} — {description}")
            }
        }
        _ => description,
    }
}

/// Aliases the original rewrites only when the input is the bare command name.
const BARE_ALIASES: &[&str] = &["/history", "/sessions"];

/// Whether the input's first word is a command invocation. The original
/// rewrites a bare alias only, so `/history some text` stays a message
/// (`packages/coding-agent/src/core/slash-commands.ts:57-68`).
fn is_command_token(token: &str, args: &str) -> bool {
    if !args.is_empty() && BARE_ALIASES.contains(&token) {
        return false;
    }
    true
}

/// Resolve a command for a `/`-prefixed input and run it when one matches.
///
/// Unknown slash-prefixed input is deliberately left for the normal prompt
/// path. In particular, the upstream skill-command behavior keeps an unknown
/// `/skill:name` intact so the model can still handle it; it must not be
/// converted into a local error before input handlers or the agent see it.
/// Returns `true` only when a registered slash command handled the input.
fn dispatch_slash(text: &str, ctx: &CommandContext, registry: &CommandRegistry) -> bool {
    let mut parts = text.split_whitespace();
    let token = parts.next().unwrap_or("");
    let args = parts.collect::<Vec<_>>().join(" ");
    // The original rewrites a bare alias only: `/history some text` is not an
    // alias invocation and stays a message.
    if !is_command_token(token, &args) {
        return false;
    }
    match registry.find(token) {
        Some(cmd) => {
            cmd.execute(ctx, &args);
            true
        }
        None => false,
    }
}

/// Current wall-clock time in milliseconds since the Unix epoch. Used for
/// `bashExecution` message timestamps (agent-loop messages carry real times, so
/// the transcript record must too).
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Parse a submitted line into a user shell command.
///
/// Mirrors upstream's `text.startsWith("!")` handling
/// (`interactive-mode.ts:3225`): `!cmd` runs and is recorded in the session
/// context, `!!cmd` is excluded from it. Returns `None` for a bare `!` / `!!`
/// (or whitespace only), so the line falls through to the normal prompt path.
fn parse_user_bash(text: &str) -> Option<(&str, bool)> {
    let rest = text.strip_prefix('!')?;
    let (command, exclude_from_context) = match rest.strip_prefix('!') {
        Some(command) => (command, true),
        None => (rest, false),
    };
    let command = command.trim();
    if command.is_empty() {
        return None;
    }
    Some((command, exclude_from_context))
}

/// Run a `!command` submitted from the editor.
///
/// The command executes out-of-band — it never reaches the model. Output
/// streams into a [`BashExecutionComponent`] in the transcript and the
/// terminal result is handed to the main loop, which persists it as a
/// `bashExecution` message (skipped from context for `!!`). Mirrors
/// `handleBashCommand` (`interactive-mode.ts:6729`).
fn start_user_bash(ctx: &CommandContext, command: &str, exclude_from_context: bool) {
    rpi_extensions::emit_event(
        "user_bash",
        &serde_json::json!({
            "type": "user_bash",
            "command": command,
            "excludeFromContext": exclude_from_context,
            "cwd": ctx.cwd.to_string_lossy(),
        }),
    );
    let comp = Arc::new(BashExecutionComponent::new_with_context(
        command,
        exclude_from_context,
    ));
    comp.set_expanded(*ctx.state.tool_outputs_expanded.lock().unwrap());
    ctx.chat.add_child(comp.clone());

    // Register the cancellation slot before spawning so an Esc arriving on the
    // key thread can never miss the run (upstream's `_bashAbortControllers`).
    let cancel = ctx.state.begin_user_bash();
    ctx.tui.request_render(false);

    let env: Arc<dyn rpi_tools::ExecutionEnv> =
        Arc::new(rpi_tools::OsExecutionEnv::with_cwd(ctx.cwd.clone()));
    let tui = ctx.tui.clone();
    let tx = ctx.tx.clone();
    let cwd = ctx.cwd.clone();
    let command_owned = command.to_string();

    tokio::spawn(async move {
        let comp_chunk = comp.clone();
        let tui_chunk = tui.clone();
        let on_chunk: Box<
            dyn FnMut(&str, &dyn Fn() -> rpi_tools::shell_output::ShellCaptureProgress) + Send,
        > = Box::new(move |_chunk, get_progress| {
            // The capture layer reports the complete tail captured so far, not
            // a delta; `append_output` replaces its snapshot accordingly.
            comp_chunk.append_output(&get_progress().output);
            tui_chunk.request_render(false);
        });
        let options = rpi_tools::shell_output::ShellCaptureOptions {
            cwd: Some(cwd),
            cancel: Some(&cancel),
            on_chunk: Some(on_chunk),
            return_execution_errors: true,
            ..Default::default()
        };
        let result =
            rpi_tools::shell_output::execute_shell_with_capture(&env, &command_owned, options)
                .await;

        // `Ok` carries the real exit code/cancellation; `Err` is a transport
        // level failure (spawn failure, invalid env) which we surface inline.
        let (exit_code, cancelled, output, truncated, full_output_path) = match result {
            Ok(capture) => (
                capture.exit_code,
                capture.cancelled,
                capture.output.clone(),
                capture.truncated,
                capture
                    .full_output_path
                    .as_ref()
                    .map(|path| path.to_string_lossy().into_owned()),
            ),
            Err(error) => (
                None,
                false,
                format!("Bash command failed: {error}"),
                false,
                None,
            ),
        };
        comp.append_output(&output);
        comp.set_complete(
            exit_code,
            cancelled,
            BashTruncation {
                truncated,
                full_output_path: full_output_path.clone(),
            },
        );
        tui.render_now(false);

        let _ = tx.send(TuiMessage::UserBashFinished(UserBashReport {
            command: command_owned,
            output,
            exit_code,
            cancelled,
            truncated,
            full_output_path,
            exclude_from_context,
        }));
    });
}

// ===========================================================================
// Channel + helpers
// ===========================================================================

#[derive(Clone, Copy, Debug)]
enum ProviderOAuthPurpose {
    Login,
    Logout,
}

/// Message type for communication between the key/callback threads and the
/// main async loop.
enum TuiMessage {
    UserInput(String, Vec<rpi_ai::types::ImageContent>),
    /// Provider changes are serialized with prompts, after the current run.
    SwitchProvider(String),
    OpenProviderSelector,
    OpenTree,
    NavigateTree(String),
    Exit,
    /// Clear the transcript (from `/clear`).
    ClearChat,
    /// Start a new session (from `/new`).
    NewSession,
    /// Compact the conversation (from `/compact`).
    Compact,
    /// Copy the last assistant reply to the clipboard (from `/copy`).
    Copy,
    /// Hot-switch to another saved session (from the `/session` selector):
    /// the payload is the session id the selector's item value carried.
    SwitchSession(String),
    /// Export the current session to a markdown file (from `/export`).
    ExportSession,
    /// Export session with specific format
    ExportSessionWithFormat(crate::export::ExportFormat),
    /// Show live usage/context stats (from `/usage` and `/context`).
    ShowUsage,
    /// Browse and run a skill (from `/skills`).
    ShowSkills,
    /// Report a bug to the original's developers (from `/bug <description>`).
    ReportBug(String),
    /// Show the session info and stats (from `/stats`).
    ShowStats,
    /// Fork the current session into a new one and switch to it (from `/fork`).
    ForkSession,
    /// Rename the current session (from `/name <name>`).
    SetSessionName(String),
    /// Import a JSONL session file into the session dir and switch to it
    /// (from `/import <path>`).
    ImportSession(String),
    /// The import was confirmed in the "Replace current session with <path>?"
    /// prompt; the session is replaced now.
    ImportSessionConfirmed(String),
    /// Share the current session (`/share`): `gh gist create` when the gh CLI
    /// is available, otherwise copy the transcript to the clipboard.
    ShareSession,
    /// `/reload` — re-run extension + resource discovery into the live harness
    /// (B5d). The command (and a plugin's `runtime_action(Reload)` via the
    /// mailbox) signal the main loop, which awaits
    /// `reload_extension_resources` on the async runtime.
    ReloadExtensions,
    /// Request an OAuth action. The action itself runs off the main loop because
    /// provider callbacks are synchronous FFI calls and may wait for user
    /// interaction (for example, a browser/device-code exchange).
    ProviderOAuthAction {
        provider: String,
        action: String,
        input: serde_json::Value,
        purpose: ProviderOAuthPurpose,
        flow_id: u64,
    },
    /// Result of one provider-owned OAuth action.
    ProviderOAuthResult {
        provider: String,
        action: String,
        result: Result<serde_json::Value, String>,
        purpose: ProviderOAuthPurpose,
        flow_id: u64,
    },
    /// Request provider-aware logout. OAuth credentials are revoked before the
    /// local auth entry is removed; API-key credentials are removed directly.
    LogoutProvider(String),
    /// editor. Handling it on the async loop keeps editor mutation single-
    /// threaded with the rest of the TUI state.
    ExternalEditorResult(Result<String, String>),
    /// A user-initiated `!command` / `!!command` shell run finished. Routed to
    /// the main loop so the `bashExecution` transcript record is persisted in
    /// order relative to agent runs (upstream's `recordBashResult` /
    /// `_pendingBashMessages`).
    UserBashFinished(UserBashReport),
}

/// Terminal result of a user-initiated `!command` shell run.
///
/// Carries everything needed to build the persisted `bashExecution` message
/// plus the `!!` context-exclusion flag. See `start_user_bash`.
struct UserBashReport {
    command: String,
    output: String,
    exit_code: Option<i32>,
    cancelled: bool,
    truncated: bool,
    full_output_path: Option<String>,
    exclude_from_context: bool,
}

/// Extract the concatenated text content from an assistant message (mirrors
/// the TS `contentText` projection — drops thinking/tool-call/image blocks).
fn assistant_text(msg: &AssistantMessage) -> String {
    msg.content
        .iter()
        .filter_map(|c| match c {
            Content::Text(t) => Some(t.text.clone()),
            _ => None,
        })
        .collect()
}

/// The user message's text (Text content or the text blocks of a Blocks
/// payload — images are skipped, consistent with the v1 text-only prompt path).
fn tool_result_message_text(msg: &rpi_ai::types::ToolResultMessage) -> String {
    msg.content
        .iter()
        .filter_map(|c| match c {
            Content::Text(t) => Some(t.text.clone()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn user_message_text(msg: &rpi_ai::types::UserMessage) -> String {
    match &msg.content {
        rpi_ai::types::UserContent::Text(s) => s.clone(),
        rpi_ai::types::UserContent::Blocks(blocks) => blocks
            .iter()
            .filter_map(|c| match c {
                Content::Text(t) => Some(t.text.clone()),
                _ => None,
            })
            .collect(),
    }
}

/// The catalog allowed in the Ctrl+P cycle: the `/scoped-models` set from
/// settings.json when present, otherwise every model. The current model is
/// always included (fallback) so cycling can never strand the user off-scope.
// ===========================================================================
// interactive_tui — the entry point
// ===========================================================================

#[derive(Debug, PartialEq)]
struct TuiStartupSettings {
    editor_padding_x: usize,
    autocomplete_max_visible: usize,
    hide_thinking: bool,
    /// Show Nerd Font glyphs in front of the footer groups.
    nerd_fonts: bool,
    quiet_startup: bool,
    show_terminal_progress: bool,
    /// Render images inline (`terminal.showImages` / flat `showImages`).
    show_images: bool,
    /// Transcript notices for prompt-cache costs (`showCacheMissNotices`).
    cache_miss_notices: bool,
    /// Show the empty-session screen while the session has no messages
    /// (`threeDEmptySession`).
    three_d_empty_session: bool,
    /// Register the loaded skills as `/skill:<name>` commands
    /// (`enableSkillCommands`). The original defaults it to on
    /// (`packages/coding-agent/src/core/settings-schema.ts:305`).
    enable_skill_commands: bool,
    /// The terminal buffer the TUI draws into (`tuiMode`). The original
    /// defaults to fullscreen on every platform.
    tui_mode: crate::args::TuiMode,
}

fn preferred_project_setting<T>(
    project_settings: &[crate::settings::Settings],
    field: impl Fn(&crate::settings::Settings) -> Option<T>,
) -> Option<T> {
    project_settings.iter().find_map(field)
}

/// Repaint interval of the spinning logo on the empty-session screen
/// (upstream's `FRAME_MS`, `easter-egg-3d.ts:221`).
const LOGO_FRAME_MS: u64 = 1000 / 30;

/// The empty-session screen and the layout root it replaces.
///
/// Upstream shows the screen while the session has no messages
/// (`interactive-mode.ts:922-924`) and takes the pane back as soon as the
/// session has content.
/// The normal layout root (the transcript and the dock), so a selector can
/// take the pane from the 3-D empty-session screen.
static NORMAL_ROOT: LazyLock<Mutex<Option<Arc<dyn Component>>>> =
    LazyLock::new(|| Mutex::new(None));

/// Whether the 3-D empty-session screen owns the pane.
static EMPTY_SESSION_ACTIVE: LazyLock<std::sync::atomic::AtomicBool> =
    LazyLock::new(|| std::sync::atomic::AtomicBool::new(false));

#[derive(Clone)]
struct EmptySession {
    /// The screen, when the setting is on.
    screen: Option<Arc<dyn Component>>,
    /// The normal layout root (transcript + dock).
    normal_root: Arc<dyn Component>,
    /// Whether the screen is up.
    active: Arc<std::sync::atomic::AtomicBool>,
}

impl EmptySession {
    /// Show the screen. A no-op when the setting is off.
    fn activate(&self, tui: &Arc<TuiAltScreen>) {
        let Some(screen) = self.screen.clone() else {
            return;
        };
        if !self.active.swap(true, std::sync::atomic::Ordering::SeqCst) {
            tui.set_layout_root(Some(screen));
            EMPTY_SESSION_ACTIVE.store(true, std::sync::atomic::Ordering::SeqCst);
            spawn_logo_animation(tui.clone(), self.active.clone());
        }
    }

    /// Give the pane back to the transcript.
    fn deactivate(&self, tui: &Arc<TuiAltScreen>) {
        if self.active.swap(false, std::sync::atomic::Ordering::SeqCst) {
            EMPTY_SESSION_ACTIVE.store(false, std::sync::atomic::Ordering::SeqCst);
            tui.set_layout_root(Some(self.normal_root.clone()));
        }
    }
}

/// The logo spins while the screen is up: upstream's `PiLogo3d.setActive`
/// repaints on a timer (`easter-egg-3d.ts:1332-1341`).
fn spawn_logo_animation(tui: Arc<TuiAltScreen>, active: Arc<std::sync::atomic::AtomicBool>) {
    tokio::spawn(async move {
        while active.load(std::sync::atomic::Ordering::SeqCst) {
            tokio::time::sleep(std::time::Duration::from_millis(LOGO_FRAME_MS)).await;
            if !active.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            tui.request_render(false);
        }
    });
}

/// Whether the session already holds a message.
async fn session_has_messages(harness: &AgentHarness) -> bool {
    harness
        .session()
        .find_entry_on_branch(
            &EntryQuery {
                entry_type: Some("message"),
                ..Default::default()
            },
            &Default::default(),
        )
        .await
        .map(|entry| entry.is_some())
        .unwrap_or(false)
}

fn should_show_startup_listing(verbose: bool, quiet_startup: bool) -> bool {
    verbose || !quiet_startup
}

/// `project_settings` is ordered by precedence; an explicit `Some`
/// wins even when the value is `false` or zero.
fn resolve_tui_startup_settings(
    global: &crate::settings::Settings,
    project_settings: &[crate::settings::Settings],
    project_trusted: bool,
) -> TuiStartupSettings {
    let project_settings = if project_trusted {
        project_settings
    } else {
        &[]
    };
    let editor_padding_x =
        preferred_project_setting(project_settings, |settings| settings.editor_padding_x)
            .or(global.editor_padding_x)
            .unwrap_or(0)
            .min(16);
    let autocomplete_max_visible = preferred_project_setting(project_settings, |settings| {
        settings.autocomplete_max_visible
    })
    .or(global.autocomplete_max_visible)
    .unwrap_or(5)
    .clamp(1, 20);
    let hide_thinking =
        preferred_project_setting(project_settings, |settings| settings.hide_thinking_block)
            .or(global.hide_thinking_block)
            .unwrap_or(true);
    let nerd_fonts = preferred_project_setting(project_settings, |settings| settings.nerd_fonts)
        .or(global.nerd_fonts)
        .unwrap_or(false);
    let quiet_startup =
        preferred_project_setting(project_settings, |settings| settings.quiet_startup.clone())
            .or(global.quiet_startup.clone())
            .map(|mode| mode == "true")
            .unwrap_or(false);
    let show_terminal_progress = preferred_project_setting(project_settings, |settings| {
        settings.show_terminal_progress()
    })
    .or_else(|| global.show_terminal_progress())
    .unwrap_or(true);
    let show_images =
        preferred_project_setting(project_settings, |settings| settings.show_images())
            .or_else(|| global.show_images())
            .unwrap_or(true);
    let cache_miss_notices = preferred_project_setting(project_settings, |settings| {
        settings.show_cache_miss_notices
    })
    .or(global.show_cache_miss_notices)
    .unwrap_or(false);
    let three_d_empty_session = preferred_project_setting(project_settings, |settings| {
        settings.three_d_empty_session
    })
    .or(global.three_d_empty_session)
    .unwrap_or(false);
    let tui_mode = preferred_project_setting(project_settings, |settings| {
        settings.tui_mode.clone()
    })
    .or(global.tui_mode.clone())
    .map(|mode| {
        if mode.eq_ignore_ascii_case("regular") {
            crate::args::TuiMode::Regular
        } else {
            crate::args::TuiMode::Fullscreen
        }
    })
    .unwrap_or(crate::args::TuiMode::Fullscreen);
    let enable_skill_commands = preferred_project_setting(project_settings, |settings| {
        settings.enable_skill_commands
    })
    .or(global.enable_skill_commands)
    .unwrap_or(true);

    TuiStartupSettings {
        editor_padding_x,
        autocomplete_max_visible,
        hide_thinking,
        nerd_fonts,
        quiet_startup,
        show_terminal_progress,
        show_images,
        cache_miss_notices,
        three_d_empty_session,
        enable_skill_commands,
        tui_mode,
    }
}

/// TUI-based interactive mode.
///
/// `event_rx` carries the live `AgentEvent` stream (installed by
/// [`crate::session::build`]); when `None` (e.g. a non-TUI caller reuses this
/// fn), it falls back to a blocking, await-final-text path.
///
/// `model_catalog` is the read-only catalog the `/model` selector displays.
///
/// This implementation mirrors the TypeScript `InteractiveMode` class:
/// build the layout root once, drain `AgentEvent`s into UI mutations that
/// mirror `handleEvent`, and dispatch keys from a `spawn_blocking` crossterm
/// loop (the `TuiAltScreen` start() handler is a stub). Selectors and
/// autocomplete are layered on via the editor-container swap pattern.
pub async fn interactive_tui(
    harness: &AgentHarness,
    event_rx: Option<broadcast::Receiver<AgentEvent>>,
    args: &Args,
    model_catalog: Vec<rpi_ai::Model>,
    initial: Option<String>,
    extra_messages: &[String],
    initial_images: Vec<rpi_ai::types::ImageContent>,
    theme: Option<&str>,
    _no_themes: bool,
    reload_context: &crate::session::ReloadContext,
) -> i32 {
    let lane: Arc<dyn AgentLane> = harness.lane("main");
    // Reuse the startup snapshot captured before provider/session setup. An
    // extension may mutate the process cwd while loading; that must not change
    // which project settings or package update roots this TUI observes.
    let cwd = reload_context.cwd.clone();
    let saved_settings = crate::settings::load_settings().unwrap_or_default();
    let project_trusted = reload_context.project_trusted;
    let project_settings = if project_trusted {
        crate::settings::load_project_settings(&cwd)
    } else {
        Vec::new()
    };
    let tui_settings =
        resolve_tui_startup_settings(&saved_settings, &project_settings, project_trusted);
    let editor_padding_x = tui_settings.editor_padding_x;
    let autocomplete_max_visible = tui_settings.autocomplete_max_visible;
    let mut hide_thinking = tui_settings.hide_thinking;
    let nerd_fonts = tui_settings.nerd_fonts;
    let show_terminal_progress = tui_settings.show_terminal_progress;
    let show_images = tui_settings.show_images;
    let cache_miss_notices = tui_settings.cache_miss_notices;
    let quiet_startup = tui_settings.quiet_startup;
    let three_d_empty_session = tui_settings.three_d_empty_session && !args.skip_3d;
    // An explicit `--tui-mode` flag wins over the `tuiMode` setting; without
    // it the setting decides, and the default is fullscreen everywhere.
    let tui_mode = if args.tui_mode_set {
        args.tui_mode
    } else {
        tui_settings.tui_mode
    };
    // rpi only checks its own update channel.
    // Session display preferences (durable, latest-wins) override the
    // settings-file defaults. These are per-session facts stored as custom
    // entries (see `rpi_harness::session::values`), so resuming a session with
    // `-c`/`-r` restores the thinking/tool-output display the user last chose
    // there — independent of global settings. Absent keys leave the settings
    // value untouched.
    let session_values = rpi_harness::session::SessionValues::load(harness.session())
        .await
        .unwrap_or_default();
    if let Some(persisted) = session_values.get_as::<bool>("display.hide_thinking") {
        hide_thinking = persisted;
    }

    // Resolve the active model once, up front. The full id feeds the TuiState
    // tracking field + the selectors/key loop (which run on a blocking thread
    // and can't await `lane.get_model()`); the provider + model id feed the
    // footer, which renders them as `provider/model` (pi's footer group).
    let lane_model = lane.get_model().await.ok();
    let lane_model_id = lane_model
        .as_ref()
        .map(|model| model.id.clone())
        .unwrap_or_default();
    // A session without an authenticated model has no model in the footer:
    // pi shows `no-model`, no provider and no thinking group.
    let has_model = lane_model
        .as_ref()
        .is_some_and(|model| model.id != crate::provider::NO_MODEL_ID);
    let model_id = if has_model {
        lane_model
            .as_ref()
            .map(|model| short_model_name(&model.id))
            .unwrap_or_else(|| short_model_name(&lane_model_id))
    } else {
        crate::provider::NO_MODEL_ID.to_string()
    };
    let model_provider = if has_model {
        lane_model.as_ref().map(|model| model.provider.clone())
    } else {
        None
    };
    let model_reasoning = has_model
        && lane_model.as_ref().map(|model| model.reasoning).unwrap_or(false);
    // A subscription-backed provider shows the `(sub)` marker next to the cost
    // (pi's `isUsingSubscription`: an OAuth-backed provider, plus kimi-coding).
    let using_subscription = model_provider.as_deref().is_some_and(|provider| {
        provider == "kimi-coding"
            || crate::config::read_oauth_token(provider)
                .ok()
                .flatten()
                .is_some()
    });

    // Snapshot the resources for the slash-command templates and the /context
    // panel. The accessor returns a defensive clone, so this does not retain a
    // harness lock or trigger a second resource scan.
    let resources_snapshot = harness.get_resources().await.unwrap_or_default();

    // Channel between the key/callback threads and the main async loop.
    let (tx, mut rx) = mpsc::unbounded_channel::<TuiMessage>();

    // Apply the saved theme before constructing transcript components. Some
    // components keep styled text, so doing this after the welcome banner left
    // the first screen in the dark palette until it was rebuilt.
    let theme_manager = Arc::new(ThemeManager::new());
    if let Some(preset) = match theme {
        Some("light") => Some(ThemePreset::Light),
        Some("monochrome") => Some(ThemePreset::Monochrome),
        Some("dark") => Some(ThemePreset::Dark),
        _ => None,
    } {
        apply_theme_preset(preset);
        theme_manager.apply_preset(preset);
    }

    // ---- TUI + containers ----
    let terminal = Box::new(ProcessTerminal::new());
    let tui = Arc::new(TuiAltScreen::new(terminal, true, None));
    // The alternate screen owns the mouse selection, so it copies through the
    // system clipboard instead of an OSC 52 write the terminal may drop.
    tui.set_copy_selection(Arc::new(|text: &str| {
        crate::interactive_tui::run::copy_to_clipboard(text)
    }));
    tui.set_copy_on_select(
        crate::settings::load_settings()
            .ok()
            .and_then(|settings| settings.fullscreen_copy_on_select)
            .unwrap_or(true),
    );
    // Plugin `ask_user` prompts (runtime action 17). Attaching marks this
    // session as interactive so a detached/headless host fails loudly instead
    // of returning a fabricated answer. The mailbox is session-scoped (held in
    // `ReloadContext`) so in-flight prompts survive a `/reload`.
    let ask_user_bridge = AskUserBridge::new(reload_context.ui_dialog.clone());
    ask_user_bridge.attach();
    tui.set_main_screen_mode(matches!(tui_mode, crate::args::TuiMode::Regular));
    // pi sets the window title once, before the first render
    // (`interactive-mode.ts:1232-1236`).
    let session_name = harness.session().get_name().await.ok().flatten();
    tui.set_title(&crate::window_title::window_title(session_name.as_deref(), &cwd));
    // The progress hairline is gated by `terminal.showTerminalProgress`.
    progress::set_progress_enabled(show_terminal_progress);

    let chat_container = Arc::new(Container::new());
    // First-launch gate: the original asks for a theme on a fresh install and
    // never again. The picker owns the pane until it is confirmed or skipped.
    // See `extras.rs`.
    let first_run: Arc<std::sync::Mutex<Option<Arc<FirstRunDialog>>>> =
        Arc::new(std::sync::Mutex::new(None));
    if let Some(dialog) = crate::extras::first_run_dialog(&theme_manager) {
        *first_run.lock().unwrap() = Some(dialog);
    }
    // The startup header is a component of its own, so `app.tools.expand` can
    // re-render it expanded and the mark can be clicked (upstream's
    // `BuiltInHeader`).
    let startup_header = Arc::new(StartupHeader::new(
        crate::changelog::current_version(),
        should_show_startup_listing(args.verbose, quiet_startup),
    ));
    {
        let tui_for_logo: Arc<dyn TUI> = tui.clone();
        startup_header.set_logo_click(Some(Arc::new(move |column, row| {
            rpi_tui::easter_egg_3d::play_pi_logo_3d(&tui_for_logo, column, row);
        })));
    }
    add_startup_header(&chat_container, &startup_header);
    add_tmux_warning(&chat_container);

    let collapse_changelog =
        preferred_project_setting(&project_settings, |settings| settings.collapse_changelog)
            .or(saved_settings.collapse_changelog)
            .unwrap_or(false);
    maybe_add_startup_changelog(
        &harness,
        &chat_container,
        &saved_settings,
        collapse_changelog,
    )
    .await;

    // A --continue/--resume/--session launch opens on an existing JSONL
    // session — render its prior user/assistant transcript so the user sees
    // where they left off (tool executions are skipped: their live display
    // belongs to the current run, and replaying old results would be noise).
    let initial_transformer = build_markdown_transformer(
        reload_context
            .extension_session
            .lock()
            .unwrap()
            .snapshot_arc(),
    );
    // A normal launch creates a fresh session and must not replay records from
    // another/project harness. Only explicit restore/fork modes render prior
    // conversation history. This fixes stale prompts appearing every startup.
    if launch_restores_history(args) {
        render_session_history(
            &harness,
            &chat_container,
            initial_transformer.clone(),
            Some(reload_context.extension_session.clone()),
            show_images,
        )
        .await;
    }

    // `document_container` wraps the welcome header + chat so the scrollview
    // follows the whole transcript (mirrors TS `documentContainer`).
    let document_container = Arc::new(Container::new());
    // The header slot an extension replaces with its own component (upstream's
    // `headerContainer`).
    let header_container = Arc::new(Container::new());
    document_container.add_child(header_container.clone());
    document_container.add_child(chat_container.clone());
    // Add bottom padding to the output area for visual breathing room.
    document_container.add_child(Arc::new(Spacer::new(1)));

    let pet_document = Arc::new(pet::PetDocument::new(
        document_container.clone(),
        reload_context.ext_status.clone(),
    ));
    let scroll_view = Arc::new(ScrollView::new(
        pet_document.clone(),
        ScrollViewOptions {
            follow: FollowMode::End,
            primary: true,
            overscroll: OverscrollMode::Chain,
            // upstream keeps transcript chrome out of the way. Our Auto mode
            // has no hide timer yet and therefore became effectively permanent
            // after the first wheel event, unlike the upstream experience.
            scrollbar: ScrollbarMode::Hidden,
            ..Default::default()
        },
    ));

    // ---- Editor ----
    // Bordered box matching upstream: no `> ` prompt, no placeholder — the
    // editor renders full-width `─` top/bottom borders with padding-only lines
    // (see Editor::render). padding_x:1 gives a 1-col inset inside the box.
    let keybindings = configured_keybindings();
    crate::transcript_navigation::install(&tui, keybindings.clone());
    let editor = Arc::new(Editor::new(
        EditorOptions {
            padding_x: editor_padding_x,
            autocomplete_max_visible,
            max_content_height: Some(12),
            show_scroll_hints: false,
            ..Default::default()
        },
        EditorStyle::default(),
        keybindings.clone(),
    ));

    // ---- Footer + status ----
    let footer = Arc::new(FooterComponent::new());
    footer.set_model(&model_id);
    footer.set_provider(model_provider.as_deref());
    footer.set_model_reasoning(model_reasoning);
    if has_model {
        if let Ok(level) = lane.get_thinking_level().await {
            footer.set_thinking_level(Some(thinking_level_name(level)));
        }
    }
    footer.set_cwd(&cwd.to_string_lossy());
    footer.set_git_branch(git_branch_for(&cwd).as_deref());
    if let Some(m) = model_catalog.iter().find(|m| m.id == lane_model_id) {
        footer.set_context_window(m.context_window as i64);
    }
    footer.set_using_subscription(using_subscription);
    footer.set_nerd_fonts(nerd_fonts);

    // Live git-branch refresh (native fs-watch on `.git/HEAD`): a checkout or
    // commit updates the footer's branch without a manual refresh.
    let _branch_watcher = find_git_head_path(&cwd).map(|head| {
        let footer_ref = footer.clone();
        let cwd_ref = cwd.clone();
        crate::fs_watch::watch_path(head, move || {
            footer_ref.set_git_branch(git_branch_for(&cwd_ref).as_deref());
        })
    });

    let status_container = Arc::new(Container::new());
    let loader = Arc::new(Loader::with_text("Working…"));

    // The widget slots above and below the editor (upstream's
    // `widgetContainerAbove` / `widgetContainerBelow`).
    let widget_above = Arc::new(Container::new());
    let widget_below = Arc::new(Container::new());

    // The JavaScript extensions the user named: a `--extension`/`-e` path that
    // is a TypeScript file, and the `--extensions-dir` directories.
    let js_extension_args: Vec<std::path::PathBuf> = args
        .extension
        .iter()
        .chain(args.extensions_dir.iter())
        .filter(|path| path.is_dir() || crate::js_extensions::is_javascript_extension(path))
        .cloned()
        .collect();

    // ---- JavaScript extensions ----
    //
    // pi's TypeScript extensions live next to the session: the project's
    // `.pi/extensions`, the agent directory's `extensions`, and whatever the
    // user named with `--extension`. They load into the embedded V8 and reach
    // the screen through the widget slots and the status line.
    let js_agent_dir = crate::config::agent_dir().unwrap_or_else(|_| cwd.clone());
    let js_extension_paths = crate::js_extensions::discover_extension_paths(
        &cwd,
        &js_agent_dir,
        &js_extension_args,
    );
    let js_extensions = if js_extension_paths.is_empty() {
        None
    } else {
        let extensions = crate::js_extensions::JsExtensions::new();
        extensions.set_chat(chat_container.clone());
        extensions.set_widget_slots(widget_above.clone(), widget_below.clone());
        extensions.set_render_hook(Arc::new({
            let tui = tui.clone();
            move || tui.request_render(false)
        }));
        // The host answers the session questions from the same session the
        // native plugins drive: the harness-backed actions, the editor, the
        // chrome hooks and the session's identity.
        let session = crate::js_extensions::JsSession {
            actions: reload_context
                .action_bridge
                .lock()
                .ok()
                .and_then(|slot| slot.as_ref().map(|bridge| bridge.runtime_action_host())),
            ui_dialog: Some(reload_context.ui_dialog.clone()),
            editor_text: Some(reload_context.editor_text.clone()),
            runtime: Some(reload_context.runtime.clone()),
            editor: Some(editor.clone()),
            set_title: Some(Arc::new({
                let tui = tui.clone();
                move |title: &str| {
                    tui.set_title(title);
                }
            })),
            set_working: Some(Arc::new({
                let editor = editor.clone();
                move |message: Option<String>| {
                    match message {
                        Some(text) => editor.set_working(Some(rpi_tui::WorkingState {
                            frame: 0,
                            started_at: std::time::Instant::now(),
                            message: text,
                        })),
                        None => editor.set_working(None),
                    }
                }
            })),
            project_trusted: std::sync::atomic::AtomicBool::new(reload_context.project_trusted),
            ..Default::default()
        };
        let session = Arc::new(session);
        extensions.set_session(Arc::clone(&session));
        // Every pi event the host publishes reaches the extensions through one
        // sink, so the provider hooks (which live in the extension crate) and
        // the agent events (which the harness emits) arrive the same way.
        let sink = crate::js_emitter::JsEventSink::new();
        sink.set_extensions(extensions.clone());
        rpi_extensions::install_event_sink(sink);
        for path in &js_extension_paths {
            if let Err(error) = extensions.load(path) {
                add_note_message(
                    &chat_container,
                    &format!("Failed to load extension \"{}\": {error}", path.display()),
                );
            }
        }
        // The extension's tools are declared to the model: a tool the
        // extension registers has to be in the session's tool set, or the
        // model cannot call it.
        let mut harness_tools = harness.get_tools().await.unwrap_or_default();
        let mut active_tools = harness
            .lane("main")
            .get_active_tools()
            .await
            .unwrap_or_default();
        for entry in extensions.tools() {
            let name = entry
                .get("name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_string();
            if name.is_empty() {
                continue;
            }
            let label = entry
                .get("label")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(&name)
                .to_string();
            let description = entry
                .get("description")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_string();
            let parameters = entry
                .get("parameters")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({ "type": "object" }));
            let tool = crate::js_tools::JsTool::new(
                extensions.clone(),
                &name,
                &label,
                &description,
                parameters,
            );
            harness_tools.retain(|slot| slot.tool.schema().name != name);
            harness_tools.push(rpi_harness::types::HarnessTool::new(Arc::new(tool)));
            if !active_tools.contains(&name) {
                active_tools.push(name);
            }
        }
        harness
            .set_tools(harness_tools, Some(active_tools))
            .await
            .ok();

        // The provider hooks are what publish the events that fire on every
        // LLM call (`before_provider_request`, `before_provider_headers`,
        // `after_provider_response`, `before_agent_start`) and the `context`
        // events. The native path installs them when a native plugin
        // subscribes; the JavaScript extensions subscribe the same way, so the
        // hooks go in when they load.
        harness
            .set_provider_hooks(Some(Arc::new(
                rpi_extensions::ExtensionProviderHooks::for_javascript(),
            )))
            .await
            .ok();
        Some(extensions)
    };

    // ---- Autocomplete (slash commands + @file paths, rooted at cwd) ----
    // Prompt templates discovered at session build (Part A2) are surfaced as
    // `/`-prefixed entries alongside the built-in slash commands: typing
    // `/<name>` in the editor expands the template (mirrors pi
    // `expandPromptTemplate`, `agent-session.ts:1124`). The description carries
    // the template's frontmatter description (or a fallback) so the autocomplete
    // popover shows what each template does.
    //
    // Build autocomplete from the initial templates. /context shares a resource
    // snapshot that the async reload handler refreshes, so its blocking command
    // can list the current files without awaiting the harness accessor.
    let template_slash_commands: Vec<SlashCommandEntry> = resources_snapshot
        .prompt_templates
        .clone()
        .unwrap_or_default()
        .iter()
        .map(|t| SlashCommandEntry {
            name: format!("/{}", t.name),
            description: t
                .description
                .clone()
                .unwrap_or_else(|| "Expand prompt template".to_string()),
            argument_hint: t.argument_hint.clone(),
        })
        .collect();
    let resources_arc = Arc::new(Mutex::new(resources_snapshot));
    // Build the built-in command registry once — the single source of truth for
    // both dispatch and the built-in autocomplete entries. The discovered
    // prompt-template commands are merged into the autocomplete list separately
    // (they dispatch via template expansion, not the registry); built-ins come
    // first so they win on a fuzzy tie.
    let mut command_registry = build_builtin_registry();
    register_extension_commands(
        &mut command_registry,
        reload_context.extension_session.clone(),
    );
    if let Some(extensions) = js_extensions.clone() {
        register_js_extension_commands(&mut command_registry, extensions);
    }
    let registry = Arc::new(command_registry);
    let mut all_slash_commands = registry.visible_entries();
    all_slash_commands.extend(template_slash_commands);
    let skill_mentions = resources_arc
        .lock()
        .unwrap()
        .skills
        .clone()
        .unwrap_or_default();
    // The original registers every loaded skill as a slash command named
    // `skill:<name>` with the skill's description
    // (`packages/coding-agent/src/core/agent-session.ts:3443`). The
    // `enableSkillCommands` setting decides whether the registration happens
    // at all (`packages/coding-agent/src/core/settings-schema.ts:305`).
    let skill_slash_commands: Vec<SlashCommandEntry> = if tui_settings.enable_skill_commands {
        skill_mentions
            .iter()
            .map(|skill| SlashCommandEntry {
                name: format!("/skill:{}", skill.name),
                description: skill.description.clone(),
                argument_hint: None,
            })
            .collect()
    } else {
        Vec::new()
    };
    // The skill rows join the command list, so `/skill:<name>` is offered next
    // to the built-in commands and the prompt templates.
    all_slash_commands.extend(skill_slash_commands);
    // The session's commands are what an extension reads with
    // `pi.getCommands()`; the host answers from the session.
    if let Some(extensions) = js_extensions.as_ref() {
        extensions.set_commands(
            all_slash_commands
                .iter()
                .map(|entry| {
                    serde_json::json!({
                        "name": entry.name,
                        "description": entry.description,
                        "source": "extension",
                        "sourceInfo": {
                            "path": "",
                            "source": "auto",
                            "scope": "user",
                            "origin": "top-level",
                        },
                    })
                })
                .collect(),
        );
    }
    // `session_start` goes out last, and it does not block the TUI: the
    // handler may open a dialog, which the TUI has to present.
    if let Some(extensions) = js_extensions.clone() {
        let chat_for_start = chat_container.clone();
        tokio::task::spawn_blocking(move || {
            if let Err(error) = extensions.dispatch(
                "session_start",
                serde_json::json!({ "type": "session_start", "reason": "startup" }),
            ) {
                add_note_message(&chat_for_start, &format!("Extension error: {error}"));
            }
        });
    }
    // The `/skills` list shows the same skills.
    let skill_list: Vec<(String, String)> = skill_mentions
        .iter()
        .map(|skill| {
            (
                skill.name.clone(),
                skill.description.clone(),
            )
        })
        .collect();
    let autocomplete = AutocompleteManager::new();
    {
        let mut combined = CombinedAutocompleteProvider::new();
        combined.add_provider(Arc::new(SlashCommandAutocompleteProvider::new(
            all_slash_commands,
        )));
        // The original shows the skill mentions and the file completions
        // together for one `@` query, the mentions first
        // (`packages/tui/src/autocomplete.ts:330-345`). The port's providers
        // are chained, and a chain returns the first provider that answers, so
        // the mention provider takes the file provider and merges its rows.
        combined.add_provider(Arc::new(
            SkillMentionAutocompleteProvider::new(skill_mentions).with_files(Arc::new(
                FilePathAutocompleteProvider::with_root(cwd.clone()),
            )),
        ));
        combined.add_provider(Arc::new(FilePathAutocompleteProvider::with_root(
            cwd.clone(),
        )));
        autocomplete.set_provider(Arc::new(combined));
    }
    let autocomplete_container = Arc::new(Container::new());

    let tool_outputs_expanded = session_values
        .get_as::<bool>("display.tool_outputs_expanded")
        .unwrap_or(false);
    let state = Arc::new(TuiState {
        current_assistant: Arc::new(std::sync::Mutex::new(None)),
        tool_components: Arc::new(std::sync::Mutex::new(HashMap::new())),
        bash_components: Arc::new(std::sync::Mutex::new(HashMap::new())),
        hide_thinking: Arc::new(std::sync::Mutex::new(hide_thinking)),
        tool_outputs_expanded: Arc::new(std::sync::Mutex::new(tool_outputs_expanded)),
        show_terminal_progress,
        status: std::sync::Mutex::new(RunStatus::Idle),
        ext_status: reload_context.ext_status.clone(),
        ext_status_revision: std::sync::atomic::AtomicU64::new(u64::MAX),
        editor_text: reload_context.editor_text.clone(),
        auto_send: std::sync::Mutex::new(None),
        last_editor_text: std::sync::Mutex::new(String::new()),
        programmatic_editor_write: std::sync::atomic::AtomicBool::new(false),
        js_preparation_cancel: std::sync::Mutex::new(None),
        user_bash_cancel: std::sync::Mutex::new(None),
        pending_bash_messages: std::sync::Mutex::new(Vec::new()),
        footer: footer.clone(),
        status_container: status_container.clone(),
        chat_container: chat_container.clone(),
        startup_header: startup_header.clone(),
        warning_container: Arc::new(Container::new()),
        warning_message: std::sync::Mutex::new(String::new()),
        session_menu: std::sync::Mutex::new(SessionMenuState::default()),
        tree_menu: std::sync::Mutex::new(TreeMenuState::default()),
        loader: loader.clone(),
        editor: editor.clone(),
        last_assistant_text: std::sync::Mutex::new(String::new()),
        active_selector: std::sync::Mutex::new(None),
        provider_form: std::sync::Mutex::new(None),
        active_provider_input: std::sync::Mutex::new(None),
        provider_auth_flow_id: std::sync::atomic::AtomicU64::new(0),
        provider_auth_generation: std::sync::atomic::AtomicU64::new(0),
        active_provider_select: std::sync::Mutex::new(None),
        active_extension_editor: std::sync::Mutex::new(None),
        active_extension_input: std::sync::Mutex::new(None),
        active_extension_cancel: std::sync::Mutex::new(None),
        autocomplete,
        autocomplete_container: autocomplete_container.clone(),
        autocomplete_max_visible,
        autocomplete_selection: std::sync::Mutex::new(0),
        pending_images: std::sync::Mutex::new(Vec::new()),
        theme_manager,
        tui: Some(tui.clone()),
        current_model_id: std::sync::Mutex::new(lane_model_id.clone()),
        show_images: std::sync::Mutex::new(show_images),
        cache_miss_notices: std::sync::Mutex::new(cache_miss_notices),
        history: std::sync::Mutex::new(Vec::new()),
        history_index: std::sync::Mutex::new(-1),
        history_draft: std::sync::Mutex::new(None),
        cache_tracker: std::sync::Mutex::new(rpi_harness::cache_stats::CacheMissTracker::new()),
        scoped_edit: std::sync::Mutex::new(None),
        markdown_transformer: Arc::new(std::sync::Mutex::new(initial_transformer)),
        extension_claimed_keys: Mutex::new(Default::default()),
        extension_session: reload_context.extension_session.clone(),
        js_extensions: js_extensions.clone(),
        turn_index: std::sync::atomic::AtomicUsize::new(0),
        search: Arc::new(AltScreenSearch::new()),
        search_bar: Arc::new(SearchBar::new()),
        pending_container: Arc::new(Container::new()),
        dequeue_hint: pending_dequeue_hint(&keybindings),
        pending_snapshot: std::sync::Mutex::new(
            rpi_harness::agent_harness::QueuedMessages::default(),
        ),
        selection_start: std::sync::Mutex::new(None),
        selection_end: std::sync::Mutex::new(None),
    });

    let _compaction_watcher = harness.watch({
        let state = Arc::clone(&state);
        let tui = Arc::clone(&tui);
        move |event| {
            if let rpi_harness::events::HarnessEvent::CompactionProgress(event) = event {
                if event.lane != "main" {
                    return;
                }
                if event.active {
                    if state.show_terminal_progress {
                        state.editor.set_working(Some(WorkingState {
                            frame: 0,
                            started_at: std::time::Instant::now(),
                            message: if event.manual {
                                "Compacting context… (Esc to cancel)"
                            } else {
                                "Auto-compacting… (Esc to cancel)"
                            }
                            .into(),
                        }));
                    }
                } else {
                    let status = *state.status.lock().unwrap();
                    state.apply_status(status);
                }
                tui.request_render(false);
            }
        }
    });

    // Capture the model catalog + cwd for the selector builders + the key loop
    // (the callbacks fire on blocking threads and need owned data).
    let model_catalog_arc = reload_context.catalog.clone();

    // ---- Layout root (built ONCE; mirrors TS fullscreenLayoutRoot) ----
    // root = VStack[ scrollview(basis:0 grow:1 shrink:1 min:1), dock(shrink:1) ]
    // dock  = VStack[ status(auto), autocomplete(auto), editor_container(shrink:0 min:3), footer(auto) ]
    //
    // The scrollview gets `basis(0)` so the constrained stack allocator starts
    // it at zero height and grows it to fill the space the dock does not need
    // — this keeps the dock (editor borders + footer) pinned to the bottom and
    // never shrinks it below the editor's 3 rows (top + content + bottom). The
    // editor_container is `shrink(0).min_size(3)` so a tall transcript can
    // never clip the input panel below its minimum.
    let editor_container = Arc::new(Container::new());
    editor_container.add_child(editor.clone());

    let dock = Arc::new(VStack::from_children(vec![
        StackChild::Entry(StackEntry::new(Arc::new(panels::RegularPanels {
            mailbox: reload_context.ext_status.clone(),
            enabled: matches!(tui_mode, crate::args::TuiMode::Regular),
        }))),
        StackChild::Entry(StackEntry::new(state.pending_container().clone())),
        StackChild::Entry(StackEntry::new(state.warning_container.clone())),
        StackChild::Entry(StackEntry::new(status_container.clone())),
        StackChild::Entry(StackEntry::new(autocomplete_container.clone())),
        StackChild::Entry(StackEntry::new(widget_above.clone())),
        // NOTE: no Spacer here. The scroll content already ends with a blank line
        // (`document_container`), and a second one in the dock stacked into a
        // two-row gap between the last message and the input box. One row of
        // breathing room is the whole safe area now; the transcript keeps its
        // own padding so a long message never touches the editor border.
        StackChild::Entry(
            StackEntry::new(editor_container.clone())
                .shrink(1)
                .min_size(3),
        ),
        StackChild::Entry(StackEntry::new(widget_below.clone())),
        StackChild::Entry(StackEntry::new(state.search_bar.clone())),
        StackChild::Entry(StackEntry::new(footer.clone())),
        StackChild::Entry(StackEntry::new(Arc::new(panels::FooterPanels(
            reload_context.ext_status.clone(),
        )))),
    ]));

    let transcript_stack = Arc::new(rpi_tui::HStack::from_entries(vec![StackEntry::new(
        scroll_view.clone(),
    )
    .basis(0)
    .grow(1)
    .shrink(1)
    .min_size(1)]));
    let root = VStack::from_children(vec![
        // The progress hairline sits at the top of the screen, above the
        // transcript (upstream's `chat-viewport.ts:48-52`).
        StackChild::Entry(StackEntry::new(progress::progress_bar().clone()).shrink(0)),
        StackChild::Entry(
            StackEntry::new(transcript_stack.clone())
                .basis(0)
                .grow(1)
                .shrink(1)
                .min_size(1),
        ),
        StackChild::Entry(StackEntry::new(dock).shrink(1)),
    ]);

    // The progress hairline advances one cell per 100 ms while a run is going
    // (upstream's `components/progress-bar.ts:22`).
    {
        let tui_for_progress = tui.clone();
        tokio::spawn(async move {
            let mut ticker =
                tokio::time::interval(std::time::Duration::from_millis(100));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                ticker.tick().await;
                progress::progress_bar().tick();
                tui_for_progress.request_render(false);
            }
        });
    }

    let side_ui = Arc::new(Mutex::new(side_questions::SideQuestionUi::new(
        Arc::new(root),
        editor.clone(),
        matches!(tui_mode, crate::args::TuiMode::Regular),
    )));
    let normal_root: Arc<dyn Component> = side_ui.lock().unwrap().root();
    *NORMAL_ROOT.lock().unwrap() = Some(normal_root.clone());

    // ---- Empty-session screen ----
    // While the session has no messages the whole pane is the screen: the
    // spinning logo above a greeting and the centred input box (upstream's
    // `threeDEmptySession`, `interactive-mode.ts:901-924`). The first message
    // takes the pane back.
    let empty_session_screen: Option<Arc<dyn Component>> = if three_d_empty_session
        && !session_has_messages(harness).await
        && first_run.lock().unwrap().is_none()
    {
        let background = if theme == Some("light") {
            [255.0, 255.0, 255.0]
        } else {
            [0.0, 0.0, 0.0]
        };
        let logo = Arc::new(rpi_tui::logo3d::Logo3d::new(background));
        let centered_editor = Arc::new(Centered::new(
            editor_container.clone(),
            EMPTY_SESSION_EDITOR_WIDTH,
        ));
        // The autocomplete lives in the dock, and the 3-D screen owns the pane
        // while the session is empty, so the suggestion list has to be part of
        // the screen: the user types `/` and expects the commands.
        let empty_session_editor = Arc::new(VStack::from_children(vec![
            StackChild::Entry(StackEntry::new(centered_editor)),
            StackChild::Entry(StackEntry::new(autocomplete_container.clone())),
        ]));
        let tui_weak = Arc::downgrade(&tui);
        let height = Arc::new(move || {
            tui_weak
                .upgrade()
                .map(|tui| tui.height())
                .filter(|height| *height > 0)
                .unwrap_or(24)
        });
        Some(Arc::new(EmptySessionScreen::new(
            logo,
            empty_session::greeting(),
            empty_session_editor,
            height,
        )))
    } else {
        None
    };
    let empty_session = EmptySession {
        screen: empty_session_screen,
        normal_root: normal_root.clone(),
        active: Arc::new(std::sync::atomic::AtomicBool::new(false)),
    };
    if empty_session.screen.is_some() {
        empty_session.activate(&tui);
    } else if let Some(dialog) = first_run.lock().unwrap().clone() {
        // The picker gets the pane to itself, like the original's startup
        // screen (`cli/startup-ui.ts`), and gives it back when it is done.
        let screen = Arc::new(Container::new());
        screen.add_child(dialog);
        tui.set_layout_root(Some(screen));
    } else {
        tui.set_layout_root(Some(normal_root.clone()));
    }
    tui.set_focus(Some(editor.clone()));
    editor.set_focused(true);

    // ---- Submit handler (fires on the blocking key thread; must stay sync) ----
    //
    // The handler captures one `CommandContext` (the set of `*_for_cb` clones
    // the old version made individually) + the registry, then routes `/`-text
    // through `dispatch_slash` and sends plain text directly. Each command's
    // `execute` owns its own effects (selector open, `tx.send`, `tokio::spawn`,
    // chat mutation) — the handler itself stays a thin router.
    //
    // One `CommandContext` is built and cloned for both the submit handler and
    // the key loop (Ctrl+L routes `/model` through the same registry); all
    // fields are `Arc`/cheap, so the clones are free.
    //
    // The product-layer `AgentSession` wraps a clone of the harness (the
    // harness handle is cheap and shares the session/bus), so `/usage`,
    // `/export`, and future product commands go through one surface.
    let scoped_models = args
        .model
        .as_deref()
        .map(crate::agent_session::ScopedModel::parse)
        .into_iter()
        .collect();
    let agent_session = Arc::new(crate::agent_session::AgentSession::new(
        harness.clone(),
        model_catalog.clone(),
        scoped_models,
        cwd.clone(),
    ));
    let ctx = CommandContext {
        chat: chat_container.clone(),
        tui: tui.clone(),
        tx: tx.clone(),
        state: state.clone(),
        editor: editor.clone(),
        editor_container: editor_container.clone(),
        lane: lane.clone(),
        model_catalog: model_catalog_arc.clone(),
        cwd: cwd.clone(),
        resources: resources_arc.clone(),
        reload_context: Arc::new(reload_context.clone()),
        session: agent_session.clone(),
    };

    let ctx_for_cb = ctx.clone();
    let registry_for_cb = registry.clone();
    let empty_session_for_submit = empty_session.clone();
    let js_extensions_for_cb = js_extensions.clone();
    editor.on_submit(Arc::new(move |text: &str| {
        let text = text.trim();
        if text.is_empty() && ctx_for_cb.state.pending_images.lock().unwrap().is_empty() {
            return;
        }

        if text.starts_with('/') && dispatch_slash(text, &ctx_for_cb, &registry_for_cb) {
            return;
        }

        // The JavaScript extensions see the input before the agent does: one
        // can transform it, or handle it without an agent run.
        let mut prompt = text.to_string();
        if let Some(extensions) = js_extensions_for_cb.as_ref() {
            match extensions.emit_input(&prompt) {
                Ok(value) => {
                    let action = value.get("action").and_then(|action| action.as_str());
                    if action == Some("handled") {
                        ctx_for_cb.tui.request_render(false);
                        return;
                    }
                    if let Some(transformed) = value.get("text").and_then(|text| text.as_str()) {
                        prompt = transformed.to_string();
                    }
                }
                Err(error) => {
                    add_error_message(&ctx_for_cb.chat, &format!("Extension error: {error}"));
                    ctx_for_cb.tui.request_render(false);
                    return;
                }
            }
        }
        let text = expand_for_resources(&ctx_for_cb, prompt.as_str());
        let text = text.as_str();

        // User-initiated shell mode: `!command` runs in the background and is
        // recorded in the session context; `!!command` is excluded from it.
        // Handled before the agent prompt path so it never reaches the model.
        // Mirrors `interactive-mode.ts:3225`.
        if let Some((command, exclude_from_context)) = parse_user_bash(text) {
            if ctx_for_cb.state.user_bash_running() {
                add_error_message(
                    &ctx_for_cb.chat,
                    "A bash command is already running. Press Esc to cancel it first.",
                );
                ctx_for_cb.tui.request_render(false);
                return;
            }
            empty_session_for_submit.deactivate(&ctx_for_cb.tui);
            start_user_bash(&ctx_for_cb, command, exclude_from_context);
            return;
        }

        let run_status = *ctx_for_cb.state.status.lock().unwrap();
        if run_status != RunStatus::Idle {
            let images = ctx_for_cb.state.take_pending_images();
            let message = user_message_with_images(text, images.clone());
            let lane = ctx_for_cb.lane.clone();
            let chat = ctx_for_cb.chat.clone();
            let tui = ctx_for_cb.tui.clone();
            let state = ctx_for_cb.state.clone();
            tokio::spawn(async move {
                // Queue immediately while the agent loop is still running.
                // Routing this through the TUI's main channel delayed it until
                // `prompt_text()` returned, after the loop's drain points had
                // passed, so the queued message appeared to disappear.
                //
                // upstream's `steer()` enqueues unconditionally, even after
                // the run ends, and the message stays in the queue for the
                // next run. This matches the TS design and avoids the race
                // between `activeRun` clearing and the status check.
                if let Err(error) = lane.steer(message).await {
                    state.restore_pending_images(images);
                    add_error_message(&chat, &format!("Could not queue message: {error}"));
                    tui.render_now(false);
                    return;
                }
                // Surface the queued entry in the pending dock immediately;
                // the drain-time refresh only fires on the next agent event.
                refresh_pending_messages(&state, &lane).await;
                tui.request_render(false);
            });
            // A queued prompt is echoed only once the loop actually consumes
            // it: the run's `AgentEvent::MessageStart` renders the user bubble
            // (upstream renders `message_start` for user messages). Until
            // then it is surfaced by the pending-messages display, so the
            // transcript never shows a message that is still waiting.
            ctx_for_cb.tui.request_render(false);
            return;
        }

        if !ctx_for_cb.state.try_start_working() {
            return;
        }

        // Render the user bubble here, NOT from `AgentEvent::MessageStart`.
        //
        // The harness persists the prompt itself and then drives
        // `run_agent_loop` with an EMPTY prompts vec (so the prompt is not
        // double-counted in the provider context), which means the loop emits
        // no `message_start` for it — see
        // `directly_sent_prompt_emits_no_user_message_start` in
        // `crates/rpi-harness/tests/harness_run_e2e.rs`. Queued steering /
        // follow-up prompts DO get a `message_start` (the loop drains those
        // itself), so those are deliberately rendered from the event instead.
        empty_session_for_submit.deactivate(&ctx_for_cb.tui);
        add_user_message(&ctx_for_cb.chat, text);
        // A new prompt starts a fresh interaction at the tail even when the
        // user had scrolled up to inspect older output.
        if let Some(scroll) = ctx_for_cb.tui.get_primary_scroll_view() {
            scroll.scroll_to_end();
        }
        ctx_for_cb.tui.request_render(false);
        // Remember the message for ↑ recall (slash commands are not part of
        // the replayable message history).
        push_history(&ctx_for_cb.state, text);
        if ctx_for_cb
            .tx
            .send(TuiMessage::UserInput(
                text.to_string(),
                ctx_for_cb.state.take_pending_images(),
            ))
            .is_err()
        {
            ctx_for_cb.state.set_status(RunStatus::Idle);
        }
    }));

    // Turn on the native-pi frame throttle before the first frame: from here on
    // `request_render(false)` parks a frame and the scheduler thread paints at
    // most one per `MIN_RENDER_INTERVAL_MS` (16 ms). A provider that streams one
    // `MessageUpdate` per delta would otherwise force a full transcript
    // re-render + full-viewport terminal write per token, which is what made
    // long output saturate the terminal (and its GPU compositor). Immediate
    // renders (selectors, the first frame, `render_now(..)`) are unaffected.
    tui.start_render_scheduler();
    tui.start_readerless();

    // Consume local self-update results even when network checks are disabled.
    // Check rpi and installed registry packages in the background so startup
    // remains responsive while their latest versions are fetched.
    let mut update_check_handles = Vec::new();
    let rpi_chat = chat_container.clone();
    let rpi_tui = tui.clone();
    update_check_handles.push(tokio::spawn(async move {
        let report = crate::updates::check_rpi_startup().await;
        if !report.is_empty() {
            add_update_notices(&rpi_chat, &report);
        }
        rpi_tui.request_render(false);
    }));

    // ---- Streaming drain task ----
    let drain_handle = if let Some(rx) = event_rx {
        let tui_drain = tui.clone();
        let state_drain = state.clone();
        let chat_drain = chat_container.clone();
        let lane_drain = lane.clone();
        Some(tokio::spawn(async move {
            drain_agent_events(rx, tui_drain, state_drain, chat_drain, lane_drain).await;
        }))
    } else {
        None
    };

    // ---- B5d: plugin→TUI reload bridge ----
    // A plugin's `runtime_action(Reload)` can't drive the reload synchronously
    // (its cdylib would be unmapped while the call frame is still on the stack).
    // Instead the `ActionBridge`'s reload callback signals `reload_context.mailbox`
    // (an `UnboundedSender<()>`); this task drains those signals and forwards
    // `TuiMessage::ReloadExtensions` into the main loop, which runs the shared
    // `reload_extension_resources` routine asynchronously. The mailbox is the
    // cycle-free seam: rpi-extensions carries only `()` (no `TuiMessage` type —
    // leaf DAG preserved); the TUI owns the receiver + the reload routine.
    let (reload_sig_tx, mut reload_sig_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    reload_context.mailbox.install(reload_sig_tx);
    let reload_tx = tx.clone();
    let reload_bridge_handle = tokio::spawn(async move {
        while reload_sig_rx.recv().await.is_some() {
            if reload_tx.send(TuiMessage::ReloadExtensions).is_err() {
                break; // main loop gone — stop forwarding
            }
        }
    });

    // ---- Render-tick task (advances the loader spinner while Working) ----
    //
    // The `Loader` only advances its frame on render; without a periodic
    // `request_render` the spinner visibly freezes between events.
    let tui_tick = tui.clone();
    let state_tick = state.clone();
    // The tick, not the key loop, drives the voice-draft auto-send: it must
    // fire even when the user types nothing.
    let tx_tick = tx.clone();
    let pet_tick = pet_document.clone();
    let mut plugin_panels = panels::Panels::with_sidebar(
        transcript_stack,
        scroll_view.clone(),
        reload_context.ext_status.clone(),
    );
    plugin_panels.regular_mode = matches!(tui_mode, crate::args::TuiMode::Regular);
    plugin_panels.sync(tui.as_ref(), &reload_context.ext_status);
    let scroll_tick = scroll_view.clone();
    let side_tick = side_ui.clone();
    let side_context = reload_context.clone();
    let side_parent = harness.clone();
    let side_keys = keybindings.clone();
    let js_extensions_tick = js_extensions.clone();
    let widget_above_tick = widget_above.clone();
    let widget_below_tick = widget_below.clone();
    let mut js_status_keys: Vec<String> = Vec::new();
    let mut js_widgets_applied: Vec<String> = Vec::new();
    let mut js_header_applied: Option<String> = None;
    let header_container_tick = header_container.clone();
    let tick_handle = tokio::spawn(async move {
        // 80ms per frame — upstream's `DEFAULT_INTERVAL_MS`, i.e. a full
        // 10-frame cycle every 800ms. The tick only *requests a repaint*; the
        // frame is advanced by `Editor::render` (mirroring `Loader::render`),
        // so streaming output — which schedules a frame per token — spins it
        // faster, and this interval is the floor when the model is silent.
        //
        // Advancing here as well would double-step every tick and make the idle
        // spinner run at 40ms/frame, twice upstream's rate.
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(
            rpi_tui::loader::SPINNER_FRAME_MS,
        ));
        interval.tick().await; // discard immediate
        loop {
            interval.tick().await;
            // Size watchdog: re-read the window and repaint when it differs
            // from what is on screen. A resize event is only a hint (on Windows
            // its record can be delivered before the window rectangle moves),
            // and a lost event would otherwise leave the fullscreen frame at the
            // previous geometry for the rest of the session.
            tui_tick.ensure_size();
            let side_changed = side_tick.lock().unwrap().sync(
                &tui_tick,
                &side_context,
                &side_parent,
                side_keys.clone(),
                side_questions::input_allowed(&state_tick),
            );
            if side_changed {
                tui_tick.request_render(false);
            }
            // Extension status (langfuse ✓ …, …) — cheap revision check, and the
            // only reason an idle session repaints its footer.
            let panels_changed = plugin_panels.sync(tui_tick.as_ref(), &state_tick.ext_status);
            if state_tick.sync_extension_status() || panels_changed {
                // Status/panel updates leave chat content untouched. The scroll
                // cache regenerates itself if enabling a sidebar changes width.
                tui_tick.request_render_reusing_scroll_content();
            }
            // The JavaScript extensions publish a status line and the widget
            // slots above and below the editor.
            if let Some(extensions) = js_extensions_tick.as_ref() {
                let mut status_changed = false;
                let statuses = extensions.statuses();
                for (key, text) in &statuses {
                    status_changed |= state_tick.ext_status.set(key, text);
                }
                for key in js_status_keys.drain(..) {
                    if !statuses.iter().any(|(current, _)| current == &key) {
                        status_changed |= state_tick.ext_status.set(&key, "");
                    }
                }
                js_status_keys = statuses.into_iter().map(|(key, _)| key).collect();
                if status_changed {
                    state_tick.sync_extension_status();
                    tui_tick.request_render_reusing_scroll_content();
                }
                if sync_js_widgets(
                    extensions,
                    &widget_above_tick,
                    &widget_below_tick,
                    tui_tick.width(),
                    &mut js_widgets_applied,
                ) {
                    tui_tick.request_render(false);
                }
                if sync_js_header(
                    extensions,
                    &header_container_tick,
                    tui_tick.width(),
                    &mut js_header_applied,
                ) {
                    tui_tick.request_render(false);
                }
            }
            if pet_tick.tick(scroll_tick.viewport_height()) {
                tui_tick.request_render(false);
            }
            // Extension editor-text injection (`SetEditorText`): a voice plugin
            // drops a transcription in as an editable draft.
            if state_tick.drain_editor_text() {
                tui_tick.request_render(false);
            }
            // Tell extensions the draft changed (voice barge-in). Runs after the
            // drain so an injected transcription also counts as a change.
            state_tick.sync_editor_change();
            // Advance a draft's auto-send countdown (submit / cancel / repaint).
            if poll_auto_send(&state_tick, &tx_tick) {
                tui_tick.request_render(false);
            }
            let working = *state_tick.status.lock().unwrap() == RunStatus::Working;
            if working {
                // A live transcript panel — a running bash command *or* a
                // running tool call — computes its elapsed readout from
                // `Instant::now()` at render time. A frame that reuses the
                // cached scroll content never rebuilds it, so the readout
                // froze at the second of the last full rebuild (reported: a
                // `search` call stuck at "2.0s" with no way to tell it was
                // still running). Rebuild while any such panel is live.
                let bash_present = !state_tick.bash_components.lock().unwrap().is_empty();
                let has_live_panel = {
                    let tools = state_tick.tool_components.lock().unwrap();
                    transcript_has_live_panel(bash_present, &tools)
                };
                if has_live_panel {
                    tui_tick.request_render(false);
                } else {
                    // Only the dock loader animates. Keep the already-rendered
                    // transcript instead of rebuilding a long history at 12.5
                    // frames per second.
                    tui_tick.request_render_reusing_scroll_content();
                }
            }
        }
    });

    // ---- Key dispatch loop (spawn_blocking crossterm read) ----
    let running = Arc::new(std::sync::Mutex::new(true));
    let running_key = running.clone();
    let tx_for_key = tx.clone();
    let tui_for_key = tui.clone();
    let editor_for_key = editor.clone();
    let scroll_for_key = scroll_view.clone();
    let side_for_key = side_ui.clone();
    let lane_for_key = lane.clone();
    let state_for_key = state.clone();
    let model_catalog_for_key = model_catalog_arc.clone();
    let ask_user_for_key = ask_user_bridge.clone();
    let first_run_for_key = first_run.clone();
    let normal_root_for_key = normal_root.clone();
    // Ctrl+L routes through the same registry as `/model` (one path, not two),
    // so the key loop needs the same `CommandContext` + registry the submit
    // handler uses. All fields are `Arc`/cheap, so this clone is free.
    let ctx_for_key = ctx.clone();
    let registry_for_key = registry.clone();
    let keybindings_for_key = keybindings.clone();
    let double_escape_action = crate::settings::load_settings()
        .ok()
        .and_then(|settings| settings.double_escape_action)
        .unwrap_or_else(|| "tree".to_string())
        .to_ascii_lowercase();

    let key_handle = tokio::task::spawn_blocking(move || {
        let mut last_escape_time = None;
        // upstream's `handleCtrlC` "press twice to exit" window: the instant of
        // the last lone Ctrl+C. Shares the 500ms with Esc's double-escape.
        let mut last_sigint_time: Option<std::time::Instant> = None;
        // One event peeked at by the paste-burst probe (which must discard a
        // key's Release but never lose a meaningful event it read). Restored
        // at the top of the next loop iteration.
        let mut pending_event: Option<Event> = None;
        let mut windows_paste_run = WindowsPasteRun::default();
        if crate::key_trace::enabled() {
            crate::key_trace::note(&format!(
                "--- rpi TUI key trace start pid={} TERM={} raw_mode={} ---",
                std::process::id(),
                std::env::var("TERM").unwrap_or_else(|_| "(unset)".to_string()),
                crossterm::terminal::is_raw_mode_enabled().unwrap_or(false),
            ));
        }
        loop {
            if !*running_key.lock().unwrap() {
                break;
            }
            if !state_for_key.selector_open() && !state_for_key.extension_dialog_open() {
                if let Some(request) = ask_user_for_key.take_pending() {
                    open_ask_user_dialog(&ctx_for_key, ask_user_for_key.clone(), request);
                }
            }
            let ev = if let Some(ev) = pending_event.take() {
                ev
            } else {
                // `event::read()` blocks indefinitely. Poll first so shutdown can
                // stop and join this worker even when no further key arrives.
                match crossterm::event::poll(
                    if cfg!(windows) && !windows_paste_run.text.is_empty() {
                        windows_paste_run.grace()
                    } else {
                        std::time::Duration::from_millis(50)
                    },
                ) {
                    Ok(true) => {}
                    Ok(false) => {
                        if cfg!(windows) && !windows_paste_run.text.is_empty() {
                            windows_paste_run.flush(&editor_for_key);
                            refresh_autocomplete(&state_for_key, &editor_for_key);
                            tui_for_key.request_render_reusing_scroll_content();
                        }
                        continue;
                    }
                    Err(_) => {
                        state_for_key.cancel_js_preparation();
                        let _ = tx_for_key.send(TuiMessage::Exit);
                        break;
                    }
                }
                let Ok(ev) = crossterm::event::read() else {
                    state_for_key.cancel_js_preparation();
                    let _ = tx_for_key.send(TuiMessage::Exit);
                    break;
                };
                ev
            };
            // `Event::Resize` is delivered as its own event (not a Key). With
            // `start_readerless` there is no competing terminal-reader thread to
            // handle it: force one full-screen repaint. The renderer re-reads the
            // window size itself; the event's own columns/rows are not used (on
            // Windows they carry the console buffer size, not the window).
            if let Event::Resize(..) = ev {
                tui_for_key.note_resize();
                continue;
            }
            // Mouse wheel scrolls the transcript (pi supports wheel
            // scrolling). Previously every non-Key event was dropped, so a
            // wheel had zero effect
            if let Event::Mouse(m) = ev {
                if side_questions::input_allowed(&state_for_key)
                    && side_for_key
                        .lock()
                        .unwrap()
                        .mouse(&m, &tui_for_key, &scroll_for_key)
                {
                    continue;
                }
                // The alternate screen owns the mouse: it routes the event to
                // the component under the pointer, drags the scrollbar, opens
                // links and copies a text selection.
                if tui_for_key.handle_mouse_event(&m) {
                    continue;
                }
                if tui_for_key.handle_scroll_to_end_indicator_mouse_event(&m) {
                    *state_for_key.selection_start.lock().unwrap() = None;
                    *state_for_key.selection_end.lock().unwrap() = None;
                    continue;
                }
                use crossterm::event::MouseEventKind;
                match m.kind {
                    MouseEventKind::ScrollUp => {
                        let delta = -MOUSE_WHEEL_SCROLL_LINES;
                        if scroll_for_key.scroll_by(delta) != delta {
                            tui_for_key.request_render_reusing_scroll_content();
                        }
                    }
                    MouseEventKind::ScrollDown => {
                        let delta = MOUSE_WHEEL_SCROLL_LINES;
                        if scroll_for_key.scroll_by(delta) != delta {
                            tui_for_key.request_render_reusing_scroll_content();
                        }
                    }
                    MouseEventKind::Down(crossterm::event::MouseButton::Right) if cfg!(windows) => {
                        // upstream treats Windows right-click as a clipboard
                        // paste, rather than letting the console deliver the
                        // clipboard contents as individual key events. This is
                        // what preserves the complete payload for
                        // Editor::handle_paste and large-paste folding.
                        if let Some(text) = read_clipboard_text() {
                            if !text.is_empty() {
                                editor_for_key.handle_paste(&text);
                                refresh_autocomplete(&state_for_key, &editor_for_key);
                                tui_for_key.request_render_reusing_scroll_content();
                            }
                        }
                    }
                    MouseEventKind::Down(crossterm::event::MouseButton::Left) => {
                        // Start selection tracking. `selection_end` doubles as the
                        // "a real drag happened" marker: a plain tap never sets
                        // it, so it can never overwrite the clipboard.
                        *state_for_key.selection_start.lock().unwrap() = Some((m.column, m.row));
                        *state_for_key.selection_end.lock().unwrap() = None;
                    }
                    MouseEventKind::Drag(crossterm::event::MouseButton::Left) => {
                        // Motion with the button held = a genuine selection drag.
                        // (Terminals only report this with button-event mouse
                        // tracking, which `ProcessTerminal` enables.)
                        if state_for_key.selection_start.lock().unwrap().is_some() {
                            *state_for_key.selection_end.lock().unwrap() = Some((m.column, m.row));
                        }
                    }
                    MouseEventKind::Up(crossterm::event::MouseButton::Left) => {
                        // End selection and auto-copy if enabled
                        if let Some(start) = *state_for_key.selection_start.lock().unwrap() {
                            let end = (m.column, m.row);

                            // Only auto-copy when the pointer actually MOVED with
                            // the button held (`Drag` set `selection_end`). A plain
                            // click/tap — even one whose Down/Up cells differ by a
                            // pixel over RDP — must not touch the clipboard: it used
                            // to fire `extract_selected_text`, which copies whatever
                            // rendered TUI line sat under the pointer, silently
                            // clobbering the user's real clipboard so the next paste
                            // returned that stale text.
                            let is_drag = state_for_key.selection_end.lock().unwrap().is_some();
                            *state_for_key.selection_end.lock().unwrap() = Some(end);

                            // Check if auto-copy is enabled
                            let auto_copy = crate::settings::load_settings()
                                .ok()
                                .and_then(|s| s.fullscreen_copy_on_select)
                                .unwrap_or(true);

                            if auto_copy && is_drag {
                                // Try to extract selected text from chat container
                                if let Some(selected_text) =
                                    extract_selected_text(&state_for_key.chat_container, start, end)
                                {
                                    if !selected_text.trim().is_empty() {
                                        let _ = copy_to_clipboard(&selected_text);
                                    }
                                }
                            }
                        }
                        *state_for_key.selection_start.lock().unwrap() = None;
                        *state_for_key.selection_end.lock().unwrap() = None;
                    }
                    _ => {}
                }
                continue;
            }
            let Event::Key(key) = ev else {
                if let Event::Paste(text) = ev {
                    if side_questions::input_allowed(&state_for_key)
                        && side_for_key.lock().unwrap().paste(&text, &tui_for_key)
                    {
                        continue;
                    }
                    crate::key_trace::note(&format!(
                        "paste event ({} bytes, bracketed paste supported)",
                        text.len()
                    ));
                    // A provider-form text step owns the input slot: paste into
                    // its single-line input instead of the chat editor.
                    if state_for_key.provider_form.lock().unwrap().is_some() {
                        let active = state_for_key.active_provider_input.lock().unwrap().clone();
                        if let Some(input) = active {
                            input.handle_paste(&text);
                            tui_for_key.request_render_reusing_scroll_content();
                            continue;
                        }
                    }
                    if let Some(input) = state_for_key.active_provider_input.lock().unwrap().clone()
                    {
                        input.handle_paste(&text);
                        tui_for_key.request_render_reusing_scroll_content();
                        continue;
                    }
                    if state_for_key
                        .provider_auth_flow_id
                        .load(std::sync::atomic::Ordering::Acquire)
                        != 0
                    {
                        tui_for_key.request_render_reusing_scroll_content();
                        continue;
                    }
                    if let Some(images) = images_from_pasted_paths(&text) {
                        for image in images {
                            state_for_key.queue_image(image);
                        }
                        add_note_message(
                            &state_for_key.chat_container,
                            "Dropped images attached to the next prompt.",
                        );
                        tui_for_key.request_render(false);
                        continue;
                    }
                    editor_for_key.handle_paste(&text);
                    refresh_autocomplete(&state_for_key, &editor_for_key);
                    tui_for_key.request_render_reusing_scroll_content();
                }
                continue;
            };
            let key = rpi_tui::terminal::normalize_key_event_with_protocol(
                key,
                tui_for_key.terminal().info().supports_kitty_keyboard,
            );
            // Diagnostic trace (off unless RPI_DEBUG_KEYS is set): records what
            // actually arrived before any routing decision, so a client that
            // sends LF for Enter is visible as `Char('j') mods=CONTROL`.
            crate::key_trace::key(&key, "");
            // Side input is independent of main-run abort/preparation and plugin
            // shortcuts. Modal/approval dialogs still own the input slot first.
            if side_questions::input_allowed(&state_for_key)
                && side_for_key.lock().unwrap().focused()
            {
                if !should_dispatch_key(key.kind) {
                    continue;
                }
                if keybinding_matches(&keybindings_for_key, &key, rpi_tui::keybindings::keys::EXIT)
                    && side_for_key.lock().unwrap().empty_draft()
                {
                    if *state_for_key.status.lock().unwrap() == RunStatus::Idle {
                        let _ = tx_for_key.send(TuiMessage::Exit);
                    } else {
                        emergency_exit(&tui_for_key);
                    }
                    continue;
                }
                if side_for_key.lock().unwrap().key(key, &tui_for_key) {
                    continue;
                }
            }
            // A key press during a voice-draft auto-send countdown cancels the
            // countdown — the user wants to edit, not send. The key still falls
            // through to the editor, so it doubles as their first correction.
            if key.kind != KeyEventKind::Release && state_for_key.cancel_auto_send_on_key() {
                tui_for_key.request_render(false);
            }
            // Extension shortcuts see Press *and* Release (this is what lets a
            // push-to-talk extension time a hold). Checked before the
            // release-drop below; a claimed key with an empty editor is routed
            // to the plugin's `Input` handler instead of the editor.
            if dispatch_key_event(&state_for_key, &key, &editor_for_key) {
                continue;
            }
            // Drop releases but preserve Repeat so holding arrows, Backspace,
            // PageUp, etc. behaves naturally. Windows emits Press + Release
            // for a tap; terminals with keyboard enhancement may additionally
            // emit Repeat while a key is held.
            if !should_dispatch_key(key.kind) {
                continue;
            }

            // The first-run theme picker owns the input slot until it is
            // confirmed or skipped: every key goes to it, and the pane goes
            // back to the transcript once it is done.
            let first_run_dialog = first_run_for_key.lock().unwrap().clone();
            if let Some(dialog) = first_run_dialog {
                dialog.handle_key(key);
                if dialog.is_finished() {
                    *first_run_for_key.lock().unwrap() = None;
                    tui_for_key.set_layout_root(Some(normal_root_for_key.clone()));
                }
                tui_for_key.request_render(false);
                continue;
            }

            // Prompt preparation runs on a blocking worker before the agent
            // lane owns the turn. Cancel it directly: an abort queued only to
            // the lane cannot wake a JS factory or lifecycle hook that never
            // resolves. This check precedes custom/dialog routing because
            // those components may themselves have been opened by the hook.
            let prompt_abort = (key.modifiers == KeyModifiers::CONTROL
                && matches!(key.code, KeyCode::Char('c') | KeyCode::Char('d')))
                || (key.modifiers == KeyModifiers::NONE && key.code == KeyCode::Esc);
            if prompt_abort && state_for_key.cancel_js_preparation() {
                state_for_key.set_status(RunStatus::Aborting);
                if !run_extension_cancel(&state_for_key) && state_for_key.extension_dialog_open() {
                    close_extension_editor(
                        &state_for_key,
                        &ctx_for_key.editor_container,
                        &editor_for_key,
                        &tui_for_key,
                    );
                }
                tui_for_key.set_render_suspended(false);
                tui_for_key.request_render(false);
                continue;
            }

            // Ctrl+C cancels an open selector before it reaches the global
            // abort/exit handler. Route through Esc so selector callbacks run.
            if key.modifiers == KeyModifiers::CONTROL
                && key.code == KeyCode::Char('c')
                && state_for_key.selector_open()
            {
                let selector = state_for_key
                    .active_selector
                    .lock()
                    .unwrap()
                    .clone()
                    .expect("selector_open guaranteed Some")
                    .0;
                selector.handle_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
                tui_for_key.request_render_reusing_scroll_content();
                continue;
            }

            // The interactive "Add provider" form owns the input slot while it
            // collects a field: route every key to its single-line input (Esc
            // and Enter are handled by the Input's own callbacks). Clone the
            // input OUTSIDE `if let` so the `active_provider_input` mutex guard
            // drops before `handle_key` — the submit path re-enters that mutex
            // to swap in the next step's input and would deadlock on it.
            if state_for_key.provider_form.lock().unwrap().is_some() {
                let active_input = state_for_key.active_provider_input.lock().unwrap().clone();
                let active_select = state_for_key.active_provider_select.lock().unwrap().clone();
                if let Some(input) = active_input {
                    input.handle_key(key);
                } else if let Some(select) = active_select {
                    select.handle_key(key);
                }
                tui_for_key.request_render_reusing_scroll_content();
                continue;
            }

            // Provider login inputs use the same input slot without creating an
            // Add-provider form state. Route them before the normal editor so
            // masked API keys and OAuth exchange values actually receive keys.
            if handle_provider_login_key(&state_for_key, key) {
                tui_for_key.request_render_reusing_scroll_content();
                continue;
            }

            // OAuth begin/exchange/revoke owns the input slot even while the
            // provider call is running. Do not let keys leak into the prompt.
            if state_for_key
                .provider_auth_flow_id
                .load(std::sync::atomic::Ordering::Acquire)
                != 0
            {
                if key.code == KeyCode::Esc && key.modifiers == KeyModifiers::NONE {
                    finish_provider_login(
                        &state_for_key,
                        &ctx_for_key.editor_container,
                        &editor_for_key,
                        &tui_for_key,
                    );
                    add_note_message(&state_for_key.chat_container, "OAuth flow cancelled.");
                }
                tui_for_key.request_render_reusing_scroll_content();
                continue;
            }

            // Extension dialogs own the input slot while awaiting a result.
            // Esc and Ctrl+C both resolve the pending command with cancel;
            // all other keys go to the active native editor/input widget.
            if state_for_key.extension_dialog_open() {
                let cancel = key.code == KeyCode::Esc
                    || (key.modifiers == KeyModifiers::CONTROL && key.code == KeyCode::Char('c'));
                if cancel {
                    if !run_extension_cancel(&state_for_key) {
                        close_extension_editor(
                            &state_for_key,
                            &ctx_for_key.editor_container,
                            &editor_for_key,
                            &tui_for_key,
                        );
                    }
                } else {
                    handle_extension_dialog_key(&state_for_key, key);
                }
                tui_for_key.request_render_reusing_scroll_content();
                continue;
            }

            // Pet Esc pauses audio; an active run still reaches normal abort
            // routing below. Dialogs and selectors retain their own Escape.
            if key.code == KeyCode::Esc
                && key.modifiers == KeyModifiers::NONE
                && !state_for_key.selector_open()
                && pet::active(&state_for_key.ext_status)
            {
                let _ = invoke_extension_command(&state_for_key.extension_session, "pet", "quiet");
                tui_for_key.request_render(false);
                if *state_for_key.status.lock().unwrap() == RunStatus::Idle
                    && editor_for_key.get_text().is_empty()
                {
                    continue;
                }
            }

            // 0. Ctrl+C: upstream's `app.quit`. A press inside the
            //    double-press window quits; any other press shows the
            //    "press again to exit" warning. It never touches the editor
            //    content and never aborts — `app.interrupt` (Esc) owns
            //    cancelling a run. Open selectors and extension dialogs are
            //    handled above so their cancellation callbacks get first
            //    chance.
            if keybinding_matches(
                &keybindings_for_key,
                &key,
                rpi_tui::keybindings::keys::QUIT,
            ) {
                // A held key auto-repeats: only a fresh Press may arm or
                // consume the window, so holding Ctrl+C cannot turn one tap
                // into the quit.
                if key.kind != KeyEventKind::Repeat {
                    let now = std::time::Instant::now();
                    match ctrl_c_action(last_sigint_time, now) {
                        CtrlCAction::Exit => {
                            last_sigint_time = None;
                            state_for_key.clear_warning();
                            // The async loop parks inside
                            // `run_prompt_streaming(..).await` for the whole run,
                            // so a queued `Exit` would not be read until the run
                            // returns — force the quit while one is active. Either
                            // way the TUI stays quittable.
                            if *state_for_key.status.lock().unwrap() == RunStatus::Idle {
                                let _ = tx_for_key.send(TuiMessage::Exit);
                            } else {
                                emergency_exit(&tui_for_key);
                            }
                        }
                        CtrlCAction::Warn => {
                            last_sigint_time = Some(now);
                            let quit_key = rpi_tui::key_display_text(
                                rpi_tui::keybindings::keys::QUIT,
                            );
                            let message = if quit_key.is_empty() {
                                "Press again to exit".to_string()
                            } else {
                                format!("Press {quit_key} again to exit")
                            };
                            state_for_key.show_warning(&message);
                            tui_for_key.request_render(false);
                            // Upstream clears the banner after three seconds.
                            let state_warn = state_for_key.clone();
                            let tui_warn = tui_for_key.clone();
                            let message_warn = message.clone();
                            tokio::spawn(async move {
                                tokio::time::sleep(std::time::Duration::from_millis(3000)).await;
                                state_warn.clear_warning_if(&message_warn);
                                tui_warn.request_render(false);
                            });
                        }
                    }
                }
                continue;
            }

            // 0b. Ctrl+X: upstream's `app.message.copy` — copy the editor
            //     selection, else the last assistant reply. Native's Ctrl+C no
            //     longer copies, so selection-copy lives here now.
            if !state_for_key.selector_open()
                && keybinding_matches(
                    &keybindings_for_key,
                    &key,
                    rpi_tui::keybindings::keys::MESSAGE_COPY,
                )
            {
                if editor_for_key.has_selection() && editor_for_key.copy_selection() {
                    add_note_message(&state_for_key.chat_container, "Copied!");
                } else {
                    copy_last_assistant(&state_for_key, &state_for_key.chat_container);
                }
                tui_for_key.request_render(false);
                continue;
            }

            // 0c. Ctrl+Z (Unix only): upstream's `app.suspend` — hand the
            //     terminal back to the shell and stop ourselves; `SIGTSTP`
            //     returns when the user resumes with `fg`. Windows binds no key
            //     here (native's `defaultKeys` is empty), so this never fires.
            if keybinding_matches(
                &keybindings_for_key,
                &key,
                rpi_tui::keybindings::keys::SUSPEND,
            ) {
                handle_suspend(&tui_for_key);
                continue;
            }

            // 1. A selector overlay is open → route to it first. Only Esc
            //    (cancel) and Enter/Up/Down/Ctrl-K/J/P/N (navigate/select)
            //    escape to the selector; on done/cancel the selector callbacks
            //    restore the editor and clear `active_selector`.
            if state_for_key.selector_open() {
                // The app keybindings that belong to the open screen (the
                // session menu, the tree selector, the scoped-models selector,
                // the thinking selector) are matched before the list sees the
                // key, exactly as upstream matches them inside the component.
                if handle_selector_key(
                    &state_for_key,
                    &keybindings_for_key,
                    &key,
                    &lane_for_key,
                    &model_catalog_for_key,
                    &tui_for_key,
                ) {
                    tui_for_key.request_render_reusing_scroll_content();
                    continue;
                }
                // Esc always cancels the selector (even with modifiers off).
                // Route through `SelectList::handle_key(Esc)` so the list's
                // `on_cancel` fires (the `/scoped-models` toggle selector saves
                // its edits there) — the old shortcut called `close_selector`
                // directly and skipped the callback.
                if key.code == KeyCode::Esc {
                    let (selector, _kind) = state_for_key
                        .active_selector
                        .lock()
                        .unwrap()
                        .clone()
                        .expect("selector_open guaranteed Some");
                    selector.handle_key(key);
                    continue;
                }
                let (selector, _kind) = state_for_key
                    .active_selector
                    .lock()
                    .unwrap()
                    .clone()
                    .expect("selector_open guaranteed Some");
                selector.handle_key(key);
                tui_for_key.request_render_reusing_scroll_content();
                continue;
            }

            // 2a. Ctrl+D: upstream's `app.exit`. `handleCtrlD` only fires when
            //     the editor is empty; with text present the key falls through to
            //     the editor's deleteCharForward (`tui.editor.deleteCharForward`).
            //     It never aborts — that is `app.interrupt` (Esc)'s job.
            if keybinding_matches(&keybindings_for_key, &key, rpi_tui::keybindings::keys::EXIT) {
                if !editor_for_key.get_text().is_empty() {
                    // Editor holds text — delete the char forward (pi parity).
                    editor_for_key.handle_key(key);
                    refresh_autocomplete(&state_for_key, &editor_for_key);
                    tui_for_key.request_render_reusing_scroll_content();
                    continue;
                }
                // Empty editor → quit. A parked run needs the forced path: a
                // queued `Exit` is unread until the run returns.
                if *state_for_key.status.lock().unwrap() == RunStatus::Idle {
                    let _ = tx_for_key.send(TuiMessage::Exit);
                } else {
                    emergency_exit(&tui_for_key);
                }
                continue;
            }

            // 2b. Esc: interrupt an active run (mirrors Ctrl+C abort). When a
            //     selector is open Esc already cancelled it above; when idle,
            //     Esc falls through to the editor (no-op-ish). Only fire while
            //     Working so an idle Esc doesn't abort a non-existent run.
            //
            //     An open suggestion list takes the key first: the original
            //     binds `tui.select.cancel` to the list
            //     (`packages/tui/src/components/editor.ts:972-975`), so Esc
            //     closes the list and leaves the draft alone.
            if key.modifiers == KeyModifiers::NONE
                && key.code == KeyCode::Esc
                && !state_for_key.selector_open()
                && autocomplete_is_open(&state_for_key, &editor_for_key)
            {
                close_autocomplete(&state_for_key);
                tui_for_key.request_render_reusing_scroll_content();
                continue;
            }
            if keybinding_matches(
                &keybindings_for_key,
                &key,
                rpi_tui::keybindings::keys::INTERRUPT,
            ) {
                let status = *state_for_key.status.lock().unwrap();
                if status == RunStatus::Working {
                    state_for_key.set_status(RunStatus::Aborting);
                    ask_user_for_key.cancel_all();
                    if !run_extension_cancel(&state_for_key)
                        && state_for_key.extension_dialog_open()
                    {
                        close_extension_editor(
                            &state_for_key,
                            &ctx_for_key.editor_container,
                            &editor_for_key,
                            &tui_for_key,
                        );
                    }
                    // upstream's `onEscape` restores the queue before it
                    // aborts, so an interrupt hands the staged messages back.
                    abort_run_restoring_queue(
                        lane_for_key.clone(),
                        editor_for_key.clone(),
                        state_for_key.clone(),
                        tui_for_key.clone(),
                    );
                    continue;
                }
                // A running `!command` takes Esc next (upstream's `onEscape`
                // precedence: streaming → bash → bash-mode editor →
                // double-escape). The run slot stays occupied until the capture
                // resolves, so a second Esc is a no-op rather than a
                // double-escape trigger.
                if state_for_key.user_bash_running() {
                    state_for_key.cancel_user_bash();
                    tui_for_key.request_render(false);
                    continue;
                }
                if status == RunStatus::Idle
                    && editor_for_key.get_text().trim().is_empty()
                    && double_escape_action != "none"
                {
                    let now = std::time::Instant::now();
                    if double_escape_trigger(last_escape_time, now) {
                        last_escape_time = None;
                        match double_escape_action.as_str() {
                            "tree" => {
                                let _ = tx_for_key.send(TuiMessage::OpenTree);
                            }
                            "fork" => {
                                let _ = tx_for_key.send(TuiMessage::ForkSession);
                            }
                            _ => {}
                        }
                    } else {
                        last_escape_time = Some(now);
                    }
                }
                continue;
            }

            // 2c. Ctrl+G: edit the current draft in the user's external
            // editor, matching upstream's VISUAL/EDITOR fallback chain.
            if keybinding_matches(
                &keybindings_for_key,
                &key,
                rpi_tui::keybindings::keys::EXTERNAL_EDITOR,
            ) {
                launch_external_editor(editor_for_key.get_expanded_text(), tx_for_key.clone());
                continue;
            }

            // 2d. Ctrl+O: toggle all tool output panels between compact and
            // expanded rendering (upstream's global output toggle).
            if keybinding_matches(
                &keybindings_for_key,
                &key,
                rpi_tui::keybindings::keys::TOOLS_EXPAND,
            ) {
                let expanded = state_for_key.toggle_tool_outputs();
                // Persist per-session so a later `-c`/`-r` restores it.
                let session = ctx_for_key.session.clone();
                tokio::spawn(async move {
                    let _ = session
                        .set_value("display.tool_outputs_expanded", serde_json::json!(expanded))
                        .await;
                });
                tui_for_key.request_render(false);
                continue;
            }

            // 2e. Ctrl+T: toggle visibility of reasoning/thinking blocks.
            if keybinding_matches(
                &keybindings_for_key,
                &key,
                rpi_tui::keybindings::keys::THINKING_TOGGLE,
            ) {
                let hide = state_for_key.toggle_thinking();
                // Persist per-session so a later `-c`/`-r` restores it.
                let session = ctx_for_key.session.clone();
                tokio::spawn(async move {
                    let _ = session
                        .set_value("display.hide_thinking", serde_json::json!(hide))
                        .await;
                });
                tui_for_key.request_render(false);
                continue;
            }

            // Cycle the authenticated catalog, including other providers. Resolve
            // the anchor from the live lane so duplicate model ids stay distinct.
            let cycle_forward = keybinding_matches(
                &keybindings_for_key,
                &key,
                rpi_tui::keybindings::keys::MODEL_CYCLE_FORWARD,
            );
            let cycle_backward = keybinding_matches(
                &keybindings_for_key,
                &key,
                rpi_tui::keybindings::keys::MODEL_CYCLE_BACKWARD,
            );
            if cycle_forward || cycle_backward {
                let catalog = ctx_for_key
                    .model_catalog
                    .read()
                    .unwrap_or_else(|error| error.into_inner())
                    .clone();
                let lane = lane_for_key.clone();
                let state = state_for_key.clone();
                let tui = tui_for_key.clone();
                tokio::spawn(async move {
                    match cycle_model(&lane, &catalog, cycle_backward).await {
                        Ok(Some(model)) => {
                            report_model_selection(&lane, &state, &tui, model, false).await;
                        }
                        Ok(None) => {}
                        Err(error) => {
                            add_error_message(&state.chat_container, &error);
                            tui.request_render(false);
                        }
                    }
                });
                continue;
            }

            // 2f. Shift+Tab / BackTab: cycle the current model's supported
            // thinking levels, matching upstream's thinking-level shortcut.
            if keybinding_matches(
                &keybindings_for_key,
                &key,
                rpi_tui::keybindings::keys::THINKING_CYCLE,
            ) {
                let lane = lane_for_key.clone();
                let catalog = model_catalog_for_key
                    .read()
                    .unwrap_or_else(|error| error.into_inner())
                    .clone();
                let state = state_for_key.clone();
                tokio::spawn(async move {
                    let Ok(current_model) = lane.get_model().await else {
                        return;
                    };
                    let levels = catalog
                        .iter()
                        .find(|model| {
                            model.provider == current_model.provider && model.id == current_model.id
                        })
                        .map(|model| model.supported_thinking_levels())
                        .unwrap_or_else(|| vec![rpi_ai::types::ThinkingLevel::Medium]);
                    if levels.is_empty() {
                        return;
                    }
                    let current = lane
                        .get_thinking_level()
                        .await
                        .unwrap_or(rpi_ai::types::ThinkingLevel::Medium);
                    let next = levels
                        .iter()
                        .position(|level| *level == current)
                        .map(|index| levels[(index + 1) % levels.len()])
                        .unwrap_or(levels[0]);
                    if lane.set_thinking_level(next).await.is_ok() {
                        state
                            .footer
                            .set_thinking_level(Some(thinking_level_name(next)));
                        state.tui.as_ref().map(|tui| tui.request_render(false));
                    }
                });
                continue;
            }

            // Ctrl+V (or a configured paste-image key): if the system
            // clipboard holds an image, queue it for the next prompt;
            // otherwise paste the clipboard TEXT into the editor. Previously
            // a text-only clipboard fell through to the editor's Ctrl+V,
            // which yanks from the internal KILL RING — not the system
            // clipboard. On platforms without bracketed-paste `Event::Paste`
            // (Windows console, some remote clients) that meant Ctrl+V pasted
            // stale/other content instead of the user's real clipboard
            // ("不是系统的粘贴的内容").
            if keybinding_matches(
                &keybindings_for_key,
                &key,
                rpi_tui::keybindings::keys::PASTE_IMAGE,
            ) {
                if let Some(paths) = read_clipboard_file_paths() {
                    let text = paths.join("\n");
                    if let Some(images) = images_from_pasted_paths(&text) {
                        for image in images {
                            state_for_key.queue_image(image);
                        }
                        add_note_message(
                            &state_for_key.chat_container,
                            "Clipboard images attached to the next prompt.",
                        );
                    } else {
                        editor_for_key.handle_paste(&text);
                    }
                    tui_for_key.request_render(false);
                    continue;
                }
                match read_clipboard_image() {
                    Ok(Some(image)) => {
                        state_for_key.queue_image(image);
                        add_note_message(
                            &state_for_key.chat_container,
                            "Clipboard image attached to the next prompt.",
                        );
                        tui_for_key.request_render(false);
                        continue;
                    }
                    Ok(None) | Err(_) => {}
                }
                // Local Ctrl+V can paste clipboard text as Pi does. Under SSH,
                // text must arrive from the client via bracketed paste rather
                // than reading the remote host's unrelated clipboard.
                if cfg!(windows) || std::env::var_os("SSH_CONNECTION").is_none() {
                    if let Some(text) = read_clipboard_text() {
                        if !text.is_empty() {
                            if !attach_pasted_images(&state_for_key, &text) {
                                editor_for_key.handle_paste(&text);
                            }
                            refresh_autocomplete(&state_for_key, &editor_for_key);
                            tui_for_key.request_render_reusing_scroll_content();
                            continue;
                        }
                    }
                }
            }

            // 3. Ctrl+Shift+F: open transcript search
            if key
                .modifiers
                .contains(KeyModifiers::CONTROL | KeyModifiers::SHIFT)
                && key.code == KeyCode::Char('F')
            {
                state_for_key.search.activate();
                state_for_key.search_bar.set_visible(true);
                state_for_key.search_bar.set_query("");
                state_for_key.search_bar.set_match_info(0, 0);
                tui_for_key.request_render(false);
                continue;
            }

            // Handle search mode input
            if state_for_key.search.is_active() {
                let search_bar = state_for_key.search_bar.clone();
                match key.code {
                    KeyCode::Esc => {
                        state_for_key.search.deactivate();
                        search_bar.set_visible(false);
                        tui_for_key.request_render(false);
                        continue;
                    }
                    KeyCode::Enter => {
                        if key.modifiers.contains(KeyModifiers::SHIFT) {
                            state_for_key.search.previous_match();
                        } else {
                            state_for_key.search.next_match();
                        }
                        // Update search bar with current match info
                        let match_index = state_for_key.search.get_match_index();
                        let match_count = state_for_key.search.get_match_count();
                        search_bar.set_match_info(match_index, match_count);
                        tui_for_key.request_render(false);
                        continue;
                    }
                    KeyCode::Backspace => {
                        state_for_key.search.backspace();
                        // Re-search with updated query
                        let lines = collect_transcript_lines(&state_for_key.chat_container);
                        state_for_key.search.find_matches(&lines);
                        // Update search bar
                        let query = state_for_key.search.get_query();
                        let match_count = state_for_key.search.get_match_count();
                        search_bar.set_query(&query);
                        search_bar.set_match_info(0, match_count);
                        tui_for_key.request_render(false);
                        continue;
                    }
                    KeyCode::Char(c) => {
                        state_for_key.search.append_char(c);
                        // Re-search with updated query
                        let lines = collect_transcript_lines(&state_for_key.chat_container);
                        state_for_key.search.find_matches(&lines);
                        // Update search bar
                        let query = state_for_key.search.get_query();
                        let match_count = state_for_key.search.get_match_count();
                        search_bar.set_query(&query);
                        search_bar.set_match_info(0, match_count);
                        tui_for_key.request_render(false);
                        continue;
                    }
                    _ => continue,
                }
            }

            // 3. Ctrl+L: open the model selector. Routed through the `/model`
            //    command so the hotkey and the slash command share one path
            //    (TS binds Ctrl+L to model-select).
            if keybinding_matches(
                &keybindings_for_key,
                &key,
                rpi_tui::keybindings::keys::MODEL_SELECT,
            ) {
                if let Some(cmd) = registry_for_key.find("/model") {
                    cmd.execute(&ctx_for_key, "");
                }
                continue;
            }

            // 3a. The session actions (upstream's `app.session.*`). They have
            //      no default key, so they only fire when the user binds one;
            //      each one runs the same command as its slash counterpart.
            if keybinding_matches(
                &keybindings_for_key,
                &key,
                rpi_tui::keybindings::keys::SESSION_NEW,
            ) {
                if let Some(cmd) = registry_for_key.find("/clear") {
                    cmd.execute(&ctx_for_key, "");
                }
                continue;
            }
            if keybinding_matches(
                &keybindings_for_key,
                &key,
                rpi_tui::keybindings::keys::SESSION_TREE,
            ) {
                if let Some(cmd) = registry_for_key.find("/tree") {
                    cmd.execute(&ctx_for_key, "");
                }
                continue;
            }
            if keybinding_matches(
                &keybindings_for_key,
                &key,
                rpi_tui::keybindings::keys::SESSION_FORK,
            ) {
                if let Some(cmd) = registry_for_key.find("/fork") {
                    cmd.execute(&ctx_for_key, "");
                }
                continue;
            }
            if keybinding_matches(
                &keybindings_for_key,
                &key,
                rpi_tui::keybindings::keys::SESSION_RESUME,
            ) {
                if let Some(cmd) = registry_for_key.find("/resume") {
                    cmd.execute(&ctx_for_key, "");
                }
                continue;
            }

            // 4. Tab: accept the top autocomplete suggestion (if any).
            if key.modifiers == KeyModifiers::NONE && key.code == KeyCode::Tab {
                if accept_top_suggestion(&state_for_key, &editor_for_key) {
                    tui_for_key.request_render_reusing_scroll_content();
                }
                continue;
            }

            // 4b. Enter: accept the highlighted autocomplete suggestion. The
            //     original's editor binds `tui.select.confirm` to the open
            //     suggestion list, so Enter picks the highlighted row instead
            //     of sending the raw draft. A `/` command completion also
            //     submits (upstream falls through to submit for a command),
            //     while a path or mention completion only fills the text.
            if key.modifiers == KeyModifiers::NONE && key.code == KeyCode::Enter {
                match accept_highlighted_suggestion(&state_for_key, &editor_for_key) {
                    AcceptOutcome::None => {}
                    AcceptOutcome::Completed => {
                        tui_for_key.request_render_reusing_scroll_content();
                        continue;
                    }
                    AcceptOutcome::SlashCommand => {
                        // The command is in the editor now; let it go to the
                        // editor's submit path below.
                        tui_for_key.request_render_reusing_scroll_content();
                    }
                }
            }

            // 5. Global transcript scroll. PageUp/PageDown use the actual
            // viewport height with four rows of overlap (upstream behavior),
            // while Home/End jump to the transcript boundaries.
            if crate::transcript_navigation::handle_key(&tui_for_key, &keybindings_for_key, &key) {
                continue;
            }

            // 5a-bis. ↑/↓ navigate the autocomplete list while it is open
            //     (typed `/` or `@`), then Tab accepts the highlighted row.
            if key.modifiers == KeyModifiers::NONE
                && (key.code == KeyCode::Up || key.code == KeyCode::Down)
            {
                let direction = if key.code == KeyCode::Up { -1 } else { 1 };
                if navigate_autocomplete(&state_for_key, &editor_for_key, direction) {
                    tui_for_key.request_render_reusing_scroll_content();
                    continue;
                }
            }

            // 5b. ↑/↓ browse submitted-message history when the editor is
            //     EMPTY (a fresh prompt) — mirrors TS historyPrevious/Next
            //     without the surprise of replacing typed text. When the
            //     editor holds content, ↑/↓ fall through to cursor movement
            //     (typing "hello", pressing ↑ at the start, must never swap
            //     the draft for a history entry — reported as "text
            //     disappeared"). Once browsing, ↓ walks back and restores the
            //     draft.
            if key.modifiers == KeyModifiers::NONE && key.code == KeyCode::Up {
                let browsing = *state_for_key.history_index.lock().unwrap() != -1;
                if editor_for_key.get_text().is_empty() || browsing {
                    navigate_history(&state_for_key, &editor_for_key, -1);
                    tui_for_key.request_render_reusing_scroll_content();
                    continue;
                }
            }
            if key.modifiers == KeyModifiers::NONE && key.code == KeyCode::Down {
                let browsing = *state_for_key.history_index.lock().unwrap() != -1;
                if editor_for_key.get_text().is_empty() || browsing {
                    navigate_history(&state_for_key, &editor_for_key, 1);
                    tui_for_key.request_render_reusing_scroll_content();
                    continue;
                }
            }

            // `app.message.dequeue` (Alt+Q on Windows, Alt+Up elsewhere):
            // restore every queued steering/follow-up message into the editor
            // so it can be edited before resending. Mirrors upstream's
            // `handleDequeue`; the pending-messages display shows the hint.
            if keybinding_matches(
                &keybindings_for_key,
                &key,
                rpi_tui::keybindings::keys::DEQUEUE,
            ) {
                // Handled here, on the key worker — NOT via the mailbox. The
                // async main loop parks inside `run_prompt_streaming(..).await`
                // for the whole run, and a queue only exists *while* a run is
                // in flight, so a `TuiMessage::Dequeue` sat unread until the
                // run finished (after the lane had already consumed the queue).
                // Alt+Q therefore looked like a no-op while it was most needed.
                // Spawn the drain so it lands while the user is still looking at
                // the queue, exactly like the Alt+Enter `follow_up` path above.
                // Routed through `handle_dequeue` (not the raw restore) so the
                // `Restored N queued message(s)` status note fires, mirroring
                // upstream's `handleDequeue`.
                tokio::spawn(handle_dequeue(
                    lane_for_key.clone(),
                    editor_for_key.clone(),
                    state_for_key.clone(),
                    tui_for_key.clone(),
                ));
                continue;
            }

            // `app.message.followUp` (Alt+Enter; Ctrl+Q and Alt+Enter on
            // Windows) queues a follow-up while a run is active. It is handled
            // here because Editor treats only a bare Enter as submit; when idle
            // the same key keeps the normal prompt behavior.
            if keybinding_matches(
                &keybindings_for_key,
                &key,
                rpi_tui::keybindings::keys::MESSAGE_FOLLOW_UP,
            ) {
                let prompt = editor_for_key.get_expanded_text().trim().to_string();
                if prompt.is_empty() && state_for_key.pending_images.lock().unwrap().is_empty() {
                    continue;
                }
                editor_for_key.clear();
                let status = *state_for_key.status.lock().unwrap();
                if status == RunStatus::Idle {
                    if state_for_key.try_start_working() {
                        // Direct send: the harness emits no user `message_start`
                        // for it, so render the bubble here (see the submit
                        // handler in `interactive_tui`).
                        add_user_message(&state_for_key.chat_container, &prompt);
                        push_history(&state_for_key, &prompt);
                        let _ = tx_for_key.send(TuiMessage::UserInput(
                            prompt,
                            state_for_key.take_pending_images(),
                        ));
                    }
                } else {
                    // Follow-ups are echoed by the loop's
                    // `AgentEvent::MessageStart` once they are consumed; while
                    // they wait, the pending-messages display shows them.
                    let images = state_for_key.take_pending_images();
                    let message = user_message_with_images(&prompt, images.clone());
                    let lane = lane_for_key.clone();
                    let chat = state_for_key.chat_container.clone();
                    let tui = tui_for_key.clone();
                    let state = state_for_key.clone();
                    tokio::spawn(async move {
                        if let Err(error) = lane.follow_up(message).await {
                            state.restore_pending_images(images);
                            add_error_message(&chat, &format!("Could not queue message: {error}"));
                            tui.request_render(false);
                            return;
                        }
                        refresh_pending_messages(&state, &lane).await;
                        tui.request_render(false);
                    });
                }
                tui_for_key.request_render(false);
                continue;
            }

            // Windows' console backend has no Event::Paste. Assemble text keys
            // into one payload; only absorb Enter when another key is queued
            // or the clipboard confirms a trailing pasted newline. A standalone
            // Enter must reach Editor::handle_key so it submits normally.
            if cfg!(windows) {
                let text_key = match key.code {
                    KeyCode::Char(c)
                        if !key
                            .modifiers
                            .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
                    {
                        Some(c)
                    }
                    _ => None,
                };
                if let Some(ch) = text_key {
                    if ch == '\r' || ch == '\n' {
                        // Treat these the same as KeyCode::Enter below.
                    } else {
                        windows_paste_run.feed(ch, std::time::Instant::now());
                        #[cfg(windows)]
                        if windows_paste_run.burst
                            && windows_paste_run.text.len() >= 64
                            && pending_event.is_none()
                            && state_for_key
                                .extension_claimed_keys
                                .lock()
                                .unwrap()
                                .is_empty()
                        {
                            windows_paste_run.read_queued_text();
                        }
                        continue;
                    }
                }
                if key.modifiers.is_empty()
                    && matches!(
                        key.code,
                        KeyCode::Enter | KeyCode::Char('\n') | KeyCode::Char('\r')
                    )
                {
                    let (more_queued, stashed) = probe_paste_input(pending_event.take(), || {
                        if crossterm::event::poll(PASTE_PROBE).unwrap_or(false) {
                            crossterm::event::read().ok()
                        } else {
                            None
                        }
                    });
                    pending_event = stashed;
                    let clipboard = if !more_queued && windows_paste_run.burst {
                        read_clipboard_text()
                    } else {
                        None
                    };
                    if windows_enter_in_paste(&windows_paste_run, more_queued, clipboard.as_deref())
                    {
                        windows_paste_run.feed('\n', std::time::Instant::now());
                        crate::key_trace::note("windows paste run -> newline");
                        continue;
                    }
                    crate::key_trace::note("windows paste run -> flush + submit");
                    windows_paste_run.flush(&editor_for_key);
                } else {
                    windows_paste_run.flush(&editor_for_key);
                }
            }

            // 6. Otherwise forward to the editor + refresh autocomplete. The
            //    editor maps unmodified Enter and the encodings a remote client
            //    may send for it (`Char('\n')`/`Char('\r')`, and the raw LF
            //    crossterm reports as `Ctrl+J`) to submit, so a remote Enter
            //    sends instead of inserting a newline.
            editor_for_key.handle_key(key);
            refresh_autocomplete(&state_for_key, &editor_for_key);
            tui_for_key.request_render_reusing_scroll_content();
        }
    });

    // ---- Session lifecycle (P1): SessionStart ----
    // The TUI + key worker are up and the session is ready to accept input.
    // Notify subscribed extensions now so they can initialize session-scoped
    // state. A veto here is **advisory** (the session is already up) — warn and
    // continue. No-op when no extension subscribes.
    if let Some(reason) = crate::session::dispatch_session_event_async(
        reload_context,
        rpi_plugin_sdk::EventTag::SessionStart,
    )
    .await
    {
        tracing::warn!("[rpi] extension vetoed SessionStart (advisory): {reason}");
    }

    // ---- Initial prompts (run before reading from the channel) ----
    let mut prompts: Vec<String> = Vec::new();
    if let Some(init) = initial {
        prompts.push(init);
    }
    for m in extra_messages {
        prompts.push(m.clone());
    }
    // ---- Continue a run that recovery repaired, the way upstream does ----
    // This happens before any user input, and only when nothing was passed on the
    // command line: an explicit `-p` means the user has already said what they
    // want next. Driven here rather than inside the harness so the run's output
    // goes through the same streaming/render path as any other run, and so
    // startup is never blocked by a run the user cannot see.
    if prompts.is_empty() && lane.has_pending_resume().await {
        run_prompt_streaming(
            &lane,
            "",
            true,
            &tui,
            &state,
            drain_handle.is_some(),
            Vec::new(),
        )
        .await;
    }

    let mut images = initial_images;
    for prompt in prompts {
        if !*running.lock().unwrap() {
            break;
        }
        // The harness emits no user `message_start` for a directly-sent prompt
        // (it drives the loop with an empty prompts vec), so the initial
        // `-p` / `--prompt` bubbles are rendered here.
        add_user_message(&chat_container, &prompt);
        add_image_previews(&chat_container, &images, show_images);
        tui.request_render(false);
        run_prompt_streaming(
            &lane,
            &prompt,
            false,
            &tui,
            &state,
            drain_handle.is_some(),
            std::mem::take(&mut images),
        )
        .await;
    }

    // ---- Main loop: process submitted input + lifecycle messages ----
    loop {
        if !*running.lock().unwrap() {
            break;
        }
        match rx.recv().await {
            Some(TuiMessage::OpenProviderSelector) => {
                let current = lane.get_model().await.ok();
                open_provider_selector(
                    &state,
                    &editor_container,
                    &editor,
                    &tui,
                    &ctx.reload_context.extension_session,
                    &ctx.tx,
                    current.as_ref().map(|model| model.provider.as_str()),
                );
            }
            Some(TuiMessage::SwitchProvider(input)) => {
                let manifests = current_provider_manifests(&ctx.reload_context.extension_session);
                let available = ctx
                    .model_catalog
                    .read()
                    .unwrap_or_else(|error| error.into_inner())
                    .clone();
                match switch_provider(&input, &manifests, &available, &lane).await {
                    Ok((model, note)) => {
                        state.set_current_model(&model);
                        add_note_message(&chat_container, &note);
                    }
                    Err(error) => add_error_message(&chat_container, &error),
                }
                tui.request_render(false);
            }
            Some(TuiMessage::UserInput(prompt, prompt_images)) => {
                // Clear the editor so the next prompt starts fresh (the submit
                // handler runs on the blocking key thread and can't mutate the
                // editor state safely there; clearing here, on the async loop,
                // keeps it on one thread). Marked programmatic: this is the host
                // tidying up after a submit, not the user typing — reporting it
                // as a user edit made a hands-free voice session switch itself
                // off the moment it was started.
                state.clear_editor_programmatically();
                add_image_previews(&chat_container, &prompt_images, state.images_visible());
                if !prompt_images.is_empty() {
                    add_note_message(
                        &chat_container,
                        &format!("Attached {} image(s) to this prompt.", prompt_images.len()),
                    );
                }
                run_prompt_streaming(
                    &lane,
                    &prompt,
                    false,
                    &tui,
                    &state,
                    drain_handle.is_some(),
                    prompt_images,
                )
                .await;
            }
            Some(TuiMessage::ExternalEditorResult(result)) => {
                match result {
                    Ok(text) => {
                        let cursor = text.chars().count();
                        editor.set_text(&text);
                        editor.set_cursor(0, cursor);
                        add_note_message(&chat_container, "Draft updated from external editor.");
                    }
                    Err(error) => add_error_message(&chat_container, &error),
                }
                tui.request_render(false);
            }
            Some(TuiMessage::UserBashFinished(report)) => {
                // Free the run slot first: the guard and the Esc router both
                // read it, so a finished command must never block the next one.
                state.finish_user_bash();
                let message = rpi_harness::messages::bash_execution_message(
                    report.command,
                    report.output,
                    report.exit_code,
                    report.cancelled,
                    report.truncated,
                    report.full_output_path,
                    Some(report.exclude_from_context),
                    now_ms(),
                );
                // While a run is in flight the message is deferred so it is not
                // spliced into the middle of a turn's tool sequence; it is
                // flushed at `AgentEnd` (upstream `_pendingBashMessages`).
                if *state.status.lock().unwrap() == RunStatus::Idle {
                    if let Err(error) = lane.append_message(message).await {
                        add_error_message(
                            &chat_container,
                            &format!("Could not record bash result: {error}"),
                        );
                        tui.request_render(false);
                    }
                } else {
                    state.pending_bash_messages.lock().unwrap().push(message);
                }
            }
            Some(TuiMessage::OpenTree) => {
                if *state.status.lock().unwrap() != RunStatus::Idle {
                    add_note_message(
                        &chat_container,
                        "Wait for the current run to finish before opening the tree.",
                    );
                    tui.request_render(false);
                } else {
                    open_tree_selector(
                        &harness,
                        &state,
                        &editor_container,
                        &editor,
                        &tui,
                        &chat_container,
                        &tx,
                    )
                    .await;
                }
            }
            Some(TuiMessage::NavigateTree(entry_id)) => {
                match lane.navigate_tree(Some(&entry_id), false, None, None).await {
                    Ok(result) => match result.outcome {
                        rpi_harness::agent_harness::NavigationOutcome::Completed { .. } => {
                            chat_container.clear();
                            add_startup_header(&chat_container, &state.startup_header);
                            render_session_history(
                                &harness,
                                &chat_container,
                                state.markdown_transformer(),
                                Some(state.extension_session.clone()),
                                state.images_visible(),
                            )
                            .await;
                            add_note_message(
                                &chat_container,
                                "Moved to the selected session entry.",
                            );
                        }
                        rpi_harness::agent_harness::NavigationOutcome::Failed { error, .. } => {
                            add_error_message(&chat_container, &error.message);
                        }
                        _ => add_note_message(
                            &chat_container,
                            "The selected entry could not be opened.",
                        ),
                    },
                    Err(error) => add_error_message(
                        &chat_container,
                        &format!("Could not navigate session tree: {error}"),
                    ),
                }
                tui.request_render(false);
            }
            Some(TuiMessage::ClearChat) => {
                chat_container.clear();
                add_startup_header(&chat_container, &state.startup_header);
                tui.request_render(false);
            }
            Some(TuiMessage::Compact) => {
                run_compact(&lane, &tui, &state).await;
            }
            Some(TuiMessage::Copy) => {
                copy_last_assistant(&state, &chat_container);
                tui.request_render(false);
            }
            Some(TuiMessage::Exit) => {
                // pi's `session_shutdown`: the extensions learn that the
                // session is going away before it goes.
                dispatch_js_event(
                    &state,
                    "session_shutdown",
                    serde_json::json!({ "type": "session_shutdown", "reason": "quit" }),
                );
                *running.lock().unwrap() = false;
                break;
            }
            Some(TuiMessage::SwitchSession(id)) => {
                switch_to_session(
                    &harness,
                    &lane,
                    &id,
                    &cwd,
                    &chat_container,
                    &state,
                    &reload_context.tool_context,
                )
                .await;
                // A switched-to session can be empty again, so the empty-session
                // screen follows it (upstream's `syncEmptySessionScreen`).
                if three_d_empty_session {
                    if session_has_messages(harness).await {
                        empty_session.deactivate(&tui);
                    } else {
                        empty_session.activate(&tui);
                    }
                }
                tui.request_render(false);
            }
            Some(TuiMessage::ImportSession(path)) => {
                // The original asks before it replaces the session: a titled
                // "Import session" block, the question, and a Yes/No list.
                let items = vec![
                    SelectItem::new("yes", "Yes"),
                    SelectItem::new("no", "No"),
                ];
                let list = Arc::new(SelectList::new(items, 10));
                let state_confirm = state.clone();
                let ec_confirm = editor_container.clone();
                let editor_confirm = editor.clone();
                let tui_confirm = tui.clone();
                let tx_confirm = tx.clone();
                let path_confirm = path.clone();
                list.on_select(Arc::new(move |item| {
                    close_selector(&state_confirm, &ec_confirm, &editor_confirm, &tui_confirm);
                    if item.value == "yes" {
                        let _ = tx_confirm.send(TuiMessage::ImportSessionConfirmed(path_confirm.clone()));
                    }
                }));
                let state_cancel = state.clone();
                let ec_cancel = editor_container.clone();
                let editor_cancel = editor.clone();
                let tui_cancel = tui.clone();
                list.on_cancel(Arc::new(move || {
                    close_selector(&state_cancel, &ec_cancel, &editor_cancel, &tui_cancel);
                }));
                open_searchable_selector(
                    &state,
                    &editor_container,
                    &editor,
                    &tui,
                    Some("Import session"),
                    Some(&format!("Replace current session with {path}?")),
                    list,
                    SelectorKind::Settings,
                );
            }
            Some(TuiMessage::ImportSessionConfirmed(path)) => {
                import_session(
                    &harness,
                    &lane,
                    &path,
                    &cwd,
                    &chat_container,
                    &state,
                    &reload_context.tool_context,
                )
                .await;
                tui.request_render(false);
            }
            Some(TuiMessage::ShareSession) => {
                share_session(&harness, &chat_container).await;
                tui.request_render(false);
            }
            Some(TuiMessage::SetSessionName(name)) => {
                let outcome = harness.session().set_name(Some(&name)).await;
                match outcome {
                    Ok(_) => add_note_message(
                        &chat_container,
                        &format!("Session renamed to \"{name}\"."),
                    ),
                    Err(e) => add_error_message(
                        &chat_container,
                        &format!("Could not rename session: {e}"),
                    ),
                }
                tui.request_render(false);
            }
            Some(TuiMessage::ExportSession) => {
                let file_name = agent_session
                    .default_export_file_name(crate::export::ExportFormat::Markdown)
                    .await;
                let path = cwd.join(&file_name);
                match agent_session.export_to_markdown(&path).await {
                    Ok(_) => add_note_message(
                        &chat_container,
                        &format!("Exported session to {}", path.display()),
                    ),
                    Err(e) => {
                        add_error_message(&chat_container, &format!("Could not write export: {e}"))
                    }
                }
                tui.request_render(false);
            }
            Some(TuiMessage::ExportSessionWithFormat(format)) => {
                let file_name = agent_session.default_export_file_name(format.clone()).await;
                let path = cwd.join(&file_name);
                match agent_session.export(format, &path).await {
                    Ok(_) => add_note_message(
                        &chat_container,
                        &format!("Exported session to {}", path.display()),
                    ),
                    Err(e) => {
                        add_error_message(&chat_container, &format!("Could not write export: {e}"))
                    }
                }
                tui.request_render(false);
            }
            Some(TuiMessage::ShowUsage) => {
                let stats = agent_session.usage_stats().await.ok();
                let total = agent_session.total_usage().await.ok();
                let snapshot = agent_session.snapshot().await.ok();
                match stats {
                    Some(stats) => {
                        let mut lines = vec![
                            "## Usage".to_string(),
                            String::new(),
                            format!("- messages: {}", stats.message_count),
                            format!("- total tokens: {}", stats.total_tokens),
                            format!("- cached tokens: {}", stats.cached_tokens),
                            format!("- uncached tokens: {}", stats.uncached_tokens),
                            format!("- cost: ${:.4}", stats.cost_total),
                        ];
                        match stats.cache_hit_ratio() {
                            Some(ratio) => {
                                lines.push(format!("- cache hit ratio: {:.1}%", ratio * 100.0))
                            }
                            None => lines.push("- cache hit ratio: n/a (no input yet)".to_string()),
                        }
                        if let Some(total) = total {
                            lines.push(String::new());
                            lines.push(format!(
                                "- last cumulative input/output: {} / {}",
                                total.input, total.output
                            ));
                        }
                        if let Some(snapshot) = snapshot {
                            lines.push(String::new());
                            lines.push(format!("- lane: `{}`", snapshot.lane));
                            lines.push(format!(
                                "- leaf: `{}`",
                                snapshot.leaf_id.clone().unwrap_or_else(|| "(empty)".into())
                            ));
                            if let Some(active) = &snapshot.active {
                                lines.push(format!(
                                    "- active operation: {} (`{}`)",
                                    active.kind.as_str(),
                                    active.run_id
                                ));
                            }
                        }
                        add_note_message(&chat_container, &lines.join("\n"));
                    }
                    None => {
                        add_error_message(&chat_container, "Could not read session usage stats.")
                    }
                }
                tui.request_render(false);
            }
            Some(TuiMessage::ForkSession) => {
                fork_session(
                    &harness,
                    &cwd,
                    &chat_container,
                    &state,
                    &reload_context.tool_context,
                )
                .await;
                tui.request_render(false);
            }
            Some(TuiMessage::ProviderOAuthAction {
                provider,
                action,
                input,
                purpose,
                flow_id,
            }) => {
                let (snapshot, keepalive) = {
                    let session = ctx
                        .reload_context
                        .extension_session
                        .lock()
                        .unwrap_or_else(|error| error.into_inner());
                    (session.snapshot_arc(), session.keepalive())
                };
                let tx = ctx.tx.clone();
                let provider_result = provider.clone();
                let action_result = action.clone();
                tokio::spawn(async move {
                    let result = match snapshot {
                        Some(snapshot) => {
                            let provider_call = provider.clone();
                            let action_call = action.clone();
                            tokio::task::spawn_blocking(move || {
                                let _keepalive = keepalive;
                                rpi_extensions::request_oauth(
                                    &snapshot,
                                    &provider_call,
                                    &action_call,
                                    input,
                                )
                                .map_err(|error| error.to_string())
                            })
                            .await
                            .map_err(|error| format!("OAuth worker failed: {error}"))
                            .and_then(|result| result)
                        }
                        None => Err("no OAuth extensions are loaded".to_string()),
                    };
                    let _ = tx.send(TuiMessage::ProviderOAuthResult {
                        provider: provider_result,
                        action: action_result,
                        result,
                        purpose,
                        flow_id,
                    });
                });
            }
            Some(TuiMessage::ProviderOAuthResult {
                provider,
                action,
                result,
                purpose,
                flow_id,
            }) => {
                if state
                    .provider_auth_flow_id
                    .load(std::sync::atomic::Ordering::Acquire)
                    != flow_id
                {
                    continue;
                }
                handle_provider_oauth_result(
                    &state,
                    &editor_container,
                    &editor,
                    &tui,
                    &ctx.tx,
                    &provider,
                    &action,
                    result,
                    purpose,
                    flow_id,
                );
            }
            Some(TuiMessage::LogoutProvider(provider)) => {
                let auth = match crate::config::read_auth() {
                    Ok(auth) => auth,
                    Err(error) => {
                        add_error_message(
                            &chat_container,
                            &format!("Could not read saved credentials: {error}"),
                        );
                        tui.request_render(false);
                        continue;
                    }
                };
                let credential = auth.get(&provider).cloned();
                match credential {
                    Some(crate::config::Credential::Oauth {
                        access, refresh, ..
                    }) => {
                        show_provider_auth_status(
                            &state,
                            &editor_container,
                            &editor,
                            &tui,
                            &format!("Revoking OAuth credentials for {provider}…"),
                        );
                        let flow_id = state
                            .provider_auth_generation
                            .fetch_add(1, std::sync::atomic::Ordering::AcqRel)
                            .wrapping_add(1);
                        state
                            .provider_auth_flow_id
                            .store(flow_id, std::sync::atomic::Ordering::Release);
                        let _ = ctx.tx.send(TuiMessage::ProviderOAuthAction {
                            provider,
                            action: "revoke".to_string(),
                            input: serde_json::json!({
                                "credential": {"access": access, "refresh": refresh}
                            }),
                            purpose: ProviderOAuthPurpose::Logout,
                            flow_id,
                        });
                    }
                    Some(crate::config::Credential::ApiKey { .. }) => {
                        match crate::config::delete_credential(&provider) {
                            Ok(true) => {
                                add_note_message(
                                    &chat_container,
                                    &format!("Removed saved credentials for {provider}; reloading providers…"),
                                );
                                let _ = ctx.tx.send(TuiMessage::ReloadExtensions);
                            }
                            Ok(false) => add_note_message(
                                &chat_container,
                                &format!("No saved credentials found for {provider}."),
                            ),
                            Err(error) => add_error_message(
                                &chat_container,
                                &format!("Could not remove {provider} credentials: {error}"),
                            ),
                        }
                        tui.request_render(false);
                    }
                    None => {
                        add_note_message(
                            &chat_container,
                            &format!("No saved credentials found for {provider}."),
                        );
                        tui.request_render(false);
                    }
                }
            }
            Some(TuiMessage::ReloadExtensions) => {
                // B5d: drive the shared reload routine on the async runtime,
                // then surface the outcome. `reload_context` was passed into
                // `interactive_tui` and is the same `Arc<ReloadContext>` the
                // `ReloadCommand` + the plugin mailbox both route through —
                // clone the `Arc` out so the borrow of `harness` (the main
                // loop's `&AgentHarness`) lives across the await.
                let reload_ctx = ctx.reload_context.clone();
                add_note_message(&chat_container, "Reloading extensions + resources…");
                tui.request_render(false);
                let outcome =
                    crate::session::reload_extension_resources(&harness, &reload_ctx).await;
                if !outcome.had_errors {
                    if let Ok(resources) = harness.get_resources().await {
                        *ctx.resources.lock().unwrap() = resources;
                    }
                }
                // B5e: the reload swapped a fresh `ExtensionSession` into the
                // context's cell. Rebuild the markdown transformer from that
                // fresh snapshot and install it on the in-flight streaming
                // component (so a reloaded plugin's transformer takes effect on
                // the visible message immediately) + future components (they
                // read `state.markdown_transformer()` at construction). The old
                // closure no-ops once its snapshot's `active` flag flips false
                // (reload already did that before the swap).
                let fresh_transformer = build_markdown_transformer(
                    reload_ctx.extension_session.lock().unwrap().snapshot_arc(),
                );
                state.set_markdown_transformer_with_reinstall(fresh_transformer);
                if outcome.had_errors {
                    // Hard failure: the summary itself carries the error detail
                    // (e.g. "Settings reload failed: …"), so render it as an
                    // error without an extra stderr pointer.
                    add_error_message(&chat_container, &outcome.summary);
                } else if outcome.had_warnings {
                    // Reload succeeded but produced soft diagnostics (skill
                    // shadowing, name validation, …). The details are printed
                    // to stderr; keep this as an informational note so a
                    // successful reload isn't shown as a red ✗ error.
                    add_note_message(
                        &chat_container,
                        &format!(
                            "{} (with warnings — see stderr for details).",
                            outcome.summary
                        ),
                    );
                } else {
                    add_note_message(&chat_container, &outcome.summary);
                }
                tui.request_render(false);
            }
            // The original's `/skills`, `/bug` and `/stats` are registered and
            // dispatch here; the bodies belong to the interactive mode port.
            // The original's `/new` starts a new session; the body belongs to
            // the interactive mode port.
            Some(TuiMessage::NewSession) => {
                add_note_message(
                    &chat_container,
                    "A new session is not created by this command yet; the current session continues. Use /session to switch to another one.",
                );
            }
            Some(TuiMessage::ShowSkills) => {
                if skill_list.is_empty() {
                    add_note_message(&chat_container, "No skills are loaded.");
                } else {
                    let mut lines = vec![format!("## Skills ({})", skill_list.len()), String::new()];
                    for (name, description) in &skill_list {
                        lines.push(format!("- {name}: {description}"));
                    }
                    add_note_message(&chat_container, &lines.join("\n"));
                }
            }
            Some(TuiMessage::ReportBug(description)) => {
                let mut bundle = String::new();
                bundle.push_str("# rpi bug report\n\n");
                bundle.push_str(&format!(
                    "- version: {}\n",
                    crate::changelog::current_version()
                ));
                bundle.push_str(&format!("- platform: {}\n", std::env::consts::OS));
                bundle.push_str(&format!("- description: {description}\n"));
                if let Ok(snapshot) = agent_session.snapshot().await {
                    bundle.push_str(&format!("- lane: `{}`\n", snapshot.lane));
                    bundle.push_str(&format!(
                        "- leaf: `{}`\n",
                        snapshot
                            .leaf_id
                            .clone()
                            .unwrap_or_else(|| "(empty)".into())
                    ));
                }
                if let Ok(stats) = agent_session.usage_stats().await {
                    bundle.push_str(&format!("- messages: {}\n", stats.message_count));
                    bundle.push_str(&format!("- total tokens: {}\n", stats.total_tokens));
                }
                let path = std::env::current_dir()
                    .unwrap_or_default()
                    .join("rpi-bug-report.md");
                match std::fs::write(&path, bundle) {
                    Ok(()) => add_note_message(
                        &chat_container,
                        &format!("Bug report written to {}", path.display()),
                    ),
                    Err(error) => add_error_message(
                        &chat_container,
                        &format!("Could not write the bug report: {error}"),
                    ),
                }
            }
            Some(TuiMessage::ShowStats) => {
                let stats = agent_session.usage_stats().await.ok();
                let snapshot = agent_session.snapshot().await.ok();
                let mut lines = vec!["## Stats".to_string(), String::new()];
                if let Some(snapshot) = &snapshot {
                    lines.push(format!("- lane: `{}`", snapshot.lane));
                    lines.push(format!(
                        "- leaf: `{}`",
                        snapshot.leaf_id.clone().unwrap_or_else(|| "(empty)".into())
                    ));
                }
                if let Some(stats) = &stats {
                    lines.push(format!("- messages: {}", stats.message_count));
                    lines.push(format!("- total tokens: {}", stats.total_tokens));
                    lines.push(format!("- cached tokens: {}", stats.cached_tokens));
                    lines.push(format!("- cost: ${:.4}", stats.cost_total));
                }
                add_note_message(&chat_container, &lines.join("\n"));
            }
            None => break,
        }
    }

    // ---- Shutdown ----
    ask_user_bridge.shutdown();
    *running.lock().unwrap() = false;
    for handle in update_check_handles {
        handle.abort();
        let _ = handle.await;
    }
    // The input worker checks `running` at least every 50ms. Join it before
    // restoring cooked mode so no late event read races terminal cleanup.
    let _ = key_handle.await;
    tick_handle.abort();
    if let Some(handle) = drain_handle {
        handle.abort();
    }
    // Drop the reload bridge: clearing the mailbox closes the signal channel,
    // the drain task's `recv` returns `None`, and the task exits. (Aborting is
    // redundant — the recv terminates — but cheap + makes shutdown explicit.)
    reload_context.mailbox.clear();
    reload_bridge_handle.abort();
    tui.stop(Default::default());

    // upstream prints how to resume the session after an interactive exit so
    // a terminal that scrolled away can be recovered. Mirrors
    // `formatResumeCommand` (id + `--session-dir` only when non-default).
    let session_id = harness.session().storage().metadata().id;
    if let Some(command) = format_resume_command(&session_id, &cwd, args.session_dir.as_deref()) {
        println!("\x1b[2mTo resume this session:\x1b[0m {command}");
    }
    let _ = args;

    0
}

// ===========================================================================
// TUI support + entry detection
// ===========================================================================

/// Check if the terminal supports TUI mode.
pub fn is_tui_supported() -> bool {
    std::io::stdout().is_terminal()
}

// Keep the `Color` import used (theme accent rendering in autocomplete).
#[allow(unused_imports)]
use rpi_tui::Color as _Color;
