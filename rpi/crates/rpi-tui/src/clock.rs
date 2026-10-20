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
