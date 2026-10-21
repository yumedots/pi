//! The interactive mode's input: the first keystrokes reach the editor.
//!
//! The test drives the mode's own keyboard, editor and startup screen against
//! a fake terminal: the keystroke arrives before the screen is ready, and it
//! still ends up in the editor.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use rpi_tui::component::Component;
use rpi_tui::terminal::{Terminal, TerminalInfo};
use rpi_tui::{
    Container, Editor, EditorOptions, EditorStyle, EmptySessionScreen, Focusable, TUI, TuiAltScreen,
};

use super::input::{KeyInput, Keyboard};
use super::{dispatch_key_to_editor, empty_session_input_block, empty_session, state::TuiState};

/// A terminal that records what the app painted.
struct FakeTerminal {
    output: Arc<Mutex<String>>,
    info: Mutex<TerminalInfo>,
}

impl FakeTerminal {
    fn new(output: Arc<Mutex<String>>) -> Self {
        Self {
            output,
            info: Mutex::new(TerminalInfo {
                columns: 100,
                rows: 30,
                supports_true_color: true,
                supports_mouse: false,
                supports_kitty_keyboard: false,
            }),
        }
    }
}

impl Terminal for FakeTerminal {
    fn info(&self) -> TerminalInfo {
        self.info.lock().unwrap().clone()
    }

    fn write(&self, data: &str) {
        self.output.lock().unwrap().push_str(data);
    }

    fn hide_cursor(&self) {}

    fn show_cursor(&self) {}

    fn move_cursor(&self, _row: usize, _col: usize) {}

    fn clear_screen(&self) {}

    fn set_title(&self, _title: &str) {}

    fn enable_mouse(&self) {}

    fn disable_mouse(&self) {}

    fn enter_raw_mode(&self) {}

    fn exit_raw_mode(&self) {}

    fn refresh_size(&self) {}

    fn start(
        &self,
        _on_input: Box<dyn Fn(rpi_tui::terminal::InputEvent) + Send + Sync>,
        _on_resize: Box<dyn Fn() + Send + Sync>,
    ) {
    }

    fn stop(&self) {}

    fn is_tty(&self) -> bool {
        false
    }

    fn set_progress(&self, _active: bool) {}

    fn flush(&self) {}
}

/// The mode's state, without a session behind it.
fn test_state() -> Arc<TuiState> {
    super::tests::test_tui_state()
}

/// The startup screen with the editor in it, against the fake terminal.
fn startup_screen(
    tui: &Arc<TuiAltScreen>,
    editor: &Arc<Editor>,
) -> Arc<EmptySessionScreen> {
    let editor_container = Arc::new(Container::new());
    editor_container.add_child(editor.clone());
    let autocomplete_container = Arc::new(Container::new());
    let block = empty_session_input_block(editor_container, autocomplete_container);
    let logo = Arc::new(rpi_tui::logo3d::Logo3d::new([0.0, 0.0, 0.0]));
    let height = Arc::new(|| 30usize);
    Arc::new(EmptySessionScreen::new(
        logo,
        empty_session::greeting(),
        block,
        height,
    ))
}

#[test]
fn the_first_keystroke_reaches_the_editor_before_the_screen_is_ready() {
    let output = Arc::new(Mutex::new(String::new()));
    let tui = Arc::new(TuiAltScreen::new(
        Box::new(FakeTerminal::new(output.clone())),
        false,
        None,
    ));
    let editor = Arc::new(Editor::new(
        EditorOptions {
            padding_x: 1,
            ..Default::default()
        },
        EditorStyle::default(),
        super::configured_keybindings(),
    ));

    // The keyboard exists before the screen does, and the keystroke arrives
    // before the screen is ready: it waits in the keyboard.
    let keyboard = Arc::new(Keyboard::queued());
    keyboard.push(Event::Key(KeyEvent::new(
        KeyCode::Char('h'),
        KeyModifiers::NONE,
    )));

    let submitted = Arc::new(Mutex::new(Vec::<String>::new()));
    let submitted_for_callback = submitted.clone();
    editor.on_submit(Arc::new(move |text: &str| {
        submitted_for_callback.lock().unwrap().push(text.to_string());
    }));

    let screen = startup_screen(&tui, &editor);
    tui.set_layout_root(Some(screen as Arc<dyn Component>));
    tui.set_focus(Some(editor.clone()));
    editor.set_focused(true);
    tui.start_readerless_preserving_input();

    // The key loop takes the key that arrived before the screen was ready.
    let state = test_state();
    match keyboard.next_event(Duration::from_millis(50)) {
        KeyInput::Event(Event::Key(key)) => {
            dispatch_key_to_editor(&state, &editor, &tui, &key)
        }
        other => panic!("expected the queued key, got {other:?}"),
    }
    assert_eq!(editor.get_text(), "h");

    // The screen shows the character in the input box.
    tui.render_now(true);
    let painted = output.lock().unwrap().clone();
    let visible = rpi_tui::strip_ansi(&painted);
    assert!(
        visible.contains("> h"),
        "the input box does not show the character:\n{visible}"
    );

    // Enter submits the text.
    keyboard.push(Event::Key(KeyEvent::new(
        KeyCode::Enter,
        KeyModifiers::NONE,
    )));
    match keyboard.next_event(Duration::from_millis(50)) {
        KeyInput::Event(Event::Key(key)) => {
            dispatch_key_to_editor(&state, &editor, &tui, &key)
        }
        other => panic!("expected the queued key, got {other:?}"),
    }
    assert_eq!(
        submitted.lock().unwrap().clone(),
        vec!["h".to_string()],
        "Enter did not submit the text"
    );
}

#[test]
fn the_startup_screen_keeps_the_input_box_up_while_the_session_is_empty() {
    let output = Arc::new(Mutex::new(String::new()));
    let tui = Arc::new(TuiAltScreen::new(
        Box::new(FakeTerminal::new(output.clone())),
        false,
        None,
    ));
    let editor = Arc::new(Editor::new(
        EditorOptions {
            padding_x: 1,
            ..Default::default()
        },
        EditorStyle::default(),
        super::configured_keybindings(),
    ));
    let screen = startup_screen(&tui, &editor);
    tui.set_layout_root(Some(screen as Arc<dyn Component>));
    tui.set_focus(Some(editor.clone()));
    editor.set_focused(true);
    tui.start_readerless_preserving_input();
    tui.render_now(true);
    let painted = output.lock().unwrap().clone();
    let visible = rpi_tui::strip_ansi(&painted);
    assert!(
        visible.contains("what are we building today?"),
        "the greeting is missing:\n{visible}"
    );
    assert!(
        visible.contains("> "),
        "the input box is missing:\n{visible}"
    );
}
