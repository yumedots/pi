# Sessions, storage, settings, commands, themes, skills, prompt templates

The parity audit for everything that is **written to disk or read back**: the
session file, the storage layout, the settings file, the slash-command set, the
themes, the skills and the prompt templates.

Paths are relative to `/Users/gabriel/pi` (TypeScript original, branch
`perf/lightweight-harness`, commit `06f7bcfc1`) and `/Users/gabriel/pi-native`
(Rust port, branch `feat/rpi-native`, commit `7e057fccf` plus the live working
tree).

Verdicts:

- **identical** — same user-visible behaviour and same written artefact.
- **differs** — both sides have it, but the user (or the file) sees something
  different.
- **missing** — the original has it and the port has no counterpart.
- **inert** — the port has the code but nothing calls it, so the user sees
  nothing.

How the observations were made: both programs were driven side by side under
tmux against the parity mock model (`scripts/parity/mock-server.mjs`,
`mock/mock-1`), one prompt each, and the files they wrote were then read back
and diffed. The data findings (settings keys, command names, entry types,
theme tokens) were extracted mechanically from both trees.

**The check for §1** is `scripts/parity/session-compat.mjs`: it drives each
side once against the mock model, then has each side import the other's
session file and prints the round trip. Run it with
`node scripts/parity/session-compat.mjs` from `/Users/gabriel/pi-native`.

## Status

| # | Finding | State |
|---|---|---|
| 1 | the session file format | **mostly landed** — the port writes pi's version 3 header and the flat entry list, and the session directory has moved to `<agent dir>/sessions`. Measured: `rust -> ts: ok`, `ts -> rust: BROKEN (the transcript lost: thinking block)` — the port opens the original's file and restores the turns, but the thinking block is not persisted by the port and is not rendered on import. See §1.7. |
| 2 | prompt templates not expanded | in flight with the session port |
| 3 | skills not invocable | in flight with the session port |
| 4 | the port's skill validator adds a rule the original does not have | in flight with the session port |
| 5 | `/new` does not start a new session | open |
| 6 | the slash-command set | **mostly landed** — `/skills`, `/bug`, `/stats` and the `/history` + `/sessions` aliases are in the port now; the canonical names of `/quit` and `/resume` still differ, and `/new` still clears instead of starting a session |
| 7 | `/stats` has no counterpart | open |
| 8 | `/export` argument and format | open |
| 9 | `/share` | open |
| 10 | the session directory | **landed** — the port writes `<agent dir>/sessions` now, like pi |
| 11 | the project directory is `.rpi` | **landed** — the project resource dir is `.pi` (`rpi-cli/src/resource_dirs.rs:46`) and the project settings file is `.pi/settings.json` (`rpi-cli/src/settings.rs:1083`), with `.rpi/settings.json` kept as a legacy fallback (`:1085`) |
| 12 | the session picker | open |
| 13 | `/fork` has no fork-point picker | open |
| 14 | modelled-but-ignored settings | open |
| 15 | project settings are not deep-merged | **partly landed** — the file is read from the right place now, but the merge still overlays only `defaultProvider`, `defaultModel`, `defaultThinkingLevel` and `theme` (`rpi-cli/src/settings.rs:1133-1146`); every other key in a project's settings file is still ignored |
| 16 | the settings menu exposes 15 of 37 rows | **handed to the interactive mode port** — the menu now lives in `rpi-cli/src/interactive_tui/settings_menu.rs`, not in my file |
| 17 | themes: three compiled-in palettes | open — the token set now matches (58 against 58) and the presets are still three (`rpi-tui/src/theme.rs:698`) |
| 18 | the project trust prompt | open — there is still no "Trust project folder?" string anywhere in rpi-cli |
| 19 | the mechanical audit's slash-command row | **fixed** in `scripts/parity/audit.mjs` |

---

## 1. The session file is a different format — no interoperability in either direction

**differs — the most consequential finding in the whole audit.**

The two programs write two unrelated file formats for the same concept. A
session written by one cannot be opened by the other, and anything that reads
the file (an extension, a script, the original's own share viewer) breaks.

### 1.1 The header line

| | TypeScript | Rust |
|---|---|---|
| header shape | `{"type":"session","version":3,"id":…,"timestamp":"2026-10-20T21:34:06.203Z","cwd":…}` | `{"kind":"header","version":4,"id":…,"createdAt":1792532073315,"cwd":…}` |
| where | `packages/coding-agent/src/core/session-manager.ts:43` (`CURRENT_SESSION_VERSION = 3`), `:1062-1069` | `rpi/crates/rpi-harness/src/session/jsonl/codec.rs:108` (`decode_header`, requires `kind:"header"`), `rpi/crates/rpi-harness/src/session/types.rs:1130` (`JsonlV4Header`) |

**Observed** (one prompt each, same mock model):

```
TS  line 1: {"type":"session","version":3,"id":"01a15b3c-617b-7522-9405-08b883b6b2bd","timestamp":"2026-10-20T21:34:06.203Z","cwd":"/private/tmp/sessaudit/work"}
Rust line 1: {"kind":"header","version":4,"id":"01a15b3c-617b-7522-9405-08b883b6b2bd","createdAt":1792532073315,"cwd":"/private/tmp/sessaudit/work"}
```

**Check**: `rpi/crates/rpi-cli/src/interactive_tui/commands.rs:641` (`/import`),
then the port reports
`✗ Could not open session 2026-10-20T21-34-06-203Z_01a15b3c-617b-…: no session matches session 2026-10-20T21-34-06-203Z_01a15b3c-617b-…`.
The original's importer (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:6557`,
`runtimeHost.importFromJsonl`) expects a `type:"session"` header and would
reject the port's file the same way.

### 1.2 The entry types, side by side

The original's session is a **flat list of entries**, each with
`{type, id, parentId, timestamp}` (`packages/coding-agent/src/core/session-manager.ts:57-62`,
`SessionEntryBase`) and an ISO-8601 `timestamp`. The port's session is a
**lane-scoped operation log**: a header plus `kind:"record"` lines (the
operation log) interleaved with `kind:"entry"` lines (the branch), each with
`{seq, lane, parentId, timestamp}` and a Unix-millisecond `timestamp`.

**Original — 11 entry types** (`packages/coding-agent/src/core/session-manager.ts`):

| # | `type` | interface | line | extra fields |
|---|---|---|---|---|
| 1 | `message` | `SessionMessageEntry` | `:64` | `message` |
| 2 | `thinking_level_change` | `ThinkingLevelChangeEntry` | `:69` | `thinkingLevel` |
| 3 | `model_change` | `ModelChangeEntry` | `:74` | `provider`, `modelId` |
| 4 | `usage` | `UsageEntry` | `:80` | `kind`, `provider`, `model`, `usage`, `note?` |
| 5 | `compaction` | `CompactionEntry` | `:91` | `summary`, `firstKeptEntryId`, `tokensBefore`, `details?`, `usage?`, `fromHook?`, `systemMessage?` |
| 6 | `branch_summary` | `BranchSummaryEntry` | `:106` | `fromId`, `summary`, `details?`, `usage?`, `fromHook?` |
| 7 | `custom` | `CustomEntry` | `:128` | `customType`, `data?` |
| 8 | `label` | `LabelEntry` | `:135` | `targetId`, `label` |
| 9 | `session_info` | `SessionInfoEntry` | `:142` | `name?` |
| 10 | `custom_message` | `CustomMessageEntry` | `:159` | `customType`, `content`, `details?`, `display` |
| 11 | `context_edit` | `ContextEditEntry` | `:175` | `targetId`, `replacement` |

(the union is `SessionEntry` at `:184-196`)

**Port — 7 entry types** (`rpi/crates/rpi-harness/src/session/types.rs:219`,
`Entry`; the `type` strings at `:263-273`, `entry_type()`; the whitelists at
`rpi/crates/rpi-harness/src/session/jsonl/codec.rs:43` `ENTRY_TYPES`):

| # | `type` | struct | line | extra fields |
|---|---|---|---|---|
| 1 | `message` | `MessageEntry` | `:141` | `message`, `terminate?` |
| 2 | `model_change` | `ModelChangeEntry` | `:151` | `provider`, `modelId` |
| 3 | `thinking_level_change` | `ThinkingLevelEntry` | `:160` | `thinkingLevel` |
| 4 | `active_tools_change` | `ActiveToolsEntry` | `:168` | `activeToolNames` |
| 5 | `compaction` | `CompactionEntry` | `:176` | `summary`, `retainedTail`, `tokensBefore`, `details?`, `usage?` |
| 6 | `branch_summary` | `BranchSummaryEntry` | `:190` | `fromId`, `summary`, `details?`, `usage?` |
| 7 | `custom` | `CustomEntry` | `:203` | `customType`, `data?` |

### 1.3 The entry types the port does not have

| Original | Port | What the user loses |
|---|---|---|
| `usage` (`session-manager.ts:80`) | absent from `Entry`; the port has a `usage` **record** (`types.rs:991` `LaneRecord::Usage`) that is not part of the branch | per-request usage is not part of the branch the export/import/share paths walk; `getUsageCostBreakdown` has nothing to break down |
| `label` (`:135`) | absent from `Entry`; the port keeps labels in a side-channel fact (`types.rs:1207-1214`, `SessionMutation::FactLabel`) | a label is not a branch entry, so it does not travel with an export/import |
| `session_info` (`:142`) | absent from `Entry`; the port keeps the session name in storage metadata | the display name is not in the branch; an exported session loses its name |
| `custom_message` (`:159`) | absent | **extensions cannot inject a message into the LLM context of a session** — the mechanism the original's extension API offers |
| `context_edit` (`:175`) | absent | append-only edits to an earlier entry's contribution to the model context are impossible |

### 1.4 The entry type the port has that the original does not

| Port | Original | Note |
|---|---|---|
| `active_tools_change` (`types.rs:168`) | — | a port extension, not a parity gap in itself, but it means the two `Entry` sets are not equal even after the five above are added |

### 1.5 Field-level differences on the shared entry types

| Type | Original | Port | Difference |
|---|---|---|---|
| base | `{type, id, parentId, timestamp}` (ISO string) — `session-manager.ts:57-62` | `{type, id, seq, parentId, timestamp}` (Unix ms) — `types.rs:124-138` | `seq` is extra; `timestamp` is an integer, not an ISO-8601 string |
| `message` | `message` — `:65` | `message`, `terminate?` — `types.rs:141-147` | `terminate` is extra |
| `compaction` | `firstKeptEntryId` — `:95` | `retainedTail` (the messages) — `types.rs:180` | different field and different meaning: an id vs a copy of the kept messages |
| `compaction` | `fromHook?`, `systemMessage?` — `:99-102` | absent | a compaction made by an extension cannot be marked as such, and the prompt/tool state at the compaction boundary is not stored |
| `branch_summary` | `fromHook?` — `:113` | absent | same |
| `thinking_level_change` | `thinkingLevel` — `:70` | `thinkingLevel` — `types.rs:162` | identical |
| `model_change` | `provider`, `modelId` — `:75-76` | `provider`, `modelId` — `types.rs:153-154` | identical |
| `custom` | `customType`, `data?` — `:129-130` | `customType`, `data?` — `types.rs:205-206` | identical |

### 1.6 The port's extra record types

`rpi/crates/rpi-harness/src/session/types.rs:991` `LaneRecord` — the operation
log that has no counterpart in the original's file at all:

`operation_started`, `abort_requested`, `operation_finished`, `step_attempt`,
`tool_started`, `queue_enqueued`, `queue_cancelled`, `write_deferred`,
`usage`, `assistant_frame`, `retry_pending`
(`rpi/crates/rpi-harness/src/session/jsonl/codec.rs:52` `RECORD_TYPES`).

**Observed** — the port's file for a single prompt:

```
{"kind":"header","version":4,…}
{"kind":"record","type":"operation_started","seq":1,"lane":"main","runId":…,"intent":{"kind":"run","originalPrompt":[…],"initialMessages":[]}}
{"kind":"entry","lane":"main","type":"message","id":…,"seq":2,"parentId":null,"message":{…}}
{"kind":"record","type":"assistant_frame","seq":3,…,"frame":{"type":"start",…}}
{"kind":"record","type":"assistant_frame","seq":4,…,"frame":{"type":"text_start",…}}
{"kind":"record","type":"assistant_frame","seq":5,…,"frame":{"type":"text_delta","delta":"Hello from the parity "}}
{"kind":"record","type":"assistant_frame","seq":6,…,"frame":{"type":"text_delta","delta":"mock."}}
{"kind":"record","type":"assistant_frame","seq":7,…,"frame":{"type":"text_end",…}}
{"kind":"record","type":"assistant_frame","seq":8,…,"op":"commit_stream",…}
{"kind":"entry","lane":"main","type":"message","id":…,"seq":9,"parentId":…,"message":{…}}
{"kind":"record","type":"assistant_frame","seq":10,…,"op":"clear_run"}
{"kind":"record","type":"operation_finished","seq":11,…,"outcome":"completed"}
```

The original's file for the same prompt is six lines: the header, a
`model_change`, a `thinking_level_change` and three `message` entries.

**User terms**: the port's session file is roughly twice the size for one turn
(the streamed frames are persisted), it cannot be read by pi, pi's files cannot
be read by the port, and the original's share viewer cannot render a port
session.

### 1.7 The format, measured against the fresh binary

The format work has landed: the port now writes the original's shape —
`{"type":"session","version":3,"id":…,"timestamp":"<ISO>","cwd":…}` and the flat
entry list with `type`/`id`/`parentId`/`timestamp`
(`rpi/crates/rpi-harness/src/session/types.rs:219`, the writer in
`rpi/crates/rpi-harness/src/session/jsonl/`). The session directory has also
moved to the original's place, `<agent dir>/sessions`.

`node scripts/parity/session-compat.mjs`, against the relinked binary
(`rpi/target/debug/rpi`, 23:40), says:

```
ts -> rust: BROKEN (the transcript lost: thinking block)
rust -> ts: ok (the session opened and the transcript survived)
```

The port now opens the original's file, restores the user turn and the
assistant reply, and says "Imported session from ts-session.jsonl". **The
thinking block is what is still lost**, and it is lost twice over:

1. **The port does not write the thinking block into its own session file.**
   The original's assistant message carries the content blocks
   `['thinking', 'text']`; the port's carry `['toolCall']` and `['text']` — no
   thinking block at all. A port session therefore loses the reasoning, which
   the original's `/export` and `/share` both carry.
2. **The port renders the imported thinking block as the collapsed "+ Thought"
   summary** even with `hideThinkingBlock: false`, where the original shows
   the thinking text.

The port's `usage` also has no `reasoning` field (the original writes
`reasoning: 0`).

**The blocker** is the message discriminator. The port writes an extra `kind`
field on every message and its deserializer requires it
(`rpi/crates/rpi-agent/src/message.rs:26` — `#[serde(tag = "kind",
rename_all = "snake_case")]`). The original's discriminator is `role`, with the
values `user` / `assistant` / `toolResult`
(`packages/agent/src/agent-loop.ts:932`, `packages/ai/src/types.ts:562`), and
the original's messages have no `kind`. So the port cannot deserialise the
original's `message` entries and the import renders an empty transcript.

The message keys, from a mechanical diff of the two files (one prompt, the
same mock model):

| message | original | port |
|---|---|---|
| user | `content, role, timestamp` | `content, **kind**, role, timestamp` |
| assistant | `api, content, durationMs, model, provider, rawStopReason, responseId, role, stopReason, **thinkingLevel**, timestamp, usage` | `api, content, **kind**, model, provider, rawStopReason, responseId, **responseModel**, role, stopReason, timestamp, usage` |
| tool result | `content, details, durationMs, isError, role, timestamp, toolCallId, toolName` | the same **plus `kind`** |
| system | `content, role, **sections**, timestamp, **toolsAdded**` | **absent** — the port writes no system entry |
| usage | `cacheRead, cacheWrite, cost, input, output, **reasoning**, totalTokens` | the same **without `reasoning`** |
| cost | integers (`0`) | floats (`0.0`) |
| entry id | 8 hex characters (`session-manager.ts:1220`) | a full UUID |

The missing **system entry** is a content difference the original relies on:
its `/share` writes a `pi.share` entry carrying the system prompt and the tool
schemas (`packages/coding-agent/src/modes/interactive/session-share.ts:25`),
and a port session has neither.

---

## 2. Prompt templates are listed in the autocomplete and then do nothing

**differs.**

The port loads prompt templates, lists them in the slash-command autocomplete,
and then sends the raw text to the model when one is invoked.

| | TypeScript | Rust |
|---|---|---|
| the type | `packages/coding-agent/src/core/prompt-templates.ts:12` — `{name, description, argumentHint?, content, sourceInfo, filePath}` | `rpi/crates/rpi-harness/src/types.rs:72` — `{name, description?, content}` |
| `argument-hint` frontmatter | `prompt-templates.ts:143` | absent — `grep -rn "argument-hint" rpi/crates` → 0 hits |
| `$1` / `$@` / `$ARGUMENTS` / `${N:-default}` / `${@:N:L}` substitution | `prompt-templates.ts:72` (`substituteArgs`) | `rpi/crates/rpi-harness/src/prompt_templates.rs:377` (`substitute_args`) — exists |
| the expansion | `packages/coding-agent/src/core/agent-session.ts:2255` (`expandPromptTemplate`) | `rpi/crates/rpi-harness/src/agent_harness.rs:4573` (`prompt_from_template`) — **no CLI caller** |
| the autocomplete entry | `packages/tui/src/autocomplete.ts:356` (shows `hint — description`) | `rpi/crates/rpi-cli/src/interactive_tui.rs:1274-1286` |

**Observed**: with `.pi/prompts/hello.md` (and `.rpi/prompts/hello.md`) holding

```
---
description: Say hello from the template
argument-hint: "<name>"
---
Hello template body. Args: $1 and $ARGUMENTS
```

- Original, `/hello World` → the transcript shows
  `Hello template body. Args: World and World`.
- Port, `/hello World` → the session entry is the user message
  `"/hello World"`, verbatim.

**Check**: `grep -rn "prompt_from_template" rpi/crates/rpi-cli` → 0 hits.
`rpi/crates/rpi-cli/src/interactive_tui.rs:1274` builds the autocomplete entry
from the template and nothing else uses it.

---

## 3. Skills are advertised but can never be invoked

**differs.**

The port puts the `<available_skills>` listing in the system prompt (that part
matches), but there is no way to invoke a skill.

| | TypeScript | Rust |
|---|---|---|
| `/skill:name args` | `packages/coding-agent/src/core/skills.ts:360` (`parseSkillCommand`), expanded at `core/agent-session.ts:2201-2225` | deliberately passed through — `rpi/crates/rpi-cli/src/interactive_tui.rs:517` says so in a comment; `grep -rn "skill:" rpi/crates/rpi-cli/src` → only that comment |
| `@name` mention in prose | `core/skills.ts:386` (`findSkillMentions`), `:398` (`removeSkillMentions`), expanded at `core/agent-session.ts:2201` | absent |
| the invocation block | `core/skills.ts:422` — `<skill name="…" location="…">` + "References are relative to **{baseDir}**" | `rpi/crates/rpi-harness/src/skills.rs:89` (`format_skill_invocation`) — same shape, but "relative to {dirname of the file}" |
| the harness API | — | `rpi/crates/rpi-harness/src/agent_harness.rs:4553` (`skill()`) — **no CLI caller** |
| `enableSkillCommands` setting | `core/settings-defaults.ts:33` (default `true`), `core/settings-schema.ts:305` | modelled at `rpi/crates/rpi-cli/src/settings.rs` — `grep -rn "enable_skill_commands" rpi/crates` → only `settings.rs` |

**User terms**: the model is told a skill exists and the user cannot run it.

Two smaller differences in the listing itself:

- `rpi/crates/rpi-harness/src/skills.rs:112` says "Read the full skill file when
  the task matches its description."; the original says "Use the read tool to
  load a skill's file when the task matches its description."
  (`core/skills.ts:434`).
- The port's `Skill` (`rpi/crates/rpi-harness/src/types.rs:56`) has no
  `baseDir` and no `sourceInfo`; the original's `Skill`
  (`core/skills.ts:74`) has both.

---

## 4. Skill validation: the port adds a rule the original does not have

**differs.**

| | TypeScript | Rust |
|---|---|---|
| name rules | `packages/coding-agent/src/core/skills.ts:92` — length ≤ 64, `[a-z0-9-]`, no leading/trailing hyphen, no `--` | `rpi/crates/rpi-harness/src/skills.rs:520` — the same four **plus** `name "{name}" does not match parent directory "{parent}"` (`:522-526`) |
| description rules | `core/skills.ts:118` — required, ≤ 1024 | `rpi/crates/rpi-harness/src/skills.rs:552` — same |

**User terms**: a skill whose frontmatter `name` differs from its folder name
produces a diagnostic in the port that the original never emits.

---

## 5. `/new` does not start a new session

**differs.**

| | TypeScript | Rust |
|---|---|---|
| command | `packages/coding-agent/src/core/slash-commands.ts:43` — `{name:"new", description:"Start a new session"}` | `rpi/crates/rpi-cli/src/interactive_tui/commands.rs:24` — `/clear` with the visible alias `/new` (`:31`, `:36`) |
| what it does | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3068` → `handleClearCommand` (`:6914`) → `runtimeHost.newSession()` → `core/session-manager.ts:1057-1082` writes a **new** `<ts>_<id>.jsonl` | `rpi/crates/rpi-cli/src/interactive_tui.rs:3246` — `chat_container.clear(); add_welcome_message(...)` — the same file keeps growing |

**User terms**: in the port, `/new` is a transcript clear; the old turns stay in
the file and the session list still shows one session.

---

## 6. The slash-command set differs

**differs.**

`packages/coding-agent/src/core/slash-commands.ts:21-53` (26 built-ins) vs
`rpi/crates/rpi-cli/src/interactive_tui/commands.rs:792-832`
(`build_builtin_registry`, 30 built-ins). The mechanical row in
`scripts/parity/audit.mjs` now compares the *invocable* names (canonical plus
aliases) on both sides:

```
## slash commands
the original: 29, the port: 43
missing on the port (0): —
only on the port (14): /?, /clear, /context, /help, /images, /m, /provider, /q, /session, /think, /tools, /usage, /v, /version
```

The five commands that were missing (`/skills`, `/bug`, `/stats`, and the
`/history` + `/sessions` aliases of `/resume`) have since landed in the port
(`rpi/crates/rpi-cli/src/interactive_tui/commands.rs:96`, `:109`, `:125`,
`:335`). What is left is the canonical-name difference and the port's own
extra commands.

| Original command | Port | Difference |
|---|---|---|
| `skills` "Browse and run a skill" (`slash-commands.ts:27`) | `/skills` (`commands.rs:96`) | **landed** — the wording of the behaviour still differs, see §3 |
| `bug` "Report a bug to the Pi developers" (`slash-commands.ts:32`) | `/bug` (`commands.rs:109`) | **landed** |
| `stats` "Show session info and stats" (`slash-commands.ts:35`) | `/stats` (`commands.rs:125`) | **landed** |
| `quit` (alias `exit`) (`slash-commands.ts:53`) | `/exit` (aliases `/quit`, `/q`) (`commands.rs:44-49`) | canonical name differs; the port adds `/q` |
| `resume` (aliases `history`, `sessions`) (`slash-commands.ts:52`) | `/session` (aliases `/history`, `/sessions`, `/session`) (`commands.rs:335`) | canonical name differs |
| `new` "Start a new session" (`slash-commands.ts:43`) | `/new` = alias of `/clear` (`commands.rs:24-42`) | **differs** — see §5 |
| `model` with `argumentHint: "<provider/model>"` (`slash-commands.ts:23`) | `/model` (`commands.rs:110`) | the port has no `argumentHint` on the command type; the hint is missing from the autocomplete |
| `thinking` with `argumentHint: "<level>"` (`slash-commands.ts:25`) | `/thinking` (`commands.rs:191`) | same |
| `theme` with `argumentHint: "<name>"` (`slash-commands.ts:29`) | `/theme` (`commands.rs:305`) | same |
| `login` with `argumentHint: "<provider>"` (`slash-commands.ts:51`) | `/login` (`commands.rs:445`) | same |
| — | `/help` (`commands.rs:7`), `/version` (`:65`), `/provider` (`:161`), `/tools` (`:243`), `/images` (`:263`), `/context` (`:726`), `/usage` (`:746`), `/clear` (`:24`) | port-only |

`argumentHint` is a field of the original's command record
(`packages/coding-agent/src/core/slash-commands.ts:16`) and the autocomplete
renders it (`packages/tui/src/autocomplete.ts:356`); the port's `SlashCommand`
trait has no such field.

Also: the port's `/exit` description is `"Quit pi"`
(`rpi/crates/rpi-cli/src/interactive_tui/commands.rs:44-47`) where the
original's is `Quit ${APP_NAME}` (`slash-commands.ts:53`).

### 6.1 The autocomplete's command entries differ

**differs** — measured with `scripts/parity/settings-parity.mjs` against the
relinked binary.

Typing `/he` in each program:

| | the original | the port |
|---|---|---|
| the entries | `→ hotkeys     Show all keyboard shortcuts` / `  theme       <name> — Change the color theme` / `  share       Share session via a Radius artifact or a GitHub gist` / `  changelog   Show changelog entries` | `→ /help Show available commands` / `  /hotkeys Show all keyboard shortcuts` / `  /changelog Show changelog entries` |
| the leading slash | **none** — the entries are the bare command names | **`/` on every entry** |
| the label column | padded into a column | one space |
| the argument hint | `<name> — Change the color theme` (the hint first, an em dash, then the description — `packages/tui/src/autocomplete.ts:356`) | the port now renders the hint the same way, but the entry is `/theme` |
| the matched set | `hotkeys`, `theme`, `share`, `changelog` | `/help`, `/hotkeys`, `/changelog` |

The original's list is the fuzzy match over the **bare** names, so the entries
and their order differ as well as the rendering. The original's command list
comes from `BUILTIN_SLASH_COMMANDS` (`packages/coding-agent/src/core/slash-commands.ts:21`)
and is offered without the slash; the port offers its registry's names with
one.

**Check**: `node scripts/parity/settings-parity.mjs autocompletePosition-above`
— it reports "the autocomplete lists hotkeys: the original shows it, the port
hides it". The fact is the bare name, so the port's `/hotkeys` does not match
it.

---

## 7. `/stats` has no counterpart; `/usage` is a subset

**differs.**

| | TypeScript | Rust |
|---|---|---|
| command | `/stats` — `packages/coding-agent/src/modes/interactive/interactive-mode.ts:6683-6767` | `/usage` — `rpi/crates/rpi-cli/src/interactive_tui.rs:3345-3375`; `/context` — `interactive_tui/commands.rs:726` |
| session name, file, session id | yes (`:6699-6701`) | no |
| message counts (total / user / assistant / tool calls / tool results) | yes (`:6702-6705`) | messages only (`:3354`) |
| token breakdown (input / cached % / uncached / written / output / total) | yes (`:6707-6717`) | total / cached / uncached (`:3355-3357`) |
| cache-warming mode + status + miss-penalty and refresh-cost economics | yes (`:6719-6727`) | no |
| cost total + **per-model breakdown** + "Cache Re-billed" | yes (`:6729-6757`) | cost total only (`:3358`) |

---

## 8. `/export` takes a format in the port and a path in the original; the port's JSONL export is not a session file

**differs.**

| | TypeScript | Rust |
|---|---|---|
| the argument | a **path** — `packages/coding-agent/src/modes/interactive/interactive-mode.ts:6510-6526` | a **format** — `rpi/crates/rpi-cli/src/interactive_tui/commands.rs:369-394` |
| `.jsonl` ⇒ JSONL, anything else ⇒ HTML | yes (`:6514`) | no |
| the default with no argument | **HTML** (`:6518`) | **Markdown** (`:380`) |
| an unknown argument | a path | `Unknown export format: <arg>. Supported: md, html, jsonl` (`:388`) |
| the JSONL writer | `packages/coding-agent/src/core/session-export.ts:9-30` — writes a `type:"session"` header and the branch, so the export is importable | `rpi/crates/rpi-cli/src/export.rs:199` — writes **only the entries, no header** |
| the HTML writer | `packages/coding-agent/src/core/export-html/` — `template.html` + `template.css` (23 KB) + `template.js` (80 KB) + `tool-renderer.ts` + `ansi-to-html.ts`, themed with the session's theme (`core/agent-session.ts:4354-4375`) | `rpi/crates/rpi-cli/src/export.rs:141` — a fixed inline stylesheet, User/Assistant paragraphs only: no theme, no tool calls, no thinking blocks, no syntax highlighting |

**Observed**: the port's `/export jsonl` wrote a file whose first line is

```
{"type":"message","id":"01a15b43-7a38-…","seq":2,"parentId":null,"timestamp":1792532511288,"message":{…}}
```

and re-importing it produced
`✗ Could not open session 01a15b45-bae9-70c2-8aea-872377479ed6: no session matches session 01a15b45-bae9-70c2-8aea-872377479ed6`.

**User terms**: `/export session.jsonl` — the original's spelling — fails in
the port with "Unknown export format"; bare `/export` gives Markdown in the
port and HTML in the original; and the port's own `.jsonl` export cannot be
imported back.

---

## 9. `/share` shares a different artefact and ignores the destination setting

**differs.**

| | TypeScript | Rust |
|---|---|---|
| what is uploaded | the session as **JSONL**, with a `pi.share` trailing entry carrying the system prompt and the tool schemas — `packages/coding-agent/src/modes/interactive/session-share.ts:25` | a **Markdown** transcript — `rpi/crates/rpi-cli/src/interactive_tui/sessions.rs:8-84` |
| destinations | Radius artefact, falling back to a private gist — `session-share.ts:57-224` | `gh gist create --filename session.md -`, falling back to the clipboard — `sessions.rs:48-84` |
| the destination setting | `sessionShareDestination` (`auto\|gist\|radius`) — `core/settings-schema.ts:227` | modelled at `rpi/crates/rpi-cli/src/settings.rs` — `grep -rn "session_share_destination" rpi/crates` → only `settings.rs` |
| the shared URL | the original's viewer URL plus the gist URL — `session-share.ts:209-210` | the raw gist URL — `sessions.rs:64` |

---

## 10. The session directory is still the port's own; the agent directory is now shared

**differs.**

The port now reads **pi's** config directory — `rpi/crates/rpi-cli/src/config.rs:45`
(`CONFIG_DIR_NAME = ".pi"`), `:49` (`CONFIG_DIR_ENV = "PI_CODING_AGENT_DIR"`),
`:95` (`agent_dir()` → `~/.pi/agent`). The settings, the credentials and the
model catalogue are therefore the same files pi uses. The **session** directory
and the **project** directory are not.

| | TypeScript | Rust |
|---|---|---|
| the agent directory | `~/.pi/agent` — `packages/coding-agent/src/config.ts:613` | `~/.pi/agent` — `rpi/crates/rpi-cli/src/config.rs:95` — **identical** |
| the agent dir override | `PI_CODING_AGENT_DIR` — `config.ts:589-616` | `PI_CODING_AGENT_DIR` — `rpi/crates/rpi-cli/src/config.rs:49` — **identical** |
| the sessions directory | `<agentDir>/sessions` = `~/.pi/agent/sessions` — `packages/coding-agent/src/config.ts:657` | `<cwd>/.rpi/sessions` — `rpi/crates/rpi-cli/src/session.rs:190` (`default_session_dir`) — **differs** |
| the rest of the agent dir | `themes/`, `tools/`, `bin/`, `prompts/`, `sessions/`, `models.json`, `auth.json`, `settings.json` — `config.ts:621-663` | `models.json`, `auth.json`, `settings.json`, `trust.json` — `rpi/crates/rpi-cli/src/config.rs:124-140` |
| a lock file next to the session | no | yes: `<uuid>.jsonl.lock` |
| when the file is created | lazily, only once there is a user or assistant message — `core/session-manager.ts:1160-1190` | eagerly, at launch |

**Observed**: the original wrote
`/tmp/sessaudit/ts-agent/sessions/--private-tmp-sessaudit-work--/<ts>_<uuid>.jsonl`;
the port wrote
`/tmp/sessaudit/work/.rpi/sessions/--private-tmp-sessaudit-work--/<ts>_<uuid>.jsonl`
**plus** `<ts>_<uuid>.jsonl.lock`. Launching the port and quitting without
typing left both files behind.

**User terms**: the settings are shared with pi, but the sessions are not — pi
cannot see the port's sessions and the port cannot see pi's, because they are
in different directories. The project directory also collects session files.

---

## 11. The project directory — landed

**identical** (was `differs` when this was written).

| | TypeScript | Rust |
|---|---|---|
| the project config directory | `.pi` — `packages/coding-agent/src/config.ts:589` (`CONFIG_DIR_NAME`) | `.pi` — `rpi/crates/rpi-cli/src/resource_dirs.rs:46` |
| the project resource roots | `<cwd>/.pi/{skills,prompts,themes,extensions}` — `core/resource-loader.ts:998-1001` | `<cwd>/.pi/{skills,prompts,themes,extensions}` — `resource_dirs.rs:50` |
| the project settings file | `<cwd>/.pi/settings.json` — `core/settings-manager.ts:194` | `<cwd>/.pi/settings.json` — `rpi/crates/rpi-cli/src/settings.rs:1083` (`PROJECT_SETTINGS_PATH`); `<cwd>/.rpi/settings.json` is still read when pi's is absent (`:1085`) |
| the global resource roots | `<agentDir>/{skills,prompts,themes,extensions}` — `core/resource-loader.ts:992-995` | `<agentDir>/{skills,prompts,themes,extensions}` — `resource_dirs.rs:59` — the same |

**Observed** (before the change): the same `hello.md` template loaded by the
original from `.pi/prompts/` was invisible to the port, which needed
`.rpi/prompts/`. The port now reads the original's directory.

**What is still not shared**: the *merge*. The original deep-merges the global
and the project settings so every key in a project's settings file applies
(`core/settings-manager.ts:143`, `:306`); the port overlays only
`defaultProvider`, `defaultModel`, `defaultThinkingLevel` and `theme`
(`rpi/crates/rpi-cli/src/settings.rs:1133-1146`). See §15.

---

## 12. The session picker is much weaker

**differs.**

| | TypeScript | Rust |
|---|---|---|
| the picker | `packages/coding-agent/src/modes/interactive/components/session-menu.ts:195` | `rpi/crates/rpi-cli/src/interactive_tui/selectors.rs:301` |
| the scope (current project / all folders) | yes — `session-menu.ts:23`, `:197`, `:355` | no |
| the sort modes (threaded / recent / relevance) | yes — `session-menu.ts:198`, `:361` | no |
| rename | yes — `session-menu.ts:299`, `:379` | no |
| delete | yes — `session-menu.ts:343`, `:387` | no |
| the query language (token / phrase / regex) | yes — `components/session-selector-search.ts:39` | a plain fuzzy filter — `rpi/crates/rpi-tui/src/fuzzy.rs` |

---

## 13. `/fork` has no fork-point picker

**differs.**

| | TypeScript | Rust |
|---|---|---|
| the command | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3037` → `showUserMessageSelector()` — the user picks the user message to fork from (`components/user-message-selector.ts`) | `rpi/crates/rpi-cli/src/interactive_tui/commands.rs:403` → `TuiMessage::ForkSession` → `interactive_tui/sessions.rs:198` — forks the whole session at the current leaf |

`/clone` is the same code path on both sides
(`packages/coding-agent/src/modes/interactive/interactive-mode.ts:3042`,
`rpi/crates/rpi-cli/src/interactive_tui/commands.rs:419`).

---

## 14. Settings: the file schema matches, but more than twenty keys are parsed and then ignored

**differs.**

The mechanical diff of the top-level settings keys is now clean — the original's
`SettingsSchema` (`packages/coding-agent/src/core/settings-schema.ts:206`, 60
keys) against the port's `Settings` struct
(`rpi/crates/rpi-cli/src/settings.rs:259`) plus its serde aliases:

```
## settings keys
the original: 60, the port: 60
identical
port extensions, not in the original (1): lastRpiChangelogVersion
```

(The port's struct was rewritten during this audit; an earlier state modelled
only 40 fields and silently dropped 28 upstream keys. The list below is the
post-rewrite state.)

**But modelling is not consumption.** `grep -rn "settings\.<field>" rpi/crates
| grep -v rpi-cli/src/settings.rs` returns **0 hits** for every one of these —
the port reads the key, parses it, and never looks at it again:

| Setting | Original | Port |
|---|---|---|
| `autocompletePosition` | `core/settings-schema.ts:381` | ignored — the autocomplete list is always above the input |
| `treeFilterMode` | `:335` | ignored — `/tree` has no filters |
| `sessionShareDestination` | `:227` | ignored — see §9 |
| `externalEditor` | `:288` | ignored — Ctrl+G reads only `$RPI_EXTERNAL_EDITOR` / `$VISUAL` / `$EDITOR` |
| `enableSkillCommands` | `:305` | ignored — see §3 |
| `fullscreenScrollbar` | `:441` | ignored |
| `fullscreenWheelScrollLines` | `:448` | ignored — the wheel is fixed at 3 lines |
| `fullscreenExitOutput` | `:434` | ignored |
| `images.blockImages` / `images.autoResize` | `:106` | ignored |
| `warnings.anthropicExtraUsage` | `:144` | ignored |
| `codemode.mode` / `codemode.inlineBudget` | `:154` | ignored — there is no codemode |
| `cacheWarming` | `:421` | ignored — there is no cache warmer (`grep -rn cache_warmer rpi/crates` → 0) |
| `projectContextMaxChars` | `:412` | ignored |
| `modelThinkingLevels` | `:216` | ignored |
| `defaultProjectTrust` | `:271` | ignored — see §18 |
| `websocketConnectTimeoutMs` | `:428` | ignored |
| `npmCommand` | `:279` | ignored |
| `deviceId` | `:297` | ignored |
| `transport` | `:222` | ignored by the provider layer |
| `queueMode` / `websockets` (deprecated) | `:462`, `:470` | ignored |

One key-name asymmetry survives: the original's key is `enabledModels`
(`core/settings-schema.ts:313`) and the port writes `scopedModels`
(`rpi/crates/rpi-cli/src/settings.rs`, `alias = "scopedModels"` on the
`enabledModels` field). The port reads both, but a port-written
`settings.json` handed to the original loses the scoped-model set.

### The check for this section

**`scripts/parity/settings-parity.mjs`** is the measurement: for each key, the
port's behaviour with the key set must equal pi's behaviour with the key set.
It writes the key into the shared agent settings file, drives both programs
with the same keys in the same project, reads the pane from each side and
compares the facts. "The original shows it, the port hides it" is the port
ignoring the key; "the same on both sides" is the port honouring it.

The cases are a table at the top of the script — one entry per key, with the
keys to send and the facts to read. The first tranche is in:

| key | cases |
|---|---|
| `autocompletePosition` | `above`, `below` (the list's position relative to the input) |
| `autocompleteMaxVisible` | `3`, `20` |
| `hideThinkingBlock` | `true`, `false` |
| `enableSkillCommands` | `true`, `false` (with a skill in the project) |
| `quietStartup` | `true`, `false` |
| `outputPad` | `0`, `1` (the transcript's indent) |
| `editorPaddingX` | `0`, `2` (the input's indent) |
| `doubleEscapeAction` | `none`, `tree` (Esc Esc) |
| `defaultProjectTrust` | `ask`, `always` (the trust prompt) |

The cases that still need a fixture — `markdown.mermaid`, `images.*`,
`warnings.*`, `transport`, `cacheWarming`, `codemode`,
`projectContextMaxChars`, `npmCommand`, `deviceId`, `modelThinkingLevels`,
`sessionShareDestination`, `externalEditor`, `queueMode`, `tuiMode` and the
`fullscreen*` family — are the ones that go in as the reading lands. Each is
three lines in the table.

The project fixture is written under **both** `.pi` and `.rpi`, so a case
measures the setting and not the project-directory question in §11.

### What the measurement says, against the relinked binary

`node scripts/parity/settings-parity.mjs` (18 cases, both programs driven with
the same settings file and the same keys):

| case | result |
|---|---|
| `hideThinkingBlock` true / false | same on both sides |
| `quietStartup` true / false | same on both sides |
| `editorPaddingX` 0 / 2 | same on both sides |
| `outputPad` 1 | same on both sides |
| `outputPad` 0 | **DIFFERS — the indent differs: the original 0, the port 1** |
| `doubleEscapeAction` none / tree | same on both sides |
| `autocompleteMaxVisible` 3 | same on both sides |
| `autocompleteMaxVisible` 20 | **DIFFERS** (the entries the two sides show for the same prefix differ) |
| `autocompletePosition` above / below | **DIFFERS** (see §6.1) |
| `enableSkillCommands` true | **DIFFERS — the skill is offered as a command: the original hides it, the port shows it** |
| `enableSkillCommands` false | **DIFFERS — the skill is offered as a command: the original hides it, the port shows it** |
| `defaultProjectTrust` always | same on both sides |
| `defaultProjectTrust` ask | **DIFFERS — the trust prompt appears: the original shows it, the port hides it** |

Three real differences fall out of it:

1. **`outputPad: 0` is ignored by the port.** With the setting at 0 the
   original's transcript has no left padding; the port still indents by one
   column. With the setting at 1 the two agree, so the port is hard-wired to
   one column. The setting is `outputPad` (`core/settings-schema.ts:377`) and
   its default is 1 (`core/settings-defaults.ts:63`).
2. **`enableSkillCommands` is ignored by the port** — the `skill:` entry is
   offered with the setting on *and* off. The original's setting is
   `enableSkillCommands` (`core/settings-schema.ts:305`, default true,
   `core/settings-defaults.ts:33`) and the original's autocomplete matches a
   skill command on the **bare** name — `packages/tui/src/autocomplete.ts:366`
   matches `item.name.slice("skill:".length)` — so the original offers the
   skill when you type `/demo`, not when you type `/skill`. The port matches
   the full `skill:demo`, so it offers it for `/skill` and not for `/demo`.
   Both halves of that are wrong in the port: the setting is not read, and the
   match is against the wrong string.
3. **The autocomplete's entries differ** — the leading slash, the label
   column and the matched set. See §6.1.
4. **The port has no project trust prompt.** With `defaultProjectTrust: "ask"`
   the original opens the "Trust project folder?" dialog and the port does
   not — there is no such string anywhere in rpi-cli. The trust *store* is
   shared (`<agentDir>/trust.json`, `rpi/crates/rpi-cli/src/config.rs:139`) and
   the port does gate project resources on it, but it never asks. See §18.

The trust cases run **without** the harness's pre-approval
(`trust: false` on the case), otherwise the original would never prompt and
the case would measure nothing.

---

## 15. Project settings are not deep-merged

**differs.**

| | TypeScript | Rust |
|---|---|---|
| the merge | `packages/coding-agent/src/core/settings-manager.ts:143` (`deepMergeSettings`), applied at `:306` — **every** key merges, project wins | `rpi/crates/rpi-cli/src/settings.rs:1133-1146` (`load_effective_model_settings`) — overlays only `defaultProvider`, `defaultModel`, `defaultThinkingLevel`, `theme` |
| the project file | `<cwd>/.pi/settings.json` — `settings-manager.ts:194` | `<cwd>/.pi/settings.json` — `rpi/crates/rpi-cli/src/settings.rs:1083` — **now the same** |

**User terms**: a project's `nerdFonts: true`, `outputPad: 0`,
`treeFilterMode` and everything else in its settings file have no effect. The
file is now read from the right place; the merge is what is still missing.

---

## 16. The settings menu exposes 15 of the original's 37 rows

**differs.**

| | TypeScript | Rust |
|---|---|---|
| the rows | `packages/coding-agent/src/modes/interactive/components/settings-selector.ts:487-905` — 37 top-level rows | `rpi/crates/rpi-cli/src/interactive_tui/settings.rs:142-269` (`settings_menu_items`) — 15 rows |
| the submenu framework | generic — `components/settings-submenu.ts:31` (`SelectSubmenu`, `SteppedSubmenu`) | four hard-coded rows — `rpi/crates/rpi-cli/src/interactive_tui/settings.rs:67-100` |

The port's rows: theme, model, thinking, scoped-models, hide-thinking,
show-images, cache-miss-notices, quiet-startup, collapse-changelog,
terminal-progress, fullscreen-copy-on-select, double-escape-action,
editor-padding, autocomplete-max-items, http-idle-timeout.

Missing from the port: auto-compact, image width, auto-resize images, block
images, skill commands, show hardware cursor, output padding, Nerd Font
glyphs, autocomplete position, clear on shrink, 3D empty session, steering
mode, follow-up mode, transport, session share destination, cache warming,
Mermaid diagrams, default project trust, tree filter mode, warnings
(submenu), default thinking level per model (submenu), TUI mode, fullscreen
exit output, fullscreen scrollbar, fullscreen wheel scrolling.

Port-only rows: Default model, Default thinking, Cycle scope.

---

## 17. Themes: three compiled-in palettes, no JSON themes, no user themes, no "system" theme

**differs.**

| | TypeScript | Rust |
|---|---|---|
| the themes | `packages/coding-agent/src/modes/interactive/theme/dark.json` + `light.json` — okhsl colour **documents** with `vars`, `colors` and `export` blocks | `rpi/crates/rpi-tui/src/theme.rs:698` — `ThemePreset { Dark, Light, Monochrome }` |
| the tokens | `packages/coding-agent/src/modes/interactive/theme/theme-tokens.ts:24` — 58 | `rpi/crates/rpi-tui/src/theme.rs:17` (`ThemeColors`) — 58 |
| a JSON loader | yes — `core/resource-loader.ts:1055` (the default theme dirs), `core/config.ts:621` (`<agentDir>/themes`) | none — `grep -rn "ThemeJson\|from_json" rpi/crates/rpi-tui` → 0 hits |
| a user theme directory | `<agentDir>/themes` and `<cwd>/.pi/themes` — `core/resource-loader.ts:992-1001` | none |
| the `themes` settings key | `core/settings-schema.ts:303` | modelled at `rpi/crates/rpi-cli/src/settings.rs` — `grep -rn "settings.themes" rpi/crates` → 0 hits |
| the "system" theme (follows the terminal's light/dark) | `packages/coding-agent/src/modes/interactive/theme/theme.ts:52` (`SYSTEM_THEME_NAME`) | none — the theme manager has a `follows_terminal` flag (`rpi/crates/rpi-tui/src/theme.rs:446`) but no named "system" theme |
| `/theme <name>` | any registered theme name — `core/slash-commands.ts:29` | only the three — `rpi/crates/rpi-cli/src/interactive_tui/commands.rs:305-341`; anything else is `Unknown theme "x". Valid: dark, light, monochrome.` |

The token **set** now matches exactly (58 against 58, none missing, none
extra). The token **values** do not: the port's palettes are hard-coded
ANSI-256 approximations of the original's okhsl hexes
(`rpi/crates/rpi-tui/src/theme.rs:113` and the light palette at `:459`).

---

## 18. Project trust: the original prompts, the port does not

**differs.**

| | TypeScript | Rust |
|---|---|---|
| the gate | `packages/coding-agent/src/core/trust-manager.ts:28-37` — `settings.json`, `mcp.json`, `extensions`, `skills`, `prompts`, `themes`, `SYSTEM.md`, `APPEND_SYSTEM.md` | `rpi/crates/rpi-cli/src/session.rs` gates project resources on `project_trusted` — but never prompts |
| the prompt | the "Trust project folder?" dialog | none |
| the store | `<agentDir>/trust.json` — `core/trust-manager.ts:214` | `<agentDir>/trust.json` — `rpi/crates/rpi-cli/src/config.rs:139` — the same |

**Observed**: with `.pi/prompts/hello.md` present, the original opened
`Trust project folder? /private/tmp/sessaudit/work` and swallowed the typed
keystrokes into its search field. The port started straight in.

Note: `rpi/crates/rpi-cli/src/resource_dirs.rs:22-27` still carries a stale
doc comment claiming the opposite ("rpi v1 has **no trust prompt** … so project
resources are read unconditionally here"). The code does gate them; the comment
is stale.

---

## 19. The mechanical audit's slash-command row was broken

**fixed.**

`scripts/parity/audit.mjs:325` scanned every quoted string in
`rpi/crates/rpi-cli/src/interactive_tui/commands.rs`, so it reported export
formats, booleans and provider ids as commands (`add`, `html`, `jsonl`,
`monochrome`, `true`, `yes` …) and listed 25 real commands as missing.

The extraction is now anchored on the two trait methods that name a command —
`fn name(&self) -> &'static str { "/x" }` and
`fn aliases(&self) -> &'static [&'static str] { &["/y"] }` — and the original's
side now includes its aliases (`history`, `sessions`, `exit`) so both sides
compare the names a user can type.

---

## The original's exact texts

Copied verbatim from the original so the porters work from its text and not
from a description of it.

### The built-in commands

`packages/coding-agent/src/core/slash-commands.ts:21-53`:

```ts
{ name: "settings", description: "Open settings menu" },
{ name: "model", description: "Select model (opens selector UI)", argumentHint: "<provider/model>" },
{ name: "tree", description: "Navigate session tree (switch branches)" },
{ name: "thinking", description: "Set thinking level", argumentHint: "<level>" },
{ name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
{ name: "skills", description: "Browse and run a skill" },
{ name: "theme", description: "Change the color theme", argumentHint: "<name>" },
{ name: "export", description: "Export session (HTML default, or specify path: .html/.jsonl)" },
{ name: "import", description: "Import and resume a session from a JSONL file" },
{ name: "share", description: "Share session via a Radius artifact or a GitHub gist" },
{ name: "bug", description: "Report a bug to the Pi developers", argumentHint: "<description>" },
{ name: "copy", description: "Copy last agent message to clipboard" },
{ name: "name", description: "Set session display name" },
{ name: "stats", description: "Show session info and stats" },
{ name: "changelog", description: "Show changelog entries" },
{ name: "hotkeys", description: "Show all keyboard shortcuts" },
{ name: "fork", description: "Create a new fork from a previous user message" },
{ name: "clone", description: "Duplicate the current session at the current position" },
{ name: "trust", description: "Save project trust decision for future sessions" },
{ name: "login", description: "Configure provider authentication", argumentHint: "<provider>" },
{ name: "logout", description: "Remove provider authentication" },
{ name: "new", description: "Start a new session" },
{ name: "compact", description: "Manually compact the session context" },
{ name: "resume", description: "Resume a different session", aliases: ["history", "sessions"] },
{ name: "reload", description: "Reload keybindings, extensions, skills, prompts, themes, and context files" },
{ name: "quit", description: `Quit ${APP_NAME}`, aliases: ["exit"] },
```

### How a skill becomes a command

`packages/coding-agent/src/core/agent-session.ts:3440-3445`:

```ts
const skills: SlashCommandInfo[] = this._resourceLoader.getSkills().skills.map((skill) => ({
	name: `skill:${skill.name}`,
	description: skill.description,
	source: "skill",
	sourceInfo: skill.sourceInfo,
}));
```

### How the autocomplete renders a command

`packages/tui/src/autocomplete.ts:355-360` — the argument hint comes first and
is separated by an em dash:

```ts
const hint = "argumentHint" in cmd && cmd.argumentHint ? cmd.argumentHint : undefined;
const desc = cmd.description ?? "";
const fullDesc = hint ? (desc ? `${hint} — ${desc}` : hint) : desc;
```

### The skill invocation block

`packages/coding-agent/src/core/agent-session.ts:2223-2240`:

```ts
const content = readFileSync(skill.filePath, "utf-8");
const body = stripFrontmatter(content).trim();
return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
```

### The skill listing in the system prompt

`packages/coding-agent/src/core/skills.ts:424-462` — the exact lines, one per
array element:

```
"\n\nThe following skills provide specialized instructions for specific tasks.",
"Use the read tool to load a skill's file when the task matches its description.",
"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
"",
"<available_skills>",
"  <skill>",
"    <name>{name}</name>",
"    <description>{description}</description>",
"    <location>{filePath}</location>",
"  </skill>",
"</available_skills>"
```

### The prompt-template expansion

`packages/coding-agent/src/core/prompt-templates.ts:309-325`:

```ts
export function expandPromptTemplate(text: string, templates: PromptTemplate[]): string {
	if (!text.startsWith("/")) return text;

	const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
	if (!match) return text;

	const templateName = match[1];
	const argsString = match[2] ?? "";

	const template = templates.find((t) => t.name === templateName);
	if (template) {
		const args = parseCommandArgs(argsString);
		return substituteArgs(template.content, args);
	}

	return text;
}
```

The substitution's pattern (`packages/coding-agent/src/core/prompt-templates.ts:84`):

```
/\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g
```

The argument parser is bash-like: quoted strings are one argument, and an
empty quoted string is still an argument (`packages/coding-agent/src/core/prompt-templates.ts:24-66`).

### The session file

The header (`packages/coding-agent/src/core/session-manager.ts:1062-1069`):

```json
{"type":"session","version":3,"id":"<uuid>","timestamp":"<ISO-8601>","cwd":"<abs path>"}
```

Every entry carries (`packages/coding-agent/src/core/session-manager.ts:57-62`):

```json
{"type":"<type>","id":"<8 hex chars>","parentId":"<id|null>","timestamp":"<ISO-8601>"}
```

---

1. **The session file formats are unrelated** (§1) — a session cannot cross
   between the two programs in either direction, and five of the original's
   entry types (`usage`, `label`, `session_info`, `custom_message`,
   `context_edit`) have no counterpart in the port's branch.
2. **Prompt templates are listed and then do nothing** (§2) — the port's
   harness has the substitution code; the CLI never calls it.
3. **Skills are advertised and cannot be invoked** (§3) — no `/skill:name`, no
   `@name`.
4. **The port's JSONL export cannot be re-imported, and `/export` takes a
   different argument** (§8) — the original's spelling `/export x.jsonl` errors
   in the port.
5. **`/share` uploads a Markdown transcript, not a session** (§9).
6. **Sessions live in the project directory, not the agent directory** (§10) —
   and the port writes one even when you never chat.
7. **More than twenty settings keys parse and are then ignored** (§14).
8. **`/new` does not start a new session** (§5).
9. **The session picker has no scope, no sort modes, no rename and no delete**
   (§12); **`/fork` has no fork-point picker** (§13).
10. **The command set** (§6, §7) — `/skills`, `/bug` and `/stats` have landed;
    what is left is the canonical name of `/quit` and `/resume`, and `/new`
    still clearing instead of starting a session.
11. **Project resources: `.pi` versus `.rpi`** (§11); **project settings are
    not deep-merged** (§15).
12. **The settings menu exposes 15 of 37 rows** (§16).
13. **Themes: three compiled-in palettes, no JSON themes, no user themes, no
    "system" theme** (§17) — the token set itself now matches.
14. **The original prompts for project trust, the port does not** (§18).
15. **The port's skill validator adds a parent-directory rule the original does
    not have** (§4).

## Decisions the user has to make

1. **The session format.** The user asked for a 1:1 port with no exceptions, so
   the port's files should be the original's files: a pi session must open in
   the port and a port session must open in pi. The options are (a) the port
   writes version 3 with the original's entry types and drops its lane/operation
   log — the cheapest path to parity, and it gives up the richer log; (b) the
   port keeps its own format and also reads and writes the original's — two
   formats to maintain and to keep in sync; (c) the port keeps its own format
   only, which is not a 1:1 port. This decision gates §1, §8, §9 and §12.
2. **Prompt templates and skills.** The harness already implements the
   expansion (`prompt_from_template`, `skill`). The choice is to wire them into
   the command path, or to stop advertising them in the autocomplete until they
   work. Advertising a command that does nothing is worse than not listing it.
3. **`.pi` versus `.rpi`, and `<cwd>/.rpi/sessions` versus
   `<agentDir>/sessions`.** Is the rename final, or should the port also read
   the original's locations for compatibility?
4. **The modelled-but-ignored settings** (§14): warn at startup, or leave them
   silent?
