//! The `/login` menu with the animated "Sign in with Radius" option.
//!
//! Port of `packages/coding-agent/src/modes/interactive/components/radius-login-selector.ts`.
//! The shimmer is Radius-only and is not exposed to the other selectors.

use std::any::Any;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use rpi_tui::ansi::foreground_rgb;
use rpi_tui::component::Component;
use rpi_tui::theme as current_theme;
use rpi_tui::utils::truncate_to_width;

/// The four colors of the Radius logo, in the order they stream across the text.
pub(crate) const RADIUS_COLORS: [[u8; 3]; 4] = [
    [0x4d, 0x9a, 0xbf],
    [0x83, 0xcc, 0xd2],
    [0xf1, 0xbe, 0x57],
    [0xf0, 0x90, 0x82],
];

/// Width of each color band, in characters.
const CHARS_PER_COLOR: usize = 4;

/// How fast the colors travel across the text, in characters per second.
const CHARS_PER_SECOND: f64 = 10.0;

/// How often the animation asks for a new frame, in milliseconds.
const ANIMATION_FRAME_MS: u64 = 50;

/// Blend two colors; `amount` 0 keeps `from`, 1 yields `to`.
///
/// Mirrors pi's `mixColors(from, to, amount, "srgb")`: the channels are
/// interpolated linearly in sRGB and rounded to bytes.
pub(crate) fn mix_color(from: [u8; 3], to: [u8; 3], amount: f64) -> [u8; 3] {
    let amount = if amount.is_finite() {
        amount.clamp(0.0, 1.0)
    } else {
        0.0
    };
    let blend = |start: u8, end: u8| -> u8 {
        let value = start as f64 + (end as f64 - start as f64) * amount;
        value.round().clamp(0.0, 255.0) as u8
    };
    [
        blend(from[0], to[0]),
        blend(from[1], to[1]),
        blend(from[2], to[2]),
    ]
}

/// Color `text` with the Radius logo colors flowing left to right; `elapsed_ms` is the animation time.
///
/// The colors travel over the text at `CHARS_PER_SECOND` characters per second and wrap
/// around a cycle of four bands. The smoothstep blend keeps each band recognizable while
/// still blending into the next one.
pub(crate) fn radius_shimmer(text: &str, elapsed_ms: u64) -> String {
    let cycle = (RADIUS_COLORS.len() * CHARS_PER_COLOR) as f64;
    let offset = (elapsed_ms as f64 / 1000.0) * CHARS_PER_SECOND;
    let mut result = String::new();
    for (index, character) in text.chars().enumerate() {
        let position = (((index as f64 - offset) % cycle) + cycle) % cycle;
        let band = (position / CHARS_PER_COLOR as f64).floor() as usize;
        let t = position / CHARS_PER_COLOR as f64 - band as f64;
        let amount = t * t * (3.0 - 2.0 * t);
        let from = RADIUS_COLORS[band % RADIUS_COLORS.len()];
        let to = RADIUS_COLORS[(band + 1) % RADIUS_COLORS.len()];
        let mixed = mix_color(from, to, amount);
        result.push_str(&foreground_rgb(mixed[0], mixed[1], mixed[2]));
        result.push(character);
    }
    result.push_str("\x1b[39m");
    result
}

/// The `/login` selector whose Radius option shimmers in the Radius logo colors while it is selected.
pub(crate) struct RadiusLoginMenu {
    title: String,
    options: Vec<String>,
    radius_option: String,
    radius_text: String,
    selected: Mutex<usize>,
    on_select: Mutex<Option<Arc<dyn Fn(&str) + Send + Sync>>>,
    on_cancel: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
    on_frame: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
    start: Instant,
    animating: AtomicBool,
    stopped: AtomicBool,
    timer_started: AtomicBool,
}

impl RadiusLoginMenu {
    /// Build the menu. `radius_option` is the full option label, `radius_text` the leading part of it that shimmers.
    pub(crate) fn new(
        title: &str,
        options: Vec<String>,
        radius_option: String,
        radius_text: &str,
    ) -> Self {
        Self {
            title: title.to_string(),
            options,
            radius_option,
            radius_text: radius_text.to_string(),
            selected: Mutex::new(0),
            on_select: Mutex::new(None),
            on_cancel: Mutex::new(None),
            on_frame: Mutex::new(None),
            start: Instant::now(),
            animating: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
            timer_started: AtomicBool::new(false),
        }
    }

    /// Highlight the option at `index`.
    pub(crate) fn set_selected(&self, index: usize) {
        if let Ok(mut selected) = self.selected.lock() {
            *selected = index.min(self.options.len().saturating_sub(1));
        }
    }

    /// The index of the highlighted option.
    pub(crate) fn selected_index(&self) -> usize {
        self.selected.lock().map(|selected| *selected).unwrap_or(0)
    }

    /// The highlighted option.
    pub(crate) fn selected_option(&self) -> Option<String> {
        let index = self.selected_index();
        self.options.get(index).cloned()
    }

    /// Set the callback invoked with the chosen option.
    pub(crate) fn on_select(&self, callback: Arc<dyn Fn(&str) + Send + Sync>) {
        if let Ok(mut slot) = self.on_select.lock() {
            *slot = Some(callback);
        }
    }

    /// Set the callback invoked when the menu is dismissed.
    pub(crate) fn on_cancel(&self, callback: Arc<dyn Fn() + Send + Sync>) {
        if let Ok(mut slot) = self.on_cancel.lock() {
            *slot = Some(callback);
        }
    }

    /// Ask for a new frame every animation tick while the shimmer is on screen.
    ///
    /// The timer stops on select and on cancel, like the upstream interval.
    pub(crate) fn on_frame(self: &Arc<Self>, callback: Arc<dyn Fn() + Send + Sync>) {
        if let Ok(mut slot) = self.on_frame.lock() {
            *slot = Some(callback);
        }
        self.start_timer();
    }

    /// Milliseconds since the menu was created; the animation time of the shimmer.
    pub(crate) fn elapsed_ms(&self) -> u64 {
        self.start.elapsed().as_millis() as u64
    }

    /// Whether the shimmer is currently on screen.
    pub(crate) fn is_animating(&self) -> bool {
        self.animating.load(Ordering::Acquire)
    }

    /// Handle a key press: up/down move the highlight, Enter selects, Esc cancels.
    pub(crate) fn handle_key(&self, key: KeyEvent) {
        match key.code {
            KeyCode::Up => self.move_selection(-1),
            KeyCode::Down => self.move_selection(1),
            KeyCode::Char('k') if key.modifiers == KeyModifiers::NONE => self.move_selection(-1),
            KeyCode::Char('j') if key.modifiers == KeyModifiers::NONE => self.move_selection(1),
            KeyCode::Enter | KeyCode::Char('\r') => self.select_current(),
            KeyCode::Esc => self.cancel(),
            _ => {}
        }
    }

    /// Move the highlight by `delta` rows, wrapping around the list.
    fn move_selection(&self, delta: isize) {
        let len = self.options.len();
        if len == 0 {
            return;
        }
        if let Ok(mut selected) = self.selected.lock() {
            let current = *selected;
            *selected = if delta < 0 {
                if current == 0 {
                    len - 1
                } else {
                    current - 1
                }
            } else if current + 1 >= len {
                0
            } else {
                current + 1
            };
        }
    }

    /// Select the highlighted option and stop the animation.
    fn select_current(&self) {
        let Some(option) = self.selected_option() else {
            return;
        };
        self.stop_animation();
        let callback = self
            .on_select
            .lock()
            .ok()
            .and_then(|slot| slot.as_ref().map(|callback| Arc::clone(callback)));
        if let Some(callback) = callback {
            callback(&option);
        }
    }

    /// Cancel the menu and stop the animation.
    fn cancel(&self) {
        self.stop_animation();
        let callback = self
            .on_cancel
            .lock()
            .ok()
            .and_then(|slot| slot.as_ref().map(|callback| Arc::clone(callback)));
        if let Some(callback) = callback {
            callback();
        }
    }

    /// Stop the animation timer.
    fn stop_animation(&self) {
        self.animating.store(false, Ordering::Release);
        self.stopped.store(true, Ordering::Release);
    }

    /// Start the frame timer once.
    fn start_timer(self: &Arc<Self>) {
        if self
            .timer_started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }
        let weak = Arc::downgrade(self);
        let _ = std::thread::Builder::new()
            .name("rpi-radius-login".to_string())
            .spawn(move || loop {
                std::thread::sleep(Duration::from_millis(ANIMATION_FRAME_MS));
                let Some(menu) = weak.upgrade() else {
                    break;
                };
                if menu.stopped.load(Ordering::Acquire) {
                    break;
                }
                if !menu.animating.load(Ordering::Acquire) {
                    continue;
                }
                let callback = menu
                    .on_frame
                    .lock()
                    .ok()
                    .and_then(|slot| slot.as_ref().map(|callback| Arc::clone(callback)));
                if let Some(callback) = callback {
                    callback();
                }
            });
    }

    /// The rows of the menu: the title, then one line per option.
    fn base_lines(&self, width: usize) -> Vec<String> {
        let colors = current_theme().colors;
        let selected = self.selected_index();
        let mut lines = vec![colors.dim.fg(&format!("  {}", self.title))];
        for (index, option) in self.options.iter().enumerate() {
            let prefix = if index == selected { "→ " } else { "  " };
            let value = truncate_to_width(option, width.saturating_sub(4), "");
            if index == selected {
                lines.push(format!(
                    "{}{}",
                    colors.accent.fg(prefix),
                    colors.accent.fg(&value)
                ));
            } else {
                lines.push(format!("{prefix}{value}"));
            }
        }
        lines
    }
}

impl Component for RadiusLoginMenu {
    /// Render the menu, replacing the line of the selected Radius option with the animated one.
    ///
    /// When the row style changes or the label is truncated, the line no longer
    /// matches and the option renders normally.
    fn render(&self, width: usize) -> Vec<String> {
        let colors = current_theme().colors;
        let mut lines = self.base_lines(width);
        let selected_line = format!(
            "{}{}",
            colors.accent.fg("→ "),
            colors.accent.fg(&self.radius_option)
        );
        let index = lines.iter().position(|line| line == &selected_line);
        self.animating.store(index.is_some(), Ordering::Release);
        if let Some(index) = index {
            let shimmer = radius_shimmer(&self.radius_text, self.elapsed_ms());
            let tail = self
                .radius_option
                .strip_prefix(self.radius_text.as_str())
                .unwrap_or("");
            let animated = format!("{}{}{}", colors.accent.fg("→ "), shimmer, tail);
            lines[index] = truncate_to_width(&animated, width, "");
        }
        lines
    }

    fn handle_input(&self, data: &str) -> bool {
        match data {
            "\x1b[A" | "k" => {
                self.move_selection(-1);
                true
            }
            "\x1b[B" | "j" => {
                self.move_selection(1);
                true
            }
            "\r" | "\n" => {
                self.select_current();
                true
            }
            "\x1b" => {
                self.cancel();
                true
            }
            _ => false,
        }
    }

    fn invalidate(&self) {}

    fn as_any(&self) -> &dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rpi_tui::ansi::strip_ansi;

    fn options() -> Vec<String> {
        vec![
            "Sign in with Radius".to_string(),
            "Sign in with an API key".to_string(),
            "Sign out".to_string(),
        ]
    }

    fn menu() -> RadiusLoginMenu {
        RadiusLoginMenu::new(
            "Login",
            options(),
            "Sign in with Radius".to_string(),
            "Sign in with Radius",
        )
    }

    fn color_escape(color: [u8; 3]) -> String {
        foreground_rgb(color[0], color[1], color[2])
    }

    /// Count the foreground color escapes of a line, in either color mode.
    fn foreground_escapes(line: &str) -> usize {
        line.matches("\x1b[38;2;").count() + line.matches("\x1b[38;5;").count()
    }

    #[test]
    fn shimmer_keeps_the_input_characters() {
        let text = "Sign in with Radius";
        let shimmer = radius_shimmer(text, 0);
        assert_eq!(strip_ansi(&shimmer), text);
        for character in text.chars() {
            assert!(shimmer.contains(character), "missing character {character}");
        }
        assert!(shimmer.ends_with("\x1b[39m"));
    }

    #[test]
    fn shimmer_starts_with_the_radius_colors_in_order() {
        let shimmer = radius_shimmer("Sign in with Radius", 0);
        let mut positions = Vec::new();
        for color in RADIUS_COLORS.iter() {
            let escape = color_escape(*color);
            let position = shimmer
                .find(escape.as_str())
                .unwrap_or_else(|| panic!("colour {escape:?} missing from the shimmer"));
            positions.push(position);
        }
        assert!(
            positions.windows(2).all(|pair| pair[0] < pair[1]),
            "the radius colours must appear in order, got {positions:?}"
        );
        assert!(shimmer.starts_with(&format!("{}S", color_escape(RADIUS_COLORS[0]))));
    }

    #[test]
    fn shimmer_moves_with_the_clock() {
        let text = "Sign in with Radius";
        assert_ne!(radius_shimmer(text, 0), radius_shimmer(text, 500));
        assert_eq!(strip_ansi(&radius_shimmer(text, 500)), text);
    }

    #[test]
    fn shimmer_wraps_around_the_cycle() {
        let text = "Sign in with Radius";
        let cycle_ms = (RADIUS_COLORS.len() * CHARS_PER_COLOR) as u64 * 100;
        assert_eq!(radius_shimmer(text, 0), radius_shimmer(text, cycle_ms * 10));
    }

    #[test]
    fn mix_color_blends_in_srgb() {
        let from = [10, 20, 30];
        let to = [110, 120, 130];
        assert_eq!(mix_color(from, to, 0.0), from);
        assert_eq!(mix_color(from, to, 1.0), to);
        assert_eq!(mix_color(from, to, 0.5), [60, 70, 80]);
    }

    #[test]
    fn mix_color_applies_the_smoothstep_blend() {
        let from = [77, 154, 191];
        let to = [131, 204, 210];
        for t in [0.0, 0.5, 1.0] {
            let amount = t * t * (3.0 - 2.0 * t);
            let expected = [
                (from[0] as f64 + (to[0] as f64 - from[0] as f64) * amount).round() as u8,
                (from[1] as f64 + (to[1] as f64 - from[1] as f64) * amount).round() as u8,
                (from[2] as f64 + (to[2] as f64 - from[2] as f64) * amount).round() as u8,
            ];
            assert_eq!(mix_color(from, to, amount), expected);
        }
    }

    #[test]
    fn menu_marks_only_the_selected_option() {
        let menu = menu();
        menu.set_selected(1);
        let lines = menu.render(80);
        let visible: Vec<String> = lines.iter().map(|line| strip_ansi(line)).collect();
        let marked: Vec<&String> = visible.iter().filter(|line| line.contains("→ ")).collect();
        assert_eq!(marked.len(), 1, "exactly one option may carry the marker");
        assert!(marked[0].contains("Sign in with an API key"));
        assert!(visible
            .iter()
            .any(|line| line.contains("Sign in with Radius")));
    }

    #[test]
    fn menu_animates_the_selected_radius_option() {
        let menu = menu();
        menu.set_selected(0);
        let lines = menu.render(80);
        let selected = lines
            .iter()
            .find(|line| strip_ansi(line).contains("→ "))
            .expect("the selected option is marked");
        assert_eq!(strip_ansi(selected), "→ Sign in with Radius");
        assert!(
            foreground_escapes(selected) >= "Sign in with Radius".len(),
            "the shimmer colors every character, got {selected:?}"
        );
        assert!(menu.is_animating());
    }

    #[test]
    fn menu_leaves_other_options_alone() {
        let menu = menu();
        menu.set_selected(2);
        let lines = menu.render(80);
        let colors = current_theme().colors;
        let selected = lines
            .iter()
            .find(|line| strip_ansi(line).contains("→ "))
            .expect("the selected option is marked");
        assert_eq!(
            selected,
            &format!("{}{}", colors.accent.fg("→ "), colors.accent.fg("Sign out"))
        );
        assert!(!menu.is_animating());
    }

    #[test]
    fn menu_reports_the_elapsed_time() {
        let menu = menu();
        assert!(menu.elapsed_ms() < 1000);
    }

    #[test]
    fn animation_timer_requests_frames_and_stops_on_cancel() {
        let menu = Arc::new(menu());
        let frames = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = frames.clone();
        menu.on_frame(Arc::new(move || {
            counter.fetch_add(1, Ordering::AcqRel);
        }));
        menu.set_selected(0);
        let _ = menu.render(80);
        std::thread::sleep(Duration::from_millis(200));
        assert!(
            frames.load(Ordering::Acquire) > 0,
            "the animation must ask for new frames"
        );

        menu.handle_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        std::thread::sleep(Duration::from_millis(120));
        let after_cancel = frames.load(Ordering::Acquire);
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(
            frames.load(Ordering::Acquire),
            after_cancel,
            "the animation must stop on cancel"
        );
    }
}
