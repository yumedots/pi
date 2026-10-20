# Colour parity: TypeScript original vs. Rust port

Audit of every colour the two programs paint. Factual work list for the colour port.

- Original: `/Users/gabriel/pi` (branch `perf/lightweight-harness`)
- Port: `/Users/gabriel/pi-native` (branch `feat/rpi-native`)
- Tokens: `packages/coding-agent/src/modes/interactive/theme/theme-tokens.ts:24-110` (58) vs `rpi/crates/rpi-tui/src/theme.rs:19-109` (40 fields)
- Palettes: `packages/coding-agent/src/modes/interactive/theme/dark.json`, `light.json` vs compiled-in presets `rpi/crates/rpi-tui/src/theme.rs:111-172` (dark), `:439-490` (light), `:491-535` (monochrome)
- Colour model: `packages/tui/src/colors.ts` vs `rpi/crates/rpi-tui/src/theme.rs:178-222` + `rpi/crates/rpi-tui/src/ansi.rs:150-160`

The pi hexes below were produced with pi's own resolver (`parseColor` + `colorToHex` from `packages/tui/src/colors.ts`, applied to `dark.json`/`light.json` after `resolveVarRefs`). Ansi256 values are converted to their xterm-256 RGB so both sides are comparable as paint.

## Rule 0 (the hard rule)

**The port must paint pi's colours.** Where pi uses a concrete hex, the port must use that exact RGB — `Color::Rgb(r, g, b)` — not an Ansi256 approximation.

`Ansi256(108)` is `#87af87` (green). Pi's dark accent is `#a798d7` (violet). An approximation is a different colour on screen, so no token may be approximated. The port's own comment in `theme.rs:112-121` ("accent teal (#8abeb7) ≈ 108") is doubly wrong: 108 is `#87af87`, and `#8abeb7` is index 109.

Second rule: the port must emit truecolor when the terminal supports it. Pi chooses the escape per colour mode (`packages/tui/src/terminal-capabilities.ts:113-115` → `packages/tui/src/colors.ts:300-315`): truecolor gives `38;2;r;g;b`, 256-colour gives `38;5;n`. The port currently hard-codes `Ansi256` for the whole palette (`theme.rs:191-199`), so even a perfect hex would still be quantised on a truecolor terminal. `Color::Rgb` already emits `38;2;r;g;b` (`theme.rs:191-199`); the port needs a terminal-capability check like pi's `getTerminalColorMode()` and a downgrade path for 256-colour terminals.

## Part 1 — token table

`pi` = original, `port` = Rust. "—" = token absent in the port. Values are what the terminal paints.

### Core

| token | slot | pi dark | pi light | port field | port dark | port light | verdict |
|---|---|---|---|---|---|---|---|
| accent | fg | #a798d7 | #7459b4 | `accent` | Ansi256(108) #87af87 | Ansi256(66) #5f8787 | differs |
| border | fg | #5fa8cc | #3d8eb3 | `border` | Ansi256(67) #5f87af | Ansi256(67) #5f87af | differs |
| borderAccent | fg | #a08ed5 | #8a72cb | `border_accent` | Ansi256(45) #00d7ff | Ansi256(66) #5f8787 | differs |
| borderMuted | fg | #768186 | #9aa2a7 | `border_muted` | Ansi256(239) #4e4e4e | Ansi256(249) #b2b2b2 | differs |
| success | fg | #68b78d | #337e58 | `success` | Ansi256(107) #87af87 | Ansi256(65) #5f875f | differs |
| error | fg | #ea7f81 | #c8253d | `error` | Ansi256(131) #af5f5f | Ansi256(131) #af5f5f | differs |
| warning | fg | #cd9a22 | #8f6802 | `warning` | Ansi256(226) #ffff00 | Ansi256(136) #af8700 | differs |
| muted | fg | #9da5a9 | #677176 | `muted` | Ansi256(244) #808080 | Ansi256(241) #626262 | differs |
| dim | fg | #7e888e | #879095 | `dim` | Ansi256(242) #6c6c6c | Ansi256(243) #767676 | differs |
| text | fg | #dee0e1 | #3b3f41 | `text` | Default | Default | differs (port uses terminal default) |
| thinkingText | fg | #96a0a4 | #7c868c | `thinking_text` | Ansi256(244) #808080 | Ansi256(241) #626262 | differs |

### Backgrounds

| token | slot | pi dark | pi light | port field | port dark | port light | verdict |
|---|---|---|---|---|---|---|---|
| selectedBg | bg | #213b49 | #dfe7ec | `selection` | Ansi256(60) #5f5f87 | Ansi256(189) #d7d7ff | differs |
| userMessageBg | bg | #393d3f | #dee0e1 | `surface` | Ansi256(236) #303030 | Ansi256(254) #e4e4e4 | differs |
| customMessageBg | bg | #393d3f | #dee0e1 | `custom_message_bg` | Rgb(45,40,56) #2d2838 | Rgb(237,231,246) #ede7f6 | differs |
| toolPendingBg | bg | #34383a | #e4e5e6 | `tool_pending_bg` | Rgb(40,44,52) #282c34 | Ansi256(189) #d7d7ff | differs |
| toolSuccessBg | bg | #254131 | #dee9e1 | `tool_success_bg` | Rgb(38,48,52) #263034 | Ansi256(151) #afd7af | differs |
| toolErrorBg | bg | #5b282a | #eee2e1 | `tool_error_bg` | Rgb(55,40,45) #37282d | Ansi256(181) #d7afaf | differs |

### Message text

| token | slot | pi dark | pi light | port field | port dark | port light | verdict |
|---|---|---|---|---|---|---|---|
| userMessageText | fg | #dee0e1 | #3b3f41 | — | — | — | **missing** |
| customMessageText | fg | #9da5a9 | #677176 | `custom_message_text` | Default | Ansi256(237) #3a3a3a | differs |
| customMessageLabel | fg | #a798d7 | #7459b4 | `custom_message_label` | Rgb(149,117,205) #9575cd | Rgb(126,87,194) #7e57c2 | differs |
| toolTitle | fg | #dee0e1 | #3b3f41 | `tool_title` | Default | Default | differs |
| toolOutput | fg | #9da5a9 | #677176 | `tool_output` | Ansi256(244) #808080 | Ansi256(241) #626262 | differs |

### Markdown

| token | slot | pi dark | pi light | port field | port dark | port light | verdict |
|---|---|---|---|---|---|---|---|
| mdHeading | fg | #cd9a22 | #8f6802 | `md_heading` | Ansi256(179) #d7af5f | Ansi256(136) #af8700 | differs |
| mdLink | fg | #69add0 | #2f7899 | `md_link` | Ansi256(110) #87afd7 | Ansi256(67) #5f87af | differs |
| mdLinkUrl | fg | #9da5a9 | #677176 | `md_link_url` | Ansi256(242) #6c6c6c | Ansi256(243) #767676 | differs |
| mdCode | fg | #a798d7 | #7459b4 | `md_code` | Rgb(138,190,183) #8abeb7 | Rgb(90,128,128) #5a8080 | differs |
| mdCodeBlock | fg | #68b78d | #337e58 | `md_code_block` | Rgb(212,212,212) #d4d4d4 | Rgb(31,35,40) #1f2328 | differs |
| mdCodeBlockBorder | fg | #9da5a9 | #677176 | `md_code_block_border` | Ansi256(244) #808080 | Ansi256(241) #626262 | differs |
| mdQuote | fg | #9da5a9 | #677176 | `md_quote` | Ansi256(244) #808080 | Ansi256(241) #626262 | differs |
| mdQuoteBorder | fg | #9da5a9 | #677176 | `md_quote_border` | Ansi256(244) #808080 | Ansi256(241) #626262 | differs |
| mdHr | fg | #9da5a9 | #677176 | `md_hr` | Ansi256(244) #808080 | Ansi256(241) #626262 | differs |
| mdListBullet | fg | #a798d7 | #7459b4 | `md_list_bullet` | Ansi256(108) #87af87 | Ansi256(65) #5f875f | differs |

### Tool diffs

| token | slot | pi dark | pi light | port field | port dark | port light | verdict |
|---|---|---|---|---|---|---|---|
| toolDiffAdded | fg | #68b78d | #337e58 | `tool_diff_added` | Ansi256(107) #87af87 | Ansi256(65) #5f875f | differs |
| toolDiffRemoved | fg | #ea7f81 | #c8253d | `tool_diff_removed` | Ansi256(131) #af5f5f | Ansi256(131) #af5f5f | differs |
| toolDiffContext | fg | #9da5a9 | #677176 | `tool_diff_context` | Ansi256(244) #808080 | Ansi256(241) #626262 | differs |

### Bash mode

| token | slot | pi dark | pi light | port field | port dark | port light | verdict |
|---|---|---|---|---|---|---|---|
| bashMode | fg | #5eb286 | #40976c | `bash_mode` | Ansi256(107) #87af87 | Ansi256(65) #5f875f | differs |

**0 of the 34 shared tokens match in either theme.** The port's palette is not an approximation of pi's; it is a different colour world (green accent, cyan borderAccent, blue-tinted tool panel).

## Part 2 — the 18 tokens the port is missing

| token | slot | pi dark | pi light | where pi paints it | port today |
|---|---|---|---|---|---|
| scrollbarTrack | fg | #484e52 | #e1e3e4 | `packages/tui/src/layout.ts:377-378`, styled by `packages/coding-agent/src/modes/interactive/interactive-mode.ts:1079-1080` | no track glyph at all |
| scrollbarThumb | fg | #97a0a5 | #96a0a4 | same | one hard-coded `\x1b[100m` cell (`rpi/crates/rpi-tui/src/scroll_view.rs:471`, `:484-486`) |
| panelBg | bg | #262a2c | #f2f4f4 | menu/dialog panel background | none |
| menuSelectedBg | bg | #424749 | #dadedf | selected row in menus | none (lists use hard-coded ANSI-16) |
| searchMatchBg | bg | #4e2f1b | #ede3dd | transcript search match (`tui-renderer.ts:24`) | none |
| searchMatchText | fg | #9da5a9 | #677176 | transcript search match (`tui-renderer.ts:24`) | none |
| userMessageText | fg | #dee0e1 | #3b3f41 | user message text (`components/user-message.ts:49`) | text falls back to the terminal default |
| syntaxComment | fg | #9da5a9 | #677176 | cli-highlight theme (`theme.ts:938-939`) | no syntax highlighting in markdown at all |
| syntaxKeyword | fg | #69add0 | #2f7899 | `theme.ts:931,946` | — |
| syntaxFunction | fg | #cd9a22 | #8f6802 | `theme.ts:941-942` | — |
| syntaxVariable | fg | #5db3ba | #287a81 | `theme.ts:947-949` | — |
| syntaxString | fg | #de8d5a | #a45417 | `theme.ts:935-936` | — |
| syntaxNumber | fg | #68b78d | #337e58 | `theme.ts:933-934` | — |
| syntaxType | fg | #a798d7 | #7459b4 | `theme.ts:932,943-944` | — |
| syntaxOperator | fg | #9da5a9 | #677176 | `theme.ts:950` | — |
| syntaxPunctuation | fg | #9da5a9 | #677176 | `theme.ts:945,951` | — |
| thinkingOff | fg | #6c767b | #c2c8ca | thinking-level border (`theme.ts:390-409`) | none |
| thinkingMinimal | fg | #68808d | #b5c4cb | same | none |
| thinkingLow | fg | #5489a4 | #9fc2d5 | same | none |
| thinkingMedium | fg | #6185cc | #a2b7e0 | same | none |
| thinkingHigh | fg | #9776e5 | #b5a5e8 | same | none |
| thinkingXhigh | fg | #de54c1 | #e585cd | same | none |
| thinkingMax | fg | #fe5462 | #fe7479 | same | none |

(23 rows: 2 scrollbar + 1 panelBg + 1 menuSelectedBg + 2 searchMatch + 1 userMessageText + 9 syntax + 7 thinking.)

## Part 3 — port-only fields (no pi token)

| port field | port dark | port light | note |
|---|---|---|---|
| `info` (`theme.rs:24`) | Ansi256(81) #5fd7ff | Ansi256(67) #5f87af | used for the "ℹ Model set to …" note; pi has no counterpart |
| `background` (`theme.rs:35`) | Default | Default | used by the search bar |
| `cursor` (`theme.rs:40`) | Ansi256(81) | Ansi256(67) | no pi counterpart |
| `md_code_bg` (`theme.rs:54`) | Rgb(48,52,59) #30343b | Rgb(232,234,237) #e8eaed | Rust extension, not in pi |
| `md_code_block_bg` (`theme.rs:57`) | Rgb(40,44,52) #282c34 | Rgb(246,248,250) #f6f8fa | Rust extension, not in pi |

Plus the port-only `ThemePreset::Monochrome` (`theme.rs:491-535`, enum `:548`).

## Part 4 — the palettes (do this first)

pi ships the palette as data: `packages/coding-agent/src/modes/interactive/theme/dark.json` and `light.json`, each with a `vars` map and a `colors` map of 58 tokens, values in `okhsl()`, `#hex` or a var name. `resolveVarRefs` (`theme.ts:83-100`) resolves the vars; `parseColor`/`okhslColor` (`packages/tui/src/colors.ts:118-160`) turns them into RGB.

The port compiles two hand-written palettes into `theme.rs`. That is the root of most findings: every hand-picked index is both the wrong hue and the wrong value.

Work list for the palette:

1. Add the palette as data on the Rust side, mirroring pi's JSON: either a `dark.json`/`light.json` in the crate with the same `vars`+`colors` shape parsed at startup, or a Rust `const` table of the 58 resolved hexes per theme. Data is preferred — it keeps the two sides diffable.
2. Resolve pi's `okhsl()` values to RGB once (the table above already contains the resolved hexes; the same resolution is in `packages/tui/src/oklab.ts` if the okhsl parsing is ported).
3. Store every token as `Color::Rgb(r, g, b)` with pi's exact RGB. No Ansi256 anywhere in the palette.
4. `text` is pi's `#dee0e1` / `#3b3f41`, not the terminal default.
5. `tool_title`, `custom_message_text` are pi's `text`/`muted` values, not `Default`.
6. Light preset: use pi's light column of the table, not a re-derivation.
7. Keep `ThemePreset::Monochrome` if wanted, but it must not be the default path.
8. Add a terminal-capability check (truecolor vs 256) like pi's `getTerminalColorMode()` (`packages/tui/src/terminal-capabilities.ts:113-115`) so a truecolor terminal gets `38;2;r;g;b`; a 256-colour terminal may downgrade with pi's own rounding (`packages/tui/src/colors.ts:286-299`).

## Part 5 — rendered colour differences, screen by screen

Captured with `tmux capture-pane -e -p` (escape sequences), 100×30 pane, truecolor terminal, both sides driven by the parity harness's own mock server and agent dir (`scripts/parity/drive.mjs`, `scripts/parity/mock-server.mjs`).

### 5.1 Global: 256-colour vs truecolor

```
pi    \x1b[38;2;157;165;169m     (muted #9da5a9)
port  \x1b[38;5;244m             (xterm 244 = #808080)
```

### 5.2 Input card + prompt gutter (always on screen)

```
pi    \x1b[48;2;57;61;63m … \x1b[38;2;167;152;215m\x1b[48;2;57;61;63m> \x1b[7m\x1b[39m …
port  \x1b[48;5;236m … \x1b[38;5;108m\x1b[48;5;236m> \x1b[39m …
```

- card bg #393d3f vs #303030
- `> ` violet #a798d7 vs green #87af87
- pi paints a reverse-video cursor block (`\x1b[7m`); the port has no fake-cursor mechanism at all (no `pi:fc` in `rpi-tui`), so its caret is invisible on terminals that swallow the APC marker.

Light theme, same screen:

```
pi    \x1b[48;2;222;224;225m … \x1b[38;2;116;89;180m
port  \x1b[48;5;254m … \x1b[38;5;66m
```

### 5.3 Empty-session greeting

```
pi    \x1b[38;2;157;165;169m  Hi Gabriel, what are we building today?
port  \x1b[38;5;244m          Hi Gabriel, what are we building today?
```

### 5.4 User message

```
pi    \x1b[48;2;57;61;63m\n \x1b[38;2;222;224;225mhello world\x1b[39m
port  \x1b[48;5;236m\n hello world
```

pi colours the text with `userMessageText` (`components/user-message.ts:49`); the port sets only a background (`rpi-tui/src/user_message.rs:42-44`).

### 5.5 Tool panel

```
pi    \x1b[48;2;37;65;49m \x1b[38;2;222;224;225mread\x1b[39m \x1b[38;2;167;152;215mtool-input.txt\x1b[39m
      \x1b[38;2;157;165;169mhello from the parity fixture\x1b[39m
port  \x1b[48;2;38;48;52m \x1b[1mread\x1b[0m\x1b[48;2;38;48;52m \x1b[38;5;108mtool-input.txt\x1b[39m
      \x1b[38;5;244mhello from the parity fixture\x1b[39m
```

### 5.6 Markdown: bullets, fence, code body, link

```
pi    \x1b[38;2;167;152;215m- \x1b[39mfirst item          (mdListBullet violet)
port  \x1b[38;5;108m- \x1b[39mfirst item                (green)

pi    \x1b[38;2;157;165;169m```rust\x1b[39m              (mdCodeBlockBorder)
port  \x1b[38;5;244m```rust\x1b[39m

pi    '   \x1b[38;2;105;173;208mfn\x1b[38;2;205;154;34m main\x1b[39m() {}'
port  '   fn main() {}'                                  (no highlighting at all)

pi    ' A \x1b[38;2;105;173;208mlink\x1b[39m \x1b[38;2;157;165;169m (https://example.com)\x1b[39m'
port  ' A \x1b[4m\x1b[38;5;110mlink\x1b[0m\x1b[38;5;242m (https://example.com)\x1b[39m'
```

pi highlights the fence with `syntaxKeyword` (#69add0) and `syntaxFunction` (#cd9a22) (`theme.ts:930-952` → `highlightCode`). The port's Markdown renderer never calls the highlighter (`rpi/crates/rpi-tui/src/markdown.rs:304-309`); `syntax_highlight.rs` is only wired into the tool renderers (`tool_renderers.rs:289`).

### 5.7 Thinking summary

```
pi    \x1b[38;2;167;152;215m+\x1b[39m \x1b[38;2;150;160;164mThought\x1b[38;2;157;165;169m · 0.1s\x1b[39m
port  \x1b[38;5;108m+\x1b[39m \x1b[38;5;244mThought · 0.0s\x1b[39m
```

pi separates `accent` / `thinkingText` / `muted`; the port collapses "Thought" and the duration into one muted colour.

### 5.8 Footer

```
pi    \x1b[38;2;126;136;142mmock/mock-1 / ▏░░░░ 0.0% 49 tokens\x1b[39m … \x1b[38;2;126;136;142m/private/tmp/pi-parity/work
port  \x1b[38;5;242mmock/mock-1 / ▏░░░░ 0.0% 49 tokens\x1b[39m … \x1b[38;5;242m/private/tmp/pi-parity/work
```

Same `dim` token, different value.

### 5.9 Theme picker

```
pi    \x1b[38;2;126;136;142m  Theme\x1b[39m
      \x1b[38;2;167;152;215m→ system                          (current)\x1b[39m
      '                dark' / '                light'          (uncoloured rows)
      \x1b[38;2;126;136;142m  Type to search · enter\x1b[38;2;167;152;215m select\x1b[39m …
port  \x1b[1m\x1b[36m→ Dark Default dark theme\x1b[0m
      '                Dark\x1b[90m                            Default dark theme\x1b[39m'
```

The port's list colours are hard-coded ANSI-16, not themed: `rpi/crates/rpi-tui/src/select_list.rs:89-93`, `settings_list.rs:107-110` (`\x1b[32m`, `\x1b[36m`, `\x1b[90m`). Same class of bug in `input.rs:622` (placeholder), `loader.rs:163-197`, `alt_screen_search.rs:294`.

### 5.10 Model picker notice

```
pi    \x1b[38;2;126;136;142mOnly one model available\x1b[39m
port  \x1b[38;5;81mℹ\x1b[39m \x1b[38;5;244mModel set to mock/mock-1 — applies to the next message.\x1b[39m
```

`info` is port-only.

### 5.11 Separators (dynamic border)

```
port  \x1b[2m\x1b[38;5;239m──────────…
pi    \x1b[38;2;95;168;204m──────────…      (theme.fg("border"), no dim)
```

pi `components/dynamic-border.ts:16` uses `theme.fg("border")`; the port uses `dim(border_muted)` (`rpi/crates/rpi-tui/src/dynamic_border.rs:44-47`) — different token and an extra faint attribute.

### 5.12 Not reachable in the harness (code-level findings, no capture)

- **Transcript search highlight.** `Ctrl+Shift+F` opened nothing on either side in the harness (the key fell through to the editor; the raw `ESC[1;5F` was also ignored). pi paints matches `theme.bg("searchMatchBg", theme.fg("searchMatchText", t))` plus underline (`modes/interactive/tui-renderer.ts:24-27`, `packages/tui/src/tui-alt-screen.ts:1525`); the port's `AltScreenSearch` has no inline highlight — only a bar painted with `colors.background` / `colors.dim` (`rpi/crates/rpi-tui/src/search_bar.rs:87-95`).
- **Scrollbar.** pi paints `│` in `scrollbarTrack` and `█`/`┃` in `scrollbarThumb` (`packages/tui/src/layout.ts:377-378`, `packages/tui/src/components/scroll-view.ts:55-56`, wired at `interactive-mode.ts:1079-1080`); the port paints a single `\x1b[100m` background cell (`scroll_view.rs:471`, `:484-486`) and has no track.
- **Diff.** pi: `-N line` in `toolDiffRemoved`, `+N line` in `toolDiffAdded`, context in `toolDiffContext`, changed words in reverse video (`components/diff.ts:89-141`, `:45`, `:57`); the port uses the same three tokens for the body but paints the whole gutter in `dim` and adds a `SIGN NUM│` column (`diff.rs:37-40`, `:182-186`) — the red/green gutter of the original is gone.
- **Custom messages.** port `custom_message_bg` / `_label` / `_text` = #2d2838 / #9575cd / default vs pi #393d3f / #a798d7 / #9da5a9.
- **Thinking-level border.** pi `getThinkingBorderColor` (`theme.ts:390-409`) maps `off…max` to seven hues; the port has no such tokens.

## Part 6 — what the port's colour model cannot express

| capability | pi | port | cost |
|---|---|---|---|
| truecolor output for the palette | `getTerminalColorMode()` → `foregroundAnsi(color,"truecolor")` (`packages/tui/src/terminal-capabilities.ts:113-115`, `colors.ts:300-315`) | palette is `Ansi256` only (`theme.rs:191-199`) | every themed colour is quantised |
| okhsl / oklch colours | `okhslColor`, `oklchColor`, gamut-mapped conversion (`colors.ts:118-137`, `:200-238`) | none | pi's perceptually-uniform palette cannot be expressed; values must be pre-resolved |
| colour mixing | `mixColors(a,b,amount,"oklch"\|"srgb")` (`colors.ts:236-262`) | none | cannot dim a token toward the background the way pi does for faint tokens (`theme.ts:303-309`) |
| WCAG contrast / appearance detection | `wcagContrast`, `terminalAppearance`, 4.5:1 rule (`theme.ts:189-212`) | `RgbColor::luminance() < 0.5` (`terminal_colors.rs:56-66`) | on a mid-grey terminal (≈#767676–#7f7f7f) pi picks light, the port picks dark — the whole UI flips palette |
| terminal-default resolution | tokens set to `""` resolve to the terminal's reported fg/bg or a guess (`theme.ts:293-311`, `:141-146`) | `Color::Default` → `\x1b[39m`/`\x1b[49m` | the port's `text` is always `Default`, so on a light terminal its body text can vanish against its own surfaces |
| JSON theme documents, user themes, `vars` | `dark.json`, `light.json`, `vars` indirection, custom theme dir (`theme.ts:83-127`, `:429-520`) | compiled-in `ThemePreset` enum (`theme.rs:548`) | no user theme, no single-token override, palette not diffable as data |
| "system" theme and the `light/dark` auto setting | `SYSTEM_THEME_NAME` (`theme.ts:46`), `parseAutoThemeSetting` / `resolveThemeSetting` (`theme.ts:620-651`), `createSystemTheme` (`:575`) | `follows_terminal` bool only (`theme.rs:409-433`) | `/theme` cannot restore "follow the terminal"; no per-appearance theme pair |
| live appearance tracking (OSC 2031) | `\x1b[?2031h` (`packages/tui/src/tui.ts:1040`, `:1070`), re-query on change (`theme-controller.ts:229-245`) | none (`2031` appears nowhere in `rpi/`) | switching the terminal from dark to light leaves the port on the old palette until restart |
| `COLORFGBG` fallback | `detectColorFgBgTheme` (`theme.ts:639-652`) | none | on a light terminal that does not answer OSC 11, pi picks light, the port stays dark |
| themed list styles | `getSelectListTheme` / `getSettingsListTheme` (`theme.ts:1092-1120`) | hard-coded `\x1b[32m/36m/90m` (`select_list.rs:89-93`, `settings_list.rs:107-110`) | every picker ignores the theme |
| reverse-video fake cursor | `FAKE_CURSOR_START/END` → `\x1b[7m` (`packages/tui/src/tui.ts:219-226`, `:1583-1585`) | none | no visible caret in the input on terminals without the APC marker |

## Part 7 — theme switching

- pi defaults to the `system` theme (`theme.ts:46`, `:718-732`): it resolves to `dark`/`light` from the terminal (`createSystemTheme` `:575`, `detectTerminalTheme` `:664-677`) and re-applies on a new background report or an OSC 2031 change (`theme-controller.ts:186-245`).
- The port queries the same three things — fg, bg and all 16 palette entries, ended by DA1 (`terminal_colors.rs:215-226`, called from `tui_alt_screen.rs:2213-2232` and `tui_main_screen.rs:196-209`) — then picks `Dark`/`Light` from `background.is_dark()` (`theme.rs:409-433`).
- The queried palette is never used: `TerminalColors.palette` is stored and nothing derives a theme from it (`theme.rs:398-404` is its only reader). pi also uses the reported foreground to decide the appearance (`theme.ts:201-212`); the port ignores it.
- In the harness both landed on the dark palette. They diverge when the reported background is mid-grey, when the terminal answers with a light background that the port's `is_dark()` misjudges, or when the terminal reports nothing (pi falls back OSC 2031 → `COLORFGBG` → dark; the port has neither fallback and keeps its default dark palette).
- `/theme` accepts only `dark|light|monochrome` in the port (`rpi/crates/rpi-cli/src/interactive_tui/commands.rs:313-341`, `selectors.rs:506-520`); pi accepts every registered theme including `system` and user JSON themes.

## Part 8 — work list, in order

1. **Palette as data.** Add pi's `dark.json`/`light.json` (58 tokens, `vars` + `colors`) to the port; resolve `okhsl()` to RGB; store every token as `Color::Rgb` with pi's exact RGB. Include the 23 missing tokens as fields.
2. **Truecolor output.** Add a terminal-capability check and emit `38;2;r;g;b` for `Color::Rgb` on a truecolor terminal; keep pi's 256-colour rounding for 256-colour terminals.
3. **Missing tokens.** Add the 23 fields, wire them where pi wires them (scrollbar track/thumb, panel bg, menu selection bg, search match bg/text, user message text, 9 syntax tokens, 7 thinking-border tokens).
4. **Syntax highlighting in markdown.** Port the fence highlighting so a fenced block paints `syntaxKeyword` / `syntaxFunction` / … like pi (`theme.ts:930-952`).
5. **Themed list styles.** Replace the hard-coded `\x1b[32m/36m/90m` in `select_list.rs` / `settings_list.rs` / `input.rs` / `loader.rs` / `alt_screen_search.rs` with theme tokens.
6. **Cursor.** Add the reverse-video fake cursor (pi's `FAKE_CURSOR`) so the input caret is visible without the APC marker.
7. **System theme.** Add a `system` theme that resolves to light/dark from the terminal, an OSC 2031 listener, and a `COLORFGBG` fallback.

## Part 9 — checks each change needs

**Rust test.** Pin the rendered escape sequence of a line, not the palette value. A palette test alone passes while the screen is wrong.

```rust
assert_eq!(
    strip_ansi(&rendered_line),
    "…",
);
assert!(rendered_line.contains("\x1b[38;2;167;152;215m"), "accent must be pi's violet");
```

For the palette itself, one test per theme that asserts every token's RGB:

```rust
assert_eq!(theme.colors.accent, Color::Rgb(167, 152, 215)); // pi dark accent
assert_eq!(theme.colors.accent, Color::Rgb(116, 89, 180));  // pi light accent
```

**Screen comparison.** Capture both programs with the escape sequences and diff them. Plain-text capture hides every colour difference.

```
tmux -L pi-parity capture-pane -e -p -t <session> > /tmp/<side>.txt
```

The parity harness's `scripts/parity/drive.mjs` captures plain text; a colour comparison needs `-e`. Drive both sides through the same mock (`scripts/parity/mock-server.mjs`) and the same agent dir, then compare the escape sequences line by line.

Scenarios that must match on colour: startup/empty session, prompt, tool call + expanded tool output, thinking, markdown, light theme, theme picker.

## Part 10 — how to reproduce this audit

```bash
# pi token values, resolved with pi's own parser
bun /tmp/colour-audit/tokens.ts          # prints both themes' hexes

# pane with escape sequences, both sides
node scripts/parity/drive.mjs ts <scenario>     # plain text
# colour variant: tmux -L pi-parity capture-pane -e -p -t <session>
```

Helper scripts used during the audit live outside the repos, in `/tmp/colour-audit/` (`tokens.ts`, `capture.mjs`, `capture2.mjs`, `capture3.mjs`, `scen/*.json`).
