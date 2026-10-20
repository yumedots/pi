//! The agent progress hairline.
//!
//! Upstream's `components/progress-bar.ts:31` draws one row of `▔` in the
//! accent colour at the top of the screen while the agent works, growing at
//! most one cell per 100 ms against an estimate from the runs of this session.
//! It is gated by `terminal.showTerminalProgress` (default `false`).

use std::sync::{Arc, LazyLock};

use rpi_tui::agent_progress::AgentProgressBar;

static PROGRESS: LazyLock<Arc<AgentProgressBar>> =
    LazyLock::new(|| Arc::new(AgentProgressBar::new()));

/// The progress hairline of this session.
pub(super) fn progress_bar() -> &'static Arc<AgentProgressBar> {
    &PROGRESS
}

/// Show or hide the progress hairline (`terminal.showTerminalProgress`).
pub(super) fn set_progress_enabled(enabled: bool) {
    progress_bar().set_enabled(enabled);
}
