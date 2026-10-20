//! Terminal color parsing and manipulation.
//!
//! Provides utilities for querying the terminal for its colors and for
//! parsing the OSC 10, 11 and 4 replies.

/// Number of ANSI palette entries a terminal reports.
pub const TERMINAL_PALETTE_SIZE: usize = 16;

/// RGB color representation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RgbColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl RgbColor {
    /// Create a new RGB color.
    pub fn new(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b }
    }

    /// Create from a hex string (e.g., "#ff0000" or "ff0000").
    pub fn from_hex(hex: &str) -> Option<Self> {
        let hex = hex.trim_start_matches('#');
        if hex.len() != 6 {
            return None;
        }

        let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
        let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
        let b = u8::from_str_radix(&hex[4..6], 16).ok()?;

        Some(Self::new(r, g, b))
    }

    /// Convert to hex string.
    pub fn to_hex(&self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }

    /// Calculate relative luminance (0.0 - 1.0).
    pub fn luminance(&self) -> f64 {
        let r = self.r as f64 / 255.0;
        let g = self.g as f64 / 255.0;
        let b = self.b as f64 / 255.0;

        // sRGB luminance formula
        0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    /// Check if this is a "dark" color.
    pub fn is_dark(&self) -> bool {
        self.luminance() < 0.5
    }

    /// WCAG 2 relative luminance (0.0 - 1.0).
    pub fn wcag_luminance(&self) -> f64 {
        fn linear(channel: u8) -> f64 {
            let value = channel as f64 / 255.0;
            if value <= 0.04045 {
                value / 12.92
            } else {
                ((value + 0.055) / 1.055).powf(2.4)
            }
        }
        0.2126 * linear(self.r) + 0.7152 * linear(self.g) + 0.0722 * linear(self.b)
    }

    /// WCAG 2 contrast ratio against another color (1 - 21).
    pub fn wcag_contrast(&self, other: &RgbColor) -> f64 {
        let a = self.wcag_luminance();
        let b = other.wcag_luminance();
        (a.max(b) + 0.05) / (a.min(b) + 0.05)
    }

    /// Oklab lightness (0.0 - 1.0).
    ///
    /// Pi's `rgbToOklab` lightness, used to tell a terminal's foreground
    /// direction from its background.
    pub fn oklab_lightness(&self) -> f64 {
        fn linear(channel: u8) -> f64 {
            let value = channel as f64 / 255.0;
            if value <= 0.04045 {
                value / 12.92
            } else {
                ((value + 0.055) / 1.055).powf(2.4)
            }
        }
        let r = linear(self.r);
        let g = linear(self.g);
        let b = linear(self.b);
        let l = 0.4122214694707629 * r + 0.5363325372617349 * g + 0.0514459932675022 * b;
        let m = 0.2119034958178251 * r + 0.6806995506452344 * g + 0.1073969535369405 * b;
        let s = 0.0883024591900564 * r + 0.2817188391361215 * g + 0.6299787016738222 * b;
        0.210454268309314 * l.cbrt() + 0.793617774702305 * m.cbrt() - 0.0040720430116193 * s.cbrt()
    }

    /// Check if this is a "light" color.
    pub fn is_light(&self) -> bool {
        !self.is_dark()
    }

    /// Convert to ANSI escape sequence for foreground.
    pub fn to_fg_escape(&self) -> String {
        format!("\x1b[38;2;{};{};{}m", self.r, self.g, self.b)
    }

    /// Convert to ANSI escape sequence for background.
    pub fn to_bg_escape(&self) -> String {
        format!("\x1b[48;2;{};{};{}m", self.r, self.g, self.b)
    }
}

impl Default for RgbColor {
    fn default() -> Self {
        Self::new(0, 0, 0)
    }
}

/// Colors the terminal reports for its current theme.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TerminalColors {
    /// Default foreground (OSC 10).
    pub foreground: Option<RgbColor>,
    /// Default background (OSC 11).
    pub background: Option<RgbColor>,
    /// ANSI colors 0-15 (OSC 4). Only set when the terminal reported all 16.
    pub palette: Option<Vec<RgbColor>>,
}

/// What an OSC color reply reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OscColorTarget {
    /// The default foreground (OSC 10).
    Foreground,
    /// The default background (OSC 11).
    Background,
    /// An ANSI palette entry (OSC 4).
    Palette(usize),
}

/// Parse an OSC 10, 11 or 4 color reply.
///
/// Returns `None` when the data is not such a reply. The color is `None` when
/// the reply carries a value that cannot be parsed.
pub fn parse_osc_color_response(data: &str) -> Option<(OscColorTarget, Option<RgbColor>)> {
    let rest = data.strip_prefix("\x1b]")?;
    let (target, value) = if let Some(value) = rest.strip_prefix("10;") {
        (OscColorTarget::Foreground, value)
    } else if let Some(value) = rest.strip_prefix("11;") {
        (OscColorTarget::Background, value)
    } else if let Some(value) = rest.strip_prefix("4;") {
        let (index, value) = value.split_once(';')?;
        let index: usize = index.parse().ok()?;
        (OscColorTarget::Palette(index), value)
    } else {
        return None;
    };
    let value = value
        .strip_suffix('\x07')
        .or_else(|| value.strip_suffix("\x1b\\"))?;
    if value.contains('\x07') || value.contains('\x1b') {
        return None;
    }
    Some((target, parse_osc_color_value(value)))
}

/// Parse the color value of an OSC reply.
///
/// Supports `#rrggbb`, `#rrrrggggbbbb` and `rgb:rr/gg/bb` with 8-bit or
/// 16-bit channels.
fn parse_osc_color_value(raw: &str) -> Option<RgbColor> {
    let value = raw.trim();
    if let Some(hex) = value.strip_prefix('#') {
        if hex.len() == 6 {
            return RgbColor::from_hex(hex);
        }
        if hex.len() == 12 {
            return Some(RgbColor::new(
                parse_color_component(&hex[0..4])?,
                parse_color_component(&hex[4..8])?,
                parse_color_component(&hex[8..12])?,
            ));
        }
        return None;
    }
    let rgb = value
        .strip_prefix("rgb:")
        .or_else(|| value.strip_prefix("rgba:"))
        .or_else(|| value.strip_prefix("RGB:"))
        .or_else(|| value.strip_prefix("RGBA:"))?;
    let mut parts = rgb.split('/');
    let r = parse_color_component(parts.next()?)?;
    let g = parse_color_component(parts.next()?)?;
    let b = parse_color_component(parts.next()?)?;
    if parts.next().is_some() {
        return None;
    }
    Some(RgbColor::new(r, g, b))
}

/// Parse a single color component.
///
/// Channels are scaled to 8 bit, so `1e1e` and `1e` report the same color.
fn parse_color_component(s: &str) -> Option<u8> {
    let s = s.trim();
    if s.is_empty() || !s.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let max = 16f64.powi(s.len() as i32) - 1.0;
    if max <= 0.0 {
        return None;
    }
    let value = u32::from_str_radix(s, 16).ok()? as f64;
    Some((value / max * 255.0).round() as u8)
}

/// Check whether the data is a primary device attributes (DA1) reply.
///
/// The DA1 reply marks the end of the terminal's color replies.
pub fn is_device_attributes_response(data: &str) -> bool {
    let Some(rest) = data.strip_prefix("\x1b[?") else {
        return false;
    };
    let Some(params) = rest.strip_suffix('c') else {
        return false;
    };
    params.chars().all(|c| c.is_ascii_digit() || c == ';')
}

/// Query terminal for foreground color.
pub fn query_foreground_color() -> &'static str {
    "\x1b]10;?\x07"
}

/// Query terminal for background color.
pub fn query_background_color() -> &'static str {
    "\x1b]11;?\x07"
}

/// Query terminal for one ANSI palette color.
pub fn query_palette_color(index: usize) -> String {
    format!("\x1b]4;{index};?\x07")
}

/// Query the terminal for its primary device attributes.
pub fn query_device_attributes() -> &'static str {
    "\x1b[c"
}

/// Query the terminal for its foreground, its background and its ANSI palette.
///
/// The trailing DA1 request marks the end of the replies: every terminal
/// answers it and terminals answer in order, so it also ends the replies for
/// terminals that ignore the color queries.
pub fn query_terminal_colors() -> String {
    let mut query = String::new();
    query.push_str(query_foreground_color());
    query.push_str(query_background_color());
    for index in 0..TERMINAL_PALETTE_SIZE {
        query.push_str(&query_palette_color(index));
    }
    query.push_str(query_device_attributes());
    query
}

/// Collects the replies of a terminal color query.
///
/// The query ends when the DA1 reply arrives or when every color replied.
#[derive(Debug, Clone, Default)]
pub struct TerminalColorQuery {
    foreground: Option<RgbColor>,
    background: Option<RgbColor>,
    palette: [Option<RgbColor>; TERMINAL_PALETTE_SIZE],
    replied_foreground: bool,
    replied_background: bool,
    replied_palette: [bool; TERMINAL_PALETTE_SIZE],
    complete: bool,
}

impl TerminalColorQuery {
    /// Start a new query.
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed a reply. Returns `true` when the data was a color reply or the
    /// DA1 reply that ends the query.
    pub fn consume(&mut self, data: &str) -> bool {
        if self.complete {
            return false;
        }
        if is_device_attributes_response(data) {
            self.complete = true;
            return true;
        }
        let Some((target, color)) = parse_osc_color_response(data) else {
            return false;
        };
        match target {
            OscColorTarget::Foreground => {
                self.replied_foreground = true;
                self.foreground = color;
            }
            OscColorTarget::Background => {
                self.replied_background = true;
                self.background = color;
            }
            OscColorTarget::Palette(index) => {
                if index >= TERMINAL_PALETTE_SIZE {
                    return true;
                }
                self.replied_palette[index] = true;
                self.palette[index] = color;
            }
        }
        if self.replied_count() == 2 + TERMINAL_PALETTE_SIZE {
            self.complete = true;
        }
        true
    }

    fn replied_count(&self) -> usize {
        self.replied_foreground as usize
            + self.replied_background as usize
            + self.replied_palette.iter().filter(|replied| **replied).count()
    }

    /// Whether the query ended.
    pub fn is_complete(&self) -> bool {
        self.complete
    }

    /// The colors the terminal reported.
    ///
    /// The palette is only set when the terminal reported all 16 entries.
    pub fn result(&self) -> TerminalColors {
        let palette = if self.palette.iter().all(|color| color.is_some()) {
            Some(
                self.palette
                    .iter()
                    .map(|color| color.expect("palette checked"))
                    .collect(),
            )
        } else {
            None
        };
        TerminalColors {
            foreground: self.foreground,
            background: self.background,
            palette,
        }
    }
}

/// Splits raw terminal input into the escape sequences it contains.
///
/// The terminal answers a color query with escape sequences that arrive in
/// arbitrary chunks, so incomplete sequences are kept until they are complete.
#[derive(Debug, Default)]
pub struct ReplySplitter {
    pending: Vec<u8>,
}

impl ReplySplitter {
    /// Feed raw bytes and get the escape sequences they complete.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        let mut sequences = Vec::new();
        for &byte in bytes {
            self.pending.push(byte);
            if let Some(sequence) = self.take_sequence() {
                sequences.push(sequence);
            }
        }
        sequences
    }

    fn take_sequence(&mut self) -> Option<String> {
        let start = self.pending.iter().position(|&byte| byte == 0x1b)?;
        if start > 0 {
            self.pending.drain(..start);
        }
        let second = *self.pending.get(1)?;
        match second {
            b']' => {
                for index in 2..self.pending.len() {
                    let byte = self.pending[index];
                    if byte == 0x07 {
                        return Some(self.take(index + 1));
                    }
                    if byte == 0x1b && self.pending.get(index + 1) == Some(&b'\\') {
                        return Some(self.take(index + 2));
                    }
                }
                None
            }
            b'[' => {
                for index in 2..self.pending.len() {
                    if (0x40..=0x7e).contains(&self.pending[index]) {
                        return Some(self.take(index + 1));
                    }
                }
                None
            }
            _ => Some(self.take(2)),
        }
    }

    fn take(&mut self, len: usize) -> String {
        let bytes: Vec<u8> = self.pending.drain(..len).collect();
        String::from_utf8_lossy(&bytes).to_string()
    }
}

/// How long pi waits for the terminal's colors before settling on a theme.
///
/// Terminals answer the trailing DA1 request right after the color replies, so
/// this only matters for terminals that answer neither.
pub const TERMINAL_COLOR_QUERY_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(100);

/// Ask the terminal for its colors and read the replies.
///
/// The terminal must be in raw mode: the replies only arrive then. The query
/// runs once per process: a second query would answer into the input stream
/// of the running TUI.
pub fn request_terminal_colors(
    terminal: &dyn crate::terminal::Terminal,
    timeout: std::time::Duration,
) -> TerminalColors {
    use std::sync::atomic::{AtomicBool, Ordering};

    static QUERIED: AtomicBool = AtomicBool::new(false);

    if QUERIED.swap(true, Ordering::AcqRel) {
        return TerminalColors::default();
    }
    if !crossterm::terminal::is_raw_mode_enabled().unwrap_or(false) || !can_read_replies() {
        return TerminalColors::default();
    }
    terminal.write(&query_terminal_colors());
    terminal.flush();
    read_terminal_colors(timeout)
}

/// Whether the replies can be read from the terminal.
#[cfg(unix)]
fn can_read_replies() -> bool {
    use std::io::IsTerminal;
    std::io::stdin().is_terminal()
}

/// Whether the replies can be read from the terminal.
#[cfg(not(unix))]
fn can_read_replies() -> bool {
    false
}

/// Read the terminal's color replies.
///
/// The query must have been written to the terminal before. The read stops
/// when the DA1 reply arrives, when every color replied, or when the timeout
/// expires. Everything the terminal sends in the meantime is consumed, so a
/// keystroke typed while the query runs does not reach the application.
#[cfg(unix)]
pub fn read_terminal_colors(timeout: std::time::Duration) -> TerminalColors {
    use std::io::IsTerminal;
    use std::time::Instant;

    if !std::io::stdin().is_terminal() {
        return TerminalColors::default();
    }
    let mut query = TerminalColorQuery::new();
    let mut splitter = ReplySplitter::default();
    let deadline = Instant::now() + timeout;
    let mut buffer = [0u8; 1024];
    while !query.is_complete() {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        if !wait_for_input(remaining) {
            break;
        }
        let Ok(read) = read_input(&mut buffer) else {
            break;
        };
        if read == 0 {
            break;
        }
        for sequence in splitter.push(&buffer[..read]) {
            query.consume(&sequence);
        }
    }
    query.result()
}

/// Read the terminal's color replies.
#[cfg(not(unix))]
pub fn read_terminal_colors(_timeout: std::time::Duration) -> TerminalColors {
    TerminalColors::default()
}

/// Wait until the terminal sent something.
#[cfg(unix)]
fn wait_for_input(timeout: std::time::Duration) -> bool {
    let mut fds = [libc::pollfd {
        fd: libc::STDIN_FILENO,
        events: libc::POLLIN,
        revents: 0,
    }];
    let millis = timeout.as_millis().min(i32::MAX as u128) as i32;
    // SAFETY: fds points to one initialized pollfd for the call.
    unsafe { libc::poll(fds.as_mut_ptr(), 1, millis) > 0 }
}

/// Read the bytes the terminal sent.
#[cfg(unix)]
fn read_input(buffer: &mut [u8]) -> std::io::Result<usize> {
    // SAFETY: buffer points to len initialized bytes for the call.
    let read = unsafe {
        libc::read(
            libc::STDIN_FILENO,
            buffer.as_mut_ptr() as *mut libc::c_void,
            buffer.len(),
        )
    };
    if read < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(read as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rgb_color() {
        let color = RgbColor::new(255, 128, 0);
        assert_eq!(color.to_hex(), "#ff8000");
        assert!(color.is_light());
    }

    #[test]
    fn test_rgb_from_hex() {
        let color = RgbColor::from_hex("#ff0000").unwrap();
        assert_eq!(color.r, 255);
        assert_eq!(color.g, 0);
        assert_eq!(color.b, 0);
    }

    #[test]
    fn test_luminance() {
        let black = RgbColor::new(0, 0, 0);
        let white = RgbColor::new(255, 255, 255);

        assert!(black.is_dark());
        assert!(white.is_light());
    }

    #[test]
    fn query_asks_for_the_palette_and_ends_with_the_device_attributes() {
        let query = query_terminal_colors();
        assert!(query.starts_with("\x1b]10;?\x07\x1b]11;?\x07"));
        for index in 0..TERMINAL_PALETTE_SIZE {
            assert!(
                query.contains(&format!("\x1b]4;{index};?\x07")),
                "palette entry {index} is missing"
            );
        }
        assert!(query.ends_with("\x1b[c"), "the DA1 request ends the query");
        assert_eq!(query.matches("\x1b]4;").count(), TERMINAL_PALETTE_SIZE);
    }

    #[test]
    fn parses_the_foreground_background_and_palette_replies() {
        let (target, color) = parse_osc_color_response("\x1b]10;rgb:cccc/cccc/cccc\x07").unwrap();
        assert_eq!(target, OscColorTarget::Foreground);
        assert_eq!(color, Some(RgbColor::new(0xcc, 0xcc, 0xcc)));

        let (target, color) = parse_osc_color_response("\x1b]11;rgb:1e1e/1e1e/1e1e\x07").unwrap();
        assert_eq!(target, OscColorTarget::Background);
        assert_eq!(color, Some(RgbColor::new(0x1e, 0x1e, 0x1e)));

        let (target, color) = parse_osc_color_response("\x1b]4;7;rgb:8080/8080/8080\x07").unwrap();
        assert_eq!(target, OscColorTarget::Palette(7));
        assert_eq!(color, Some(RgbColor::new(0x80, 0x80, 0x80)));

        let (target, color) = parse_osc_color_response("\x1b]4;1;#ff0000\x1b\\").unwrap();
        assert_eq!(target, OscColorTarget::Palette(1));
        assert_eq!(color, Some(RgbColor::new(255, 0, 0)));

        assert!(parse_osc_color_response("\x1b]12;rgb:0000/0000/0000\x07").is_none());
        assert!(parse_osc_color_response("not a reply").is_none());
    }

    #[test]
    fn the_device_attributes_reply_ends_the_query() {
        let mut query = TerminalColorQuery::new();
        assert!(query.consume("\x1b]10;rgb:cccc/cccc/cccc\x07"));
        assert!(!query.is_complete());
        assert!(query.consume("\x1b[?1;2c"));
        assert!(query.is_complete());
        assert_eq!(query.result().foreground, Some(RgbColor::new(0xcc, 0xcc, 0xcc)));
        assert_eq!(query.result().palette, None);
    }

    #[test]
    fn the_palette_is_only_set_when_all_entries_arrived() {
        let mut query = TerminalColorQuery::new();
        for index in 0..TERMINAL_PALETTE_SIZE {
            let reply = format!("\x1b]4;{index};rgb:0102/0304/0506\x07");
            assert!(query.consume(&reply));
        }
        assert!(!query.is_complete(), "the default colors did not reply");
        assert!(query.consume("\x1b]10;rgb:cccc/cccc/cccc\x07"));
        assert!(query.consume("\x1b]11;rgb:1e1e/1e1e/1e1e\x07"));
        assert!(query.is_complete(), "every color replied");
        let result = query.result();
        let palette = result.palette.expect("the palette is complete");
        assert_eq!(palette.len(), TERMINAL_PALETTE_SIZE);
        assert_eq!(palette[0], RgbColor::new(0x01, 0x03, 0x05));
        assert_eq!(palette[15], RgbColor::new(0x01, 0x03, 0x05));
    }

    #[test]
    fn the_splitter_keeps_sequences_that_span_two_reads() {
        let mut splitter = ReplySplitter::default();
        assert!(splitter.push(b"\x1b]10;rgb:cccc/cccc/cccc").is_empty());
        let sequences = splitter.push(b"\x07\x1b[?1;2c");
        assert_eq!(sequences.len(), 2);
        assert_eq!(sequences[0], "\x1b]10;rgb:cccc/cccc/cccc\x07");
        assert_eq!(sequences[1], "\x1b[?1;2c");
        assert!(is_device_attributes_response(&sequences[1]));
    }
}
