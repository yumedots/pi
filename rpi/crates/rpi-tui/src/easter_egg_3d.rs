//! The fullscreen 3D easter egg: the pi logo and Armin.
//!
//! Port of `packages/coding-agent/src/modes/interactive/components/easter-egg-3d.ts`.
//!
//! The captured screen dissolves into braille dust while a 3D model spins in the
//! centre of the screen and its blocks play a sliding puzzle. Leaving plays the
//! same timeline backwards, so the screen reassembles.
//!
//! The blocks are ray cast per braille dot, reusing the ray caster of
//! [`crate::logo3d`]. A braille cell holds 2x4 roughly square dots, so one pixel
//! of a half-block bitmap is exactly 2x2 dots, and the header logo (4x2 cells)
//! is 8x8 dots when it lifts off.

use std::any::Any;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use unicode_segmentation::UnicodeSegmentation;

use crate::ansi::{background_rgb, foreground_rgb, visible_width};
use crate::armin::{is_armin_pixel, ARMIN_HEIGHT, ARMIN_WIDTH};
use crate::component::Component;
use crate::keybinding_hints::format_combo;
use crate::keybindings::keys;
use crate::logo3d::{
    hash, is_light, mix, prepare_stars, smooth, spin_angle, spin_phase, star_color, star_level,
    Block, BlockRaster, Box3, Model, Pose, Rgb, LIGHT_HALO_STRENGTH,
};
use crate::theme::{theme, Color};

/// How deep a block reaches, in model pixels.
const DEPTH: f64 = 0.7;
/// When the model lifts off.
const FLY_START: f64 = 0.1;
/// How long the flight to the centre takes.
const FLY_DURATION: f64 = 1.3;
/// Braille dots per pixel when a model without an origin appears, growing from a
/// speck at the centre.
const START_SCALE: f64 = 0.1;

/// When the sliding puzzle starts.
const PUZZLE_START: f64 = FLY_START + FLY_DURATION + 3.0;
/// How long one shuffle step takes.
const PUZZLE_STEP: f64 = 0.3;
/// How many shuffle steps one cycle has.
const PUZZLE_STEPS: usize = 12;
/// How long the blocks take to fly home.
const PUZZLE_RETURN: f64 = 1.0;
/// How long the assembled model is held.
const PUZZLE_HOLD: f64 = 0.6;
/// How long one full puzzle cycle takes.
const PUZZLE_CYCLE: f64 = PUZZLE_STEP * PUZZLE_STEPS as f64 + PUZZLE_RETURN + PUZZLE_HOLD;

/// How long a cell takes to turn into dust.
const DUST_DURATION: f64 = 0.35;
/// How long the dust wave takes to cross the screen.
const WAVE_SPREAD: f64 = 0.55;
/// How much the dust wave's timing varies per cell.
const WAVE_JITTER: f64 = 0.12;
/// When the last cell has dissolved.
const DISSOLVE_END: f64 = FLY_START + WAVE_SPREAD + WAVE_JITTER + DUST_DURATION;
/// How long the screen's background colours fade into the terminal's.
const BACKGROUND_FADE: f64 = 0.5;
/// How long the exit animation takes.
const EXIT_DURATION: f64 = 1.1;
/// When the starfield starts to fade in.
const STARS_START: f64 = 2.5;
/// How long the starfield takes to fade in.
const STARS_FADE: f64 = 2.0;
/// How much the logo's colours are quantized.
const LOGO_COLOR_STEP: f64 = 5.0;
/// How long the hint takes to fade in.
const HINT_FADE: f64 = 0.5;

/// When the show ends and the exit animation starts.
const SHOW_END: f64 = PUZZLE_START + PUZZLE_CYCLE;
/// The whole timeline, exit animation included.
const TOTAL_DURATION: f64 = SHOW_END + EXIT_DURATION;

/// Braille dot bits, indexed by row * 2 + column within the 2x4 cell.
const DOT_BITS: [u8; 8] = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80];

/// The moves a block may take in one shuffle step.
const PUZZLE_MOVES: [[i32; 3]; 10] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
];

/// Which easter egg to play.
///
/// The pi logo lifts off the header logo, whose top-left cell is at
/// `column`, `row`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EasterEgg3d {
    /// The pi logo, lifting off the header logo at `column`, `row`.
    PiLogo {
        /// The header logo's leftmost column.
        column: usize,
        /// The header logo's topmost row.
        row: usize,
    },
    /// Armin, growing out of a speck at the centre of the screen.
    Armin,
}

/// One cell of the captured screen.
#[derive(Clone, Debug)]
struct ScreenCell {
    /// The cell's text; empty for the second column of a wide grapheme.
    text: String,
    /// 1 or 2 for a grapheme, 0 for the second column of a wide grapheme.
    width: usize,
    /// The cell's foreground colour.
    fg: Rgb,
    /// The cell's background colour, `None` for the terminal's default.
    bg: Option<Rgb>,
    /// Seconds until the cell turns into braille dust.
    delay: f64,
    /// How many braille dots the glyph turns into.
    ink: u8,
    /// The cell's random seed.
    seed: f64,
}

/// The puzzle's move count per step, which depends on the model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PuzzleKind {
    /// The pi logo moves one or two blocks per step.
    PiLogo,
    /// Armin moves a small share of its blocks per step.
    Armin,
}

/// The model of the effect, plus what the puzzle needs to know about it.
#[derive(Debug, Clone)]
struct EggModel {
    /// The blocks and their placement.
    base: Model,
    /// The top-left cell of the model's half-block rendering on screen, `None`
    /// when it grows out of the centre.
    origin: Option<(usize, usize)>,
    /// How many blocks the puzzle moves per step.
    puzzle: PuzzleKind,
}

impl EggModel {
    /// The model's width in bitmap pixels.
    fn columns(&self) -> f64 {
        self.base.columns
    }

    /// The model's height in bitmap pixels.
    fn rows(&self) -> f64 {
        self.base.rows
    }

    /// How many blocks the puzzle moves in one step.
    fn puzzle_moves(&self, random: f64, block_count: usize) -> usize {
        match self.puzzle {
            PuzzleKind::PiLogo => {
                if random < 0.4 {
                    2
                } else {
                    1
                }
            }
            PuzzleKind::Armin => (block_count as f64 * (0.03 + random * 0.04)).round() as usize,
        }
    }
}

/// The pi logo's model, lifting off the header logo at `column`, `row`.
fn pi_logo_model(column: usize, row: usize) -> EggModel {
    EggModel {
        base: crate::logo3d::pi_logo_model(),
        origin: Some((column, row)),
        puzzle: PuzzleKind::PiLogo,
    }
}

/// Armin's model, growing out of a speck at the centre.
fn armin_model(color: Rgb) -> EggModel {
    let columns = ARMIN_WIDTH as f64;
    let rows = ARMIN_HEIGHT as f64;
    let mut blocks = Vec::new();
    for row in 0..ARMIN_HEIGHT {
        for column in 0..ARMIN_WIDTH {
            if is_armin_pixel(column, row) {
                blocks.push(Block {
                    home: [column as i32, row as i32, 0],
                    color,
                });
            }
        }
    }
    EggModel {
        base: Model {
            columns,
            rows,
            blocks,
            camera_distance: 80.0,
            radius: (columns / 2.0).hypot(rows / 2.0).hypot(1.0 + DEPTH / 2.0),
            width_share: 0.45,
        },
        origin: None,
        puzzle: PuzzleKind::Armin,
    }
}

/// The fullscreen 3D easter egg.
///
/// The component captures the screen it dissolves into and plays the timeline
/// once: the dust wave, the model's flight, the sliding puzzle and finally the
/// exit animation, which reassembles the screen.
pub struct EasterEgg3dComponent {
    /// The screen to dissolve, as rendered lines.
    screen: Vec<String>,
    /// Which easter egg plays.
    egg: EasterEgg3d,
    /// When the effect started.
    started: Instant,
    /// The model that spins in the centre.
    model: EggModel,
    /// The terminal's foreground colour.
    foreground: Rgb,
    /// The terminal's background colour.
    background: Rgb,
    /// The ray caster, reused between frames.
    raster: Mutex<BlockRaster>,
    /// The parsed screen, cached per width.
    cells: Mutex<Option<(usize, Vec<Vec<ScreenCell>>)>>,
    /// The starfield, cached per size.
    stars: Mutex<Option<(usize, usize, Vec<Option<crate::logo3d::Star>>)>>,
    /// The shuffle of the current puzzle cycle, cached per cycle.
    shuffle: Mutex<Option<(i64, Vec<Vec<[i32; 3]>>)>>,
}

impl EasterEgg3dComponent {
    /// A new easter egg.
    ///
    /// `screen` is the captured screen (one string per row, ANSI included) and
    /// `started` is the moment the effect began.
    pub fn new(screen: Vec<String>, egg: EasterEgg3d, started: Instant) -> Self {
        let colors = theme().colors;
        let foreground = color_to_rgb(&colors.text);
        let background = color_to_rgb(&colors.panel_bg);
        let model = match egg {
            EasterEgg3d::PiLogo { column, row } => pi_logo_model(column, row),
            EasterEgg3d::Armin => armin_model(color_to_rgb(&colors.accent)),
        };
        let camera_distance = model.base.camera_distance;
        Self {
            screen,
            egg,
            started,
            model,
            foreground,
            background,
            raster: Mutex::new(BlockRaster::new(camera_distance)),
            cells: Mutex::new(None),
            stars: Mutex::new(None),
            shuffle: Mutex::new(None),
        }
    }

    /// Which easter egg plays.
    pub fn egg(&self) -> EasterEgg3d {
        self.egg
    }

    /// Seconds since the effect started.
    pub fn elapsed(&self) -> f64 {
        self.started.elapsed().as_secs_f64()
    }

    /// True once the effect has run its full timeline, exit animation included.
    pub fn is_finished(&self) -> bool {
        self.elapsed() >= TOTAL_DURATION
    }

    /// The number of rows in the captured screen.
    pub fn screen_rows(&self) -> usize {
        self.screen.len()
    }

    /// The number of rows the effect covers.
    fn height(&self) -> usize {
        self.screen.len().max(1)
    }

    /// The frame at `elapsed` seconds after the start.
    ///
    /// The frame is a pure function of the time: the same time always renders
    /// the same frame. Before the dust arrives and after the exit animation the
    /// captured screen is returned unchanged.
    pub fn render_at(&self, width: usize, elapsed: f64) -> Vec<String> {
        if elapsed <= 0.0 || elapsed >= TOTAL_DURATION {
            return self.screen.clone();
        }
        let height = self.height();

        let (dissolve_time, pose, hint_alpha, star_alpha, offsets) = if elapsed > SHOW_END {
            let progress = ((elapsed - SHOW_END) / EXIT_DURATION).clamp(0.0, 1.0);
            let landing = (progress / 0.8).clamp(0.0, 1.0);
            let settle = 1.0 - smooth(landing);
            let dissolve = DISSOLVE_END.min(SHOW_END) * (1.0 - progress);
            let yaw = spin_angle(SHOW_END);
            let turn = std::f64::consts::PI * 2.0;
            let target_yaw = (yaw / turn).ceil() * turn;
            let mut pose = self.pose(width, height, fly_progress(SHOW_END) * settle, SHOW_END);
            pose.yaw = yaw + (target_yaw - yaw) * ease_out(landing);
            pose.pitch *= settle;
            pose.roll *= settle;
            let gather = 1.0 - smooth(progress / 0.5);
            let offsets = self
                .block_offsets(SHOW_END)
                .into_iter()
                .map(|offset| [offset[0] * gather, offset[1] * gather, offset[2] * gather])
                .collect();
            let hint_alpha = hint_alpha(SHOW_END) * (1.0 - smooth(progress / 0.2));
            let star_alpha = star_alpha(SHOW_END) * (1.0 - smooth(progress / 0.3));
            (dissolve, pose, hint_alpha, star_alpha, offsets)
        } else {
            let dissolve = elapsed;
            let pose = self.pose(width, height, fly_progress(elapsed), elapsed);
            (
                dissolve,
                pose,
                hint_alpha(elapsed),
                star_alpha(elapsed),
                self.block_offsets(elapsed),
            )
        };

        let boxes = self.boxes(&offsets);
        let mut raster = self
            .raster
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        raster.render(
            width,
            height,
            &pose,
            &boxes,
            self.background,
            if is_light(self.background) {
                LIGHT_HALO_STRENGTH
            } else {
                0.0
            },
        );

        let cells = self.cells(width);
        let stars = self.stars(width, height);
        let background_fade = smooth(dissolve_time / BACKGROUND_FADE);
        let text_fade = smooth(dissolve_time / 0.6) * 0.3;
        let text_active = dissolve_time < DISSOLVE_END || background_fade < 1.0;
        let hint = self.hint(width, height, hint_alpha);
        let frame = (dissolve_time * 14.0).floor() as i64;
        let star_level = star_level(star_alpha);

        let mut lines = Vec::with_capacity(height);
        for row in 0..height {
            let row_cells = cells.get(row);
            let mut line = LineBuilder::new();
            let mut column = 0;
            while column < width {
                let index = row * width + column;
                let cell = if text_active {
                    row_cells.and_then(|cells| cells.get(column))
                } else {
                    None
                };
                let cell_bg = self.halo_color(
                    &raster,
                    index,
                    cell.and_then(|cell| {
                        cell.bg
                            .filter(|_| background_fade < 1.0)
                            .map(|bg| mix(bg, self.background, background_fade))
                    }),
                );

                if let Some(hint) = &hint {
                    if row == hint.row
                        && column >= hint.start
                        && column < hint.start + hint.text.chars().count()
                    {
                        let offset = column - hint.start;
                        let glyph = hint.text.chars().nth(offset).unwrap_or(' ');
                        let color = if offset < hint.key_length {
                            hint.key_color
                        } else {
                            hint.color
                        };
                        line.emit(&glyph.to_string(), Some(color), cell_bg);
                        column += 1;
                        continue;
                    }
                }

                let dots = raster.bits()[index];
                if dots != 0 {
                    let step = LOGO_COLOR_STEP * raster.counts()[index] as f64;
                    let rgb = raster.rgb();
                    let color = [
                        js_round(rgb[index * 3] as f64 / step) * LOGO_COLOR_STEP,
                        js_round(rgb[index * 3 + 1] as f64 / step) * LOGO_COLOR_STEP,
                        js_round(rgb[index * 3 + 2] as f64 / step) * LOGO_COLOR_STEP,
                    ];
                    line.emit(&braille_char(dots).to_string(), Some(color), cell_bg);
                    column += 1;
                    continue;
                }

                let Some(cell) = cell else {
                    let star = self.star(&stars, index, star_level, elapsed);
                    line.emit(
                        &star
                            .map(|(glyph, _)| glyph.to_string())
                            .unwrap_or_else(|| " ".to_string()),
                        star.map(|(_, color)| color),
                        cell_bg,
                    );
                    column += 1;
                    continue;
                };

                let dust = (dissolve_time - cell.delay) / DUST_DURATION;
                if dust < 0.0
                    && cell.width == 2
                    && (column + 1 >= width || raster.bits()[index + 1] == 0)
                {
                    line.emit(
                        &cell.text,
                        Some(mix(cell.fg, self.background, text_fade)),
                        cell_bg,
                    );
                    column += 2;
                    continue;
                }
                if dust < 0.0 && cell.width == 1 {
                    line.emit(
                        &cell.text,
                        Some(mix(cell.fg, self.background, text_fade)),
                        cell_bg,
                    );
                    column += 1;
                    continue;
                }
                let dot_count = if dust < 0.0 {
                    cell.ink as f64
                } else {
                    js_round(cell.ink as f64 * (1.0 - dust.clamp(0.0, 1.0)))
                };
                if dot_count <= 0.0 {
                    let star = self.star(&stars, index, star_level, elapsed);
                    line.emit(
                        &star
                            .map(|(glyph, _)| glyph.to_string())
                            .unwrap_or_else(|| " ".to_string()),
                        star.map(|(_, color)| color),
                        cell_bg,
                    );
                    column += 1;
                    continue;
                }
                let bits = dust_bits(cell.seed, frame, dot_count as usize);
                let fade = text_fade + (1.0 - text_fade) * dust.clamp(0.0, 1.0).powf(0.8);
                line.emit(
                    &braille_char(bits).to_string(),
                    Some(mix(cell.fg, self.background, fade)),
                    cell_bg,
                );
                column += 1;
            }
            lines.push(line.finish());
        }
        lines
    }

    /// The model's blocks, moved by `offsets`, in model space.
    fn boxes(&self, offsets: &[[f64; 3]]) -> Vec<Box3> {
        let columns = self.model.columns();
        let rows = self.model.rows();
        self.model
            .base
            .blocks
            .iter()
            .enumerate()
            .map(|(index, block)| {
                let offset = offsets.get(index).copied().unwrap_or([0.0; 3]);
                let x = block.home[0] as f64 - columns / 2.0 + offset[0];
                let y = block.home[1] as f64 - rows / 2.0 + offset[1];
                Box3 {
                    min: [x, y, offset[2] - DEPTH / 2.0],
                    max: [x + 1.0, y + 1.0, offset[2] + DEPTH / 2.0],
                    color: block.color,
                }
            })
            .collect()
    }

    /// The model's placement and orientation at `time`, `progress` into its
    /// flight.
    ///
    /// Lifting off, the front face must cover exactly the half-block cells
    /// (2x2 dots per pixel) despite the perspective. The zoom is interpolated
    /// geometrically so it feels uniform, and the tilts are zero at whole
    /// turns, so the camera looks straight at the front of the reassembled
    /// logo.
    fn pose(&self, width: usize, height: usize, progress: f64, time: f64) -> Pose {
        let model = &self.model.base;
        let reach = model.radius * (model.camera_distance / (model.camera_distance - model.radius));
        let start_scale = match self.model.origin {
            Some(_) => 2.0 * (model.camera_distance - DEPTH / 2.0) / model.camera_distance,
            None => START_SCALE,
        };
        let end_scale = start_scale.max(
            (width as f64 * 2.0 * model.width_share).min((height as f64 * 4.0 - 8.0) * 0.48)
                / reach,
        );
        let end_x = width as f64;
        let end_y = height as f64 * 2.0 - 2.0;
        let (start_x, start_y) = match self.model.origin {
            Some((column, row)) => (
                column as f64 * 2.0 + model.columns,
                row as f64 * 4.0 + model.rows,
            ),
            None => (end_x, end_y),
        };
        let phase = spin_phase(time);
        Pose {
            center_x: start_x + (end_x - start_x) * progress,
            center_y: start_y + (end_y - start_y) * progress,
            scale: start_scale * (end_scale / start_scale).powf(progress),
            yaw: spin_angle(time),
            pitch: 0.3 * phase.sin() * progress,
            roll: 0.06 * (2.0 * phase).sin() * progress,
        }
    }

    /// Each block's displacement from its place in the model at `time`, in grid
    /// units.
    ///
    /// When the blocks fly home they all move at once; alternating arcs in
    /// depth keep them from passing through each other.
    fn block_offsets(&self, time: f64) -> Vec<[f64; 3]> {
        let blocks = &self.model.base.blocks;
        if time < PUZZLE_START {
            return vec![[0.0; 3]; blocks.len()];
        }
        let cycle = ((time - PUZZLE_START) / PUZZLE_CYCLE).floor() as i64;
        let local = time - PUZZLE_START - cycle as f64 * PUZZLE_CYCLE;
        let steps = self.shuffle_steps(cycle);
        let offset = |position: [i32; 3], index: usize| -> [f64; 3] {
            let home = blocks[index].home;
            [
                (position[0] - home[0]) as f64,
                (position[1] - home[1]) as f64,
                (position[2] - home[2]) as f64,
            ]
        };
        let shuffle_end = PUZZLE_STEP * PUZZLE_STEPS as f64;
        if local < shuffle_end {
            let step = (local / PUZZLE_STEP).floor() as usize;
            let progress = smooth((local - step as f64 * PUZZLE_STEP) / PUZZLE_STEP);
            let from = &steps[step];
            let to = &steps[step + 1];
            return from
                .iter()
                .enumerate()
                .map(|(index, position)| {
                    let a = offset(*position, index);
                    let b = offset(to[index], index);
                    [
                        a[0] + (b[0] - a[0]) * progress,
                        a[1] + (b[1] - a[1]) * progress,
                        a[2] + (b[2] - a[2]) * progress,
                    ]
                })
                .collect();
        }
        if local < shuffle_end + PUZZLE_RETURN {
            let u = (local - shuffle_end) / PUZZLE_RETURN;
            let remaining = 1.0 - smooth(u);
            let arc = (std::f64::consts::PI * u.clamp(0.0, 1.0)).sin() * 0.8;
            return steps[PUZZLE_STEPS]
                .iter()
                .enumerate()
                .map(|(index, position)| {
                    let offset = offset(*position, index);
                    [
                        offset[0] * remaining,
                        offset[1] * remaining,
                        offset[2] * remaining + if index % 2 == 0 { arc } else { -arc },
                    ]
                })
                .collect();
        }
        vec![[0.0; 3]; blocks.len()]
    }

    /// The block positions after each step of one shuffle cycle, starting at
    /// home. Deterministic per cycle.
    fn shuffle_steps(&self, cycle: i64) -> Vec<Vec<[i32; 3]>> {
        let mut cache = self
            .shuffle
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some((cached, steps)) = cache.as_ref() {
            if *cached == cycle {
                return steps.clone();
            }
        }
        let steps = shuffle_steps(&self.model, cycle);
        *cache = Some((cycle, steps.clone()));
        steps
    }

    /// The captured screen, parsed into cells with resolved colours.
    fn cells(&self, width: usize) -> Vec<Vec<ScreenCell>> {
        let mut cache = self.cells.lock().unwrap_or_else(|error| error.into_inner());
        if let Some((cached, cells)) = cache.as_ref() {
            if *cached == width {
                return cells.clone();
            }
        }
        let cells = self.prepare_cells(width);
        *cache = Some((width, cells.clone()));
        cells
    }

    /// The starfield behind the model.
    fn stars(&self, width: usize, height: usize) -> Vec<Option<crate::logo3d::Star>> {
        let mut cache = self.stars.lock().unwrap_or_else(|error| error.into_inner());
        if let Some((cached_width, cached_height, stars)) = cache.as_ref() {
            if *cached_width == width && *cached_height == height {
                return stars.clone();
            }
        }
        let stars = prepare_stars(width, height);
        *cache = Some((width, height, stars.clone()));
        stars
    }

    /// The star at `index`, with its colour at `elapsed`.
    fn star(
        &self,
        stars: &[Option<crate::logo3d::Star>],
        index: usize,
        star_level: f64,
        elapsed: f64,
    ) -> Option<(char, Rgb)> {
        if star_level <= 0.0 {
            return None;
        }
        let star = stars.get(index).and_then(|star| *star)?;
        let color = star_color(&star, self.foreground, self.background, star_level, elapsed);
        Some((star.glyph, color))
    }

    /// The halo's colour at `index`, blended into the cell's background.
    fn halo_color(&self, raster: &BlockRaster, index: usize, base: Option<Rgb>) -> Option<Rgb> {
        let amount = raster.halo_amount()[index];
        if amount <= 0.0 {
            return base;
        }
        let rgb = raster.halo_rgb();
        let color = [
            rgb[index * 3] as f64,
            rgb[index * 3 + 1] as f64,
            rgb[index * 3 + 2] as f64,
        ];
        Some(mix(base.unwrap_or(self.background), color, amount as f64))
    }

    /// The parsed screen, with the dust wave's timings and the model's origin
    /// applied.
    ///
    /// The dust spreads out from where the model starts. Wide graphemes share
    /// their first column's timing so both halves change together, and the 3D
    /// model replaces its half-block rendering on screen.
    fn prepare_cells(&self, width: usize) -> Vec<Vec<ScreenCell>> {
        let mut cells = parse_screen(&self.screen, width, self.foreground, self.background);
        let height = self.height();
        let columns = self.model.columns();
        let rows = self.model.rows();
        let (center_x, center_y) = match self.model.origin {
            Some((column, row)) => (column as f64 + columns / 2.0, row as f64 + rows / 4.0),
            None => (width as f64 / 2.0, height as f64 / 2.0),
        };
        let farthest = (center_x.max(width as f64 - center_x))
            .hypot((center_y.max(height as f64 - center_y)) * 2.0);
        for (row, line) in cells.iter_mut().enumerate() {
            for column in 0..line.len() {
                let is_wide_tail = line[column].width == 0 && column > 0;
                let owner_text = if is_wide_tail {
                    line[column - 1].text.clone()
                } else {
                    line[column].text.clone()
                };
                let owner_delay = if is_wide_tail {
                    line[column - 1].delay
                } else {
                    0.0
                };
                let seed = hash((row * 65_537 + column) as f64);
                if !is_wide_tail {
                    let distance =
                        (column as f64 - center_x).hypot((row as f64 - center_y) * 2.0) / farthest;
                    line[column].delay = FLY_START + distance * WAVE_SPREAD + seed * WAVE_JITTER;
                } else {
                    line[column].delay = owner_delay;
                }
                line[column].seed = (row * 65_537 + column) as f64;
                line[column].ink = glyph_ink(&owner_text, seed);
            }
        }
        if let Some((column, row)) = self.model.origin {
            let rows_to_clear = (rows / 2.0).ceil() as usize;
            for row in row..row + rows_to_clear {
                let Some(line) = cells.get_mut(row) else {
                    continue;
                };
                for column in column..column + columns as usize {
                    if let Some(cell) = line.get_mut(column) {
                        cell.text = " ".to_string();
                        cell.width = 1;
                        cell.ink = 0;
                        cell.bg = None;
                    }
                }
            }
        }
        cells
    }

    /// The "escape to return" hint at the bottom of the screen.
    fn hint(&self, width: usize, height: usize, alpha: f64) -> Option<Hint> {
        if alpha <= 0.0 {
            return None;
        }
        let combos = crate::keybindings::get_keybindings().get_keys(keys::SELECT_CANCEL);
        let key = combos
            .first()
            .map(|combo| format_combo(*combo, false))
            .filter(|key| !key.is_empty())
            .unwrap_or_else(|| "escape".to_string());
        let text = format!("{key} to return");
        let length = text.chars().count();
        if length > width {
            return None;
        }
        let colors = theme().colors;
        Some(Hint {
            row: height.saturating_sub(2),
            start: width.saturating_sub(length) / 2,
            key_length: key.chars().count(),
            text,
            key_color: mix(self.background, color_to_rgb(&colors.muted), alpha),
            color: mix(self.background, color_to_rgb(&colors.dim), alpha),
        })
    }
}

/// The "escape to return" hint.
struct Hint {
    /// The row the hint sits on.
    row: usize,
    /// The column the hint starts at.
    start: usize,
    /// The hint's text.
    text: String,
    /// How many characters of the hint are the key.
    key_length: usize,
    /// The key's colour.
    key_color: Rgb,
    /// The rest of the hint's colour.
    color: Rgb,
}

/// Plays a 3D easter egg over the last painted screen.
///
/// Only a fullscreen alt screen can show it: the effect dissolves the screen
/// that was painted, so a TUI that is not an alt screen cannot play it.
/// Returns false when it cannot play, so the caller can fall back to the
/// inline version.
///
/// The original's `playEasterEgg3d`
/// (packages/coding-agent/src/modes/interactive/components/easter-egg-3d.lazy.ts:22-34)
/// shows the effect as an overlay that covers the screen and hides itself when
/// the animation is over.
pub fn play_easter_egg_3d(tui: &Arc<dyn crate::tui::TUI>, egg: EasterEgg3d) -> bool {
    let Some(screen) = tui.alt_screen_lines() else {
        return false;
    };
    if tui.has_overlay() {
        return true;
    }
    let component = Arc::new(EasterEgg3dComponent::new(screen, egg, Instant::now()));
    let overlay = tui.show_overlay(
        component.clone(),
        Some(crate::tui::OverlayOptions {
            width: Some(crate::tui::SizeValue::Percent(100.0)),
            max_height: Some(crate::tui::SizeValue::Percent(100.0)),
            anchor: crate::tui::OverlayAnchor::TopLeft,
            ..Default::default()
        }),
    );
    let tui = tui.clone();
    run_animation(tui, component, overlay);
    true
}

/// Drive the animation: ask for a frame while it runs, then hide the overlay.
///
/// The render request is coalesced, like the original's animation: a forced
/// one would repaint the whole screen on every tick and drown the terminal in
/// output until the animation ends.
fn run_animation(
    tui: Arc<dyn crate::tui::TUI>,
    component: Arc<EasterEgg3dComponent>,
    overlay: Arc<dyn crate::tui::OverlayHandle>,
) {
    std::thread::spawn(move || {
        while !component.is_finished() {
            tui.request_render(false);
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        // Hide this overlay, not whatever is on top of it now.
        overlay.hide();
    });
}

/// Plays the 3D pi logo, lifting off the header logo whose top-left cell is
/// at `column`, `row`.
///
/// The original's `playPiLogo3d`
/// (packages/coding-agent/src/modes/interactive/components/easter-egg-3d.lazy.ts:38-40).
pub fn play_pi_logo_3d(tui: &Arc<dyn crate::tui::TUI>, column: usize, row: usize) -> bool {
    play_easter_egg_3d(tui, EasterEgg3d::PiLogo { column, row })
}

impl Component for EasterEgg3dComponent {
    fn render(&self, width: usize) -> Vec<String> {
        self.render_at(width, self.elapsed())
    }
    fn invalidate(&self) {
        let mut cells = self.cells.lock().unwrap_or_else(|error| error.into_inner());
        *cells = None;
        let mut stars = self.stars.lock().unwrap_or_else(|error| error.into_inner());
        *stars = None;
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

/// A line under construction, tracking the colours it has already written.
struct LineBuilder {
    line: String,
    current_fg: Option<[u8; 3]>,
    current_bg: Option<[u8; 3]>,
}

impl LineBuilder {
    /// A new, empty line.
    fn new() -> Self {
        Self {
            line: String::new(),
            current_fg: None,
            current_bg: None,
        }
    }

    /// Writes `text` with the given colours.
    fn emit(&mut self, text: &str, fg: Option<Rgb>, bg: Option<Rgb>) {
        let fg_key = fg.map(pack);
        let bg_key = bg.map(pack);
        if fg_key != self.current_fg && text != " " {
            match fg_key {
                Some(color) => self
                    .line
                    .push_str(&foreground_rgb(color[0], color[1], color[2])),
                None => self.line.push_str("\x1b[39m"),
            }
            self.current_fg = fg_key;
        }
        if bg_key != self.current_bg {
            match bg_key {
                Some(color) => self
                    .line
                    .push_str(&background_rgb(color[0], color[1], color[2])),
                None => self.line.push_str("\x1b[49m"),
            }
            self.current_bg = bg_key;
        }
        self.line.push_str(text);
    }

    /// The finished line.
    fn finish(mut self) -> String {
        self.line.push_str("\x1b[0m");
        self.line
    }
}

/// The block positions after each step of one shuffle cycle, starting at home.
///
/// Deterministic per cycle. Blocks that did not just move are preferred, so the
/// puzzle does not look like one block jittering.
fn shuffle_steps(model: &EggModel, cycle: i64) -> Vec<Vec<[i32; 3]>> {
    let columns = model.columns() as i64;
    let rows = model.rows() as i64;
    let blocks = &model.base.blocks;
    let mut positions: Vec<[i32; 3]> = blocks.iter().map(|block| block.home).collect();
    let mut steps = vec![positions.clone()];
    let mut last_moved: HashSet<usize> = HashSet::new();
    let mut random = cycle * 7_919 + 1;
    let key = |position: [i32; 3]| -> i64 {
        ((position[2] as i64 + 1) * rows + position[1] as i64) * columns + position[0] as i64
    };
    for _step in 0..PUZZLE_STEPS {
        let mut occupied: HashSet<i64> = positions.iter().map(|position| key(*position)).collect();
        let mut next_positions = positions.clone();
        let mut moved: HashSet<usize> = HashSet::new();
        let move_count = model.puzzle_moves(hash(random as f64), blocks.len());
        random += 1;
        for _move in 0..move_count {
            let mut candidates: Vec<(usize, [i32; 3])> = Vec::new();
            for (block, position) in positions.iter().enumerate() {
                if moved.contains(&block) {
                    continue;
                }
                for delta in PUZZLE_MOVES {
                    let target = [
                        position[0] + delta[0],
                        position[1] + delta[1],
                        position[2] + delta[2],
                    ];
                    if target[0] < 0 || target[0] as i64 >= columns {
                        continue;
                    }
                    if target[1] < 0 || target[1] as i64 >= rows {
                        continue;
                    }
                    if target[2] < -1 || target[2] > 1 {
                        continue;
                    }
                    if occupied.contains(&key(target)) {
                        continue;
                    }
                    candidates.push((block, target));
                }
            }
            let fresh: Vec<(usize, [i32; 3])> = candidates
                .iter()
                .copied()
                .filter(|(block, _)| !last_moved.contains(block))
                .collect();
            let pool = if fresh.is_empty() { candidates } else { fresh };
            let pick = (hash(random as f64) * pool.len() as f64).floor() as usize;
            random += 1;
            if pool.is_empty() {
                break;
            }
            let choice = pool[pick.min(pool.len() - 1)];
            occupied.insert(key(choice.1));
            next_positions[choice.0] = choice.1;
            moved.insert(choice.0);
        }
        last_moved = moved;
        positions = next_positions;
        steps.push(positions.clone());
    }
    steps
}

/// How far the model has flown towards the centre.
fn fly_progress(time: f64) -> f64 {
    smooth((time - FLY_START) / FLY_DURATION)
}

/// How strongly the starfield shows.
fn star_alpha(time: f64) -> f64 {
    smooth((time - STARS_START) / STARS_FADE)
}

/// How strongly the hint shows.
fn hint_alpha(time: f64) -> f64 {
    smooth((time - FLY_START - FLY_DURATION) / HINT_FADE)
}

/// Cubic ease out.
fn ease_out(value: f64) -> f64 {
    let t = 1.0 - value.clamp(0.0, 1.0);
    1.0 - t * t * t
}

/// The braille dots a cell's glyph turns into.
fn dust_bits(seed: f64, frame: i64, dot_count: usize) -> u8 {
    let mut bits = 0u8;
    let mut placed = 0;
    let mut attempt = 0;
    while placed < dot_count && attempt < 32 {
        let index = (hash(seed * 7_919.0 + frame as f64 * 131.0 + attempt as f64) * 8.0) as usize;
        let bit = DOT_BITS[index.min(7)];
        if bits & bit == 0 {
            bits |= bit;
            placed += 1;
        }
        attempt += 1;
    }
    bits
}

/// Braille dots a glyph turns into, a rough measure of how much ink it has.
fn glyph_ink(text: &str, seed: f64) -> u8 {
    if text.trim().is_empty() {
        return 0;
    }
    let mut chars = text.chars();
    let Some(first) = chars.next() else {
        return 0;
    };
    if chars.next().is_none() {
        match first {
            '.' | ',' | ':' | ';' | '\'' | '`' | '-' | '_' | '·' => return 2,
            '\u{2500}'..='\u{257f}' => return 3,
            _ => {}
        }
    }
    4 + (seed * 3.0).floor() as u8
}

/// The braille character with the given dots.
fn braille_char(bits: u8) -> char {
    char::from_u32(0x2800 + bits as u32).unwrap_or(' ')
}

/// A colour as the bytes an escape sequence needs.
fn pack(color: Rgb) -> [u8; 3] {
    [
        color[0].round().clamp(0.0, 255.0) as u8,
        color[1].round().clamp(0.0, 255.0) as u8,
        color[2].round().clamp(0.0, 255.0) as u8,
    ]
}

/// JavaScript's `Math.round`: halves round up.
fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// A theme colour as RGB.
fn color_to_rgb(color: &Color) -> Rgb {
    match color {
        Color::Rgb(r, g, b) => [*r as f64, *g as f64, *b as f64],
        Color::Ansi16(index) => indexed_color(*index),
        Color::Ansi256(index) => indexed_color(*index),
        Color::Default => [255.0, 255.0, 255.0],
    }
}

/// The xterm-256 palette.
fn indexed_color(index: u8) -> Rgb {
    const BASIC: [[u8; 3]; 16] = [
        [0, 0, 0],
        [128, 0, 0],
        [0, 128, 0],
        [128, 128, 0],
        [0, 0, 128],
        [128, 0, 128],
        [0, 128, 128],
        [192, 192, 192],
        [128, 128, 128],
        [255, 0, 0],
        [0, 255, 0],
        [255, 255, 0],
        [0, 0, 255],
        [255, 0, 255],
        [0, 255, 255],
        [255, 255, 255],
    ];
    const CUBE: [f64; 6] = [0.0, 95.0, 135.0, 175.0, 215.0, 255.0];
    if index < 16 {
        let color = BASIC[index as usize];
        return [color[0] as f64, color[1] as f64, color[2] as f64];
    }
    if index < 232 {
        let cube = (index - 16) as usize;
        return [CUBE[cube / 36], CUBE[(cube % 36) / 6], CUBE[cube % 6]];
    }
    let gray = 8.0 + (index as f64 - 232.0) * 10.0;
    [gray, gray, gray]
}

/// Parses rendered lines into cells with resolved colours.
fn parse_screen(
    lines: &[String],
    width: usize,
    foreground: Rgb,
    background: Rgb,
) -> Vec<Vec<ScreenCell>> {
    lines
        .iter()
        .map(|line| parse_line(line, width, foreground, background))
        .collect()
}

/// Parses one rendered line into cells with resolved colours.
///
/// Escape sequences other than SGR are skipped: string sequences end at BEL or
/// ST (ESC \).
fn parse_line(line: &str, width: usize, foreground: Rgb, background: Rgb) -> Vec<ScreenCell> {
    let mut cells: Vec<ScreenCell> = Vec::new();
    let mut fg: Option<Rgb> = None;
    let mut bg: Option<Rgb> = None;
    let mut dim = false;
    let mut inverse = false;

    let push_text = |text: &str,
                     cells: &mut Vec<ScreenCell>,
                     fg: Option<Rgb>,
                     bg: Option<Rgb>,
                     dim: bool,
                     inverse: bool| {
        for segment in text.graphemes(true) {
            let glyph_width = visible_width(segment);
            if glyph_width == 0 || cells.len() + glyph_width > width {
                continue;
            }
            let mut cell_fg = fg.unwrap_or(foreground);
            let mut cell_bg = bg;
            if inverse {
                cell_fg = bg.unwrap_or(background);
                cell_bg = Some(fg.unwrap_or(foreground));
            }
            if dim {
                cell_fg = mix(cell_fg, cell_bg.unwrap_or(background), 0.4);
            }
            cells.push(ScreenCell {
                text: segment.to_string(),
                width: glyph_width,
                fg: cell_fg,
                bg: cell_bg,
                delay: 0.0,
                ink: 0,
                seed: 0.0,
            });
            if glyph_width == 2 {
                let cell = cells.last().cloned().unwrap();
                cells.push(ScreenCell {
                    text: String::new(),
                    width: 0,
                    ..cell
                });
            }
        }
    };

    let bytes = line.as_bytes();
    let mut index = 0;
    while index < line.len() {
        let Some(offset) = line[index..].find('\x1b') else {
            push_text(&line[index..], &mut cells, fg, bg, dim, inverse);
            break;
        };
        let sequence_start = index + offset;
        if sequence_start > index {
            push_text(
                &line[index..sequence_start],
                &mut cells,
                fg,
                bg,
                dim,
                inverse,
            );
        }
        let kind = line[sequence_start + 1..].chars().next();
        match kind {
            Some('[') => {
                let mut end = sequence_start + 2;
                while end < line.len() && !(0x40..=0x7e).contains(&bytes[end]) {
                    end += 1;
                }
                if end < line.len() && bytes[end] == b'm' {
                    apply_sgr(
                        &line[sequence_start + 2..end],
                        &mut fg,
                        &mut bg,
                        &mut dim,
                        &mut inverse,
                    );
                }
                index = end + 1;
            }
            Some(']') | Some('_') | Some('P') | Some('^') => {
                let rest = &line[sequence_start + 2..];
                let bell = rest
                    .find('\x07')
                    .map(|position| sequence_start + 2 + position);
                let st = rest
                    .find("\x1b\\")
                    .map(|position| sequence_start + 2 + position);
                match (bell, st) {
                    (None, None) => break,
                    (Some(bell), None) => index = bell + 1,
                    (None, Some(st)) => index = st + 2,
                    (Some(bell), Some(st)) => index = if bell < st { bell + 1 } else { st + 2 },
                }
            }
            _ => {
                let length = kind.map_or(1, char::len_utf8);
                index = sequence_start + 1 + length;
            }
        }
    }
    cells
}

/// Applies one SGR sequence to the parser's state.
///
/// Extended colors come either as `38;5;n` / `38;2;r;g;b` or as colon
/// sub-parameters.
fn apply_sgr(
    params: &str,
    fg: &mut Option<Rgb>,
    bg: &mut Option<Rgb>,
    dim: &mut bool,
    inverse: &mut bool,
) {
    let codes: Vec<&str> = if params.is_empty() {
        vec!["0"]
    } else {
        params.split(';').collect()
    };
    let mut index = 0;
    while index < codes.len() {
        let parts: Vec<Option<i64>> = codes[index]
            .split(':')
            .map(|part| part.parse::<i64>().ok())
            .collect();
        let code = parts.first().copied().flatten();
        match code {
            Some(38) | Some(48) => {
                let args: Vec<i64>;
                if parts.len() > 1 {
                    args = parts[1..].iter().copied().flatten().collect();
                } else {
                    let kind = codes
                        .get(index + 1)
                        .and_then(|code| code.parse::<i64>().ok())
                        .unwrap_or(0);
                    let count = if kind == 5 {
                        2
                    } else if kind == 2 {
                        4
                    } else {
                        1
                    };
                    args = codes[index + 1..]
                        .iter()
                        .take(count)
                        .map(|code| code.parse::<i64>().unwrap_or(0))
                        .collect();
                    index += count;
                }
                let color = if args.first() == Some(&5) && args.len() > 1 {
                    Some(indexed_color(args[1].clamp(0, 255) as u8))
                } else if args.first() == Some(&2) && args.len() >= 4 {
                    Some([
                        args[1].clamp(0, 255) as f64,
                        args[2].clamp(0, 255) as f64,
                        args[3].clamp(0, 255) as f64,
                    ])
                } else {
                    None
                };
                if let Some(color) = color {
                    if code == Some(38) {
                        *fg = Some(color);
                    } else {
                        *bg = Some(color);
                    }
                }
            }
            Some(0) => {
                *fg = None;
                *bg = None;
                *dim = false;
                *inverse = false;
            }
            Some(2) => *dim = true,
            Some(22) => *dim = false,
            Some(7) => *inverse = true,
            Some(27) => *inverse = false,
            Some(code) if (30..=37).contains(&code) => {
                *fg = Some(indexed_color((code - 30) as u8));
            }
            Some(code) if (90..=97).contains(&code) => {
                *fg = Some(indexed_color((code - 90 + 8) as u8));
            }
            Some(39) => *fg = None,
            Some(code) if (40..=47).contains(&code) => {
                *bg = Some(indexed_color((code - 40) as u8));
            }
            Some(code) if (100..=107).contains(&code) => {
                *bg = Some(indexed_color((code - 100 + 8) as u8));
            }
            Some(49) => *bg = None,
            _ => {}
        }
        index += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WIDTH: usize = 24;
    const HEIGHT: usize = 8;

    struct FakeTui {
        screen: Option<Vec<String>>,
        overlay_up: Mutex<bool>,
        shown: Mutex<Vec<Arc<dyn Component>>>,
    }

    impl FakeTui {
        fn new(screen: Option<Vec<String>>) -> Arc<Self> {
            Arc::new(Self {
                screen,
                overlay_up: Mutex::new(false),
                shown: Mutex::new(Vec::new()),
            })
        }
    }

    impl Component for FakeTui {
        fn render(&self, _width: usize) -> Vec<String> {
            Vec::new()
        }
        fn invalidate(&self) {}
        fn as_any(&self) -> &dyn std::any::Any {
            self
        }
    }

    struct FakeHandle;
    impl crate::tui::OverlayHandle for FakeHandle {
        fn hide(&self) {}
        fn set_hidden(&self, _hidden: bool) {}
        fn is_hidden(&self) -> bool {
            false
        }
        fn focus(&self) {}
        fn unfocus(&self) {}
        fn is_focused(&self) -> bool {
            false
        }
        fn get_bounds(&self) -> Option<crate::tui::OverlayBounds> {
            None
        }
    }

    impl crate::tui::TUI for FakeTui {
        fn mode(&self) -> crate::tui::TuiMode {
            crate::tui::TuiMode::Fullscreen
        }
        fn terminal(&self) -> &dyn crate::terminal::Terminal {
            unimplemented!()
        }
        fn children(&self) -> Vec<Arc<dyn Component>> {
            Vec::new()
        }
        fn add_child(&self, _component: Arc<dyn Component>) {}
        fn remove_child(&self, _component: &Arc<dyn Component>) {}
        fn clear(&self) {}
        fn get_show_hardware_cursor(&self) -> bool {
            false
        }
        fn set_show_hardware_cursor(&self, _enabled: bool) {}
        fn get_clear_on_shrink(&self) -> bool {
            false
        }
        fn set_clear_on_shrink(&self, _enabled: bool) {}
        fn set_focus(&self, _component: Option<Arc<dyn Component>>) {}
        fn get_focus(&self) -> Option<Arc<dyn Component>> {
            None
        }
        fn show_overlay(
            &self,
            component: Arc<dyn Component>,
            _options: Option<crate::tui::OverlayOptions>,
        ) -> Arc<dyn crate::tui::OverlayHandle> {
            self.shown.lock().unwrap().push(component);
            *self.overlay_up.lock().unwrap() = true;
            Arc::new(FakeHandle)
        }
        fn hide_overlay(&self) {
            *self.overlay_up.lock().unwrap() = false;
        }
        fn has_overlay(&self) -> bool {
            *self.overlay_up.lock().unwrap()
        }
        fn start(&self) {}
        fn stop(&self, _options: crate::tui::TuiStopOptions) {}
        fn render_now(&self, _force: bool) {}
        fn request_render(&self, _force: bool) {}
        fn full_redraws(&self) -> usize {
            0
        }
        fn alt_screen_lines(&self) -> Option<Vec<String>> {
            self.screen.clone()
        }
    }

    #[test]
    fn the_animation_ends_by_hiding_its_overlay() {
        use crate::tui::{OverlayHandle, TUI};
        // A TUI that hands out the overlay and records the hide.
        struct Recorder {
            hidden: std::sync::atomic::AtomicBool,
        }
        impl OverlayHandle for Recorder {
            fn hide(&self) {
                self.hidden.store(true, std::sync::atomic::Ordering::Relaxed);
            }
            fn set_hidden(&self, _hidden: bool) {}
            fn is_hidden(&self) -> bool {
                false
            }
            fn focus(&self) {}
            fn unfocus(&self) {}
            fn is_focused(&self) -> bool {
                false
            }
            fn get_bounds(&self) -> Option<crate::tui::OverlayBounds> {
                None
            }
        }
        struct Tui {
            recorder: Arc<Recorder>,
            renders: std::sync::atomic::AtomicUsize,
        }
        impl Component for Tui {
            fn render(&self, _width: usize) -> Vec<String> {
                Vec::new()
            }
            fn invalidate(&self) {}
            fn as_any(&self) -> &dyn std::any::Any {
                self
            }
        }
        impl TUI for Tui {
            fn mode(&self) -> crate::tui::TuiMode {
                crate::tui::TuiMode::Fullscreen
            }
            fn terminal(&self) -> &dyn crate::terminal::Terminal {
                unimplemented!()
            }
            fn children(&self) -> Vec<Arc<dyn Component>> {
                Vec::new()
            }
            fn add_child(&self, _component: Arc<dyn Component>) {}
            fn remove_child(&self, _component: &Arc<dyn Component>) {}
            fn clear(&self) {}
            fn get_show_hardware_cursor(&self) -> bool {
                false
            }
            fn set_show_hardware_cursor(&self, _enabled: bool) {}
            fn get_clear_on_shrink(&self) -> bool {
                false
            }
            fn set_clear_on_shrink(&self, _enabled: bool) {}
            fn set_focus(&self, _component: Option<Arc<dyn Component>>) {}
            fn get_focus(&self) -> Option<Arc<dyn Component>> {
                None
            }
            fn show_overlay(
                &self,
                _component: Arc<dyn Component>,
                _options: Option<crate::tui::OverlayOptions>,
            ) -> Arc<dyn OverlayHandle> {
                self.recorder.clone()
            }
            fn hide_overlay(&self) {}
            fn has_overlay(&self) -> bool {
                false
            }
            fn start(&self) {}
            fn stop(&self, _options: crate::tui::TuiStopOptions) {}
            fn render_now(&self, _force: bool) {}
            fn request_render(&self, _force: bool) {
                self.renders
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }
            fn full_redraws(&self) -> usize {
                0
            }
            fn alt_screen_lines(&self) -> Option<Vec<String>> {
                Some(screen())
            }
        }

        let recorder = Arc::new(Recorder {
            hidden: std::sync::atomic::AtomicBool::new(false),
        });
        let tui = Arc::new(Tui {
            recorder: recorder.clone(),
            renders: std::sync::atomic::AtomicUsize::new(0),
        });
        let as_tui: Arc<dyn TUI> = tui.clone();
        // A component that is almost at the end of its timeline: the animation
        // runs a couple of frames and then hands the overlay back.
        let component = Arc::new(EasterEgg3dComponent::new(
            screen(),
            EasterEgg3d::Armin,
            Instant::now() - std::time::Duration::from_millis((TOTAL_DURATION * 1000.0) as u64 - 120),
        ));
        let overlay = as_tui.show_overlay(component.clone(), None);
        run_animation(as_tui.clone(), component, overlay);
        let deadline = Instant::now() + std::time::Duration::from_secs(5);
        while !recorder.hidden.load(std::sync::atomic::Ordering::Relaxed)
            && Instant::now() < deadline
        {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert!(
            recorder.hidden.load(std::sync::atomic::Ordering::Relaxed),
            "the animation must hide its overlay when it ends"
        );
        assert!(
            tui.renders.load(std::sync::atomic::Ordering::Relaxed) > 0,
            "the animation asks for frames while it runs"
        );
    }

    #[test]
    fn the_easter_egg_refuses_a_tui_that_is_not_an_alt_screen() {
        let tui = FakeTui::new(None);
        let as_tui: Arc<dyn crate::tui::TUI> = tui.clone();
        assert!(!play_easter_egg_3d(&as_tui, EasterEgg3d::Armin));
        assert!(tui.shown.lock().unwrap().is_empty());
    }

    #[test]
    fn the_easter_egg_does_nothing_while_an_overlay_is_up() {
        let tui = FakeTui::new(Some(screen()));
        *tui.overlay_up.lock().unwrap() = true;
        let as_tui: Arc<dyn crate::tui::TUI> = tui.clone();
        assert!(play_easter_egg_3d(&as_tui, EasterEgg3d::Armin));
        assert!(tui.shown.lock().unwrap().is_empty());
    }

    #[test]
    fn the_easter_egg_hands_the_captured_screen_to_the_component() {
        let tui = FakeTui::new(Some(screen()));
        let as_tui: Arc<dyn crate::tui::TUI> = tui.clone();
        assert!(play_pi_logo_3d(&as_tui, 2, 1));
        let shown = tui.shown.lock().unwrap();
        assert_eq!(shown.len(), 1);
        let component = shown[0]
            .as_any()
            .downcast_ref::<EasterEgg3dComponent>()
            .expect("the easter egg component");
        assert_eq!(component.egg(), EasterEgg3d::PiLogo { column: 2, row: 1 });
        assert_eq!(component.screen_rows(), screen().len());
    }

    fn screen() -> Vec<String> {
        (0..HEIGHT).map(|row| format!("row {row} ░▒▓█▀▄")).collect()
    }

    fn component(egg: EasterEgg3d) -> EasterEgg3dComponent {
        EasterEgg3dComponent::new(screen(), egg, Instant::now())
    }

    fn contains_dust(lines: &[String]) -> bool {
        lines.iter().any(|line| {
            line.chars().any(|character| {
                let code = character as u32;
                (0x2800..=0x28ff).contains(&code) || (0x2580..=0x259f).contains(&code)
            })
        })
    }

    #[test]
    fn frame_at_zero_is_the_captured_screen() {
        let egg = component(EasterEgg3d::PiLogo { column: 0, row: 0 });
        assert_eq!(egg.render_at(WIDTH, 0.0), screen());
    }

    #[test]
    fn frame_after_the_exit_is_the_captured_screen() {
        let egg = component(EasterEgg3d::PiLogo { column: 0, row: 0 });
        assert_eq!(egg.render_at(WIDTH, TOTAL_DURATION), screen());
        assert_eq!(egg.render_at(WIDTH, TOTAL_DURATION + 5.0), screen());
    }

    #[test]
    fn mid_timeline_frame_differs_and_shows_dust() {
        let egg = component(EasterEgg3d::PiLogo { column: 0, row: 0 });
        let frame = egg.render_at(WIDTH, 0.6);
        assert_ne!(frame, screen());
        assert!(contains_dust(&frame), "expected dust in {frame:?}");
    }

    #[test]
    fn the_model_is_drawn_in_braille() {
        let egg = component(EasterEgg3d::PiLogo { column: 0, row: 0 });
        let frame = egg.render_at(WIDTH, 3.0);
        assert!(contains_dust(&frame), "expected the model in {frame:?}");
    }

    #[test]
    fn both_models_render() {
        let logo = component(EasterEgg3d::PiLogo { column: 2, row: 1 });
        let armin = component(EasterEgg3d::Armin);
        for egg in [&logo, &armin] {
            let frame = egg.render_at(WIDTH, 3.0);
            assert_eq!(frame.len(), HEIGHT);
            assert!(frame.iter().any(|line| !line.is_empty()));
            assert!(contains_dust(&frame), "expected the model in {frame:?}");
        }
    }

    #[test]
    fn the_render_is_a_pure_function_of_the_time() {
        let egg = component(EasterEgg3d::PiLogo { column: 0, row: 0 });
        assert_eq!(egg.render_at(WIDTH, 2.5), egg.render_at(WIDTH, 2.5));
        assert_eq!(egg.render_at(WIDTH, 6.0), egg.render_at(WIDTH, 6.0));
    }

    #[test]
    fn the_screen_reassembles_during_the_exit() {
        let egg = component(EasterEgg3d::PiLogo { column: 0, row: 0 });
        let dissolved = egg.render_at(WIDTH, 3.0);
        let reassembling = egg.render_at(WIDTH, SHOW_END + EXIT_DURATION * 0.9);
        assert_ne!(dissolved, reassembling);
        assert_eq!(egg.render_at(WIDTH, TOTAL_DURATION), screen());
    }

    #[test]
    fn the_dust_wave_reaches_the_far_cells_last() {
        let egg = component(EasterEgg3d::PiLogo { column: 0, row: 0 });
        let cells = egg.prepare_cells(WIDTH);
        let near = cells[0][0].delay;
        let far = cells[HEIGHT - 1].last().expect("a cell").delay;
        assert!(near < far, "near {near} should dissolve before far {far}");
        assert!(near >= FLY_START);
        assert!(far <= FLY_START + WAVE_SPREAD + WAVE_JITTER);
    }

    #[test]
    fn the_blocks_return_home_after_the_puzzle() {
        let egg = component(EasterEgg3d::PiLogo { column: 0, row: 0 });
        let offsets = egg.block_offsets(PUZZLE_START + PUZZLE_CYCLE);
        assert!(offsets
            .iter()
            .all(|offset| offset.iter().all(|value| *value == 0.0)));
        let moved = egg.block_offsets(PUZZLE_START + PUZZLE_STEP);
        assert!(moved
            .iter()
            .any(|offset| offset.iter().any(|value| *value != 0.0)));
    }

    #[test]
    fn the_shuffle_is_deterministic() {
        let egg = component(EasterEgg3d::PiLogo { column: 0, row: 0 });
        assert_eq!(egg.shuffle_steps(0), egg.shuffle_steps(0));
        assert_ne!(egg.shuffle_steps(0), egg.shuffle_steps(1));
    }

    #[test]
    fn the_effect_finishes_after_the_timeline() {
        let egg = component(EasterEgg3d::Armin);
        assert!(!egg.is_finished());
        assert!(TOTAL_DURATION > SHOW_END);
        assert!(SHOW_END > PUZZLE_START + PUZZLE_CYCLE - PUZZLE_STEP);
    }

    #[test]
    fn the_parsed_cells_keep_their_colours() {
        let lines = vec!["\x1b[38;2;10;20;30mhi\x1b[0m".to_string()];
        let cells = parse_screen(&lines, 10, [255.0; 3], [0.0; 3]);
        assert_eq!(cells.len(), 1);
        assert_eq!(cells[0].len(), 2);
        assert_eq!(cells[0][0].text, "h");
        assert_eq!(cells[0][0].fg, [10.0, 20.0, 30.0]);
        assert_eq!(cells[0][1].fg, [10.0, 20.0, 30.0]);
    }

    #[test]
    fn the_parsed_cells_resolve_indexed_colours() {
        let lines = vec!["\x1b[38;5;196mA\x1b[0m".to_string()];
        let cells = parse_screen(&lines, 10, [255.0; 3], [0.0; 3]);
        assert_eq!(cells[0][0].fg, indexed_color(196));
    }

    #[test]
    fn the_model_replaces_the_header_logo() {
        let egg = component(EasterEgg3d::PiLogo { column: 1, row: 2 });
        let cells = egg.prepare_cells(WIDTH);
        assert_eq!(cells[2][1].text, " ");
        assert_eq!(cells[2][1].ink, 0);
    }
}
