//! Prints the 3D pi logo at a given elapsed time, one line per row.
//!
//! Usage: cargo run -p rpi-tui --example logo3d -- <elapsed-seconds>

use rpi_tui::logo3d::Logo3d;

fn main() {
    let elapsed: f64 = std::env::args()
        .nth(1)
        .and_then(|value| value.parse().ok())
        .unwrap_or(0.0);
    let logo = Logo3d::with_start([0.0, 0.0, 0.0], 0.0);
    for line in logo.render_lines(100, elapsed) {
        println!("{line}");
    }
}
