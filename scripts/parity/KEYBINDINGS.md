# Keybindings parity — registry, defaults, descriptions, behaviour

Area: the keybinding registry (`rpi/crates/rpi-tui/src/keybindings.rs`) and the
handlers behind each id (`rpi/crates/rpi-cli/src/interactive_tui/`).

## What the original does

* The registry lives in `packages/tui/src/keybindings.ts` (`TUI_KEYBINDINGS`,
  46 ids) and `packages/coding-agent/src/core/keybindings.ts`
  (`APP_KEYBINDINGS`, 43 ids). The exported `KEYBINDINGS` merges them and
  overrides four ids per platform (`tui.editor.undo`,
  `tui.altScreen.previousPrompt`, `tui.altScreen.nextPrompt`,
  `tui.altScreen.search`). 89 ids in total.
* Every id has a `description`; the descriptions are user-facing (the
  `/hotkeys` table shows them).
* The app-level ids are consumed by the component that owns the screen:
  * `app.session.*` — the session menu (`components/session-menu.ts:335-395`).
  * `app.tree.*` — the tree selector (`components/tree-selector.ts:997-1095`).
  * `app.models.*` — the scoped-models selector
    (`components/scoped-models-selector.ts:280-380`).
  * `app.thinking.save` — the thinking selector
    (`components/thinking-selector.ts:58-62`).
  * `app.session.new` / `.tree` / `.fork` / `.resume` — registered on the
    editor (`interactive-mode.ts:2879-2882`).
  * `app.quit` — the editor (`interactive-mode.ts:2860` → `handleQuit`
    `interactive-mode.ts:4115-4125`): press twice inside 500 ms; the first
    press shows a warning banner and never touches the editor content.

## What the port does now

* The registry is 1:1: the same 89 ids, the same default keys (including the
  platform variants), the same descriptions. The check is
  `node scripts/parity/audit.mjs keys` → "identical: every id, every default
  key", and `cargo test -p rpi-tui registry_matches_the_original` pins every
  id, its keys and its description against the original's list.
* `app.clear` was renamed to `app.quit`, and the behaviour became pi's: the
  first Ctrl+C shows "Press Ctrl+C again to exit" in the dock's warning slot
  (cleared after 3 s, like pi's `showWarningBanner`), the second press inside
  500 ms exits, and the editor content is never cleared.
  Port: `rpi/crates/rpi-cli/src/interactive_tui.rs` (the Ctrl+C branch),
  `rpi/crates/rpi-cli/src/interactive_tui/state.rs` (`ctrl_c_action`,
  `show_warning`).
* The selector families are handled in the key loop, before the list sees the
  key: `rpi/crates/rpi-cli/src/interactive_tui/selector_keys.rs`.
  * Session menu: `toggleSort` (Ctrl+S) cycles the order (newest first /
    oldest first), `togglePath` (Ctrl+P) swaps the metadata column between the
    session id and the session path, `toggleNamedFilter` (Ctrl+N) keeps only
    the named sessions, `rename` (Ctrl+R) writes a `name` fact into the
    session file, `delete` (Ctrl+D) and `deleteNoninvasive` (Ctrl+Backspace)
    delete the session file behind a confirmation banner (the non-invasive one
    only when the search box is empty).
  * Tree: `filter.default` / `.noTools` / `.userOnly` / `.labeledOnly` / `.all`
    and `filter.cycleForward` / `.cycleBackward` filter the rows, exactly like
    pi's `applyFilter`; `toggleLabelTimestamp` (Shift+T) shows the label
    timestamps; `editLabel` (Shift+L) writes a label on the selected entry;
    `foldOrUp` / `unfoldOrDown` move the selection (the port's tree is a flat
    list, so there is no subtree to fold — pi falls back to the same move when
    the node is not foldable).
  * Scoped models: `save` (Ctrl+S) persists the cycle scope, `enableAll`
    (Ctrl+A) / `clearAll` (Ctrl+X) / `toggleProvider` (Ctrl+P) edit it, and
    `reorderUp` / `reorderDown` (Alt+Up / Alt+Down) reorder it.
  * Thinking: `app.thinking.save` (Ctrl+S) stores the highlighted level as the
    default thinking level.
* `app.session.new` / `.tree` / `.fork` / `.resume` run the same commands as
  their slash counterparts (`/clear`, `/tree`, `/fork`, `/session`). They have
  no default key, so they only fire when the user binds one.
* Every registered id can be overridden from the settings now (the port used
  to accept 15 hard-coded ids).
* The `/hotkeys` table matches pi's rows and wording, including the
  `app.quit` row ("Exit (press twice)") and the two jump rows.

## Known differences (deliberate)

* The port's session menu has two sort orders (newest first / oldest first);
  pi has three (`threaded` / `recent` / `relevance`) because pi's session menu
  renders a thread tree. The port's picker lists flat session files.
* The port's tree selector lists the current branch's entries flat; pi's
  renders the whole branch tree with folding. The port therefore implements
  pi's "fold or up" fallback (move the selection) instead of folding.
* The port's Windows clipboard fallback rides `alt+v` (pi's Windows key for
  `app.clipboard.pasteImage`), so the Windows paste-text path is `Alt+V`.

## Checks

* `node scripts/parity/audit.mjs keys` — the id and default-key diff.
* `cargo test -p rpi-tui keybindings` — the registry pin (every id, its keys,
  its description).
* `cargo test -p rpi-cli selector_keys` — one test per new family (session,
  tree, models): the pressed key reaches the handler pi's key reaches.
* `cargo test -p rpi-cli ctrl_c` — pi's press-twice quit.
