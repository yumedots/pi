//! First-launch setup: the theme picker the original shows on the very first
//! run (`packages/coding-agent/src/modes/interactive/components/first-time-setup.ts`).
//!
//! Kept out of the library crate so rpi-tui stays cli-free (project constraint).

use std::sync::Arc;

use rpi_tui::{apply_theme_preset, FirstRunDialog, FirstRunOption, ThemeManager, ThemePreset};

use crate::config;

/// Path of the "first-time setup done" sentinel, under the agent dir
/// (`~/.rpi/agent/.setup_done`).
pub fn setup_done_path() -> Option<std::path::PathBuf> {
    config::agent_dir().ok().map(|d| d.join(".setup_done"))
}

/// Whether first-time setup has already been completed (sentinel present).
pub fn setup_done() -> bool {
    setup_done_path().map(|p| p.exists()).unwrap_or(false)
}

/// Mark first-time setup complete (write the sentinel). Best-effort.
pub fn mark_setup_done() -> std::io::Result<()> {
    let path = setup_done_path().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "no home dir for .rpi/agent")
    })?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, b"1")
}

/// Whether the theme picker still has to run.
///
/// The original shows it on a fresh install only: an agent directory that
/// already holds a settings file is an existing profile, so the picker would
/// interrupt a returning user.
pub fn first_run_pending() -> bool {
    !setup_done()
        && !config::settings_path()
            .map(|path| path.exists())
            .unwrap_or(false)
}

/// The themes the picker offers, in the order the original lists them.
fn theme_options() -> Vec<FirstRunOption> {
    vec![
        FirstRunOption::new(
            "system",
            "System (follows the terminal's light or dark mode)",
        ),
        FirstRunOption::new("dark", "Dark"),
        FirstRunOption::new("light", "Light"),
    ]
}

fn preset_for(value: &str) -> Option<ThemePreset> {
    match value {
        "dark" => Some(ThemePreset::Dark),
        "light" => Some(ThemePreset::Light),
        "monochrome" => Some(ThemePreset::Monochrome),
        _ => None,
    }
}

/// The first-run theme picker, or `None` when the setup already ran.
///
/// Moving the cursor previews the theme, confirming saves it, and either way
/// the setup is marked done so it never comes back.
pub fn first_run_dialog(theme_manager: &Arc<ThemeManager>) -> Option<Arc<FirstRunDialog>> {
    if !first_run_pending() {
        return None;
    }
    let dialog = Arc::new(FirstRunDialog::new(theme_options()));
    let preview_manager = theme_manager.clone();
    dialog.on_preview(move |option| {
        match preset_for(&option.value) {
            Some(preset) => {
                apply_theme_preset(preset);
                preview_manager.apply_preset(preset);
            }
            None => {
                preview_manager.follow_terminal();
                rpi_tui::global_theme_manager().follow_terminal();
            }
        }
    });
    let submit_manager = theme_manager.clone();
    dialog.on_submit(move |option| {
        let mut settings = crate::settings::load_settings().unwrap_or_default();
        match preset_for(&option.value) {
            Some(preset) => {
                apply_theme_preset(preset);
                submit_manager.apply_preset(preset);
                settings.theme = Some(option.value.clone());
            }
            None => {
                submit_manager.follow_terminal();
                rpi_tui::global_theme_manager().follow_terminal();
                settings.theme = None;
            }
        }
        let _ = crate::settings::save_settings(&settings);
        let _ = mark_setup_done();
    });
    dialog.on_cancel(|| {
        let _ = mark_setup_done();
    });
    Some(dialog)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rpi_tui::Component;

    #[test]
    fn test_sentinel_paths_under_agent_dir() {
        // The sentinel lives directly under the resolved agent dir and honors
        // the `RPI_CODING_AGENT_DIR` override (delegated to `config::agent_dir`).
        let _guard = crate::config::test_support::env_lock().lock().unwrap();
        let prev = std::env::var_os(crate::config::CONFIG_DIR_ENV);
        let tmp = tempfile::TempDir::new().unwrap();
        std::env::set_var(crate::config::CONFIG_DIR_ENV, tmp.path());
        let agent = crate::config::agent_dir().unwrap();
        assert_eq!(agent.as_path(), tmp.path());
        if let Some(p) = setup_done_path() {
            assert!(p.ends_with(".setup_done"));
            assert_eq!(p.parent().unwrap(), agent);
        }
        match prev {
            Some(v) => std::env::set_var(crate::config::CONFIG_DIR_ENV, v),
            None => std::env::remove_var(crate::config::CONFIG_DIR_ENV),
        }
    }

    #[test]
    fn first_run_is_pending_without_a_sentinel_or_settings() {
        let _guard = crate::config::test_support::env_lock().lock().unwrap();
        let prev = std::env::var_os(crate::config::CONFIG_DIR_ENV);
        let tmp = tempfile::TempDir::new().unwrap();
        std::env::set_var(crate::config::CONFIG_DIR_ENV, tmp.path());
        assert!(first_run_pending());
        std::fs::write(tmp.path().join("settings.json"), "{}").unwrap();
        assert!(!first_run_pending());
        match prev {
            Some(v) => std::env::set_var(crate::config::CONFIG_DIR_ENV, v),
            None => std::env::remove_var(crate::config::CONFIG_DIR_ENV),
        }
    }

    #[test]
    fn the_picker_prints_every_line_once() {
        let _guard = crate::config::test_support::env_lock().lock().unwrap();
        let prev = std::env::var_os(crate::config::CONFIG_DIR_ENV);
        let tmp = tempfile::TempDir::new().unwrap();
        std::env::set_var(crate::config::CONFIG_DIR_ENV, tmp.path());
        let dialog = first_run_dialog(&Arc::new(ThemeManager::new())).expect("fresh profile");
        let plain = rpi_tui::strip_ansi(&dialog.render(80).join("\n"));
        assert_eq!(plain.matches("Welcome to pi").count(), 1, "{plain}");
        assert_eq!(plain.matches("Pick a theme.").count(), 1, "{plain}");
        assert_eq!(plain.matches("Dark").count(), 1, "{plain}");
        assert_eq!(plain.matches("Light").count(), 1, "{plain}");
        assert_eq!(plain.matches("System (follows").count(), 1, "{plain}");
        match prev {
            Some(v) => std::env::set_var(crate::config::CONFIG_DIR_ENV, v),
            None => std::env::remove_var(crate::config::CONFIG_DIR_ENV),
        }
    }

    #[test]
    fn an_existing_profile_gets_no_picker() {
        let _guard = crate::config::test_support::env_lock().lock().unwrap();
        let prev = std::env::var_os(crate::config::CONFIG_DIR_ENV);
        let tmp = tempfile::TempDir::new().unwrap();
        std::env::set_var(crate::config::CONFIG_DIR_ENV, tmp.path());
        std::fs::write(tmp.path().join("settings.json"), "{}").unwrap();
        assert!(first_run_dialog(&Arc::new(ThemeManager::new())).is_none());
        match prev {
            Some(v) => std::env::set_var(crate::config::CONFIG_DIR_ENV, v),
            None => std::env::remove_var(crate::config::CONFIG_DIR_ENV),
        }
    }
}
