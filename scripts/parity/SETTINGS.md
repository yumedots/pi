# Settings parity

The original's `settings.json` — its schema, its defaults, its getters — and
what the port does with them. The port shares pi's agent directory, so the
file is the user's own pi installation: a setting the port drops or renames
damages pi.

## What the original does

| What | Where |
| --- | --- |
| The schema: 60 top-level keys, `additionalProperties: true` | `packages/coding-agent/src/core/settings-schema.ts:206` |
| The published JSON schema of the same object | `packages/coding-agent/schemas/settings.schema.json:1` |
| The defaults: `SETTINGS_DEFAULTS`, the value of every setting that has one | `packages/coding-agent/src/core/settings-defaults.ts:3` |
| Every getter is `this.settings.X ?? SETTINGS_DEFAULTS.X`, and the enumerated settings fall back to the default for an unknown value | `packages/coding-agent/src/core/settings-manager.ts:1026` (`getQuietStartup`), `:1244` (`getShowTerminalProgress`), `:1257` (`getTuiMode`), `:1399` (`getOutputPad`), `:1409` (`getAutocompleteMaxVisible`) |
| The global file is `<agent-dir>/settings.json`, the project file is `<cwd>/.pi/settings.json` | `packages/coding-agent/src/core/settings-manager.ts:193` |
| Keybindings are not a setting: they live in `<agent-dir>/keybindings.json` | `packages/coding-agent/src/core/keybindings.ts:348`, `packages/coding-agent/src/core/keybindings-schema.ts:1` |

## What the port does now

| What | Where | Check |
| --- | --- | --- |
| The `Settings` struct is pi's schema: one field per key, pi's name, pi's type. The struct's serde attributes are the only place the key names live, so the load path and the save path cannot disagree. | `rpi/crates/rpi-cli/src/settings.rs:259` | `node scripts/parity/audit.mjs settings` → `identical` |
| `defaults` mirrors `SETTINGS_DEFAULTS`; `Settings::effective()` returns the effective value of every defaulted setting — the file's value when it names one, the original's default otherwise, with the original's normalization for the enumerated settings. | `settings.rs:27`, `settings.rs:700` | `cargo test -p rpi-cli --lib settings::scoped_tests::defaults_match_the_original` |
| The port writes pi's names: `enabledModels`, `httpIdleTimeoutMs`, `terminal.showImages`, `terminal.showTerminalProgress`, `skills`, `prompts`, `extensions`, `packages`, `defaultTools`, … The older rpi spellings (`scopedModels`, `httpIdleTimeout`, flat `showImages`/`showTerminalProgress`, `skillDirs`/`promptDirs`/`extensionDirs`) are still read and are rewritten to pi's names on save. | `settings.rs:1201` | `cargo test -p rpi-cli --lib settings::scoped_tests::settings_roundtrip_with_pi_key_names` |
| A setting the port does not know is preserved when the port saves. | `settings.rs:1201` | `cargo test -p rpi-cli --lib settings::scoped_tests::save_preserves_unknown_fields` |
| The write is atomic and never truncates: a file that cannot be parsed is left byte-for-byte alone, and a successful write leaves no staging file. | `settings.rs:1201` (`config::atomic_write`) | `cargo test -p rpi-cli --lib settings::scoped_tests::a_failed_save_leaves_the_file_untouched` |
| Keybindings come from `<agent-dir>/keybindings.json`, the file pi uses; a legacy `keybindings` object inside `settings.json` is read only when that file is absent. | `settings.rs:1037` | `cargo test -p rpi-cli --lib settings::scoped_tests::keybindings_come_from_the_agent_dir` |
| The project settings file is pi's `.pi/settings.json`; the port's older `.rpi/settings.json` is read when pi's is absent. | `settings.rs:1054`, `settings.rs:1079` | `cargo test -p rpi-cli --lib settings::tests::project_settings_only_use_rpi` |
| `quietStartup` keeps pi's shape: a boolean, or the string `"header"`. | `settings.rs:514`, `settings.rs:537` | `cargo test -p rpi-cli --lib settings::scoped_tests::settings_roundtrip_with_pi_key_names` |
| `skills` also accepts pi's deprecated object form (`customDirectories`). | `settings.rs:551` | `cargo test -p rpi-cli --lib settings::scoped_tests::deprecated_skills_object_is_read` |

## What the user sees

- A `settings.json` written by pi is read by the port the way pi reads it: the
  same keys, the same values, the same defaults, the same normalization of an
  unknown value.
- A `settings.json` written by the port is read by pi: every key pi knows is
  written with pi's name and pi's type, and the file satisfies pi's published
  JSON schema.
- A key the port does not know (a pi-only extension, or a plugin's own key) is
  preserved when the port saves.
- A file the port cannot parse is never rewritten: the user's pi installation
  keeps its bytes.

## The value cross-check

`scripts/parity/settings-values.mjs` compares the values, not just the names.
It validates the port's file against the original's published JSON schema
(`packages/coding-agent/schemas/settings.schema.json`) with ajv, computes the
effective values with the original's own defaults (imported from
`packages/coding-agent/src/core/settings-defaults.ts`), and compares them with
the port's `Settings::effective()`.

```
cargo test -p rpi-cli --lib settings::scoped_tests::parity_fixture_is_written_for_the_cross_check
bun scripts/parity/settings-values.mjs
```

```
ok   the pi file satisfies the original's schema
ok   the pi file has the same effective values in the port and in the original
ok   the pi file has no key the original does not know
ok   the port file satisfies the original's schema
ok   the port file has the same effective values in the port and in the original
ok   the port file has no key the original does not know
```

## What the port cannot express

- `quietStartup: "header"` — pi keeps the startup header and hides the rest.
  The port stores the value and writes it back in pi's shape, but the TUI
  treats it as "not quiet", so the startup listing is shown. The port has no
  header-only mode.
- The union-typed settings keep pi's raw JSON instead of a Rust enum, because
  pi accepts several shapes for them: `terminal.hyperlinks`,
  `terminal.images`, `terminal.trueColor`, `fullscreenWheelScrollLines`,
  `websocketConnectTimeoutMs`, `httpIdleTimeoutMs` (`"disabled"` or a number).
- `modelThinkingLevels`, `packages` and `compaction.modelOverrides` are maps of
  free-form values; the port keeps them as JSON.
- `skills` has a deprecated object form in pi
  (`{ enableSkillCommands, customDirectories }`). The port reads the array form
  and the `customDirectories` of the object form; `enableSkillCommands` is a
  setting of its own and is read separately.
- An invalid *value* is handled differently: pi loads the file and fails only
  the getter that reads the bad value (`getProjectContextMaxChars` throws), the
  port rejects the whole file with a JSON error. An invalid *key* is ignored by
  both.

## Port extensions

- `lastRpiChangelogVersion` — rpi's own release-note baseline. pi keeps its
  baseline in `lastChangelogVersion`; rpi needs its own so an imported pi value
  does not suppress rpi's release notes. pi's schema allows unknown keys, so
  pi reads a file with it unchanged. The audit reports it separately
  (`scripts/parity/audit.mjs settings`).
