# PLAN — cherry-picking `@bachi/pi-coder`

`@bachi/pi-coder` is a whole opinionated Pi environment (37 extensions, 5 themes,
a theme skill, + global config files). **Do not install it wholesale:** it
conflicts with our stack and its `config/settings.json` overwrites ours.
Cherry-pick instead.

## Already covered (skip)

| pi-coder | ours |
|---|---|
| `rewind/` | `@ayulab/pi-rewind` |
| `background-tasks/` | `@vanillagreen/pi-background-tasks` |
| `ask-user-question/` | `@juicesharp/rpiv-ask-user-question` |
| `simple-task/` | `@juicesharp/rpiv-todo` |
| `verify-loop/` (`/goal`) | `pi-goal-x` |
| `mcp-tree/` | `pi-mcp-adapter` |
| `web-search-tree/` | `pi-ketch-web-access` |
| `plan-mode/` | removed ours; could adopt theirs (3-state permission) |

## Missing — worth cherry-picking

Token / context savings:
- `memory/` — Claude-Code-style indexed memory (`memory_write/read/forget/search`
  + `/memory`), survives compaction.
- `bash-command-collapse.ts` — collapses bash output and refuses redundant
  single-purpose bash lookups.
- `explored-group/` + `read-path-collapse.ts` — folds read-only exploration, lean rendering.
- `core-rules/` — re-injects a distilled `AGENTS.core.md` at start + after compaction.
- `compaction-summary/` — trims the `[compaction]` card (render-only).

TUI / quality of life:
- `tool-diff.ts` — Claude-Code-style diffs.
- `statusline/`, `startup-logo/`, `working-indicator/` — footer, header, spinner.
- `recap/` — idle summary (costs a model call).
- `auto-default-model/` — persist model switches to `settings.json`.
- `folder-history.ts` — per-cwd command history.
- `theme-command.ts` + 5 themes + theme skill.
- `clear`/`init`/`exit` commands.
- `thinking-collapse`, `user-message-bar`, `skill-invocation-reorder`,
  `prompt-editor`, `fenceless-code-block`, `codemode-tree`, `tool-search-tree`.
- `sandbox-boundary/` — write/edit delete boundary (Linux ok).
- `subagent-log-guard/`.

## Conflicts (never both)

`rewind`, `background-tasks`, `ask-user-question`, `verify-loop` (`/goal`),
`simple-task`, `plan-mode`. Pi refuses to start on tool-name conflicts.

## How to get them

- **A. Filtered install** (preferred for TUI/render pieces): add `@bachi/pi-coder`
  to `packages` as an object entry with `"extensions": [ ...only what we want... ]`.
  Do **not** copy its `config/settings.json` (overwrites ours) or `AGENTS.md`.
- **B. Copy files** into our repo `plugins/` and load via `extensions`. Full
  control, but manual updates and tied to pi internals.
- Some need settings changes: `codemode-tree` (`-builtin:codemode` + `codemode`),
  `tool-search-tree` (`-builtin:tool-search` + `defaultTools`); `web-search-tree`
  needs `pi-web-access` — skip.

## Recommended shortlist (least-tokens goal)

1. `memory/`
2. `core-rules/` (+ an `AGENTS.core.md`)
3. `explored-group/` + `read-path-collapse.ts`
4. `compaction-summary/`
5. `tool-diff.ts`
6. `statusline/` + `startup-logo/`
