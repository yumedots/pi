# Language parity — every user-visible string in the Rust port, against the TypeScript original

Scope: the wording the user reads. The TypeScript original is
`/Users/gabriel/pi/packages/` (`coding-agent`, `tui`, `ai`); the Rust port is
`/Users/gabriel/pi-native/rpi/`.

Method: the port's sources were swept for every string literal that reaches a
terminal (Rust `crates/rpi-{tui,cli,ai,tools,js}/src`, the embedded assets, the
extension-host bundle) and compared, string for string, with the original's
counterpart. Every non-Latin script in the tree was listed separately. The
rendered panes were then compared with the parity harness
(`scripts/parity/drive.mjs`, golden traces in `scripts/parity/golden/`).

Verdicts: **fixed** — the port now reads as the original does; **open** — a
difference that still stands; **feature** — the original does not have the
screen at all, so there is no original wording to copy.

---

## 1. The user's complaint: non-English text in the port

The port rendered Chinese. Every occurrence, and what it became:

| Where | Original | Port, before | Port, now | Original file:line | Port file:line |
|---|---|---|---|---|---|
| the `docs` tool's topic list (4 of 6 topics) | *(the original has no `docs` tool)* | `Rust cdylib 扩展开发最佳实践：统一 C ABI 入口、…` | `Rust cdylib extension best practices: unified C ABI entry point, tool lifecycle, event handlers, resource discovery, rpi dev workflow, and release checklist` | — | `rpi/crates/rpi-cli/src/docs_tool.rs:33` |
| same | — | `完整使用手册：安装、模型、CLI、.rpi 资源、…` | `Complete user manual: installation, models, CLI, .rpi resources, Rust extensions, SDK, troubleshooting, and release` | — | `docs_tool.rs:39` |
| same | — | `用 rpi SDK 创建自己的 Agent 项目的默认结构与规范：…` | `Default layout and conventions for building your own Agent project with the rpi SDK: …` | — | `docs_tool.rs:51` |
| same | — | `Rust cdylib 扩展编写（统一 C ABI、工具生命周期、事件处理器）与 agent/扩展调试（…）` | `Writing Rust cdylib extensions (unified C ABI, tool lifecycle, event handlers) and debugging the agent/extensions (… )` | — | `docs_tool.rs:69` |
| the bash panel's long-running hint | *(the original has no such row)* | `⏸ Esc / Ctrl+C 中止` | `⏸ Esc / Ctrl+C to cancel` | — | `rpi/crates/rpi-tui/src/bash_execution.rs:349` |
| the `/pet` panel's mood labels, voice state, speaker, hints | *(the original has no `/pet`)* | `认真听你说话` / `让我想一想` / `正在回答你` / `完成啦！` / `遇到一点小问题` / `安静陪着你` / `● 连续对话` / `○ 语音暂停` / `你` / `说完停一下，我就会回答。` / `/pet auto 恢复语音` / `/pet quiet 安静陪伴 · /pet off 返回聊天` | `Listening to you` / `Let me think` / `Answering you` / `All done!` / `Hit a small problem` / `Keeping you company` / `● Continuous conversation` / `○ Voice paused` / `You` / `Finish your sentence and I will answer.` / `/pet auto resume voice` / `/pet quiet keep company · /pet off back to chat` | — | `rpi/crates/rpi-cli/src/interactive_tui/pet.rs:94-99,123,125,156,177,179,187` |
| the provider rows in the settings/model picker | `No models available` / `Log in to a provider or configure an API key first` | `无需 key` / `已配置认证头` / `未配置 key` / `已配置 key` / `未配置 · OAuth 登录` / `已配置 · OAuth` / `环境变量 {name} · 可重新登录` / `已配置 · API key / OAuth` / `未配置` / `已配置` / `Anthropic 兼容` / `OpenAI 兼容` / `自定义协议` / `内置` / `自定义` / `OpenAI Chat Completions 兼容接口` / `Anthropic Messages 兼容接口` / `OpenAI Responses 接口` | `No key needed` / `Auth header configured` / `No key configured` / `Key configured` / `Not configured · sign in with OAuth` / `Configured · OAuth` / `Environment variable {name} · sign in again` / `Configured · API key / OAuth` / `Not configured` / `Configured` / `Anthropic compatible` / `OpenAI compatible` / `Custom protocol` / `Built-in` / `Custom` / `OpenAI Chat Completions compatible API` / `Anthropic Messages compatible API` / `OpenAI Responses API` | `packages/coding-agent/src/modes/interactive/components/settings-selector.ts:647-648` | `rpi/crates/rpi-cli/src/interactive_tui/settings.rs:636-650,722-745,1207-1227,1411-1416` |
| the embedded user manual | *(the original's docs are all English: `packages/coding-agent/docs/`, 43 files)* | `user-guide.md` — 193 lines of Chinese | English | `packages/coding-agent/docs/` | `rpi/crates/rpi-cli/embedded-docs/user-guide.md` |
| the embedded extension-authoring guide | — | `extension-authoring.md` — 326 lines of Chinese | English | — | `embedded-docs/extension-authoring.md` |
| the embedded Rust debugging guide | — | `rust-debugging.md` — 148 lines of Chinese | English | — | `embedded-docs/rust-debugging.md` |
| the embedded agent-project guide | — | `agent-project.md` — 153 lines of Chinese | English | — | `embedded-docs/agent-project.md` |
| the embedded README's support section | — | `## Support / 赞赏支持` and the WeChat/Alipay/Binance table in Chinese | English | — | `embedded-docs/README.md:373-393` |
| the embedded architecture guide | — | `User said "保持一致" (keep consistent with the TS source)` | `User said "keep it consistent" (with the TS source)` | — | `embedded-docs/architecture.md:229` |

**What is not Chinese, and must stay that way:**

- the model catalogue — the port's snapshot is byte-identical to the original's
  (same sha256 map, same `structureHash`): `packages/ai/src/providers/data/*.json`
  vs `rpi/crates/rpi-ai/src/providers/catalog/data/*.json`. No translation, no
  transliteration, no different script.
- the extension-host bundle — `rpi/crates/rpi-js/js/extension-host.bundle.js`
  contains no non-ASCII at all.
- the original itself — a CJK sweep over `packages/ai/src/providers/data`,
  `packages/coding-agent/docs` and `packages/coding-agent/src` returns no hits.

**Check:** `cd rpi && rg -n --pcre2 '[\x{4e00}-\x{9fff}]' crates/` must return
hits only inside `#[cfg(test)]` blocks and doc comments. It does.

---

## 2. Root cause: every key hint was rendered differently

The single defect behind most of the differences.

| | Original | Port, before | Port, now |
|---|---|---|---|
| `keyText(id)` (the form used by every hint) | the raw key id, lower case: `escape`, `ctrl+c`, `ctrl+o`, `escape/ctrl+c` | `Esc`, `Ctrl+C`, `Ctrl+O`, `Esc/Ctrl+C` | `escape`, `ctrl+c`, `ctrl+o`, `escape/ctrl+c` |
| `keyDisplayText(id)` | first letter of each part capitalised: `Escape`, `Ctrl+C` | — | `Escape`, `Ctrl+C` |
| `alt` on macOS | rendered `option` | `Alt` | `option` |
| where the key comes from | the keybinding registry | hard-coded literals (`"Ctrl+O"`, `"Ctrl+C"`) | the registry (`app.tools.expand`, `app.interrupt`, …) |
| the `app.*` bindings themselves | `app.interrupt`=escape, `app.quit`=ctrl+c, `app.exit`=ctrl+d, `app.suspend`=ctrl+z, `app.thinking.cycle`=shift+tab, `app.model.select`=ctrl+l, `app.tools.expand`=ctrl+o, `app.thinking.toggle`=ctrl+t, `app.model.cycleForward`=ctrl+p, `app.model.cycleBackward`=shift+ctrl+p, `app.message.copy`=ctrl+x, `app.message.followUp`=alt+enter, `app.message.dequeue`=alt+up, `app.clipboard.pasteImage`=ctrl+v | the registry had no `app.*` ids at all | all of them, with the original's defaults |

Original: `packages/coding-agent/src/modes/interactive/components/keybinding-hints.ts:14-56`,
`packages/coding-agent/src/core/keybindings.ts:26-54`.
Port: `rpi/crates/rpi-tui/src/keybinding_hints.rs`, `rpi/crates/rpi-tui/src/keybindings.rs:155-290`.

**Check:** `rpi/crates/rpi-tui/src/keybinding_hints.rs` has a test pinning
`key_text("app.interrupt") == "escape"`.

---

## 3. The startup header and the brand

The pane the user sees on every start, and the window title.

| What | Original | Port, before | Port, now | Original file:line | Port file:line |
|---|---|---|---|---|---|
| the mark | two half-block rows, 4 cells wide: `▀▀█` / `█▀ █`, coral `rgb(228,138,122)` / blue `rgb(79,142,179)` / yellow `rgb(234,182,93)` | five rows of `▃ ▅ ▂` | fixed by `BrandingAndAutocomplete` (in flight) | `packages/coding-agent/src/modes/interactive/components/pi-logo.ts:19-26` | `rpi/crates/rpi-cli/src/brand.rs` |
| the wordmark | `Pi` (coral `P` + yellow `i`); `Pi v1.3.0` where half blocks cannot be drawn | `rpi · 🦀` | in flight | `pi-logo.ts:29-40` | `brand.rs` |
| the version on the header | ` v1.3.0` (the original's version) | no version | ` v1.3.0`, from `crate::changelog::current_version()` | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:1116-1119` | `rpi/crates/rpi-cli/src/interactive_tui/rendering.rs:14-21` |
| the compact key hints | `escape interrupt · ctrl+c twice to exit · / commands · ! bash · ctrl+o more` | `Enter send · Shift+Enter newline · Ctrl+C clear · Esc abort · /help` | same as the original | `interactive-mode.ts:1140-1146` | `rendering.rs:56-68` |
| the "show full startup help" line | ` Press ctrl+o to show full startup help.` | absent | fixed | `interactive-mode.ts:1152-1153` | `rendering.rs:22-30` |
| the onboarding note | `Pi can explain its own features and look up its docs. Ask it how to use or extend Pi.` | absent | fixed | `interactive-mode.ts:1157` | `rendering.rs:31-40` |
| the port's extra startup listing | *(the original removed it: "The startup listing of loaded context files, skills, prompt templates, and extensions is gone.")* | `Context (N)` / `Tools (N)` / `Skills (N)` and the tagline `interactive TUI · library-first agent runtime` | removed | `packages/coding-agent/CHANGELOG.md:47` | `rendering.rs` |
| the tmux warning | `Warning: tmux extended-keys is off. Modified Enter keys may not work. Add \`set -g extended-keys on\` to ~/.tmux.conf and restart tmux.` / `Warning: tmux extended-keys-format is xterm. Pi works best with csi-u. Add \`set -g extended-keys-format csi-u\` to ~/.tmux.conf and restart tmux.` | absent | fixed | `interactive-mode.ts:1387-1431`, `:4494-4498` | `rendering.rs:69-120` |
| the window title | `π - <sessionName> - <cwdBasename>` (or `π - <cwdBasename>`) — `APP_TITLE = "π"`, no activity glyph | `▃ ▅ ▂ rpi · 🦀` + a `⟳`/`↻` activity glyph | in flight | `packages/coding-agent/src/config.ts:588`, `interactive-mode.ts:1229-1236` | `rpi/crates/rpi-cli/src/brand.rs:76-96`, `interactive_tui/state.rs:1134,1158,1379` |
| the first-run greeting | `Welcome to pi, the minimal coding agent.` (`${APP_NAME}`) | `Welcome to Pi, the minimal coding agent.` | fixed | `packages/coding-agent/src/modes/interactive/components/first-time-setup.ts:54` | `rpi/crates/rpi-tui/src/first_run.rs:166` |
| the first-run theme options | `System (follows the terminal's light or dark mode)` / `Dark` / `Light` | `Dark` / `Light` / `Monochrome` | fixed by the fresh-session work | `first-time-setup.ts:19-23` | `rpi/crates/rpi-cli/src/extras.rs` |

**Check:** `cd scripts/parity && node run-all.mjs` — the `prompt`, `tool`,
`thinking` and `markdown` scenarios diff the whole pane, so the header, the
warning and the transcript must all match the golden.

---

## 4. The changelog and the version

| What | Original | Port, before | Port, now | Original file:line | Port file:line |
|---|---|---|---|---|---|
| the changelog shown | the original's own `CHANGELOG.md` | the port's own `rpi/CHANGELOG.md` | the original's, embedded as `embedded-docs/pi-changelog.md` | `packages/coding-agent/CHANGELOG.md` | `rpi/crates/rpi-cli/src/changelog.rs:9` |
| the `/changelog` heading | `What's New` | `Recent Changes` / `Full Changelog` | `What's New` | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:6778` | `rpi/crates/rpi-cli/src/interactive_tui/rendering.rs` |
| the collapsed startup note | `Updated to v1.3.0. Use /changelog to view full changelog.` | `Updated to v0.6.3. Use /changelog to view release notes.` | `Updated to v1.3.0. Use /changelog to view full changelog.` | `interactive-mode.ts:855` | `rendering.rs` |
| when a note is shown | a fresh install records the version and shows nothing; an upgrade shows the unseen entries; a resumed session shows nothing | the port's own rule | the original's rule | `interactive-mode.ts:1434-1445` | `rpi/crates/rpi-cli/src/interactive_tui/run.rs` |
| the relative links in the entries | rewritten to `https://github.com/earendil-works/pi/blob/v<version>/packages/coding-agent/…` | rewritten to the port's repository | the original's | `packages/coding-agent/src/utils/changelog.ts:88-96` | `changelog.rs` |
| `--version` | the bare version, `1.3.0` | `rpi 0.6.3` | `1.3.0` | `packages/coding-agent/src/main.ts:566` | `rpi/crates/rpi-cli/src/args.rs::print_version` |
| the `/version` command | *(the original has no `/version` command)* | `📦 Version Information` + `pi v0.6.3` | `pi v1.3.0` | — | `rendering.rs` |

---

## 5. Commands, help and hotkeys

| What | Original | Port, before | Port, now | Original file:line | Port file:line |
|---|---|---|---|---|---|
| the slash-command descriptions | the original's `BUILTIN_SLASH_COMMANDS` | the port's own wording | the original's wording | `packages/coding-agent/src/core/slash-commands.ts:21-52` | `rpi/crates/rpi-cli/src/interactive_tui/commands.rs` |
| `/hotkeys` | a three-section markdown table — `**Navigation**`, `**Editing**`, `**Other**` (+ `**Extensions**` when extensions register shortcuts) — with the original's action wording | a flat `key — description` list with invented wording | the original's table | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:6843-6890` | `rpi/crates/rpi-cli/src/interactive_tui/rendering.rs:360-460` |
| `/help` | *(the original has no `/help`; its commands are described by the autocomplete)* | `/help` with the port's own table | the original's command list and descriptions | `packages/coding-agent/src/core/slash-commands.ts:21-52` | `rendering.rs` |
| the `Goodbye!` farewell | *(the original has none)* | `Goodbye!` | removed | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:4174` | `rpi/crates/rpi-cli/src/interactive_tui.rs` |

---

## 6. The TUI surfaces

| What | Original | Port, before | Port, now | Original file:line | Port file:line |
|---|---|---|---|---|---|
| the status indicator's cancel hint | `(escape to cancel)` | `(Ctrl+C to cancel)` | `(escape to cancel)` | `packages/coding-agent/src/modes/interactive/components/status-indicator.ts:55-56,87-92,109` | `rpi/crates/rpi-tui/src/status_indicator.rs:73,91,111,138` |
| the bash panel's running label | `Running... (escape/ctrl+c to cancel)` | a `●` glyph + an elapsed timer | fixed | `packages/coding-agent/src/modes/interactive/components/bash-execution.ts:52-57` | `rpi/crates/rpi-tui/src/bash_execution.rs:340-350` |
| the tool panel's expand hint | `ctrl+o to expand` / `... (5 more lines, ctrl+o to expand)` | `Ctrl+O to expand` / `… 5 more lines (Ctrl+O to expand)` | fixed | `packages/coding-agent/src/modes/interactive/components/tool-execution.ts:158` | `rpi/crates/rpi-tui/src/tool_execution.rs:593-595` |
| the assistant's truncated / aborted / error lines | `Response was truncated before completion.` / `Operation aborted` / `Error: <msg>` | `⚠️ …` / `❌ Operation aborted: <err>` / `❌ Error: <msg>` | fixed | `packages/coding-agent/src/modes/interactive/components/assistant-message.ts:225,232,238` | `rpi/crates/rpi-tui/src/assistant_message.rs:512-515` |
| the skill card | `@<name>` | `[skill] <name>` | fixed | `packages/coding-agent/src/modes/interactive/components/skill-invocation-message.ts:118-136` | `rpi/crates/rpi-tui/src/tool_execution.rs:828-841` |
| the select list's empty state | `  No matching commands` | `  No matching items` | fixed | `packages/tui/src/components/select-list.ts:102` | `rpi/crates/rpi-tui/src/select_list.rs:637` |
| the settings list's empty state | `  No settings available` | `  No settings found` | fixed | `packages/tui/src/components/settings-list.ts:122` | `rpi/crates/rpi-tui/src/settings_list.rs:431` |
| the transcript search's placeholder | `Find in transcript` | `🔍 Search: ` | fixed | `packages/tui/src/alt-screen-search.ts:196-200` | `rpi/crates/rpi-tui/src/search_bar.rs:65` |
| the tool duration | `1m 5s`, `2h 3m 4s` | `1m5s` | fixed | `packages/coding-agent/src/core/tools/render-utils.ts` | `rpi/crates/rpi-tui/src/tool_execution.rs:889-898` |
| the thinking-level descriptions | `No reasoning` / `Very brief reasoning (~1k tokens)` / … / `Maximum reasoning` | the port's own | fixed | `packages/coding-agent/src/modes/interactive/components/thinking-selector.ts:13-21` | `rpi/crates/rpi-cli/src/interactive_tui/selectors.rs:786-792` |
| the footer | identical | identical | identical | `packages/coding-agent/src/modes/interactive/components/footer.ts` | `rpi/crates/rpi-tui/src/footer.rs` |

---

## 7. The non-TUI CLI surface

| What | Original | Port, before | Port, now | Original file:line | Port file:line |
|---|---|---|---|---|---|
| the diagnostic prefix | `Error: ` / `Warning: ` | `error: ` / `warning: ` | fixed | `packages/coding-agent/src/main.ts:104-111` | `rpi/crates/rpi-cli/src/{app,session,auth,install,packages,updates,events,modes,provider}.rs` |
| `--help` | `Usage:` / `Commands:` / `Options:` / `Examples:` / `Environment Variables:` / `Built-in Tool Names:` with the original's wording, 20 examples, 45 env vars, 8 built-in tool rows | `Subcommands:` / `Options:` / `Environment:` / `Built-in Tools:`, 6 examples, 8 env vars, one built-in-tool row | fixed | `packages/coding-agent/src/cli/args.ts:273-478` | `rpi/crates/rpi-cli/src/args.rs::print_help` |
| `--mode` with no value | `--mode requires text, json, or rpc` | `--mode requires a value` | fixed | `packages/coding-agent/src/cli/args.ts:95` | `args.rs` |
| `--mode` with a bad value | `Invalid mode "x". Valid values: text, json, rpc` | `Invalid --mode "x". Valid: text, json, rpc` | fixed | `args.ts:104` | `args.rs` |
| `--tui-mode` with no value | `--tui-mode requires regular or fullscreen` | `--tui-mode requires a value` | fixed | `args.ts:216` | `args.rs` |
| `--tui-mode` with a bad value | `Invalid TUI mode "x". Valid values: regular, fullscreen` | `Invalid --tui-mode "x". Valid: regular, fullscreen` | fixed | `args.ts:221` | `args.rs` |
| `--thinking` with a bad value | `Invalid thinking level "x". Valid values: off, minimal, low, medium, high, xhigh, max` (a warning, always shown) | `Invalid --thinking "x". Valid: …`, only under `--verbose` | fixed | `args.ts:171-174` | `args.rs` |
| the model-resolution errors | `Unknown provider "x". Use --list-models to see available providers/models.` / `Model "x" not found. Use --list-models to see available models.` / `Invalid thinking level "x" in pattern "y". Using default instead.` / `No models available. Check your installation or add models to models.json.` | `Unknown provider "x". Supported: …` / `No model matches "x". Available: …` / `Invalid thinking level "x" in model pattern. Valid: …` / absent | fixed by the provider work | `packages/coding-agent/src/core/model-resolver.ts:466,487,511,222` | `rpi/crates/rpi-cli/src/provider.rs` |
| the model names and numbers on screen | the catalogue's own (`Claude Haiku 4.5 (latest)`, `claude-opus-5` 1M/128K, …) | a hand-written list (`Claude Haiku 4.5`, 200K/32K, …) | fixed by the provider work | `packages/ai/src/providers/data/anthropic.json` | `rpi/crates/rpi-ai/src/providers/catalog.rs` |
| `--list-models` | sorted by provider then id; filtered by a fuzzy match over `{provider} {id}` | catalogue order; substring over `{provider} {id} {name}` | fixed | `packages/coding-agent/src/cli/list-models.ts:48-64` | `rpi/crates/rpi-cli/src/app.rs` |
| `--export`'s default file name | `pi-session-<basename>.html` | `rpi-session-<stem>.html` | fixed | `packages/coding-agent/src/core/export-html/index.ts:310-311` | `app.rs` |
| the `--resume` picker | `Sessions`, `Loading sessions...`, age `now`/`5m`/`3h`/`2d`/`3w`/`4mo`/`1y`, row `<messageCount> <age>`, cancel prints `No session selected` | `Resume session`, `just now`/`5m ago`, row `<age> · <bytes> · <shortId>`, silent cancel | title/age fixed; the row's message count is **open** | `packages/coding-agent/src/modes/interactive/components/session-menu.ts:54-70,207,245-251`; `packages/coding-agent/src/main.ts:428` | `rpi/crates/rpi-cli/src/resume_picker.rs` |
| the auth guidance | the absolute path of the docs the original ships | `docs/providers.md` / `docs/models.md` — files the port does not have | `Use /login to log into a provider via OAuth or API key.` | `packages/coding-agent/src/core/auth-guidance.ts:8-17` | `rpi/crates/rpi-cli/src/auth_guidance.rs` |
| the config-directory hint | *(none — a plain `Error: <message>`)* | `Check ~/.rpi/auth.json / ~/.rpi/models.json (set RPI_CODING_AGENT_DIR to relocate).` — the port now reads `~/.pi` and `PI_CODING_AGENT_DIR` | **open** | `packages/coding-agent/src/main.ts` | `rpi/crates/rpi-cli/src/app.rs:911` |
| the `auth` subcommand | `check` / `print-api-key` / `print-bearer-token`, with the original's usage text and error sentences | `login` / `check` / `status` / `refresh` / `logout` with the port's own wording | **open** (the `print-api-key` / `print-bearer-token` commands are a feature, not a string) | `packages/coding-agent/src/cli/auth-command.ts:26-61` | `rpi/crates/rpi-cli/src/auth.rs` |
| the extension-load diagnostics | `Failed to load extension "<path>": <error>` / `Extension package "<path>": <warning>` / `Hint: Start without extensions using "pi -ne".` | absent | **open** | `packages/coding-agent/src/main.ts:88,822-830,934-936` | `rpi/crates/rpi-cli/src/session.rs` |
| the print-mode diagnostics | `Response was truncated: the model reached its output token limit.` / `Extension error (<path>): <err>` | absent | **open** | `packages/coding-agent/src/modes/print-mode.ts:113,168` | `rpi/crates/rpi-cli/src/modes.rs` |
| the update notice | `New version <v> is available. Run pi update` | `Update available: <name> <current> -> <latest>. Run \`<command>\`.` | **open** | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:4502-4503` | `rpi/crates/rpi-cli/src/updates.rs:506-509` |
| the session-not-found notice | `No session found matching '<arg>'` | `No session found for <requested> in <dir>. Start a fresh session instead (drop --continue/--resume/--session).` | **open** | `packages/coding-agent/src/main.ts:405,422` | `rpi/crates/rpi-cli/src/session.rs:1831-1832` |
| the dead embedded changelog | — | `embedded-docs/changelog.md` (the port's own) was still synced by `scripts/sync-embedded-docs.sh:26` while nothing embedded it | **open** | — | `rpi/crates/rpi-cli/embedded-docs/changelog.md` |

---

## 8. Screens that exist on one side only

These are **not** wording differences — the original has no such screen, so
there is no original text to copy. They are listed so the next reader does not
look for a missing counterpart.

Port-only: the `/pet` panel, the plan and tasks panels, the provider
add/remove form, the `docs` tool, `rpi update` / `rpi events` / `rpi package` /
`rpi dev` / `rpi dev-local`, `--server` / `--connect` / `--token`,
`--base-url` / `--timeout` / `--extensions-dir` / `--local-only` /
`--package-only` / `--debug-system-prompt`, `rpi auth login|status|refresh|logout`,
the `Goodbye!` farewell (since removed).

Original-only: `pi remove` / `pi list` / `pi config` / `pi mcp`,
`pi auth print-api-key` / `pi auth print-bearer-token`, `--no-mcp`, `--use-theme`,
the `--` end-of-options marker, the `Extension CLI Flags:` help section, the
project-trust prompt (`Trust project folder?` / `This allows pi to load .pi
settings and resources, install missing project packages, and execute project
extensions.` / `Trust` / `Trust parent folder (<parentPath>)` / `Trust (this
session only)` / `Do not trust` / `Do not trust (this session only)` — the port
documents at `rpi/crates/rpi-cli/src/config.rs:449-453` that it has no trust
prompt at all), the `Fork from Message` screen, the scoped-models screen's
`Model Configuration` / `Session-only. Ctrl+S to save to settings.` / `Enter
toggle · Ctrl+A all · Ctrl+C clear · Ctrl+P provider · Ctrl+↑/Ctrl+↓ reorder ·
Ctrl+S save` footer, and the tree selector's `Session Tree` / `Type to search:`
/ `  No entries found` / `Label (empty to remove):`.

---

## 9. The checks

| What | How |
|---|---|
| no non-English text in the port | `cd rpi && rg -n --pcre2 '[\x{4e00}-\x{9fff}]' crates/` → hits only in `#[cfg(test)]` blocks and doc comments |
| the panes match the original | `cd scripts/parity && node run-all.mjs` → all six scenarios report `rust: matches the golden trace` and `ts and rust: the two traces are identical` |
| the key hints | `rpi/crates/rpi-tui/src/keybinding_hints.rs` — `key_text("app.interrupt") == "escape"`, `key_display_text` capitalises, `alt` reads `option` on macOS |
| the changelog surface | `rpi/crates/rpi-cli/src/changelog.rs` and `rpi/crates/rpi-cli/src/interactive_tui/tests.rs` — the parse, the new entries, the link rewriting, the fresh-install / upgrade / resume rules, the `What's New` heading, the collapsed note |
| the `--help` text | `rpi/crates/rpi-cli/src/args.rs` — the section headers, the usage line, the built-in tool rows |
| the tmux warning | `rpi/crates/rpi-cli/src/interactive_tui/rendering.rs` — the two message strings |

## 10. Verification outcome

| Check | Result |
|---|---|
| `cargo test -p rpi-tui --lib` | **503 passed, 0 failed** — this covers the key-hint ids, the select-list and settings-list empty states, the search placeholder, the assistant message strings, the tool-panel hints, the durations, the skill card and the first-run dialog |
| CJK sweep over `rpi/crates/` | clean outside `#[cfg(test)]` blocks and doc comments |
| `cd scripts/parity && node run-all.mjs` (before the header and the tmux warning landed) | `startup` and `panels`: `ts: matches the golden trace`, `rust: matches the golden trace`, `ts and rust: the two traces are identical`. `prompt`, `tool`, `thinking`, `markdown`: the rust pane differed from the golden **in the header block only** (the port's five-row `rpi · 🦀` lockup instead of pi's two mark rows, the missing compact hint line, the missing `Press ctrl+o…` line) plus the two missing tmux-warning rows |
| `cd scripts/parity && node run-all.mjs` (after every change in this area landed, on a binary built in the agents' own target directory with `PI_PARITY_RUST_BIN=…/rpi/target-agents/debug/rpi`) | **`startup` 2/2, `panels` 5/5, `prompt` 2/2 and `thinking` 2/2 are byte-identical to pi's golden traces** — `ts: matches the golden trace`, `rust: matches the golden trace`, `ts and rust: the two traces are identical` (in `thinking` the rust side differs from the golden in one step only in a volatile field, the `+ Thought · 0.0s` / `0.1s` timing). `tool` and `markdown` still differ, and both are the TUI library's, not the wording's: `tool` is the collapsed read panel's **empty result row** (pi's read renderer returns `""` when collapsed, so the original keeps the row and prints nothing in it — `packages/coding-agent/src/core/tools/renderers/read.ts:126-128` — while the port drops the row, `rpi/crates/rpi-tui/src/tool_execution.rs`); `markdown` is the markdown body shifted one row (the port's list starts one row earlier). The `tool` golden was also captured against the original at `cb87143e` and needs re-capturing; the fresh TypeScript capture is `scripts/parity/out/ts-tool.json`. The header, the tmux warning, the notices, the user message's spacing, the key hints, the changelog surface, the commands and the autocomplete rows are all in, and the panes that cover them are byte-identical. |

Note when reading the harness rows: the agents build in their own target
directory, so the harness must be pointed at it —
`PI_PARITY_RUST_BIN=/Users/gabriel/pi-native/rpi/target-agents/debug/rpi` —
and the build must be `scripts/agent-cargo.sh build --workspace`, never bare
`cargo` (the default `rpi/target` belongs to the developer). A run against a
stale binary measures old code: the earlier rows in this table were taken
before the header and the tmux warning landed.

## 11. What is still different

1. the window title and the mark (`brand.rs`) — `BrandingAndAutocomplete`, in flight;
2. the five slash commands pi has and the port did not — `/skills` ("Browse and run a skill"), `/bug` ("Report a bug to the Pi developers", argument hint `<description>`) and `/stats` ("Show session info and stats") are **registered with pi's text**; `/history` and `/sessions` now resolve as aliases of `/resume` (`core/slash-commands.ts:52`), and `/quit` is the canonical exit name with `/exit` as its alias (`core/slash-commands.ts:51`). The **bodies** are the interactive mode port's — the port dispatches `TuiMessage::ShowSkills`, `TuiMessage::ReportBug(String)` and `TuiMessage::ShowStats` to them. The argument-hint field and the `<hint> — <description>` row (`packages/tui/src/autocomplete.ts:352-360`) are implemented on the CLI side (`CommandRegistry::visible_entries()`);
3. the `skill:` autocomplete entry — pi registers each skill as `skill:<skill.name>` and the fuzzy match strips the prefix (`packages/tui/src/autocomplete.ts:365-372`); the port has neither. `rpi/crates/rpi-tui/src/autocomplete.rs` is the branding agent's file;
4. the `/hotkeys` Extensions section — needs the extension shortcut list in `CommandContext`; interactive-mode plumbing;
5. the resume picker's row metadata — pi shows `<messageCount> <age>`, the port `<age> · <bytes> · <shortId>`; the message count is missing;
6. ~~the config-directory hint in `app.rs`~~ — fixed: it now names the port's own resolved paths (`~/.pi/agent`, `PI_CODING_AGENT_DIR`);
7. the `auth` subcommand wording, the extension-load diagnostics, the print-mode diagnostics, the update notice and the session-not-found notice — all in files other agents are rewriting;
8. the port has no trust prompt, no `pi mcp`, no `pi config`/`pi list`/`pi remove`, no `pi auth print-api-key`/`print-bearer-token` — features, not wording;
9. the port's nested `~/.pi/agent/agent/` config layout — a layout question for the provider/session owners, not a wording one.
