//! `<agent-dir>/settings.json` — saved user defaults. The agent dir is pi's
//! (`~/.pi/agent`), so this is the user's own pi installation: the file uses
//! pi's shape, every key carries pi's name, pi's type and pi's default.
//!
//! Upstream's schema is `packages/coding-agent/src/core/settings-schema.ts`
//! and its defaults are `packages/coding-agent/src/core/settings-defaults.ts`;
//! both are mirrored here, so a `settings.json` written by pi is read here
//! exactly the way pi reads it, and a file written here is read by pi.
//!
//! A setting that is absent from the file keeps pi's default. The defaults
//! live in [`defaults`] and are applied by [`Settings::effective`], so the
//! load path, the save path and the defaults cannot drift apart: the struct's
//! serde attributes are the single source of truth for the key names.
//!
//! The keys that are not pi's are rpi's own extensions, marked as such in the
//! struct. Legacy rpi spellings (`scopedModels`, `httpIdleTimeout`, flat
//! `showImages`/`showTerminalProgress`, `skillDirs`/`promptDirs`/
//! `extensionDirs`) are still read, but the key written back is pi's.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::config::{self, strip_line_comments, ConfigError};

/// pi's defaults, mirrored from `settings-defaults.ts`.
pub mod defaults {
    pub const TRANSPORT: &str = "auto";
    pub const SESSION_SHARE_DESTINATION: &str = "auto";
    pub const STEERING_MODE: &str = "one-at-a-time";
    pub const FOLLOW_UP_MODE: &str = "one-at-a-time";
    pub const COMPACTION_ENABLED: bool = true;
    pub const COMPACTION_RESERVE_TOKENS: i64 = 16384;
    pub const COMPACTION_KEEP_RECENT_TOKENS: i64 = 20000;
    pub const BRANCH_SUMMARY_RESERVE_TOKENS: i64 = 16384;
    pub const BRANCH_SUMMARY_SKIP_PROMPT: bool = false;
    pub const RETRY_ENABLED: bool = true;
    pub const RETRY_MAX_RETRIES: u32 = 3;
    pub const RETRY_BASE_DELAY_MS: u64 = 2000;
    pub const RETRY_MAX_AGENT_DELAY_MS: u64 = 60_000;
    pub const RETRY_PROVIDER_MAX_RETRY_DELAY_MS: u64 = 60_000;
    pub const HIDE_THINKING_BLOCK: bool = true;
    pub const PROJECT_CONTEXT_MAX_CHARS: u64 = 0;
    pub const SHOW_CACHE_MISS_NOTICES: bool = false;
    pub const QUIET_STARTUP: bool = false;
    pub const DEFAULT_PROJECT_TRUST: &str = "ask";
    pub const COLLAPSE_CHANGELOG: bool = false;
    pub const ENABLE_SKILL_COMMANDS: bool = true;
    pub const TERMINAL_SHOW_IMAGES: bool = true;
    pub const TERMINAL_IMAGE_WIDTH_CELLS: u32 = 60;
    pub const TERMINAL_CLEAR_ON_SHRINK: bool = false;
    pub const TERMINAL_SHOW_TERMINAL_PROGRESS: bool = false;
    pub const IMAGES_AUTO_RESIZE: bool = true;
    pub const IMAGES_BLOCK_IMAGES: bool = false;
    pub const DOUBLE_ESCAPE_ACTION: &str = "tree";
    pub const TREE_FILTER_MODE: &str = "default";
    pub const EDITOR_PADDING_X: u32 = 0;
    pub const OUTPUT_PAD: u32 = 1;
    pub const NERD_FONTS: bool = false;
    pub const THREE_D_EMPTY_SESSION: bool = false;
    pub const AUTOCOMPLETE_MAX_VISIBLE: u32 = 5;
    pub const AUTOCOMPLETE_POSITION: &str = "above";
    pub const MARKDOWN_CODE_BLOCK_INDENT: &str = "  ";
    pub const MARKDOWN_MERMAID: &str = "streaming";
    pub const WARNINGS_ANTHROPIC_EXTRA_USAGE: bool = true;
    pub const CODEMODE_MODE: &str = "on";
    pub const CODEMODE_INLINE_BUDGET: u32 = 3000;
    pub const CACHE_WARMING: &str = "streaming";
    pub const TUI_MODE: &str = "fullscreen";
    pub const FULLSCREEN_EXIT_OUTPUT: &str = "resume-hint";
    pub const FULLSCREEN_SCROLLBAR: &str = "auto";
    pub const FULLSCREEN_COPY_ON_SELECT: bool = true;
    pub const FULLSCREEN_WHEEL_SCROLL_LINES: u32 = 1;
}

/// `retry` — upstream's `RetrySettings`.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RetrySettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_retries: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_delay_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_agent_delay_ms: Option<u64>,
    /// upstream's nested `retry.provider`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<ProviderRetrySettings>,
    /// upstream's legacy `retry.maxDelayMs`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_delay_ms: Option<u64>,
}

/// `retry.provider` — upstream's `ProviderRetrySettings`. The fields configure
/// the provider SDK's own retry loop, which rpi does not run; they are kept so
/// a copied file round-trips.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRetrySettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_retries: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_retry_delay_ms: Option<u64>,
}

/// `compaction` — upstream's `CompactionSettings`.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompactionSettingsJson {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reserve_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep_recent_tokens: Option<i64>,
    /// Per-model overrides, keyed by `provider/modelId`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_overrides: Option<HashMap<String, CompactionModelOverride>>,
}

/// `compaction.modelOverrides` — upstream's `CompactionModelOverride`.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompactionModelOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reserve_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep_recent_tokens: Option<i64>,
}

/// `branchSummary` — upstream's `BranchSummarySettings`.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct BranchSummarySettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reserve_tokens: Option<i64>,
    /// When true, upstream skips its "Summarize branch?" prompt and defaults to
    /// *no* summary. rpi has no such prompt, so this is what makes the key mean
    /// something: `Some(true)` suppresses the summary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip_prompt: Option<bool>,
}

/// `terminal` — upstream's `TerminalSettings`.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSettings {
    /// `terminal.showImages` — render images inline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_images: Option<bool>,
    /// `terminal.imageWidthCells` — preferred inline image width in cells.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_width_cells: Option<u32>,
    /// `terminal.clearOnShrink` — clear empty rows when content shrinks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clear_on_shrink: Option<bool>,
    /// `terminal.showTerminalProgress` — OSC 9;4 terminal progress indicator.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_terminal_progress: Option<bool>,
    /// `terminal.hyperlinks` — `true`, `false` or `"auto"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hyperlinks: Option<serde_json::Value>,
    /// `terminal.images` — `"kitty"`, `"iterm2"`, `"auto"` or `false`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub images: Option<serde_json::Value>,
    /// `terminal.trueColor` — `true`, `false` or `"auto"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub true_color: Option<serde_json::Value>,
}

/// `images` — upstream's `ImageSettings`.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImageSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_resize: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_images: Option<bool>,
}

/// `markdown` — upstream's `MarkdownSettings`.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code_block_indent: Option<String>,
    /// `"off"`, `"final"` or `"streaming"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mermaid: Option<String>,
}

/// `warnings` — upstream's `WarningSettings`.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct WarningSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anthropic_extra_usage: Option<bool>,
}

/// `codemode` — upstream's `CodemodeSettings`.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodemodeSettings {
    /// `"on"` or `"only"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inline_budget: Option<u32>,
}

/// `thinkingBudgets` — upstream's `ThinkingBudgetsSettings`.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThinkingBudgetsSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minimal: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub low: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub medium: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub high: Option<f64>,
}

/// The terminal capability overrides the settings file can force. Mirrors
/// upstream's `getTerminalCapabilityOverrides` (`core/settings-manager.ts:1188`).
#[derive(Clone, Copy, Debug, Default)]
pub struct TerminalCapabilityOverrides {
    /// The inline-image protocol; `None` leaves the detection alone.
    pub images: Option<rpi_tui::ImageProtocol>,
    /// Whether the terminal is 24-bit colour; `None` leaves the detection alone.
    pub true_color: Option<bool>,
    /// Whether OSC 8 hyperlinks are emitted; `None` leaves the detection alone.
    pub hyperlinks: Option<bool>,
}

/// `steeringMode` / `followUpMode` — upstream's queue drain modes.
#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum QueueModeSetting {
    All,
    OneAtATime,
}

impl QueueModeSetting {
    /// The key spelling used in the settings file.
    pub fn as_str(self) -> &'static str {
        match self {
            QueueModeSetting::All => "all",
            QueueModeSetting::OneAtATime => "one-at-a-time",
        }
    }
}

impl From<QueueModeSetting> for rpi_agent::QueueMode {
    fn from(mode: QueueModeSetting) -> Self {
        match mode {
            QueueModeSetting::All => rpi_agent::QueueMode::All,
            QueueModeSetting::OneAtATime => rpi_agent::QueueMode::OneAtATime,
        }
    }
}

/// pi's `Settings`, keyed exactly as upstream's schema keys it.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// `$schema` — JSON Schema reference.
    #[serde(rename = "$schema", default)]
    pub schema: Option<String>,
    /// `lastChangelogVersion` — the last release note the user has seen.
    #[serde(default)]
    pub last_changelog_version: Option<String>,
    /// Saved default provider id.
    #[serde(default)]
    pub default_provider: Option<String>,
    /// Saved default model id. When present and the model is authed,
    /// `provider::resolve` selects it (pi `findInitialModel` step 3).
    #[serde(default)]
    pub default_model: Option<String>,
    /// Saved default thinking level (a level-name string: off/minimal/low/medium/
    /// high/xhigh/max).
    #[serde(default)]
    pub default_thinking_level: Option<String>,
    /// `modelThinkingLevels` — per-model thinking level overrides, keyed by
    /// `provider/modelId`.
    #[serde(default)]
    pub model_thinking_levels: Option<HashMap<String, String>>,
    /// `transport` — `"auto"`, `"sse"`, `"websocket"` or `"websocket-cached"`.
    #[serde(default)]
    pub transport: Option<String>,
    /// `sessionShareDestination` — `"auto"`, `"gist"` or `"radius"`.
    #[serde(default)]
    pub session_share_destination: Option<String>,
    /// How queued steering messages are drained. upstream default:
    /// `"one-at-a-time"`.
    #[serde(default)]
    pub steering_mode: Option<QueueModeSetting>,
    /// How queued follow-up messages are drained. upstream default:
    /// `"one-at-a-time"`.
    #[serde(default)]
    pub follow_up_mode: Option<QueueModeSetting>,
    /// Saved theme name. Surfaced for best-effort TUI theme application.
    #[serde(default)]
    pub theme: Option<String>,
    /// `compaction` — upstream's `CompactionSettings`.
    #[serde(default)]
    pub compaction: Option<CompactionSettingsJson>,
    /// `branchSummary` — upstream's `BranchSummarySettings`.
    #[serde(default)]
    pub branch_summary: Option<BranchSummarySettings>,
    /// `retry` — upstream's `RetrySettings`.
    #[serde(default)]
    pub retry: Option<RetrySettings>,
    /// `hideThinkingBlock` — hide the body of thinking blocks.
    #[serde(default)]
    pub hide_thinking_block: Option<bool>,
    /// `showCacheMissNotices` — show cache cost and provider recovery notices.
    #[serde(default)]
    pub show_cache_miss_notices: Option<bool>,
    /// `externalEditor` — command for the Ctrl+G external editor.
    #[serde(default)]
    pub external_editor: Option<String>,
    /// `shellPath` — custom shell binary.
    #[serde(default)]
    pub shell_path: Option<String>,
    /// `quietStartup` — `"true"`, `"header"` or `"false"`. pi's `"header"` mode
    /// keeps the startup header and hides the rest. The file keeps pi's shape:
    /// a boolean, or the string `"header"`.
    #[serde(
        default,
        deserialize_with = "deserialize_quiet_startup",
        serialize_with = "serialize_quiet_startup"
    )]
    pub quiet_startup: Option<String>,
    /// `defaultProjectTrust` — `"ask"`, `"always"` or `"never"`.
    #[serde(default)]
    pub default_project_trust: Option<String>,
    /// `shellCommandPrefix` — prefix prepended to every bash command.
    #[serde(default)]
    pub shell_command_prefix: Option<String>,
    /// `npmCommand` — argv used for npm package lookup and installation.
    #[serde(default)]
    pub npm_command: Option<Vec<String>>,
    /// `collapseChangelog` — show the condensed changelog after update.
    #[serde(default)]
    pub collapse_changelog: Option<bool>,
    /// `packages` — npm or git package sources, as strings or objects with
    /// resource filtering.
    #[serde(default)]
    pub packages: Option<Vec<serde_json::Value>>,
    /// `extensions` — local extension file paths or directories. rpi loads
    /// cdylib extensions from these directories; the legacy rpi spelling
    /// `extensionDirs` is still read.
    #[serde(
        rename = "extensions",
        alias = "extensionDirs",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub extension_dirs: Option<Vec<String>>,
    /// `deviceId` — stable installation UUID.
    #[serde(default)]
    pub device_id: Option<String>,
    /// `skills` — local skill file paths or directories. The legacy rpi
    /// spelling `skillDirs` is still read; pi's deprecated object form
    /// (`customDirectories`) is understood as well.
    #[serde(
        rename = "skills",
        alias = "skillDirs",
        default,
        deserialize_with = "deserialize_skills"
    )]
    pub skill_dirs: Option<Vec<String>>,
    /// `prompts` — local prompt template file paths or directories. The legacy
    /// rpi spelling `promptDirs` is still read.
    #[serde(
        rename = "prompts",
        alias = "promptDirs",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub prompt_dirs: Option<Vec<String>>,
    /// `themes` — local theme file paths or directories.
    #[serde(default)]
    pub themes: Option<Vec<String>>,
    /// `enableSkillCommands` — enable `/skill:name` command expansion.
    #[serde(default)]
    pub enable_skill_commands: Option<bool>,
    /// `terminal` — upstream's `TerminalSettings`.
    #[serde(default)]
    pub terminal: Option<TerminalSettings>,
    /// `images` — upstream's `ImageSettings`.
    #[serde(default)]
    pub images: Option<ImageSettings>,
    /// `enabledModels` — the model ids allowed in the Ctrl+P cycle. Absent /
    /// empty ⇒ every catalog model cycles. The legacy rpi spelling
    /// `scopedModels` is still read.
    #[serde(
        rename = "enabledModels",
        alias = "scopedModels",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub scoped_models: Option<Vec<String>>,
    /// `defaultTools` — initial tool selection.
    #[serde(default)]
    pub default_tools: Option<Vec<String>>,
    /// `doubleEscapeAction` — `"fork"`, `"tree"` or `"none"`.
    #[serde(default)]
    pub double_escape_action: Option<String>,
    /// `treeFilterMode` — the default filter when opening `/tree`.
    #[serde(default)]
    pub tree_filter_mode: Option<String>,
    /// `thinkingBudgets` — custom token budgets for thinking levels.
    #[serde(default)]
    pub thinking_budgets: Option<ThinkingBudgetsSettings>,
    /// `editorPaddingX` — horizontal padding for the input editor.
    #[serde(default)]
    pub editor_padding_x: Option<usize>,
    /// `outputPad` — horizontal padding for transcript content (`0` or `1`).
    #[serde(default)]
    pub output_pad: Option<usize>,
    /// `nerdFonts` — show Nerd Font glyphs in front of the footer groups.
    #[serde(default)]
    pub nerd_fonts: Option<bool>,
    /// `threeDEmptySession` — show the spinning 3D logo on an empty session.
    #[serde(default)]
    pub three_d_empty_session: Option<bool>,
    /// `autocompleteMaxVisible` — maximum visible autocomplete rows.
    #[serde(default)]
    pub autocomplete_max_visible: Option<usize>,
    /// `autocompletePosition` — `"above"` or `"below"`.
    #[serde(default)]
    pub autocomplete_position: Option<String>,
    /// `showHardwareCursor` — show the terminal cursor while still positioning
    /// it for IME.
    #[serde(default)]
    pub show_hardware_cursor: Option<bool>,
    /// `markdown` — upstream's `MarkdownSettings`.
    #[serde(default)]
    pub markdown: Option<MarkdownSettings>,
    /// `warnings` — upstream's `WarningSettings`.
    #[serde(default)]
    pub warnings: Option<WarningSettings>,
    /// `codemode` — upstream's `CodemodeSettings`.
    #[serde(default)]
    pub codemode: Option<CodemodeSettings>,
    /// `sessionDir` — custom session storage directory.
    #[serde(default)]
    pub session_dir: Option<PathBuf>,
    /// `httpProxy` — proxy URL for rpi's own HTTP clients.
    #[serde(default)]
    pub http_proxy: Option<String>,
    /// `httpIdleTimeoutMs` — idle timeout in milliseconds, or `"disabled"`.
    /// The legacy rpi spelling `httpIdleTimeout` is still read.
    #[serde(
        rename = "httpIdleTimeoutMs",
        alias = "httpIdleTimeout",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub http_idle_timeout: Option<serde_json::Value>,
    /// `projectContextMaxChars` — maximum size of the project context in the
    /// system prompt.
    #[serde(default)]
    pub project_context_max_chars: Option<u64>,
    /// `cacheWarming` — `"off"`, `"streaming"` or `"idle"`.
    #[serde(default)]
    pub cache_warming: Option<String>,
    /// `websocketConnectTimeoutMs` — connect timeout in milliseconds, or
    /// `"disabled"`.
    #[serde(default)]
    pub websocket_connect_timeout_ms: Option<serde_json::Value>,
    /// `tuiMode` — `"regular"` or `"fullscreen"`.
    #[serde(default)]
    pub tui_mode: Option<String>,
    /// `fullscreenExitOutput` — `"transcript"` or `"resume-hint"`.
    #[serde(default)]
    pub fullscreen_exit_output: Option<String>,
    /// `fullscreenScrollbar` — `"auto"`, `"always"` or `"hidden"`.
    #[serde(default)]
    pub fullscreen_scrollbar: Option<String>,
    /// `fullscreenCopyOnSelect` — copy a selection automatically.
    #[serde(default)]
    pub fullscreen_copy_on_select: Option<bool>,
    /// `fullscreenWheelScrollLines` — lines per wheel event, or `"auto"`.
    #[serde(default)]
    pub fullscreen_wheel_scroll_lines: Option<serde_json::Value>,
    /// `queueMode` — legacy setting migrated to `steeringMode`.
    #[serde(default)]
    pub queue_mode: Option<String>,
    /// `websockets` — legacy setting migrated to `transport`.
    #[serde(default)]
    pub websockets: Option<bool>,

    /// port extension: rpi's own release-note baseline. pi keeps its baseline
    /// in `lastChangelogVersion`; rpi needs its own so an imported pi value
    /// does not suppress rpi's release notes.
    #[serde(default)]
    pub last_rpi_changelog_version: Option<String>,

    /// Keybinding overrides. pi keeps these in `<agent-dir>/keybindings.json`;
    /// rpi reads that file, and still reads a legacy `keybindings` object in
    /// `settings.json`. Never written back to `settings.json`.
    #[serde(default, skip_serializing)]
    pub keybindings: Option<HashMap<String, serde_json::Value>>,

    /// Legacy rpi spelling of `terminal.showImages`. Read only; the canonical
    /// `terminal.showImages` is written instead.
    #[serde(default, skip_serializing)]
    pub show_images: Option<bool>,
    /// Legacy rpi spelling of `terminal.showTerminalProgress`. Read only; the
    /// canonical `terminal.showTerminalProgress` is written instead.
    #[serde(default, skip_serializing)]
    pub show_terminal_progress: Option<bool>,
}

/// Read pi's `quietStartup`, which is `true`, `false` or `"header"`. The
/// stored form is the string pi uses, so the settings row can offer all
/// three values.
fn deserialize_quiet_startup<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(serde::Deserialize)]
    #[serde(untagged)]
    enum QuietStartupValue {
        Flag(bool),
        Mode(String),
    }

    let value = Option::<QuietStartupValue>::deserialize(deserializer)?;
    Ok(match value {
        Some(QuietStartupValue::Flag(flag)) => Some(if flag { "true" } else { "false" }.to_string()),
        Some(QuietStartupValue::Mode(mode)) if mode == "header" => Some("header".to_string()),
        Some(QuietStartupValue::Mode(mode)) if mode == "true" || mode == "false" => Some(mode),
        Some(QuietStartupValue::Mode(_)) => None,
        None => None,
    })
}

/// Write pi's `quietStartup` in pi's shape: a boolean, or the string
/// `"header"`.
fn serialize_quiet_startup<S>(value: &Option<String>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    match value.as_deref() {
        Some("true") => serializer.serialize_bool(true),
        Some("false") => serializer.serialize_bool(false),
        Some(other) => serializer.serialize_str(other),
        None => serializer.serialize_none(),
    }
}

/// Read pi's `skills`, which is a list of paths or the deprecated
/// `{ customDirectories }` object.
fn deserialize_skills<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(serde::Deserialize)]
    #[serde(untagged, rename_all = "camelCase")]
    enum SkillsInput {
        Paths(Vec<String>),
        #[serde(rename_all = "camelCase")]
        Object {
            custom_directories: Option<Vec<String>>,
        },
    }

    let value = Option::<SkillsInput>::deserialize(deserializer)?;
    Ok(match value {
        Some(SkillsInput::Paths(paths)) => Some(paths),
        Some(SkillsInput::Object {
            custom_directories: Some(directories),
        }) => Some(directories),
        Some(SkillsInput::Object {
            custom_directories: None,
        }) => None,
        None => None,
    })
}

impl Settings {
    /// Resolved HTTP idle timeout in milliseconds (`None` ⇒ library default,
    /// `Some(0)` ⇒ disabled). See [`rpi_ai::http::parse_http_idle_timeout_ms`].
    pub fn http_idle_timeout_ms(&self) -> Option<i64> {
        self.http_idle_timeout
            .as_ref()
            .and_then(rpi_ai::http::parse_http_idle_timeout_ms)
    }

    /// Retry policy, resolved onto the harness type. Absent fields keep pi's
    /// defaults, so a partial `retry` object changes only what it names.
    pub fn retry_policy(&self) -> rpi_harness::types::RetryPolicy {
        let mut policy = rpi_harness::types::RetryPolicy {
            enabled: defaults::RETRY_ENABLED,
            max_retries: defaults::RETRY_MAX_RETRIES,
            base_delay_ms: defaults::RETRY_BASE_DELAY_MS,
            max_agent_delay_ms: defaults::RETRY_MAX_AGENT_DELAY_MS,
        };
        let Some(retry) = &self.retry else {
            return policy;
        };
        if let Some(enabled) = retry.enabled {
            policy.enabled = enabled;
        }
        if let Some(max_retries) = retry.max_retries {
            policy.max_retries = max_retries;
        }
        if let Some(base_delay_ms) = retry.base_delay_ms {
            policy.base_delay_ms = base_delay_ms;
        }
        if let Some(max_agent_delay_ms) = retry.max_agent_delay_ms {
            policy.max_agent_delay_ms = max_agent_delay_ms;
        }
        policy
    }

    /// The provider-level retry options (`retry.provider`), resolved onto the
    /// harness stream options. Mirrors TS `ProviderRetrySettings`
    /// (`packages/coding-agent/src/core/settings-schema.ts:44-53`): the
    /// provider SDK's own retry budget, delay cap and request timeout. Absent
    /// fields keep the library defaults, so a partial `retry.provider` object
    /// changes only what it names.
    pub fn provider_retry_options(&self) -> rpi_harness::types::AgentHarnessStreamOptions {
        let mut options = rpi_harness::types::AgentHarnessStreamOptions::default();
        let Some(retry) = &self.retry else {
            options.max_retry_delay = Some(std::time::Duration::from_millis(
                defaults::RETRY_PROVIDER_MAX_RETRY_DELAY_MS,
            ));
            return options;
        };
        let provider = retry.provider.as_ref();
        if let Some(timeout_ms) = provider.and_then(|provider| provider.timeout_ms) {
            options.timeout = Some(std::time::Duration::from_millis(timeout_ms as u64));
        }
        if let Some(max_retries) = provider.and_then(|provider| provider.max_retries) {
            options.max_retries = Some(max_retries as u32);
        }
        // Upstream's legacy `retry.maxDelayMs` seeds
        // `retry.provider.maxRetryDelayMs` (`core/settings-manager.ts:445`).
        let max_retry_delay = provider
            .and_then(|provider| provider.max_retry_delay_ms)
            .or(retry.max_delay_ms)
            .unwrap_or(defaults::RETRY_PROVIDER_MAX_RETRY_DELAY_MS);
        options.max_retry_delay = Some(std::time::Duration::from_millis(max_retry_delay));
        options
    }

    /// Compaction settings, resolved onto the harness type.
    pub fn compaction_settings(&self) -> rpi_harness::types::CompactionSettings {
        let mut settings = rpi_harness::types::CompactionSettings {
            enabled: defaults::COMPACTION_ENABLED,
            reserve_tokens: defaults::COMPACTION_RESERVE_TOKENS,
            keep_recent_tokens: defaults::COMPACTION_KEEP_RECENT_TOKENS,
        };
        let Some(compaction) = &self.compaction else {
            return settings;
        };
        if let Some(enabled) = compaction.enabled {
            settings.enabled = enabled;
        }
        if let Some(reserve_tokens) = compaction.reserve_tokens {
            settings.reserve_tokens = reserve_tokens;
        }
        if let Some(keep_recent_tokens) = compaction.keep_recent_tokens {
            settings.keep_recent_tokens = keep_recent_tokens;
        }
        settings
    }

    /// The per-model compaction overrides, keyed by `provider/modelId`.
    /// upstream's `compaction.modelOverrides`.
    pub fn compaction_model_overrides(
        &self,
    ) -> std::collections::HashMap<String, rpi_harness::types::CompactionSettings> {
        let mut map = std::collections::HashMap::new();
        let Some(overrides) = self
            .compaction
            .as_ref()
            .and_then(|compaction| compaction.model_overrides.as_ref())
        else {
            return map;
        };
        for (key, entry) in overrides {
            let mut settings = self.compaction_settings();
            if let Some(reserve_tokens) = entry.reserve_tokens {
                settings.reserve_tokens = reserve_tokens;
            }
            if let Some(keep_recent_tokens) = entry.keep_recent_tokens {
                settings.keep_recent_tokens = keep_recent_tokens;
            }
            map.insert(key.clone(), settings);
        }
        map
    }

    /// Tokens reserved for a branch summary's prompt + output.
    ///
    /// Not consumed yet: `AgentLane::navigate_tree` ignores `summarize`, so no
    /// branch summary is ever generated from this path. Wiring it means
    /// implementing navigation-with-summary in the harness, not reading a key.
    pub fn branch_summary_reserve_tokens(&self) -> Option<i64> {
        self.branch_summary.as_ref().and_then(|s| s.reserve_tokens)
    }

    /// Whether branch summaries are suppressed (upstream's `skipPrompt`).
    ///
    /// Not consumed yet, for the same reason as
    /// [`Self::branch_summary_reserve_tokens`].
    pub fn branch_summary_skipped(&self) -> bool {
        self.branch_summary
            .as_ref()
            .and_then(|s| s.skip_prompt)
            .unwrap_or(defaults::BRANCH_SUMMARY_SKIP_PROMPT)
    }

    /// Default steering-queue drain mode (upstream default: one-at-a-time).
    ///
    /// Upstream's `queueMode` is the legacy spelling: it seeds `steeringMode`
    /// when the modern key is absent (`core/settings-manager.ts:398`).
    pub fn steering_mode(&self) -> rpi_agent::QueueMode {
        let mode = self.steering_mode.or_else(|| {
            self.queue_mode.as_deref().and_then(|mode| match mode {
                "all" => Some(QueueModeSetting::All),
                "one-at-a-time" => Some(QueueModeSetting::OneAtATime),
                _ => None,
            })
        });
        mode.map(Into::into).unwrap_or(rpi_agent::QueueMode::OneAtATime)
    }

    /// The provider transport. Upstream's `websockets` is the legacy spelling:
    /// it seeds `transport` when the modern key is absent
    /// (`core/settings-manager.ts:404`).
    pub fn transport(&self) -> String {
        self.transport
            .clone()
            .filter(|transport| {
                matches!(
                    transport.as_str(),
                    "auto" | "sse" | "websocket" | "websocket-cached"
                )
            })
            .or_else(|| {
                self.websockets.map(|enabled| {
                    if enabled {
                        "websocket".to_string()
                    } else {
                        "sse".to_string()
                    }
                })
            })
            .unwrap_or_else(|| defaults::TRANSPORT.to_string())
    }

    /// Default follow-up-queue drain mode (upstream default: one-at-a-time).
    pub fn follow_up_mode(&self) -> rpi_agent::QueueMode {
        self.follow_up_mode
            .map(Into::into)
            .unwrap_or(rpi_agent::QueueMode::OneAtATime)
    }

    /// Render images inline. The legacy flat `showImages` wins; upstream's
    /// `terminal.showImages` is the fallback, then pi's default.
    pub fn show_images(&self) -> Option<bool> {
        self.show_images
            .or_else(|| self.terminal.as_ref().and_then(|t| t.show_images))
            .or(Some(defaults::TERMINAL_SHOW_IMAGES))
    }

    /// Terminal progress indicator. The legacy flat `showTerminalProgress`
    /// wins; upstream's `terminal.showTerminalProgress` is the fallback, then
    /// pi's default.
    pub fn show_terminal_progress(&self) -> Option<bool> {
        self.show_terminal_progress
            .or_else(|| {
                self.terminal
                    .as_ref()
                    .and_then(|t| t.show_terminal_progress)
            })
            .or(Some(defaults::TERMINAL_SHOW_TERMINAL_PROGRESS))
    }

    /// Whether the empty-session screen is shown while the session has no
    /// messages. upstream's `getThreeDEmptySession`, default `false`.
    pub fn three_d_empty_session(&self) -> Option<bool> {
        self.three_d_empty_session
    }

    /// The transcript's horizontal padding. upstream's `getOutputPad`: only an
    /// explicit `0` turns the padding off.
    pub fn output_pad(&self) -> usize {
        match self.output_pad {
            Some(0) => 0,
            _ => defaults::OUTPUT_PAD as usize,
        }
    }

    /// Whether the terminal's own cursor is used. upstream's
    /// `getShowHardwareCursor`, with the same `PI_HARDWARE_CURSOR` fallback.
    pub fn show_hardware_cursor(&self) -> bool {
        self.show_hardware_cursor
            .unwrap_or_else(|| std::env::var("PI_HARDWARE_CURSOR").as_deref() == Ok("1"))
    }

    /// The fullscreen transcript's scrollbar mode. upstream's
    /// `getFullscreenScrollbar`: `auto`, `always` or `hidden`.
    pub fn fullscreen_scrollbar(&self) -> &'static str {
        match self.fullscreen_scrollbar.as_deref() {
            Some("always") => "always",
            Some("hidden") => "hidden",
            _ => defaults::FULLSCREEN_SCROLLBAR,
        }
    }

    /// Where the completion list is painted. upstream's
    /// `getAutocompletePosition`: `above` or `below`.
    pub fn autocomplete_position(&self) -> &'static str {
        match self.autocomplete_position.as_deref() {
            Some("below") => "below",
            _ => defaults::AUTOCOMPLETE_POSITION,
        }
    }

    /// The filter `/tree` opens with. upstream's `getTreeFilterMode`.
    pub fn tree_filter_mode(&self) -> &'static str {
        match self.tree_filter_mode.as_deref() {
            Some("no-tools") => "no-tools",
            Some("user-only") => "user-only",
            Some("labeled-only") => "labeled-only",
            Some("all") => "all",
            _ => defaults::TREE_FILTER_MODE,
        }
    }

    /// The command that opens the external editor. upstream's
    /// `getExternalEditorCommand`: the setting, then `$VISUAL`, then
    /// `$EDITOR`, then the platform default.
    pub fn external_editor_command(&self) -> String {
        if let Some(command) = self
            .external_editor
            .as_deref()
            .map(str::trim)
            .filter(|command| !command.is_empty())
        {
            return command.to_string();
        }
        std::env::var("RPI_EXTERNAL_EDITOR")
            .ok()
            .filter(|command| !command.trim().is_empty())
            .or_else(|| std::env::var("VISUAL").ok().filter(|v| !v.trim().is_empty()))
            .or_else(|| std::env::var("EDITOR").ok().filter(|v| !v.trim().is_empty()))
            .unwrap_or_else(|| {
                if cfg!(windows) {
                    "notepad".to_string()
                } else {
                    "nano".to_string()
                }
            })
    }

    /// The per-level thinking budgets. upstream's `getThinkingBudgets`.
    pub fn thinking_budgets(&self) -> Option<rpi_ai::types::ThinkingBudgets> {
        let budgets = self.thinking_budgets.as_ref()?;
        Some(rpi_ai::types::ThinkingBudgets {
            minimal: budgets.minimal.map(|value| value.max(0.0) as u64),
            low: budgets.low.map(|value| value.max(0.0) as u64),
            medium: budgets.medium.map(|value| value.max(0.0) as u64),
            high: budgets.high.map(|value| value.max(0.0) as u64),
        })
    }

    /// The cap on the project context in the system prompt. upstream's
    /// `getProjectContextMaxChars`; `0` keeps the whole context.
    pub fn project_context_max_chars(&self) -> u64 {
        self.project_context_max_chars
            .unwrap_or(defaults::PROJECT_CONTEXT_MAX_CHARS)
    }

    /// The compaction token settings for one model. upstream's
    /// `getCompactionSettings`: the per-model override wins over the plain
    /// `compaction.*` values, which win over the defaults.
    pub fn compaction_settings_for(&self, model_key: Option<&str>) -> rpi_harness::types::CompactionSettings {
        let mut settings = self.compaction_settings();
        let Some(overrides) = self
            .compaction
            .as_ref()
            .and_then(|compaction| compaction.model_overrides.as_ref())
        else {
            return settings;
        };
        let Some(override_entry) = model_key.and_then(|key| overrides.get(key)) else {
            return settings;
        };
        if let Some(reserve_tokens) = override_entry.reserve_tokens {
            settings.reserve_tokens = reserve_tokens;
        }
        if let Some(keep_recent_tokens) = override_entry.keep_recent_tokens {
            settings.keep_recent_tokens = keep_recent_tokens;
        }
        settings
    }

    /// The shell the bash tool runs. upstream's `getShellPath`.
    pub fn shell_path(&self) -> Option<String> {
        self.shell_path.clone().filter(|path| !path.is_empty())
    }

    /// The argv used for every npm invocation. upstream's `getNpmCommand`.
    pub fn npm_command(&self) -> Option<Vec<String>> {
        self.npm_command
            .clone()
            .filter(|command| !command.is_empty() && command[0].trim() != "")
    }

    /// The installed device id. upstream's `getOrCreateDeviceId`.
    pub fn device_id(&self) -> Option<String> {
        self.device_id.clone().filter(|id| !id.is_empty())
    }

    /// The indent every rendered code-block line gets. upstream's
    /// `getCodeBlockIndent`.
    pub fn code_block_indent(&self) -> String {
        self.markdown
            .as_ref()
            .and_then(|markdown| markdown.code_block_indent.clone())
            .unwrap_or_else(|| defaults::MARKDOWN_CODE_BLOCK_INDENT.to_string())
    }

    /// What the fullscreen mode prints when it exits. upstream's
    /// `getFullscreenExitOutput`: `transcript` or `resume-hint`.
    pub fn fullscreen_exit_output(&self) -> &'static str {
        match self.fullscreen_exit_output.as_deref() {
            Some("transcript") => "transcript",
            _ => defaults::FULLSCREEN_EXIT_OUTPUT,
        }
    }

    /// The lines a mouse-wheel event scrolls. upstream's
    /// `getFullscreenWheelScrollLines`: `None` means `auto`.
    pub fn fullscreen_wheel_scroll_lines(&self) -> Option<u32> {
        match self.fullscreen_wheel_scroll_lines.as_ref() {
            Some(serde_json::Value::Number(lines)) => {
                let lines = lines.as_f64().unwrap_or_default().floor();
                Some(lines.clamp(1.0, 100.0) as u32)
            }
            _ => None,
        }
    }

    /// The thinking level override for one model. upstream's
    /// `getModelThinkingLevel`, keyed by `provider/modelId`.
    pub fn model_thinking_level(&self, provider: &str, model_id: &str) -> Option<String> {
        self.model_thinking_levels
            .as_ref()?
            .get(&format!("{provider}/{model_id}"))
            .cloned()
    }

    /// The terminal capability overrides. upstream's
    /// `getTerminalCapabilityOverrides`: only the boolean arms of
    /// `terminal.trueColor` / `terminal.hyperlinks` and the named image
    /// protocols override the detection.
    pub fn terminal_capability_overrides(&self) -> TerminalCapabilityOverrides {
        let terminal = self.terminal.as_ref();
        let images = match terminal.and_then(|t| t.images.as_ref()) {
            Some(serde_json::Value::String(protocol)) => match protocol.as_str() {
                "kitty" => Some(rpi_tui::ImageProtocol::Kitty),
                "iterm2" => Some(rpi_tui::ImageProtocol::ITerm2),
                _ => None,
            },
            Some(serde_json::Value::Bool(false)) => Some(rpi_tui::ImageProtocol::None),
            _ => None,
        };
        let boolean = |value: Option<&serde_json::Value>| -> Option<bool> {
            match value {
                Some(serde_json::Value::Bool(flag)) => Some(*flag),
                _ => None,
            }
        };
        TerminalCapabilityOverrides {
            images,
            true_color: boolean(terminal.and_then(|t| t.true_color.as_ref())),
            hyperlinks: boolean(terminal.and_then(|t| t.hyperlinks.as_ref())),
        }
    }

    /// The effective value of every setting that has a default: the file's
    /// value when it names one, pi's default otherwise. The shape matches
    /// upstream's `SETTINGS_DEFAULTS`.
    pub fn effective(&self) -> serde_json::Value {
        let mut map = serde_json::Map::new();
        map.insert(
            "transport".to_string(),
            serde_json::json!(self
                .transport
                .clone()
                .unwrap_or_else(|| defaults::TRANSPORT.to_string())),
        );
        map.insert(
            "sessionShareDestination".to_string(),
            serde_json::json!(match self.session_share_destination.as_deref() {
                Some("gist") => "gist".to_string(),
                Some("radius") => "radius".to_string(),
                _ => defaults::SESSION_SHARE_DESTINATION.to_string(),
            }),
        );
        map.insert(
            "steeringMode".to_string(),
            serde_json::json!(self
                .steering_mode
                .map(|mode| mode.as_str())
                .unwrap_or(defaults::STEERING_MODE)),
        );
        map.insert(
            "followUpMode".to_string(),
            serde_json::json!(self
                .follow_up_mode
                .map(|mode| mode.as_str())
                .unwrap_or(defaults::FOLLOW_UP_MODE)),
        );
        map.insert(
            "compaction".to_string(),
            serde_json::json!({
                "enabled": self
                    .compaction
                    .as_ref()
                    .and_then(|c| c.enabled)
                    .unwrap_or(defaults::COMPACTION_ENABLED),
                "reserveTokens": self
                    .compaction
                    .as_ref()
                    .and_then(|c| c.reserve_tokens)
                    .unwrap_or(defaults::COMPACTION_RESERVE_TOKENS),
                "keepRecentTokens": self
                    .compaction
                    .as_ref()
                    .and_then(|c| c.keep_recent_tokens)
                    .unwrap_or(defaults::COMPACTION_KEEP_RECENT_TOKENS),
            }),
        );
        map.insert(
            "branchSummary".to_string(),
            serde_json::json!({
                "reserveTokens": self
                    .branch_summary
                    .as_ref()
                    .and_then(|b| b.reserve_tokens)
                    .unwrap_or(defaults::BRANCH_SUMMARY_RESERVE_TOKENS),
                "skipPrompt": self
                    .branch_summary
                    .as_ref()
                    .and_then(|b| b.skip_prompt)
                    .unwrap_or(defaults::BRANCH_SUMMARY_SKIP_PROMPT),
            }),
        );
        map.insert(
            "retry".to_string(),
            serde_json::json!({
                "enabled": self
                    .retry
                    .as_ref()
                    .and_then(|r| r.enabled)
                    .unwrap_or(defaults::RETRY_ENABLED),
                "maxRetries": self
                    .retry
                    .as_ref()
                    .and_then(|r| r.max_retries)
                    .unwrap_or(defaults::RETRY_MAX_RETRIES),
                "baseDelayMs": self
                    .retry
                    .as_ref()
                    .and_then(|r| r.base_delay_ms)
                    .unwrap_or(defaults::RETRY_BASE_DELAY_MS),
                "maxAgentDelayMs": self
                    .retry
                    .as_ref()
                    .and_then(|r| r.max_agent_delay_ms)
                    .unwrap_or(defaults::RETRY_MAX_AGENT_DELAY_MS),
                "provider": {
                    "maxRetryDelayMs": self
                        .retry
                        .as_ref()
                        .and_then(|r| r.provider.as_ref())
                        .and_then(|p| p.max_retry_delay_ms)
                        .unwrap_or(defaults::RETRY_PROVIDER_MAX_RETRY_DELAY_MS),
                },
            }),
        );
        map.insert(
            "hideThinkingBlock".to_string(),
            serde_json::json!(self
                .hide_thinking_block
                .unwrap_or(defaults::HIDE_THINKING_BLOCK)),
        );
        map.insert(
            "projectContextMaxChars".to_string(),
            serde_json::json!(self
                .project_context_max_chars
                .unwrap_or(defaults::PROJECT_CONTEXT_MAX_CHARS)),
        );
        map.insert(
            "showCacheMissNotices".to_string(),
            serde_json::json!(self
                .show_cache_miss_notices
                .unwrap_or(defaults::SHOW_CACHE_MISS_NOTICES)),
        );
        map.insert(
            "quietStartup".to_string(),
            match self.quiet_startup.as_deref() {
                Some("true") => serde_json::json!(true),
                Some("header") => serde_json::json!("header"),
                _ => serde_json::json!(defaults::QUIET_STARTUP),
            },
        );
        map.insert(
            "defaultProjectTrust".to_string(),
            serde_json::json!(match self.default_project_trust.as_deref() {
                Some("always") => "always".to_string(),
                Some("never") => "never".to_string(),
                _ => defaults::DEFAULT_PROJECT_TRUST.to_string(),
            }),
        );
        map.insert(
            "collapseChangelog".to_string(),
            serde_json::json!(self
                .collapse_changelog
                .unwrap_or(defaults::COLLAPSE_CHANGELOG)),
        );
        map.insert(
            "enableSkillCommands".to_string(),
            serde_json::json!(self
                .enable_skill_commands
                .unwrap_or(defaults::ENABLE_SKILL_COMMANDS)),
        );
        map.insert(
            "terminal".to_string(),
            serde_json::json!({
                "showImages": self.show_images(),
                "imageWidthCells": self
                    .terminal
                    .as_ref()
                    .and_then(|t| t.image_width_cells)
                    .unwrap_or(defaults::TERMINAL_IMAGE_WIDTH_CELLS),
                "clearOnShrink": self
                    .terminal
                    .as_ref()
                    .and_then(|t| t.clear_on_shrink)
                    .unwrap_or(defaults::TERMINAL_CLEAR_ON_SHRINK),
                "showTerminalProgress": self.show_terminal_progress(),
            }),
        );
        map.insert(
            "images".to_string(),
            serde_json::json!({
                "autoResize": self
                    .images
                    .as_ref()
                    .and_then(|i| i.auto_resize)
                    .unwrap_or(defaults::IMAGES_AUTO_RESIZE),
                "blockImages": self
                    .images
                    .as_ref()
                    .and_then(|i| i.block_images)
                    .unwrap_or(defaults::IMAGES_BLOCK_IMAGES),
            }),
        );
        map.insert(
            "doubleEscapeAction".to_string(),
            serde_json::json!(self.double_escape_action.clone().unwrap_or_else(
                || defaults::DOUBLE_ESCAPE_ACTION.to_string()
            )),
        );
        map.insert(
            "treeFilterMode".to_string(),
            serde_json::json!(match self.tree_filter_mode.as_deref() {
                Some(mode @ ("default" | "no-tools" | "user-only" | "labeled-only" | "all")) => {
                    mode.to_string()
                }
                _ => defaults::TREE_FILTER_MODE.to_string(),
            }),
        );
        map.insert(
            "editorPaddingX".to_string(),
            serde_json::json!(self
                .editor_padding_x
                .unwrap_or(defaults::EDITOR_PADDING_X as usize)),
        );
        map.insert(
            "outputPad".to_string(),
            serde_json::json!(match self.output_pad {
                Some(0) => 0,
                _ => defaults::OUTPUT_PAD as usize,
            }),
        );
        map.insert(
            "nerdFonts".to_string(),
            serde_json::json!(self.nerd_fonts.unwrap_or(defaults::NERD_FONTS)),
        );
        map.insert(
            "threeDEmptySession".to_string(),
            serde_json::json!(self
                .three_d_empty_session
                .unwrap_or(defaults::THREE_D_EMPTY_SESSION)),
        );
        map.insert(
            "autocompleteMaxVisible".to_string(),
            serde_json::json!(self
                .autocomplete_max_visible
                .unwrap_or(defaults::AUTOCOMPLETE_MAX_VISIBLE as usize)),
        );
        map.insert(
            "autocompletePosition".to_string(),
            serde_json::json!(match self.autocomplete_position.as_deref() {
                Some("below") => "below".to_string(),
                _ => defaults::AUTOCOMPLETE_POSITION.to_string(),
            }),
        );
        map.insert(
            "markdown".to_string(),
            serde_json::json!({
                "codeBlockIndent": self
                    .markdown
                    .as_ref()
                    .and_then(|m| m.code_block_indent.clone())
                    .unwrap_or_else(|| defaults::MARKDOWN_CODE_BLOCK_INDENT.to_string()),
                "mermaid": match self.markdown.as_ref().and_then(|m| m.mermaid.as_deref()) {
                    Some("off") => "off".to_string(),
                    Some("final") => "final".to_string(),
                    _ => defaults::MARKDOWN_MERMAID.to_string(),
                },
            }),
        );
        map.insert(
            "warnings".to_string(),
            serde_json::json!({
                "anthropicExtraUsage": self
                    .warnings
                    .as_ref()
                    .and_then(|w| w.anthropic_extra_usage)
                    .unwrap_or(defaults::WARNINGS_ANTHROPIC_EXTRA_USAGE),
            }),
        );
        map.insert(
            "codemode".to_string(),
            serde_json::json!({
                "mode": self
                    .codemode
                    .as_ref()
                    .and_then(|c| c.mode.clone())
                    .unwrap_or_else(|| defaults::CODEMODE_MODE.to_string()),
                "inlineBudget": self
                    .codemode
                    .as_ref()
                    .and_then(|c| c.inline_budget)
                    .unwrap_or(defaults::CODEMODE_INLINE_BUDGET),
            }),
        );
        map.insert(
            "cacheWarming".to_string(),
            serde_json::json!(match self.cache_warming.as_deref() {
                Some(mode @ ("off" | "streaming" | "idle")) => mode.to_string(),
                _ => defaults::CACHE_WARMING.to_string(),
            }),
        );
        map.insert(
            "tuiMode".to_string(),
            serde_json::json!(match self.tui_mode.as_deref() {
                Some("regular") => "regular".to_string(),
                _ => defaults::TUI_MODE.to_string(),
            }),
        );
        map.insert(
            "fullscreenExitOutput".to_string(),
            serde_json::json!(match self.fullscreen_exit_output.as_deref() {
                Some("transcript") => "transcript".to_string(),
                _ => defaults::FULLSCREEN_EXIT_OUTPUT.to_string(),
            }),
        );
        map.insert(
            "fullscreenScrollbar".to_string(),
            serde_json::json!(match self.fullscreen_scrollbar.as_deref() {
                Some("always") => "always".to_string(),
                Some("hidden") => "hidden".to_string(),
                _ => defaults::FULLSCREEN_SCROLLBAR.to_string(),
            }),
        );
        map.insert(
            "fullscreenCopyOnSelect".to_string(),
            serde_json::json!(self
                .fullscreen_copy_on_select
                .unwrap_or(defaults::FULLSCREEN_COPY_ON_SELECT)),
        );
        map.insert(
            "fullscreenWheelScrollLines".to_string(),
            match self.fullscreen_wheel_scroll_lines.as_ref() {
                Some(serde_json::Value::Number(lines)) => {
                    let lines = lines.as_f64().unwrap_or_default().floor();
                    serde_json::json!(lines.clamp(1.0, 100.0) as u32)
                }
                _ => serde_json::json!(defaults::FULLSCREEN_WHEEL_SCROLL_LINES),
            },
        );
        serde_json::Value::Object(map)
    }
}

/// Load `<agent-dir>/settings.json`. Missing file ⇒ `Settings::default()`
/// (not an error). Malformed JSON ⇒ `ConfigError::Json`. Tolerates `//` line
/// comments (a copied pi settings.json may contain them).
pub fn load_settings() -> Result<Settings, ConfigError> {
    let path = config::settings_path()?;
    let mut settings = match std::fs::read_to_string(&path) {
        Ok(text) => parse_settings(&text).map_err(|e| ConfigError::Json {
            path: path.clone(),
            source: e,
        })?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Settings::default(),
        Err(e) => return Err(ConfigError::Read { path, source: e }),
    };
    apply_keybindings_file(&mut settings);
    Ok(settings)
}

/// pi keeps keybindings in `<agent-dir>/keybindings.json`; rpi reads the same
/// file. A legacy `keybindings` object inside `settings.json` is used only when
/// that file is absent.
fn apply_keybindings_file(settings: &mut Settings) {
    let Ok(agent_dir) = config::agent_dir() else {
        return;
    };
    let path = agent_dir.join("keybindings.json");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return;
    };
    let parsed = match serde_json::from_str::<HashMap<String, serde_json::Value>>(&text) {
        Ok(parsed) => parsed,
        Err(_) => return,
    };
    settings.keybindings = Some(parsed);
}

/// The project settings file, in pi's project config directory
/// (`packages/coding-agent/src/core/settings-manager.ts:194`).
pub const PROJECT_SETTINGS_PATH: &str = ".pi/settings.json";
/// The port's own project settings directory, read when pi's is absent.
pub const LEGACY_PROJECT_SETTINGS_PATH: &str = ".rpi/settings.json";

/// Load the single active project settings document. pi's
/// `.pi/settings.json` is the project settings file; the port's older
/// `.rpi/settings.json` is read when pi's is absent.
pub fn load_project_settings(cwd: &Path) -> Vec<Settings> {
    load_project_settings_with_paths(cwd)
        .into_iter()
        .map(|(_, settings)| settings)
        .collect()
}

/// Load the active project settings together with its source path.
pub fn load_project_settings_with_paths(cwd: &Path) -> Vec<(PathBuf, Settings)> {
    load_active_project_settings(cwd)
        .ok()
        .flatten()
        .into_iter()
        .collect()
}

/// Load the active project settings while preserving parse/read failures for
/// callers that must fail closed, such as package install/update preflight.
pub fn load_active_project_settings(
    cwd: &Path) -> Result<Option<(PathBuf, Settings)>, ConfigError> {
    for relative in [PROJECT_SETTINGS_PATH, LEGACY_PROJECT_SETTINGS_PATH] {
        let path = cwd.join(relative);
        match load_settings_file(&path) {
            Ok(settings) => return Ok(Some((path, settings))),
            Err(ConfigError::Read { source, .. })
                if source.kind() == std::io::ErrorKind::NotFound =>
            {
                continue
            }
            Err(error) => return Err(error),
        }
    }
    Ok(None)
}

/// Load model-selection settings with upstream's global -> trusted-project
/// precedence. Only fields consumed during provider resolution are overlaid;
/// package and resource loading keeps its own scope-aware merge semantics.
pub fn load_effective_model_settings(
    cwd: &Path,
    project_trusted: bool,
) -> Result<Settings, ConfigError> {
    let mut effective = load_settings()?;
    if project_trusted {
        if let Some((_, project)) = load_active_project_settings(cwd)? {
            if project.default_provider.is_some() {
                effective.default_provider = project.default_provider;
            }
            if project.default_model.is_some() {
                effective.default_model = project.default_model;
            }
            if project.default_thinking_level.is_some() {
                effective.default_thinking_level = project.default_thinking_level;
            }
            if project.theme.is_some() {
                effective.theme = project.theme;
            }
        }
    }
    Ok(effective)
}

/// Load the project settings document that rpi may safely update.
pub fn load_project_settings_for_write(cwd: &Path) -> Result<Settings, ConfigError> {
    Ok(load_active_project_settings(cwd)?
        .map(|(_, settings)| settings)
        .unwrap_or_default())
}

fn load_settings_file(path: &Path) -> Result<Settings, ConfigError> {
    let text = std::fs::read_to_string(path).map_err(|source| ConfigError::Read {
        path: path.to_path_buf(),
        source,
    })?;
    parse_settings(&text).map_err(|source| ConfigError::Json {
        path: path.to_path_buf(),
        source,
    })
}

/// Resolve a configured path relative to its settings owner. Absolute paths
/// are preserved; empty entries are ignored.
pub fn resolve_configured_paths(base: &Path, values: &[String]) -> Vec<PathBuf> {
    values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| {
            let path = PathBuf::from(value);
            if path.is_absolute() {
                path
            } else {
                base.join(path)
            }
        })
        .collect()
}

fn parse_settings(text: &str) -> Result<Settings, serde_json::Error> {
    match serde_json::from_str(text) {
        Ok(s) => Ok(s),
        Err(first) => {
            let stripped = strip_line_comments(text);
            serde_json::from_str(&stripped).map_err(|_| first)
        }
    }
}

/// Parse an existing settings document while retaining fields that rpi does
/// not model. upstream permits `//` line comments in `settings.json`, so use
/// the same strict-then-comment-stripped strategy as [`parse_settings`].
/// Keeping this separate from `parse_settings` is important: deserializing
/// into [`Settings`] would discard unknown fields before a save/merge.
fn parse_settings_value(text: &str) -> Result<serde_json::Value, serde_json::Error> {
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(value) => Ok(value),
        Err(first) => {
            let stripped = strip_line_comments(text);
            serde_json::from_str::<serde_json::Value>(&stripped).map_err(|_| first)
        }
    }
}

/// Persist the honored settings back to `<agent-dir>/settings.json`.
/// Unknown pi fields (which `Settings` doesn't model) are **preserved**: the
/// current file is read as raw JSON, the known fields are overlaid, and the
/// merged object is written — so a copied pi `settings.json` survives edits
/// without losing pi-only keys. `//` comments are accepted using the same
/// parser as [`load_settings`]. Missing file ⇒ a fresh object. Existing files
/// that cannot be parsed safely are left untouched and reported as errors.
pub fn save_settings(settings: &Settings) -> Result<(), String> {
    let path = config::settings_path().map_err(|e| e.to_string())?;
    save_settings_to_path(settings, &path, None)
}

/// Persist project-scoped settings under pi's `.pi/settings.json`.
pub fn save_project_settings(cwd: &Path, settings: &Settings) -> Result<(), String> {
    save_settings_to_path(settings, &cwd.join(PROJECT_SETTINGS_PATH), None)
}

fn save_settings_to_path(
    settings: &Settings,
    path: &Path,
    fallback: Option<&Path>,
) -> Result<(), String> {
    // Read the existing file as a raw object to preserve unknown fields.
    let mut merged = match std::fs::read_to_string(path) {
        Ok(text) => parse_settings_value(&text).map_err(|error| {
            format!(
                "cannot parse existing settings file {}: {error}",
                path.display()
            )
        })?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            read_fallback_settings_value(path, fallback)?
                .unwrap_or_else(|| serde_json::Value::Object(Default::default()))
        }
        Err(error) => {
            return Err(format!(
                "cannot read existing settings file {}: {error}",
                path.display()
            ));
        }
    };
    let obj = merged
        .as_object_mut()
        .ok_or_else(|| format!("settings file {} is not an object", path.display()))?;

    // The struct's serde attributes are the only place the key names live, so
    // the file written here is read back by the same names.
    let modeled = serde_json::to_value(settings).map_err(|error| error.to_string())?;
    let pruned = prune_nulls(&modeled);
    let modeled = modeled.as_object().cloned().unwrap_or_default();
    let pruned = pruned.as_object().cloned().unwrap_or_default();
    for (key, value) in &modeled {
        if value.is_null() {
            obj.remove(key);
        } else if let Some(value) = pruned.get(key) {
            obj.insert(key.clone(), value.clone());
        }
    }

    // Legacy rpi spellings are replaced by pi's key.
    for legacy in [
        "scopedModels",
        "httpIdleTimeout",
        "skillDirs",
        "promptDirs",
        "extensionDirs",
        "showImages",
        "showTerminalProgress",
    ] {
        obj.remove(legacy);
    }

    // The legacy flat image/progress keys live in pi's `terminal` block.
    let flat_images = settings.show_images;
    let flat_progress = settings.show_terminal_progress;
    if flat_images.is_some() || flat_progress.is_some() {
        let terminal = obj
            .entry("terminal".to_string())
            .or_insert_with(|| serde_json::Value::Object(Default::default()));
        let Some(terminal) = terminal.as_object_mut() else {
            return Err(format!(
                "settings file {} has a non-object `terminal` block",
                path.display()
            ));
        };
        if let Some(value) = flat_images {
            terminal.insert("showImages".to_string(), serde_json::Value::Bool(value));
        }
        if let Some(value) = flat_progress {
            terminal.insert(
                "showTerminalProgress".to_string(),
                serde_json::Value::Bool(value),
            );
        }
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
    config::atomic_write(path, text.as_bytes()).map_err(|e| e.to_string())
}

/// Drop `null` members from a serialized settings object: an unset setting is
/// absent from the file, not present with a null value.
fn prune_nulls(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let mut pruned = serde_json::Map::new();
            for (key, value) in map {
                if value.is_null() {
                    continue;
                }
                pruned.insert(key.clone(), prune_nulls(value));
            }
            serde_json::Value::Object(pruned)
        }
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.iter().map(prune_nulls).collect())
        }
        other => other.clone(),
    }
}

/// When rpi is still reading upstream's settings fallback, seed the first
/// rpi-owned save from that complete raw object. Otherwise a modeled-field
/// save could shadow the native file and silently drop fields added by Pi.
fn read_fallback_settings_value(
    target: &Path,
    fallback: Option<&Path>,
) -> Result<Option<serde_json::Value>, String> {
    let Some(path) = fallback else {
        return Ok(None);
    };
    if path == target {
        return Ok(None);
    }
    match std::fs::read_to_string(&path) {
        Ok(text) => parse_settings_value(&text).map(Some).map_err(|error| {
            format!(
                "cannot parse fallback settings file {}: {error}",
                path.display()
            )
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "cannot read fallback settings file {}: {error}",
            path.display()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::test_support::env_lock;

    /// Point `RPI_CODING_AGENT_DIR` at a fresh temp dir for this test.
    struct TempConfig {
        _guard: std::sync::MutexGuard<'static, ()>,
        _tmp: tempfile::TempDir,
        prev: Option<std::ffi::OsString>,
    }
    impl TempConfig {
        fn new() -> Self {
            let guard = env_lock().lock().unwrap();
            let prev = std::env::var_os(config::CONFIG_DIR_ENV);
            let tmp = tempfile::TempDir::new().unwrap();
            std::env::set_var(config::CONFIG_DIR_ENV, tmp.path());
            Self {
                _guard: guard,
                _tmp: tmp,
                prev,
            }
        }
    }
    impl Drop for TempConfig {
        fn drop(&mut self) {
            match self.prev.take() {
                Some(v) => std::env::set_var(config::CONFIG_DIR_ENV, v),
                None => std::env::remove_var(config::CONFIG_DIR_ENV),
            }
        }
    }

    #[test]
    fn missing_settings_is_default() {
        let _cfg = TempConfig::new();
        let s = load_settings().unwrap();
        assert!(s.default_provider.is_none());
        assert!(s.default_model.is_none());
        assert!(s.default_thinking_level.is_none());
        assert!(s.theme.is_none());
        assert!(s.skill_dirs.is_none());
        assert!(s.prompt_dirs.is_none());
        assert!(s.extension_dirs.is_none());
    }

    #[test]
    fn reads_honored_fields_and_ignores_unknown() {
        let _cfg = TempConfig::new();
        let path = config::settings_path().unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        // A pi-style settings.json with many unknown fields + the 4 we honor.
        std::fs::write(
            &path,
            r#"{
                "lastChangelogVersion": "1.0.0",
                "defaultProvider": "anthropic",
                "defaultModel": "claude-sonnet-5",
                "defaultThinkingLevel": "high",
                "theme": "dark",
                "hideThinkingBlock": true,
                "quietStartup": true,
                "showTerminalProgress": false,
                "editorPaddingX": 3,
                "autocompleteMaxVisible": 7,
                "compaction": { "threshold": 100 }
            }"#,
        )
        .unwrap();
        let s = load_settings().unwrap();
        assert_eq!(s.default_provider.as_deref(), Some("anthropic"));
        assert_eq!(s.default_model.as_deref(), Some("claude-sonnet-5"));
        assert_eq!(s.default_thinking_level.as_deref(), Some("high"));
        assert_eq!(s.theme.as_deref(), Some("dark"));
        assert_eq!(s.hide_thinking_block, Some(true));
        assert_eq!(s.quiet_startup.as_deref(), Some("true"));
        assert_eq!(s.editor_padding_x, Some(3));
        assert_eq!(s.autocomplete_max_visible, Some(7));
    }

    #[test]
    fn project_settings_only_use_rpi() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join(".pi")).unwrap();
        std::fs::write(
            tmp.path().join(".pi/settings.json"),
            r#"{"skills":["rpi-skills"],"extensions":["rpi-ext"]}"#,
        )
        .unwrap();

        let settings = load_project_settings(tmp.path());
        assert_eq!(settings.len(), 1);
        assert_eq!(
            settings[0].skill_dirs.as_deref(),
            Some(["rpi-skills".to_string()].as_slice())
        );
        assert_eq!(
            settings[0].extension_dirs.as_deref(),
            Some(["rpi-ext".to_string()].as_slice())
        );
    }

    #[test]
    fn the_legacy_project_settings_directory_is_still_read() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join(".rpi")).unwrap();
        std::fs::write(
            tmp.path().join(".rpi/settings.json"),
            r#"{"theme":"legacy"}"#,
        )
        .unwrap();

        let settings = load_project_settings(tmp.path());
        assert_eq!(settings.len(), 1);
        assert_eq!(settings[0].theme.as_deref(), Some("legacy"));
    }

    #[test]
    fn malformed_rpi_project_settings_are_not_read() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join(".rpi")).unwrap();
        std::fs::write(tmp.path().join(".rpi/settings.json"), "{ malformed").unwrap();

        assert!(load_project_settings_with_paths(tmp.path()).is_empty());
        assert!(load_active_project_settings(tmp.path()).is_err());
    }

    #[test]
    fn trusted_project_model_defaults_override_global_defaults() {
        let _cfg = TempConfig::new();
        let global = config::settings_path().unwrap();
        std::fs::create_dir_all(global.parent().unwrap()).unwrap();
        std::fs::write(
            &global,
            r#"{"defaultProvider":"global","defaultModel":"global-model","theme":"dark"}"#,
        )
        .unwrap();
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join(".rpi")).unwrap();
        std::fs::write(
            project.path().join(".rpi/settings.json"),
            r#"{"defaultProvider":"project","defaultModel":"project-model"}"#,
        )
        .unwrap();

        let trusted = load_effective_model_settings(project.path(), true).unwrap();
        assert_eq!(trusted.default_provider.as_deref(), Some("project"));
        assert_eq!(trusted.default_model.as_deref(), Some("project-model"));
        assert_eq!(trusted.theme.as_deref(), Some("dark"));

        let untrusted = load_effective_model_settings(project.path(), false).unwrap();
        assert_eq!(untrusted.default_provider.as_deref(), Some("global"));
        assert_eq!(untrusted.default_model.as_deref(), Some("global-model"));
    }

    #[test]
    fn tolerates_line_comments() {
        let _cfg = TempConfig::new();
        let path = config::settings_path().unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            "{\n  // my default\n  \"defaultModel\": \"glm-5\",\n  \"theme\": \"light\"\n}\n",
        )
        .unwrap();
        let s = load_settings().unwrap();
        assert_eq!(s.default_model.as_deref(), Some("glm-5"));
        assert_eq!(s.theme.as_deref(), Some("light"));
    }

    #[test]
    fn malformed_is_error() {
        let _cfg = TempConfig::new();
        let path = config::settings_path().unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{ not json").unwrap();
        assert!(matches!(load_settings(), Err(ConfigError::Json { .. })));
    }
}

#[cfg(test)]
mod scoped_tests {
    use super::*;
    use crate::config::test_support::env_lock;

    fn with_temp_env() -> (tempfile::TempDir, std::sync::MutexGuard<'static, ()>) {
        let guard = env_lock().lock().unwrap();
        let tmp = tempfile::TempDir::new().unwrap();
        std::env::set_var(config::CONFIG_DIR_ENV, tmp.path());
        (tmp, guard)
    }

    /// The settings upstream lets users tune must reach the harness types.
    ///
    /// These were previously hardcoded defaults, so a `settings.json` copied from
    /// upstream parsed cleanly but changed nothing — the exact failure mode a
    /// "parses but is not consumed" field creates.

    /// `sessionDir` selects the session directory, with the CLI flag winning.
    ///
    /// upstream's comment: "same format as --session-dir CLI flag". A settings
    /// key that parses but is ignored is exactly the failure mode this closes.
    #[test]
    fn session_dir_setting_selects_the_session_directory() {
        let settings: Settings =
            serde_json::from_str(r#"{"sessionDir": "/tmp/from-settings"}"#).unwrap();
        assert_eq!(
            settings.session_dir,
            Some(std::path::PathBuf::from("/tmp/from-settings"))
        );
        // Absent ⇒ the caller falls back to its built-in default.
        assert_eq!(Settings::default().session_dir, None);
    }

    /// The bash-facing keys must reach the tool options.
    #[test]
    fn shell_command_prefix_reaches_the_bash_tool() {
        let settings: Settings =
            serde_json::from_str(r#"{"shellCommandPrefix": "shopt -s expand_aliases"}"#).unwrap();
        assert_eq!(
            settings.shell_command_prefix.as_deref(),
            Some("shopt -s expand_aliases")
        );
        // `shellPath` is parsed (native's shape round-trips) but nothing consumes
        // it yet — see its doc comment for why.
        let with_shell: Settings =
            serde_json::from_str(r#"{"shellPath": "/usr/bin/zsh"}"#).unwrap();
        assert_eq!(with_shell.shell_path.as_deref(), Some("/usr/bin/zsh"));
    }

    /// `httpProxy` is stored in native's shape for the client setup to apply.
    #[test]
    fn http_proxy_setting_is_read() {
        let settings: Settings =
            serde_json::from_str(r#"{"httpProxy": "http://127.0.0.1:8888"}"#).unwrap();
        assert_eq!(
            settings.http_proxy.as_deref(),
            Some("http://127.0.0.1:8888")
        );
        assert_eq!(Settings::default().http_proxy, None);
    }
    #[test]
    fn harness_options_come_from_settings() {
        let settings: Settings = serde_json::from_str(
            r#"{
                "retry": { "enabled": false, "maxRetries": 7, "baseDelayMs": 250, "maxAgentDelayMs": 9000 },
                "compaction": { "enabled": false, "reserveTokens": 1234, "keepRecentTokens": 4321 },
                "steeringMode": "all",
                "followUpMode": "all"
            }"#,
        )
        .expect("settings parse");

        let retry = settings.retry_policy();
        assert!(!retry.enabled);
        assert_eq!(retry.max_retries, 7);
        assert_eq!(retry.base_delay_ms, 250);
        assert_eq!(retry.max_agent_delay_ms, 9000);

        let compaction = settings.compaction_settings();
        assert!(!compaction.enabled);
        assert_eq!(compaction.reserve_tokens, 1234);
        assert_eq!(compaction.keep_recent_tokens, 4321);

        assert_eq!(settings.steering_mode(), rpi_agent::QueueMode::All);
        assert_eq!(settings.follow_up_mode(), rpi_agent::QueueMode::All);
    }

    /// An absent key keeps upstream's default rather than a zero value: a
    /// partial `retry` object must change only what it names.
    #[test]
    fn absent_harness_settings_keep_the_harness_defaults() {
        let empty = Settings::default();
        let retry = empty.retry_policy();
        assert_eq!(retry.enabled, defaults::RETRY_ENABLED);
        assert_eq!(retry.max_retries, defaults::RETRY_MAX_RETRIES);
        assert_eq!(retry.base_delay_ms, defaults::RETRY_BASE_DELAY_MS);
        assert_eq!(retry.max_agent_delay_ms, defaults::RETRY_MAX_AGENT_DELAY_MS);
        let default_compaction = rpi_harness::types::CompactionSettings::default();
        let compaction = empty.compaction_settings();
        assert_eq!(compaction.enabled, default_compaction.enabled);
        assert_eq!(compaction.reserve_tokens, default_compaction.reserve_tokens);
        assert_eq!(
            compaction.keep_recent_tokens,
            default_compaction.keep_recent_tokens
        );

        // upstream's documented defaults for the queue modes.
        assert_eq!(empty.steering_mode(), rpi_agent::QueueMode::OneAtATime);
        assert_eq!(empty.follow_up_mode(), rpi_agent::QueueMode::OneAtATime);

        // A partial object keeps the defaults it does not name.
        let partial: Settings = serde_json::from_str(r#"{"retry":{"maxRetries":9}}"#).unwrap();
        let retry = partial.retry_policy();
        assert_eq!(retry.max_retries, 9);
        assert_eq!(retry.base_delay_ms, defaults::RETRY_BASE_DELAY_MS);
    }

    /// upstream's key names must be accepted, not only rpi's.
    ///
    /// A user copying upstream's `settings.json` writes `enabledModels` and
    /// `httpIdleTimeoutMs`; before this they were silently ignored because rpi
    /// spelled them differently.
    #[test]
    fn native_settings_key_names_are_accepted() {
        let settings: Settings = serde_json::from_str(
            r#"{
                "enabledModels": ["a", "b"],
                "httpIdleTimeoutMs": 1500,
                "branchSummary": { "reserveTokens": 4242, "skipPrompt": true }
            }"#,
        )
        .expect("native key names parse");

        assert_eq!(
            settings.scoped_models,
            Some(vec!["a".to_string(), "b".to_string()]),
            "native's `enabledModels` must map onto rpi's scoped models"
        );
        assert_eq!(
            settings.http_idle_timeout_ms(),
            Some(1500),
            "native's `httpIdleTimeoutMs` must be read"
        );
        assert_eq!(settings.branch_summary_reserve_tokens(), Some(4242));
        assert!(settings.branch_summary_skipped());
    }

    #[test]
    fn save_load_scoped_models_roundtrip() {
        let (_tmp, _guard) = with_temp_env();
        let mut s = Settings::default();
        s.scoped_models = Some(vec!["a".into(), "b".into()]);
        save_settings(&s).unwrap();
        let loaded = load_settings().unwrap();
        assert_eq!(
            loaded.scoped_models,
            Some(vec!["a".to_string(), "b".to_string()])
        );
        // Clearing removes the key.
        let mut s2 = load_settings().unwrap();
        s2.scoped_models = None;
        save_settings(&s2).unwrap();
        assert_eq!(load_settings().unwrap().scoped_models, None);
    }

    #[test]
    fn changelog_settings_roundtrip_without_losing_existing_configuration() {
        let (_tmp, _guard) = with_temp_env();
        let path = config::settings_path().unwrap();
        std::fs::write(&path, r#"{"defaultModel":"existing-model","lastChangelogVersion":"0.3.16","collapseChangelog":true,"custom":{"retained":true}}"#).unwrap();
        let mut settings = load_settings().unwrap();
        assert_eq!(settings.last_changelog_version.as_deref(), Some("0.3.16"));
        assert_eq!(settings.collapse_changelog, Some(true));
        settings.last_changelog_version = Some("0.3.17".into());
        save_settings(&settings).unwrap();
        let loaded = load_settings().unwrap();
        assert_eq!(loaded.last_changelog_version.as_deref(), Some("0.3.17"));
        assert_eq!(loaded.default_model.as_deref(), Some("existing-model"));
        assert_eq!(loaded.collapse_changelog, Some(true));
        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(value["custom"]["retained"], true);
    }

    #[test]
    fn rpi_changelog_marker_preserves_foreign_baselines_and_existing_settings() {
        let (_tmp, _guard) = with_temp_env();
        let path = config::settings_path().unwrap();
        std::fs::write(
            &path,
            r#"{"lastChangelogVersion":"0.85.1","theme":"dark","custom":{"retained":true}}"#,
        )
        .unwrap();
        let mut settings = load_settings().unwrap();
        settings.last_rpi_changelog_version = Some("0.3.19".into());
        save_settings(&settings).unwrap();
        let loaded = load_settings().unwrap();
        assert_eq!(loaded.last_rpi_changelog_version.as_deref(), Some("0.3.19"));
        assert_eq!(loaded.last_changelog_version.as_deref(), Some("0.85.1"));
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(value["lastRpiChangelogVersion"], "0.3.19");
        assert_eq!(value["lastChangelogVersion"], "0.85.1");
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["custom"]["retained"], true);
    }

    #[test]
    fn save_uses_atomic_sibling_replacement() {
        let (_tmp, _guard) = with_temp_env();
        let path = config::settings_path().unwrap();
        std::fs::write(&path, r#"{"theme":"dark","piOnlyField":true}"#).unwrap();

        let mut settings = load_settings().unwrap();
        settings.theme = Some("light".into());
        save_settings(&settings).unwrap();

        let saved: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved["theme"], "light");
        assert_eq!(saved["piOnlyField"], true);
        // `config::atomic_write` cleans up its sibling by replacing the
        // target in one rename; a successful save leaves no staging file.
        let temp = path.with_file_name(format!(
            ".{}.tmp",
            path.file_name().and_then(|name| name.to_str()).unwrap()
        ));
        assert!(!temp.exists(), "atomic staging file should not remain");
    }

    #[test]
    fn save_preserves_unknown_fields_and_writes_the_tui_settings() {
        // Regression: `fullscreenCopyOnSelect` and `httpIdleTimeoutMs` used to
        // be read but never written back, so `/settings` changes silently
        // vanished. The newer `/settings` rows (showImages,
        // showCacheMissNotices, outputPad) must round-trip too.
        let (_tmp, _guard) = with_temp_env();
        let path = config::settings_path().unwrap();
        let mut settings = Settings::default();
        settings.show_images = Some(false);
        settings.show_cache_miss_notices = Some(true);
        settings.output_pad = Some(0);
        settings.fullscreen_copy_on_select = Some(false);
        settings.http_idle_timeout = Some(serde_json::json!(30_000));
        settings.show_terminal_progress = Some(false);
        save_settings(&settings).unwrap();

        let raw: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(raw["terminal"]["showImages"], false);
        assert_eq!(raw["terminal"]["showTerminalProgress"], false);
        assert_eq!(raw["showCacheMissNotices"], true);
        assert_eq!(raw["outputPad"], 0);
        assert_eq!(raw["fullscreenCopyOnSelect"], false);
        assert_eq!(raw["httpIdleTimeoutMs"], 30_000);

        // And they load back.
        let reloaded = load_settings().unwrap();
        assert_eq!(reloaded.show_images(), Some(false));
        assert_eq!(reloaded.show_cache_miss_notices, Some(true));
        assert_eq!(reloaded.output_pad, Some(0));
        assert_eq!(reloaded.fullscreen_copy_on_select, Some(false));
        assert_eq!(reloaded.http_idle_timeout_ms(), Some(30_000));
        assert_eq!(reloaded.show_terminal_progress(), Some(false));
    }

    #[test]
    fn nested_terminal_block_is_accepted_as_a_fallback() {
        // upstream nests `showImages` / `showTerminalProgress` under
        // `terminal`; rpi's flat keys win when both are present.
        let (_tmp, _guard) = with_temp_env();
        let path = config::settings_path().unwrap();
        std::fs::write(
            &path,
            r#"{ "terminal": { "showImages": false, "showTerminalProgress": false } }"#,
        )
        .unwrap();
        let settings = load_settings().unwrap();
        assert_eq!(settings.show_images(), Some(false));
        assert_eq!(settings.show_terminal_progress(), Some(false));

        std::fs::write(
            &path,
            r#"{
                "showImages": true,
                "terminal": { "showImages": false }
            }"#,
        )
        .unwrap();
        let settings = load_settings().unwrap();
        assert_eq!(settings.show_images(), Some(true));
    }

    #[test]
    fn save_preserves_unknown_fields() {
        let (_tmp, _guard) = with_temp_env();
        let path = config::settings_path().unwrap();
        std::fs::write(
            &path,
            r#"{
                "piOnlyField": "keep-me",
                "theme": "dark"
            }"#,
        )
        .unwrap();
        let mut s = load_settings().unwrap();
        s.scoped_models = Some(vec!["m1".into()]);
        save_settings(&s).unwrap();
        let raw: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(raw["piOnlyField"], "keep-me");
        assert_eq!(raw["enabledModels"][0], "m1");
        assert_eq!(raw["theme"], "dark");
    }

    #[test]
    fn save_preserves_unknown_fields_and_packages_with_line_comments() {
        let (_tmp, _guard) = with_temp_env();
        let path = config::settings_path().unwrap();
        let original = r#"{
            // upstream permits comments in settings files.
            "piOnlyField": { "keep": true },
            "theme": "dark"
        }
        "#;
        std::fs::write(&path, original).unwrap();

        let mut settings = load_settings().unwrap();
        settings.scoped_models = Some(vec!["m1".into()]);
        save_settings(&settings).unwrap();

        // The comments may be normalized away by pretty-printing, but every
        // unknown field must survive the merge.
        let raw: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(raw["piOnlyField"]["keep"], true);
        assert_eq!(raw["theme"], "dark");
        assert_eq!(raw["enabledModels"][0], "m1");
    }

    #[test]
    fn save_fails_closed_for_unparseable_existing_settings() {
        let (_tmp, _guard) = with_temp_env();
        let path = config::settings_path().unwrap();
        // This is not recoverable by stripping comments (the closing brace is
        // missing). Saving must leave the user's file byte-for-byte intact.
        let original = b"{\n  // keep this file intact\n  \"piOnlyField\": \"keep-me\"\n";
        std::fs::write(&path, original).unwrap();

        let mut settings = Settings::default();
        settings.theme = Some("light".into());
        let error =
            save_settings(&settings).expect_err("malformed settings must not be overwritten");
        assert!(error.contains("cannot parse existing settings file"));
        assert_eq!(std::fs::read(&path).unwrap(), original);
    }

    /// A file the port writes must be read back with the same values.
    #[test]
    fn settings_roundtrip_with_pi_key_names() {
        let (_tmp, _guard) = with_temp_env();
        let path = config::settings_path().unwrap();
        let written = r#"{
            "$schema": "https://pi.dev/schemas/settings.schema.json",
            "defaultProvider": "anthropic",
            "defaultModel": "claude-sonnet-5",
            "defaultThinkingLevel": "high",
            "theme": "dark",
            "transport": "sse",
            "sessionShareDestination": "gist",
            "steeringMode": "all",
            "followUpMode": "one-at-a-time",
            "hideThinkingBlock": false,
            "showCacheMissNotices": true,
            "externalEditor": "nano",
            "shellPath": "/bin/zsh",
            "quietStartup": "header",
            "defaultProjectTrust": "always",
            "shellCommandPrefix": "shopt -s expand_aliases",
            "npmCommand": ["mise", "exec", "node@20", "--", "npm"],
            "collapseChangelog": true,
            "packages": ["pi-package", {"source": "git+https://example.com/pkg"}],
            "extensions": ["/tmp/ext"],
            "deviceId": "uuid-1",
            "skills": ["/tmp/skills"],
            "prompts": ["/tmp/prompts"],
            "themes": ["/tmp/themes"],
            "enableSkillCommands": false,
            "terminal": {
                "showImages": false,
                "imageWidthCells": 80,
                "clearOnShrink": true,
                "showTerminalProgress": true,
                "hyperlinks": "auto",
                "images": "kitty",
                "trueColor": true
            },
            "images": {"autoResize": false, "blockImages": true},
            "enabledModels": ["model-a"],
            "defaultTools": ["read", "bash"],
            "doubleEscapeAction": "fork",
            "treeFilterMode": "user-only",
            "thinkingBudgets": {"minimal": 100, "low": 200, "medium": 300, "high": 400},
            "editorPaddingX": 2,
            "outputPad": 0,
            "nerdFonts": true,
            "threeDEmptySession": true,
            "autocompleteMaxVisible": 9,
            "autocompletePosition": "below",
            "showHardwareCursor": true,
            "markdown": {"codeBlockIndent": "    ", "mermaid": "final"},
            "warnings": {"anthropicExtraUsage": false},
            "codemode": {"mode": "only", "inlineBudget": 1500},
            "sessionDir": "/tmp/sessions",
            "httpProxy": "http://127.0.0.1:8888",
            "httpIdleTimeoutMs": 1500,
            "projectContextMaxChars": 4096,
            "cacheWarming": "idle",
            "websocketConnectTimeoutMs": "disabled",
            "tuiMode": "regular",
            "fullscreenExitOutput": "transcript",
            "fullscreenScrollbar": "hidden",
            "fullscreenCopyOnSelect": false,
            "fullscreenWheelScrollLines": "auto",
            "queueMode": "all",
            "websockets": true,
            "modelThinkingLevels": {"anthropic/claude-sonnet-5": "low"},
            "compaction": {"enabled": false, "reserveTokens": 111, "keepRecentTokens": 222},
            "branchSummary": {"reserveTokens": 333, "skipPrompt": true},
            "retry": {"enabled": false, "maxRetries": 5, "baseDelayMs": 250, "maxAgentDelayMs": 9000}
        }"#;
        std::fs::write(&path, written).unwrap();

        let settings = load_settings().unwrap();
        assert_eq!(settings.default_provider.as_deref(), Some("anthropic"));
        assert_eq!(settings.default_model.as_deref(), Some("claude-sonnet-5"));
        assert_eq!(settings.default_thinking_level.as_deref(), Some("high"));
        assert_eq!(settings.theme.as_deref(), Some("dark"));
        assert_eq!(settings.transport.as_deref(), Some("sse"));
        assert_eq!(settings.session_share_destination.as_deref(), Some("gist"));
        assert_eq!(settings.steering_mode, Some(QueueModeSetting::All));
        assert_eq!(settings.follow_up_mode, Some(QueueModeSetting::OneAtATime));
        assert_eq!(settings.hide_thinking_block, Some(false));
        assert_eq!(settings.show_cache_miss_notices, Some(true));
        assert_eq!(settings.external_editor.as_deref(), Some("nano"));
        assert_eq!(settings.shell_path.as_deref(), Some("/bin/zsh"));
        assert_eq!(settings.quiet_startup.as_deref(), Some("header"));
        assert_eq!(settings.default_project_trust.as_deref(), Some("always"));
        assert_eq!(
            settings.shell_command_prefix.as_deref(),
            Some("shopt -s expand_aliases")
        );
        assert_eq!(
            settings.npm_command.as_deref(),
            Some(["mise".to_string(), "exec".to_string(), "npm".to_string()].as_slice())
        );
        assert_eq!(settings.collapse_changelog, Some(true));
        assert_eq!(settings.packages.as_ref().map(|p| p.len()), Some(2));
        assert_eq!(settings.extension_dirs.as_deref(), Some(["/tmp/ext".to_string()].as_slice()));
        assert_eq!(settings.device_id.as_deref(), Some("uuid-1"));
        assert_eq!(settings.skill_dirs.as_deref(), Some(["/tmp/skills".to_string()].as_slice()));
        assert_eq!(
            settings.prompt_dirs.as_deref(),
            Some(["/tmp/prompts".to_string()].as_slice())
        );
        assert_eq!(settings.themes.as_deref(), Some(["/tmp/themes".to_string()].as_slice()));
        assert_eq!(settings.enable_skill_commands, Some(false));
        let terminal = settings.terminal.as_ref().unwrap();
        assert_eq!(terminal.show_images, Some(false));
        assert_eq!(terminal.image_width_cells, Some(80));
        assert_eq!(terminal.clear_on_shrink, Some(true));
        assert_eq!(terminal.show_terminal_progress, Some(true));
        assert_eq!(terminal.hyperlinks, Some(serde_json::json!("auto")));
        assert_eq!(terminal.images, Some(serde_json::json!("kitty")));
        assert_eq!(terminal.true_color, Some(serde_json::json!(true)));
        let images = settings.images.as_ref().unwrap();
        assert_eq!(images.auto_resize, Some(false));
        assert_eq!(images.block_images, Some(true));
        assert_eq!(settings.scoped_models.as_deref(), Some(["model-a".to_string()].as_slice()));
        assert_eq!(
            settings.default_tools.as_deref(),
            Some(["read".to_string(), "bash".to_string()].as_slice())
        );
        assert_eq!(settings.double_escape_action.as_deref(), Some("fork"));
        assert_eq!(settings.tree_filter_mode.as_deref(), Some("user-only"));
        let budgets = settings.thinking_budgets.as_ref().unwrap();
        assert_eq!(budgets.minimal, Some(100.0));
        assert_eq!(budgets.high, Some(400.0));
        assert_eq!(settings.editor_padding_x, Some(2));
        assert_eq!(settings.output_pad, Some(0));
        assert_eq!(settings.nerd_fonts, Some(true));
        assert_eq!(settings.three_d_empty_session, Some(true));
        assert_eq!(settings.autocomplete_max_visible, Some(9));
        assert_eq!(settings.autocomplete_position.as_deref(), Some("below"));
        assert_eq!(settings.show_hardware_cursor, Some(true));
        let markdown = settings.markdown.as_ref().unwrap();
        assert_eq!(markdown.code_block_indent.as_deref(), Some("    "));
        assert_eq!(markdown.mermaid.as_deref(), Some("final"));
        let warnings = settings.warnings.as_ref().unwrap();
        assert_eq!(warnings.anthropic_extra_usage, Some(false));
        let codemode = settings.codemode.as_ref().unwrap();
        assert_eq!(codemode.mode.as_deref(), Some("only"));
        assert_eq!(codemode.inline_budget, Some(1500));
        assert_eq!(settings.session_dir, Some(PathBuf::from("/tmp/sessions")));
        assert_eq!(settings.http_proxy.as_deref(), Some("http://127.0.0.1:8888"));
        assert_eq!(settings.http_idle_timeout_ms(), Some(1500));
        assert_eq!(settings.project_context_max_chars, Some(4096));
        assert_eq!(settings.cache_warming.as_deref(), Some("idle"));
        assert_eq!(
            settings.websocket_connect_timeout_ms,
            Some(serde_json::json!("disabled"))
        );
        assert_eq!(settings.tui_mode.as_deref(), Some("regular"));
        assert_eq!(settings.fullscreen_exit_output.as_deref(), Some("transcript"));
        assert_eq!(settings.fullscreen_scrollbar.as_deref(), Some("hidden"));
        assert_eq!(settings.fullscreen_copy_on_select, Some(false));
        assert_eq!(
            settings.fullscreen_wheel_scroll_lines,
            Some(serde_json::json!("auto"))
        );
        assert_eq!(settings.queue_mode.as_deref(), Some("all"));
        assert_eq!(settings.websockets, Some(true));
        assert_eq!(
            settings
                .model_thinking_levels
                .as_ref()
                .and_then(|levels| levels.get("anthropic/claude-sonnet-5"))
                .map(String::as_str),
            Some("low")
        );
        let compaction = settings.compaction.as_ref().unwrap();
        assert_eq!(compaction.enabled, Some(false));
        assert_eq!(compaction.reserve_tokens, Some(111));
        assert_eq!(compaction.keep_recent_tokens, Some(222));
        let branch = settings.branch_summary.as_ref().unwrap();
        assert_eq!(branch.reserve_tokens, Some(333));
        assert_eq!(branch.skip_prompt, Some(true));
        let retry = settings.retry.as_ref().unwrap();
        assert_eq!(retry.enabled, Some(false));
        assert_eq!(retry.max_retries, Some(5));
        assert_eq!(retry.base_delay_ms, Some(250));
        assert_eq!(retry.max_agent_delay_ms, Some(9000));

        // Saving the loaded settings must not change the file's meaning.
        save_settings(&settings).unwrap();
        let reloaded = load_settings().unwrap();
        assert_eq!(reloaded.default_model.as_deref(), Some("claude-sonnet-5"));
        assert_eq!(reloaded.transport.as_deref(), Some("sse"));
        assert_eq!(reloaded.scoped_models, settings.scoped_models);
        assert_eq!(reloaded.terminal, settings.terminal);
        assert_eq!(reloaded.output_pad, settings.output_pad);
        assert_eq!(reloaded.http_idle_timeout, settings.http_idle_timeout);
    }

    /// Every default must match the original's `SETTINGS_DEFAULTS`.
    #[test]
    fn defaults_match_the_original() {
        let expected: serde_json::Value = serde_json::json!({
            "transport": "auto",
            "sessionShareDestination": "auto",
            "steeringMode": "one-at-a-time",
            "followUpMode": "one-at-a-time",
            "compaction": {"enabled": true, "reserveTokens": 16384, "keepRecentTokens": 20000},
            "branchSummary": {"reserveTokens": 16384, "skipPrompt": false},
            "retry": {
                "enabled": true,
                "maxRetries": 3,
                "baseDelayMs": 2000,
                "maxAgentDelayMs": 60000,
                "provider": {"maxRetryDelayMs": 60000}
            },
            "hideThinkingBlock": true,
            "projectContextMaxChars": 0,
            "showCacheMissNotices": false,
            "quietStartup": false,
            "defaultProjectTrust": "ask",
            "collapseChangelog": false,
            "enableSkillCommands": true,
            "terminal": {
                "showImages": true,
                "imageWidthCells": 60,
                "clearOnShrink": false,
                "showTerminalProgress": false
            },
            "images": {"autoResize": true, "blockImages": false},
            "doubleEscapeAction": "tree",
            "treeFilterMode": "default",
            "editorPaddingX": 0,
            "outputPad": 1,
            "nerdFonts": false,
            "threeDEmptySession": false,
            "autocompleteMaxVisible": 5,
            "autocompletePosition": "above",
            "markdown": {"codeBlockIndent": "  ", "mermaid": "streaming"},
            "warnings": {"anthropicExtraUsage": true},
            "codemode": {"mode": "on", "inlineBudget": 3000},
            "cacheWarming": "streaming",
            "tuiMode": "fullscreen",
            "fullscreenExitOutput": "resume-hint",
            "fullscreenScrollbar": "auto",
            "fullscreenCopyOnSelect": true,
            "fullscreenWheelScrollLines": 1
        });

        assert_eq!(Settings::default().effective(), expected);
    }

    /// A value in the file wins over the default.
    #[test]
    fn file_values_win_over_defaults() {
        let settings: Settings = serde_json::from_str(
            r#"{"transport":"websocket","outputPad":0,"terminal":{"showImages":false},
                "compaction":{"reserveTokens":10},"retry":{"maxRetries":9}}"#,
        )
        .unwrap();
        let effective = settings.effective();
        assert_eq!(effective["transport"], "websocket");
        assert_eq!(effective["outputPad"], 0);
        assert_eq!(effective["terminal"]["showImages"], false);
        assert_eq!(effective["compaction"]["reserveTokens"], 10);
        assert_eq!(effective["compaction"]["keepRecentTokens"], 20000);
        assert_eq!(effective["retry"]["maxRetries"], 9);
        assert_eq!(effective["retry"]["baseDelayMs"], 2000);
    }

    /// pi's deprecated `skills` object form must not break the whole file.
    #[test]
    fn deprecated_skills_object_is_read() {
        let settings: Settings =
            serde_json::from_str(r#"{"skills":{"customDirectories":["/tmp/skills"]}}"#).unwrap();
        assert_eq!(
            settings.skill_dirs.as_deref(),
            Some(["/tmp/skills".to_string()].as_slice())
        );
    }

    /// Keybindings live in pi's `keybindings.json`, not in `settings.json`.
    #[test]
    fn keybindings_come_from_the_agent_dir() {
        let (_tmp, _guard) = with_temp_env();
        let agent_dir = config::agent_dir().unwrap();
        std::fs::create_dir_all(&agent_dir).unwrap();
        std::fs::write(
            agent_dir.join("keybindings.json"),
            r#"{"app.interrupt":"ctrl+c"}"#,
        )
        .unwrap();

        let settings = load_settings().unwrap();
        let bindings = settings.keybindings.expect("keybindings are read");
        assert_eq!(
            bindings.get("app.interrupt"),
            Some(&serde_json::json!("ctrl+c"))
        );
    }

    /// The file the port writes must never truncate the user's `settings.json`.
    ///
    /// The port shares pi's agent directory, so a half-written file would break
    /// pi too: the write goes through `config::atomic_write`, and a file that
    /// cannot be parsed is left byte-for-byte alone.
    #[test]
    fn a_failed_save_leaves_the_file_untouched() {
        let (_tmp, _guard) = with_temp_env();
        let path = config::settings_path().unwrap();
        let original = b"{\n  // keep this file intact\n  \"piOnlyField\": \"keep-me\"\n";
        std::fs::write(&path, original).unwrap();

        let mut settings = Settings::default();
        settings.theme = Some("light".into());
        let error = save_settings(&settings).expect_err("a malformed file must not be overwritten");
        assert!(error.contains("cannot parse existing settings file"));
        assert_eq!(std::fs::read(&path).unwrap(), original);

        // A file that parses is replaced atomically: no staging file is left
        // behind and the result parses.
        std::fs::write(&path, r#"{"theme":"dark"}"#).unwrap();
        save_settings(&settings).unwrap();
        let written: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(written["theme"], "light");
        let staging = path.with_file_name(format!(
            ".{}.tmp",
            path.file_name().and_then(|name| name.to_str()).unwrap()
        ));
        assert!(!staging.exists(), "atomic staging file should not remain");
    }

    /// Write the fixture the cross-check script reads.
    ///
    /// `scripts/parity/settings-values.mjs` validates the port's file against
    /// the original's published JSON schema and compares the effective values
    /// with the original's defaults.
    #[test]
    fn parity_fixture_is_written_for_the_cross_check() {
        let guard = env_lock().lock().unwrap();
        let dir = std::env::temp_dir().join("rpi-settings-parity");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let prev = std::env::var_os(config::CONFIG_DIR_ENV);
        std::env::set_var(config::CONFIG_DIR_ENV, &dir);

        let fixture = r#"{
            "$schema": "https://pi.dev/schemas/settings.schema.json",
            "defaultProvider": "anthropic",
            "defaultModel": "claude-sonnet-5",
            "defaultThinkingLevel": "high",
            "theme": "dark",
            "transport": "sse",
            "sessionShareDestination": "gist",
            "steeringMode": "all",
            "followUpMode": "one-at-a-time",
            "hideThinkingBlock": false,
            "showCacheMissNotices": true,
            "externalEditor": "nano",
            "shellPath": "/bin/zsh",
            "quietStartup": "header",
            "defaultProjectTrust": "always",
            "shellCommandPrefix": "shopt -s expand_aliases",
            "npmCommand": ["mise", "exec", "node@20", "--", "npm"],
            "collapseChangelog": true,
            "packages": ["pi-package"],
            "extensions": ["/tmp/ext"],
            "deviceId": "uuid-1",
            "skills": ["/tmp/skills"],
            "prompts": ["/tmp/prompts"],
            "themes": ["/tmp/themes"],
            "enableSkillCommands": false,
            "terminal": {
                "showImages": false,
                "imageWidthCells": 80,
                "clearOnShrink": true,
                "showTerminalProgress": true
            },
            "images": {"autoResize": false, "blockImages": true},
            "enabledModels": ["model-a"],
            "defaultTools": ["read", "bash"],
            "doubleEscapeAction": "fork",
            "treeFilterMode": "user-only",
            "thinkingBudgets": {"minimal": 100, "low": 200, "medium": 300, "high": 400},
            "editorPaddingX": 2,
            "outputPad": 0,
            "nerdFonts": true,
            "threeDEmptySession": true,
            "autocompleteMaxVisible": 9,
            "autocompletePosition": "below",
            "showHardwareCursor": true,
            "markdown": {"codeBlockIndent": "    ", "mermaid": "final"},
            "warnings": {"anthropicExtraUsage": false},
            "codemode": {"mode": "only", "inlineBudget": 1500},
            "sessionDir": "/tmp/sessions",
            "httpProxy": "http://127.0.0.1:8888",
            "httpIdleTimeoutMs": 1500,
            "projectContextMaxChars": 4096,
            "cacheWarming": "idle",
            "websocketConnectTimeoutMs": "disabled",
            "tuiMode": "regular",
            "fullscreenExitOutput": "transcript",
            "fullscreenScrollbar": "hidden",
            "fullscreenCopyOnSelect": false,
            "fullscreenWheelScrollLines": 5,
            "queueMode": "all",
            "websockets": true,
            "modelThinkingLevels": {"anthropic/claude-sonnet-5": "low"},
            "compaction": {"enabled": false, "reserveTokens": 111, "keepRecentTokens": 222},
            "branchSummary": {"reserveTokens": 333, "skipPrompt": true},
            "retry": {"enabled": false, "maxRetries": 5, "baseDelayMs": 250, "maxAgentDelayMs": 9000}
        }"#;
        std::fs::write(dir.join("settings.json"), fixture).unwrap();
        std::fs::write(dir.join("pi-settings.json"), fixture).unwrap();

        // The port's view of the file pi wrote.
        let settings = load_settings().unwrap();
        std::fs::write(
            dir.join("pi-effective.json"),
            serde_json::to_string_pretty(&settings.effective()).unwrap(),
        )
        .unwrap();

        // The file the port writes, and the port's view of it.
        save_settings(&settings).unwrap();
        let written = std::fs::read_to_string(dir.join("settings.json")).unwrap();
        std::fs::write(dir.join("port-settings.json"), &written).unwrap();
        let reloaded = load_settings().unwrap();
        std::fs::write(
            dir.join("port-effective.json"),
            serde_json::to_string_pretty(&reloaded.effective()).unwrap(),
        )
        .unwrap();

        match prev {
            Some(value) => std::env::set_var(config::CONFIG_DIR_ENV, value),
            None => std::env::remove_var(config::CONFIG_DIR_ENV),
        }
        drop(guard);
    }
}

/// The settings keys that used to be parsed, written and never read back.
///
/// Every key here is read again when the port starts: the test writes a
/// `settings.json`, loads it the way the port does, and asserts the value the
/// running port will use.
#[cfg(test)]
mod settings_keys_tests {
    use super::*;
    use crate::config::test_support::env_lock;

    fn with_temp_env() -> (tempfile::TempDir, std::sync::MutexGuard<'static, ()>) {
        let guard = env_lock().lock().unwrap();
        let tmp = tempfile::TempDir::new().unwrap();
        std::env::set_var(config::CONFIG_DIR_ENV, tmp.path());
        (tmp, guard)
    }

    /// The round trip: a written file is read back with the values the port
    /// acts on.
    #[test]
    fn the_settings_keys_are_read_back_on_the_next_run() {
        let (_tmp, guard) = with_temp_env();
        let path = config::settings_path().unwrap();
        std::fs::write(
            &path,
            r#"{
                "outputPad": 0,
                "showHardwareCursor": true,
                "fullscreenScrollbar": "always",
                "autocompletePosition": "below",
                "treeFilterMode": "user-only",
                "externalEditor": "my-editor --wait",
                "thinkingBudgets": {"minimal": 100, "low": 200, "medium": 300, "high": 400},
                "projectContextMaxChars": 4096,
                "shellPath": "/bin/zsh",
                "markdown": {"codeBlockIndent": "    "},
                "fullscreenExitOutput": "transcript",
                "fullscreenWheelScrollLines": 7,
                "modelThinkingLevels": {"anthropic/claude-sonnet-5": "low"},
                "terminal": {"hyperlinks": false, "images": "kitty", "trueColor": true},
                "compaction": {
                    "modelOverrides": {
                        "anthropic/claude-sonnet-5": {"reserveTokens": 111, "keepRecentTokens": 222}
                    }
                }
            }"#,
        )
        .unwrap();

        let settings = load_settings().unwrap();

        assert_eq!(settings.output_pad(), 0);
        assert!(settings.show_hardware_cursor());
        assert_eq!(settings.fullscreen_scrollbar(), "always");
        assert_eq!(settings.autocomplete_position(), "below");
        assert_eq!(settings.tree_filter_mode(), "user-only");
        assert_eq!(settings.external_editor_command(), "my-editor --wait");
        assert_eq!(settings.project_context_max_chars(), 4096);
        assert_eq!(settings.shell_path().as_deref(), Some("/bin/zsh"));
        assert_eq!(settings.code_block_indent(), "    ");
        assert_eq!(settings.fullscreen_exit_output(), "transcript");
        assert_eq!(settings.fullscreen_wheel_scroll_lines(), Some(7));
        assert_eq!(
            settings.model_thinking_level("anthropic", "claude-sonnet-5"),
            Some("low".to_string())
        );

        let budgets = settings.thinking_budgets().expect("budgets are read");
        assert_eq!(budgets.minimal, Some(100));
        assert_eq!(budgets.low, Some(200));
        assert_eq!(budgets.medium, Some(300));
        assert_eq!(budgets.high, Some(400));

        let overrides = settings.terminal_capability_overrides();
        assert_eq!(overrides.hyperlinks, Some(false));
        assert_eq!(overrides.true_color, Some(true));
        assert_eq!(overrides.images, Some(rpi_tui::ImageProtocol::Kitty));

        let compaction = settings.compaction_settings_for(Some("anthropic/claude-sonnet-5"));
        assert_eq!(compaction.reserve_tokens, 111);
        assert_eq!(compaction.keep_recent_tokens, 222);
        let other = settings.compaction_settings_for(Some("anthropic/other"));
        assert_eq!(
            other.reserve_tokens,
            defaults::COMPACTION_RESERVE_TOKENS,
            "a model without an override keeps the plain value"
        );

        drop(guard);
    }

    /// An absent key keeps upstream's default, and an unknown value falls back
    /// to it too.
    #[test]
    fn absent_keys_keep_the_defaults() {
        let settings = Settings::default();
        assert_eq!(settings.output_pad(), defaults::OUTPUT_PAD as usize);
        assert_eq!(settings.fullscreen_scrollbar(), defaults::FULLSCREEN_SCROLLBAR);
        assert_eq!(settings.autocomplete_position(), defaults::AUTOCOMPLETE_POSITION);
        assert_eq!(settings.tree_filter_mode(), defaults::TREE_FILTER_MODE);
        assert_eq!(settings.fullscreen_exit_output(), defaults::FULLSCREEN_EXIT_OUTPUT);
        assert_eq!(settings.fullscreen_wheel_scroll_lines(), None);
        assert_eq!(settings.project_context_max_chars(), 0);
        assert!(settings.thinking_budgets().is_none());

        let odd: Settings =
            serde_json::from_str(r#"{"outputPad": 5, "autocompletePosition": "sideways"}"#).unwrap();
        assert_eq!(odd.output_pad(), defaults::OUTPUT_PAD as usize);
        assert_eq!(odd.autocomplete_position(), defaults::AUTOCOMPLETE_POSITION);
    }

    /// The legacy keys seed their modern counterparts.
    #[test]
    fn the_legacy_keys_seed_their_modern_counterparts() {
        let legacy: Settings =
            serde_json::from_str(r#"{"queueMode": "all", "websockets": true}"#).unwrap();
        assert_eq!(legacy.steering_mode(), rpi_agent::QueueMode::All);
        assert_eq!(legacy.transport(), "websocket");

        let legacy_off: Settings = serde_json::from_str(r#"{"websockets": false}"#).unwrap();
        assert_eq!(legacy_off.transport(), "sse");

        let legacy_retry: Settings =
            serde_json::from_str(r#"{"retry": {"maxDelayMs": 9000}}"#).unwrap();
        let options = legacy_retry.provider_retry_options();
        assert_eq!(
            options.max_retry_delay,
            Some(std::time::Duration::from_millis(9000)),
            "upstream's `retry.maxDelayMs` seeds `retry.provider.maxRetryDelayMs`"
        );

        let modern: Settings =
            serde_json::from_str(r#"{"steeringMode": "one-at-a-time", "websockets": true}"#).unwrap();
        assert_eq!(
            modern.steering_mode(),
            rpi_agent::QueueMode::OneAtATime,
            "the modern key wins over the legacy one"
        );
    }

    /// The external editor: the setting, then `$VISUAL`, then `$EDITOR`.
    #[test]
    fn the_external_editor_follows_the_documented_order() {
        let (_tmp, guard) = with_temp_env();
        let previous_visual = std::env::var("VISUAL").ok();
        let previous_editor = std::env::var("EDITOR").ok();
        std::env::remove_var("RPI_EXTERNAL_EDITOR");

        std::env::set_var("VISUAL", "visual-editor");
        std::env::set_var("EDITOR", "editor-editor");
        assert_eq!(
            Settings::default().external_editor_command(),
            "visual-editor",
            "upstream reads VISUAL before EDITOR"
        );

        let configured: Settings =
            serde_json::from_str(r#"{"externalEditor": "configured-editor"}"#).unwrap();
        assert_eq!(
            configured.external_editor_command(),
            "configured-editor",
            "the setting wins over the environment"
        );

        std::env::remove_var("VISUAL");
        assert_eq!(Settings::default().external_editor_command(), "editor-editor");

        match previous_visual {
            Some(value) => std::env::set_var("VISUAL", value),
            None => std::env::remove_var("VISUAL"),
        }
        match previous_editor {
            Some(value) => std::env::set_var("EDITOR", value),
            None => std::env::remove_var("EDITOR"),
        }
        drop(guard);
    }
}
