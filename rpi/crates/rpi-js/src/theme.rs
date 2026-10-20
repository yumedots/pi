//! The theme the extension host colors with.
//!
//! pi's theme has 58 tokens: 49 foreground and 9 background. The extension
//! host hands each of them to the extension twice: as the ANSI escape the
//! original's `theme.fg` / `theme.bg` emit, and as the concrete color value
//! the original's `theme.colors` exposes.

use serde_json::{json, Map, Value};

use rpi_tui::theme::Color;

/// The foreground tokens, in the original's order.
const FOREGROUND: [(&str, &str); 49] = [
    ("accent", "accent"),
    ("border", "border"),
    ("borderAccent", "border_accent"),
    ("borderMuted", "border_muted"),
    ("success", "success"),
    ("error", "error"),
    ("warning", "warning"),
    ("muted", "muted"),
    ("dim", "dim"),
    ("text", "text"),
    ("thinkingText", "thinking_text"),
    ("scrollbarTrack", "scrollbar_track"),
    ("scrollbarThumb", "scrollbar_thumb"),
    ("searchMatchText", "search_match_text"),
    ("userMessageText", "user_message_text"),
    ("customMessageText", "custom_message_text"),
    ("customMessageLabel", "custom_message_label"),
    ("toolTitle", "tool_title"),
    ("toolOutput", "tool_output"),
    ("mdHeading", "md_heading"),
    ("mdLink", "md_link"),
    ("mdLinkUrl", "md_link_url"),
    ("mdCode", "md_code"),
    ("mdCodeBlock", "md_code_block"),
    ("mdCodeBlockBorder", "md_code_block_border"),
    ("mdQuote", "md_quote"),
    ("mdQuoteBorder", "md_quote_border"),
    ("mdHr", "md_hr"),
    ("mdListBullet", "md_list_bullet"),
    ("toolDiffAdded", "tool_diff_added"),
    ("toolDiffRemoved", "tool_diff_removed"),
    ("toolDiffContext", "tool_diff_context"),
    ("syntaxComment", "syntax_comment"),
    ("syntaxKeyword", "syntax_keyword"),
    ("syntaxFunction", "syntax_function"),
    ("syntaxVariable", "syntax_variable"),
    ("syntaxString", "syntax_string"),
    ("syntaxNumber", "syntax_number"),
    ("syntaxType", "syntax_type"),
    ("syntaxOperator", "syntax_operator"),
    ("syntaxPunctuation", "syntax_punctuation"),
    ("thinkingOff", "thinking_off"),
    ("thinkingMinimal", "thinking_minimal"),
    ("thinkingLow", "thinking_low"),
    ("thinkingMedium", "thinking_medium"),
    ("thinkingHigh", "thinking_high"),
    ("thinkingXhigh", "thinking_xhigh"),
    ("thinkingMax", "thinking_max"),
    ("bashMode", "bash_mode"),
];

/// The background tokens, in the original's order.
const BACKGROUND: [(&str, &str); 9] = [
    ("selectedBg", "selected_bg"),
    ("panelBg", "panel_bg"),
    ("menuSelectedBg", "menu_selected_bg"),
    ("searchMatchBg", "search_match_bg"),
    ("userMessageBg", "user_message_bg"),
    ("customMessageBg", "custom_message_bg"),
    ("toolPendingBg", "tool_pending_bg"),
    ("toolSuccessBg", "tool_success_bg"),
    ("toolErrorBg", "tool_error_bg"),
];

/// The concrete color value the original's `theme.colors` exposes.
fn color_value(color: &Color) -> Value {
    match color {
        Color::Rgb(r, g, b) => json!({ "kind": "rgb", "r": r, "g": g, "b": b }),
        Color::Ansi16(index) => json!({ "kind": "indexed", "index": index }),
        Color::Ansi256(index) => json!({ "kind": "indexed", "index": index }),
        Color::Default => json!({ "kind": "indexed", "index": 0 }),
    }
}

/// The theme the extension host hands to an extension.
///
/// `fg` and `bg` map a token name to the ANSI escape that opens it; `colors`
/// maps every token to its concrete color. `colorEnabled` says whether the
/// host writes color at all: the original's `theme.bold` and friends go
/// through chalk, which drops the escape when the terminal has no color.
pub fn tokens() -> Value {
    let colors = rpi_tui::theme().colors;
    let mut fg = Map::new();
    let mut bg = Map::new();
    let mut values = Map::new();
    for (name, field) in FOREGROUND {
        let color = color_of(&colors, field);
        fg.insert(name.to_string(), Value::String(color.to_fg()));
        values.insert(name.to_string(), color_value(&color));
    }
    for (name, field) in BACKGROUND {
        let color = color_of(&colors, field);
        bg.insert(name.to_string(), Value::String(color.to_bg()));
        values.insert(name.to_string(), color_value(&color));
    }
    json!({
        "fg": Value::Object(fg),
        "bg": Value::Object(bg),
        "colors": Value::Object(values),
        "colorEnabled": color_enabled(),
        "name": Value::Null,
        "sourcePath": Value::Null,
        "appearance": "dark",
        "colorMode": "truecolor",
    })
}

/// The color of one theme field, by its name.
fn color_of(colors: &rpi_tui::theme::ThemeColors, field: &str) -> Color {
    match field {
        "accent" => colors.accent,
        "border" => colors.border,
        "border_accent" => colors.border_accent,
        "border_muted" => colors.border_muted,
        "success" => colors.success,
        "error" => colors.error,
        "warning" => colors.warning,
        "muted" => colors.muted,
        "dim" => colors.dim,
        "text" => colors.text,
        "thinking_text" => colors.thinking_text,
        "scrollbar_track" => colors.scrollbar_track,
        "scrollbar_thumb" => colors.scrollbar_thumb,
        "search_match_text" => colors.search_match_text,
        "user_message_text" => colors.user_message_text,
        "custom_message_text" => colors.custom_message_text,
        "custom_message_label" => colors.custom_message_label,
        "tool_title" => colors.tool_title,
        "tool_output" => colors.tool_output,
        "md_heading" => colors.md_heading,
        "md_link" => colors.md_link,
        "md_link_url" => colors.md_link_url,
        "md_code" => colors.md_code,
        "md_code_block" => colors.md_code_block,
        "md_code_block_border" => colors.md_code_block_border,
        "md_quote" => colors.md_quote,
        "md_quote_border" => colors.md_quote_border,
        "md_hr" => colors.md_hr,
        "md_list_bullet" => colors.md_list_bullet,
        "tool_diff_added" => colors.tool_diff_added,
        "tool_diff_removed" => colors.tool_diff_removed,
        "tool_diff_context" => colors.tool_diff_context,
        "syntax_comment" => colors.syntax_comment,
        "syntax_keyword" => colors.syntax_keyword,
        "syntax_function" => colors.syntax_function,
        "syntax_variable" => colors.syntax_variable,
        "syntax_string" => colors.syntax_string,
        "syntax_number" => colors.syntax_number,
        "syntax_type" => colors.syntax_type,
        "syntax_operator" => colors.syntax_operator,
        "syntax_punctuation" => colors.syntax_punctuation,
        "thinking_off" => colors.thinking_off,
        "thinking_minimal" => colors.thinking_minimal,
        "thinking_low" => colors.thinking_low,
        "thinking_medium" => colors.thinking_medium,
        "thinking_high" => colors.thinking_high,
        "thinking_xhigh" => colors.thinking_xhigh,
        "thinking_max" => colors.thinking_max,
        "bash_mode" => colors.bash_mode,
        "selected_bg" => colors.selected_bg,
        "panel_bg" => colors.panel_bg,
        "menu_selected_bg" => colors.menu_selected_bg,
        "search_match_bg" => colors.search_match_bg,
        "user_message_bg" => colors.user_message_bg,
        "custom_message_bg" => colors.custom_message_bg,
        "tool_pending_bg" => colors.tool_pending_bg,
        "tool_success_bg" => colors.tool_success_bg,
        "tool_error_bg" => colors.tool_error_bg,
        _ => Color::Default,
    }
}

/// Whether the host writes color to the terminal.
fn color_enabled() -> bool {
    if std::env::var_os("NO_COLOR").is_some() {
        return false;
    }
    #[cfg(unix)]
    {
        return std::io::IsTerminal::is_terminal(&std::io::stdout());
    }
    #[cfg(not(unix))]
    {
        true
    }
}
