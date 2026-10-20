//! Transcript messages, welcome panels, errors, and session resume hints.

use super::*;

// ===========================================================================
// Transcript message helpers
// ===========================================================================

/// Add the startup block to the chat container: pi's mark and version, the key
/// hints, and the note the original prints under them.
pub(super) fn add_welcome_message(container: &Arc<Container>) {
    let c = current_theme().colors;
    let version = crate::changelog::current_version();
    let (top, bottom) = pi_logo_lines();
    // The original's header container opens with a blank row.
    container.add_child(Arc::new(Spacer::new(1)));
    container.add_child(Arc::new(Text::new(
        format!("{top} v{version}"),
        1,
        0,
    )));
    container.add_child(Arc::new(Text::new(
        c.muted.fg(&format!("{bottom} {}", compact_hints())),
        1,
        0,
    )));
    container.add_child(Arc::new(Text::new(
        c.dim.fg(&format!(
            "Press {} to show full startup help.",
            rpi_tui::key_text("app.tools.expand")
        )),
        1,
        0,
    )));
    add_startup_note(container);
    // The original's header container closes with a blank row too.
    container.add_child(Arc::new(Spacer::new(1)));
}

/// The original's mark: four cells wide, two lines tall, in its own colours.
fn pi_logo_lines() -> (String, String) {
    let coral = rpi_tui::ansi::foreground_rgb(228, 138, 122);
    let blue = rpi_tui::ansi::foreground_rgb(79, 142, 179);
    let yellow = rpi_tui::ansi::foreground_rgb(234, 182, 93);
    let blue_background = rpi_tui::ansi::background_rgb(79, 142, 179);
    let reset = "\u{1b}[0m";
    let top = format!("{coral}{blue_background}▀{reset}{coral}▀█{reset} ");
    let bottom = format!("{blue}█▀{reset} {yellow}█{reset}");
    (top, bottom)
}

/// The original's compact startup hints.
fn compact_hints() -> String {
    [
        format!("{} interrupt", rpi_tui::key_text("app.interrupt")),
        "ctrl+c twice to exit".to_string(),
        "/ commands".to_string(),
        "! bash".to_string(),
        format!("{} more", rpi_tui::key_text("app.tools.expand")),
    ]
    .join(" · ")
}

/// The original's warning when tmux cannot deliver modified Enter keys.
pub(crate) const TMUX_EXTENDED_KEYS_OFF: &str = "tmux extended-keys is off. Modified Enter keys may not work. Add `set -g extended-keys on` to ~/.tmux.conf and restart tmux.";

/// The original's warning when tmux delivers the keys in the xterm format.
pub(crate) const TMUX_EXTENDED_KEYS_FORMAT_XTERM: &str = "tmux extended-keys-format is xterm. Pi works best with csi-u. Add `set -g extended-keys-format csi-u` to ~/.tmux.conf and restart tmux.";

/// The warning the original prints at startup when tmux cannot deliver
/// modified Enter keys.
pub(super) fn add_tmux_warning(container: &Arc<Container>) {
    let Some(message) = tmux_warning_message() else {
        return;
    };
    let c = current_theme().colors;
    container.add_child(Arc::new(Spacer::new(1)));
    container.add_child(Arc::new(Text::new(
        c.warning.fg(&warning_line(&message)),
        1,
        0,
    )));
}

/// The line the original prints for a startup warning.
pub(super) fn warning_line(message: &str) -> String {
    format!("Warning: {message}")
}

/// The tmux warning for the queried option values, or `None` when there is
/// nothing to warn about.
pub(super) fn tmux_warning_for(
    extended_keys: Option<&str>,
    extended_keys_format: Option<&str>,
) -> Option<&'static str> {
    let extended_keys = extended_keys?;
    if extended_keys != "on" && extended_keys != "always" {
        return Some(TMUX_EXTENDED_KEYS_OFF);
    }
    if extended_keys_format == Some("xterm") {
        return Some(TMUX_EXTENDED_KEYS_FORMAT_XTERM);
    }
    None
}

/// The tmux warning text, or `None` when there is nothing to warn about.
fn tmux_warning_message() -> Option<String> {
    if std::env::var_os("TMUX").is_none() {
        return None;
    }
    let extended_keys = tmux_option("extended-keys")?;
    let extended_keys_format = tmux_option("extended-keys-format");
    tmux_warning_for(Some(&extended_keys), extended_keys_format.as_deref())
        .map(str::to_string)
}

/// Read one tmux global option, with the original's two second budget.
fn tmux_option(name: &str) -> Option<String> {
    use std::io::Read;
    let mut child = std::process::Command::new("tmux")
        .args(["show", "-gv", name])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                let mut out = String::new();
                child
                    .stdout
                    .take()?
                    .read_to_string(&mut out)
                    .ok()?;
                return Some(out.trim().to_string());
            }
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    return None;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            Err(_) => return None,
        }
    }
}

/// The note the original prints under the startup hints.
pub(super) fn add_startup_note(container: &Arc<Container>) {
    let c = current_theme().colors;
    container.add_child(Arc::new(Spacer::new(1)));
    container.add_child(Arc::new(Text::new(
        c.dim.fg(
            "Pi can explain its own features and look up its docs. Ask it how to use or extend Pi.",
        ),
        1,
        0,
    )));
}

/// Append update notices inside the live transcript. Fullscreen mode clears
/// pre-TUI stdout/stderr, so update state must be represented by components.
pub(super) fn add_update_notices(
    container: &Arc<Container>,
    report: &crate::updates::UpdateReport,
) {
    let colors = current_theme().colors;
    let group = Arc::new(Container::new());

    for warning in &report.warnings {
        let body = format!(
            "{}\n{} {}{}",
            colors.error.fg(&warning.message),
            colors.muted.fg("Run"),
            colors.accent.fg(&warning.command),
            colors.muted.fg(" to retry.")
        );
        add_update_panel(&group, "Update Failed", &body, colors.error);
    }

    if let Some(notice) = report.notices.iter().find(|notice| notice.name == "rpi") {
        let body = format!(
            "{} {}{}",
            colors
                .muted
                .fg(&format!("New version {} is available. Run", notice.latest)),
            colors.accent.fg(&notice.command),
            colors.muted.fg(".")
        );
        add_update_panel(&group, "Update Available", &body, colors.warning);
    }

    for notice in report.notices.iter().filter(|notice| notice.name != "rpi") {
        let body = format!(
            "{}\n{} {}",
            colors.muted.fg(&format!(
                "{} {} -> {}",
                notice.name, notice.current, notice.latest
            )),
            colors.muted.fg("Run"),
            colors.accent.fg(&notice.command)
        );
        add_update_panel(&group, "Package Update Available", &body, colors.warning);
    }

    // Other transcript producers append concurrently. Add the fully built
    // group in one operation so card borders and content cannot interleave
    // with user, assistant, tool, or extension messages.
    if group.child_count() > 0 {
        container.add_child(group);
    }
}

pub(super) fn add_update_panel(
    container: &Arc<Container>,
    title: &str,
    body: &str,
    color: rpi_tui::Color,
) {
    container.add_child(Arc::new(Spacer::new(1)));
    container.add_child(Arc::new(DynamicBorder::with_color(color)));
    container.add_child(Arc::new(Text::new(
        format!("{}\n{body}", color.fg(&tui_bold(title))),
        1,
        0,
    )));
    container.add_child(Arc::new(DynamicBorder::with_color(color)));
}

/// Add the `/help` command listing to the chat container.
pub(super) fn add_help_message(container: &Arc<Container>) {
    let c = current_theme().colors;
    container.add_child(Arc::new(Text::new(
        c.md_heading.fg(&tui_bold("Available Commands")),
        1,
        0,
    )));
    container.add_child(Arc::new(Spacer::new(1)));

    let cmds: &[(&str, &str)] = &[
        ("/settings", "Open settings menu"),
        ("/model", "Select model (opens selector UI)"),
        ("/tree", "Navigate session tree (switch branches)"),
        ("/thinking", "Set thinking level"),
        ("/scoped-models", "Enable/disable models for Ctrl+P cycling"),
        ("/theme", "Change the color theme"),
        ("/export", "Export session (HTML default, or specify path: .html/.jsonl)"),
        ("/import", "Import and resume a session from a JSONL file"),
        ("/share", "Share session via a Radius artifact or a GitHub gist"),
        ("/copy", "Copy last agent message to clipboard"),
        ("/name", "Set session display name"),
        ("/changelog", "Show changelog entries"),
        ("/hotkeys", "Show all keyboard shortcuts"),
        ("/fork", "Create a new fork from a previous user message"),
        ("/clone", "Duplicate the current session at the current position"),
        ("/trust", "Save project trust decision for future sessions"),
        ("/login", "Configure provider authentication"),
        ("/logout", "Remove provider authentication"),
        ("/clear", "Clear the conversation"),
        ("/compact", "Manually compact the session context"),
        ("/resume", "Resume a different session"),
        ("/skills", "Browse and run a skill"),
        ("/bug", "Report a bug to the Pi developers"),
        ("/stats", "Show session info and stats"),
        ("/reload", "Reload keybindings, extensions, skills, prompts, themes, and context files"),
        ("/quit", "Quit pi"),
        ("/help", "Show this help message"),
        ("/version", "Show version information"),
    ];
    let cmd_w = cmds.iter().map(|(k, _)| k.len()).max().unwrap_or(0);
    for (cmd, desc) in cmds {
        let row = format!(
            "  {:<cmd_w$}  {}  {}",
            c.accent.fg(cmd),
            c.dim.fg("—"),
            c.muted.fg(desc)
        );
        container.add_child(Arc::new(Text::new(row, 1, 0)));
    }
    container.add_child(Arc::new(Spacer::new(1)));
}

/// Add the `/version` block to the chat container.
pub(super) fn add_version_message(container: &Arc<Container>) {
    let c = current_theme().colors;
    container.add_child(Arc::new(Text::new(
        c.md_heading.fg(&tui_bold("📦 Version Information")),
        1,
        0,
    )));
    container.add_child(Arc::new(Spacer::new(1)));
    container.add_child(Arc::new(Text::new(
        format!(
            "  {} {}",
            c.muted.fg("pi"),
            c.text.fg(&format!("v{}", crate::changelog::current_version()))
        ),
        1,
        0,
    )));
    container.add_child(Arc::new(Spacer::new(1)));
}

/// Show the release notes that ship with the port.
pub(super) fn add_changelog_message(container: &Arc<Container>) {
    let c = current_theme().colors;
    container.add_child(Arc::new(Spacer::new(1)));
    container.add_child(Arc::new(DynamicBorder::new()));
    container.add_child(Arc::new(Text::new(
        c.md_heading.fg(&tui_bold("What's New")),
        1,
        0,
    )));
    container.add_child(Arc::new(Spacer::new(1)));
    let entries = crate::changelog::bundled_entries();
    let markdown = crate::changelog::changelog_markdown(&entries);
    let markdown = if markdown.is_empty() {
        "No changelog entries found.".into()
    } else {
        markdown
    };
    container.add_child(Arc::new(Markdown::new(markdown, 1, 1)));
    container.add_child(Arc::new(DynamicBorder::new()));
}

pub(super) fn add_startup_changelog_message(
    container: &Arc<Container>,
    markdown: &str,
    version: &str,
    collapse: bool,
) {
    container.add_child(Arc::new(DynamicBorder::new()));
    if collapse {
        let latest = latest_version_in(markdown).unwrap_or_else(|| version.to_string());
        container.add_child(Arc::new(Text::new(
            format!("Updated to v{latest}. Use /changelog to view full changelog."),
            1,
            0,
        )));
    } else {
        let c = current_theme().colors;
        container.add_child(Arc::new(Text::new(
            c.md_heading.fg(&tui_bold("What's New")),
            1,
            0,
        )));
        container.add_child(Arc::new(Spacer::new(1)));
        container.add_child(Arc::new(Markdown::new(markdown.to_owned(), 1, 0)));
        container.add_child(Arc::new(Spacer::new(1)));
    }
    container.add_child(Arc::new(DynamicBorder::new()));
    container.add_child(Arc::new(Spacer::new(1)));
}

/// The version of the first release heading in a release note.
fn latest_version_in(markdown: &str) -> Option<String> {
    for line in markdown.lines() {
        let Some(rest) = line.strip_prefix("## ") else {
            continue;
        };
        let rest = rest.trim_start();
        let rest = rest.strip_prefix('[').unwrap_or(rest);
        let candidate: String = rest
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        let parts: Vec<&str> = candidate.split('.').collect();
        if parts.len() == 3 && parts.iter().all(|part| part.parse::<u64>().is_ok()) {
            return Some(candidate);
        }
        return None;
    }
    None
}

/// Add the `/hotkeys` block to the chat container.
pub(super) fn add_hotkeys_message(container: &Arc<Container>) {
    let c = current_theme().colors;
    let sections: &[(&str, &[(&[&'static str], &str)])] = &[
        (
            "Navigation",
            &[
                (
                    &[
                        "tui.editor.cursorUp",
                        "tui.editor.cursorDown",
                        "tui.editor.cursorLeft",
                        "tui.editor.cursorRight",
                    ],
                    "Move cursor / browse history",
                ),
                (
                    &["tui.editor.cursorWordLeft", "tui.editor.cursorWordRight"],
                    "Move by word",
                ),
                (&["tui.editor.cursorLineStart"], "Start of line"),
                (&["tui.editor.jumpForward"], "Jump forward to character"),
                (&["tui.editor.jumpBackward"], "Jump backward to character"),
                (
                    &["tui.editor.pageUp", "tui.editor.pageDown"],
                    "Scroll by page",
                ),
            ],
        ),
        (
            "Editing",
            &[
                (&["tui.input.submit"], "Send message"),
                (&["tui.input.newLine"], "New line"),
                (
                    &["tui.editor.deleteWordBackward"],
                    "Delete word backwards",
                ),
                (
                    &["tui.editor.deleteWordForward"],
                    "Delete word forwards",
                ),
                (
                    &["tui.editor.deleteToLineStart"],
                    "Delete to start of line",
                ),
                (&["tui.editor.deleteToLineEnd"], "Delete to end of line"),
                (
                    &["tui.editor.yank"],
                    "Paste the most-recently-deleted text",
                ),
                (
                    &["tui.editor.yankPop"],
                    "Cycle through the deleted text after pasting",
                ),
                (&["tui.editor.undo"], "Undo"),
            ],
        ),
        (
            "Other",
            &[
                (
                    &["tui.input.tab"],
                    "Path completion / accept autocomplete",
                ),
                (
                    &["app.interrupt"],
                    "Cancel autocomplete / abort streaming",
                ),
                (&["app.quit"], "Exit (press twice)"),
                (&["app.exit"], "Exit (when editor is empty)"),
                (&["app.suspend"], "Suspend to background"),
                (&["app.thinking.cycle"], "Cycle thinking level"),
                (
                    &["app.model.cycleForward", "app.model.cycleBackward"],
                    "Cycle models",
                ),
                (&["app.model.select"], "Open model selector"),
                (
                    &["app.tools.expand"],
                    "Toggle tool output expansion",
                ),
                (
                    &["app.thinking.toggle"],
                    "Toggle thinking block visibility",
                ),
                (
                    &["app.editor.external"],
                    "Edit message in external editor",
                ),
                (
                    &["app.message.copy"],
                    "Copy selection or last assistant message",
                ),
                (
                    &["app.message.followUp"],
                    "Queue follow-up message",
                ),
                (&["app.message.dequeue"], "Restore queued messages"),
                (
                    &["app.clipboard.pasteImage"],
                    "Paste files on macOS, images, or text from clipboard",
                ),
                (&["`/`"], "Slash commands"),
                (&["`!`"], "Run bash command"),
                (
                    &["`!!`"],
                    "Run bash command (excluded from context)",
                ),
            ],
        ),
    ];

    let mut markdown = String::new();
    for (title, rows) in sections {
        let mut table = String::from("| Key | Action |\n|-----|--------|\n");
        for (ids, action) in *rows {
            let keys = hotkey_keys(ids);
            if keys.is_empty() {
                continue;
            }
            table.push_str(&format!("| {keys} | {action} |\n"));
        }
        if table.lines().count() <= 2 {
            continue;
        }
        markdown.push_str(&format!("**{title}**\n{table}\n"));
    }

    container.add_child(Arc::new(Spacer::new(1)));
    container.add_child(Arc::new(DynamicBorder::new()));
    container.add_child(Arc::new(Text::new(
        c.md_heading.fg(&tui_bold("Keyboard Shortcuts")),
        1,
        0,
    )));
    container.add_child(Arc::new(Spacer::new(1)));
    container.add_child(Arc::new(Markdown::new(markdown.trim().to_string(), 1, 1)));
    container.add_child(Arc::new(DynamicBorder::new()));
}

/// The key names of a set of keybinding ids, as a markdown table cell.
fn hotkey_keys(ids: &[&'static str]) -> String {
    ids.iter()
        .map(|id| {
            if id.starts_with('`') {
                (*id).to_string()
            } else {
                format!("`{}`", rpi_tui::key_display_text(id))
            }
        })
        .filter(|text| text != "``")
        .collect::<Vec<_>>()
        .join(" / ")
}

/// Add a user message echo to the chat container — a bordered `UserMessageComponent`
/// (surface-colored box with OSC133 prompt-boundary markers) replacing the old
/// plain `> text` echo. A trailing Spacer(1) separates it from the next
// transcript entry (every entry contributes one trailing spacer so
// consecutive turns are separated by exactly one blank line).
pub(super) fn add_user_message(container: &Arc<Container>, text: &str) {
    container.add_child(Arc::new(UserMessageComponent::new(text.to_string())));
    container.add_child(Arc::new(Spacer::new(1)));
}

/// Add an error message to the chat container.
/// Collect all rendered lines from the chat container for search.
pub(super) fn collect_transcript_lines(chat_container: &Arc<Container>) -> Vec<String> {
    let width = 80; // Default width for search; actual width varies by terminal
    chat_container.render(width)
}

/// Build the shell command that resumes `session_id` in this project, or
/// `None` when there is nothing to resume. Mirrors upstream's
/// `formatResumeCommand`: `rpi --session <id>`, prefixing
/// `--session-dir <dir>` only when a non-default directory was requested.
pub(super) fn format_resume_command(
    session_id: &str,
    cwd: &std::path::Path,
    session_dir: Option<&std::path::Path>,
) -> Option<String> {
    if session_id.is_empty() {
        return None;
    }
    let mut args = vec![crate::APP_NAME.to_string()];
    if let Some(dir) = session_dir {
        let default = crate::session::default_session_dir(cwd);
        if dir != default.as_path() {
            args.push("--session-dir".to_string());
            args.push(quote_shell_arg(&dir.to_string_lossy()));
        }
    }
    args.push("--session".to_string());
    args.push(session_id.to_string());
    Some(args.join(" "))
}

/// Quote a shell argument when it contains whitespace or shell metacharacters
/// (mirrors upstream's `quoteIfNeeded`).
pub(super) fn quote_shell_arg(value: &str) -> String {
    let needs_quoting = value.is_empty()
        || value
            .chars()
            .any(|c| c.is_whitespace() || "\"'`$&|;<>()*?[]{}!~#\\".contains(c));
    if needs_quoting {
        format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

pub(super) fn add_error_message(container: &Arc<Container>, text: &str) {
    let c = current_theme().colors;
    let text = sanitize_error_message(text);
    container.add_child(Arc::new(Text::new(
        format!("  {} {}", c.error.fg("✗"), c.error.fg(&text)),
        1,
        0,
    )));
    container.add_child(Arc::new(Spacer::new(1)));
}

/// Keep provider diagnostics printable in the transcript. HTTP error bodies
/// may contain carriage returns, terminal escapes, or an unexpectedly large
/// JSON payload; letting those bytes reach the renderer can corrupt the input
/// row or make the whole frame exceed terminal limits.
pub(super) fn sanitize_error_message(text: &str) -> String {
    const MAX_ERROR_CHARS: usize = 16 * 1024;
    let mut result = String::with_capacity(text.len().min(MAX_ERROR_CHARS));
    let mut count = 0;
    // 0 = normal, 1 = escape introducer, 2 = CSI, 3 = OSC.
    let mut escape_mode = 0u8;
    for ch in text.chars() {
        if escape_mode != 0 {
            match escape_mode {
                1 if ch == '[' => escape_mode = 2,
                1 if ch == ']' => escape_mode = 3,
                1 if ch == '\x07' || ('@'..='~').contains(&ch) => escape_mode = 0,
                2 if ('@'..='~').contains(&ch) => escape_mode = 0,
                3 if ch == '\x07' => escape_mode = 0,
                _ => {}
            }
            continue;
        }
        if ch == '\x1b' {
            escape_mode = 1;
            continue;
        }
        if count >= MAX_ERROR_CHARS {
            result.push_str("…");
            break;
        }
        match ch {
            '\n' | '\t' => {
                result.push(ch);
                count += 1;
            }
            '\r' => {}
            c if c.is_control() => {}
            c => {
                result.push(c);
                count += 1;
            }
        }
    }
    if result.trim().is_empty() {
        "Provider request failed.".to_string()
    } else {
        result
    }
}

/// Add a neutral note (e.g. unsupported-command message) to the chat container.
pub(super) fn add_note_message(container: &Arc<Container>, text: &str) {
    let c = current_theme().colors;
    container.add_child(Arc::new(Text::new(
        format!("  {} {}", c.accent.fg("ℹ"), c.muted.fg(text)),
        1,
        0,
    )));
    container.add_child(Arc::new(Spacer::new(1)));
}

/// Render the `/context` panel: a transcript message listing the discovered
/// context files, skills, and prompt templates loaded for this session
/// (Part A resource discovery). Reads the shared resources snapshot, initialized
/// at startup and refreshed on reload, without awaiting the harness accessor.
///
/// Mirrors pi's context-panel intent (pi surfaces loaded resources on startup +
/// via `/reload`); here it's a transcript note rather than an overlay since the
/// resource set is refreshed after successful `/reload`s.
pub(super) fn show_context_panel(
    chat: &Arc<Container>,
    resources: &rpi_harness::types::AgentHarnessResources,
) {
    let skills = resources.skills.as_deref().unwrap_or(&[]);
    let templates = resources.prompt_templates.as_deref().unwrap_or(&[]);
    let mut lines: Vec<String> = Vec::new();
    lines.push("📂 Discovered resources for this session:".into());
    if resources.context_files.is_empty() {
        lines.push("  Context: (no context files loaded)".into());
    } else {
        lines.push(format!("  Context ({}):", resources.context_files.len()));
        lines.extend(
            resources
                .context_files
                .iter()
                .map(|path| format!("    • {path}")),
        );
    }

    if skills.is_empty() {
        lines.push(
            "  Skills: (none discovered — create .rpi/skills/ or ~/.rpi/agent/skills/)".into(),
        );
    } else {
        lines.push(format!("  Skills ({}):", skills.len()));
        for s in skills {
            let marker = if s.disable_model_invocation == Some(true) {
                " [hidden]"
            } else {
                ""
            };
            let desc: String = s.description.chars().take(72).collect();
            lines.push(format!("    • {}{marker} — {desc}", s.name));
        }
    }

    if templates.is_empty() {
        lines.push(
            "  Prompt templates: (none — create .rpi/prompts/ or ~/.rpi/agent/prompts/)".into(),
        );
    } else {
        lines.push(format!("  Prompt templates ({}):", templates.len()));
        for t in templates {
            let desc = t
                .description
                .as_deref()
                .unwrap_or("(no description)")
                .chars()
                .take(72)
                .collect::<String>();
            lines.push(format!("    • /{} — {desc}", t.name));
        }
    }
    lines.push(
        "  Use --no-skills/-ns, --no-prompt-templates/-np, --no-context-files/-nc to suppress."
            .into(),
    );
    let body = lines.join("\n");
    container_note_block(chat, &body);
}

/// Append a multi-line neutral note (header line + body) to the chat container.
pub(super) fn container_note_block(container: &Arc<Container>, body: &str) {
    for line in body.lines() {
        container.add_child(Arc::new(Text::new(line.to_string(), 1, 0)));
    }
    container.add_child(Arc::new(Spacer::new(1)));
}
