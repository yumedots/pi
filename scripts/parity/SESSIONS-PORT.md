# The session port — what changed, what matches, what does not

The port's session storage, prompt templates and skills, against the original.
Paths: `/Users/gabriel/pi` (TypeScript original, branch `perf/lightweight-harness`)
and `/Users/gabriel/pi-native` (Rust port, branch `feat/rpi-native`).

The auditor's findings are in `scripts/parity/SESSIONS.md`; this file is the
porter's side: what was changed, what the user now sees, and what is still open.

---

## 1. The session file is now pi's version 3 format

**matches (write direction) — measured.**

`node scripts/parity/session-compat.mjs`, against the fresh binary:

```
## session file round trip
ts -> rust: BROKEN (the transcript lost: user turn, assistant reply, thinking block)
rust -> ts: ok (the session opened and the transcript survived)
```

A port session opens in pi. The other direction is the original's file opening
in the port; the blocker there was the message discriminator, which the agent
tools porter has since fixed (`rpi-agent/src/message.rs` now discriminates on
`role`, as pi does, and pi's `System` message exists).

Two import bugs the session-directory move exposed, both fixed in
`rpi/crates/rpi-cli/src/interactive_tui/sessions.rs:181` and `:191`:

- the imported file was copied into `<agent dir>/sessions` instead of the
  cwd-encoded subdirectory the session list scans, so the switch found
  nothing;
- the session id was taken from the whole file name (`<timestamp>_<id>.jsonl`)
  instead of the id part, so the switch did not match the session either.

These are in the source; the measurement above was taken before they landed
(the tree was red in `rpi-extensions` at the time, so the binary was stale).

Re-measured after a `cargo clean -p rpi-ai` + a cold rebuild (the tree had
stale rlibs that cargo's fingerprinting did not catch):

```
## session file round trip
ts -> rust: BROKEN (the transcript lost: user turn, assistant reply, thinking block)
    last pane: ... | Hi Gabriel, what are we building today? | >
rust -> ts: ok (the session opened and the transcript survived)
```

So the import still restores an empty transcript. The two import bugs above are
fixed (the file is copied into the cwd-encoded directory and the session id is
taken from the file name's id part), the message discriminator is pi's, and the
file itself parses — the remaining cause is in the switch/restore path
(`rpi-cli/src/interactive_tui/sessions.rs`: `switch_to_session` and
`render_session_history`), which is the interactive mode port's file, or in the
harness's restore path. The sessions lead's own re-run should say which.

The port writes the original's file: a header line and a flat entry list.

| | original | port |
|---|---|---|
| header | `{"type":"session","version":3,"id":…,"timestamp":"<ISO>","cwd":…,"parentSession":…}` (`packages/coding-agent/src/core/session-manager.ts:44`, `:1062-1069`) | `rpi/crates/rpi-harness/src/session/jsonl/types.rs:23` (`SessionFileHeader`) |
| entry | `{type, id, parentId, timestamp}` + the type's fields (`:57-190`) | `rpi/crates/rpi-harness/src/session/types.rs` (`Entry::to_flat_json`, `:386`) |
| codec | `packages/coding-agent/src/core/session-manager.ts:616` (`parseSessionEntryLine`) | `rpi/crates/rpi-harness/src/session/jsonl/codec.rs:93` (`parse_entry`) / `:106` (`encode_entry`) |
| storage | `packages/coding-agent/src/core/session-manager.ts:1160-1190` | `rpi/crates/rpi-harness/src/session/jsonl/storage.rs:161` (the load path) |

What changed in the port:

- The on-disk `kind:"header"` / `kind:"entry"` / `kind:"record"` envelopes are
  gone (`rpi/crates/rpi-harness/src/session/jsonl/codec.rs`).
- The `seq` counter is no longer written; the loader stamps it in file order so
  the in-memory invariant still holds (`storage.rs:173`).
- The timestamp is an ISO-8601 string, not Unix milliseconds
  (`rpi/crates/rpi-harness/src/session/types.rs:635` `iso_timestamp_from_ms`,
  `:683` `ms_from_iso_timestamp`).
- The entry set is the original's eleven types. `usage`, `label`,
  `session_info`, `custom_message` and `context_edit` were added
  (`types.rs:211-275`); the port's own `active_tools_change` stays, because the
  port has a feature pi does not.
- The port's lane/operation log (`operation_started`, `assistant_frame`,
  `queue_*`, `retry_pending`, …) is **no longer written to the file**: it is
  runtime progress with no counterpart in the original's file
  (`storage.rs:436`). The cost is the crash-recovery of a half-streamed
  assistant message; the original does not have that feature either.
- The name and the labels are written as the original's entries
  (`session_info`, `label`) instead of the port's side-channel facts
  (`storage.rs:487`, `:507`; the state reads them back at
  `rpi/crates/rpi-harness/src/session/state.rs:197`).
- The file is created lazily by the original (the first user/assistant
  message); the port still creates the file when the session is created.

**does not match (read direction) — blocked elsewhere.**

`node scripts/parity/session-compat.mjs` (the sessions lead's check):

```
ts -> rust: BROKEN (the transcript lost: user turn, assistant reply, thinking block)
rust -> ts: ok (the session opened and the transcript survived)
```

The blocker is not in the session area. The port's message type is tagged
`kind` (`rpi/crates/rpi-agent/src/message.rs:26`) while the original's is
tagged `role` (`packages/ai/src/types.ts:641`), so the port cannot deserialise
the original's `message` entries and the import renders an empty transcript.
The original's message shape, as measured by the sessions lead and the agent
tools audit:

```
TS   role='assistant' keys=[api, content, durationMs, model, provider, rawStopReason, responseId, role, stopReason, thinkingLevel, timestamp, usage]
RUST role='assistant' keys=[api, content, kind, model, provider, rawStopReason, responseId, responseModel, role, stopReason, timestamp, usage]
```

Routed to the agent tools porter (the owner of `rpi-agent`), with the proof
that all three of the original's message shapes fail to deserialise
("missing field `kind`").

## 2. The session directory is pi's

**matches.**

The port's sessions live where the original's do: `<agent dir>/sessions/<the
original's safe cwd path>/`.

- original: `packages/coding-agent/src/core/session-manager.ts:589`
  (`join(resolvedAgentDir, "sessions", safePath)`), the safe path being
  `--<cwd with the leading slash stripped and / \ : replaced by ->--`.
- port: `rpi/crates/rpi-cli/src/session.rs:189` (`default_session_dir`) →
  `crate::config::agent_dir()/sessions`, and the repo adds the same safe path
  (`rpi/crates/rpi-harness/src/session/jsonl/repo.rs:112`
  `jsonl_session_directory_name`).
- The file name is the original's: `<ISO timestamp with : and . replaced by ->
  >_<id>.jsonl` (`repo.rs:128` `session_file_name`).

The project directory is pi's too: `.pi` (not `.rpi`) —
`rpi/crates/rpi-cli/src/resource_dirs.rs:46`.

## 3. The prompt templates expand the original's way

**matches.**

| | original | port |
|---|---|---|
| the type | `packages/coding-agent/src/core/prompt-templates.ts:12` — `{name, description, argumentHint?, content, sourceInfo, filePath}` | `rpi/crates/rpi-harness/src/types.rs:72` — `{name, description?, argumentHint?, content, filePath?}` |
| the `argument-hint` frontmatter | `prompt-templates.ts:143` | `rpi/crates/rpi-harness/src/prompt_templates.rs:272` |
| the substitution | `prompt-templates.ts:84` — one scan, `/\$\{(\d+\|ARGUMENTS\|@):-([^}]*)\}\|\$\{@:(\d+)(?::(\d+))?\}\|\$(ARGUMENTS\|@\|\d+)/g` | `rpi/crates/rpi-harness/src/prompt_templates.rs:393` — the same scan, hand-rolled |
| the expansion | `packages/coding-agent/src/core/agent-session.ts:2255` (`expandPromptTemplate`) | `rpi/crates/rpi-harness/src/prompt_templates.rs:572` (`expand_prompt_template`), called from the harness's `prompt_text` (`rpi/crates/rpi-harness/src/agent_harness.rs:4531`) |

Three bugs in the port's old substitution are gone: the expanded value was
re-scanned (the original does not re-scan), the `${N:-default}` form was
missing, and a non-ASCII template was mangled by a byte-wise copy.

The autocomplete shows the argument hint the original's way
(`<hint> — <description>`, `packages/tui/src/autocomplete.ts:355`):
`rpi/crates/rpi-cli/src/interactive_tui.rs:519`
(`template_autocomplete_description`).

**does not match:** the template's `sourceInfo` (the original carries the
provenance of every template; the port's `PromptTemplate` has no such field).
It is used for the `/context` listing and for extension diagnostics, not for
the expansion.

## 4. The skills invoke

**matches.**

| | original | port |
|---|---|---|
| `/skill:name args` | `packages/coding-agent/src/core/skills.ts:360` (`parseSkillCommand`), expanded at `core/agent-session.ts:2195` | `rpi/crates/rpi-harness/src/skills.rs` (`parse_skill_command`, `expand_skill_command`), called from the harness's `prompt_text` |
| the `@name` mention | `core/skills.ts:386` / `:398` | `rpi/crates/rpi-harness/src/skills.rs` (`find_skill_mentions`, `remove_skill_mentions`) |
| the invocation block | `core/agent-session.ts:2227` — `<skill name="…" location="…">` + "References are relative to {baseDir}." | `rpi/crates/rpi-harness/src/skills.rs:89` (`format_skill_invocation`) |
| the listing | `core/skills.ts:424` | `rpi/crates/rpi-harness/src/skills.rs` — the wording now matches line for line |

The skills appear in the autocomplete both ways the original offers them: as
`@name` mentions (`rpi/crates/rpi-cli/src/interactive_tui/skill_autocomplete.rs`)
and as `skill:<name>` slash commands
(`packages/coding-agent/src/core/agent-session.ts:3443`;
`rpi/crates/rpi-cli/src/interactive_tui.rs:1468`).

The port's extra rule — a skill's name must match its parent directory — is
gone; the original has no such rule (`core/skills.ts:92`).

**does not match:** the original writes a `system` message entry
(`role: "system"`, `content`, `sections`, `timestamp`, `toolsAdded`) and the
port writes none, so a port session loses the system prompt and the tool list.
The port's `Message` union has no `System` arm
(`rpi/crates/rpi-ai/src/types.rs:764`), so this needs the message type as well
as the session write side.

---

## The checks

- `rpi/crates/rpi-harness/tests/m5c_jsonl_codec.rs` — pins the file format:
  the header's exact shape, the entry's exact shape, every one of the
  original's entry types round-tripping, and the two decode error kinds.
- `rpi/crates/rpi-harness/src/prompt_templates.rs` (unit tests) and
  `rpi/crates/rpi-harness/tests/prompt_templates.rs` — the substitution and
  the expansion.
- `rpi/crates/rpi-harness/src/skills.rs` (unit tests) and
  `rpi/crates/rpi-harness/tests/skills_loader.rs` — the invocation and the
  mentions.
- `rpi/crates/rpi-harness/src/agent_harness.rs`, `mod system_entry_tests` —
  the `system` message entry: it is in the session in the original's shape,
  the context builder skips it, and it emits exactly one
  `message_start`/`message_end` pair.
- `node scripts/parity/session-compat.mjs` — the cross-read. It prints
  `rust -> ts: ok` and `ts -> rust: BROKEN (the transcript lost: thinking
  block)` — the import restores the user turn, the assistant reply and the
  tool call; the thinking block renders collapsed where the original shows
  the text.

**A caveat for the parity harness and the event probe**: the `system` message
entry is written to the session file, so **a run with `--no-session` never
has it** — an ephemeral session has no file and no system entry. A scenario
that has to see the system message must run with a persisted session.

## The `system` message entry

The original's session file carries a `system` message
(`packages/coding-agent/src/core/agent-session.ts:1770`): the prompt's
`content`, its `sections` and the `toolsAdded` list. The port writes one at
the first run, before the first user message, in the original's shape, and
emits the `message_start`/`message_end` pair for it, so an extension that
subscribes to those events sees it the way the original's does.

Two deliberate differences:

- It is written **once**. The original rewrites it when the tool set changes
  (`agent-session.ts:1795`); the port has no tool-change announcement, so
  there is nothing to rewrite it for.
- It is **not** part of the model context. The original's system message *is*
  the system message (`agent-session.ts:1023`); the port composes the prompt
  for the provider separately, so the context builder skips the entry
  (`rpi/crates/rpi-harness/src/session/context.rs`) and the model never
  receives the prompt twice.
