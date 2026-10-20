# The gaps that need a decision

The inventory in [FEATURES.md](FEATURES.md) lists 147 user-visible TUI features:
62 identical, 50 differ, 35 missing. The rule for this work is that a feature is
ported unless it cannot be, and anything that cannot be is listed here with the
reason, so the user can sign it off.

Nothing in this file is a silent gap: every row here is a feature the TypeScript
original has and the Rust port does not, and every one of them is either being
ported (the "Port" column) or needs a decision.

## Being ported now

| Feature | Where | Who |
| --- | --- | --- |
| the centred empty-session screen (logo, greeting, input) | rpi-tui + rpi-cli | ported: the harness's startup and panels scenarios match the golden traces |
| the footer's one-line layout, context bar, exact token count, Nerd Font icons, "(sub)", routed-model suffix | rpi-tui/src/footer.rs | ported: the footer line is byte-identical in every scenario |
| the collapsed thinking summary, the duration, the expansion, the live thinking indicator | rpi-tui/src/assistant_message.rs | ported: the summary matches; expanding it with the mouse waits for the mouse event layer |
| the markdown fidelity: CommonMark behaviour, LaTeX, links, strikethrough, list markers, backslash escapes, fenced code, tables | rpi-tui/src/markdown.rs | in flight |
| the input box's card and the `> ` gutter | rpi-tui/src/editor.rs | ported: the input box matches character for character |
| the 3D logo's own frames | rpi-tui/src/logo3d.rs | ported: the frames match at fixed times, pinned by the Rust tests |
| pi's mark, wordmark, version and header | rpi-cli/src/brand.rs | in flight |
| the per-tool renderers | rpi-tui/src/tool_execution.rs | ported: read, write, bash, grep, find, ls and edit draw the upstream call header and result body; the read tool's call line matches the golden trace |
| the mouse event layer: the handler, the dispatch, the hit testing, the hover, the click, the scrollbar drag, the OSC 8 links, the text selection and copy | rpi-tui/src/component.rs, layout.rs, mouse.rs, list_hover.rs | ported |
| the overlay's absolute and percentage placement, the bounds, the unfocus | rpi-tui/src/overlay.rs | ported |
| the terminal colour query with the palette and the DA1 end marker | rpi-tui/src/terminal_colors.rs | ported |
| starting without any credential | rpi-cli/src/provider.rs | ported: the session starts, the request path reports the login guidance |
| the extension compatibility suite | rpi-js + rpi-cli | ported: the port loads extensions from disk and publishes every module name pi publishes; 5 of the 21 example extensions already produce a byte-identical pane |
| the keybinding registry: 27 ids pi has and the port does not (app.quit, the app.session.*, app.models.*, app.tree.* families, app.thinking.save), 7 port-only ids, 11 different default keys | rpi-tui/src/keybindings.rs | in flight; `node scripts/parity/audit.mjs keys` is the acceptance list |
| the word wrapping: the port breaks words mid-word, the original does not | rpi-tui/src/utils.rs, rpi-tui/src/editor.rs | in flight; it changes every wrapped line on screen |
| the input box: no height cap, no scroll hints, no visible caret in the multi-line editor | rpi-tui/src/editor.rs | in flight |
| the colours: not one of pi's 58 tokens matches, 23 are missing, and the port's palette is a different colour world (Ansi256 teal and green where pi paints violet and blue) | rpi-tui/src/theme.rs | in flight; `scripts/parity/COLOURS.md` is the work list |
| the mouse: no caret placement, no wheel over the input, no hover in the settings list | rpi-tui/src/mouse.rs, component.rs, layout.rs | in flight |

## Ported, still to be checked against the trace

| Feature | Where |
| --- | --- |
| the overlay's absolute and percentage placement, `unfocus`, `getBounds` | rpi-tui/src/overlay.rs |
| the terminal colour query: the 16 palette entries, the DA1 end marker | rpi-tui/src/terminal_colors.rs |
| the input box's scroll hints ("↑ N more") | rpi-tui/src/editor.rs |
| the input box's prompt gutter ("> ") | rpi-tui/src/editor.rs |
| the autocomplete position (above or below the input) | rpi-cli/src/interactive_tui/state.rs |
| the alt-screen viewport keys: Ctrl+Up/Down for the previous and next prompt | rpi-tui/src/keybindings.rs |
| the app keybinding families: `app.quit`, `app.thinking.save`, `app.session.*`, `app.tree.*`, `app.models.*` | rpi-tui/src/keybindings.rs |
| macOS "Option" naming in the hints | rpi-tui/src/keybinding_hints.rs |
| the cancel hint in the status line (Esc, not Ctrl+C) | rpi-tui/src/status_indicator.rs |
| the user message: the background inside the markdown, the list markers, the markdown transformers | rpi-tui/src/user_message.rs |
| the assistant message's OSC 133 prompt zones | rpi-tui/src/assistant_message.rs |
| the stop-reason notice after a partial answer | rpi-tui/src/assistant_message.rs |
| the per-tool `renderCall` and `renderResult` renderers | rpi-tui/src/tool_execution.rs |
| the custom (extension-injected) message card | rpi-cli/src/interactive_tui/events.rs |
| the compaction summary card | rpi-cli/src/interactive_tui/run.rs |
| the mermaid modes (off, streaming, static) and the width handling | rpi-tui/src/mermaid.rs |
| the image transcoding for Kitty terminals | rpi-tui/src/image.rs |
| the header's artwork and the onboarding block | rpi-cli/src/interactive_tui/rendering.rs |
| the window title ("Pi - session - cwd") | rpi-cli/src/brand.rs |
| the model picker: the provider grouping, the scoped-model toggle, saving the default | rpi-cli/src/interactive_tui/selectors.rs |
| the settings menu: 15 of about 35 rows | rpi-cli/src/interactive_tui/settings.rs |
| the nested settings submenu framework | rpi-cli/src/interactive_tui/settings.rs |
| the theme picker: every registered theme plus "system" | rpi-cli/src/interactive_tui/selectors.rs |
| the trust decision picker | rpi-cli/src/interactive_tui/commands.rs |
| the OAuth provider picker | rpi-cli/src/interactive_tui/selectors.rs |
| the session picker: the project scope, the sort modes, the rename and delete | rpi-cli/src/interactive_tui/selectors.rs |
| the hotkeys list, built from the resolved keybindings | rpi-cli/src/interactive_tui/rendering.rs |
| the slash command set | rpi-cli/src/interactive_tui/commands.rs |
| `/new` starts a new session file instead of clearing | rpi-cli/src/interactive_tui/commands.rs |
| `/theme <name>` takes any registered name | rpi-cli/src/interactive_tui/commands.rs |
| `/export` defaults to HTML | rpi-cli/src/interactive_tui/commands.rs |
| `/quit` is the canonical name | rpi-cli/src/interactive_tui/commands.rs |
| `/stats` reports the session information | rpi-cli/src/interactive_tui/commands.rs |
| `/skills` browses and runs a skill | rpi-cli/src/interactive_tui/commands.rs |
| `/bug` reports a bug | rpi-cli/src/interactive_tui/commands.rs |
| the alt-screen search: the inline match highlighting, the next and previous navigation | rpi-tui/src/alt_screen_search.rs |
| the scrollbar: the themed track and thumb, the dragging | rpi-tui/src/scroll_view.rs |
| the mouse wheel: the acceleration, the Alt multiplier | rpi-cli/src/interactive_tui/state.rs |
| the diff rendering of the tool output | rpi-tui/src/diff.rs |
| the session share: the Radius artifact, the GitHub gist | rpi-cli/src/interactive_tui.rs |
| the theme tokens: the 18 missing ones (scrollbar, panel, menu, search, user message, syntax, thinking) | rpi-tui/src/theme.rs |
| the theme documents: light.json, dark.json, the user themes | rpi-tui/src/theme.rs |
| the "system" theme following the terminal's light or dark mode | rpi-tui/src/theme.rs |
| the colour algebra: oklch, okhsl, mixing, the contrast checks | rpi-tui/src/theme.rs |

## Needs a decision

| Feature | Why it might not be portable | Recommendation |
| --- | --- | --- |
| the mouse event API on the component trait (click-to-select, copy-on-select, hover-to-select, mouse regions, click-to-open links) | the Rust `Component` trait has no mouse handler at all; this is a change to the core trait, not to a component | port it: the Rust port already has a mouse wheel gesture, so the events exist at the terminal level |
| the Armin bitmap component | a bitmap of the author, drawn in the TUI | port it: it is data plus a renderer |
| the Earendil announcement banner | a 526 KB PNG read and base64-encoded at construction | port it: the image has to load lazily, not at construction |
| the centred layout helper | the TypeScript original has a `Centered` component; the Rust tree does not | port it: the empty-session screen needs it |
| the first-run setup dialog | the TypeScript original asks for a theme on the first run | port it, or decide the Rust port never asks |
| the auth URL dialog (the OAuth URL to paste) | the Rust port has no component that prints a URL | port it: the OAuth flow needs it |
| the Radius login selector | a service specific to the TypeScript original's deployment | decide: the Rust port does not talk to Radius |
| the config selector (global and project scope) | the Rust port has no config-resource editor | port it, or decide the Rust port does not edit resources |
| the fork-from-message picker | the Rust port always forks from the current leaf | port it: the branch tree already exists |
| the branch summary card | the Rust port has no branch summary message | port it |
| the alt-screen flash messages | a transient banner | port it |
| the 16 colour palette query | the Rust port asks the terminal for the foreground, the background and the cursor | port it: the themes can use the palette |
| the exact token count with thousands separators | the Rust port formats the count without separators | port it: it is a formatter |
| the session search: token, phrase and regex queries | the Rust port has a plain fuzzy filter | port it |
| the "system" theme | depends on the terminal's reported background | port it |
| the "one" missing theme token and the two the Rust port adds | the colour sets differ slightly in both directions | port the Rust ones into the TypeScript set |

## How a row leaves this file

A row leaves when the feature is ported and the parity harness shows the pane
matching, or when the user signs the row off as an exception. The harness is the
evidence: `node scripts/parity/run-all.mjs` has to be clean for the row to be
called done.

## A difference outside the UI

The token harness (bench/tokens/token-usage.mjs) sends the same prompt to the
same local model on both sides. The TypeScript original's request is 1357 tokens
with the prefix cached; the Rust port's is 2943 with nothing cached. The
port's prompt is not the same as the original's — the system prompt, the tool
declarations and the project context differ — so the server's prefix cache never
hits and the request carries the whole prompt every turn.

This is a prompt-parity gap, not a UI gap, so it is not in the inventory above.
It matters for two reasons: the token cost of a turn, and the latency of the
first token. The TypeScript original's request reaches the model in about 40 ms
with the cache warm; the Rust port's reaches it in about 3 ms with a small
context and 264 ms with the full one.

The compaction bug that made the port send two requests per turn is fixed (see
rpi/docs/agent/context-compaction.md). What is left is the prompt itself.
