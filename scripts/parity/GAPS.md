# GAPS — what the Rust port still lacks

**This file supersedes `scripts/parity/FEATURES.md` as the inventory of record.**
`FEATURES.md` was a 147-row snapshot of the TUI taken before the port gained its
mouse layer, its settings menu, its session picker keys, its `/skills` `/bug`
`/stats` commands and the built-in `/mcp` command; several of its rows are now
wrong. It is kept for the history, not for the truth. The truth is here.

- Original (read only): `/Users/gabriel/pi`, branch `perf/lightweight-harness`.
- Port: `/Users/gabriel/pi-native`, branch `feat/rpi-native`.

**Path convention.** Original paths are relative to `/Users/gabriel/pi`
(`packages/…`). Port paths are relative to `/Users/gabriel/pi-native/rpi/crates/`
(`rpi-cli/…`, `rpi-tui/…`, `rpi-js/…`, `rpi-tools/…`, `rpi-agent/…`,
`rpi-ai/…`, `rpi-harness/…`, `rpi-extensions/…`).

**Status vocabulary.** Every row carries exactly one status:

| status | meaning |
|---|---|
| `porting` | work is in flight; the owner is named in the row |
| `exception` | the user has signed this off as an accepted difference (`SIGN-OFF.md`) |
| `limitation` | a known limitation: the port does not have it and nothing is scheduled |

The counts at the top reconcile with the rows: **total = porting + exception +
limitation**.

**What is *not* in this file.** Anything the two sides already agree on. The
parity harness (`node scripts/parity/run-all.mjs`, 6/6 scenarios byte-identical)
and the screen captures (`scripts/parity/screens/`, 47 screens) are the evidence
for that, and they are not repeated here.

**Snapshot warning.** The port's tree is being edited while this file is
written, so a `file:line` here is a locator, not a guarantee: re-read the file
before you act on a line number, and check whether the finding still
reproduces. The screen captures quoted as evidence were taken against the
binary of 2026-10-21T01:04:43Z and may already be behind the tree.

---

## Summary

| status | count |
|---|---|
| **Total gaps** | **78** |
| `porting` — being ported now | 15 |
| `exception` — signed off by the user | 12 |
| `limitation` — known limitation | 51 |

By area:

| area | gaps | porting | exception | limitation |
|---|---|---|---|---|
| 1. MCP | 5 | 0 | 0 | 5 |
| 2. Slash commands | 12 | 5 | 2 | 5 |
| 3. Settings | 1 | 1 | 0 | 0 |
| 4. Tools | 7 | 0 | 2 | 5 |
| 5. The extension API | 14 | 2 | 1 | 11 |
| 6. Sessions | 18 | 0 | 1 | 17 |
| 7. The interactive mode and the TUI | 14 | 5 | 1 | 8 |
| 8. Providers, models and the catalogue | 6 | 2 | 4 | 0 |
| 9. The port's own additions | 1 | 0 | 1 | 0 |
| **Total** | **87** | **17** | **12** | **58** |

**MCP used to be the largest group by weight (17 rows): it was an entire
feature the port did not have.** The port shipped a `/mcp` command, a
`mcp.register` / `mcp.list` / `mcp.unregister` host operation and a registry of
MCP server *descriptions* — but no client at all. It has one now: the `rpi-mcp`
crate is a JSON-RPC 2.0 client over stdio and streamable HTTP, the port reads
pi's `mcp.json`, connects the servers when the session starts, declares their
tools to the model as `mcp__<server>__<tool>`, offers pi's resource tools, and
`/mcp` opens a manager with the servers, their state and their tools. What is
left is five rows: the OAuth sign-in, the exposure model's codemode half (the
port has no codemode tool), the `mcp_servers` prompt section and the two OAuth
corners of the CLI.

The largest group by row count is sessions (18 rows), but those are refinements
of a feature that does work — the session file, the id, the naming and the
round trip all match. The other big blocks are the interactive mode and the TUI
(15 rows: the mouse, the transcript search, the picker chrome) and the
extension API (14 rows, nine of them event categories that never fire).

The next work can be picked from this list rather than from memory: the
interactive mode's mouse and transcript-search rows (15) → the extension events
(14) → the sessions block (18) → the command behaviours (12) → the settings
rows that are written and never read (9).

---

## 1. MCP — 5 gaps

**What the original has.** `packages/mcp` (the `pi-mcp` package: a JSON-RPC
client with stdio / streamable-HTTP / in-memory transports and a full OAuth
provider), the built-in `mcp` extension
(`packages/coding-agent/src/extensions/mcp/`, 4266 lines: config, runtime,
tools, resources, oauth, the manager UI and the `pi mcp` CLI), the core server
registry (`packages/coding-agent/src/core/mcp-servers.ts`), the host API
(`pi.registerMcpServer` / `pi.unregisterMcpServer` / `pi.getMcpServers`) and the
`mcp_servers` system-prompt section.

**What the port has.** The `rpi-mcp` crate (`rpi/crates/rpi-mcp`): a JSON-RPC
2.0 client over stdio and streamable HTTP, pi's `mcp.json` reader and server
validation, the tool naming (`mcp__<server>__<tool>`), and the resource tools.
`rpi-cli/src/mcp.rs` is the session's MCP client: it reads the agent dir's and
the trusted project's `mcp.json`, connects the servers when the session starts,
declares their tools to the model, and serves the three resource tools.
`rpi-cli/src/interactive_tui/mcp_manager.rs` is the `/mcp` manager, and
`rpi-cli/src/mcp_cli.rs` is the `rpi mcp` CLI. The three host operations
(`mcp.register` / `mcp.list` / `mcp.unregister`) drive the same client, and
`mcp_servers_change` is emitted on registration and on removal. What the port
does not have: the OAuth sign-in, the codemode half of the exposure model (it
has no codemode tool), and the `mcp_servers` system-prompt section.

| # | gap | original | port | what the user sees | status |
|---|---|---|---|---|---|
| MCP-1 | The tool-exposure model (`codemode` / `deferred` / `direct` / `hidden`) and the `mcp__` rules of `--tools` / `--exclude-tools` | `packages/coding-agent/src/core/mcp-servers.ts:52` `McpExposure`, `:234` `getMcpToolExposure`, `:21` `createToolNameMatcher`; the CLI rules `packages/coding-agent/src/cli/args.ts:318-328` | `rpi-mcp/src/config.rs` `McpExposure` + `get_mcp_tool_exposure` + `create_tool_name_matcher`; `rpi-cli/src/session.rs` `tool_name_allowed` (the `mcp__` rule and the `*` patterns) | the port has no codemode tool and no tool_search tool, so a server's `codemode` and `deferred` tools are declared to the model like `direct` ones (`hidden` keeps them out); `--tools 'mcp__radius__*'` and `--exclude-tools 'mcp__*'` behave as in the original | limitation |
| MCP-2 | `/mcp login` / `/mcp logout` and the argument completions | `packages/coding-agent/src/extensions/mcp/index.ts:1264-1286` (the completions), `:1310` login, `:1322` logout | `rpi-cli/src/interactive_tui/mcp_manager.rs` (the manager: reconnect, enable/disable, exposure, the tool list); the sign-in needs the OAuth flow (MCP-3) | `/mcp` opens the manager with the servers, their state, their tools and the actions reconnect, enable/disable and exposure; there is no "Sign in", and `/mcp login <server>` is not a command | limitation |
| MCP-3 | MCP OAuth (discovery, the sign-in flow, the credential store) | `packages/mcp/src/oauth/{discovery,flow,callback,provider}.ts`, `packages/coding-agent/src/extensions/mcp/oauth.ts:558` `signInMcpServer`, the `mcp-auth.json` store | none: the HTTP transport answers 401 with `McpError::AuthRequired` (`rpi-mcp/src/protocol.rs`); there is no credential store | a server that needs a sign-in cannot be used; the manager shows it as "needs sign-in" | limitation |
| MCP-4 | The `rpi mcp` CLI (`login`, `logout`; `list --json`, `add` and `remove` came with the client) | `packages/coding-agent/src/extensions/mcp/cli.ts:185` `runMcpCommand` (`:209` list, `:195` add/remove, `:218` login/logout) | `rpi-cli/src/mcp_cli.rs` (`list [--json]`, `add`, `remove`), dispatched at `rpi-cli/src/app.rs` | `rpi mcp list` prints every server with its state, its transport, its tools and the config errors (`--json` prints them as JSON); `rpi mcp add`/`remove` write the `mcp.json`; `rpi mcp login`/`logout` are not there — they need the OAuth flow (MCP-3) | limitation |
| MCP-5 | The `mcp_servers` system-prompt section | `packages/coding-agent/src/extensions/mcp/index.ts:157` `MCP_SERVERS_SECTION`, written into the prompt at `:1180-1185` | `rpi-cli/src/mcp.rs` `McpManager::servers_section` builds the section, but the port does not write it into the system prompt | the model is never told which servers exist in prose; it sees them through their tool declarations (`mcp__<server>__<tool>`) instead | limitation |

---

## 2. Slash commands — 12 gaps

The port's 26 built-in commands match the original's **one for one** — same
names, same aliases, same descriptions, same argument hints, same order
(original `packages/coding-agent/src/core/slash-commands.ts:21-48`; port
`rpi-cli/src/interactive_tui/commands.rs:740-771`, pinned by the test
`rpi-cli/src/interactive_tui/tests.rs:1739-1822`). The picker shows 29 rows on
both sides. What is left are the behavioural differences and the four commands
the original has and the port does not.

| # | gap | original | port | what the user sees | status |
|---|---|---|---|---|---|
| CMD-1 | `/llama` — the local llama.cpp router | `packages/coding-agent/src/extensions/llama/index.ts:186-187`, the client `packages/coding-agent/src/extensions/llama/client.ts`, the HuggingFace downloader `packages/coding-agent/src/extensions/llama/huggingface.ts` | not published: `rpi-js/js/extension-host.ts:985-987` registers only `mcp` | `/llama` is sent to the model as an ordinary message | `exception` — signed off (`SIGN-OFF.md` §12: no llama.cpp router in the port) |
| CMD-2 | The hidden commands `/debug`, `/arminsayshi`, `/dementedelves` | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3073-3084` (implementations `:6926`, `:6959`, `:6966`) | absent | each is sent to the model as a message | `limitation` |
| CMD-3 | `/export` — the argument is a **path**, the default is HTML | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:6510-6528` (a `.jsonl` argument → JSONL, anything else → HTML; no argument → HTML), the status "Session exported to: `<path>`" | `rpi-cli/src/interactive_tui/commands.rs:338-359` reads the argument as a **format keyword** (`md`/`markdown`/`html`/`jsonl`); anything else prints "Unknown export format: …"; the default is Markdown (`rpi-cli/src/interactive_tui.rs:3953-3956`) | `/export` writes a `.md` file in the port and an `.html` file in the original; `/export my-session.html` writes that file in the original and prints a red error in the port | `limitation` |
| CMD-4 | `/compact <instructions>` | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3060-3065` → `handleCompactCommand(customInstructions)` `:7065` | `rpi-cli/src/interactive_tui/commands.rs:312` drops the argument (`_args`) | `/compact focus on the auth module` silently compacts without the instruction | `limitation` |
| CMD-5 | `/fork` — a picker of the user messages to fork from | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3030-3034` → `showUserMessageSelector` `:5404-5410`; the component `packages/coding-agent/src/modes/interactive/components/user-message-selector.ts:110` | `rpi-cli/src/interactive_tui/commands.rs:372-373` forks the current leaf at once; `rpi-cli/src/interactive_tui/sessions.rs:203-272` `fork_session` with `ForkOptions::default()`, printing "Forked into a new session." | the port's `/fork` behaves like the original's `/clone`; the user cannot choose the branch point | `limitation` |
| CMD-6 | `/trust` — a picker, and the "restart" note | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3040-3044` → `showTrustSelector` `:5221-5245`; the component `packages/coding-agent/src/modes/interactive/components/trust-selector.ts:32`; the status "Saved trust decision: trusted. Restart pi for this to take effect." | `rpi-cli/src/interactive_tui/commands.rs:554-580` takes a text argument (`yes`/`no`/`clear`); a bare `/trust` prints "Usage: /trust [yes|no|clear]" | `/trust` prints a usage note instead of opening the picker, and never says the change needs a restart | `porting` — the interactive mode port (the trust picker and the startup trust prompt) |
| CMD-7 | `/login` — the authentication-method step and the provider's own flow | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:5878-5933` (the two-step "auth type → provider" picker), `:5844-5866` `handleLoginCommand` (a provider ref starts that provider's flow) | `rpi-cli/src/interactive_tui/commands.rs:417-506` treats the argument as an API key and errors "Missing API key for provider 'x'."; the picker goes straight to the provider list | `/login anthropic` opens Anthropic's sign-in in the original and prints an error in the port; the original's "Select authentication method:" screen never appears | `porting` — the provider lead (the OAuth flows) and the login-text work |
| CMD-8 | The provider names and the configured marker in the login list | `packages/coding-agent/src/modes/interactive/components/oauth-selector.ts:49` — display names ("Ant Ling", "Anthropic", "Azure") and the " • not configured" marker `:28` | `rpi-cli/src/interactive_tui/selectors.rs:709` — raw ids ("ant-ling", "azure") and "Not configured · API key / ANTHROPIC_API_KEY" | the login list reads differently from the original's; see `scripts/parity/screens/diffs/login-providers-api-key.diff` | `porting` — the login-text work |
| CMD-9 | The API-key form | `packages/coding-agent/src/modes/interactive/components/login-dialog.ts:12` — a framed "Login · anthropic" panel, the title "Login to Anthropic", the hint "Enter Anthropic API key", the footer "(escape/ctrl+c to cancel, enter to submit)" | `rpi-cli/src/interactive_tui/settings.rs:757-776` — unframed, the title "API key for anthropic", the hint "> Paste API key, then press Enter", the footer "Enter saves to auth.json · Esc cancels"; see `scripts/parity/screens/diffs/login-api-key-entry.diff` | the key prompt looks nothing like the original's | `porting` — the interactive mode port (the `/login` step) |
| CMD-10 | `/name` with no argument | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3020-3025` → `:6658-6663` shows the current session name | `rpi-cli/src/interactive_tui/commands.rs:591-596` prints "Usage: /name <name>" | `/name` shows a usage warning in the port and the session's name in the original | `limitation` |
| CMD-11 | `/theme <name>` — the original's theme names | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3075-3084` → `applyThemeArgument`; the theme list `packages/coding-agent/src/modes/interactive/theme/theme.ts:436-476` (`system`, `dark`, `light` and any user theme file) | `rpi-cli/src/interactive_tui/commands.rs:274-301` accepts only `dark`, `light`, `monochrome`; anything else prints "Unknown theme \"system\". Valid: dark, light, monochrome." | `/theme system` works in the original and is an error in the port | `porting` — the theme work |
| CMD-12 | The port's own commands: `/context` and the hidden aliases `/m`, `/think`, `/q`, `/session` | none — the original has no such commands (`packages/coding-agent/src/core/slash-commands.ts:21-48` has 26) | `rpi-cli/src/interactive_tui/commands.rs:687-703` (`/context`, hidden from the picker), `:120-122` (`/m`), `:182-184` (`/think`), `:27-29` (`/q`), `:239-247` (`/session`) | `/m` opens the model selector in the port and is sent to the model in the original; `/context` prints an inventory the original has no command for | `exception` — signed off (`SIGN-OFF.md` §7: the port's own additions are kept) |

---

## 3. Settings — 1 gap

The **row set is complete**: 37 rows on both sides, the same labels in the same
order (original `packages/coding-agent/src/modes/interactive/components/settings-selector.ts:489-764`
plus the splices at `:770-901`; port `rpi-cli/src/interactive_tui/settings_menu.rs:503-908`,
pinned by the `PI_ROWS` test at `:1123-1182`).

The 27 keys that used to be parsed, written and never read back have each been
given a fate. **None of them is dead in the original**: every one has a getter
in `packages/coding-agent/src/core/settings-manager.ts` *and* a consumer outside
the settings menu, so none could be dropped as "the setting does nothing in pi
either". Nineteen are now implemented in the port and eight are on the sign-off
sheet.

### The 27 keys and their fate

| key | fate | what it now does |
|---|---|---|
| `outputPad` | implemented | the horizontal padding of every transcript block; `0` turns it off. The port keeps the value in `rpi-tui/src/output_pad.rs` and the transcript components read it (`rpi-tui/src/user_message.rs:59`, `rpi-tui/src/assistant_message.rs:60`, `rpi-tui/src/tool_execution.rs:125`); the settings menu applies it live (`rpi-cli/src/interactive_tui/settings.rs:210`). |
| `showHardwareCursor` | implemented | the terminal's own cursor instead of pi's drawn one, with pi's `PI_HARDWARE_CURSOR=1` fallback (`rpi-cli/src/settings.rs:761`, `rpi-cli/src/interactive_tui.rs:1399`). |
| `fullscreenScrollbar` | implemented | the fullscreen transcript's scrollbar: `auto`, `always` or `hidden` (`rpi-cli/src/interactive_tui.rs:1616`). |
| `autocompletePosition` | implemented | the completion list is painted above the input or below it (`rpi-cli/src/interactive_tui.rs:2195`). The empty-session screen keeps pi's forced `below`. |
| `treeFilterMode` | implemented | the filter `/tree` opens with (`rpi-cli/src/interactive_tui/selectors.rs:529`, `rpi-cli/src/interactive_tui/state.rs:124`). |
| `externalEditor` | implemented | the command Ctrl+G opens, in pi's order: the setting, then `$VISUAL`, then `$EDITOR`, then `nano`/`notepad` (`rpi-cli/src/settings.rs:851`, `rpi-cli/src/interactive_tui/run.rs:61`). |
| `thinkingBudgets` | implemented | the per-level reasoning token budgets the provider sends (`rpi-cli/src/settings.rs:869`, `rpi-cli/src/session.rs:872`, `rpi-harness/src/types.rs:185`). |
| `projectContextMaxChars` | implemented | the cap on each project-context file in the system prompt; the cut lands on a line boundary and carries pi's omission marker (`rpi-harness/src/context_files.rs:146`). |
| `compaction.modelOverrides` | implemented | the per-model compaction reserve/keep tokens, keyed by `provider/modelId` (`rpi-cli/src/settings.rs:680`, `rpi-harness/src/agent_harness.rs:4761`). |
| `terminal.hyperlinks` | implemented | forces the OSC 8 links on or off (`rpi-cli/src/settings.rs:983`, `rpi-tui/src/markdown.rs:2031`). |
| `terminal.images` | implemented | forces the inline-image protocol (`kitty`, `iterm2`, or off) (`rpi-cli/src/interactive_tui.rs:1193`). |
| `terminal.trueColor` | implemented | forces 24-bit colour instead of the 256-colour palette (`rpi-cli/src/interactive_tui.rs:1203`). |
| `shellPath` | implemented | the shell the bash tool runs (`rpi-cli/src/session.rs:448`). |
| `markdown.codeBlockIndent` | implemented | the prefix every rendered code-block line gets (`rpi-tui/src/markdown.rs:304`, `rpi-cli/src/interactive_tui.rs:1517`). |
| `fullscreenExitOutput` | implemented | on leaving the fullscreen mode, the transcript is printed or only the resume hint is (`rpi-cli/src/interactive_tui.rs:4744`). |
| `fullscreenWheelScrollLines` | implemented | the lines one mouse-wheel event scrolls (`rpi-cli/src/interactive_tui.rs:1494`). |
| `modelThinkingLevels` | implemented | the per-model thinking level, which wins over `defaultThinkingLevel` (`rpi-cli/src/provider.rs:566`, `rpi-cli/src/provider.rs:600`). |
| `retry.maxDelayMs` | implemented | the legacy spelling: it seeds `retry.provider.maxRetryDelayMs` (`rpi-cli/src/settings.rs:648`). |
| `queueMode` | implemented | the legacy spelling: it seeds `steeringMode` (`rpi-cli/src/settings.rs:701`). |
| `websockets` | implemented | the legacy spelling: it seeds `transport` (`rpi-cli/src/settings.rs:723`). |
| `codemode.mode` | signed off | the port has no `codemode` tool, so the mode has nothing to switch (`SIGN-OFF.md` §12, `GAPS.md` TOOL-1). |
| `codemode.inlineBudget` | signed off | the port has no `codemode` tool, so the inline budget has nothing to bound (`SIGN-OFF.md` §12, `GAPS.md` TOOL-1). |
| `branchSummary.reserveTokens` | signed off | the port produces no branch summary, so the budget has nothing to reserve (`GAPS.md` SES-10). |
| `branchSummary.skipPrompt` | signed off | the port has no "Summarize branch?" prompt to skip (`GAPS.md` SES-10). |
| `sessionShareDestination` | signed off | the port's `/share` uploads a gist (`GAPS.md` SES-18). |
| `cacheWarming` | signed off | the port has no cache warmer (`GAPS.md` EXT-7). |
| `websocketConnectTimeoutMs` | signed off | the port has no WebSocket transport (`SIGN-OFF.md` §18). |
| `markdown.mermaid` | signed off | the port renders every mermaid block; the `off` and `final` modes are not implemented (`SIGN-OFF.md` §14). |
| `themes` | signed off | the port has no user-theme loader, so the extra theme directories have nothing to load (`SIGN-OFF.md` §15). |
| `packages` | signed off | the port has no npm/git package installer; its own `packages` registry is a Rust cdylib one (`SIGN-OFF.md` §16). |
| `npmCommand` | signed off | the port never runs npm, so the argv has nothing to configure (`SIGN-OFF.md` §16). |
| `deviceId` | signed off | the port has no ChatGPT OAuth handshake that carries the agent host id (`SIGN-OFF.md` §17). |

### The check

`cargo test -p rpi-cli --lib settings_keys_tests` — the round trip: a
`settings.json` is written, loaded the way the port loads it at startup, and
every implemented key is asserted to carry the value the running port will use.
`cargo test -p rpi-tui --lib` — the transcript padding, the code-block indent
and the hyperlink override. `cargo test -p rpi-harness --lib` — the project
context's line-boundary cut.

### The rows that are still gaps

| # | gap | original | port | what the user sees | status |
|---|---|---|---|---|---|
| SET-1 | The Theme submenu — the original's stepped "automatic / light / dark" editor | `packages/coding-agent/src/modes/interactive/components/settings-selector.ts:350-402` (the "Light theme", "Dark theme", "Apply", "Change mode" rows), `:231-238` (the "automatic" option), the theme list `packages/coding-agent/src/modes/interactive/theme/theme.ts:436-476` | `rpi-cli/src/interactive_tui/settings_menu.rs:882-906` — a flat options list of exactly `dark`, `light`, `monochrome` (`available_theme_names` `:492-495`) | the port cannot pick a separate light and dark theme and cannot follow the terminal; it offers a "monochrome" the original does not have | `porting` — the theme work |

---

## 4. Tools — 9 gaps

The eight core tools match one for one in name, schema and shape (original
`packages/coding-agent/src/core/tools/index.ts:95-105` and `:178-190`; port
`rpi-cli/src/session.rs:2131-2176`, the implementations under `rpi-tools/src/tools/`).
The per-tool renderers cover the same eight (original
`packages/coding-agent/src/core/tools/renderers/index.ts:33-42`; port
`rpi-tui/src/tool_renderers.rs:74-87`).

| # | gap | original | port | what the user sees | status |
|---|---|---|---|---|---|
| TOOL-1 | The `codemode` tool | `packages/coding-agent/src/extensions/codemode/tool.ts:39`, `:78-82`, `:373-384`; registered inactive at `packages/coding-agent/src/extensions/codemode/index.ts:32-49` | absent — the port has only a `codemode` *settings* struct (`rpi-cli/src/settings.rs:206-215`) | the model cannot run JavaScript against the tool surface | `exception` — signed off (`SIGN-OFF.md` §12: the port publishes no name for a feature it lacks) |
| TOOL-2 | The `tool_search` tool | `packages/coding-agent/src/extensions/tool-search/tool.ts:20`, `:159-164`, `:217-226` | absent | the model cannot discover deferred tools | `exception` — signed off (`SIGN-OFF.md` §12) |
| TOOL-3 | The `+name` / `-name` modifiers in `--tools` | `packages/coding-agent/src/core/settings-manager.ts:88-90`, `:108-120`; `packages/coding-agent/src/core/sdk.ts:283-291` | the modifier strings are compared literally as tool names (`rpi-cli/src/session.rs:2199`) | `--tools +codemode` (the original's own documented example) yields an empty tool list; `--tools read,write,-bash` does not remove `bash` | `limitation` |
| TOOL-4 | The validation of the tool list | `packages/coding-agent/src/core/sdk.ts:281`, `packages/coding-agent/src/core/settings-manager.ts:97-104` `getToolListError` (a mixed list, or a patterned modifier, is an error) | no equivalent check in `rpi-cli/src/args.rs` or `rpi-cli/src/session.rs:2195-2205` | a bad list is accepted and silently matches nothing | `limitation` |
| TOOL-5 | The tool-result truncation notices never fire (a key-case mismatch) | the details are camelCase: `packages/coding-agent/src/core/tools/truncate.ts:15-38` (`truncatedBy`, `outputLines`, `totalLines`, `maxBytes`, `maxLines`, `firstLineExceedsLimit`), `bash.ts:66-69` (`fullOutputPath`), `grep.ts:43-47`, `find.ts:43-46`, `ls.ts:25-28` | the Rust structs serialise **snake_case** (no `rename_all`): `rpi-tools/src/truncate.rs:52-67`, `rpi-tools/src/tools/bash.rs:57-62`, `grep.rs:75-84`, `find.rs:58-63`, `ls.rs:52-56` — while the renderers read the camelCase keys: `rpi-tui/src/tool_renderers.rs:1146`, `:1128-1142`, `:840-841`, `:937`, `:1014` | the bash pane never prints "[Full output: /tmp/…]"; the read pane shows "0 of 0"; the grep / find / ls panes lose the "N matches limit" / "N entries limit" half of the notice | `limitation` |
| TOOL-6 | The `PI_*` environment variables for the bash tool | `packages/coding-agent/src/core/tools/bash.ts:190-215` sets `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, `PI_REASONING_LEVEL`, and says so in the prompt guideline `:49` | the port's bash tool carries the same guideline (`rpi-tools/src/tools/bash.rs:157-160`) but never sets the variables — `grep -rn "PI_SESSION_ID" rpi/crates` finds them only in the vendored upstream bundle `rpi-js/js/extension-host.bundle.js:22787-22803` | a `!` or `bash` command that reads `PI_MODEL` sees nothing | `limitation` |
| TOOL-7 | The `bash` timeout default and the `powershell` tool | the original's `bash` has **no** default timeout (`packages/coding-agent/src/core/tools/bash.ts:42`); `powershell` is registered on every platform with the shared output schema and the `PI_*` guideline (`packages/coding-agent/src/core/tools/index.ts:186`, `powershell.ts:18-21`, `:53-56`), and throws "The powershell tool is only available on Windows." off Windows (`packages/coding-agent/src/utils/shell.ts:126-128`) | the port injects a 120 s default (`rpi-cli/src/session.rs:2106-2128`, `rpi-tools/src/tools/bash.rs:84-88`) and registers `powershell` **only on Windows** (`rpi-cli/src/session.rs:2175-2176`), with no output schema and no prompt snippet (`rpi-tools/src/tools/powershell.rs:28-45`) | on macOS and Linux the original still lists a `powershell` tool to the model and the port does not; in the port a `bash` call with no timeout is killed after 120 s | `limitation` |

---

## 5. The extension API — 14 gaps

The host operations, the `ctx` objects and the theme are in place (every
`hostCall` the bundle makes is answered — `rpi/crates/rpi-js/src/host.rs:274`
is the check), and the module surface is pi's own (`rpi-js/js/pi-coding-agent.ts`,
`pi-tui.ts`, `pi-ai.ts`, `pi-agent-core.ts`). What is left are the events that
never fire and the payloads that are empty.

| # | gap | original | port | what the user sees | status |
|---|---|---|---|---|---|
| EXT-1 | 15 of the 41 event categories never fire | the event union `packages/coding-agent/src/core/extensions/types.ts:745-1121` and the emitter sites in `packages/coding-agent/src/core/extensions/runner.ts` | no emitter for any of the 15 in `rpi-cli/src/js_emitter.rs`, `rpi-cli/src/js_extensions.rs` or `rpi-extensions/src/event_sink.rs` | an extension that subscribes to one of them waits forever | `limitation` |
| EXT-2 | …which are: `project_trust` | `packages/coding-agent/src/core/extensions/types.ts:758` (the trust prompt fires it) | no trust prompt exists (`rpi-cli/src/interactive_tui/commands.rs:554-580` writes a note) | the extension never learns the project was trusted | `porting` — the interactive mode port (the trust prompt) |
| EXT-3 | …`session_before_switch`, `session_before_fork`, `session_before_tree`, `session_tree` | `packages/coding-agent/src/core/extensions/types.ts` (the four session-navigation events) | the port switches, forks and navigates the tree without telling the extensions (`rpi-cli/src/interactive_tui/sessions.rs:203-272`) | an extension cannot veto or observe a branch change | `limitation` |
| EXT-4 | …`session_before_compact`, `session_compact`, `session_compact_failed` | `packages/coding-agent/src/core/extensions/types.ts` (the three compaction events) | the port compacts without asking (`rpi-cli/src/interactive_tui/commands.rs:304-312`) | an extension cannot contribute a summary or veto a compaction | `limitation` |
| EXT-5 | …`context` and `context_with_system` — the two that carry a result | `packages/coding-agent/src/core/extensions/types.ts:885` (the `{messages}` result) | the port's provider hook has the messages and an empty `transform_context` slot (`rpi-extensions/src/provider_hooks.rs`) | an extension cannot rewrite the transcript before a call — the biggest of the 15 | `porting` — the extension port (`rpi-extensions/src/event_sink.rs`, `rpi-agent`) |
| EXT-6 | …`resources_discover` | `packages/coding-agent/src/core/extensions/types.ts` | no emitter; the resource dirs are fixed (`rpi-cli/src/resource_dirs.rs`) | an extension cannot contribute resource paths | `limitation` |
| EXT-7 | …`cache_warming_decision` | `packages/coding-agent/src/core/extensions/types.ts` | the port has no cache warmer (`rpi-cli/src/settings.rs` parses `cache-warming-mode` but nothing consumes it — signed off, `GAPS.md` §3) | the extension is never asked whether to warm the cache | `limitation` |
| EXT-8 | …`provider_stream_event` | `packages/coding-agent/src/core/extensions/types.ts` | the port's provider layer publishes no raw stream events (`rpi-extensions/src/provider_hooks.rs`) | an extension cannot observe the raw stream | `limitation` |
| EXT-9 | …`agent_before_settle`, `agent_settled` | `packages/coding-agent/src/core/extensions/types.ts` | the port's harness has no settlement boundary (`rpi-cli/src/js_emitter.rs`) | the extension never sees the settle point | `limitation` |
| EXT-10 | `session_start`'s `reason` is always `startup` | `packages/coding-agent/src/core/extensions/types.ts:758` (`startup`, `resume`, `fork`, `reload`) | `rpi-cli/src/interactive_tui.rs:1706-1707` | the extension cannot tell a resume from a fresh start | `limitation` |
| EXT-11 | `turn_end`'s `entries`, `context` and `messageEntryId` are empty | `packages/coding-agent/src/core/extensions/types.ts:1065` | `rpi-cli/src/js_emitter.rs:146-157` (`"messageEntryId": null`, `"entries": []`, an empty context) | the extension sees a turn with no entries | `limitation` |
| EXT-12 | `after_provider_response` reports `status: 200` and no headers | `packages/coding-agent/src/core/extensions/types.ts:918` | `rpi-extensions/src/provider_hooks.rs:248-254` | an extension that retries on a 429 or reads a rate-limit header sees nothing | `limitation` |
| EXT-13 | The registrations that are stored but never read: `registerShortcut`, `registerMessageRenderer`, `registerEntryRenderer`, `registerMarkdownTransformer`, `registerToolRenderer`, `ui.setEditorComponent`, `ui.onTerminalInput`, `ui.addAutocompleteProvider`, `getFlag` | `packages/coding-agent/src/core/extensions/types.ts:1683-1724` (the registrations), `:278` (`setEditorComponent`), `:163` (`onTerminalInput`), `:243` (`addAutocompleteProvider`), `:1758` (`getFlag`) | `rpi-js/js/extension-host.ts:775` (`registerShortcut`), `:782` (`registerMessageRenderer`), `:785` (`registerMarkdownTransformer`), `:788` (`registerEntryRenderer`), `:791` (`registerToolRenderer`), `:656` (`setEditorComponent`), `:670` (`onTerminalInput`), `:671` (`addAutocompleteProvider`), `:781` (`getFlag` returns the registered default) | a JavaScript extension's custom message renderer, markdown transformer, tool renderer, shortcut, autocomplete provider and flags all go nowhere; only the native-plugin paths are wired | `limitation` |
| EXT-14 | `node:child_process`'s functions throw when called | `packages/coding-agent/src/core/extensions/loader.ts` (the extension runs in Node) | `rpi-js/js/shims/node-child-process.ts` — the module resolves, the functions throw | an extension that shells out fails at the call | `exception` — signed off (`SIGN-OFF.md` §7: the port's own additions and their limits are accepted) |

---

## 6. Sessions — 18 gaps

The session **file** is the original's: version 3, the original's header and
entry types, the original's directory layout and file naming, a uuid v7 session
id, and the round trip works in both directions
(`node scripts/parity/session-compat.mjs`). The gaps are in the picker, in the
tree and in what the port never writes.

| # | gap | original | port | what the user sees | status |
|---|---|---|---|---|---|
| SES-1 | The session picker's scope: "this project" ↔ "all folders" | `packages/coding-agent/src/modes/interactive/components/session-menu.ts:197` (`scope`), `:365-369` (the Tab handler), `:317-320` (the hint); the two lists `packages/coding-agent/src/core/session-manager.ts:1900-1914` (the cwd's dir) and `:1921-1990` (every cwd-encoded dir) | `rpi-cli/src/interactive_tui/selectors.rs:382` lists `crate::session::default_session_dir(cwd)` — the sessions **root** — and `rpi-cli/src/session.rs:2700-2730` walks the root plus one level of subdirectories; there is no scope concept and no Tab key | the port always shows every project's sessions and cannot narrow to the current one | `limitation` |
| SES-2 | The picker chrome: the title, the hint lines and the metadata column | `packages/coding-agent/src/modes/interactive/components/session-menu.ts:195`, the hints `:309-332` ("tab scope: current · re:<pattern> regex · \"phrase\" exact" and "ctrl+s sort · ctrl+n named · ctrl+d delete · ctrl+p path (off) · ctrl+r rename"), the column `:47-60` and `:237-244` ("12  3h" — the message count and the age) | `rpi-cli/src/interactive_tui/selectors.rs:433-434` — the title "Resume session" and the hint "Type to filter sessions"; the column `rpi-cli/src/interactive_tui/selector_keys.rs:341-361` — the file size and an 8-char id ("11KB · 01a15bfb"); see `scripts/parity/screens/diffs/session-menu.diff` | the picker looks different, hides the shortcuts the original advertises, and shows bytes where the original shows the message count and the age | `limitation` |
| SES-3 | The session search's query language is dead code | `packages/coding-agent/src/modes/interactive/components/session-selector-search.ts:36-104` `parseSearchQuery` (the `re:` prefix, the quoted phrases), `:106-155` (the scoring), the search text `:24-27` (id + name + allMessagesText + cwd) | `rpi-cli/src/interactive_tui/session_search.rs:174-238` `parse_search_query`, `:241-313` `match_session_text`, `:327-370` `filter_and_sort` — **no caller outside the file** (`grep -rn "filter_and_sort|parse_search_query|match_session_text" rpi-cli/src` matches only `session_search.rs` itself); the picker filters with the list's plain fuzzy filter over "{label} {stem}" (`rpi-cli/src/interactive_tui/selector_keys.rs:361`) | `re:<pattern>` and `"phrase"` do not work in the picker, and the search never looks at the messages | `limitation` |
| SES-4 | The sort modes | three — `threaded`, `recent`, `relevance` (`packages/coding-agent/src/modes/interactive/components/session-menu.ts:198`, `packages/coding-agent/src/modes/interactive/components/session-selector-search.ts:4`), Ctrl+S cycles all three (`session-menu.ts:371-375`) | two — `Recent` and `Oldest` (`rpi-cli/src/interactive_tui/state.rs:44-50`); Ctrl+S toggles between the two (`rpi-cli/src/interactive_tui/selector_keys.rs:116-125`). The port's own `SortMode` does carry `Threaded`/`Recent`/`Relevance` (`rpi-cli/src/interactive_tui/session_search.rs:19-26`) — but it lives in the unwired module (SES-3) | the port has no threaded sort and no relevance sort, and has an "Oldest" mode the original does not have | `limitation` |
| SES-5 | The threaded session tree in the picker | the forks and clones are indented under their parent (`packages/coding-agent/src/modes/interactive/components/session-menu.ts:69-114`, `:116-141`, `:474-490`) | a flat list (`rpi-cli/src/interactive_tui/selector_keys.rs:304-337`); `SessionMenuEntry` has no parent field (`rpi-cli/src/interactive_tui/state.rs:54-65`), although the port does write `parentSession` into the fork's header (`rpi-cli/src/interactive_tui/sessions.rs:241-243`) | the picker shows a flat list where the original groups a fork under the session it came from | `limitation` |
| SES-6 | The current-session marker and the delete guard | the active session is drawn in the accent colour (`packages/coding-agent/src/modes/interactive/components/session-menu.ts:228`) and cannot be deleted (`:419-427`, "Cannot delete the currently active session") | no current-session concept (`rpi-cli/src/interactive_tui/state.rs:54-65`); `start_delete` has no guard (`rpi-cli/src/interactive_tui/selector_keys.rs:170-182`) | the live session is not marked, and it can be deleted from the picker while the harness still has it open | `limitation` |
| SES-7 | Delete moves the file to the trash | `packages/coding-agent/src/modes/interactive/components/session-menu.ts:152-186` (the `trash` CLI first, `unlink` as the fallback), the footer "Session moved to trash" / "Session deleted" `:436-437` | `std::fs::remove_file` (`rpi-cli/src/interactive_tui/selector_keys.rs:185-214`), the note "Session deleted." (`:196`) | the file is unlinked, not recoverable from the Trash | `limitation` |
| SES-8 | A rename with an empty name clears the name | `packages/coding-agent/src/core/session-manager.ts:1318-1330` (the reader takes the latest `session_info`, including an explicit clear), `packages/coding-agent/src/modes/interactive/interactive-mode.ts:5728-5734` | `rpi-cli/src/interactive_tui/selector_keys.rs:250-253` refuses it — "Session name unchanged." | the user cannot remove a session's name | `limitation` |
| SES-9 | `/fork` and `/clone` are the same command | `/fork` opens the user-message picker and forks **before** the picked message (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:3037-3041` → `:5406-5439`, `packages/coding-agent/src/core/agent-session-runtime.ts:262-330`, "Forked to new session"); `/clone` forks **at** the leaf (`:3042-3046` → `:5442-5460`, "Cloned to new session") | both send the same `TuiMessage::ForkSession` (`rpi-cli/src/interactive_tui/commands.rs:365-375` and `:380-391`) → `fork_session` (`rpi-cli/src/interactive_tui/sessions.rs:203-282`) with `ForkOptions::default()` (`rpi-harness/src/session/types.rs:1587-1594`), the note "Forked into a new session." | there is no branch-point picker and no way to tell the two apart (see CMD-5) | `limitation` |
| SES-10 | No branch summary is ever produced | "Summarize branch?" → `navigateTree(entryId, {summarize})` → `branchWithSummary` appends a `branch_summary` entry with `fromId`, `summary`, `details` and `usage` (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:5484-5560`, `packages/coding-agent/src/core/agent-session.ts:4175-4180`, `packages/coding-agent/src/core/session-manager.ts:1600-1629`) | `lane.navigate_tree(Some(&id), false, None, None)` — `summarize` is hard-coded **false** (`rpi-cli/src/interactive_tui.rs:3831`); the harness ignores it (`rpi-harness/src/agent_harness.rs:4856-4860`) and returns `summary_entry: None` (`:4870-4875`) | the branch summary is never asked for and never written | `limitation` |
| SES-11 | The branch-summary card is only drawn when a session is restored | `packages/coding-agent/src/modes/interactive/components/branch-summary-message.ts:38-77`, rendered live at `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3767-3774` | `BranchSummaryCard` is a faithful port (`rpi-tui/src/summary_cards.rs:128-133`, `:141-165`) but is rendered only in `render_session_history` (`rpi-cli/src/interactive_tui/sessions.rs:445`) | because no branch summary is ever written (SES-10), the card only ever appears when the port opens a file that already contains one | `limitation` |
| SES-12 | A live compaction prints a note instead of the card | `packages/coding-agent/src/modes/interactive/components/compaction-summary-message.ts:37-77` ("Compacted from N tokens"), rendered live at `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3755-3765` | `CompactionSummaryCard` is a faithful port (`rpi-tui/src/summary_cards.rs:135-140`, `:99-113`) but is only rendered on restore (`rpi-cli/src/interactive_tui/sessions.rs:435`); a live `/compact` prints "Conversation compacted." (`rpi-cli/src/interactive_tui/run.rs:285`) | the user cannot expand the compaction summary in place | `limitation` |
| SES-13 | The tree rows carry no message content | `packages/coding-agent/src/modes/interactive/components/tree-selector.ts:774-855` — "user: <text>", "assistant: <text>", "[tool]", "[bash]: <cmd>", "[compaction: Nk tokens]", "[branch summary]: …", "[model: …]" | the row label is only "<entry_type> #<seq>" with the 12-char id as the description (`rpi-cli/src/interactive_tui/selectors.rs:492-497`) | the user cannot tell which message a tree row is | `limitation` |
| SES-14 | The tree is a flat list, not a tree | `packages/coding-agent/src/modes/interactive/components/tree-selector.ts` — the hierarchy `:107-124` and `:201-330`, the folding `:1003-1020`, the filter modes `:331-436` and `:648-700`, the labels `:1271-1327`, the label timestamps `:863-886`, the copy `:905-931` | `rpi-cli/src/interactive_tui/selectors.rs:463-533` — one flat row per entry; the filters (`rpi-cli/src/interactive_tui/state.rs:88-122`), the label editing (`rpi-cli/src/interactive_tui/selector_keys.rs:395-410`) and the label timestamps do exist | `/tree` shows a flat list with no branches and no indentation where the original shows a navigable tree | `limitation` |
| SES-15 | `/stats` shows no session id and no file path | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:6700-6708` — "ID: <sessionId>", "File: <sessionFile>", "Name: <name>" | `rpi-cli/src/interactive_tui.rs:4299-4322` — the lane, the leaf id, the message count, the tokens and the cost; no uuid, no path | the user cannot copy the session's id from `/stats`; it is visible only as an 8-char prefix in the picker row (`rpi-cli/src/interactive_tui/selector_keys.rs:352`) | `limitation` |
| SES-16 | `-c` / `--continue` can resume another project's session | the most recent session **in the current project's dir**, filtered by the header's cwd (`packages/coding-agent/src/core/session-manager.ts:749-766`, used at `:1795-1799`) | `SessionSelection::Latest` → `list_session_metadata_in_dir` with `cwd: None` (`rpi-cli/src/session.rs:2302`, `:2443-2462`) → `rpi-harness/src/session/jsonl/repo.rs:447-495` → newest-first across every project (`:497-535`) | `rpi -c` can open a session belonging to a different project | `limitation` |
| SES-17 | No v1 → v2 → v3 migration | `packages/coding-agent/src/core/session-manager.ts:288-313` and `:316-328`, applied on load `:338-347`, rewritten in place `:1100-1102` | version 3 is hard-coded (`rpi-harness/src/session/jsonl/types.rs:38-49`, `rpi-harness/src/session/jsonl/codec.rs:63-68`); an unknown entry type is hard corruption (`rpi-harness/src/session/jsonl/codec.rs:139-142`, `rpi-harness/src/session/jsonl/storage.rs:773-800`) | an old session file with an entry type the port does not know fails to open | `limitation` |
| SES-18 | The session share: Radius first, then a private gist of the HTML | `packages/coding-agent/src/modes/interactive/session-share.ts:24-53` (the JSONL plus a trailing `pi.share` entry), `:69-78` (the `sessionShareDestination` setting), `:88-101` (the HTML for the gist), `:106-160` (the Radius upload), `:181-186` (the viewer URL) | `rpi-cli/src/interactive_tui/sessions.rs:8-89` — a Markdown transcript piped to `gh gist create --filename session.md -`, falling back to the clipboard; the `sessionShareDestination` setting (`rpi-cli/src/settings.rs:287`) is never consulted | the share goes to a gist with the Markdown, not to Radius and not as a private HTML gist | `exception` — signed off (`SIGN-OFF.md` §5: drop the session share; it publishes to pi's deployment service) |

---

## 7. The interactive mode and the TUI — 15 gaps

The framework, the editor, the markdown renderer, the tool panels, the loaders,
the pickers and the footer have landed: the harness's six scenarios are
byte-identical and 14 of the 47 screen captures match. The gaps below are the
rest.

| # | gap | original | port | what the user sees | status |
|---|---|---|---|---|---|
| TUI-1 | The mouse affordances in the transcript | `packages/coding-agent/src/modes/interactive/components/tool-execution.ts:163-170` (a click toggles the tool output), `packages/coding-agent/src/modes/interactive/components/assistant-message.ts:203-211` (a click toggles the thinking run), `packages/coding-agent/src/modes/interactive/components/skill-invocation-message.ts:149-165` (a click toggles the skill card), `packages/coding-agent/src/modes/interactive/components/centered.ts:33-42` (the clicks are forwarded) | `rpi-tui/src/mouse.rs:67` `MouseRegion` exists but **no `rpi-cli` file uses it**; `rpi-tui/src/tool_execution.rs` has no `handle_mouse`; `rpi-tui/src/assistant_message.rs:478` `toggle_thinking_run` has only a test caller; `rpi-tui/src/empty_session.rs:39-56` does not forward clicks | clicking a tool row does not expand it, clicking a thinking summary does not reveal it, clicking the skill card does not toggle it, and clicking the input on the empty-session screen does not focus the editor | `porting` — the interactive mode port (the easter egg's click target) |
| TUI-2 | Clicking a link does nothing | `packages/tui/src/tui-alt-screen.ts:1425-1433` (a press and a release open the URL), the wiring `:1394-1408` | `rpi-tui/src/tui_alt_screen.rs:1359` `set_url_opener` has no caller in `rpi-cli` | an OSC 8 link in the transcript is inert | `limitation` |
| TUI-3 | The transcript has no scrollbar | `packages/tui/src/tui-alt-screen.ts:1117` (the track and the thumb), `packages/tui/src/layout.ts` `getScrollbarGeometry` (the dragging) | `rpi-cli/src/interactive_tui.rs:1370` hard-codes `scrollbar: ScrollbarMode::Hidden`; where a scrollbar *is* shown (`rpi-cli/src/interactive_tui/side_questions.rs:64`) the port paints a thumb with no track (`rpi-tui/src/scroll_view.rs:461-486`) and `scrollbar_hide_delay_ms` (`:61-62`) is never read | there is nothing to drag, and the transcript gives no scroll position | `porting` — the scrollbar work (`fullscreenScrollbar` is implemented; the scrollbar itself is not drawn yet) |
| TUI-4 | The flash banner (the "Copied!" confirmation) | `packages/tui/src/components/alt-screen-flash.ts:13`, composed by `packages/tui/src/tui-alt-screen.ts:1705`, used for the copy confirmation `:1520` | the API exists (`rpi-tui/src/tui_alt_screen.rs:1779` `flash`, the queue `:383-384`) but no `rpi-cli` file calls it | a copy leaves no visible confirmation | `limitation` |
| TUI-5 | Transcript search: no highlight, no jump, the counter is off by one | `packages/tui/src/tui-alt-screen.ts:1544` `applySearchHighlights` (every match painted inline), `:616` `refreshSearch` (the first match at or after the anchor, and the scroll to it), `:587` `navigateSearch` (the ↑/↓ buttons) | `rpi-tui/src/alt_screen_search.rs:302` `highlight_line` has no caller; `next_match` `:203` returns and then advances while `previous_match` `:229` decrements first, so the first Enter shows "2/N"; the corpus is rendered at a hard-coded 80 columns (`rpi-cli/src/interactive_tui/rendering.rs:501-504`) | Ctrl+Shift+F counts matches, the transcript never moves and no match is highlighted | `limitation` |
| TUI-6 | The assistant reply emits no OSC 133 prompt zone | `packages/coding-agent/src/modes/interactive/components/assistant-message.ts:9-11` (the markers), `:84-93` (the render) | `rpi-tui/src/assistant_message.rs:606-613` adds only the trailing spacing; the markers exist only for the user message (`rpi-tui/src/user_message.rs:21-23`) | a terminal that marks prompt boundaries sees a prompt start with no matching prompt end | `limitation` |
| TUI-7 | `Ctrl+Up` / `Ctrl+Down` (previous / next prompt) and `tui.altScreen.top` / `bottom` | `packages/coding-agent/src/core/keybindings.ts:135-146` (`previousPrompt` = ctrl+shift+up **and** ctrl+up; `bottom` = ctrl+e; `top` unbound) | `rpi-tui/src/keybindings.rs:821-850` (only the shift variants), `:892-905` (`bottom` = End, `top` = Home) | the original's Ctrl+Up / Ctrl+Down do nothing in the port, and the port's Home / End differ | `limitation` |
| TUI-8 | The picker chrome: the model picker, the scoped-models picker, the session picker | the model picker `packages/coding-agent/src/modes/interactive/components/model-selector.ts:31` ("Only showing models from configured providers. Use /login to add providers." and the footer "Enter to select · Ctrl+S to set as default · Escape/Ctrl+C to cancel"); the scoped-models picker `packages/coding-agent/src/modes/interactive/components/scoped-models-selector.ts:97` ("Model Configuration", "Session-only. Ctrl+S to save to settings.", the ✓ markers, the per-item description, the footer) | the model picker `rpi-cli/src/interactive_tui/selectors.rs:168` — a "Select model" title and a "Type to filter by name, provider, or id" hint, and the empty state says "No matching commands" (`rpi-tui/src/select_list.rs:673`) where the original says "No matching models"; the scoped-models picker `rpi-cli/src/interactive_tui/settings.rs:1710` — a plain list with no title, no markers, no description and no footer; see `scripts/parity/screens/diffs/model-selector.diff` and `scoped-models.diff` | every picker has a different title, a different hint line and a different empty state | `porting` — the interactive mode port (the model picker's title, footer and hint) |
| TUI-9 | The settings list's frame | `packages/coding-agent/src/modes/interactive/components/settings-selector.ts:1032` and `packages/tui/src/components/settings-list.ts:54-55` — the list is drawn between two rules | `rpi-tui/src/settings_list.rs` draws no rule; see `scripts/parity/screens/diffs/settings-list.diff` | the settings list has no top or bottom rule | `porting` — the interactive mode port (the settings list's frame) |
| TUI-10 | The trust prompt at startup | the prompt `scripts/parity/screens/ts/trust-prompt.txt` — "Trust project folder?" with "Trust", "Trust parent folder", "Trust (this session only)", "Do not trust", "Do not trust (this session only)" and the hint "↑↓ navigate  enter select  escape/ctrl+c cancel"; the component `packages/coding-agent/src/modes/interactive/components/trust-selector.ts:32` | the port does not gate the project resources behind trust at all (`rpi-cli/src/config.rs:452-461` only lists the resources), so there is no prompt; see `scripts/parity/screens/diffs/trust-prompt.diff` | the port loads `.pi/settings.json`, `.pi/extensions` and `.pi/mcp.json` from an untrusted folder without asking | `porting` — the interactive mode port (the trust decision picker and the startup trust prompt) |
| TUI-11 | The three components that are ported but unreachable: the announcement banner, the Armin and the fullscreen 3D easter egg | `packages/coding-agent/src/modes/interactive/components/earendil-announcement.ts:27`, `packages/coding-agent/src/modes/interactive/components/armin.ts:62` (`/arminsayshi`), `packages/coding-agent/src/modes/interactive/components/easter-egg-3d.ts:871` | `rpi-tui/src/announcement.rs:53`, `rpi-tui/src/armin.rs:247`, `rpi-tui/src/easter_egg_3d.rs:226` — **no call site in `rpi-cli/src`** (the header logo's click does play the Pi logo's own 3D animation, `rpi-cli/src/interactive_tui.rs:1301-1305`) | three features the port has written but no screen can show | `limitation` |
| TUI-12 | The spinner sign in the tool-call row | `packages/coding-agent/src/modes/interactive/components/spinner-sign.ts:22` | none — `rpi-tui/src/tool_execution.rs` paints a static glyph while the tool runs | the running tool row does not spin | `limitation` |
| TUI-13 | The markdown fidelity: the LaTeX parser, the mermaid modes and the image transcoder | `packages/tui/src/components/markdown.ts:518` (the LaTeX), `packages/coding-agent/src/modes/interactive/components/mermaid.ts:60` (the off / streaming / static modes, `:64-66`), `packages/tui/src/components/image.ts:55` (the non-PNG transcoder for Kitty) | `rpi-tui/src/markdown.rs:141` (the LaTeX is substituted, not parsed), `rpi-tui/src/mermaid.rs:15` (no modes — the `mermaid-rendering` setting is written and never read (signed off, `SIGN-OFF.md` §14)), `rpi-tui/src/image.rs:64` (the raw bytes are sent) | the stacked fractions and matrices differ, a mermaid diagram is always rendered, and a non-PNG image is not transcoded for Kitty | `limitation` |
| TUI-14 | The regular (non-fullscreen) mode repaints the whole transcript every frame | `packages/tui/src/tui-main-screen.ts:125` — the regular mode repaints only the changed range | the port's regular mode has no viewport to diff against, so it repaints everything | the regular mode is slower than the original's | `exception` — the decision is recorded in `EXCEPTIONS.md` ("port it" is the recommendation; the fullscreen path already repaints only what changed) |

---

## 8. Providers, models and the catalogue — 6 gaps

| # | gap | original | port | what the user sees | status |
|---|---|---|---|---|---|
| PRV-1 | Eight of the eleven wire protocols | the eleven: `packages/ai/src/providers/` — anthropic-messages, openai-completions, openai-responses, openai-codex-responses, azure-openai-responses, google-generative-ai, google-vertex, bedrock-converse-stream, mistral-conversations, pi-messages, typesafe | three: `rpi-ai/src/providers/anthropic/`, `rpi-ai/src/providers/openai_completions.rs`, `rpi-ai/src/providers/openai_responses.rs`; the catalogue data names the missing ones (`rpi-ai/src/providers/catalog/data/`: mistral 37 models, google 33, pi-messages 30, google-vertex 14, typesafe 45) | a request to one of them fails with "Provider \"mistral\" needs the mistral-conversations protocol, which this build does not support." (`rpi-cli/src/provider.rs:232`) | `porting` — the provider lead (the eight protocols; the recommendation is google, google-vertex and amazon-bedrock first) |
| PRV-2 | `amazon-bedrock` is decoded but not served | `packages/ai/src/providers/` (the bedrock converse stream) | `rpi-ai/src/providers/catalog.rs:793-795` decodes the bedrock compat blob into `StreamingProtocolCompat::Bedrock`, but there is no bedrock request path | the 193 bedrock models in the catalogue are unreachable | `porting` — the provider lead |
| PRV-3 | The 63 image models and the 46 classifier models | `packages/ai/src/providers/data/`, the `image` and `classifier` model types in `packages/ai/src/types.ts` | `rpi-ai/src/providers/catalog.rs` — the chat models only | no difference: neither side reaches them from the agent's tool set | `exception` — signed off (`SIGN-OFF.md` §1: out of scope) |
| PRV-4 | The pi.dev remote overlay | `packages/ai/src/models-store.ts` (`If-None-Match`), `packages/ai/src/model-catalog.ts` (the fetch), the offline restore | the catalogue is data in the tree (`rpi-ai/src/providers/catalog/data/`) and never touches the network (`catalog_generated_at()`) | the catalogue goes stale when pi publishes new models | `exception` — signed off (`SIGN-OFF.md` §2: out of scope for now) |
| PRV-5 | OpenRouter's per-key model list | `packages/ai/src/providers/openrouter.ts` — the list *your* key may use | `rpi-ai/src/providers/catalog.rs` publishes OpenRouter's catalogue like every other provider | a key with access to a private model does not see it | `exception` — signed off (`SIGN-OFF.md` §3: out of scope) |
| PRV-6 | The Radius dynamic provider | `packages/ai/src/providers/radius.ts` — the catalogue comes from the Radius service at runtime | `rpi-ai/src/providers/catalog.rs:374` publishes Radius as a fixed provider | a stale Radius model list | `exception` — signed off (`SIGN-OFF.md` §4: out of scope) |

---

## 9. The port's own additions — 1 gap

| # | gap | original | port | what the user sees | status |
|---|---|---|---|---|---|
| ADD-1 | The port's own commands and screens: `/context`, `/pet`, the plan and tasks panels, the provider add/remove form, `rpi update` / `events` / `package` / `dev`, `--skip-3d` | none of them | `rpi-cli/src/interactive_tui/commands.rs:687-703` (`/context`), `rpi-cli/src/interactive_tui/pet.rs`, `rpi-cli/src/app.rs:141-158` (`events`, `update`, `package`), `rpi-cli/src/args.rs` (`--skip-3d`) | extra commands in the `/` list and extra screens; they do not change any of pi's screens | `exception` — signed off (`SIGN-OFF.md` §7 and §8: keep them) |

---

## How a row leaves this file

A row leaves when the feature is ported and the harness shows the pane matching
(`node scripts/parity/run-all.mjs` clean, and the screen capture in
`scripts/parity/screens/` matching), or when the user signs the row off as an
exception (`SIGN-OFF.md`). A row whose status is `porting` leaves when its
named owner lands it and the harness is re-run.

The three inventory files that feed this one:

| file | what it holds now |
|---|---|
| `scripts/parity/FEATURES.md` | the 147-row TUI snapshot — **superseded by this file**, kept for the history |
| `scripts/parity/EXCEPTIONS.md` | the "being ported now" list and the decisions still open — the source of the `porting` owners |
| `scripts/parity/SIGN-OFF.md` | the thirteen rows the user has signed off — the source of most of the `exception` statuses |

**The check.** `node scripts/parity/gaps-count.mjs` parses this file's rows and
its summary and fails when they disagree: a wrong count, a duplicated id, an id
that skips a number, an unknown status, or a per-area total that does not add
up. Run it after every edit here.
