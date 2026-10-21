//! The interactive mode's keyboard.
//!
//! The mode reads the keyboard through an [`InputSource`]. The source is
//! created before the screen is assembled, so the input is live from the first
//! moment: the events that arrive while the screen is still being built wait
//! in the source until the key loop picks them up.
//!
//! The original starts its UI before the rest of the startup finishes and
//! keeps the input stream whole (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:1100`):
//! the text the user typed during the startup reaches the editor.

use std::collections::VecDeque;
use std::sync::{Condvar, Mutex};
use std::time::Duration;

use crossterm::event::Event;

/// What the keyboard produced.
#[derive(Debug)]
pub(crate) enum KeyInput {
    /// A terminal event.
    Event(Event),
    /// Nothing arrived before the timeout.
    Idle,
    /// The keyboard is gone.
    Failed,
}

/// The keyboard the interactive mode reads.
pub(crate) trait InputSource: Send + Sync + 'static {
    /// The next event, waiting up to `timeout` for one.
    fn next_event(&self, timeout: Duration) -> KeyInput;
}

/// The real terminal's keyboard.
pub(crate) struct TerminalInput;

impl InputSource for TerminalInput {
    fn next_event(&self, timeout: Duration) -> KeyInput {
        match crossterm::event::poll(timeout) {
            Ok(true) => match crossterm::event::read() {
                Ok(event) => KeyInput::Event(event),
                Err(_) => KeyInput::Failed,
            },
            Ok(false) => KeyInput::Idle,
            Err(_) => KeyInput::Failed,
        }
    }
}

/// The interactive mode's keyboard: the terminal, plus the events that were
/// read before the key loop started.
///
/// The events that wait in the queue are the ones the terminal's colour query
/// read while it waited for the terminal's reply. They are the user's
/// keystrokes, and they are replayed before the terminal's own events.
pub(crate) struct Keyboard {
    pending: Mutex<VecDeque<Event>>,
    signal: Condvar,
    source: Option<Box<dyn InputSource>>,
}

impl Keyboard {
    /// A keyboard that reads the real terminal.
    pub(crate) fn terminal() -> Self {
        Self {
            pending: Mutex::new(VecDeque::new()),
            signal: Condvar::new(),
            source: Some(Box::new(TerminalInput)),
        }
    }

    /// A keyboard that only has the events that were put into it.
    pub(crate) fn queued() -> Self {
        Self {
            pending: Mutex::new(VecDeque::new()),
            signal: Condvar::new(),
            source: None,
        }
    }

    /// Put an event into the queue. The event waits until the key loop takes
    /// it.
    pub(crate) fn push(&self, event: Event) {
        let mut pending = self.pending.lock().unwrap();
        pending.push_back(event);
        self.signal.notify_all();
    }

    /// The next event, waiting up to `timeout` for one.
    pub(crate) fn next_event(&self, timeout: Duration) -> KeyInput {
        // The events that were read before the key loop started come first:
        // they are older than the terminal's own events.
        if let Some(event) = self.take_pending() {
            return KeyInput::Event(event);
        }
        let Some(source) = &self.source else {
            // No terminal: wait for an event that is put into the queue.
            let mut pending = self.pending.lock().unwrap();
            if pending.is_empty() {
                let (next, _) = self
                    .signal
                    .wait_timeout(pending, timeout)
                    .unwrap_or_else(|error| error.into_inner());
                pending = next;
            }
            return match pending.pop_front() {
                Some(event) => KeyInput::Event(event),
                None => KeyInput::Idle,
            };
        };
        let event = source.next_event(timeout);
        if let Some(event) = self.take_pending() {
            return KeyInput::Event(event);
        }
        event
    }

    /// Take the next queued event, if there is one.
    fn take_pending(&self) -> Option<Event> {
        self.pending.lock().unwrap().pop_front()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

    #[test]
    fn a_queued_event_waits_for_the_reader() {
        let keyboard = Keyboard::queued();
        keyboard.push(Event::Key(KeyEvent::new(
            KeyCode::Char('h'),
            KeyModifiers::NONE,
        )));
        match keyboard.next_event(Duration::from_millis(10)) {
            KeyInput::Event(Event::Key(key)) => assert_eq!(key.code, KeyCode::Char('h')),
            other => panic!("expected the queued key, got {other:?}"),
        }
        assert!(matches!(
            keyboard.next_event(Duration::from_millis(10)),
            KeyInput::Idle
        ));
    }

    #[test]
    fn the_queue_keeps_the_order_of_the_events() {
        let keyboard = Keyboard::queued();
        keyboard.push(Event::Key(KeyEvent::new(
            KeyCode::Char('a'),
            KeyModifiers::NONE,
        )));
        keyboard.push(Event::Key(KeyEvent::new(
            KeyCode::Char('b'),
            KeyModifiers::NONE,
        )));
        let first = keyboard.next_event(Duration::from_millis(10));
        let second = keyboard.next_event(Duration::from_millis(10));
        assert!(matches!(
            first,
            KeyInput::Event(Event::Key(KeyEvent {
                code: KeyCode::Char('a'),
                ..
            }))
        ));
        assert!(matches!(
            second,
            KeyInput::Event(Event::Key(KeyEvent {
                code: KeyCode::Char('b'),
                ..
            }))
        ));
    }
}
