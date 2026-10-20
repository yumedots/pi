//! The clock the animated components read.
//!
//! The parity harness sets `PI_PARITY_CLOCK` to a file holding the virtual
//! time in milliseconds. When it is set, every read returns that value, so two
//! implementations of the same animation render the same frame.

use std::sync::LazyLock;
use std::time::Instant;

static START: LazyLock<Instant> = LazyLock::new(Instant::now);

/// Milliseconds since the process started, or the harness's virtual time.
pub fn now_ms() -> f64 {
    if let Some(path) = std::env::var_os("PI_PARITY_CLOCK") {
        if let Ok(text) = std::fs::read_to_string(path) {
            if let Ok(value) = text.trim().parse::<f64>() {
                return value;
            }
        }
    }
    START.elapsed().as_secs_f64() * 1000.0
}

/// The wall clock, in milliseconds since the process started.
///
/// The harness freezes `now_ms` so two implementations of the same animation
/// render the same frame, but a *duration* is measured against the real time
/// — the original reads the wall clock for its timings
/// (`packages/coding-agent/src/modes/interactive/components/assistant-message.ts:100-108`
/// uses `Date.now()`, and the harness freezes only `performance.now()`).
pub fn wall_now_ms() -> f64 {
    START.elapsed().as_secs_f64() * 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_wall_clock_moves_even_when_the_animation_clock_is_frozen() {
        let first = wall_now_ms();
        std::thread::sleep(std::time::Duration::from_millis(12));
        assert!(
            wall_now_ms() - first >= 10.0,
            "the wall clock must advance: a duration is measured against it"
        );
    }
}
