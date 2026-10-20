# Config-selector parity — TypeScript original vs. Rust port

Area: the package-resource config selector of the interactive TUI (`/config`), the
component that lists the resolved extensions, skills, prompts and themes grouped by
source and scope and lets the user enable or disable them.

* Original: `/Users/gabriel/pi` (branch `perf/lightweight-harness`),
  `packages/coding-agent/src/modes/interactive/components/config-selector.ts`
* Port: `/Users/gabriel/pi-native` (branch `feat/rpi-native`),
  `rpi/crates/rpi-cli/src/interactive_tui/config_selector.rs`

**Method.** Read-only reading of the original next to the port; every row below was
checked against the two files as they stood when this document was written. The
"check" column names the Rust test in the port file that pins the behaviour
(`cargo test -p rpi-cli config_selector`). No file in the original was modified.

---

## 1. Data model and grouping

| What | Original | Port | Check |
|---|---|---|---|
| The four resource kinds and their headings `Extensions` / `Skills` / `Prompts` / `Themes` | `config-selector.ts:26-35` | `config_selector.rs:30-75` | `build_groups_orders_the_subgroups_by_resource_type` |
| Grouping key `origin:scope:source:baseDir` | `config-selector.ts:106` | `config_selector.rs:320-327` | `build_groups_orders_packages_before_top_level_resources` |
| Group order: packages first, then top-level; user before project; then by source | `config-selector.ts:168-181` | `config_selector.rs:379-388` | `build_groups_orders_packages_before_top_level_resources` |
| Subgroup order: extensions → skills → prompts → themes | `config-selector.ts:183-186` | `config_selector.rs:390-393` | `build_groups_orders_the_subgroups_by_resource_type` |
| Items sorted by display name | `config-selector.ts:186` | `config_selector.rs:394-399` | `build_groups_sorts_the_items_by_display_name` |
| Group heading `source (scope)` for a package | `config-selector.ts:81-83` | `config_selector.rs:243-245` | `group_label_names_packages_with_their_scope` |
| Group heading `Built-in` / `Built-in (project override)` | `config-selector.ts:84-86` | `config_selector.rs:246-253` | `group_label_names_the_builtin_source` |
| Group heading `User (<dir>)` / `Project (<dir>)` for auto-discovered resources | `config-selector.ts:87-95` | `config_selector.rs:254-274` | `group_label_names_auto_discovered_resources` |
| Group heading `User settings` / `Project settings` | `config-selector.ts:96` | `config_selector.rs:275-279` | `group_label_names_the_settings_sources` |
| `formatBaseDir`: home → `~`, separators normalised, always a trailing `/` | `config-selector.ts:63-78` | `config_selector.rs:226-239` | `format_base_dir_replaces_the_home_directory`, `format_base_dir_keeps_paths_outside_the_home_directory` |
| Display name: `parent/folder` for an extension outside `extensions/`, the folder for a `SKILL.md` skill, the path without the `builtin:` prefix for a built-in | `config-selector.ts:140-152` | `config_selector.rs:280-298` | `display_name_names_the_folder_of_an_extension`, `display_name_names_the_folder_of_a_skill`, `display_name_strips_the_builtin_prefix` |

## 2. Rendering

| What the user sees | Original | Port | Check |
|---|---|---|---|
| Title `Global Resources` / `Project Local Resources` | `config-selector.ts:205` | `config_selector.rs:574-579` | `the_selector_renders_the_title_the_hint_and_the_resources`, `the_selector_renders_the_project_title_and_hint` |
| Key hint `space toggle` (global) / `space cycle inherit/+/-` (project), with `tab switch mode` and `esc close`, right-aligned on the title line | `config-selector.ts:207-213` (via `rawKeyHint`) | `config_selector.rs:582-593` (via `rpi_tui::keybinding_hints::raw_key_hint`) | same two tests |
| The line under the title names the settings file the scope writes | `config-selector.ts:214-221` | `config_selector.rs:596-604` | — |
| A search row above the list that filters the flattened entries by display name, resource kind and path | `config-selector.ts:322-370`, `:404-405` | `config_selector.rs:640-700`, `:1022-1023` | `the_search_filters_the_flattened_entries` |
| Group heading, indented, accent (dim when inherited) | `config-selector.ts:427-433` | `config_selector.rs:1040-1055` | — (covered by the render test) |
| Subgroup heading, indented, muted | `config-selector.ts:434-439` | `config_selector.rs:1056-1062` | — (covered by the render test) |
| Cursor on the selected resource | `config-selector.ts:441-444` | `config_selector.rs:1064` | `the_selector_renders_the_title_the_hint_and_the_resources` |
| Checkbox `[x]` (success) / `[ ]` (dim) in the global scope | `config-selector.ts:641-649` | `config_selector.rs:1133-1150` | `the_selector_renders_the_title_the_hint_and_the_resources` |
| Checkbox `[+]` (success) / `[-]` (warning) for a project override | `config-selector.ts:642-645` | `config_selector.rs:1139-1146` | — (see §5) |
| Suffix `  project load` / `  project unload` / `  inherited global` | `config-selector.ts:651-657` | `config_selector.rs:1154-1176` | — (see §5) |
| Resources inherited from the global scope are dimmed in the project view | `config-selector.ts:659-665` | `config_selector.rs:1066-1080` | — (see §5) |
| `  No resources found` when the filter matches nothing | `config-selector.ts:407-410` | `config_selector.rs:1027-1030` | — |

## 3. Toggling and persistence

| What | Original | Port | Check |
|---|---|---|---|
| Space/Enter toggles the selected resource | `config-selector.ts:512-525` | `config_selector.rs:960-1005` (`activate`) | `activating_a_resource_in_the_global_scope_flips_the_enabled_flag` |
| Global scope: the enabled flag flips and the settings array is rewritten | `config-selector.ts:534-580` | `config_selector.rs:423-444` (`apply_toggle`) | `apply_toggle_enables_a_resource`, `apply_toggle_disables_a_resource` |
| The existing entry for the resource is replaced, never duplicated (a leading `!`, `+` or `-` is ignored when matching) | `config-selector.ts:556-560` | `config_selector.rs:411-417`, `:430-435` | `apply_toggle_replaces_an_existing_entry_instead_of_duplicating_it`, `apply_toggle_ignores_the_leading_sign_when_matching_an_entry` |
| Project scope: `inherit` → `load` → `unload` → `inherit` | `config-selector.ts:735-741` | `config_selector.rs:501-507` | `the_override_state_cycles_from_inherit_to_load_to_unload`, `activating_a_resource_in_the_project_scope_cycles_the_override` |
| `load` writes `+<pattern>`, `unload` writes `-<pattern>`, `inherit` removes the entries | `config-selector.ts:673-691` | `config_selector.rs:423-444` | `apply_toggle_removes_the_entry_for_the_inherit_state` |
| A resource inherited from the global scope is named by its plain path in the project array | `config-selector.ts:681-686` | `config_selector.rs:447-478` (`apply_project_toggle`) | `apply_project_toggle_names_the_inherited_file` |
| The override state is read back from the settings entries (`-`/`!` → unload, otherwise load) | `config-selector.ts:743-776` | `config_selector.rs:481-498` | `the_override_state_is_read_from_the_settings_entries` |
| The write targets are the four settings arrays `extensions`, `skills`, `prompts`, `themes` | `config-selector.ts:693-698` | `config_selector.rs:217-223` (`ConfigResourceStore`) | — |

---

## 4. What the port adds

The port keeps the persistence behind a trait, because the port's settings live in
`crate::settings::Settings`, which the interactive-mode host owns:

```rust
pub(crate) trait ConfigResourceStore: Send + Sync {
    fn entries(&self, scope: WriteScope, resource_type: ResourceType) -> Vec<String>;
    fn set_entries(&self, scope: WriteScope, resource_type: ResourceType, entries: Vec<String>);
}
```

`ConfigSelector::set_store` installs it; `ConfigSelector::activate` writes through it
and hands the caller a `ToggleOutcome { item_path, enabled, state, scope }`. The
component is not wired into the interactive-mode host yet — the host opens it and
implements the trait over the real settings.

## 5. Known differences from the original

1. **Cursor glyph.** The original draws `"> "` (`config-selector.ts:442`); the port
   draws `"→ "`, the glyph the port's own select list already uses
   (`rpi/crates/rpi-tui/src/select_list.rs:577`). The layout is otherwise identical
   (two columns).
2. **Header.** The port's header follows the original's: the title and the key hint
   share the first line, the settings path is on the second. The port's title is bold
   and accent-coloured; the original's is bold only
   (`config-selector.ts:205`, `config_selector.rs:607-620`).
3. **Package resource pattern.** The original writes a package resource into the
   package's own filter array, relative to the package root
   (`config-selector.ts:582-639`). The port's data model has no per-package resource
   arrays, so a package resource is addressed by its package source
   (`config_selector.rs:403-408`).
4. **Override cycle.** The original's cycle depends on whether the resource is
   enabled in the global scope: from `inherit` it goes to `unload` when the global
   scope has it enabled and to `load` when it has not (`config-selector.ts:735-741`).
   The port uses the fixed `inherit` → `load` → `unload` → `inherit` cycle.
5. **Write target.** The original picks the settings file from the *resource's* scope
   (`config-selector.ts:535-537`); the port picks it from the selector's write scope.
6. **Relative patterns.** The original writes paths relative to the resource's base
   directory (`config-selector.ts:858-868`); the port writes the absolute path of a
   top-level resource.
7. **Not yet reachable from the keyboard.** The original's `ResourceList` handles the
   keys itself (`config-selector.ts:487-525`); the port exposes the same operations as
   methods (`move_up`, `move_down`, `activate`, `set_search_text`) and leaves the key
   routing to the interactive-mode host.
