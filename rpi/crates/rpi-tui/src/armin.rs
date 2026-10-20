//! Armin says hi! — an easter egg with animated XBM art.
//!
//! Port of `packages/coding-agent/src/modes/interactive/components/armin.ts`.
//!
//! The original drives the animation from a `setInterval` timer. The port
//! keeps the animation state in the component, so a host (or a test) advances
//! it with [`ArminComponent::tick`] and the renderer stays a pure function of
//! the current grid.

use std::any::Any;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use super::component::Component;
use crate::theme::theme;

/// Width of the XBM image in pixels.
pub const ARMIN_WIDTH: usize = 31;
/// Height of the XBM image in pixels.
pub const ARMIN_HEIGHT: usize = 36;

/// Bytes per bitmap row (31 pixels → 4 bytes).
const BYTES_PER_ROW: usize = ARMIN_WIDTH.div_ceil(8);
/// Height of the rendered grid: two pixels per cell (half blocks).
const DISPLAY_HEIGHT: usize = ARMIN_HEIGHT.div_ceil(2);

/// XBM image: 31x36 pixels, LSB first, 1 = background, 0 = foreground.
const BITS: [u8; 144] = [
    0xff, 0xff, 0xff, 0x7f, 0xff, 0xf0, 0xff, 0x7f, 0xff, 0xed, 0xff, 0x7f, 0xff, 0xdb, 0xff, 0x7f, 0xff, 0xb7, 0xff,
    0x7f, 0xff, 0x77, 0xfe, 0x7f, 0x3f, 0xf8, 0xfe, 0x7f, 0xdf, 0xff, 0xfe, 0x7f, 0xdf, 0x3f, 0xfc, 0x7f, 0x9f, 0xc3,
    0xfb, 0x7f, 0x6f, 0xfc, 0xf4, 0x7f, 0xf7, 0x0f, 0xf7, 0x7f, 0xf7, 0xff, 0xf7, 0x7f, 0xf7, 0xff, 0xe3, 0x7f, 0xf7,
    0x07, 0xe8, 0x7f, 0xef, 0xf8, 0x67, 0x70, 0x0f, 0xff, 0xbb, 0x6f, 0xf1, 0x00, 0xd0, 0x5b, 0xfd, 0x3f, 0xec, 0x53,
    0xc1, 0xff, 0xef, 0x57, 0x9f, 0xfd, 0xee, 0x5f, 0x9f, 0xfc, 0xae, 0x5f, 0x1f, 0x78, 0xac, 0x5f, 0x3f, 0x00, 0x50,
    0x6c, 0x7f, 0x00, 0xdc, 0x77, 0xff, 0xc0, 0x3f, 0x78, 0xff, 0x01, 0xf8, 0x7f, 0xff, 0x03, 0x9c, 0x78, 0xff, 0x07,
    0x8c, 0x7c, 0xff, 0x0f, 0xce, 0x78, 0xff, 0xff, 0xcf, 0x7f, 0xff, 0xff, 0xcf, 0x78, 0xff, 0xff, 0xdf, 0x78, 0xff,
    0xff, 0xdf, 0x7d, 0xff, 0xff, 0x3f, 0x7e, 0xff, 0xff, 0xff, 0x7f,
];

/// The text under the image.
const MESSAGE: &str = "ARMIN SAYS HI";

/// Pixel at `(x, y)`: `true` = foreground (ink), `false` = background.
pub fn is_armin_pixel(x: usize, y: usize) -> bool {
    if y >= ARMIN_HEIGHT {
        return false;
    }
    let byte_index = y * BYTES_PER_ROW + (x / 8);
    let bit_index = x % 8;
    ((BITS[byte_index] >> bit_index) & 1) == 0
}

/// The character for a cell (two vertical pixels packed into one glyph).
fn cell_char(x: usize, row: usize) -> char {
    let upper = is_armin_pixel(x, row * 2);
    let lower = is_armin_pixel(x, row * 2 + 1);
    if upper && lower {
        '█'
    } else if upper {
        '▀'
    } else if lower {
        '▄'
    } else {
        ' '
    }
}

/// The fully drawn image.
fn build_final_grid() -> Vec<Vec<char>> {
    (0..DISPLAY_HEIGHT)
        .map(|row| (0..ARMIN_WIDTH).map(|x| cell_char(x, row)).collect())
        .collect()
}

/// The animation effect played when the component runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArminEffect {
    /// Pixels appear left to right, three per frame.
    Typewriter,
    /// Rows are filled from the top, one row per frame.
    Scanline,
    /// A drop falls down every column and leaves a trail.
    Rain,
    /// Pixels appear in a shuffled order.
    Fade,
    /// The image opens from the middle outwards.
    Crt,
    /// The image jitters before it settles.
    Glitch,
    /// Noise resolves into the image.
    Dissolve,
}

impl ArminEffect {
    /// All effects, in the order the original picks them.
    const ALL: [ArminEffect; 7] = [
        ArminEffect::Typewriter,
        ArminEffect::Scanline,
        ArminEffect::Rain,
        ArminEffect::Fade,
        ArminEffect::Crt,
        ArminEffect::Glitch,
        ArminEffect::Dissolve,
    ];

    /// The effect at `index` (wrapping).
    fn from_index(index: usize) -> ArminEffect {
        Self::ALL[index % Self::ALL.len()]
    }
}

/// A falling drop of the rain effect.
#[derive(Debug, Clone, Copy)]
struct Drop {
    y: i64,
    settled: usize,
}

/// Per-effect animation state.
#[derive(Debug, Clone)]
enum EffectState {
    Typewriter {
        pos: usize,
    },
    Scanline {
        row: usize,
    },
    Rain {
        drops: Vec<Drop>,
    },
    Fade {
        positions: Vec<(usize, usize)>,
        idx: usize,
    },
    Crt {
        expansion: i64,
    },
    Glitch {
        phase: usize,
        glitch_frames: usize,
    },
    Dissolve {
        positions: Vec<(usize, usize)>,
        idx: usize,
    },
}

/// The mutable animation state.
#[derive(Debug, Clone)]
struct ArminState {
    effect: ArminEffect,
    /// Seed of the internal PRNG; drives the shuffling effects.
    seed: u64,
    /// The image the effects reveal.
    final_grid: Vec<Vec<char>>,
    /// The grid as it looks right now.
    grid: Vec<Vec<char>>,
    effect_state: EffectState,
}

impl ArminState {
    /// The next random number in `[0, 1)`.
    fn next_random(&mut self) -> f64 {
        let mut x = self.seed;
        if x == 0 {
            x = 0x9E37_79B9_7F4A_7C15;
        }
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.seed = x;
        let value = x.wrapping_mul(0x2545_F491_4F6C_DD1D);
        (value >> 11) as f64 / (1u64 << 53) as f64
    }

    /// All cell positions of the grid, in row-major order.
    fn all_positions() -> Vec<(usize, usize)> {
        let mut positions = Vec::with_capacity(DISPLAY_HEIGHT * ARMIN_WIDTH);
        for row in 0..DISPLAY_HEIGHT {
            for x in 0..ARMIN_WIDTH {
                positions.push((row, x));
            }
        }
        positions
    }

    /// Fisher-Yates shuffle driven by the internal PRNG.
    fn shuffle(&mut self, positions: &mut Vec<(usize, usize)>) {
        for i in (1..positions.len()).rev() {
            let j = (self.next_random() * (i + 1) as f64).floor() as usize;
            positions.swap(i, j);
        }
    }

    /// Build the initial state for `effect`.
    fn new(effect: ArminEffect, seed: u64) -> Self {
        let mut state = Self {
            effect,
            seed: if seed == 0 { 0x9E37_79B9_7F4A_7C15 } else { seed },
            final_grid: build_final_grid(),
            grid: vec![vec![' '; ARMIN_WIDTH]; DISPLAY_HEIGHT],
            effect_state: EffectState::Typewriter { pos: 0 },
        };

        state.effect_state = match effect {
            ArminEffect::Typewriter => EffectState::Typewriter { pos: 0 },
            ArminEffect::Scanline => EffectState::Scanline { row: 0 },
            ArminEffect::Rain => {
                let mut drops = Vec::with_capacity(ARMIN_WIDTH);
                for _ in 0..ARMIN_WIDTH {
                    let y = -(state.next_random() * (DISPLAY_HEIGHT * 2) as f64).floor() as i64;
                    drops.push(Drop { y, settled: 0 });
                }
                EffectState::Rain { drops }
            }
            ArminEffect::Fade => {
                let mut positions = Self::all_positions();
                state.shuffle(&mut positions);
                EffectState::Fade { positions, idx: 0 }
            }
            ArminEffect::Crt => EffectState::Crt { expansion: 0 },
            ArminEffect::Glitch => EffectState::Glitch {
                phase: 0,
                glitch_frames: 8,
            },
            ArminEffect::Dissolve => {
                const NOISE: [char; 7] = [' ', '░', '▒', '▓', '█', '▀', '▄'];
                let mut grid = vec![vec![' '; ARMIN_WIDTH]; DISPLAY_HEIGHT];
                for row in 0..DISPLAY_HEIGHT {
                    for x in 0..ARMIN_WIDTH {
                        let index = (state.next_random() * NOISE.len() as f64).floor() as usize;
                        grid[row][x] = NOISE[index.min(NOISE.len() - 1)];
                    }
                }
                state.grid = grid;
                let mut positions = Self::all_positions();
                state.shuffle(&mut positions);
                EffectState::Dissolve { positions, idx: 0 }
            }
        };

        state
    }
}

/// The Armin easter egg component.
pub struct ArminComponent {
    state: Mutex<ArminState>,
}

/// A fresh seed for a randomly chosen effect.
fn random_seed() -> u64 {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    nanos ^ counter.wrapping_mul(0x9E37_79B9_7F4A_7C15)
}

impl ArminComponent {
    /// Create a component with a randomly chosen effect.
    pub fn new() -> Self {
        let seed = random_seed();
        let effect = ArminEffect::from_index((seed % ArminEffect::ALL.len() as u64) as usize);
        Self {
            state: Mutex::new(ArminState::new(effect, seed)),
        }
    }

    /// Create a component with a fixed effect.
    ///
    /// The animation is deterministic: the same effect always plays the same
    /// frames, because the internal PRNG is seeded from a constant.
    pub fn with_effect(effect: ArminEffect) -> Self {
        Self {
            state: Mutex::new(ArminState::new(effect, 0x1234_5678_9ABC_DEF0)),
        }
    }

    /// The effect this component plays.
    pub fn effect(&self) -> ArminEffect {
        self.state
            .lock()
            .map(|s| s.effect)
            .unwrap_or(ArminEffect::Typewriter)
    }

    /// Advance the animation by one frame.
    ///
    /// Returns `true` when the effect has finished.
    pub fn tick(&self) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return true;
        };
        match state.effect {
            ArminEffect::Typewriter => tick_typewriter(&mut state),
            ArminEffect::Scanline => tick_scanline(&mut state),
            ArminEffect::Rain => tick_rain(&mut state),
            ArminEffect::Fade => tick_fade(&mut state),
            ArminEffect::Crt => tick_crt(&mut state),
            ArminEffect::Glitch => tick_glitch(&mut state),
            ArminEffect::Dissolve => tick_dissolve(&mut state),
        }
    }
}

impl Default for ArminComponent {
    fn default() -> Self {
        Self::new()
    }
}

/// Draw three pixels of the image, left to right.
fn tick_typewriter(state: &mut ArminState) -> bool {
    let EffectState::Typewriter { pos } = &mut state.effect_state else {
        return true;
    };
    for _ in 0..3 {
        let row = *pos / ARMIN_WIDTH;
        let x = *pos % ARMIN_WIDTH;
        if row >= DISPLAY_HEIGHT {
            return true;
        }
        let ch = state.final_grid[row][x];
        state.grid[row][x] = ch;
        *pos += 1;
    }
    false
}

/// Draw one row of the image.
fn tick_scanline(state: &mut ArminState) -> bool {
    let EffectState::Scanline { row } = &mut state.effect_state else {
        return true;
    };
    if *row >= DISPLAY_HEIGHT {
        return true;
    }
    for x in 0..ARMIN_WIDTH {
        let ch = state.final_grid[*row][x];
        state.grid[*row][x] = ch;
    }
    *row += 1;
    false
}

/// Let a drop fall down every column and settle on the image.
fn tick_rain(state: &mut ArminState) -> bool {
    let mut drops = match std::mem::replace(
        &mut state.effect_state,
        EffectState::Typewriter { pos: 0 },
    ) {
        EffectState::Rain { drops } => drops,
        _ => return true,
    };

    let mut all_settled = true;
    state.grid = vec![vec![' '; ARMIN_WIDTH]; DISPLAY_HEIGHT];

    for x in 0..ARMIN_WIDTH {
        let drop = &mut drops[x];

        let first_settled_row = DISPLAY_HEIGHT as i64 - drop.settled as i64;
        let mut row = DISPLAY_HEIGHT as i64 - 1;
        while row >= first_settled_row {
            if row >= 0 {
                let ch = state.final_grid[row as usize][x];
                state.grid[row as usize][x] = ch;
            }
            row -= 1;
        }

        if drop.settled >= DISPLAY_HEIGHT {
            continue;
        }
        all_settled = false;

        let mut target_row: i64 = -1;
        let mut row = DISPLAY_HEIGHT as i64 - 1 - drop.settled as i64;
        while row >= 0 {
            if state.final_grid[row as usize][x] != ' ' {
                target_row = row;
                break;
            }
            row -= 1;
        }

        if target_row < 0 {
            // Nothing is left above the settled pixels, so the column is done.
            // The original keeps such a drop falling below the picture for
            // ever; the port ends the effect instead.
            drop.settled = DISPLAY_HEIGHT;
            continue;
        }

        drop.y += 1;

        if drop.y >= 0 && drop.y < DISPLAY_HEIGHT as i64 {
            if drop.y >= target_row {
                drop.settled = DISPLAY_HEIGHT - target_row as usize;
                drop.y = -(state.next_random() * 5.0).floor() as i64 - 1;
            } else {
                state.grid[drop.y as usize][x] = '▓';
            }
        }
    }

    state.effect_state = EffectState::Rain { drops };
    all_settled
}

/// Reveal fifteen pixels in a shuffled order.
fn tick_fade(state: &mut ArminState) -> bool {
    let EffectState::Fade { positions, idx } = &mut state.effect_state else {
        return true;
    };
    for _ in 0..15 {
        if *idx >= positions.len() {
            return true;
        }
        let (row, x) = positions[*idx];
        let ch = state.final_grid[row][x];
        state.grid[row][x] = ch;
        *idx += 1;
    }
    false
}

/// Open the image from the middle outwards.
fn tick_crt(state: &mut ArminState) -> bool {
    let EffectState::Crt { expansion } = &mut state.effect_state else {
        return true;
    };
    let mid_row = (DISPLAY_HEIGHT / 2) as i64;
    state.grid = vec![vec![' '; ARMIN_WIDTH]; DISPLAY_HEIGHT];

    let top = mid_row - *expansion;
    let bottom = mid_row + *expansion;
    let mut row = top.max(0);
    while row <= bottom.min(DISPLAY_HEIGHT as i64 - 1) {
        for x in 0..ARMIN_WIDTH {
            let ch = state.final_grid[row as usize][x];
            state.grid[row as usize][x] = ch;
        }
        row += 1;
    }

    *expansion += 1;
    *expansion > DISPLAY_HEIGHT as i64
}

/// Jitter the image for a few frames, then show it clean.
fn tick_glitch(state: &mut ArminState) -> bool {
    let (mut phase, glitch_frames) = match std::mem::replace(
        &mut state.effect_state,
        EffectState::Typewriter { pos: 0 },
    ) {
        EffectState::Glitch {
            phase,
            glitch_frames,
        } => (phase, glitch_frames),
        _ => return true,
    };

    if phase < glitch_frames {
        let mut grid = vec![vec![' '; ARMIN_WIDTH]; DISPLAY_HEIGHT];
        for row in 0..DISPLAY_HEIGHT {
            let offset = (state.next_random() * 7.0).floor() as i64 - 3;
            if state.next_random() < 0.3 {
                let shift = offset.rem_euclid(ARMIN_WIDTH as i64) as usize;
                for x in 0..ARMIN_WIDTH {
                    let ch = state.final_grid[row][(x + shift) % ARMIN_WIDTH];
                    grid[row][x] = ch;
                }
                continue;
            }
            if state.next_random() < 0.2 {
                let swap_row = (state.next_random() * DISPLAY_HEIGHT as f64).floor() as usize;
                grid[row] = state.final_grid[swap_row].clone();
                continue;
            }
            grid[row] = state.final_grid[row].clone();
        }
        state.grid = grid;
        phase += 1;
        state.effect_state = EffectState::Glitch {
            phase,
            glitch_frames,
        };
        return false;
    }

    state.grid = state.final_grid.clone();
    state.effect_state = EffectState::Glitch {
        phase,
        glitch_frames,
    };
    true
}

/// Resolve twenty noise cells into the image per frame.
fn tick_dissolve(state: &mut ArminState) -> bool {
    let EffectState::Dissolve { positions, idx } = &mut state.effect_state else {
        return true;
    };
    for _ in 0..20 {
        if *idx >= positions.len() {
            return true;
        }
        let (row, x) = positions[*idx];
        let ch = state.final_grid[row][x];
        state.grid[row][x] = ch;
        *idx += 1;
    }
    false
}

impl Component for ArminComponent {
    fn render(&self, width: usize) -> Vec<String> {
        let Ok(state) = self.state.lock() else {
            return Vec::new();
        };
        let colors = theme().colors;
        let padding = 1usize;
        let available = width.saturating_sub(padding);

        let mut lines = Vec::with_capacity(DISPLAY_HEIGHT + 1);
        for row in &state.grid {
            let clipped: String = row.iter().take(available).collect();
            let pad_right = width.saturating_sub(padding + clipped.chars().count());
            lines.push(format!(
                " {}{}",
                colors.accent.fg(&clipped),
                " ".repeat(pad_right)
            ));
        }

        let pad_right = width.saturating_sub(padding + MESSAGE.chars().count());
        lines.push(format!(
            " {}{}",
            colors.accent.fg(MESSAGE),
            " ".repeat(pad_right)
        ));
        lines
    }

    fn invalidate(&self) {
        // No cached state: every render reads the current grid.
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ansi::strip_ansi;

    fn final_grid() -> Vec<Vec<char>> {
        build_final_grid()
    }

    fn rendered_grid(component: &ArminComponent, width: usize) -> Vec<String> {
        let lines = component.render(width);
        lines[..DISPLAY_HEIGHT]
            .iter()
            .map(|line| {
                let plain = strip_ansi(line);
                plain.chars().skip(1).take(ARMIN_WIDTH).collect()
            })
            .collect()
    }

    fn expected_rows() -> Vec<String> {
        final_grid()
            .iter()
            .map(|row| row.iter().collect::<String>())
            .collect()
    }

    #[test]
    fn test_bitmap_decodes_to_expected_shape() {
        assert_eq!(ARMIN_WIDTH, 31);
        assert_eq!(ARMIN_HEIGHT, 36);
        let grid = final_grid();
        assert_eq!(grid.len(), DISPLAY_HEIGHT);
        assert_eq!(DISPLAY_HEIGHT, 18);
        for row in &grid {
            assert_eq!(row.len(), ARMIN_WIDTH);
            for ch in row {
                assert!(
                    matches!(ch, '█' | '▀' | '▄' | ' '),
                    "unexpected cell character: {ch:?}"
                );
            }
        }
    }

    #[test]
    fn test_bitmap_has_ink() {
        let ink = (0..ARMIN_HEIGHT)
            .flat_map(|y| (0..ARMIN_WIDTH).map(move |x| (x, y)))
            .filter(|&(x, y)| is_armin_pixel(x, y))
            .count();
        assert!(ink > 0, "the bitmap must have ink");
        assert!(!is_armin_pixel(0, ARMIN_HEIGHT));
    }

    #[test]
    fn test_typewriter_completes_the_image() {
        let component = ArminComponent::with_effect(ArminEffect::Typewriter);
        assert_eq!(component.effect(), ArminEffect::Typewriter);

        let mut done = false;
        for _ in 0..1000 {
            if component.tick() {
                done = true;
                break;
            }
        }
        assert!(done, "the typewriter effect must finish");
        assert_eq!(rendered_grid(&component, 40), expected_rows());
    }

    #[test]
    fn test_scanline_fills_one_row_per_tick() {
        let component = ArminComponent::with_effect(ArminEffect::Scanline);
        let expected = final_grid();

        for row in 0..DISPLAY_HEIGHT {
            assert!(!component.tick(), "row {row} must not end the effect");
            let rendered = rendered_grid(&component, 40);
            for (r, line) in rendered.iter().enumerate() {
                let chars: Vec<char> = line.chars().collect();
                if r <= row {
                    assert_eq!(chars, expected[r], "row {r} must be final");
                } else {
                    assert!(
                        chars.iter().all(|c| *c == ' '),
                        "row {r} must still be empty"
                    );
                }
            }
        }
        assert!(component.tick(), "the scanline effect must finish");
        assert_eq!(rendered_grid(&component, 40), expected_rows());
    }

    #[test]
    fn test_render_includes_the_message_line() {
        let component = ArminComponent::with_effect(ArminEffect::Typewriter);
        let lines = component.render(40);
        assert_eq!(lines.len(), DISPLAY_HEIGHT + 1);
        let last = strip_ansi(&lines[DISPLAY_HEIGHT]);
        assert!(last.starts_with(' '));
        assert!(last.contains(MESSAGE));
        assert_eq!(crate::ansi::visible_width(&lines[DISPLAY_HEIGHT]), 40);
    }

    #[test]
    fn test_render_clips_to_width() {
        let component = ArminComponent::with_effect(ArminEffect::Scanline);
        let lines = component.render(20);
        assert_eq!(lines.len(), DISPLAY_HEIGHT + 1);
        for line in &lines {
            assert_eq!(crate::ansi::visible_width(line), 20);
        }
    }

    #[test]
    fn test_random_effect_is_one_of_the_seven() {
        let component = ArminComponent::new();
        assert!(ArminEffect::ALL.contains(&component.effect()));
    }

    #[test]
    fn test_fade_effect_completes() {
        let component = ArminComponent::with_effect(ArminEffect::Fade);
        let mut done = false;
        for _ in 0..1000 {
            if component.tick() {
                done = true;
                break;
            }
        }
        assert!(done);
        assert_eq!(rendered_grid(&component, 40), expected_rows());
    }

    #[test]
    fn test_glitch_effect_ends_with_the_clean_image() {
        let component = ArminComponent::with_effect(ArminEffect::Glitch);
        let mut done = false;
        for _ in 0..1000 {
            if component.tick() {
                done = true;
                break;
            }
        }
        assert!(done);
        assert_eq!(rendered_grid(&component, 40), expected_rows());
    }

    #[test]
    fn test_crt_effect_completes() {
        let component = ArminComponent::with_effect(ArminEffect::Crt);
        let mut done = false;
        for _ in 0..1000 {
            if component.tick() {
                done = true;
                break;
            }
        }
        assert!(done);
        assert_eq!(rendered_grid(&component, 40), expected_rows());
    }

    #[test]
    fn test_rain_effect_completes() {
        let component = ArminComponent::with_effect(ArminEffect::Rain);
        let mut done = false;
        for _ in 0..20000 {
            if component.tick() {
                done = true;
                break;
            }
        }
        assert!(done);
    }

    #[test]
    fn test_dissolve_effect_completes() {
        let component = ArminComponent::with_effect(ArminEffect::Dissolve);
        let mut done = false;
        for _ in 0..1000 {
            if component.tick() {
                done = true;
                break;
            }
        }
        assert!(done);
        assert_eq!(rendered_grid(&component, 40), expected_rows());
    }

    #[test]
    fn test_with_effect_is_deterministic() {
        let a = ArminComponent::with_effect(ArminEffect::Dissolve);
        let b = ArminComponent::with_effect(ArminEffect::Dissolve);
        assert_eq!(rendered_grid(&a, 40), rendered_grid(&b, 40));
        a.tick();
        b.tick();
        assert_eq!(rendered_grid(&a, 40), rendered_grid(&b, 40));
    }
}
