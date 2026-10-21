//! The transcript's horizontal padding (`outputPad`).
//!
//! Upstream hands the padding to every transcript component as it is built
//! (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:3196`,
//! `:3356`). The port builds those components from many places, so the
//! setting lives in one place: a component that is built after the setting
//! changed picks the new value up.

use std::sync::atomic::{AtomicUsize, Ordering};

static OUTPUT_PAD: AtomicUsize = AtomicUsize::new(1);

/// The padding every transcript block gets.
pub fn output_pad() -> usize {
    OUTPUT_PAD.load(Ordering::Relaxed)
}

/// Set the padding every transcript block gets.
pub fn set_output_pad(pad: usize) {
    OUTPUT_PAD.store(pad, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pad_defaults_to_one_and_follows_the_setting() {
        assert_eq!(output_pad(), 1);
        set_output_pad(0);
        assert_eq!(output_pad(), 0);
        set_output_pad(1);
        assert_eq!(output_pad(), 1);
    }
}
