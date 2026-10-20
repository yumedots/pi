//! The terminal window title, in pi's format.
//!
//! The original sets it once, when the interactive mode starts
//! (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:1232-1236`):
//!
//! ```text
//! π - <session name> - <cwd base name>
//! π - <cwd base name>
//! ```
//!
//! `APP_TITLE` is the literal `π` (`packages/coding-agent/src/config.ts:588`).
//! There is no activity glyph in pi's title: the working state is shown in the
//! status dock, not in the tab.

use std::path::Path;

/// pi's application title (`packages/coding-agent/src/config.ts:588`).
pub const APP_TITLE: &str = "π";

/// The window title for a session.
///
/// `session_name` is the session's name, when it has one. `cwd` is the working
/// directory; only its last path segment is shown.
pub fn window_title(session_name: Option<&str>, cwd: &Path) -> String {
	let base = cwd
		.file_name()
		.map(|name| name.to_string_lossy().into_owned())
		.unwrap_or_default();
	match session_name {
		Some(name) if !name.is_empty() => format!("{APP_TITLE} - {name} - {base}"),
		_ => format!("{APP_TITLE} - {base}"),
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::path::PathBuf;

	#[test]
	fn the_title_is_the_app_title_and_the_cwd() {
		assert_eq!(
			window_title(None, &PathBuf::from("/Users/gabriel/pi")),
			"π - pi"
		);
	}

	#[test]
	fn the_title_carries_the_session_name() {
		assert_eq!(
			window_title(Some("refactor"), &PathBuf::from("/Users/gabriel/pi")),
			"π - refactor - pi"
		);
	}

	#[test]
	fn an_empty_session_name_is_the_same_as_no_name() {
		assert_eq!(
			window_title(Some(""), &PathBuf::from("/Users/gabriel/pi")),
			"π - pi"
		);
	}
}
