//! ANSI escape code utilities and visible width calculations.
//!
//! Handles ANSI-aware string manipulation for terminal rendering.

use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

/// Cursor position marker - APC sequence.
/// This is a zero-width escape sequence that terminals ignore.
pub const CURSOR_MARKER: &str = "\x1b_pi:c\x07";

/// Fake cursor markers - zero-width APC sequences around the cell drawn as the
/// caret. The TUI turns them into reverse video, or drops them when the
/// hardware cursor already sits on the cell.
pub const FAKE_CURSOR_START: &str = "\x1b_pi:fc\x07";
pub const FAKE_CURSOR_END: &str = "\x1b_pi:/fc\x07";

/// Calculate the visible width of a string, ignoring ANSI escape sequences.
///
/// This is the number of terminal columns the string will occupy.
pub fn visible_width(s: &str) -> usize {
    if s.is_ascii() && !s.contains('\x1b') {
        return s.chars().filter(|c| !c.is_control()).count();
    }
    let stripped = strip_ansi(s);
    UnicodeWidthStr::width(stripped.as_str())
}

/// Strip ANSI escape sequences from a string.
pub fn strip_ansi(s: &str) -> String {
    // Simple ANSI stripping - removes escape sequences
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // Cursor markers are private escape sequences, not ANSI CSI/OSC
            // sequences. Treat the complete marker as zero-width; otherwise
            // the old logic skipped only `\\x1b_` and counted `pi:c` as text,
            // making the hardware cursor jump several columns when moving.
            let mut marker_tail = chars.clone();
            let marker = ['_', 'p', 'i', ':', 'c', '\x07'];
            let is_cursor_marker = marker
                .iter()
                .all(|expected| marker_tail.next() == Some(*expected));
            if is_cursor_marker {
                chars = marker_tail;
                continue;
            }

            // Start of escape sequence
            match chars.peek() {
                Some('[') => {
                    chars.next(); // consume '['
                                  // CSI sequence: skip until final byte (0x40-0x7E)
                    while let Some(&c) = chars.peek() {
                        chars.next();
                        if (c as u8) >= 0x40 && (c as u8) <= 0x7E {
                            break;
                        }
                    }
                }
                Some(']' | '_' | 'P' | '^') => {
                    chars.next(); // consume ']'
                                  // OSC sequence: skip until BEL (0x07) or ST (ESC \)
                    while let Some(&c) = chars.peek() {
                        chars.next();
                        if c == '\x07' {
                            break;
                        }
                        if c == '\x1b' {
                            if let Some('\\') = chars.peek() {
                                chars.next();
                                break;
                            }
                        }
                    }
                }
                Some('(' | ')') => {
                    chars.next(); // consume '(' or ')'
                                  // Character set designation: skip one more char
                    chars.next();
                }
                Some(_) => {
                    // Other escape sequences: skip next char
                    chars.next();
                }
                None => break,
            }
        } else {
            result.push(c);
        }
    }

    result
}

/// Slice a string by visible column positions.
///
/// Returns a substring that starts at `start_col` and has at most `width` visible columns.
/// The escape sequences inside the slice are kept, and the ones that were active
/// before it are kept too when `preserve_styles` is set, so a styled row does
/// not lose its colour when it is clipped.
pub fn slice_by_column(s: &str, start_col: usize, width: usize, preserve_styles: bool) -> String {
    if width == 0 {
        return String::new();
    }

    let end_col = start_col + width;
    let mut result = String::new();
    let mut pending = String::new();
    let mut col = 0usize;
    let mut rest = s;

    while !rest.is_empty() {
        if let Some((escape, remainder)) = crate::utils::take_escape_sequence(rest) {
            if col >= start_col {
                result.push_str(&pending);
                pending.clear();
                result.push_str(escape);
            } else if preserve_styles {
                pending.push_str(escape);
            }
            rest = remainder;
            continue;
        }
        let grapheme = rest.graphemes(true).next().unwrap_or_default();
        let grapheme_width = UnicodeWidthStr::width(grapheme);
        if col >= start_col && col < end_col {
            result.push_str(&pending);
            pending.clear();
            result.push_str(grapheme);
        }
        col += grapheme_width;
        rest = &rest[grapheme.len()..];
    }

    result
}

/// Normalize terminal output by resetting styles at line ends.
pub fn normalize_terminal_output(line: &str) -> String {
    // Reset at end of line
    if line.contains("\x1b[") && !line.ends_with("\x1b[0m") {
        format!("{}\x1b[0m", line)
    } else {
        line.to_string()
    }
}

/// Create a hyperlink using OSC 8.
pub fn hyperlink(url: &str, text: &str) -> String {
    format!("\x1b]8;;{}\x07{}\x1b]8;;\x07", url, text)
}

/// How colors reach the terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorMode {
    /// 24-bit color: `38;2;r;g;b`.
    TrueColor,
    /// 256-color palette: `38;5;n`.
    Ansi256,
}

/// Color mode override: 0 = detect, 1 = truecolor, 2 = 256-color.
static COLOR_MODE_OVERRIDE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

/// The color mode the terminal gets.
///
/// Detected like pi's `getTerminalColorMode()`: a truecolor hint in the
/// environment, or a terminal known to support 24-bit color.
pub fn color_mode() -> ColorMode {
    match COLOR_MODE_OVERRIDE.load(std::sync::atomic::Ordering::Acquire) {
        1 => ColorMode::TrueColor,
        2 => ColorMode::Ansi256,
        _ => *COLOR_MODE,
    }
}

/// Force the color mode, overriding the detection.
pub fn set_color_mode(mode: ColorMode) {
    let value = match mode {
        ColorMode::TrueColor => 1,
        ColorMode::Ansi256 => 2,
    };
    COLOR_MODE_OVERRIDE.store(value, std::sync::atomic::Ordering::Release);
}

/// Drop the color mode override and go back to the detected mode.
pub fn reset_color_mode() {
    COLOR_MODE_OVERRIDE.store(0, std::sync::atomic::Ordering::Release);
}

static COLOR_MODE: std::sync::LazyLock<ColorMode> =
    std::sync::LazyLock::new(|| {
        if terminal_supports_true_color() {
            ColorMode::TrueColor
        } else {
            ColorMode::Ansi256
        }
    });

/// Whether the terminal supports 24-bit color.
///
/// Mirrors pi's `detectCapabilitiesFromEnvironment`: a truecolor hint in the
/// environment, or a terminal known to support 24-bit color. Under tmux and
/// screen only the hint counts.
fn terminal_supports_true_color() -> bool {
    if let Ok(value) = std::env::var("PI_TRUE_COLOR") {
        if value == "1" {
            return true;
        }
        if value == "0" {
            return false;
        }
    }
    let term_program = env_var_lower("TERM_PROGRAM");
    let terminal_emulator = env_var_lower("TERMINAL_EMULATOR");
    let term = env_var_lower("TERM");
    let color_term = env_var_lower("COLORTERM");
    let hint = color_term == "truecolor" || color_term == "24bit" || term.ends_with("-direct");
    if std::env::var_os("TMUX").is_some() || term.starts_with("tmux") {
        return hint;
    }
    if term.starts_with("screen") {
        return hint;
    }
    if term_program == "herdr" {
        return true;
    }
    if std::env::var_os("KITTY_WINDOW_ID").is_some() || term_program == "kitty" {
        return true;
    }
    if term_program == "ghostty" || term.contains("ghostty") {
        return true;
    }
    if std::env::var_os("WEZTERM_PANE").is_some() || term_program == "wezterm" {
        return true;
    }
    if term_program == "warpterminal" || std::env::var_os("WARP_SESSION_ID").is_some() {
        return true;
    }
    if std::env::var_os("ITERM_SESSION_ID").is_some() || term_program == "iterm.app" {
        return true;
    }
    if std::env::var_os("WT_SESSION").is_some() {
        return true;
    }
    if matches!(term_program.as_str(), "alacritty" | "vscode" | "zed") {
        return true;
    }
    if terminal_emulator == "jetbrains-jediterm" {
        return true;
    }
    if cfg!(target_os = "windows") {
        return true;
    }
    hint
}

/// Read an environment variable, lowercased.
fn env_var_lower(name: &str) -> String {
    std::env::var(name)
        .unwrap_or_default()
        .to_lowercase()
}

/// The escape sequence that starts a foreground color.
pub fn foreground_rgb(r: u8, g: u8, b: u8) -> String {
    match color_mode() {
        ColorMode::TrueColor => format!("\x1b[38;2;{};{};{}m", r, g, b),
        ColorMode::Ansi256 => format!("\x1b[38;5;{}m", rgb_to_ansi256(r, g, b)),
    }
}

/// The escape sequence that starts a background color.
pub fn background_rgb(r: u8, g: u8, b: u8) -> String {
    match color_mode() {
        ColorMode::TrueColor => format!("\x1b[48;2;{};{};{}m", r, g, b),
        ColorMode::Ansi256 => format!("\x1b[48;5;{}m", rgb_to_ansi256(r, g, b)),
    }
}

/// The xterm-256 palette index closest to a color.
///
/// Pi's own rounding (`packages/tui/src/colors.ts`): the closest cube color,
/// unless the color is nearly grey and the grey ramp is closer.
pub fn rgb_to_ansi256(r: u8, g: u8, b: u8) -> u8 {
    const CUBE: [f64; 6] = [0.0, 95.0, 135.0, 175.0, 215.0, 255.0];
    let grays: Vec<f64> = (0..24).map(|index| 8.0 + 10.0 * index as f64).collect();
    let (r, g, b) = (r as f64, g as f64, b as f64);
    let r_index = find_closest(&CUBE, r);
    let g_index = find_closest(&CUBE, g);
    let b_index = find_closest(&CUBE, b);
    let cube = (CUBE[r_index], CUBE[g_index], CUBE[b_index]);
    let gray = (0.299 * r + 0.587 * g + 0.114 * b).round();
    let gray_offset = find_closest(&grays, gray);
    let gray_value = grays[gray_offset];
    let spread = r.max(g).max(b) - r.min(g).min(b);
    if spread < 10.0 && color_distance(r, g, b, gray_value, gray_value, gray_value)
        < color_distance(r, g, b, cube.0, cube.1, cube.2)
    {
        return 232 + gray_offset as u8;
    }
    (16 + 36 * r_index + 6 * g_index + b_index) as u8
}

/// Index of the value closest to the target.
fn find_closest(values: &[f64], target: f64) -> usize {
    let mut closest = 0;
    let mut distance = f64::INFINITY;
    for (index, value) in values.iter().enumerate() {
        let candidate = (target - value).abs();
        if candidate < distance {
            closest = index;
            distance = candidate;
        }
    }
    closest
}

/// Weighted distance between two colors.
fn color_distance(r: f64, g: f64, b: f64, other_r: f64, other_g: f64, other_b: f64) -> f64 {
    let dr = r - other_r;
    let dg = g - other_g;
    let db = b - other_b;
    dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114
}

/// Apply a foreground color using ANSI 256-color mode.
pub fn fg_256(color: u8, text: &str) -> String {
    format!("\x1b[38;5;{}m{}\x1b[39m", color, text)
}

/// Apply a background color using ANSI 256-color mode.
pub fn bg_256(color: u8, text: &str) -> String {
    format!("\x1b[48;5;{}m{}\x1b[49m", color, text)
}

/// Apply a foreground color using RGB.
pub fn fg_rgb(r: u8, g: u8, b: u8, text: &str) -> String {
    format!("\x1b[38;2;{};{};{}m{}\x1b[39m", r, g, b, text)
}

/// Apply a background color using RGB.
pub fn bg_rgb(r: u8, g: u8, b: u8, text: &str) -> String {
    format!("\x1b[48;2;{};{};{}m{}\x1b[49m", r, g, b, text)
}

/// Apply bold style.
pub fn bold(text: &str) -> String {
    format!("\x1b[1m{}\x1b[22m", text)
}

/// Apply italic style.
pub fn italic(text: &str) -> String {
    format!("\x1b[3m{}\x1b[23m", text)
}

/// Apply underline style.
pub fn underline(text: &str) -> String {
    format!("\x1b[4m{}\x1b[24m", text)
}

/// Apply inverse (reverse video) style.
pub fn inverse(text: &str) -> String {
    format!("\x1b[7m{}\x1b[27m", text)
}

/// Apply dim/faint style.
pub fn dim(text: &str) -> String {
    format!("\x1b[2m{}\x1b[22m", text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_visible_width() {
        assert_eq!(visible_width("hello"), 5);
        assert_eq!(visible_width("\x1b[31mhello\x1b[0m"), 5);
        assert_eq!(visible_width("你好"), 4); // Chinese characters are 2 columns each
        assert_eq!(visible_width("\x1b[1m你好\x1b[0m"), 4);
    }

    #[test]
    fn test_strip_ansi() {
        assert_eq!(strip_ansi("hello"), "hello");
        assert_eq!(strip_ansi("\x1b[31mhello\x1b[0m"), "hello");
        assert_eq!(strip_ansi("\x1b[1;31mhello\x1b[0m"), "hello");
    }

    #[test]
    fn test_hyperlink() {
        // let link = hyperlink("https://example.com", "Example");
        // assert!(link.contains("https://example.com"));
        // assert!(link.contains("Example"));
    }
}
