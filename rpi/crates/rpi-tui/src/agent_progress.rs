//! Progress bar for the agent run.
//!
//! Port of `packages/coding-agent/src/modes/interactive/components/progress-bar.ts`.
//!
//! The bar is a hairline along the top of the row. It fills with the time the
//! run has taken, against an estimate from the runs of this session. The
//! estimate is a guess, so the bar never claims to be done before the run
//! ends: it stops at 95% and creeps towards the end.

use std::any::Any;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::component::Component;
use crate::theme::theme;

/// Expected duration of a run until the session has measured one.
pub const DEFAULT_ESTIMATE_MS: u64 = 15_000;
/// How many finished runs the estimate is based on.
pub const ESTIMATE_SAMPLES: usize = 5;
/// The bar stops short of the end while the run is still going.
pub const RUNNING_MAX_FRACTION: f64 = 0.95;
/// How long the finished bar stays on the screen.
pub const DONE_HOLD_MS: u64 = 800;
/// How often the bar updates while a run is going.
pub const TICK_MS: u64 = 100;
/// How many cells the bar may grow per tick.
pub const MAX_CELLS_PER_TICK: usize = 1;

/// The hairline character of the bar (U+2594).
const BAR_CHAR: char = '\u{2594}';

/// The mutable state of the bar.
#[derive(Debug, Default)]
struct ProgressState {
    enabled: bool,
    running: bool,
    done: bool,
    started_at: Option<Instant>,
    finished_at: Option<Instant>,
    /// The durations of the finished runs of this session.
    durations: Vec<u64>,
    /// The cells the bar covers on the screen.
    cells: usize,
    /// The width of the last render.
    width: usize,
}

/// A progress bar for the agent run.
pub struct AgentProgressBar {
    state: Mutex<ProgressState>,
}

impl AgentProgressBar {
    /// Create a disabled progress bar.
    pub fn new() -> Self {
        Self {
            state: Mutex::new(ProgressState::default()),
        }
    }

    /// Show or hide the bar.
    pub fn set_enabled(&self, enabled: bool) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        if state.enabled == enabled {
            return;
        }
        state.enabled = enabled;
        if !enabled {
            reset(&mut state);
        }
    }

    /// Whether the bar is enabled.
    pub fn is_enabled(&self) -> bool {
        self.state.lock().map(|s| s.enabled).unwrap_or(false)
    }

    /// Whether a run is in progress.
    pub fn is_running(&self) -> bool {
        self.state.lock().map(|s| s.running).unwrap_or(false)
    }

    /// Start a run. A run that is already going keeps its progress.
    pub fn start(&self) {
        self.start_at(Instant::now());
    }

    /// Start a run at a given instant.
    pub fn start_at(&self, at: Instant) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        if !state.enabled || state.running {
            return;
        }
        state.running = true;
        state.done = false;
        state.cells = 0;
        state.started_at = Some(at);
        state.finished_at = None;
    }

    /// Finish the run and show the full bar for a moment.
    pub fn complete(&self) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        if !state.enabled || !state.running {
            return;
        }
        state.running = false;
        state.done = true;
        state.finished_at = Some(Instant::now());
        state.cells = state.width;
        let duration = state
            .started_at
            .map(|started| started.elapsed().as_millis() as u64)
            .unwrap_or(0);
        state.durations.push(duration);
        if state.durations.len() > ESTIMATE_SAMPLES {
            state.durations.remove(0);
        }
    }

    /// Record the duration of a finished run, so the estimate gets better.
    pub fn record_duration(&self, ms: u64) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        state.durations.push(ms);
        if state.durations.len() > ESTIMATE_SAMPLES {
            state.durations.remove(0);
        }
    }

    /// The milliseconds the current run has taken.
    pub fn elapsed_ms(&self) -> u64 {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.started_at.map(|started| started.elapsed().as_millis() as u64))
            .unwrap_or(0)
    }

    /// The cells the bar currently covers.
    pub fn cells(&self) -> usize {
        self.state.lock().map(|s| s.cells).unwrap_or(0)
    }

    /// The estimate the bar grows against: the median of the last runs.
    pub fn estimate_ms(&self) -> u64 {
        self.state
            .lock()
            .map(|state| estimate(&state.durations))
            .unwrap_or(DEFAULT_ESTIMATE_MS)
    }

    /// Advance the bar by one tick.
    ///
    /// Moves the bar towards the real progress and clears it once the
    /// done-hold has elapsed.
    pub fn tick(&self) {
        self.tick_at(Instant::now());
    }

    /// Advance the bar by one tick at a given instant.
    pub fn tick_at(&self, now: Instant) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        if state.done {
            if let Some(finished) = state.finished_at {
                if now.duration_since(finished) >= Duration::from_millis(DONE_HOLD_MS) {
                    reset(&mut state);
                    return;
                }
            }
        }
        advance(&mut state, now);
    }
}

impl Default for AgentProgressBar {
    fn default() -> Self {
        Self::new()
    }
}

/// Clear the bar.
fn reset(state: &mut ProgressState) {
    state.running = false;
    state.done = false;
    state.cells = 0;
    state.started_at = None;
    state.finished_at = None;
}

/// The median of the recorded durations.
fn estimate(durations: &[u64]) -> u64 {
    if durations.is_empty() {
        return DEFAULT_ESTIMATE_MS;
    }
    let mut sorted = durations.to_vec();
    sorted.sort_unstable();
    let median = sorted[sorted.len() / 2];
    if median == 0 {
        return DEFAULT_ESTIMATE_MS;
    }
    median
}

/// How far the bar has progressed, between 0 and 1.
fn fraction(state: &ProgressState, now: Instant) -> f64 {
    let Some(started) = state.started_at else {
        return 0.0;
    };
    let elapsed = now.duration_since(started).as_millis() as u64;
    let estimate = estimate(&state.durations);
    if elapsed <= estimate {
        return (elapsed as f64 / estimate as f64) * RUNNING_MAX_FRACTION;
    }
    let over = (elapsed - estimate) as f64 / estimate as f64;
    RUNNING_MAX_FRACTION + (1.0 - RUNNING_MAX_FRACTION) * (1.0 - (-over).exp())
}

/// Move the bar towards the real progress without jumping.
fn advance(state: &mut ProgressState, now: Instant) {
    if !state.running {
        return;
    }
    let target = (fraction(state, now) * state.width as f64).round() as usize;
    if target > state.cells {
        state.cells = target.min(state.cells + MAX_CELLS_PER_TICK);
    }
}

impl Component for AgentProgressBar {
    fn render(&self, width: usize) -> Vec<String> {
        let Ok(mut state) = self.state.lock() else {
            return Vec::new();
        };
        if !state.enabled || (!state.running && !state.done) {
            return Vec::new();
        }
        state.width = width;
        let filled = state.cells.min(width);
        if filled == 0 {
            return vec![String::new()];
        }
        vec![theme().colors.accent.fg(&BAR_CHAR.to_string().repeat(filled))]
    }

    fn invalidate(&self) {
        // No cached state.
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strip(text: &str) -> String {
        crate::ansi::strip_ansi(text)
    }

    #[test]
    fn test_disabled_bar_renders_nothing() {
        let bar = AgentProgressBar::new();
        assert!(!bar.is_enabled());
        assert!(bar.render(40).is_empty());
    }

    #[test]
    fn test_enabled_but_idle_bar_renders_nothing() {
        let bar = AgentProgressBar::new();
        bar.set_enabled(true);
        assert!(bar.is_enabled());
        assert!(bar.render(40).is_empty());
    }

    #[test]
    fn test_started_bar_without_cells_renders_an_empty_line() {
        let bar = AgentProgressBar::new();
        bar.set_enabled(true);
        bar.start();
        let lines = bar.render(40);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0], "");
    }

    #[test]
    fn test_bar_grows_by_at_most_one_cell_per_tick() {
        let bar = AgentProgressBar::new();
        bar.set_enabled(true);
        bar.start_at(Instant::now() - Duration::from_secs(1));
        bar.render(40);

        let mut previous = bar.cells();
        for _ in 0..50 {
            bar.tick();
            let cells = bar.cells();
            assert!(
                cells <= previous + MAX_CELLS_PER_TICK,
                "the bar grew by more than one cell: {previous} -> {cells}"
            );
            previous = cells;
        }
    }

    #[test]
    fn test_bar_stays_below_the_running_maximum() {
        let bar = AgentProgressBar::new();
        bar.set_enabled(true);
        bar.start_at(Instant::now() - Duration::from_secs(1));
        bar.render(40);

        for _ in 0..100 {
            bar.tick();
        }
        let max = (RUNNING_MAX_FRACTION * 40.0).round() as usize;
        assert!(
            bar.cells() <= max,
            "the bar grew past 95% of the width: {} > {max}",
            bar.cells()
        );
    }

    #[test]
    fn test_completed_bar_is_full() {
        let bar = AgentProgressBar::new();
        bar.set_enabled(true);
        bar.start();
        bar.render(40);
        bar.complete();
        let lines = bar.render(40);
        assert_eq!(lines.len(), 1);
        let plain = strip(&lines[0]);
        assert_eq!(plain.chars().count(), 40);
        assert!(plain.chars().all(|c| c == '\u{2594}'));
    }

    #[test]
    fn test_bar_is_cleared_after_the_done_hold() {
        let bar = AgentProgressBar::new();
        bar.set_enabled(true);
        bar.start();
        bar.render(40);
        bar.complete();
        bar.tick_at(Instant::now() + Duration::from_millis(DONE_HOLD_MS + 10));
        assert!(bar.render(40).is_empty());
        assert_eq!(bar.cells(), 0);
    }

    #[test]
    fn test_recorded_duration_shortens_the_estimate() {
        let bar = AgentProgressBar::new();
        assert_eq!(bar.estimate_ms(), DEFAULT_ESTIMATE_MS);
        bar.record_duration(1_000);
        assert_eq!(bar.estimate_ms(), 1_000);
    }

    #[test]
    fn test_short_estimate_makes_the_bar_advance_faster() {
        let slow = AgentProgressBar::new();
        slow.set_enabled(true);
        slow.start_at(Instant::now() - Duration::from_secs(1));
        slow.render(40);

        let fast = AgentProgressBar::new();
        fast.set_enabled(true);
        fast.record_duration(500);
        fast.start_at(Instant::now() - Duration::from_secs(1));
        fast.render(40);

        for _ in 0..20 {
            slow.tick();
            fast.tick();
        }
        assert!(
            fast.cells() > slow.cells(),
            "the faster estimate must grow the bar further: {} vs {}",
            fast.cells(),
            slow.cells()
        );
    }

    #[test]
    fn test_bar_char_is_u_2594() {
        assert_eq!(BAR_CHAR, '\u{2594}');
        assert_eq!(BAR_CHAR as u32, 0x2594);
    }

    #[test]
    fn test_disabling_the_bar_clears_it() {
        let bar = AgentProgressBar::new();
        bar.set_enabled(true);
        bar.start();
        bar.render(40);
        bar.tick();
        bar.set_enabled(false);
        assert!(bar.render(40).is_empty());
        assert_eq!(bar.cells(), 0);
    }
}
