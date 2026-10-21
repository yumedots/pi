//! Loader component - loading indicator.
//!
//! Provides a visual loading indicator for TUI.

use std::any::Any;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use super::component::Component;

/// Canonical working-spinner frames, in order.
///
/// Shared by [`Loader`] and the editor's working indicator so both animate
/// identically. Mirrors upstream's `DEFAULT_FRAMES`.
///
/// [`Loader`]: crate::loader::Loader
pub const SPINNER_FRAMES: &[char] = &['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/// Frame interval for animated indicators. Mirrors upstream's
/// `DEFAULT_INTERVAL_MS`: one frame per 80 ms, i.e. a full 10-frame cycle every
/// 800 ms.
pub const SPINNER_FRAME_MS: u64 = 80;

/// The frame index an indicator shows after `elapsed`.
///
/// Mirrors upstream's `Loader`: the frame counter starts at zero when the
/// indicator starts and advances once per [`SPINNER_FRAME_MS`], so the frame
/// after `elapsed` is the number of whole intervals that have passed, wrapped
/// around the frame set.
pub fn spinner_frame_index(elapsed: Duration) -> usize {
    (elapsed.as_millis() as u64 / SPINNER_FRAME_MS) as usize % SPINNER_FRAMES.len()
}

/// The braille frame an indicator shows after `elapsed`.
///
/// This is upstream's rule (`spinnerFrame(now)` in
/// `packages/coding-agent/src/modes/interactive/components/spinner-sign.ts`):
/// the frame is the number of whole intervals that have passed. It is the
/// *reference* rule the frame counters below reproduce — the counters
/// themselves are advanced by a ticker, never recomputed from the clock.
pub fn spinner_frame_at(elapsed: Duration) -> char {
    SPINNER_FRAMES[spinner_frame_index(elapsed)]
}

/// The frame counter behind an animated indicator.
///
/// Mirrors upstream's `Loader.currentFrame`: the frame is a counter that the
/// indicator's ticker advances once per [`SPINNER_FRAME_MS`] interval. The
/// counter is never recomputed from the wall clock when the indicator is
/// painted — a paint that arrives late shows the frame the counter reached,
/// not the frame the clock implies.
#[derive(Debug)]
pub struct SpinnerCounter {
    frame: AtomicUsize,
    frames: Vec<char>,
}

impl SpinnerCounter {
    /// A counter over the canonical frame set.
    pub fn new() -> Self {
        Self::with_frames(SPINNER_FRAMES.to_vec())
    }

    /// A counter over a custom frame set.
    pub fn with_frames(frames: Vec<char>) -> Self {
        Self {
            frame: AtomicUsize::new(0),
            frames,
        }
    }

    /// The frame index the counter is on.
    pub fn index(&self) -> usize {
        if self.frames.is_empty() {
            return 0;
        }
        self.frame.load(Ordering::Relaxed) % self.frames.len()
    }

    /// The braille frame the counter is on.
    pub fn char(&self) -> char {
        self.frames.get(self.index()).copied().unwrap_or('⠋')
    }

    /// Advance the counter by one frame and return the index it landed on.
    pub fn advance(&self) -> usize {
        if self.frames.is_empty() {
            return 0;
        }
        (self.frame.fetch_add(1, Ordering::Relaxed) + 1) % self.frames.len()
    }

    /// The frame set the counter walks.
    pub fn frames(&self) -> &[char] {
        &self.frames
    }
}

impl Default for SpinnerCounter {
    fn default() -> Self {
        Self::new()
    }
}

/// A ticker that advances an indicator on a fixed interval.
///
/// Mirrors upstream's `Loader.setInterval(...)`: the interval callback bumps
/// the frame counter, so the animation runs at the indicator's own rate
/// instead of following the rate of the paints that happen to occur. The
/// ticker owns a thread that sleeps on a condition variable, so stopping it
/// is immediate and does not wait out the interval.
pub struct SpinnerTicker {
    stop: Arc<AtomicBool>,
    wakeup: Arc<(Mutex<bool>, Condvar)>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl SpinnerTicker {
    /// Start ticking `tick` every `interval_ms` milliseconds.
    pub fn start(interval_ms: u64, tick: impl Fn() + Send + 'static) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let wakeup = Arc::new((Mutex::new(false), Condvar::new()));
        let thread_stop = Arc::clone(&stop);
        let thread_wakeup = Arc::clone(&wakeup);
        let interval = Duration::from_millis(interval_ms.max(1));
        let handle = std::thread::Builder::new()
            .name("rpi-spinner".to_string())
            .spawn(move || {
                let (lock, condvar) = &*thread_wakeup;
                loop {
                    let guard = lock.lock().unwrap();
                    let (guard, _timed_out) = condvar.wait_timeout(guard, interval).unwrap();
                    if thread_stop.load(Ordering::Relaxed) {
                        break;
                    }
                    drop(guard);
                    tick();
                }
            })
            .ok();
        Self {
            stop,
            wakeup,
            handle,
        }
    }

    /// Stop the ticker and wait for its thread to finish.
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let (lock, condvar) = &*self.wakeup;
        *lock.lock().unwrap() = true;
        condvar.notify_all();
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for SpinnerTicker {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Loader indicator options.
#[derive(Debug, Clone)]
pub struct LoaderIndicatorOptions {
    /// Characters to cycle through for the spinner.
    pub spinner_chars: Vec<char>,
    /// Animation frame duration.
    pub frame_duration_ms: u64,
    /// Text to display next to the spinner.
    pub text: Option<String>,
}

impl Default for LoaderIndicatorOptions {
    fn default() -> Self {
        Self {
            spinner_chars: SPINNER_FRAMES.to_vec(),
            frame_duration_ms: SPINNER_FRAME_MS,
            text: None,
        }
    }
}

/// Loader component.
pub struct Loader {
    options: LoaderIndicatorOptions,
    counter: Arc<SpinnerCounter>,
    ticker: Mutex<Option<SpinnerTicker>>,
    start_time: Mutex<Option<Instant>>,
    running: Mutex<bool>,
}

impl Loader {
    /// Create a new loader.
    pub fn new() -> Self {
        Self::with_options(LoaderIndicatorOptions::default())
    }

    /// Create a loader with options.
    pub fn with_options(options: LoaderIndicatorOptions) -> Self {
        let counter = Arc::new(SpinnerCounter::with_frames(options.spinner_chars.clone()));
        let loader = Self {
            options,
            counter,
            ticker: Mutex::new(None),
            start_time: Mutex::new(None),
            running: Mutex::new(false),
        };
        loader.start_ticker();
        loader
    }

    /// Run the frame ticker, if it is not already running.
    ///
    /// The ticker advances the counter once per interval — the frame rate is
    /// the indicator's own, not the rate of the paints that happen to occur.
    fn start_ticker(&self) {
        let mut ticker = match self.ticker.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if ticker.is_some() {
            return;
        }
        let counter = Arc::clone(&self.counter);
        *ticker = Some(SpinnerTicker::start(
            self.options.frame_duration_ms,
            move || {
                counter.advance();
            },
        ));
    }

    /// Stop the frame ticker.
    fn stop_ticker(&self) {
        let mut ticker = match self.ticker.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if let Some(mut running) = ticker.take() {
            running.stop();
        }
    }

    /// Create a loader with text.
    pub fn with_text(text: &str) -> Self {
        let mut options = LoaderIndicatorOptions::default();
        options.text = Some(text.to_string());
        Self::with_options(options)
    }

    /// Start the loader animation.
    pub fn start(&self) {
        if let Ok(mut running) = self.running.lock() {
            *running = true;
        }
        if let Ok(mut start_time) = self.start_time.lock() {
            *start_time = Some(Instant::now());
        }
        self.start_ticker();
    }

    /// Stop the loader animation.
    pub fn stop(&self) {
        if let Ok(mut running) = self.running.lock() {
            *running = false;
        }
        self.stop_ticker();
    }

    /// Check if the loader is running.
    pub fn is_running(&self) -> bool {
        *self.running.lock().unwrap()
    }

    /// Get the elapsed time since the loader started.
    pub fn elapsed(&self) -> Duration {
        self.start_time
            .lock()
            .ok()
            .and_then(|t| t.map(|s| s.elapsed()))
            .unwrap_or_default()
    }

    /// Advance to the next frame.
    pub fn advance(&self) {
        self.counter.advance();
    }

    /// Get the current spinner character.
    fn current_char(&self) -> char {
        self.counter.char()
    }

    /// Set the text.
    pub fn set_text(&mut self, text: &str) {
        self.options.text = Some(text.to_string());
    }

    /// Clear the text.
    pub fn clear_text(&mut self) {
        self.options.text = None;
    }
}

impl Default for Loader {
    fn default() -> Self {
        Self::new()
    }
}

impl Component for Loader {
    fn render(&self, width: usize) -> Vec<String> {
        let spinner = self.current_char();
        let text = self.options.text.clone().unwrap_or_default();

        let elapsed = self.elapsed();
        let _ = elapsed;

        let colors = crate::theme::theme().colors;
        let line = if text.is_empty() {
            colors.accent.fg(&spinner.to_string())
        } else {
            let text_width = crate::utils::visible_width(&text);
            let max_text_width = width.saturating_sub(3);
            let display_text = if text_width > max_text_width {
                crate::utils::truncate_to_width(&text, max_text_width, "...")
            } else {
                text
            };
            format!(
                "{} {}",
                colors.accent.fg(&spinner.to_string()),
                colors.muted.fg(&display_text)
            )
        };

        // The frame comes from the counter the ticker advances — a paint does
        // not move the animation on its own.
        vec![line]
    }

    fn invalidate(&self) {
        // No cached state
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

/// Cancellable loader with a cancel callback.
pub struct CancellableLoader {
    loader: Loader,
    on_cancel: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
}

impl CancellableLoader {
    /// Create a new cancellable loader.
    pub fn new() -> Self {
        Self {
            loader: Loader::new(),
            on_cancel: Mutex::new(None),
        }
    }

    /// Create with text.
    pub fn with_text(text: &str) -> Self {
        Self {
            loader: Loader::with_text(text),
            on_cancel: Mutex::new(None),
        }
    }

    /// Set cancel callback.
    pub fn on_cancel(&self, callback: Arc<dyn Fn() + Send + Sync>) {
        if let Ok(mut cb) = self.on_cancel.lock() {
            *cb = Some(callback);
        }
    }

    /// Cancel the loader.
    pub fn cancel(&self) {
        self.loader.stop();

        if let Ok(cb) = self.on_cancel.lock() {
            if let Some(callback) = cb.as_ref() {
                callback();
            }
        }
    }

    /// Start the loader.
    pub fn start(&self) {
        self.loader.start();
    }

    /// Stop the loader.
    pub fn stop(&self) {
        self.loader.stop();
    }

    /// Check if running.
    pub fn is_running(&self) -> bool {
        self.loader.is_running()
    }

    /// Set text.
    pub fn set_text(&mut self, text: &str) {
        self.loader.set_text(text);
    }
}

impl Default for CancellableLoader {
    fn default() -> Self {
        Self::new()
    }
}

impl Component for CancellableLoader {
    fn render(&self, width: usize) -> Vec<String> {
        let lines = self.loader.render(width);

        // The original's cancellable loader shows no text of its own.
        let _ = self.is_running();

        lines
    }

    fn invalidate(&self) {
        self.loader.invalidate();
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

/// Progress loader with percentage.
pub struct ProgressLoader {
    loader: Loader,
    progress: Mutex<f32>, // 0.0 to 1.0
}

impl ProgressLoader {
    /// Create a new progress loader.
    pub fn new() -> Self {
        Self {
            loader: Loader::new(),
            progress: Mutex::new(0.0),
        }
    }

    /// Create with text.
    pub fn with_text(text: &str) -> Self {
        Self {
            loader: Loader::with_text(text),
            progress: Mutex::new(0.0),
        }
    }

    /// Set progress (0.0 to 1.0).
    pub fn set_progress(&self, progress: f32) {
        if let Ok(mut p) = self.progress.lock() {
            *p = progress.clamp(0.0, 1.0);
        }
    }

    /// Get progress.
    pub fn get_progress(&self) -> f32 {
        *self.progress.lock().unwrap()
    }

    /// Start the loader.
    pub fn start(&self) {
        self.loader.start();
    }

    /// Stop the loader.
    pub fn stop(&self) {
        self.loader.stop();
    }
}

impl Default for ProgressLoader {
    fn default() -> Self {
        Self::new()
    }
}

impl Component for ProgressLoader {
    fn render(&self, width: usize) -> Vec<String> {
        let progress = self.get_progress();
        let percent = (progress * 100.0) as usize;

        let spinner = self.loader.current_char();
        let text = self.loader.options.text.clone().unwrap_or_default();

        // Create progress bar
        let bar_width = width.saturating_sub(20).min(30);
        let filled = (bar_width as f32 * progress) as usize;
        let empty = bar_width - filled;

        let bar = format!(
            "\x1b[36m{}\x1b[44m{}\x1b[40m{}\x1b[0m {}%",
            spinner,
            "█".repeat(filled),
            "░".repeat(empty),
            percent
        );

        let line = if text.is_empty() {
            bar
        } else {
            let text_display =
                crate::utils::truncate_to_width(&text, width.saturating_sub(bar_width + 5), "...");
            format!("{} {}", text_display, bar)
        };

        // The frame comes from the counter the ticker advances — a paint does
        // not move the animation on its own.
        vec![line]
    }

    fn invalidate(&self) {
        self.loader.invalidate();
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_loader_new() {
        let loader = Loader::new();
        assert!(!loader.is_running());
    }

    #[test]
    fn the_frame_set_and_the_interval_match_the_original() {
        // upstream's `DEFAULT_FRAMES` and `DEFAULT_INTERVAL_MS`
        // (packages/tui/src/components/loader.ts).
        assert_eq!(SPINNER_FRAMES.len(), 10);
        assert_eq!(
            SPINNER_FRAMES.iter().collect::<String>(),
            "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
        );
        assert_eq!(SPINNER_FRAME_MS, 80);
    }

    #[test]
    fn the_frame_counter_advances_by_ticks_not_by_the_clock() {
        let counter = SpinnerCounter::new();

        // Three intervals have passed, so the counter is on the fourth frame.
        counter.advance();
        counter.advance();
        counter.advance();
        assert_eq!(counter.index(), 3);
        assert_eq!(counter.char(), SPINNER_FRAMES[3]);

        // The wall clock never moved, so a clock-driven frame would still be
        // on the first frame. The counter is what decides.
        assert_eq!(spinner_frame_index(Duration::ZERO), 0);
        assert_ne!(counter.index(), spinner_frame_index(Duration::ZERO));

        // The counter wraps around the frame set.
        for _ in 0..SPINNER_FRAMES.len() {
            counter.advance();
        }
        assert_eq!(counter.index(), 3);
    }

    #[test]
    fn the_ticker_advances_the_counter_on_its_own() {
        let counter = Arc::new(SpinnerCounter::new());
        let ticked = Arc::clone(&counter);
        let mut ticker = SpinnerTicker::start(10, move || {
            ticked.advance();
        });

        // The ticker runs without a paint: the frame moves on its own.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while counter.index() == 0 && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert_ne!(counter.index(), 0, "the ticker must advance the frame");

        // Stopping it stops the animation.
        ticker.stop();
        let settled = counter.index();
        std::thread::sleep(std::time::Duration::from_millis(60));
        assert_eq!(counter.index(), settled, "a stopped ticker must not advance");
    }

    #[test]
    fn a_paint_does_not_move_the_loader_frame() {
        let loader = Loader::with_text("Loading...");
        loader.stop();
        let before = loader.current_char();
        let _ = loader.render(40);
        assert_eq!(loader.current_char(), before);
    }

    #[test]
    fn test_loader_start_stop() {
        let loader = Loader::new();
        loader.start();
        assert!(loader.is_running());
        loader.stop();
        assert!(!loader.is_running());
    }

    #[test]
    fn test_loader_render() {
        let loader = Loader::with_text("Loading...");
        loader.start();
        let lines = loader.render(40);
        assert!(!lines.is_empty());
        assert!(lines[0].contains("Loading"));
    }

    #[test]
    fn test_cancellable_loader() {
        let loader = CancellableLoader::new();
        let cancelled = Arc::new(Mutex::new(false));
        let cancelled_clone = cancelled.clone();

        loader.on_cancel(Arc::new(move || {
            *cancelled_clone.lock().unwrap() = true;
        }));

        loader.cancel();
        assert!(*cancelled.lock().unwrap());
    }

    #[test]
    fn test_progress_loader() {
        let loader = ProgressLoader::new();
        loader.set_progress(0.5);
        assert_eq!(loader.get_progress(), 0.5);
    }
}
