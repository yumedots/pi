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

## 6. Checks

```
cd /Users/gabriel/pi-native
scripts/agent-cargo.sh test -p rpi-tui --lib autocomplete   # 9 passed
scripts/agent-cargo.sh test -p rpi-tui --lib select_list      # 11 passed
scripts/agent-cargo.sh test -p rpi-cli --lib autocomplete      # the accept-path tests
```

`rpi/crates/rpi-tui/src/autocomplete.rs`:

* `row_description_puts_the_argument_hint_in_front`
* `row_description_falls_back_to_the_bare_description`
* `the_provider_row_carries_the_argument_hint`
* `a_skill_is_matched_by_its_bare_name_first`
* `a_skill_full_name_match_comes_after_the_bare_ones`

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

`rpi/crates/rpi-cli/src/interactive_tui/autocomplete.rs` (unit tests):

* `apply_completion_replaces_the_span_and_keeps_the_rest_of_the_line`
* `apply_completion_adds_the_space_the_item_asks_for`
* `apply_completion_keeps_a_directory_open_for_more_completion`
* `only_a_command_a_mention_or_a_path_is_an_explicit_completion`

## 7. An architectural difference worth writing down

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

## 8. Known gaps in this area (not fixed here)

* The list renders its own rows (`Text` + `→`), so it has no `(n/m)` counter
  and no wrap-around, while the port's `SelectList` has both. The original's
  list is a `SelectList` (`packages/tui/src/components/select-list.ts:128`).
  Routing the list through `SelectList` would close this gap.
* The list shows the leading slash (`/model`); the original lists bare names
  (`model`).
* No argument completions: typing `/model ` opens no list of models in the
  port, while the original gives `model`, `thinking` and `login` a
  `getArgumentCompletions` (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:734-790`).
* The port has a `/help` command that the original does not; the language
  lead is deciding whether it stays. The port's `/` list and its `/help`
  listing have to agree either way.
* The path provider's rows carry the **bare** file name, so accepting one
  replaces the whole path with the name (`/tmp/x/man` → `manual.txt`). The
  original's rows carry the path, so the directory survives
  (`packages/tui/src/autocomplete.ts:143-160`). The accept path itself is
  correct — the text it writes is the provider's text — but the provider's
  text is short.

## 9. The model picker

The model picker itself is a `SearchableSelectList`
(`rpi/crates/rpi-tui/src/searchable_select.rs`) whose rows come from a
`SelectList`; Enter reaches the list through `key_belongs_to_list` and the
list's own `tui.select.confirm` handling. That path was already correct and
is unchanged by this work — the Enter bug was in the *editor's* list, which is
where the model picker is reached from (`/model`).
