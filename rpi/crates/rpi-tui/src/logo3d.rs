//! The spinning 3D pi logo, drawn with braille dots.
//!
//! Port of `packages/coding-agent/src/modes/interactive/components/easter-egg-3d.ts`:
//! the 4x4 pixel logo model, its 3D projection, the spin, the per-dot ray casting
//! into braille cells, the halo and the starfield.

use std::sync::Mutex;

use crate::clock;
use crate::component::Component;

/// An RGB color with float channels.
pub type Rgb = [f64; 3];

/// The logo's coral.
pub const CORAL: Rgb = [228.0, 138.0, 122.0];
/// The logo's blue.
pub const BLUE: Rgb = [79.0, 142.0, 179.0];
/// The logo's yellow.
pub const YELLOW: Rgb = [234.0, 182.0, 93.0];

/// Braille cells the logo occupies in the empty-session screen.
pub const LOGO_CELLS_WIDTH: usize = 32;
/// Braille cells the logo occupies in the empty-session screen.
pub const LOGO_CELLS_HEIGHT: usize = 16;
/// Braille dots per model pixel.
pub const LOGO_SCALE: f64 = 9.0;

const DEPTH: f64 = 0.7;
const FLY_START: f64 = 0.1;
const FLY_DURATION: f64 = 1.3;

const PUZZLE_START: f64 = FLY_START + FLY_DURATION + 3.0;
const PUZZLE_STEP: f64 = 0.3;
const PUZZLE_STEPS: usize = 12;
const PUZZLE_RETURN: f64 = 1.0;
const PUZZLE_HOLD: f64 = 0.6;
const PUZZLE_CYCLE: f64 = PUZZLE_STEP * PUZZLE_STEPS as f64 + PUZZLE_RETURN + PUZZLE_HOLD;

const SPIN_RAMP: f64 = 1.4;
const SPIN_SPEED: f64 = std::f64::consts::PI * 2.0 / PUZZLE_CYCLE;
const SPIN_LINGER: f64 = 0.6;
const FIRST_FRONT_VIEW: f64 =
    PUZZLE_START + PUZZLE_STEP * PUZZLE_STEPS as f64 + PUZZLE_RETURN + PUZZLE_HOLD / 2.0;

const LOGO_COLOR_STEP: f64 = 5.0;
/// The halo's strength on light backgrounds.
pub const LIGHT_HALO_STRENGTH: f64 = 0.3;
const HALO_RADIUS_X: i64 = 6;
const HALO_RADIUS_Y: i64 = 3;
const HALO_LEVELS: f64 = 32.0;
const STAR_ALPHA_LEVELS: f64 = 8.0;
const STAR_FLICKER_LEVELS: f64 = 3.0;
const STAR_DENSITY: f64 = 0.018;
const STAR_TINTS: [Rgb; 4] = [
    [255.0, 255.0, 255.0],
    [170.0, 195.0, 255.0],
    [255.0, 225.0, 170.0],
    [255.0, 190.0, 205.0],
];

const DOT_BITS: [u8; 8] = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80];

/// The light direction, normalized exactly as the reference does.
const LIGHT: [f64; 3] = [
    -0.424_264_068_711_928_57,
    -0.565_685_424_949_238,
    std::f64::consts::FRAC_1_SQRT_2,
];

/// The half vector between the light and the view direction, normalized.
const HALF_VECTOR: [f64; 3] = [
    -0.229_610_059_419_053_9,
    -0.306_146_745_892_071_8,
    0.923_879_532_511_286_7,
];

/// The 4x4 pixel logo model, one character per pixel.
const PI_LOGO_PIXELS: [&str; 4] = ["ccc.", "b.c.", "bb.y", "b..y"];

/// One block of the model, with its home cell and color.
#[derive(Clone, Copy, Debug)]
pub struct Block {
    /// Grid position of the block: column, row and depth layer.
    pub home: [i32; 3],
    /// The block's color.
    pub color: Rgb,
}

/// A bitmap built from one block per foreground pixel.
#[derive(Clone, Debug)]
pub struct Model {
    /// Bitmap size in pixels.
    pub columns: f64,
    /// Bitmap size in pixels.
    pub rows: f64,
    /// The model's blocks.
    pub blocks: Vec<Block>,
    /// Camera distance from the model's center, in pixels.
    pub camera_distance: f64,
    /// Farthest distance of any block corner from the center.
    pub radius: f64,
    /// Largest share of the screen width the spinning model covers.
    pub width_share: f64,
}

/// An axis-aligned box in model space.
#[derive(Clone, Copy, Debug)]
pub struct Box3 {
    /// The box's minimum corner.
    pub min: [f64; 3],
    /// The box's maximum corner.
    pub max: [f64; 3],
    /// The box's color.
    pub color: Rgb,
}

/// The model's placement and orientation at one point in time.
#[derive(Clone, Copy, Debug)]
pub struct Pose {
    /// Screen position of the model's center, in braille dots.
    pub center_x: f64,
    /// Screen position of the model's center, in braille dots.
    pub center_y: f64,
    /// Braille dots per model pixel at depth 0.
    pub scale: f64,
    /// Rotation around the vertical axis.
    pub yaw: f64,
    /// Rotation around the horizontal axis.
    pub pitch: f64,
    /// Rotation around the depth axis.
    pub roll: f64,
}

/// A star behind the logo.
#[derive(Clone, Copy, Debug)]
pub struct Star {
    /// The braille character with the single dot the star occupies.
    pub glyph: char,
    /// The color the star leans toward.
    pub tint: Rgb,
    /// Largest step from the background toward the tint, from 0 to 1.
    pub strength: f64,
    /// Flicker phase in radians.
    pub phase: f64,
    /// Flicker speed in radians per second.
    pub speed: f64,
}

/// One rendered braille cell of the logo.
#[derive(Clone, Copy, Debug)]
pub struct LogoCell {
    /// The cell's character, a space when the cell is empty.
    pub glyph: char,
    /// The cell's color, `None` when the cell is empty.
    pub color: Option<Rgb>,
}

#[derive(Clone, Copy, Debug)]
struct Face {
    axis: usize,
    plane: f64,
    u_min: f64,
    u_max: f64,
    v_min: f64,
    v_max: f64,
    min_x: i64,
    min_y: i64,
    max_x: i64,
    max_y: i64,
    red: f64,
    green: f64,
    blue: f64,
}

#[derive(Clone, Copy, Debug)]
struct Rect {
    min_x: i64,
    min_y: i64,
    max_x: i64,
    max_y: i64,
}

/// Renders the model's blocks into braille cells.
///
/// Only faces that point at the camera and are not covered by a touching block
/// are drawn. Each face is rasterized over its projected bounds by intersecting
/// each dot's ray with the face's plane, with a depth buffer resolving overlaps.
pub struct BlockRaster {
    camera_distance: f64,
    width: usize,
    height: usize,
    bits: Vec<u8>,
    counts: Vec<u8>,
    rgb: Vec<f32>,
    halo_amount: Vec<f32>,
    halo_rgb: Vec<f32>,
    depth: Vec<f32>,
    face_ids: Vec<u16>,
    dirty: Option<Rect>,
    halo_dirty: Option<Rect>,
}

impl BlockRaster {
    /// A raster for a model whose center is `camera_distance` pixels from the camera.
    pub fn new(camera_distance: f64) -> Self {
        Self {
            camera_distance,
            width: 0,
            height: 0,
            bits: Vec::new(),
            counts: Vec::new(),
            rgb: Vec::new(),
            halo_amount: Vec::new(),
            halo_rgb: Vec::new(),
            depth: Vec::new(),
            face_ids: Vec::new(),
            dirty: None,
            halo_dirty: None,
        }
    }

    /// Braille dot bits per cell.
    pub fn bits(&self) -> &[u8] {
        &self.bits
    }

    /// Lit dots per cell.
    pub fn counts(&self) -> &[u8] {
        &self.counts
    }

    /// Summed RGB of the lit dots per cell.
    pub fn rgb(&self) -> &[f32] {
        &self.rgb
    }

    /// Halo tint strength per cell, from 0 to 1.
    pub fn halo_amount(&self) -> &[f32] {
        &self.halo_amount
    }

    /// Halo color per cell.
    pub fn halo_rgb(&self) -> &[f32] {
        &self.halo_rgb
    }

    /// Renders the model's blocks into the cells of a `width` by `height` grid.
    pub fn render(
        &mut self,
        width: usize,
        height: usize,
        pose: &Pose,
        boxes: &[Box3],
        background: Rgb,
        halo_strength: f64,
    ) {
        let dot_width = width * 2;
        let dot_height = height * 4;
        if width != self.width || height != self.height {
            self.width = width;
            self.height = height;
            self.bits = vec![0; width * height];
            self.counts = vec![0; width * height];
            self.rgb = vec![0.0; width * height * 3];
            self.halo_amount = vec![0.0; width * height];
            self.halo_rgb = vec![0.0; width * height * 3];
            self.halo_dirty = None;
            self.depth = vec![f32::INFINITY; dot_width * dot_height];
            self.face_ids = vec![0; dot_width * dot_height];
            self.dirty = None;
        } else if let Some(cells) = self.dirty {
            for row in cells.min_y..=cells.max_y {
                let row_start = (row * width as i64) as usize;
                let start = row_start + cells.min_x as usize;
                let end = row_start + cells.max_x as usize + 1;
                self.bits[start..end].fill(0);
                self.counts[start..end].fill(0);
                self.rgb[start * 3..end * 3].fill(0.0);
            }
            self.dirty = None;
        }
        if let Some(cells) = self.halo_dirty {
            for row in cells.min_y..=cells.max_y {
                let row_start = (row * width as i64) as usize;
                let start = row_start + cells.min_x as usize;
                let end = row_start + cells.max_x as usize + 1;
                self.halo_amount[start..end].fill(0.0);
                self.halo_rgb[start * 3..end * 3].fill(0.0);
            }
            self.halo_dirty = None;
        }

        let m = rotation(pose.yaw, pose.pitch, pose.roll);
        let camera_distance = self.camera_distance;
        let origin = [
            m[6] * camera_distance,
            m[7] * camera_distance,
            m[8] * camera_distance,
        ];
        let light = is_light(background);
        let faces = visible_faces(
            &m,
            &origin,
            pose,
            boxes,
            dot_width,
            dot_height,
            light,
            camera_distance,
        );
        if faces.is_empty() {
            return;
        }
        let mut min_x = dot_width as i64;
        let mut min_y = dot_height as i64;
        let mut max_x: i64 = -1;
        let mut max_y: i64 = -1;
        for face in &faces {
            min_x = min_x.min(face.min_x);
            min_y = min_y.min(face.min_y);
            max_x = max_x.max(face.max_x);
            max_y = max_y.max(face.max_y);
        }
        if max_x < min_x || max_y < min_y {
            return;
        }

        for (face_index, face) in faces.iter().enumerate() {
            let a = face.axis;
            let u = (a + 1) % 3;
            let v = (a + 2) % 3;
            let origin_a = origin[a];
            let origin_u = origin[u];
            let origin_v = origin[v];
            let step_a = m[a] / pose.scale;
            let step_u = m[u] / pose.scale;
            let step_v = m[v] / pose.scale;
            let sx = (face.min_x as f64 + 0.5 - pose.center_x) / pose.scale;
            for dot_y in face.min_y..=face.max_y {
                let sy = (dot_y as f64 + 0.5 - pose.center_y) / pose.scale;
                let mut direction_a = m[a] * sx + m[3 + a] * sy - m[6 + a] * camera_distance;
                let mut direction_u = m[u] * sx + m[3 + u] * sy - m[6 + u] * camera_distance;
                let mut direction_v = m[v] * sx + m[3 + v] * sy - m[6 + v] * camera_distance;
                for dot_x in face.min_x..=face.max_x {
                    let index = (dot_y * dot_width as i64 + dot_x) as usize;
                    let t = (face.plane - origin_a) / direction_a;
                    if t > 0.0 && t < self.depth[index] as f64 {
                        let hit_u = origin_u + t * direction_u;
                        let hit_v = origin_v + t * direction_v;
                        if hit_u >= face.u_min
                            && hit_u <= face.u_max
                            && hit_v >= face.v_min
                            && hit_v <= face.v_max
                        {
                            self.depth[index] = t as f32;
                            self.face_ids[index] = face_index as u16 + 1;
                        }
                    }
                    direction_a += step_a;
                    direction_u += step_u;
                    direction_v += step_v;
                }
            }
        }

        let mut cell_min_x = width as i64;
        let mut cell_min_y = height as i64;
        let mut cell_max_x: i64 = -1;
        let mut cell_max_y: i64 = -1;
        for dot_y in min_y..=max_y {
            for dot_x in min_x..=max_x {
                let index = (dot_y * dot_width as i64 + dot_x) as usize;
                let id = self.face_ids[index];
                if id == 0 {
                    continue;
                }
                let face = &faces[(id - 1) as usize];
                let fog = clamp01(0.15 - camera_distance * (1.0 - self.depth[index] as f64) * 0.12)
                    * if light { 0.5 } else { 1.0 };
                self.face_ids[index] = 0;
                self.depth[index] = f32::INFINITY;
                let cell_x = dot_x / 2;
                let cell_y = dot_y / 4;
                let cell = (cell_y * width as i64 + cell_x) as usize;
                self.bits[cell] |= DOT_BITS[((dot_y & 3) * 2 + (dot_x & 1)) as usize];
                self.counts[cell] += 1;
                self.rgb[cell * 3] = (self.rgb[cell * 3] as f64
                    + face.red
                    + (background[0] - face.red) * fog) as f32;
                self.rgb[cell * 3 + 1] = (self.rgb[cell * 3 + 1] as f64
                    + face.green
                    + (background[1] - face.green) * fog)
                    as f32;
                self.rgb[cell * 3 + 2] =
                    (self.rgb[cell * 3 + 2] as f64 + face.blue + (background[2] - face.blue) * fog)
                        as f32;
                cell_min_x = cell_min_x.min(cell_x);
                cell_max_x = cell_max_x.max(cell_x);
                cell_min_y = cell_min_y.min(cell_y);
                cell_max_y = cell_max_y.max(cell_y);
            }
        }
        if cell_max_x >= 0 {
            self.dirty = Some(Rect {
                min_x: cell_min_x,
                min_y: cell_min_y,
                max_x: cell_max_x,
                max_y: cell_max_y,
            });
        }
        if halo_strength > 0.0 {
            self.render_halo(halo_strength);
        }
    }

    /// Blur the logo's coverage and color over neighboring cells with a separable
    /// tent filter, so the tint falls off smoothly past the logo's edges.
    fn render_halo(&mut self, strength: f64) {
        let cells = match self.dirty {
            Some(cells) => cells,
            None => return,
        };
        let width = self.width as i64;
        let height = self.height as i64;
        let min_x = 0.max(cells.min_x - HALO_RADIUS_X);
        let max_x = (width - 1).min(cells.max_x + HALO_RADIUS_X);
        let min_y = 0.max(cells.min_y - HALO_RADIUS_Y);
        let max_y = (height - 1).min(cells.max_y + HALO_RADIUS_Y);
        let region_width = max_x - min_x + 1;
        let weights_x = tent_weights(HALO_RADIUS_X);
        let weights_y = tent_weights(HALO_RADIUS_Y);

        let rows = cells.max_y - cells.min_y + 1;
        let mut horizontal = vec![0.0f32; (rows * region_width * 4) as usize];
        for y in cells.min_y..=cells.max_y {
            for x in min_x..=max_x {
                let mut coverage = 0.0f64;
                let mut red = 0.0f64;
                let mut green = 0.0f64;
                let mut blue = 0.0f64;
                for dx in -HALO_RADIUS_X..=HALO_RADIUS_X {
                    let source_x = x + dx;
                    if source_x < cells.min_x || source_x > cells.max_x {
                        continue;
                    }
                    let source = (y * width + source_x) as usize;
                    let count = self.counts[source];
                    if count == 0 {
                        continue;
                    }
                    let weight = weights_x[(dx + HALO_RADIUS_X) as usize] / 8.0;
                    coverage += count as f64 * weight;
                    red += self.rgb[source * 3] as f64 * weight;
                    green += self.rgb[source * 3 + 1] as f64 * weight;
                    blue += self.rgb[source * 3 + 2] as f64 * weight;
                }
                let target = (((y - cells.min_y) * region_width + (x - min_x)) * 4) as usize;
                horizontal[target] = coverage as f32;
                horizontal[target + 1] = red as f32;
                horizontal[target + 2] = green as f32;
                horizontal[target + 3] = blue as f32;
            }
        }

        for y in min_y..=max_y {
            for x in min_x..=max_x {
                let mut coverage = 0.0f64;
                let mut red = 0.0f64;
                let mut green = 0.0f64;
                let mut blue = 0.0f64;
                for dy in -HALO_RADIUS_Y..=HALO_RADIUS_Y {
                    let source_y = y + dy;
                    if source_y < cells.min_y || source_y > cells.max_y {
                        continue;
                    }
                    let weight = weights_y[(dy + HALO_RADIUS_Y) as usize];
                    let source =
                        (((source_y - cells.min_y) * region_width + (x - min_x)) * 4) as usize;
                    coverage += horizontal[source] as f64 * weight;
                    red += horizontal[source + 1] as f64 * weight;
                    green += horizontal[source + 2] as f64 * weight;
                    blue += horizontal[source + 3] as f64 * weight;
                }
                let target = (y * width + x) as usize;
                let count = self.counts[target];
                if count > 0 && count as f64 / 8.0 > coverage {
                    coverage = count as f64 / 8.0;
                    red = (self.rgb[target * 3] as f64 / count as f64) * coverage;
                    green = (self.rgb[target * 3 + 1] as f64 / count as f64) * coverage;
                    blue = (self.rgb[target * 3 + 2] as f64 / count as f64) * coverage;
                }
                if coverage <= 0.0 {
                    continue;
                }
                let amount =
                    js_round(strength * coverage.min(1.0).powf(0.7) * HALO_LEVELS) / HALO_LEVELS;
                if amount <= 0.0 {
                    continue;
                }
                self.halo_amount[target] = amount as f32;
                self.halo_rgb[target * 3] =
                    (js_round(red / coverage / LOGO_COLOR_STEP) * LOGO_COLOR_STEP) as f32;
                self.halo_rgb[target * 3 + 1] =
                    (js_round(green / coverage / LOGO_COLOR_STEP) * LOGO_COLOR_STEP) as f32;
                self.halo_rgb[target * 3 + 2] =
                    (js_round(blue / coverage / LOGO_COLOR_STEP) * LOGO_COLOR_STEP) as f32;
            }
        }
        self.halo_dirty = Some(Rect {
            min_x,
            min_y,
            max_x,
            max_y,
        });
    }
}

fn tent_weights(radius: i64) -> Vec<f64> {
    let count = (radius * 2 + 1) as usize;
    let weights: Vec<f64> = (0..count)
        .map(|i| (radius + 1 - (i as i64 - radius).abs()) as f64)
        .collect();
    let total: f64 = weights.iter().sum();
    weights.into_iter().map(|weight| weight / total).collect()
}

#[allow(clippy::too_many_arguments)]
fn visible_faces(
    m: &[f64; 9],
    origin: &[f64; 3],
    pose: &Pose,
    boxes: &[Box3],
    dot_width: usize,
    dot_height: usize,
    light_background: bool,
    camera_distance: f64,
) -> Vec<Face> {
    let mut faces = Vec::new();
    for (index, b) in boxes.iter().enumerate() {
        for a in 0..3 {
            let u = (a + 1) % 3;
            let v = (a + 2) % 3;
            for side in [-1.0f64, 1.0] {
                let plane = if side > 0.0 { b.max[a] } else { b.min[a] };
                if (origin[a] - plane) * side <= 0.0 {
                    continue;
                }
                let covered = boxes.iter().enumerate().any(|(other_index, other)| {
                    other_index != index
                        && (if side > 0.0 {
                            other.min[a]
                        } else {
                            other.max[a]
                        }) == plane
                        && other.min[u] <= b.min[u]
                        && other.max[u] >= b.max[u]
                        && other.min[v] <= b.min[v]
                        && other.max[v] >= b.max[v]
                });
                if covered {
                    continue;
                }

                let mut min_x = f64::INFINITY;
                let mut min_y = f64::INFINITY;
                let mut max_x = f64::NEG_INFINITY;
                let mut max_y = f64::NEG_INFINITY;
                let mut corner = [0.0f64; 3];
                for corner_u in [b.min[u], b.max[u]] {
                    for corner_v in [b.min[v], b.max[v]] {
                        corner[a] = plane;
                        corner[u] = corner_u;
                        corner[v] = corner_v;
                        let x = m[0] * corner[0] + m[1] * corner[1] + m[2] * corner[2];
                        let y = m[3] * corner[0] + m[4] * corner[1] + m[5] * corner[2];
                        let z = m[6] * corner[0] + m[7] * corner[1] + m[8] * corner[2];
                        let perspective = (pose.scale * camera_distance) / (camera_distance - z);
                        let screen_x = pose.center_x + x * perspective;
                        let screen_y = pose.center_y + y * perspective;
                        min_x = min_x.min(screen_x);
                        min_y = min_y.min(screen_y);
                        max_x = max_x.max(screen_x);
                        max_y = max_y.max(screen_y);
                    }
                }
                let face_min_x = min_x.floor().max(0.0);
                let face_min_y = min_y.floor().max(0.0);
                let face_max_x = max_x.ceil().min(dot_width as f64 - 1.0);
                let face_max_y = max_y.ceil().min(dot_height as f64 - 1.0);
                if face_max_x < face_min_x || face_max_y < face_min_y {
                    continue;
                }

                let nx = m[a] * side;
                let ny = m[3 + a] * side;
                let nz = m[6 + a] * side;
                let diffuse = (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]).max(0.0);
                let rim = (nx * 0.8 - nz * 0.3).max(0.0);
                let specular = if light_background {
                    0.0
                } else {
                    (nx * HALF_VECTOR[0] + ny * HALF_VECTOR[1] + nz * HALF_VECTOR[2])
                        .max(0.0)
                        .powf(24.0)
                        * 0.6
                        * 255.0
                };
                let light = if light_background {
                    (0.55 + diffuse * 0.45 + rim * 0.1).min(1.0)
                } else {
                    0.45 + diffuse * 0.78 + rim * 0.25
                };
                faces.push(Face {
                    axis: a,
                    plane,
                    u_min: b.min[u],
                    u_max: b.max[u],
                    v_min: b.min[v],
                    v_max: b.max[v],
                    min_x: face_min_x as i64,
                    min_y: face_min_y as i64,
                    max_x: face_max_x as i64,
                    max_y: face_max_y as i64,
                    red: (b.color[0] * light + specular).min(255.0),
                    green: (b.color[1] * light + specular).min(255.0),
                    blue: (b.color[2] * light + specular).min(255.0),
                });
            }
        }
    }
    faces
}

/// The pi logo's model: one block per foreground pixel of the 4x4 bitmap.
pub fn pi_logo_model() -> Model {
    let columns = 4.0;
    let rows = 4.0;
    let mut blocks = Vec::new();
    for (row, line) in PI_LOGO_PIXELS.iter().enumerate() {
        for (column, pixel) in line.chars().enumerate() {
            let color = match pixel {
                'c' => Some(CORAL),
                'b' => Some(BLUE),
                'y' => Some(YELLOW),
                _ => None,
            };
            if let Some(color) = color {
                blocks.push(Block {
                    home: [column as i32, row as i32, 0],
                    color,
                });
            }
        }
    }
    Model {
        columns,
        rows,
        blocks,
        camera_distance: 10.0,
        radius: (columns / 2.0).hypot(rows / 2.0).hypot(1.0 + DEPTH / 2.0),
        width_share: 0.35,
    }
}

/// The model's boxes at rest, in model space.
pub fn model_boxes(model: &Model) -> Vec<Box3> {
    model
        .blocks
        .iter()
        .map(|block| {
            let x = block.home[0] as f64 - model.columns / 2.0;
            let y = block.home[1] as f64 - model.rows / 2.0;
            Box3 {
                min: [x, y, -DEPTH / 2.0],
                max: [x + 1.0, y + 1.0, DEPTH / 2.0],
                color: block.color,
            }
        })
        .collect()
}

/// The pose of the logo in the empty-session screen at the given time in seconds.
pub fn logo_pose(time: f64) -> Pose {
    let phase = spin_phase(time);
    Pose {
        center_x: LOGO_CELLS_WIDTH as f64,
        center_y: LOGO_CELLS_HEIGHT as f64 * 2.0,
        scale: LOGO_SCALE,
        yaw: spin_angle(time),
        pitch: 0.3 * phase.sin(),
        roll: 0.06 * (2.0 * phase).sin(),
    }
}

/// Uniform spin that accelerates from rest over the ramp, then turns at a constant speed.
pub fn base_spin_phase(time: f64) -> f64 {
    let elapsed = time - FLY_START;
    if elapsed <= 0.0 {
        return 0.0;
    }
    let u = elapsed / SPIN_RAMP;
    if u < 1.0 {
        return SPIN_SPEED * SPIN_RAMP * (u.powi(6) - 3.0 * u.powi(5) + 2.5 * u.powi(4));
    }
    SPIN_SPEED * (SPIN_RAMP * 0.5 + elapsed - SPIN_RAMP)
}

/// Extra rotation added during the flight, so the phase is a whole number of
/// turns at every assembled front view.
fn spin_alignment() -> f64 {
    std::f64::consts::PI * 2.0 - (base_spin_phase(FIRST_FRONT_VIEW) % (std::f64::consts::PI * 2.0))
}

/// Spin phase: whole turns exactly when the reassembled logo faces the camera.
pub fn spin_phase(time: f64) -> f64 {
    base_spin_phase(time) + spin_alignment() * smooth((time - FLY_START) / FLY_DURATION)
}

/// Yaw of the logo. It matches the phase at whole turns but lingers there, so
/// the logo reads from the front.
pub fn spin_angle(time: f64) -> f64 {
    let phase = spin_phase(time);
    phase - SPIN_LINGER * phase.sin()
}

/// The first time the reassembled logo faces the camera.
pub fn first_front_view() -> f64 {
    FIRST_FRONT_VIEW
}

/// A sparse, deterministic starfield: one braille dot in about `STAR_DENSITY` of all cells.
pub fn prepare_stars(width: usize, height: usize) -> Vec<Option<Star>> {
    let mut stars = vec![None; width * height];
    for (index, star) in stars.iter_mut().enumerate() {
        if hash(index as f64 * 3.0 + 0x51ed as f64) >= STAR_DENSITY {
            continue;
        }
        let random = |salt: f64| hash(index as f64 * 7.0 + salt * 0x9e37 as f64);
        *star = Some(Star {
            glyph: braille_char(DOT_BITS[(random(1.0) * 8.0).floor() as usize]),
            tint: STAR_TINTS[(random(2.0) * STAR_TINTS.len() as f64).floor() as usize],
            strength: 0.1 + random(3.0) * 0.12,
            phase: random(4.0) * std::f64::consts::PI * 2.0,
            speed: 0.4 + random(5.0) * 0.8,
        });
    }
    stars
}

/// The starfield's current strength, quantized so a row only changes when one of
/// its stars steps to another level.
pub fn star_level(alpha: f64) -> f64 {
    js_round(alpha * STAR_ALPHA_LEVELS) / STAR_ALPHA_LEVELS
}

/// The color of a star at the given time, with the starfield's current strength.
pub fn star_color(star: &Star, foreground: Rgb, background: Rgb, star_level: f64, now: f64) -> Rgb {
    let flicker =
        js_round((0.5 + 0.5 * (now * star.speed + star.phase).sin()) * STAR_FLICKER_LEVELS)
            / STAR_FLICKER_LEVELS;
    mix(
        background,
        mix(foreground, star.tint, 0.5),
        star.strength * (0.7 + 0.3 * flicker) * star_level,
    )
}

/// The pi logo spinning in place, drawn with braille dots.
///
/// Unlike the fullscreen easter egg it does not dissolve the screen: it renders
/// into its own area, so it can sit above the input box.
pub struct Logo3d {
    raster: Mutex<BlockRaster>,
    boxes: Vec<Box3>,
    background: Rgb,
    start_ms: f64,
}

impl Logo3d {
    /// A logo on a background of the given color.
    pub fn new(background: Rgb) -> Self {
        Self::with_start(background, clock::now_ms())
    }

    /// A logo whose animation started at the given time in milliseconds.
    pub fn with_start(background: Rgb, start_ms: f64) -> Self {
        let model = pi_logo_model();
        Self {
            raster: Mutex::new(BlockRaster::new(model.camera_distance)),
            boxes: model_boxes(&model),
            background,
            start_ms,
        }
    }

    /// Seconds since the logo was created.
    pub fn elapsed(&self) -> f64 {
        (clock::now_ms() - self.start_ms) / 1000.0
    }

    /// The logo's cells at the given time in seconds, `LOGO_CELLS_WIDTH` cells per row.
    pub fn render_cells(&self, time: f64) -> Vec<LogoCell> {
        let pose = logo_pose(time);
        let mut raster = self
            .raster
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        raster.render(
            LOGO_CELLS_WIDTH,
            LOGO_CELLS_HEIGHT,
            &pose,
            &self.boxes,
            self.background,
            0.0,
        );
        let bits = raster.bits();
        let counts = raster.counts();
        let rgb = raster.rgb();
        let mut cells = Vec::with_capacity(LOGO_CELLS_WIDTH * LOGO_CELLS_HEIGHT);
        for index in 0..LOGO_CELLS_WIDTH * LOGO_CELLS_HEIGHT {
            let dots = bits[index];
            if dots == 0 {
                cells.push(LogoCell {
                    glyph: ' ',
                    color: None,
                });
                continue;
            }
            let step = LOGO_COLOR_STEP * counts[index] as f64;
            let color = [
                js_round(rgb[index * 3] as f64 / step) * LOGO_COLOR_STEP,
                js_round(rgb[index * 3 + 1] as f64 / step) * LOGO_COLOR_STEP,
                js_round(rgb[index * 3 + 2] as f64 / step) * LOGO_COLOR_STEP,
            ];
            cells.push(LogoCell {
                glyph: braille_char(dots),
                color: Some(color),
            });
        }
        cells
    }

    /// The logo's lines for a viewport of the given width, at the given time in seconds.
    pub fn render_lines(&self, width: usize, time: f64) -> Vec<String> {
        let cells = self.render_cells(time);
        let visible_width = width.min(LOGO_CELLS_WIDTH);
        let start = (LOGO_CELLS_WIDTH - visible_width) / 2;
        let pad = " ".repeat(width.saturating_sub(LOGO_CELLS_WIDTH) / 2);
        let mut lines = Vec::with_capacity(LOGO_CELLS_HEIGHT);
        for row in 0..LOGO_CELLS_HEIGHT {
            let mut line = String::with_capacity(pad.len() + visible_width * 4);
            line.push_str(&pad);
            let mut current_color: Option<i64> = None;
            for column in start..start + visible_width {
                let cell = cells[row * LOGO_CELLS_WIDTH + column];
                let Some(color) = cell.color else {
                    line.push(' ');
                    continue;
                };
                let key = (color[0] as i64) << 16 | (color[1] as i64) << 8 | color[2] as i64;
                if current_color != Some(key) {
                    line.push_str("\x1b[38;2;");
                    line.push_str(&(color[0] as i64).to_string());
                    line.push(';');
                    line.push_str(&(color[1] as i64).to_string());
                    line.push(';');
                    line.push_str(&(color[2] as i64).to_string());
                    line.push('m');
                    current_color = Some(key);
                }
                line.push(cell.glyph);
            }
            line.push_str("\x1b[0m");
            lines.push(line);
        }
        lines
    }
}

impl Component for Logo3d {
    fn render(&self, width: usize) -> Vec<String> {
        self.render_lines(width, self.elapsed())
    }

    fn invalidate(&self) {}

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}

/// Row-major 3x3 rotation matrix for yaw (y), then pitch (x), then roll (z).
fn rotation(yaw: f64, pitch: f64, roll: f64) -> [f64; 9] {
    let sy = yaw.sin();
    let cy = yaw.cos();
    let sx = pitch.sin();
    let cx = pitch.cos();
    let sz = roll.sin();
    let cz = roll.cos();
    let ry = [cy, 0.0, sy, 0.0, 1.0, 0.0, -sy, 0.0, cy];
    let rx = [1.0, 0.0, 0.0, 0.0, cx, -sx, 0.0, sx, cx];
    let rz = [cz, -sz, 0.0, sz, cz, 0.0, 0.0, 0.0, 1.0];
    multiply(&rz, &multiply(&rx, &ry))
}

fn multiply(a: &[f64; 9], b: &[f64; 9]) -> [f64; 9] {
    let mut result = [0.0f64; 9];
    for row in 0..3 {
        for column in 0..3 {
            result[row * 3 + column] = a[row * 3] * b[column]
                + a[row * 3 + 1] * b[3 + column]
                + a[row * 3 + 2] * b[6 + column];
        }
    }
    result
}

/// Whether a background is light, by relative luminance.
pub fn is_light([r, g, b]: Rgb) -> bool {
    0.2126 * r + 0.7152 * g + 0.0722 * b > 128.0
}

/// Quintic smoothstep.
pub fn smooth(value: f64) -> f64 {
    let t = clamp01(value);
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

/// Mix two colors.
pub fn mix(a: Rgb, b: Rgb, amount: f64) -> Rgb {
    [
        a[0] + (b[0] - a[0]) * amount,
        a[1] + (b[1] - a[1]) * amount,
        a[2] + (b[2] - a[2]) * amount,
    ]
}

/// The reference's hash: a deterministic pseudo random number from 0 to 1.
pub fn hash(value: f64) -> f64 {
    let mut x = to_int32(value) ^ 0x9e37_79b9;
    x = x.wrapping_mul(0x85eb_ca6b);
    x ^= x >> 13;
    x = x.wrapping_mul(0xc2b2_ae35);
    x ^= x >> 16;
    x as f64 / 4_294_967_296.0
}

fn to_int32(value: f64) -> u32 {
    value.trunc().rem_euclid(4_294_967_296.0) as u32
}

fn clamp01(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

fn braille_char(bits: u8) -> char {
    char::from_u32(0x2800 + bits as u32).unwrap_or(' ')
}

#[cfg(test)]
mod tests {
    use super::*;

    const REFERENCE_0: [&str; 16] = [
    "                                                                  \x1b[0m",
    "                                                                  \x1b[0m",
    "                                                                  \x1b[0m",
    "                                        \x1b[38;2;225;145;130m⢰⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⡆           \x1b[0m",
    "                                        \x1b[38;2;225;145;130m⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇           \x1b[0m",
    "                                        \x1b[38;2;190;145;140m⢸⣿⣿⣿⣿\x1b[38;2;205;145;135m⡿\x1b[38;2;225;145;130m⠿⠿⠿⠿⣿⣿⣿⣿⡇           \x1b[0m",
    "                                        \x1b[38;2;90;145;180m⢸⣿⣿⣿⣿⡇    \x1b[38;2;225;145;130m⣿⣿⣿⣿⡇           \x1b[0m",
    "                                        \x1b[38;2;90;145;180m⢸⣿⣿⣿⣿⡇    \x1b[38;2;225;145;130m⣿⣿⣿⣿⡇           \x1b[0m",
    "                                        \x1b[38;2;90;145;180m⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿    \x1b[38;2;225;185;105m⢸⣿⣿⣿⣿⡇      \x1b[0m",
    "                                        \x1b[38;2;90;145;180m⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿    \x1b[38;2;225;185;105m⢸⣿⣿⣿⣿⡇      \x1b[0m",
    "                                        \x1b[38;2;90;145;180m⢸⣿⣿⣿⣿⡏⠉⠉⠉⠉    \x1b[38;2;225;185;105m⢸⣿⣿⣿⣿⡇      \x1b[0m",
    "                                        \x1b[38;2;90;145;180m⢸⣿⣿⣿⣿⡇        \x1b[38;2;225;185;105m⢸⣿⣿⣿⣿⡇      \x1b[0m",
    "                                        \x1b[38;2;90;145;180m⠸⠿⠿⠿⠿⠇        \x1b[38;2;225;185;105m⠸⠿⠿⠿⠿⠇      \x1b[0m",
    "                                                                  \x1b[0m",
    "                                                                  \x1b[0m",
    "                                                                  \x1b[0m",
];

    const REFERENCE_2000: [&str; 16] = [
    "                                                                  \x1b[0m",
    "                                                                  \x1b[0m",
    "                                                                  \x1b[0m",
    "                                              \x1b[38;2;230;140;125m⣶\x1b[38;2;235;145;125m⣶\x1b[38;2;240;145;130m⣶\x1b[38;2;130;80;70m⣶\x1b[38;2;125;75;65m⣦\x1b[38;2;120;70;65m⣤\x1b[38;2;115;70;60m⣤\x1b[38;2;110;65;60m⣤\x1b[38;2;105;65;55m⣤\x1b[38;2;100;60;55m⣄\x1b[38;2;95;55;50m⡀         \x1b[0m",
    "                                              \x1b[38;2;230;140;125m⣿\x1b[38;2;235;145;125m⣿\x1b[38;2;240;145;130m⣿\x1b[38;2;125;75;70m⣿\x1b[38;2;125;75;65m⣿\x1b[38;2;120;70;65m⣿\x1b[38;2;115;70;60m⣿\x1b[38;2;110;65;60m⣿\x1b[38;2;105;60;55m⣿\x1b[38;2;95;60;50m⣿\x1b[38;2;95;55;50m⠇         \x1b[0m",
    "                                              \x1b[38;2;230;140;125m⣿\x1b[38;2;235;140;125m⣿\x1b[38;2;195;120;105m⣿\x1b[38;2;125;75;65m⣿\x1b[38;2;120;75;65m⣿\x1b[38;2;110;75;70m⣿\x1b[38;2;100;80;80m⣿\x1b[38;2;95;80;80m⣿\x1b[38;2;85;60;60m⣿\x1b[38;2;80;60;55m⣿          \x1b[0m",
    "                                              \x1b[38;2;225;140;120m⣿\x1b[38;2;230;140;125m⣿\x1b[38;2;180;110;95m⣿\x1b[38;2;125;75;65m⣿\x1b[38;2;120;70;65m⣿\x1b[38;2;90;90;100m⣿\x1b[38;2;65;115;145m⣿\x1b[38;2;65;120;150m⣿\x1b[38;2;35;60;80m⣿\x1b[38;2;30;60;75m⣿          \x1b[0m",
    "                                              \x1b[38;2;225;135;120m⣿\x1b[38;2;230;140;125m⣿\x1b[38;2;180;110;95m⣿\x1b[38;2;120;75;65m⣿\x1b[38;2;120;70;65m⣿\x1b[38;2;90;90;100m⣿\x1b[38;2;65;110;140m⣿\x1b[38;2;55;100;130m⣿\x1b[38;2;35;60;75m⣿\x1b[38;2;30;55;70m⣿          \x1b[0m",
    "                                          \x1b[38;2;245;190;100m⢠\x1b[38;2;240;185;95m⣶\x1b[38;2;235;185;95m⣶\x1b[38;2;195;150;75m⣶\x1b[38;2;175;130;80m⣿\x1b[38;2;180;130;80m⣿\x1b[38;2;130;120;105m⣿\x1b[38;2;85;115;135m⣿⣿\x1b[38;2;45;85;105m⣿\x1b[38;2;35;65;85m⣿\x1b[38;2;35;65;80m⣿\x1b[38;2;35;60;75m⣿\x1b[38;2;30;55;70m⡇          \x1b[0m",
    "                                          \x1b[38;2;245;190;100m⢸⣿⣿\x1b[38;2;135;105;55m⣿⣿\x1b[38;2;130;100;50m⣿\x1b[38;2;100;110;100m⣿\x1b[38;2;70;125;155m⣿\x1b[38;2;70;130;160m⣿\x1b[38;2;40;70;85m⣿\x1b[38;2;35;65;80m⣿\x1b[38;2;35;60;75m⣿\x1b[38;2;30;60;75m⣿\x1b[38;2;30;55;70m⡇          \x1b[0m",
    "                                          \x1b[38;2;245;190;100m⣿⣿⣿\x1b[38;2;135;105;55m⣿⣿\x1b[38;2;130;100;50m⣿\x1b[38;2;125;100;50m⠁\x1b[38;2;70;125;155m⠈\x1b[38;2;70;125;160m⠉\x1b[38;2;55;95;120m⣿\x1b[38;2;60;105;130m⣿\x1b[38;2;50;85;110m⣿\x1b[38;2;30;55;70m⣿\x1b[38;2;30;55;65m⡇          \x1b[0m",
    "                                          \x1b[38;2;245;190;100m⣿⣿⣿\x1b[38;2;135;105;55m⣿\x1b[38;2;130;105;50m⣿\x1b[38;2;130;100;50m⣿   \x1b[38;2;60;105;135m⠿\x1b[38;2;60;110;135m⢿\x1b[38;2;35;65;85m⡿\x1b[38;2;30;55;70m⠟\x1b[38;2;30;50;65m⠁          \x1b[0m",
    "                                          \x1b[38;2;245;190;100m⣿⣿\x1b[38;2;220;170;90m⣿\x1b[38;2;135;105;55m⣿\x1b[38;2;130;100;50m⣿\x1b[38;2;125;100;50m⣿                  \x1b[0m",
    "                                          \x1b[38;2;245;190;100m⠛⠻\x1b[38;2;190;150;75m⠿\x1b[38;2;135;105;55m⠟\x1b[38;2;130;100;50m⠛\x1b[38;2;125;100;50m⠉                  \x1b[0m",
    "                                                                  \x1b[0m",
    "                                                                  \x1b[0m",
];

    const REFERENCE_5000: [&str; 16] = [
    "                                                                  \x1b[0m",
    "                                                                  \x1b[0m",
    "                                          \x1b[38;2;230;140;120m⣠\x1b[38;2;185;110;100m⣶\x1b[38;2;180;110;95m⣤⣄\x1b[38;2;175;105;95m⣀                   \x1b[0m",
    "                                         \x1b[38;2;220;135;120m⢰\x1b[38;2;230;140;125m⣿\x1b[38;2;185;115;100m⣿\x1b[38;2;185;110;100m⣿\x1b[38;2;180;110;95m⣿\x1b[38;2;175;105;95m⣿⣿\x1b[38;2;170;105;90m⣷\x1b[38;2;165;100;90m⣶⣤\x1b[38;2;160;95;85m⣄\x1b[38;2;155;95;85m⣀             \x1b[0m",
    "                                         \x1b[38;2;225;140;120m⢸\x1b[38;2;175;140;140m⣿\x1b[38;2;140;115;120m⣿\x1b[38;2;155;115;110m⣿\x1b[38;2;165;110;105m⣿\x1b[38;2;180;110;95m⣿\x1b[38;2;175;105;95m⣿\x1b[38;2;175;105;90m⣿\x1b[38;2;170;100;90m⣿\x1b[38;2;165;100;90m⣿\x1b[38;2;160;100;85m⣿\x1b[38;2;160;95;85m⣿\x1b[38;2;155;95;85m⣿\x1b[38;2;150;90;80m⡇           \x1b[0m",
    "                                         \x1b[38;2;80;145;185m⣸\x1b[38;2;75;135;170m⣿\x1b[38;2;65;120;150m⣿\x1b[38;2;65;115;145m⣿⣿\x1b[38;2;65;115;140m⣿\x1b[38;2;120;70;65m⠿\x1b[38;2;110;65;60m⣿\x1b[38;2;130;80;70m⣿\x1b[38;2;150;90;80m⣿\x1b[38;2;165;100;90m⣿\x1b[38;2;160;95;85m⣿\x1b[38;2;155;95;85m⣿⡇           \x1b[0m",
    "                                         \x1b[38;2;80;145;185m⣿\x1b[38;2;75;140;175m⣿\x1b[38;2;65;120;150m⣿⣿\x1b[38;2;65;115;145m⣿⣿  \x1b[38;2;200;120;110m⢸\x1b[38;2;210;125;110m⣿\x1b[38;2;165;100;90m⣿⣿\x1b[38;2;160;95;85m⣿\x1b[38;2;155;95;85m⡇           \x1b[0m",
    "                                         \x1b[38;2;85;150;190m⣿\x1b[38;2;70;120;155m⣿\x1b[38;2;65;120;155m⣿\x1b[38;2;65;120;150m⣿⣿\x1b[38;2;65;115;145m⣿⣤\x1b[38;2;60;110;140m⣤\x1b[38;2;155;120;120m⣼\x1b[38;2;175;125;120m⣿\x1b[38;2;170;105;90m⣿\x1b[38;2;165;100;90m⣿\x1b[38;2;165;100;85m⣿\x1b[38;2;160;95;85m⡇           \x1b[0m",
    "                                        \x1b[38;2;85;150;185m⢸\x1b[38;2;85;155;195m⣿\x1b[38;2;70;120;155m⣿⣿\x1b[38;2;65;120;150m⣿⣿\x1b[38;2;65;115;150m⣿\x1b[38;2;65;115;145m⣿⣿\x1b[38;2;60;110;140m⣿⣿\x1b[38;2;85;50;45m⠙\x1b[38;2;120;85;55m⢻\x1b[38;2;165;125;70m⣿\x1b[38;2;185;140;75m⣷\x1b[38;2;165;125;65m⣦\x1b[38;2;160;125;65m⣤\x1b[38;2;155;120;60m⣤        \x1b[0m",
    "                                        \x1b[38;2;85;150;190m⢸\x1b[38;2;80;145;185m⣿\x1b[38;2;70;120;155m⣿⣿⣿\x1b[38;2;65;120;150m⣿\x1b[38;2;60;110;140m⣿⣿\x1b[38;2;65;115;145m⣿\x1b[38;2;65;115;140m⣿\x1b[38;2;60;110;140m⡏ \x1b[38;2;195;155;80m⢸\x1b[38;2;205;160;80m⣿\x1b[38;2;190;150;75m⣿\x1b[38;2;165;130;65m⣿\x1b[38;2;160;125;65m⣿\x1b[38;2;155;120;60m⣿        \x1b[0m",
    "                                        \x1b[38;2;85;155;195m⣼\x1b[38;2;75;140;175m⣿\x1b[38;2;70;120;155m⣿⣿⣿⣿\x1b[38;2;60;110;135m⡏\x1b[38;2;30;55;70m⠉\x1b[38;2;30;60;75m⠉⠉\x1b[38;2;35;60;75m⠁ \x1b[38;2;200;155;80m⢸\x1b[38;2;210;165;85m⣿\x1b[38;2;195;150;75m⣿\x1b[38;2;170;130;65m⣿\x1b[38;2;165;125;65m⣿\x1b[38;2;160;125;65m⣿        \x1b[0m",
    "                                        \x1b[38;2;85;155;195m⣿\x1b[38;2;75;140;175m⣿\x1b[38;2;70;120;155m⣿⣿⣿⣿\x1b[38;2;65;120;155m⠃     \x1b[38;2;205;160;80m⢸\x1b[38;2;215;165;85m⣿\x1b[38;2;195;155;80m⣿\x1b[38;2;170;135;70m⣿\x1b[38;2;165;130;65m⣿\x1b[38;2;165;125;65m⣿        \x1b[0m",
    "                                        \x1b[38;2;85;155;195m⠉\x1b[38;2;70;120;155m⠉⠉\x1b[38;2;55;100;130m⠙\x1b[38;2;50;90;115m⠛\x1b[38;2;55;100;130m⠋      \x1b[38;2;210;165;85m⠸\x1b[38;2;215;170;85m⠿\x1b[38;2;200;155;80m⠿\x1b[38;2;150;115;60m⣿⣿\x1b[38;2;155;120;60m⣿        \x1b[0m",
    "                                                                  \x1b[0m",
    "                                                                  \x1b[0m",
    "                                                                  \x1b[0m",
];

    fn logo_lines(time: f64) -> Vec<String> {
        Logo3d::with_start([0.0, 0.0, 0.0], 0.0).render_lines(100, time)
    }

    #[test]
    fn renders_the_reference_frame_at_zero() {
        assert_eq!(logo_lines(0.0), REFERENCE_0.to_vec());
    }

    #[test]
    fn renders_the_reference_frame_at_two_seconds() {
        assert_eq!(logo_lines(2.0), REFERENCE_2000.to_vec());
    }

    #[test]
    fn renders_the_reference_frame_at_five_seconds() {
        assert_eq!(logo_lines(5.0), REFERENCE_5000.to_vec());
    }

    #[test]
    fn the_lines_are_padded_like_the_reference() {
        for line in logo_lines(0.0) {
            assert_eq!(crate::ansi::visible_width(&line), 66);
        }
        assert_eq!(crate::ansi::visible_width(&logo_lines(0.0)[0]), 66);
        let narrow = Logo3d::with_start([0.0, 0.0, 0.0], 0.0).render_lines(20, 0.0);
        assert_eq!(crate::ansi::visible_width(&narrow[0]), 20);
    }

    #[test]
    fn hash_matches_the_reference() {
        assert_eq!(hash(0.0), 0.114_787_745_056_673_88);
        assert_eq!(hash(1.0), 0.246_789_968_805_387_62);
        assert_eq!(hash(7.0), 0.385_464_957_216_754_56);
        assert_eq!(hash(20973.0), 0.831_175_008_323_043_6);
    }

    #[test]
    fn the_starfield_matches_the_reference() {
        let stars = prepare_stars(100, 30);
        let expected = [
            (
                11,
                '⠂',
                [170.0, 195.0, 255.0],
                0.163_223_954_495_042_57,
                0.132_951_124_416_556_65,
                0.644_296_213_798_225,
            ),
            (
                15,
                '⠂',
                [255.0, 255.0, 255.0],
                0.110_107_396_421_954_04,
                4.839_872_786_414_062,
                1.045_446_595_549_583_5,
            ),
            (
                26,
                '⠄',
                [255.0, 225.0, 170.0],
                0.175_489_080_306_142_58,
                4.717_441_773_619_524,
                0.604_652_978_666_126_8,
            ),
            (
                67,
                '⠈',
                [170.0, 195.0, 255.0],
                0.193_504_920_136_183_5,
                5.776_454_812_849_1,
                1.194_854_407_198_727,
            ),
            (
                96,
                '⠂',
                [170.0, 195.0, 255.0],
                0.111_068_278_495_222_33,
                0.457_387_910_373_807_6,
                0.783_039_284_497_499_5,
            ),
            (
                97,
                '⠐',
                [255.0, 255.0, 255.0],
                0.113_949_586_236_849_43,
                3.097_754_231_612_126,
                0.788_843_782_991_171,
            ),
            (
                198,
                '⠂',
                [255.0, 190.0, 205.0],
                0.201_266_104_988_753_8,
                5.960_951_705_108_073,
                0.779_956_617_765_128_7,
            ),
            (
                238,
                '⠠',
                [255.0, 225.0, 170.0],
                0.206_708_279_056_474_57,
                4.661_628_476_245_944,
                0.637_060_933_560_133,
            ),
        ];
        let found: Vec<(usize, char, Rgb, f64, f64, f64)> = stars
            .iter()
            .enumerate()
            .filter_map(|(index, star)| {
                star.map(|star| {
                    (
                        index,
                        star.glyph,
                        star.tint,
                        star.strength,
                        star.phase,
                        star.speed,
                    )
                })
            })
            .collect();
        assert!(found.len() >= expected.len());
        for (found, expected) in found.iter().zip(expected.iter()) {
            assert_eq!(found.0, expected.0);
            assert_eq!(found.1, expected.1);
            assert_eq!(found.2, expected.2);
            assert!((found.3 - expected.3).abs() < 1e-15);
            assert!((found.4 - expected.4).abs() < 1e-15);
            assert!((found.5 - expected.5).abs() < 1e-15);
        }
    }

    #[test]
    fn the_spin_is_a_whole_turn_at_the_front_view() {
        let phase = spin_phase(first_front_view());
        let turns = phase / (std::f64::consts::PI * 2.0);
        assert!((turns - turns.round()).abs() < 1e-9, "turns: {turns}");
    }

    #[test]
    fn the_component_renders_the_frame_of_the_parity_clock() {
        let path =
            std::env::temp_dir().join(format!("rpi-logo3d-clock-{}.txt", std::process::id()));
        std::fs::write(&path, "0").expect("write the clock file");
        std::env::set_var("PI_PARITY_CLOCK", &path);
        let logo = Logo3d::new([0.0, 0.0, 0.0]);
        std::fs::write(&path, "2000").expect("write the clock file");
        let lines = Component::render(&logo, 100);
        std::env::remove_var("PI_PARITY_CLOCK");
        let _ = std::fs::remove_file(&path);
        assert_eq!(lines, REFERENCE_2000.to_vec());
    }

    #[test]
    fn the_star_colors_match_the_reference() {
        let stars = prepare_stars(100, 30);
        let star = stars[11].expect("the star at index 11");
        let foreground = [200.0, 200.0, 200.0];
        let background = [0.0, 0.0, 0.0];
        let expected = [
            (
                0.0,
                0.25,
                [
                    6.794_197_105_856_146,
                    7.253_264_477_873_452_5,
                    8.355_026_170_714_99,
                ],
            ),
            (
                0.0,
                1.0,
                [
                    27.176_788_423_424_583,
                    29.013_057_911_493_81,
                    33.420_104_682_859_96,
                ],
            ),
            (
                2.0,
                0.25,
                [
                    7.549_107_895_395_719,
                    8.059_182_753_192_728,
                    9.283_362_411_905_546,
                ],
            ),
            (
                2.0,
                1.0,
                [
                    30.196_431_581_582_875,
                    32.236_731_012_770_91,
                    37.133_449_647_622_186,
                ],
            ),
            (
                7.5,
                0.25,
                [
                    5.284_375_526_777_002,
                    5.641_427_927_234_908,
                    6.498_353_688_333_881,
                ],
            ),
            (
                7.5,
                1.0,
                [
                    21.137_502_107_108_01,
                    22.565_711_708_939_63,
                    25.993_414_753_335_525,
                ],
            ),
        ];
        for (now, level, color) in expected {
            let actual = star_color(&star, foreground, background, level, now);
            for channel in 0..3 {
                assert!(
                    (actual[channel] - color[channel]).abs() < 1e-12,
                    "now {now} level {level} channel {channel}: {} != {}",
                    actual[channel],
                    color[channel]
                );
            }
        }
    }

    #[test]
    fn the_halo_matches_the_reference() {
        let model = pi_logo_model();
        let boxes = model_boxes(&model);
        let pose = logo_pose(0.0);
        let mut raster = BlockRaster::new(model.camera_distance);
        raster.render(
            LOGO_CELLS_WIDTH,
            LOGO_CELLS_HEIGHT,
            &pose,
            &boxes,
            [255.0, 255.0, 255.0],
            LIGHT_HALO_STRENGTH,
        );
        let amounts = raster.halo_amount();
        let colors = raster.halo_rgb();
        let mut count = 0usize;
        let mut sum_amount = 0.0f64;
        let mut sum_red = 0.0f64;
        let mut sum_green = 0.0f64;
        let mut sum_blue = 0.0f64;
        let mut max_amount = 0.0f32;
        for index in 0..LOGO_CELLS_WIDTH * LOGO_CELLS_HEIGHT {
            let amount = amounts[index];
            if amount <= 0.0 {
                continue;
            }
            count += 1;
            sum_amount += amount as f64;
            sum_red += colors[index * 3] as f64 * amount as f64;
            sum_green += colors[index * 3 + 1] as f64 * amount as f64;
            sum_blue += colors[index * 3 + 2] as f64 * amount as f64;
            max_amount = max_amount.max(amount);
        }
        assert_eq!(count, 417);
        assert_eq!(sum_amount, 58.59375);
        assert_eq!(sum_red, 9144.0625);
        assert_eq!(sum_green, 8002.1875);
        assert_eq!(sum_blue, 7383.59375);
        assert_eq!(max_amount, 0.3125);
    }
}
