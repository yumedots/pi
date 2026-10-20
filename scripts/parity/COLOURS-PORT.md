# Colour parity: what the port paints now

Port: `/Users/gabriel/pi-native` (branch `feat/rpi-native`). Original: `/Users/gabriel/pi`
(branch `perf/lightweight-harness`). Audit this file answers:
`scripts/parity/COLOURS.md` (owned by the colour auditor).

Everything below was implemented by the colour port (`ColourParityPort`). The
screens were re-checked against the original with `tmux capture-pane -e -p` on
both sides, driven by the parity harness's mock server.

## 1. The palette is pi's palette

| what | original | port |
|---|---|---|
| palette source | `packages/coding-agent/src/modes/interactive/theme/dark.json`, `light.json` (58 tokens, `vars` + `colors`) | `rpi/crates/rpi-tui/src/theme.rs`: `ThemeColors::dark()` / `ThemeColors::light()`, one field per pi token, every value `Color::Rgb` |
| resolution | `resolveVarRefs` (`theme.ts:83-100`) + `parseColor` (`packages/tui/src/colors.ts:118-160`) | the resolved RGB of every token was taken from pi's own resolver (the audit's table); the port stores the resolved RGB directly |
| token names | `theme-tokens.ts:24-110` | the same names in snake case (`accent`, `md_heading`, `thinking_max`, …) — 58 fields, all of pi's tokens |
| port-only tokens | none | `info`, `background`, `cursor`, `md_code_bg`, `md_code_block_bg` were removed; pi has no counterpart for them |

Every one of pi's 58 tokens now exists with pi's value in both themes. The
port's old `Ansi256` approximations are gone: `Ansi256(108)` (`#87af87`, a
green) is now pi's violet `Rgb(167, 152, 215)`.

The port-only `ThemePreset::Monochrome` stays (pi has no monochrome theme) and
is derived from pi's dark palette with every hue replaced by the neutral text
colour. It is not on the default path.

## 2. Truecolor, and pi's 256-colour downgrade

| what | original | port |
|---|---|---|
| colour mode | `getTerminalColorMode()` (`packages/tui/src/terminal-capabilities.ts:113-115`) | `ansi::color_mode()` (`rpi/crates/rpi-tui/src/ansi.rs`), same environment rules as pi (`COLORTERM=truecolor`/`24bit`, `TERM` ending `-direct`, tmux/screen only trust the hint, the known 24-bit terminals) |
| truecolor escape | `38;2;r;g;b` (`colors.ts:300-315`) | `ansi::foreground_rgb` / `background_rgb` emit `38;2;r;g;b` |
| 256-colour escape | `38;5;n` with pi's own rounding (`colors.ts:286-299`: closest cube colour, grey ramp when the colour is nearly grey) | `ansi::rgb_to_ansi256` is a port of that rounding |

`Color::Rgb` now goes through the mode, so a truecolor terminal gets pi's exact
`38;2;r;g;b` and a 256-colour terminal gets pi's `38;5;n`.

## 3. Tokens that were missing, and where they are painted

| token | original | port |
|---|---|---|
| `scrollbarTrack`, `scrollbarThumb` | `packages/tui/src/layout.ts:377-378` paints `│` in the track colour and `█` in the thumb colour | `rpi/crates/rpi-tui/src/scroll_view.rs`: the track column is painted `│` in `scrollbar_track`, the thumb `█` in `scrollbar_thumb` (the port had one hard-coded `\x1b[100m` cell and no track) |
| `searchMatchBg`, `searchMatchText` | `modes/interactive/tui-renderer.ts:24-27` | `rpi/crates/rpi-tui/src/alt_screen_search.rs`: matches are painted with the search background, the search text colour and an underline (the port painted a yellow `\x1b[43m`) |
| `userMessageText` | `components/user-message.ts:49` | `rpi/crates/rpi-tui/src/user_message.rs`: the markdown is rendered with the user-message text colour as its base style |
| `syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation` | `theme.ts:930-952` (the CLI highlight theme) | `rpi/crates/rpi-tui/src/syntax_highlight.rs` maps its classes onto the pi tokens; `rpi/crates/rpi-tui/src/markdown.rs` now highlights fenced code (it used to print the fence body uncoloured) |
| `thinkingOff` … `thinkingMax` | `theme.ts:390-409` (`getThinkingBorderColor`) | the seven colours exist as fields; the port's editor draws no border at all, so there is nothing to paint them on yet (see "what the port cannot express") |
| `panelBg`, `menuSelectedBg` | pi defines the tokens but paints neither in its own code | same: the fields exist, pi's own menus do not use them |

Other screens that were painted with hard-coded colours now use tokens:

| screen | before | now |
|---|---|---|
| separator | `dim(border_muted)` | `border` (`rpi/crates/rpi-tui/src/dynamic_border.rs`) |
| pickers | `\x1b[32m` / `\x1b[36m` / `\x1b[90m` | `accent` / `muted` (`select_list.rs`), pi's `label`/`value`/`cursor`/`hint` API (`settings_list.rs`) |
| loader | `\x1b[36m` spinner | `accent` spinner, `muted` text (`loader.rs`) |
| input placeholder | `\x1b[90m` | `muted` (`input.rs`) |
| diff gutter | the sign and the line number in `dim` | the row's own colour, like pi (`diff.rs`) |
| tool panel | `toolTitle` was the terminal default | pi's `toolTitle` / `toolOutput` / `toolSuccessBg` values |
| model notice | the port-only `info` token | `accent` glyph, `muted` text (`rpi-cli/src/interactive_tui/rendering.rs`) |
| extension API | eleven hard-coded token names | every pi token, foreground plus `bg:`-prefixed backgrounds (`rpi-cli/src/js_extensions.rs`) |

## 4. The theme follows the terminal

| what | original | port |
|---|---|---|
| light/dark decision | `detectTerminalTheme` (`theme.ts:664-677`): the reported background decides, the reported foreground gives the direction, WCAG 4.5:1 decides when the foreground is not decisive | `theme::terminal_appearance` (`rpi/crates/rpi-tui/src/theme.rs`), a port of `terminalAppearance` (`theme.ts:189-212`), with `RgbColor::wcag_contrast` and `RgbColor::oklab_lightness` (`terminal_colors.rs`) |
| fallback | OSC 2031 report, then `COLORFGBG`, then dark | `COLORFGBG` (`theme::color_fgbg_appearance`), then dark. No OSC 2031 listener yet |
| a picked theme wins | `setTheme` replaces the system theme | `ThemeManager::apply_preset` clears the "follows the terminal" flag (`theme.rs`) |

## 5. What the port still does not do

| gap | why | original |
|---|---|---|
| `okhsl()` / `oklch()` colours | the port stores the resolved RGB of every token instead of parsing `okhsl()`; a user theme with `okhsl()` values cannot be loaded | `packages/tui/src/oklab.ts` |
| colour mixing | pi mixes a colour toward the background for its "faint" tokens; the built-in themes mark no token as faint, so the port does not mix | `theme.ts:303-309` |
| terminal-default resolution | pi resolves a token set to `""` to the terminal's reported foreground/background; the port's built-in themes set no token to `""`, so there is nothing to resolve | `theme.ts:293-311` |
| user themes, `vars`, a `system` theme in `/theme` | the port's theme is a compiled-in preset list; `/theme` still offers `dark`, `light`, `monochrome` | `theme.ts:429-520`, `:575` |
| OSC 2031 (live light/dark switch) | the port does not listen for the terminal's appearance report, so a terminal that switches from dark to light keeps the old palette until restart | `packages/tui/src/tui.ts:1040` |
| a thinking-level border | pi paints the editor border in the thinking-level colour; the port's editor draws no border | `theme.ts:390-409` |
| the fake cursor protocol | the editor marks the caret with pi's `pi:fc` markers and the TUI turns them into reverse video (implemented in the editor/TUI by the TUI library porter, not by this change) | `packages/tui/src/tui.ts:219-226` |

## 6. Checks

- `rpi/crates/rpi-tui/tests/theme_colours.rs` (new): eight tests that pin the
  escape sequence of a rendered line — the user message card, the editor card
  and its caret, a markdown bullet/fence/code, the separator, the tool panel,
  the scrollbar and the light palette. They assert the literal escapes
  (`\x1b[48;2;57;61;63m`, `\x1b[38;2;167;152;215m`, …), not just the palette.
- `rpi/crates/rpi-tui/src/theme.rs`: one palette test per theme (the exact RGB
  of the tokens) plus the terminal-appearance tests.
- `rpi/crates/rpi-tui/src/ansi.rs`: the colour-mode detection and the
  256-colour rounding.
- Screen comparison: both sides were run through the parity harness's mock
  server and captured with `tmux capture-pane -e -p`; the remaining differences
  are listed in the port's report.

The colour port is both the porter and the checker in this area: the escape
sequences above were written by the same change that the audit checks, so the
colour auditor should re-check the captures.
