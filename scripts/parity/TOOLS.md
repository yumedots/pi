# The tools: the port against the original

Tool-by-tool comparison of the built-in tools: the set, the names, the
descriptions, the parameter schemas, the output contracts, the error texts and
the token cost of the declarations the model reads on every request.

- Original: `/Users/gabriel/pi`, branch `perf/lightweight-harness`
  - `packages/coding-agent/src/core/tools/{read,bash,edit,write,grep,find,ls,powershell}.ts`
  - `packages/coding-agent/src/core/tools/index.ts` — the registry
  - `packages/coding-agent/src/core/system-prompt.ts` — the prompt the tool set
    feeds
- Port: `/Users/gabriel/pi-native`, branch `feat/rpi-native`
  - `rpi/crates/rpi-tools/src/tools/{read,bash,edit,write,grep,find,ls,powershell}.rs`
  - `rpi/crates/rpi-cli/src/session.rs` — the registry and the prompt

**Method.** The original's declarations are dumped from its own source with
`bun` (`scripts/parity/tools-tokens.mjs`); the port's are dumped from its own
build (`cargo run --example tool_declarations -p rpi-tools`). The two are
compared field by field — name, label, description, parameter schema, prompt
snippet, prompt guidelines — and the tokens come from the tokenizer of the
model itself (the llama.cpp `/tokenize` endpoint, the one `bench/tokens/`
uses). The port's declarations are pinned by
`rpi/crates/rpi-tools/tests/tool_declarations.rs` (one test per tool).

**Run it:** `node scripts/parity/tools-tokens.mjs`

---

## The summary

| | original | port |
|---|---|---|
| tools registered | 8 | 8 |
| tools active by default | 4 (`read`, `bash`, `edit`, `write`) | 4 (`read`, `bash`, `edit`, `write`) |
| declarations identical | — | **8 of 8** |
| declaration tokens, all eight | **1270** | **1270** (0) |
| declaration tokens, the default loadout | **635** | **635** (0) |
| wire tokens, all eight | **1450** | **1450** (0) |
| wire tokens, the default loadout | **748** | **748** (0) |
| the system prompt (no project context) | **677** | 687 (+10) |
| the request's fixed cost (prompt + the default loadout's declarations) | **1425** | **1435** (+10) |

**The port's tool declarations cost exactly what the original's cost: not one
token more.** The same is true of the wire payload: the port applies the
original's strict JSON-schema transform, so the tool the model reads is the
same tool the original's model reads, byte for byte.

The prompt is where the port differs, and it is 10 tokens *longer*, not
shorter: §4 lists what each side has, item by item, with the token cost of
each. The 1664-versus-3584 gap is the project context, not the tools.

### What changed, and what the user sees

| change | what the model reads now | what the user sees |
|---|---|---|
| `bash`'s description is the original's | "Execute a bash command in the current working directory. …" instead of the port's longer "…using Bash/POSIX syntax, even on Windows. PowerShell cmdlets … are not valid here…" | the model is told the same thing the original tells it; the port keeps its Windows/POSIX guidance in the system prompt, where the original keeps its own shell rule |
| `edit`'s description is the original's | the port's extra "Before editing, use read to inspect the current target region and copy oldText from that output…" is gone | the model plans the edit the way the original's model does; the port's advice to re-read the file on a failed match is gone with it |
| `grep`/`find` say "Respects .gitignore." | and now they do: the ignore files of the repository are applied while walking | a search no longer returns matches from `node_modules/`, `dist/` or any other ignored path; the original's `rg`/`fd` never did either |
| every parameter schema is the original's | the port's used to carry `schemars`' `$schema`, `title` and `integer` types; it now carries the original's typebox shape (`number`, no `$schema`, no `title`) | the model reads the same schema the original's model reads, and the declarations the port sends are smaller than the ones it sent |
| `ls` says "with '/' suffix" | the original's wording (the port had "with a '/' suffix") | wording only |
| `powershell` is registered on every platform | the original registers it everywhere and fails at execution off Windows; the port used to leave it out of the registry off Windows | `rpi --tools powershell` on macOS now finds the tool and reports "The powershell tool is only available on Windows." instead of silently enabling nothing |
| `edit`'s error for a missing file | "Could not edit file: `x`. Error code: ENOENT." instead of the port's `not_found: …` | the model reads the same failure the original's model reads |
| the `openai-completions` provider sends the strict schema | the tool the model reads now has every property required, the optional ones nullable and `additionalProperties: false` — the original's shape | the model sees the same tool the original's model sees; the port's wire payload is now the same size (748 tokens on the default loadout, was 667) |
| the prompt no longer names a "todo tool" | the rule reads "Track multi-step work with a short list in your replies instead of re-listing the plan in prose" | the model is no longer told to call a tool that is not in the registry |

---

## 1. The set

### The registry

The original registers eight tool definitions every session
(`packages/coding-agent/src/core/tools/index.ts:182-193`,
`createAllToolDefinitions`): `read`, `bash`, `powershell`, `edit`, `write`,
`grep`, `find`, `ls`. The port registers the same eight
(`rpi/crates/rpi-cli/src/session.rs:2138-2175`, `build_tools`), and the test
`the_default_tool_set_is_pis` pins the count at eight and the names.

`powershell` used to be registered only on Windows (`#[cfg(target_os =
"windows")]`). The original registers it everywhere and fails at execution
time off Windows (`packages/coding-agent/src/utils/shell.ts:125-135`: "The
powershell tool is only available on Windows."). The port now does the same.

### The active set — what the model is offered

| | original | port |
|---|---|---|
| default | `read`, `bash`, `edit`, `write` (`settings-manager.ts:85`, `DEFAULT_TOOL_NAMES`) | the same four (`session.rs`, `DEFAULT_ACTIVE_TOOL_NAMES`) |
| allow list | `--tools` / `defaultTools` / `setActiveTools()` (`sdk.ts:279-294`) | the same (`--tools`, `defaultTools`, `setActiveTools` over RPC and the JS bridge) |
| deny list | `--exclude-tools` | the same |
| hidden tools | `exposure: "hidden"` drops a tool from the declaration | no hidden exposure |

### The read-only mode

There is none in either tree. The original's `createReadOnlyToolDefinitions`
and `createCodingToolDefinitions` (`tools/index.ts:164-180`) have **no
callers** — the only factory the session uses is `createAllToolDefinitions`.
The "read-only" tool set in the original is an *example* extension
(`packages/coding-agent/examples/extensions/plan-mode/index.ts:22-25`), and the
port has no equivalent. Neither tree has a per-mode filter: the filtering is
by name, on both sides.

### The extension-registered tools

The original's `codemode` and `tool_search` are **extensions**, not built-ins
(`packages/coding-agent/src/extensions/index.ts:7-14`); they register
themselves inactive (`defaultActive: false`), so they never reach the model
unless they are named. The port ships neither, and the reason is on the list
(`scripts/parity/SIGN-OFF.md` §12). They are out of scope here: they are the
original's extensions, not its tool set, and they are not active by default
either way.

---

## 2. The table

One row per tool. "identical" means byte for byte: the same name, the same
description, the same parameter schema, the same required flags, the same
types, the same prompt snippet and the same prompt guidelines.

| tool | original: name | port: name | original: description | port: description | original: schema | port: schema | tokens (decl. original / port) | tokens (wire original / port) | verdict |
|---|---|---|---|---|---|---|---|---|---|
| `read` | `read` | `read` | identical | identical | identical | identical | 166 / 166 | 209 / 209 | **identical** |
| `bash` | `bash` | `bash` | identical | identical | identical | identical | 120 / 120 | 151 / 151 | **identical** |
| `edit` | `edit` | `edit` | identical | identical | identical | identical | 256 / 256 | 278 / 278 | **identical** |
| `write` | `write` | `write` | identical | identical | identical | identical | 93 / 93 | 110 / 110 | **identical** |
| `grep` | `grep` | `grep` | identical | identical | identical | identical | 254 / 254 | 266 / 266 | **identical** |
| `find` | `find` | `find` | identical | identical | identical | identical | 156 / 156 | 168 / 168 | **identical** |
| `ls` | `ls` | `ls` | identical | identical | identical | identical | 104 / 104 | 116 / 116 | **identical** |
| `powershell` | `powershell` | `powershell` | identical | identical | identical | identical | 121 / 121 | 152 / 152 | **identical** |

**8 of 8 identical. 0 tokens of difference, in the declarations and on the
wire.**

The declaration tokens are `{name, description, parameters}` — what the model
reads. The wire tokens are the whole `tools[]` entry the provider request
carries, which is where the original's strict transform shows up (§5).

### The declarations, side by side

Every text below is the same on both sides, byte for byte.

#### `read`

```
Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.
```

```json
{"type":"object","required":["path"],"properties":{"path":{"type":"string","description":"Path to the file to read (relative or absolute)"},"offset":{"type":"number","description":"Line number to start reading from (1-indexed)"},"limit":{"type":"number","description":"Maximum number of lines to read"}}}
```

Prompt snippet `Read file contents`, guideline `Use read to examine files
instead of cat or sed.`

#### `bash`

```
Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.
```

```json
{"type":"object","required":["command"],"properties":{"command":{"type":"string","description":"Shell command to execute"},"timeout":{"type":"number","description":"Timeout in seconds (optional, no default timeout)"}}}
```

Prompt snippet `Execute bash commands (ls, grep, find, etc.)`, guideline `You
can inspect PI_* environment variables for current model and session details.`

#### `edit`

```
Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.
```

```json
{"type":"object","required":["path","edits"],"properties":{"path":{"type":"string","description":"Path to the file to edit (relative or absolute)"},"edits":{"type":"array","items":{"type":"object","required":["oldText","newText"],"properties":{"oldText":{"type":"string","description":"Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call."},"newText":{"type":"string","description":"Replacement text for this targeted edit."}}},"description":"One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead."}}}
```

Prompt snippet `Make precise file edits with exact text replacement, including
multiple disjoint edits in one call` and the original's four edit rules.

#### `write`

```
Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.
```

```json
{"type":"object","required":["path","content"],"properties":{"path":{"type":"string","description":"Path to the file to write (relative or absolute)"},"content":{"type":"string","description":"Content to write to the file"}}}
```

Prompt snippet `Create or overwrite files`, guideline `Use write only for new
files or complete rewrites.`

#### `grep`

```
Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to 100 matches or 50KB (whichever is hit first). Long lines are truncated to 500 chars.
```

```json
{"type":"object","required":["pattern"],"properties":{"pattern":{"type":"string","description":"Search pattern (regex or literal string)"},"path":{"type":"string","description":"Directory or file to search (default: current directory)"},"glob":{"type":"string","description":"Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'"},"ignoreCase":{"type":"boolean","description":"Case-insensitive search (default: false)"},"literal":{"type":"boolean","description":"Treat pattern as literal string instead of regex (default: false)"},"context":{"type":"number","description":"Number of lines to show before and after each match (default: 0)"},"limit":{"type":"number","description":"Maximum number of matches to return (default: 100)"}}}
```

Prompt snippet `Search file contents for patterns (respects .gitignore)`, no
guidelines.

#### `find`

```
Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to 1000 results or 50KB (whichever is hit first).
```

```json
{"type":"object","required":["pattern"],"properties":{"pattern":{"type":"string","description":"Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'"},"path":{"type":"string","description":"Directory to search in (default: current directory)"},"limit":{"type":"number","description":"Maximum number of results (default: 1000)"}}}
```

Prompt snippet `Find files by glob pattern (respects .gitignore)`, no
guidelines.

#### `ls`

```
List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to 500 entries or 50KB (whichever is hit first).
```

```json
{"type":"object","properties":{"path":{"type":"string","description":"Directory to list (default: current directory)"},"limit":{"type":"number","description":"Maximum number of entries to return (default: 500)"}}}
```

Prompt snippet `List directory contents`, no guidelines.

#### `powershell`

```
Execute a PowerShell command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.
```

```json
{"type":"object","required":["command"],"properties":{"command":{"type":"string","description":"Shell command to execute"},"timeout":{"type":"number","description":"Timeout in seconds (optional, no default timeout)"}}}
```

Prompt snippet `Execute PowerShell commands`, guideline `You can inspect PI_*
environment variables for current model and session details.`

---

## 3. The behaviour

The shape of a tool is only half of it: the text the tool puts in front of the
model is the other half. Here the two sides, tool by tool.

### `read`

| | original | port |
|---|---|---|
| text file | the file's text | the same |
| truncation | `[Showing lines {from}-{to} of {total}. Use offset={next} to continue.]`, `[… ({size} limit). Use offset={next} to continue.]`, `[{n} more lines in file. Use offset={next} to continue.]` | the same three notices |
| a line over the byte cap | `[Line {n} is {size}, exceeds {size} limit. Use bash: sed -n '{n}p' {path} | head -c {bytes}]` | the same |
| offset past the end | `Offset {n} is beyond end of file ({total} lines total)` | the same |
| image | `Read image file [{mime}]` + the image block | the same |

One runtime difference under the schema: the original's `offset`, `limit` and
`context` parameters are JSON **numbers**, and it truncates a fractional one
(`offset: 1.5` reads from line 1). The port's decoder wants whole numbers and
rejects `1.5` with a validation error. The schema says `number` on both
sides, and a model sends whole numbers; the port is stricter where the
original is lenient.

### `bash`

| | original | port |
|---|---|---|
| empty output | `(no output)` | the same |
| a non-zero exit | the output, then `Command exited with code {n}` (a soft failure: the result is flagged, the details survive) | the same |
| truncation | `[Showing lines {from}-{to} of {total}. Full output: {path}]`, the same with the byte cap, and `[Showing last {size} of line {n} (line is {size}). Full output: {path}]` for a partial last line | the same three notices |
| a timeout | `Command timed out after {n} seconds` | the same |
| an abort | `Command aborted` | the same |
| no exit code | `Command terminated without an exit code` | the same |
| **a default timeout** | none — the command runs until it ends | **120 s** (`RPI_BASH_TIMEOUT` overrides it) |

The default timeout is the one deliberate difference. The port kills a command
that runs for two minutes; the original lets it run. It is there because a
model that forgets the `timeout` parameter used to hang the run forever
(`rpi/crates/rpi-cli/src/session.rs`, `bash_options`).

### `edit`

| | original | port |
|---|---|---|
| success | `Successfully replaced {n} block(s) in {path}.` | the same |
| no edits | `Edit tool input is invalid. edits must contain at least one replacement.` | the same |
| a missing file | `Could not edit file: {path}. Error code: ENOENT.` | the same (the port used to say `not_found: …`) |
| a path that is not a file | the file system speaks: `EISDIR: illegal operation on a directory, read` | `Could not edit file: {path}. Error code: EISDIR.` |
| matching | exact, then the same fuzzy fallback (trailing whitespace, smart quotes, dashes, unicode spaces) | the same |

### `write`

`Successfully wrote to {path}` on both sides. The parent directories are
created on both sides.

### `grep`

| | original | port |
|---|---|---|
| a match | `{path}:{line}: {text}` | the same |
| a context line | `{path}-{line}- {text}` | the same |
| no match | `No matches found` | the same |
| the match cap | `{n} matches limit reached. Use limit={2n} for more, or refine pattern` | the same |
| a long line | `Some lines truncated to 500 chars. Use read tool to see full lines` | the same |
| the byte cap | `{size} limit reached` | the same |
| **the ignore files** | `rg` applies the repository's `.gitignore` | **now the same** (`rpi/crates/rpi-tools/src/tools/gitignore.rs`) |
| the walk | `rg`'s order | a sorted breadth-first walk — the *order* of the matches can differ |

### `find`

| | original | port |
|---|---|---|
| a hit | the path relative to the search directory, a directory with a trailing `/` | the same |
| no hit | `No files found matching pattern` | the same |
| the result cap | `{n} results limit reached. Use limit={2n} for more, or refine pattern` | the same |
| the byte cap | `{size} limit reached` | the same |
| **the ignore files** | `fd` applies the repository's `.gitignore` | **now the same** |
| the walk | `fd`'s order | a sorted breadth-first walk — the order can differ |

### `ls`

| | original | port |
|---|---|---|
| an empty directory | `(empty directory)` | the same |
| an entry | the name, a directory with a trailing `/`, sorted case-insensitively | the same |
| the entry cap | `{n} entries limit reached. Use limit={2n} for more` | the same |
| the byte cap | `{size} limit reached` | the same |
| a missing path | `Path not found: {path}` | the same |
| a file | `Not a directory: {path}` | the same |

### `powershell`

The same description and the same schema as `bash`. It fails off Windows with
the original's text: `The powershell tool is only available on Windows.`

### The error vocabulary

The original surfaces Node's file-system errors (`ENOENT: no such file or
directory, access '/x'`). The port has its own error type with stable codes
(`rpi/crates/rpi-tools/src/error.rs`) and its own display
(`not_found: … (path: /x)`). The tools that write their own message — `edit`,
`ls`, `find`, `grep` — now use the original's wording. The tools that let the
file system speak (`read`, `write`) still use the port's vocabulary. That is
the one place where the text the model reads is not the original's.

---

## 4. The system prompt

The original's prompt is built from the active tool set
(`packages/coding-agent/src/core/system-prompt.ts:165-219`): the tool list
comes from each tool's `promptSnippet`, the rules from each tool's
`promptGuidelines`. The port does the same
(`rpi/crates/rpi-cli/src/session.rs`, `default_system_prompt`): the prompt
lists the tools that are active and the rules those tools contribute. The
tool-driven part of the prompt is therefore identical — the same four tools,
the same one-line descriptions, the same seven rules.

### What each side sends, in tokens

The original's prompt, section by section, and the port's, for the same
conversation (the default loadout, no project context, no skills):

| part | original | port |
|---|---|---|
| the preamble | 33 | — |
| the tool list | 85 | — |
| the rules | 193 | — |
| the documentation section | 346 | — |
| the working directory | 12 | — |
| **the whole prompt** | **677** | **687** |
| the tool declarations | 748 | 748 |
| **the request's fixed cost** | **1425** | **1435** |

The port's prompt is 10 tokens **longer** than the original's. The 1664
against 3584 is not the prompt's text: the original's 3584 tokens are
measured with the project context in the prompt (`bench/tokens/results.json`),
and the context is the largest part of it. With the same context on both
sides the two prompts are the same size to within ten tokens.

### What the original has that the port does not

| item | tokens | does the model need it? |
|---|---|---|
| the `<docs>` section: where the original's documentation, its examples and the file to read for each topic live | 346 | **yes, for the original's own features.** A model that is asked "how do I write an extension in pi?" is told where the answer is; the port's model is told to "consult the project documentation before guessing" (26 tokens) and has no path. The port's documentation lives in the same place (`rpi/crates/rpi-cli/embedded-docs/`), so the section is a port defect: it should carry the port's own paths. |
| the section tags (`<tools>`, `<rules>`, `<docs>`, `<cwd>`) | 12 | no. They tell the model which part of the prompt is which; the port's headings (`Available tools:`, `Guidelines:`) say the same in prose. |
| **total** | **358** | |

### What the port has that the original does not

| item | tokens | why it is there |
|---|---|---|
| the working-state rule (keep the plan in the visible replies, the reasoning does not survive the turn) | 99 | the port's own fix for the re-plan symptom (`docs/llm-repetition-forensics.md`) |
| the language rule (reply in the user's language) | 83 | the port's own rule; the original has no language rule |
| the POSIX/bash rule (Bash even on Windows) | 57 | the port runs Bash on Windows; the original's shell rule does not say so |
| the short-list rule (track the steps in the replies) | 57 | the port's own rule; it used to name a "todo tool" that is not registered — the words are gone now |
| `Read only what you need` | 31 | the port's own rule |
| `consult the project documentation before guessing` | 26 | the port's stand-in for the original's `<docs>` section |
| `Prefer the smallest change that solves the problem` | 10 | the port's own rule |
| **total** | **363** | |

So: the port trades the original's 346-token documentation section for 363
tokens of its own rules, and every rule it adds is about the model's working
habits, not about the tools. **Nothing the model needs to use the tools is
missing** — the tool list, the per-tool rules, the two shared rules and the
working directory are all there, in the original's words.

### The one defect this comparison found in the prompt

The port's prompt told the model to "Track multi-step work with **the todo
tool** instead of re-listing the plan in prose". There is no `todo` tool in
the port's registry — the TUI renders one when an extension registers it,
but the built-in set has none — and the original's prompt names no such tool
either (a grep of pi's `packages/coding-agent/src/core/tools/` and
`system-prompt.ts` for "todo" finds nothing; pi's registry is the eight tools
above). A model that follows the rule calls a tool that is not there. The
words are gone; the rule now reads "Track multi-step work with a short list
in your replies instead of re-listing the plan in prose". The test in
`rpi/crates/rpi-cli/src/session.rs` now pins that the prompt must not name a
tool the registry does not have.

---

## 5. The strict transform: applied, and now matching

On the `openai-completions` path the original sends the **strict** version of
the schema when the provider supports strict mode — which is the default
(`packages/ai/src/api/constrained-sampling.ts:142-144`,
`resolveJsonSchemaStrictSampling`). The transform
(`constrained-sampling.ts:96-124`) makes every property required, wraps the
optional ones in `anyOf: [{…}, {type: "null"}]` and adds
`additionalProperties: false`:

```json
{"type":"object","required":["path","offset","limit"],"additionalProperties":false,"properties":{"path":{"type":"string","description":"Path to the file to read (relative or absolute)"},"offset":{"anyOf":[{"type":"number","description":"Line number to start reading from (1-indexed)"},{"type":"null"}]},"limit":{"anyOf":[{"type":"number","description":"Maximum number of lines to read"},{"type":"null"}]}}}
```

The port used to send the plain schema on that path — the tool the model
read was a different tool from the one the original's model read, 81 tokens
cheaper on the default loadout. It now applies the same transform, with the
same rule for when to apply it (`compat.supportsStrictMode !== false`: on
unless the provider says otherwise), and the `strict` field on the function
object (`packages/ai/src/api/openai-completions.ts:1487-1516`):

- `rpi/crates/rpi-ai/src/providers/openai_completions.rs` — `build_request`
  computes `strict_tool_parameters(tool)` (`rpi-ai`'s `strict_schema`, the
  port of the original's `makeStrictJsonSchema`), uses the transformed schema
  as `parameters` and writes `strict: true|false`;
- a tool that did not opt into the JSON-schema constrained sampling keeps the
  plain schema and gets `strict: false` — the original's behaviour.

The `openai-responses` path now follows the same rule
(`rpi/crates/rpi-ai/src/providers/openai_responses.rs`): pi's
`convertResponsesTools` writes the `strict` field whenever the provider
supports strict mode — `true` for a tool that opted in, `false` for one that
did not — and its default is on (`supportsStrictMode ?? true`). The port's
default was off; it is now the original's.

**The wire payloads now match byte for byte**: 748 tokens on the default
loadout on both sides, 1450 on all eight.

**The assumption behind the wire column:** the original sends the strict
schema when the provider supports strict mode, which is its default — a model
that declares `supportsStrictMode: false` gets the plain schema, and then the
two wire payloads are identical. The measurement in this file is the default
case.

---

## 6. The checks

| what | where |
|---|---|
| every tool's name, description and parameter schema, against the original's text | `rpi/crates/rpi-tools/tests/tool_declarations.rs` — one test per tool |
| the `.gitignore` handling of `grep` and `find` | `rpi/crates/rpi-tools/tests/gitignore_respected.rs` |
| the `.gitignore` rules themselves | `rpi/crates/rpi-tools/src/tools/gitignore.rs` — unit tests |
| the registered set (eight) and the active set (four) | `rpi/crates/rpi-cli/src/session.rs` — `the_default_tool_set_is_pis`, `the_default_active_tool_set_is_pis_four` |
| the tool result contract (the `isError` flag, `structuredContent`, the prompt contributions) | `rpi/crates/rpi-tools/tests/tool_result_contract.rs` |
| the strict transform on the `openai-completions` path (every property required, the optional ones nullable, `additionalProperties: false`) | `rpi/crates/rpi-ai/src/providers/openai_completions.rs` — `the_tool_schema_is_sent_in_the_strict_form_the_original_sends`, `a_tool_without_constrained_sampling_keeps_the_plain_schema` |
| the comparison and the token count | `node scripts/parity/tools-tokens.mjs` |
