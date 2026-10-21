# Autocomplete accept path — what changed and how it was verified

Area: the editor's suggestion list (the `/` command list, the `@` mention
list and the path list) — the key that accepts the highlighted row, and the
rows themselves.

* Original: `/Users/gabriel/pi` (branch `perf/lightweight-harness`)
* Port: `/Users/gabriel/pi-native` (branch `feat/rpi-native`)

Files in this area:

| File | What it holds |
|---|---|
| `rpi/crates/rpi-tui/src/autocomplete.rs` | The suggestion providers, the `SlashCommand` row type, the argument hint and the skill-name matching. |
| `rpi/crates/rpi-cli/src/interactive_tui/autocomplete.rs` | The list rendering, the accept path, the highlight movement and the dismissal. |
| `rpi/crates/rpi-cli/src/interactive_tui.rs` | The key dispatch: which key reaches the accept path. |

---

## 1. The bug: Enter did not accept the highlighted item

The original's editor binds `tui.select.confirm` to the open suggestion list
(`packages/tui/src/components/editor.ts:1004-1030`):

```ts
if (kb.matches(data, "tui.select.confirm")) {
    const selected = this.autocompleteList.getSelectedItem();
    if (selected && this.autocompleteProvider) {
        ... applyCompletion ...
        if (this.autocompletePrefix.startsWith("/")) {
            this.cancelAutocomplete();
            // Fall through to submit
        } else {
            this.cancelAutocomplete();
            if (this.onChange) this.onChange(this.getText());
            return;
        }
    }
}
```

The port had **no Enter branch at all**. The key loop wired only Tab to the
accept path; Enter fell through to the editor, whose Enter arm submits the raw
draft. So `/he` + ↓ + Enter sent the literal text `/he` to the model instead
of accepting the highlighted `/help` row. `tui.select.cancel` (Escape) was
missing too: Escape aborted the run instead of closing the list.

### The fix

`rpi/crates/rpi-cli/src/interactive_tui/autocomplete.rs` gained
`accept_highlighted_suggestion`, which mirrors the original's branch exactly:

| Situation | Original | Port (now) |
|---|---|---|
| `/` command row | apply the completion, then submit | `AcceptOutcome::SlashCommand` — the completion is applied and the key falls through to the editor's submit |
| path or `@` mention row | apply the completion, do not submit | `AcceptOutcome::Completed` — the completion is applied and the key is consumed |
| no list open | the draft is sent | `AcceptOutcome::None` — the key falls through unchanged |

The highlighted index survives: the accept path reads the same
`state.autocomplete_selection` the ↑/↓ path moves, and the same provider
(`state.autocomplete`) the list is rendered from — the three are the same
state, so the row Enter accepts is the row the highlight is on.

The list is only *open* in the contexts the original opens one
(`packages/tui/src/autocomplete.ts:412-424`): a `/` command, an `@` mention
or a path. A bare word is not a completion, so its Enter still sends the
message — the port's `is_explicit_completion` draws that line, and the
↑/↓ path uses the same rule, so the two never disagree about whether a list
is open.

Escape now closes the list without touching the draft
(`packages/tui/src/components/editor.ts:972-975`). The port redraws the list
from the provider on every keystroke, so the dismissal is recorded in the
selection (`AUTOCOMPLETE_DISMISSED`) and cleared by the next redraw.

## 2. The rows: the argument hint

The original's row text is `<hint> — <description>`
(`packages/tui/src/autocomplete.ts:352-360`):

```ts
const hint = "argumentHint" in cmd && cmd.argumentHint ? cmd.argumentHint : undefined;
const desc = cmd.description ?? "";
const fullDesc = hint ? (desc ? `${hint} — ${desc}` : hint) : desc;
```

The port's `SlashCommand` row type had only `name` and `description`, so the
format could not be produced. It now carries `argument_hint: Option<String>`
and builds the row text in `SlashCommand::row_description` — the hint in
front, joined by an em dash, the hint alone when there is no description, the
bare description when there is no hint. The CLI passes the hint through
separately (`visible_entries`) instead of pre-joining it, so the format has
one home: the tui library.

The five hints the original gives (`packages/coding-agent/src/core/slash-commands.ts:23-41`):
`/model` → `<provider/model>`, `/thinking` → `<level>`, `/theme` → `<name>`,
`/login` → `<provider>`, `/bug` → `<description>`.

## 3. The skill rows

The original registers every loaded skill as a slash command named
`skill:<name>` with the skill's description
(`packages/coding-agent/src/core/agent-session.ts:3443-3446`) and matches it
by its bare name first, with the full-name matches after
(`packages/tui/src/autocomplete.ts:365-372`).

The port built the `skill:<name>` rows and then dropped them on the floor —
they never reached the provider, so no skill was ever offered. They now join
the command list, and the provider matches a skill row by its bare name
(`foo`) with the full-name matches (`/skill:foo`) after it.

## 4. The label column

The original's slash-command list puts the descriptions in a column
(`packages/tui/src/components/editor.ts:286-288`):

```ts
const SLASH_COMMAND_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 12,
	maxPrimaryColumnWidth: 32,
};
```

and the width is `clamp(max(visibleWidth(label) + 2) over the filtered items,
12, 32)` with a gap of 2 (`packages/tui/src/components/select-list.ts:6-7,
288-307`). The port's rule already lived in the tui library
(`rpi-tui/src/select_list.rs`, `get_primary_column_width`); it is now reachable
as `SelectListLayoutOptions::column_width(&labels)` so the popup and the
select lists use **one** implementation. The popup measures the labels of
every filtered item, not just the visible window — the original reads
`this.filteredItems`.

## 5. The `enableSkillCommands` setting

The original registers the skills as `skill:<name>` commands
(`packages/coding-agent/src/core/agent-session.ts:3443-3446`) and the
`enableSkillCommands` setting decides whether the registration happens
(`packages/coding-agent/src/core/settings-schema.ts:305`, default `true`). The
port had the field and the expansion but consulted neither. The setting is now
read at startup (`TuiStartupSettings::enable_skill_commands`) and the skill
rows are only added to the command list when it is on.

## 6. The mentions and the files are offered together

For one `@` query the original shows the skill mentions **and** the file
completions, the mentions first
(`packages/tui/src/autocomplete.ts:330-345`):

```ts
const mentionSuggestions = this.getMentionSuggestions(rawPrefix);
const fileSuggestions = await this.getFuzzyFileSuggestions(rawPrefix, {…});
const suggestions = [...mentionSuggestions, ...fileSuggestions];
```

The port splits the original's single provider in two, and the chain returns
the **first** provider that answers
(`rpi/crates/rpi-tui/src/autocomplete.rs`, `CombinedAutocompleteProvider`), so a
matching skill hid the files for the same query. The mention provider now takes
the file provider and merges its rows into the same list, mentions first. The
file rows are rebased onto the mention's span and carry the `@` in their value,
which is what the original's `buildCompletionValue` does
(`packages/tui/src/autocomplete.ts:143-160`).

## 7. The counter, the wrap-around and the path rows

**The popup is a `SelectList`, rendered at the width the layout gives it.**
The original builds the popup's list as a `SelectList` with the layout options
(`packages/tui/src/components/editor.ts:2451-2452`) and renders it at the
editor's own width, so the popup shows the same `(n/m)` counter, the same label
column and the same wrap-around as every other list. The port's popup rendered
its own `Text` rows, so it had no counter and its ↑/↓ stopped at the ends.

The rows are **not** pre-rendered into the container: a row laid out at one
width and drawn at another wraps, and the popup then shows a broken row instead
of the list. The popup is a component that renders its own `SelectList` at the
width the layout hands it.

* the counter is the library's (`packages/tui/src/components/select-list.ts:126-131`);
* the ↑/↓ navigation wraps (`packages/tui/src/components/select-list.ts:196-212`):
  `↓` past the last entry returns to the first, `↑` before the first goes to the last;
* the command list gets the narrower column
  (`packages/tui/src/components/editor.ts:2451`), the other lists keep the default.

The **selection stays single-sourced**: the rows come from the provider and the
highlight from `state.autocomplete_selection`, and the list is given that index
before it renders. The row the popup highlights is therefore the row the accept
path takes — the agreement that the Enter bug was about.

**The path rows carry the path.** The original's rows carry the path
(`packages/tui/src/autocomplete.ts:143-160`, `buildCompletionValue`), so
accepting one does not drop the directory the user typed. The port's rows
carried the bare file name, so accepting a completion replaced the whole path
with the name — a correctness bug, not a difference in look. The provider now
keeps the directory part of the prefix in the row.

### The evidence: the user's own view

`scripts/parity/screens/run.mjs rust input-autocomplete`, diffed against pi's
capture of the same screen:

```
→ settings       Open settings menu
  model          <provider/model> — Select model (opens selector UI)
  tree           Navigate session tree (switch branches)
  thinking       <level> — Set thinking level
  scoped-models  Enable/disable models for Ctrl+P cycling
  (1/29)
```

The rows are byte-identical to pi's: the bare names, the padded column, the
`<hint> — <description>` format and the `(n/m)` counter. The only difference is
the counter's total — pi `(1/31)`, the port `(1/29)` — because the port's `/`
list has two fewer commands. That is the command set, not the list's rendering.

## 8. Checks

```
cd /Users/gabriel/pi-native
scripts/agent-cargo.sh test -p rpi-tui --lib autocomplete   # 11 passed
scripts/agent-cargo.sh test -p rpi-tui --lib select_list      # 11 passed
scripts/agent-cargo.sh test -p rpi-cli --lib autocomplete      # 17 passed
scripts/agent-cargo.sh test -p rpi-cli --lib skill_autocomplete # 3 passed
```

`rpi/crates/rpi-tui/src/autocomplete.rs`:

* `row_description_puts_the_argument_hint_in_front`
* `row_description_falls_back_to_the_bare_description`
* `the_provider_row_carries_the_argument_hint`
* `a_skill_is_matched_by_its_bare_name_first`
* `a_skill_full_name_match_comes_after_the_bare_ones`
* `a_path_row_carries_the_whole_path`
* `a_path_row_keeps_the_directory_part`

`rpi/crates/rpi-tui/src/select_list.rs`:

* `the_column_is_the_widest_label_plus_the_gap`
* `the_column_clamps_to_the_layouts_bounds`

`rpi/crates/rpi-cli/src/interactive_tui/tests.rs`:

* `enter_accepts_the_highlighted_autocomplete_item` — ↓ moves the highlight to
  row 1, Enter accepts *that* row (not row 0) and reports a command, so the
  Enter also submits.
* `enter_on_a_path_completion_does_not_submit` — a path row is applied and the
  Enter does not submit.
* `enter_without_a_popup_leaves_the_draft_alone` — a bare word is not a
  completion, so Enter sends the message.
* `escape_closes_the_autocomplete_without_changing_the_text` — the draft is
  untouched and a dismissed list does not accept.
* `the_popup_shows_the_counter` — the popup shows the original's `(n/m)`.
* `the_popup_wraps_around` — `↓` past the last entry returns to the first and
  `↑` before the first goes to the last.
* `the_popup_renders_its_rows_in_the_dock` — the popup renders its rows in the
  real dock at the width the layout gives it: the rows, the descriptions and
  the counter are all there. This is the test that catches a row laid out at
  one width and drawn at another, which is what made the popup show only its
  `→` marker.

`rpi/crates/rpi-cli/src/interactive_tui/autocomplete.rs` (unit tests):

* `apply_completion_replaces_the_span_and_keeps_the_rest_of_the_line`
* `apply_completion_adds_the_space_the_item_asks_for`
* `apply_completion_keeps_a_directory_open_for_more_completion`
* `only_a_command_a_mention_or_a_path_is_an_explicit_completion`

`rpi/crates/rpi-cli/src/interactive_tui/skill_autocomplete.rs`:

* `a_skill_and_a_file_are_both_offered_the_skill_first`
* `a_file_alone_is_offered`
* `the_mentions_are_offered_without_the_files`

## 9. An architectural difference worth writing down

The original's editor holds the suggestion list as **state**
(`autocompleteState`, `autocompleteList`, `autocompletePrefix`), so "the list
is open" is a fact about the editor. The port's editor has no autocomplete at
all: the list is **redrawn** from the provider on every keystroke, into a
container above the editor. "The list is open" is therefore not a state of the
list — it is a question about the provider and the current text.

Two consequences:

* A key that must only apply while the list is open has to ask the provider
  (`autocomplete_is_open`), not read a flag. `is_explicit_completion` draws
  that line, and the ↑/↓ path and the Enter path share it, so the two can
  never disagree about whether a list is open.
* A key that **closes** the list cannot just clear the container: the next
  redraw would bring it back. The dismissal is recorded in the selection
  (`AUTOCOMPLETE_DISMISSED`) and cleared by the next redraw — which is what
  `close_autocomplete` does. Anyone changing the dismissal logic should read
  this paragraph first.

## 10. Known gaps in this area (not fixed here)

* The list shows the leading slash (`/model`); the original lists bare names
  (`model`).
* No argument completions: typing `/model ` opens no list of models in the
  port, while the original gives `model`, `thinking` and `login` a
  `getArgumentCompletions` (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:734-790`).
* The port has a `/help` command that the original does not; the language
  lead is deciding whether it stays. The port's `/` list and its `/help`
  listing have to agree either way.

## 11. The model picker

The model picker itself is a `SearchableSelectList`
(`rpi/crates/rpi-tui/src/searchable_select.rs`) whose rows come from a
`SelectList`; Enter reaches the list through `key_belongs_to_list` and the
list's own `tui.select.confirm` handling. That path was already correct and
is unchanged by this work — the Enter bug was in the *editor's* list, which is
where the model picker is reached from (`/model`).
