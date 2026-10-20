# Radius login selector: TypeScript original vs. Rust port

Port of the animated `/login` menu. The shimmer is Radius-only; no other selector uses it.

- Original: `/Users/gabriel/pi/packages/coding-agent/src/modes/interactive/components/radius-login-selector.ts`
- Port: `/Users/gabriel/pi-native/rpi/crates/rpi-cli/src/interactive_tui/radius_login.rs`
- Base widget: original `ExtensionSelectorComponent` (`components/extension-selector.ts`) → `MenuComponent` (`components/menu.ts`) → shared `SelectList` (`packages/tui/src/components/select-list.ts`)
- Port widget: `RadiusLoginMenu` (self-contained rows, no `SelectList` child)

## What the original does

| # | Behaviour | Original |
|---|---|---|
| 1 | Four Radius logo colours, in the order they stream | `radius-login-selector.ts:11` — `#4d9abf`, `#83ccd2`, `#f1be57`, `#f09082` |
| 2 | Band width / speed / frame time | `:13-15` — `CHARS_PER_COLOR = 4`, `CHARS_PER_SECOND = 10`, `ANIMATION_FRAME_MS = 50` |
| 3 | Shimmer maths: `position = (((i - offset) % cycle) + cycle) % cycle`, `band = floor(position / 4)`, `t = position / 4 - band`, `amount = t*t*(3-2*t)`, colour = `mix(band, band+1, amount)` | `:18-36` |
| 4 | Shimmer ends with `\x1b[39m` | `:35` |
| 5 | The selected Radius row is replaced by `accent("→ ") + shimmer + label.slice(text.length)` when the rendered line matches | `:78-90` |
| 6 | The animation stops on select and on cancel; a 50 ms interval asks for a re-render while the animated line is on screen | `:57-63`, `:72-76`, `:92-96`, `:98-101` |

## What the port does

| # | Behaviour | Port |
|---|---|---|
| 1 | `RADIUS_COLORS: [[u8; 3]; 4]` = `4d9abf`, `83ccd2`, `f1be57`, `f09082` | `radius_login.rs:18-24` |
| 2 | `CHARS_PER_COLOR = 4`, `CHARS_PER_SECOND = 10.0`, `ANIMATION_FRAME_MS = 50` | `radius_login.rs:26-32` |
| 3 | `radius_shimmer(text, elapsed_ms)` — same position/band/smoothstep maths, `mix_color` interpolates the channels linearly in sRGB and rounds to bytes (pi's `mixColors(..., "srgb")`, `packages/tui/src/colors.ts:245-249`) | `radius_login.rs:60-82`, `:38-52` |
| 4 | The shimmer ends with `\x1b[39m` | `radius_login.rs:81` |
| 5 | The render finds the selected Radius row by exact match and replaces it with `accent("→ ") + shimmer + tail` | `radius_login.rs:302-322` |
| 6 | `on_select` / `on_cancel` stop the timer; `on_frame` is called every 50 ms while the animated row is on screen | `radius_login.rs:154-160`, `:207-239`, `:242-273` |

## Differences the next reader must know

1. **The upstream shimmer never shows.** The original computes the expected selected line as
   `theme.fg("accent", "→ ") + theme.fg("accent", label)` (`radius-login-selector.ts:81`), but the
   shared `SelectList` paints the selected row as a *single* accent span
   (`theme.selectedText("→ " + label)`, `packages/tui/src/components/select-list.ts:282`).
   The two byte strings differ (`…→ \x1b[39m\x1b[38;2;…mSign in…` vs `…→ Sign in…`), so
   `lines.indexOf(selectedLine)` is `-1`, `animating` stays `false` and the animation is dead code
   upstream. The port renders the selected row in the two-span form the original *expects*, so the
   comparison matches and the shimmer is actually painted.
2. **Rows instead of a `SelectList` child.** The port draws the title (dim) and the option rows
   itself, because the animated row has to be substituted after the base list is rendered. Row
   layout follows the port's `SelectList` (`rpi/crates/rpi-tui/src/select_list.rs:563-620`):
   `"→ "` on the selected row, `"  "` on the others, values truncated to `width - 4`.
3. **Colour mode.** The port emits `38;2;r;g;b` or `38;5;n` through `rpi_tui::ansi::foreground_rgb`,
   which follows the port's `color_mode()`; pi uses `foregroundAnsi(color, theme.getColorMode())`.
   The port rounds the mixed channel to a byte before quantising, pi keeps the float until the
   escape is built — the difference is at most one palette step.
4. **No search box.** The upstream `MenuComponent` puts an `Input` above the rows; the port's menu
   has no filter, so `handle_key` maps `j`/`k` to up/down (the upstream `ExtensionSelectorComponent`
   maps them the same way, `extension-selector.ts:64-68`).

## Checks

- `cargo test -p rpi-cli` — `interactive_tui::radius_login::tests` (11 tests):
  `shimmer_keeps_the_input_characters`, `shimmer_starts_with_the_radius_colors_in_order`,
  `shimmer_moves_with_the_clock`, `shimmer_wraps_around_the_cycle`, `mix_color_blends_in_srgb`,
  `mix_color_applies_the_smoothstep_blend`, `menu_marks_only_the_selected_option`,
  `menu_animates_the_selected_radius_option`, `menu_leaves_other_options_alone`,
  `menu_reports_the_elapsed_time`, `animation_timer_requests_frames_and_stops_on_cancel`.
- The colour-order test is colour-mode agnostic: it compares the escapes produced by
  `rpi_tui::ansi::foreground_rgb`, so it passes in truecolor and in 256-colour mode
  (`PI_TRUE_COLOR=0`).
- Verification status: the in-crate run passes —
  `scripts/agent-cargo.sh test -p rpi-cli --lib radius_login` →
  `test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 631 filtered out`.
  `cargo check -p rpi-cli` and `cargo clippy -p rpi-cli --all-targets` report no error, warning or
  lint for `radius_login.rs`; `rustfmt --check` is clean. The module was also compiled standalone
  against the built `rpi-tui` rlib, where all 11 tests passed in truecolor and in
  `PI_TRUE_COLOR=0` (256-colour) mode, three repeats, no flakes.
