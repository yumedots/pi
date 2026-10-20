//! Colour parity with the TypeScript original.
//!
//! These tests pin the escape sequences a themed line produces, not just the
//! palette values: a palette test passes while the screen is still wrong.
//!
//! They live in their own integration binary because they touch the
//! process-wide theme and the process-wide colour mode; a separate process
//! keeps that away from the parallel unit tests in `src/`. Within this binary
//! every test takes the same lock, so a theme swap in one test cannot change
//! the colours another test is asserting on.

use std::sync::{Mutex, MutexGuard};

use rpi_tui::{
    ansi::{set_color_mode, ColorMode},
    apply_theme_preset, global_theme_manager, Component, DynamicBorder, Editor, Focusable, Markdown,
    ScrollView, ScrollViewOptions, Theme, ThemePreset, ToolExecutionComponent,
    UserMessageComponent,
};

/// Serializes every test in this binary (theme and colour mode are global).
static THEME_LOCK: Mutex<()> = Mutex::new(());

fn lock() -> MutexGuard<'static, ()> {
    THEME_LOCK.lock().unwrap_or_else(|error| error.into_inner())
}

/// Renders with pi's dark palette and a truecolor terminal.
fn dark() -> Theme {
    set_color_mode(ColorMode::TrueColor);
    apply_theme_preset(ThemePreset::Dark);
    global_theme_manager().get()
}

/// Renders with pi's light palette and a truecolor terminal.
fn light() -> Theme {
    set_color_mode(ColorMode::TrueColor);
    apply_theme_preset(ThemePreset::Light);
    global_theme_manager().get()
}

#[test]
fn the_user_message_paints_pis_background_and_text() {
    let _g = lock();
    let theme = dark();
    let message = UserMessageComponent::new("hello world");
    let lines = message.render(40);
    let rendered = lines.join("\n");
    assert!(
        rendered.contains(&theme.colors.user_message_bg.to_bg()),
        "the card is painted in pi's userMessageBg: {rendered:?}"
    );
    assert!(
        rendered.contains(&theme.colors.user_message_text.to_fg()),
        "the text is painted in pi's userMessageText: {rendered:?}"
    );
    assert!(
        rendered.contains("\x1b[48;2;57;61;63m"),
        "pi's dark userMessageBg is #393d3f: {rendered:?}"
    );
    assert!(
        rendered.contains("\x1b[38;2;222;224;225m"),
        "pi's dark userMessageText is #dee0e1: {rendered:?}"
    );
}

#[test]
fn the_editor_card_paints_pis_background_and_accent() {
    let _g = lock();
    let theme = dark();
    let editor = Editor::simple();
    editor.set_text("hello");
    let lines = editor.render(40);
    let rendered = lines.join("\n");
    assert!(
        rendered.contains(&theme.colors.user_message_bg.to_bg()),
        "the card is painted in pi's userMessageBg: {rendered:?}"
    );
    assert!(
        rendered.contains("\x1b[38;2;167;152;215m"),
        "the prompt gutter is pi's violet accent: {rendered:?}"
    );
}

#[test]
fn markdown_paints_pis_bullets_fences_and_code() {
    let _g = lock();
    dark();
    let markdown = Markdown::new("- first item\n\n```rust\nfn main() {}\n```", 0, 0);
    let rendered = markdown.render(40).join("\n");
    assert!(
        rendered.contains("\x1b[38;2;167;152;215m"),
        "the list bullet is pi's violet mdListBullet: {rendered:?}"
    );
    assert!(
        rendered.contains("\x1b[38;2;157;165;169m"),
        "the fence is pi's mdCodeBlockBorder: {rendered:?}"
    );
    assert!(
        rendered.contains("\x1b[38;2;105;173;208m"),
        "the keyword is pi's syntaxKeyword: {rendered:?}"
    );
    assert!(
        rendered.contains("\x1b[38;2;205;154;34m"),
        "the function name is pi's syntaxFunction: {rendered:?}"
    );
}

#[test]
fn the_separator_paints_pis_border() {
    let _g = lock();
    dark();
    let rendered = DynamicBorder::new().render(40).join("\n");
    assert!(
        rendered.contains("\x1b[38;2;95;168;204m"),
        "the separator is pi's border colour: {rendered:?}"
    );
    assert!(
        !rendered.contains("\x1b[2m"),
        "pi paints the separator without the faint attribute: {rendered:?}"
    );
}

#[test]
fn the_tool_panel_paints_pis_background_title_and_output() {
    let _g = lock();
    let theme = dark();
    let tool = ToolExecutionComponent::new("read", "{}");
    tool.set_result("hello from the parity fixture", false);
    let rendered = tool.render(40).join("\n");
    assert!(
        rendered.contains(&theme.colors.tool_success_bg.to_bg()),
        "the panel is painted in pi's toolSuccessBg: {rendered:?}"
    );
    assert!(
        rendered.contains("\x1b[38;2;222;224;225m"),
        "the title is pi's toolTitle: {rendered:?}"
    );
    assert!(
        rendered.contains("\x1b[38;2;157;165;169m"),
        "the output is pi's toolOutput: {rendered:?}"
    );
}

#[test]
fn the_scrollbar_paints_pis_track_and_thumb() {
    let _g = lock();
    dark();
    let content = rpi_tui::Text::new(
        (0..100)
            .map(|index| format!("line {index}"))
            .collect::<Vec<_>>()
            .join("\n"),
        0,
        0,
    );
    let mut options = ScrollViewOptions::default();
    options.scrollbar = rpi_tui::scroll_view::ScrollbarMode::Always;
    let view = ScrollView::new(std::sync::Arc::new(content), options);
    let rendered = view.render_with_viewport(40, 10).join("\n");
    assert!(
        rendered.contains("\x1b[38;2;72;78;82m"),
        "the track is pi's scrollbarTrack: {rendered:?}"
    );
    assert!(
        rendered.contains("\x1b[38;2;151;160;165m"),
        "the thumb is pi's scrollbarThumb: {rendered:?}"
    );
}

#[test]
fn the_editor_marks_the_caret_like_pi() {
    let _g = lock();
    dark();
    let editor = Editor::simple();
    editor.set_text("hello");
    editor.set_focused(true);
    let rendered = editor.render(40).join("\n");
    assert!(
        rendered.contains(rpi_tui::ansi::FAKE_CURSOR_START)
            && rendered.contains(rpi_tui::ansi::FAKE_CURSOR_END),
        "the caret is marked like pi's fake cursor: {rendered:?}"
    );
}

#[test]
fn the_light_palette_paints_pis_light_colours() {
    let _g = lock();
    let theme = light();
    let message = UserMessageComponent::new("hello world");
    let rendered = message.render(40).join("\n");
    assert!(
        rendered.contains(&theme.colors.user_message_bg.to_bg()),
        "the card is painted in pi's light userMessageBg: {rendered:?}"
    );
    assert!(
        rendered.contains("\x1b[48;2;222;224;225m"),
        "pi's light userMessageBg is #dee0e1: {rendered:?}"
    );
    assert!(
        rendered.contains("\x1b[38;2;59;63;65m"),
        "pi's light userMessageText is #3b3f41: {rendered:?}"
    );
}
