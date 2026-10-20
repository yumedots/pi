//! Theme system for TUI customization.
//!
//! Provides color schemes and styling options.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::terminal_colors::{RgbColor, TerminalColors};

/// Theme colors.
///
/// Every field mirrors one pi theme token (see
/// `packages/coding-agent/src/modes/interactive/theme/theme-tokens.ts`); the
/// values are pi's own palette, resolved from `dark.json` / `light.json` with
/// pi's `parseColor` (`packages/tui/src/colors.ts`).
#[derive(Debug, Clone)]
pub struct ThemeColors {
    /// Primary accent color (logo, selected items, cursor).
    pub accent: Color,
    /// Normal borders.
    pub border: Color,
    /// Highlighted borders.
    pub border_accent: Color,
    /// Subtle borders.
    pub border_muted: Color,
    /// Success states.
    pub success: Color,
    /// Error states.
    pub error: Color,
    /// Warning states.
    pub warning: Color,
    /// Secondary/dimmed text.
    pub muted: Color,
    /// Very dimmed text (more subtle than muted).
    pub dim: Color,
    /// Default text color.
    pub text: Color,
    /// Thinking block text color.
    pub thinking_text: Color,
    /// Fullscreen scrollbar track foreground.
    pub scrollbar_track: Color,
    /// Fullscreen scrollbar thumb foreground.
    pub scrollbar_thumb: Color,
    /// Transcript search match text.
    pub search_match_text: Color,
    /// User message text color.
    pub user_message_text: Color,
    /// Custom message text color.
    pub custom_message_text: Color,
    /// Custom message type label color.
    pub custom_message_label: Color,
    /// Tool execution box title color.
    pub tool_title: Color,
    /// Tool execution box output text color.
    pub tool_output: Color,
    /// Markdown heading text.
    pub md_heading: Color,
    /// Markdown link text.
    pub md_link: Color,
    /// Markdown link URL.
    pub md_link_url: Color,
    /// Markdown inline code.
    pub md_code: Color,
    /// Markdown code block content.
    pub md_code_block: Color,
    /// Markdown code block fences.
    pub md_code_block_border: Color,
    /// Markdown blockquote text.
    pub md_quote: Color,
    /// Markdown blockquote border.
    pub md_quote_border: Color,
    /// Markdown horizontal rule.
    pub md_hr: Color,
    /// Markdown list bullets/numbers.
    pub md_list_bullet: Color,
    /// Added lines in tool diffs.
    pub tool_diff_added: Color,
    /// Removed lines in tool diffs.
    pub tool_diff_removed: Color,
    /// Context lines in tool diffs.
    pub tool_diff_context: Color,
    /// Syntax highlighting: comments.
    pub syntax_comment: Color,
    /// Syntax highlighting: keywords.
    pub syntax_keyword: Color,
    /// Syntax highlighting: function names.
    pub syntax_function: Color,
    /// Syntax highlighting: variable names.
    pub syntax_variable: Color,
    /// Syntax highlighting: string literals.
    pub syntax_string: Color,
    /// Syntax highlighting: number literals.
    pub syntax_number: Color,
    /// Syntax highlighting: type names.
    pub syntax_type: Color,
    /// Syntax highlighting: operators.
    pub syntax_operator: Color,
    /// Syntax highlighting: punctuation.
    pub syntax_punctuation: Color,
    /// Thinking level border: off.
    pub thinking_off: Color,
    /// Thinking level border: minimal.
    pub thinking_minimal: Color,
    /// Thinking level border: low.
    pub thinking_low: Color,
    /// Thinking level border: medium.
    pub thinking_medium: Color,
    /// Thinking level border: high.
    pub thinking_high: Color,
    /// Thinking level border: xhigh.
    pub thinking_xhigh: Color,
    /// Thinking level border: max.
    pub thinking_max: Color,
    /// Editor border color in bash mode.
    pub bash_mode: Color,
    /// Selected item background.
    pub selected_bg: Color,
    /// Menu and dialog panel background.
    pub panel_bg: Color,
    /// Selected row in menus.
    pub menu_selected_bg: Color,
    /// Transcript search match background.
    pub search_match_bg: Color,
    /// User message background.
    pub user_message_bg: Color,
    /// Custom message background (hook-injected messages).
    pub custom_message_bg: Color,
    /// Tool execution box (pending state).
    pub tool_pending_bg: Color,
    /// Tool execution box (success state).
    pub tool_success_bg: Color,
    /// Tool execution box (error state).
    pub tool_error_bg: Color,
}

impl ThemeColors {
    /// pi's dark palette.
    pub fn dark() -> Self {
        Self {
            accent: Color::Rgb(167, 152, 215),
            border: Color::Rgb(95, 168, 204),
            border_accent: Color::Rgb(160, 142, 213),
            border_muted: Color::Rgb(118, 129, 134),
            success: Color::Rgb(104, 183, 141),
            error: Color::Rgb(234, 127, 129),
            warning: Color::Rgb(205, 154, 34),
            muted: Color::Rgb(157, 165, 169),
            dim: Color::Rgb(126, 136, 142),
            text: Color::Rgb(222, 224, 225),
            thinking_text: Color::Rgb(150, 160, 164),
            scrollbar_track: Color::Rgb(72, 78, 82),
            scrollbar_thumb: Color::Rgb(151, 160, 165),
            search_match_text: Color::Rgb(157, 165, 169),
            user_message_text: Color::Rgb(222, 224, 225),
            custom_message_text: Color::Rgb(157, 165, 169),
            custom_message_label: Color::Rgb(167, 152, 215),
            tool_title: Color::Rgb(222, 224, 225),
            tool_output: Color::Rgb(157, 165, 169),
            md_heading: Color::Rgb(205, 154, 34),
            md_link: Color::Rgb(105, 173, 208),
            md_link_url: Color::Rgb(157, 165, 169),
            md_code: Color::Rgb(167, 152, 215),
            md_code_block: Color::Rgb(104, 183, 141),
            md_code_block_border: Color::Rgb(157, 165, 169),
            md_quote: Color::Rgb(157, 165, 169),
            md_quote_border: Color::Rgb(157, 165, 169),
            md_hr: Color::Rgb(157, 165, 169),
            md_list_bullet: Color::Rgb(167, 152, 215),
            tool_diff_added: Color::Rgb(104, 183, 141),
            tool_diff_removed: Color::Rgb(234, 127, 129),
            tool_diff_context: Color::Rgb(157, 165, 169),
            syntax_comment: Color::Rgb(157, 165, 169),
            syntax_keyword: Color::Rgb(105, 173, 208),
            syntax_function: Color::Rgb(205, 154, 34),
            syntax_variable: Color::Rgb(93, 179, 186),
            syntax_string: Color::Rgb(222, 141, 90),
            syntax_number: Color::Rgb(104, 183, 141),
            syntax_type: Color::Rgb(167, 152, 215),
            syntax_operator: Color::Rgb(157, 165, 169),
            syntax_punctuation: Color::Rgb(157, 165, 169),
            thinking_off: Color::Rgb(108, 118, 123),
            thinking_minimal: Color::Rgb(104, 128, 141),
            thinking_low: Color::Rgb(84, 137, 164),
            thinking_medium: Color::Rgb(97, 133, 204),
            thinking_high: Color::Rgb(151, 118, 229),
            thinking_xhigh: Color::Rgb(222, 84, 193),
            thinking_max: Color::Rgb(254, 84, 98),
            bash_mode: Color::Rgb(94, 178, 134),
            selected_bg: Color::Rgb(33, 59, 73),
            panel_bg: Color::Rgb(38, 42, 44),
            menu_selected_bg: Color::Rgb(66, 71, 73),
            search_match_bg: Color::Rgb(78, 47, 27),
            user_message_bg: Color::Rgb(57, 61, 63),
            custom_message_bg: Color::Rgb(57, 61, 63),
            tool_pending_bg: Color::Rgb(52, 56, 58),
            tool_success_bg: Color::Rgb(37, 65, 49),
            tool_error_bg: Color::Rgb(91, 40, 42),
        }
    }

    /// pi's light palette.
    pub fn light() -> Self {
        Self {
            accent: Color::Rgb(116, 89, 180),
            border: Color::Rgb(61, 142, 179),
            border_accent: Color::Rgb(138, 114, 203),
            border_muted: Color::Rgb(154, 162, 167),
            success: Color::Rgb(51, 126, 88),
            error: Color::Rgb(200, 37, 61),
            warning: Color::Rgb(143, 104, 2),
            muted: Color::Rgb(103, 113, 118),
            dim: Color::Rgb(135, 144, 149),
            text: Color::Rgb(59, 63, 65),
            thinking_text: Color::Rgb(124, 134, 140),
            scrollbar_track: Color::Rgb(225, 227, 228),
            scrollbar_thumb: Color::Rgb(150, 160, 164),
            search_match_text: Color::Rgb(103, 113, 118),
            user_message_text: Color::Rgb(59, 63, 65),
            custom_message_text: Color::Rgb(103, 113, 118),
            custom_message_label: Color::Rgb(116, 89, 180),
            tool_title: Color::Rgb(59, 63, 65),
            tool_output: Color::Rgb(103, 113, 118),
            md_heading: Color::Rgb(143, 104, 2),
            md_link: Color::Rgb(47, 120, 153),
            md_link_url: Color::Rgb(103, 113, 118),
            md_code: Color::Rgb(116, 89, 180),
            md_code_block: Color::Rgb(51, 126, 88),
            md_code_block_border: Color::Rgb(103, 113, 118),
            md_quote: Color::Rgb(103, 113, 118),
            md_quote_border: Color::Rgb(103, 113, 118),
            md_hr: Color::Rgb(103, 113, 118),
            md_list_bullet: Color::Rgb(116, 89, 180),
            tool_diff_added: Color::Rgb(51, 126, 88),
            tool_diff_removed: Color::Rgb(200, 37, 61),
            tool_diff_context: Color::Rgb(103, 113, 118),
            syntax_comment: Color::Rgb(103, 113, 118),
            syntax_keyword: Color::Rgb(47, 120, 153),
            syntax_function: Color::Rgb(143, 104, 2),
            syntax_variable: Color::Rgb(40, 122, 129),
            syntax_string: Color::Rgb(164, 84, 23),
            syntax_number: Color::Rgb(51, 126, 88),
            syntax_type: Color::Rgb(116, 89, 180),
            syntax_operator: Color::Rgb(103, 113, 118),
            syntax_punctuation: Color::Rgb(103, 113, 118),
            thinking_off: Color::Rgb(194, 200, 202),
            thinking_minimal: Color::Rgb(181, 196, 203),
            thinking_low: Color::Rgb(159, 194, 213),
            thinking_medium: Color::Rgb(162, 183, 224),
            thinking_high: Color::Rgb(181, 165, 232),
            thinking_xhigh: Color::Rgb(229, 133, 205),
            thinking_max: Color::Rgb(254, 116, 121),
            bash_mode: Color::Rgb(64, 151, 108),
            selected_bg: Color::Rgb(223, 231, 236),
            panel_bg: Color::Rgb(242, 244, 244),
            menu_selected_bg: Color::Rgb(218, 222, 223),
            search_match_bg: Color::Rgb(237, 227, 221),
            user_message_bg: Color::Rgb(222, 224, 225),
            custom_message_bg: Color::Rgb(222, 224, 225),
            tool_pending_bg: Color::Rgb(228, 229, 230),
            tool_success_bg: Color::Rgb(222, 233, 225),
            tool_error_bg: Color::Rgb(238, 226, 225),
        }
    }
}

impl Default for ThemeColors {
    fn default() -> Self {
        Self::dark()
    }
}

/// Color representation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Color {
    /// Default terminal color.
    Default,
    /// ANSI 16-color palette.
    Ansi16(u8),
    /// ANSI 256-color palette.
    Ansi256(u8),
    /// RGB true color.
    Rgb(u8, u8, u8),
}

impl Color {
    /// Convert to ANSI foreground escape sequence.
    pub fn to_fg(&self) -> String {
        match self {
            Color::Default => "\x1b[39m".to_string(),
            Color::Ansi16(c) => format!("\x1b[{}m", c),
            Color::Ansi256(c) => format!("\x1b[38;5;{}m", c),
            Color::Rgb(r, g, b) => crate::ansi::foreground_rgb(*r, *g, *b),
        }
    }

    /// Convert to ANSI background escape sequence.
    pub fn to_bg(&self) -> String {
        match self {
            Color::Default => "\x1b[49m".to_string(),
            Color::Ansi16(c) => format!("\x1b[{}m", c + 10),
            Color::Ansi256(c) => format!("\x1b[48;5;{}m", c),
            Color::Rgb(r, g, b) => crate::ansi::background_rgb(*r, *g, *b),
        }
    }

    /// Apply color to text (foreground).
    pub fn fg(&self, text: &str) -> String {
        format!("{}{}\x1b[0m", self.to_fg(), text)
    }

    /// Apply color to text (background).
    pub fn bg(&self, text: &str) -> String {
        let bg = self.to_bg();
        // Foreground helpers deliberately terminate with SGR 0. When such a
        // styled span is nested in a panel background, that reset also clears
        // the background and used to leave the rest of tool/user rows patchy.
        // Re-apply this background after every nested reset.
        let nested = text.replace("\x1b[0m", &format!("\x1b[0m{bg}"));
        format!("{bg}{nested}\x1b[0m")
    }
}

/// Spacing tokens for terminal components.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ThemeSpacing {
    /// Horizontal inset on each side of a tool panel, in terminal columns.
    pub tool_panel_padding_x: usize,
    /// Vertical inset above and below a tool panel, in terminal rows.
    pub tool_panel_padding_y: usize,
}

impl Default for ThemeSpacing {
    fn default() -> Self {
        Self {
            tool_panel_padding_x: 2,
            tool_panel_padding_y: 1,
        }
    }
}

/// Theme settings.
#[derive(Debug, Clone)]
pub struct Theme {
    /// Color scheme.
    pub colors: ThemeColors,
    /// Component spacing shared by bash and generic tool execution panels.
    pub spacing: ThemeSpacing,
    /// Border style.
    pub border_style: BorderStyle,
    /// Corner style.
    pub corner_style: CornerStyle,
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            colors: ThemeColors::default(),
            spacing: ThemeSpacing::default(),
            border_style: BorderStyle::Rounded,
            corner_style: CornerStyle::Rounded,
        }
    }
}

/// Border style for boxes.
#[derive(Debug, Clone, Copy, Default)]
pub enum BorderStyle {
    #[default]
    Rounded,
    Sharp,
    Double,
    Thick,
    None,
}

impl BorderStyle {
    /// Get the border characters.
    pub fn chars(&self) -> BorderChars {
        match self {
            BorderStyle::Rounded => BorderChars {
                top_left: "╭",
                top_right: "╮",
                bottom_left: "╰",
                bottom_right: "╯",
                horizontal: "─",
                vertical: "│",
            },
            BorderStyle::Sharp => BorderChars {
                top_left: "┌",
                top_right: "┐",
                bottom_left: "└",
                bottom_right: "┘",
                horizontal: "─",
                vertical: "│",
            },
            BorderStyle::Double => BorderChars {
                top_left: "╔",
                top_right: "╗",
                bottom_left: "╚",
                bottom_right: "╝",
                horizontal: "═",
                vertical: "║",
            },
            BorderStyle::Thick => BorderChars {
                top_left: "┏",
                top_right: "┓",
                bottom_left: "┗",
                bottom_right: "┛",
                horizontal: "━",
                vertical: "┃",
            },
            BorderStyle::None => BorderChars {
                top_left: " ",
                top_right: " ",
                bottom_left: " ",
                bottom_right: " ",
                horizontal: " ",
                vertical: " ",
            },
        }
    }
}

/// Border characters.
pub struct BorderChars {
    pub top_left: &'static str,
    pub top_right: &'static str,
    pub bottom_left: &'static str,
    pub bottom_right: &'static str,
    pub horizontal: &'static str,
    pub vertical: &'static str,
}

/// Corner style.
#[derive(Debug, Clone, Copy, Default)]
pub enum CornerStyle {
    #[default]
    Rounded,
    Sharp,
}

/// Global theme manager.
pub struct ThemeManager {
    current: Mutex<Theme>,
    terminal_colors: Mutex<Option<TerminalColors>>,
    follows_terminal: AtomicBool,
}

/// Monotonic revision bumped on every theme mutation.
///
/// Components that memoize rendered output (which bakes in theme colors) key
/// their cache on this value, so a live theme switch invalidates them without
/// every host having to walk the tree and call `invalidate` (upstream's
/// `theme-controller.ts` does both: swap the palette and `ui.invalidate()`).
static THEME_REVISION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Current theme revision. Cache the value at build time and compare on render.
pub fn theme_revision() -> u64 {
    THEME_REVISION.load(std::sync::atomic::Ordering::Acquire)
}

impl ThemeManager {
    /// Create a new theme manager.
    pub fn new() -> Self {
        Self {
            current: Mutex::new(Theme::default()),
            terminal_colors: Mutex::new(None),
            follows_terminal: AtomicBool::new(true),
        }
    }

    /// Get the current theme.
    pub fn get(&self) -> Theme {
        self.current.lock().map(|t| t.clone()).unwrap_or_default()
    }

    /// Set the theme.
    pub fn set(&self, theme: Theme) {
        if let Ok(mut current) = self.current.lock() {
            *current = theme;
        }
        THEME_REVISION.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
    }

    /// Apply a preset theme to this manager.
    ///
    /// An explicit preset wins over the terminal's appearance.
    pub fn apply_preset(&self, preset: ThemePreset) {
        self.follows_terminal.store(false, Ordering::Release);
        self.set(theme_for_preset(preset));
    }

    /// The colors the terminal reported.
    pub fn terminal_colors(&self) -> Option<TerminalColors> {
        self.terminal_colors
            .lock()
            .ok()
            .and_then(|colors| colors.clone())
    }

    /// Follow the terminal's light or dark appearance again, undoing an
    /// explicit preset. Returns whether the theme changed.
    pub fn follow_terminal(&self) -> bool {
        self.follows_terminal.store(true, Ordering::Release);
        let colors = match self.terminal_colors.lock() {
            Ok(colors) => colors.clone(),
            Err(_) => return false,
        };
        match colors {
            Some(colors) => self.apply_terminal_colors(&colors),
            None => false,
        }
    }

    /// Apply the colors the terminal reported.
    ///
    /// The theme follows the terminal's light or dark appearance while the user
    /// did not pick a theme of their own. Returns whether the theme changed.
    pub fn apply_terminal_colors(&self, colors: &TerminalColors) -> bool {
        let changed = match self.terminal_colors.lock() {
            Ok(mut current) => {
                if current.as_ref() == Some(colors) {
                    false
                } else {
                    *current = Some(colors.clone());
                    true
                }
            }
            Err(_) => false,
        };
        if changed && self.follows_terminal.load(Ordering::Acquire) {
            let preset = match terminal_appearance(colors) {
                Some(TerminalAppearance::Dark) => ThemePreset::Dark,
                Some(TerminalAppearance::Light) => ThemePreset::Light,
                None => return changed,
            };
            self.set(theme_for_preset(preset));
        }
        changed
    }
}

/// Whether a terminal renders on a dark or a light background.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalAppearance {
    Dark,
    Light,
}

/// Decide whether the terminal is dark or light, like pi's `detectTerminalTheme`.
///
/// The terminal's background decides. Without a reported background: the
/// `COLORFGBG` fallback, then dark.
pub fn terminal_appearance(colors: &TerminalColors) -> Option<TerminalAppearance> {
    if let Some(background) = colors.background {
        return Some(if terminal_is_dark(&background, colors.foreground) {
            TerminalAppearance::Dark
        } else {
            TerminalAppearance::Light
        });
    }
    color_fgbg_appearance().or(Some(TerminalAppearance::Dark))
}

/// Dark or light from the `COLORFGBG` environment variable some terminals set.
///
/// The index refers to the terminal's own palette, whose colors are unknown
/// here, so it is classified by index like Vim does.
pub fn color_fgbg_appearance() -> Option<TerminalAppearance> {
    let value = std::env::var("COLORFGBG").ok()?;
    let background = value.split(';').next_back()?.trim();
    if background.is_empty() || !background.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let index: u32 = background.parse().ok()?;
    if index > 15 {
        return None;
    }
    Some(if index <= 6 || index == 8 {
        TerminalAppearance::Dark
    } else {
        TerminalAppearance::Light
    })
}

/// Whether a terminal is dark or light, from its reported colors.
///
/// The direction of its own foreground decides when text can be readable that
/// way, otherwise dark when white text has more contrast on the background
/// than black text.
fn terminal_is_dark(background: &RgbColor, foreground: Option<RgbColor>) -> bool {
    const TEXT_MINIMUM_WCAG_CONTRAST: f64 = 4.5;
    let white = RgbColor::new(255, 255, 255);
    let black = RgbColor::new(0, 0, 0);
    let white_contrast = white.wcag_contrast(background);
    let black_contrast = black.wcag_contrast(background);
    if let Some(foreground) = foreground {
        let foreground_lightness = foreground.oklab_lightness();
        let background_lightness = background.oklab_lightness();
        if (foreground_lightness - background_lightness).abs() > 0.05 {
            let dark = foreground_lightness > background_lightness;
            let best = if dark {
                white_contrast
            } else {
                black_contrast
            };
            if best >= TEXT_MINIMUM_WCAG_CONTRAST {
                return dark;
            }
        }
    }
    white_contrast >= black_contrast
}

/// Build a complete theme for a preset.
///
/// Kept separate from [`ThemeManager::apply_preset`] so the process-wide theme
/// used by components can be updated without maintaining a second palette.
fn theme_for_preset(preset: ThemePreset) -> Theme {
    let colors = match preset {
        ThemePreset::Dark => ThemeColors::dark(),
        ThemePreset::Light => ThemeColors::light(),
        ThemePreset::Monochrome => monochrome_colors(),
    };
    Theme {
        colors,
        ..Default::default()
    }
}

/// pi's dark palette without any hue.
///
/// Port-only preset: pi has no monochrome theme.
fn monochrome_colors() -> ThemeColors {
    let mut colors = ThemeColors::dark();
    let neutral = colors.text;
    let muted = colors.muted;
    for color in [
        &mut colors.accent,
        &mut colors.border,
        &mut colors.border_accent,
        &mut colors.success,
        &mut colors.error,
        &mut colors.warning,
        &mut colors.custom_message_label,
        &mut colors.tool_title,
        &mut colors.md_heading,
        &mut colors.md_link,
        &mut colors.md_code,
        &mut colors.md_code_block,
        &mut colors.md_list_bullet,
        &mut colors.tool_diff_added,
        &mut colors.tool_diff_removed,
        &mut colors.syntax_comment,
        &mut colors.syntax_keyword,
        &mut colors.syntax_function,
        &mut colors.syntax_variable,
        &mut colors.syntax_string,
        &mut colors.syntax_number,
        &mut colors.syntax_type,
        &mut colors.syntax_operator,
        &mut colors.syntax_punctuation,
        &mut colors.thinking_off,
        &mut colors.thinking_minimal,
        &mut colors.thinking_low,
        &mut colors.thinking_medium,
        &mut colors.thinking_high,
        &mut colors.thinking_xhigh,
        &mut colors.thinking_max,
        &mut colors.bash_mode,
    ] {
        *color = neutral;
    }
    colors.dim = muted;
    colors.thinking_text = muted;
    colors.tool_output = muted;
    colors.tool_diff_context = muted;
    colors.md_link_url = muted;
    colors.md_code_block_border = muted;
    colors.md_quote = muted;
    colors.md_quote_border = muted;
    colors.md_hr = muted;
    colors.custom_message_text = muted;
    colors.search_match_text = muted;
    colors.scrollbar_thumb = muted;
    colors.scrollbar_track = colors.border_muted;
    colors
}

impl Default for ThemeManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Theme presets.
#[derive(Debug, Clone, Copy)]
pub enum ThemePreset {
    Dark,
    Light,
    Monochrome,
}

/// Global theme helper functions.
pub fn theme() -> Theme {
    global_theme_manager().get()
}

/// Apply a preset to the process-wide theme read by every component.
///
/// Creating a standalone [`ThemeManager`] does not affect components that call
/// [`theme`]. Hosts should use this function for live theme switching.
pub fn apply_theme_preset(preset: ThemePreset) {
    global_theme_manager().apply_preset(preset);
}

/// Return the process-wide theme manager.
pub fn global_theme_manager() -> &'static ThemeManager {
    THEME_MANAGER.get_or_init(ThemeManager::new)
}

/// Global theme manager.
static THEME_MANAGER: std::sync::OnceLock<ThemeManager> = std::sync::OnceLock::new();

/// Apply color from theme.
pub fn themed_text(text: &str, color_fn: fn(&ThemeColors) -> Color) -> String {
    let theme = theme();
    let color = color_fn(&theme.colors);
    color.fg(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_color_ansi() {
        let color = Color::Ansi256(196);
        let text = color.fg("Hello");
        assert!(text.contains("Hello"));
    }

    #[test]
    fn the_dark_palette_is_pi_palette() {
        let colors = ThemeColors::dark();
        assert_eq!(colors.accent, Color::Rgb(167, 152, 215));
        assert_eq!(colors.border, Color::Rgb(95, 168, 204));
        assert_eq!(colors.text, Color::Rgb(222, 224, 225));
        assert_eq!(colors.user_message_bg, Color::Rgb(57, 61, 63));
        assert_eq!(colors.tool_success_bg, Color::Rgb(37, 65, 49));
        assert_eq!(colors.md_link, Color::Rgb(105, 173, 208));
        assert_eq!(colors.scrollbar_thumb, Color::Rgb(151, 160, 165));
        assert_eq!(colors.search_match_bg, Color::Rgb(78, 47, 27));
        assert_eq!(colors.syntax_keyword, Color::Rgb(105, 173, 208));
        assert_eq!(colors.thinking_max, Color::Rgb(254, 84, 98));
    }

    #[test]
    fn the_light_palette_is_pi_palette() {
        let colors = ThemeColors::light();
        assert_eq!(colors.accent, Color::Rgb(116, 89, 180));
        assert_eq!(colors.border, Color::Rgb(61, 142, 179));
        assert_eq!(colors.text, Color::Rgb(59, 63, 65));
        assert_eq!(colors.user_message_bg, Color::Rgb(222, 224, 225));
        assert_eq!(colors.tool_success_bg, Color::Rgb(222, 233, 225));
        assert_eq!(colors.md_link, Color::Rgb(47, 120, 153));
        assert_eq!(colors.scrollbar_thumb, Color::Rgb(150, 160, 164));
        assert_eq!(colors.search_match_bg, Color::Rgb(237, 227, 221));
        assert_eq!(colors.syntax_keyword, Color::Rgb(47, 120, 153));
        assert_eq!(colors.thinking_max, Color::Rgb(254, 116, 121));
    }

    #[test]
    fn the_theme_follows_the_terminal_appearance_until_a_theme_is_picked() {
        use crate::terminal_colors::RgbColor;

        let manager = ThemeManager::new();
        let light = TerminalColors {
            background: Some(RgbColor::new(255, 255, 255)),
            ..Default::default()
        };
        assert!(manager.apply_terminal_colors(&light));
        assert_eq!(
            manager.get().colors.muted,
            theme_for_preset(ThemePreset::Light).colors.muted
        );
        assert_eq!(manager.terminal_colors(), Some(light));

        manager.apply_preset(ThemePreset::Monochrome);
        let dark = TerminalColors {
            background: Some(RgbColor::new(0, 0, 0)),
            ..Default::default()
        };
        assert!(manager.apply_terminal_colors(&dark));
        assert_eq!(
            manager.get().colors.muted,
            theme_for_preset(ThemePreset::Monochrome).colors.muted,
            "an explicit theme wins over the terminal's appearance"
        );
    }

    #[test]
    fn a_mid_grey_terminal_is_light_like_pi() {
        let colors = TerminalColors {
            background: Some(RgbColor::new(118, 118, 118)),
            ..Default::default()
        };
        assert_eq!(terminal_appearance(&colors), Some(TerminalAppearance::Light));
    }

    #[test]
    fn a_reported_foreground_decides_the_appearance() {
        let colors = TerminalColors {
            background: Some(RgbColor::new(118, 118, 118)),
            foreground: Some(RgbColor::new(200, 200, 200)),
            ..Default::default()
        };
        assert_eq!(terminal_appearance(&colors), Some(TerminalAppearance::Dark));
    }
}
