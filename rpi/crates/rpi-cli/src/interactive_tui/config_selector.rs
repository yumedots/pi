//! Package-resource config selector for the interactive TUI.
//!
//! Port of `packages/coding-agent/src/modes/interactive/components/config-selector.ts`.
//! It lists the resolved package resources (extensions, skills, prompts, themes)
//! grouped by origin, scope and source, and lets the user enable or disable them
//! by rewriting the matching settings array.

use std::any::Any;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use rpi_tui::ansi::bold;
use rpi_tui::component::{Component, Focusable};
use rpi_tui::input::Input;
use rpi_tui::keybinding_hints::raw_key_hint;
use rpi_tui::theme::theme;
use rpi_tui::utils::{truncate_to_width, visible_width};

/// Prefix of built-in resource paths, e.g. `builtin:read`.
pub(crate) const BUILTIN_PATH_PREFIX: &str = "builtin:";

/// Source name used for the built-in resources.
pub(crate) const BUILTIN_SOURCE: &str = "builtin";

/// Source name used for auto-discovered top-level resources.
pub(crate) const AUTO_SOURCE: &str = "auto";

/// Kind of package resource the selector manages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(crate) enum ResourceType {
    Extensions,
    Skills,
    Prompts,
    Themes,
}

impl ResourceType {
    /// Every resource kind, in display order.
    pub(crate) const ALL: [ResourceType; 4] = [
        ResourceType::Extensions,
        ResourceType::Skills,
        ResourceType::Prompts,
        ResourceType::Themes,
    ];

    /// Heading shown above the resources of this kind.
    pub(crate) fn label(self) -> &'static str {
        match self {
            ResourceType::Extensions => "Extensions",
            ResourceType::Skills => "Skills",
            ResourceType::Prompts => "Prompts",
            ResourceType::Themes => "Themes",
        }
    }

    /// Sort rank of this kind inside a group.
    pub(crate) fn order(self) -> usize {
        match self {
            ResourceType::Extensions => 0,
            ResourceType::Skills => 1,
            ResourceType::Prompts => 2,
            ResourceType::Themes => 3,
        }
    }

    /// Key of the settings array that holds this kind of resource.
    pub(crate) fn settings_key(self) -> &'static str {
        match self {
            ResourceType::Extensions => "extensions",
            ResourceType::Skills => "skills",
            ResourceType::Prompts => "prompts",
            ResourceType::Themes => "themes",
        }
    }
}

/// Settings file the selector writes to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum WriteScope {
    Global,
    Project,
}

/// Project-local override of a globally resolved resource.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProjectOverrideState {
    Inherit,
    Load,
    Unload,
}

/// Where a resource comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum ResourceOrigin {
    Package,
    TopLevel,
}

impl ResourceOrigin {
    /// Name of the origin, as used in the original's group keys.
    pub(crate) fn name(self) -> &'static str {
        match self {
            ResourceOrigin::Package => "package",
            ResourceOrigin::TopLevel => "top-level",
        }
    }

    /// Sort rank: packages are listed before top-level resources.
    pub(crate) fn rank(self) -> usize {
        match self {
            ResourceOrigin::Package => 0,
            ResourceOrigin::TopLevel => 1,
        }
    }
}

/// Settings scope a resource was resolved from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum ResourceScope {
    User,
    Project,
    Temporary,
}

impl ResourceScope {
    /// Name of the scope, as used in the original's group labels.
    pub(crate) fn name(self) -> &'static str {
        match self {
            ResourceScope::User => "user",
            ResourceScope::Project => "project",
            ResourceScope::Temporary => "temporary",
        }
    }

    /// Sort rank: user resources are listed before project resources.
    pub(crate) fn rank(self) -> usize {
        match self {
            ResourceScope::User => 0,
            ResourceScope::Project => 1,
            ResourceScope::Temporary => 2,
        }
    }
}

/// Provenance of a resolved resource.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResourceMetadata {
    pub origin: ResourceOrigin,
    pub scope: ResourceScope,
    pub source: String,
    pub base_dir: Option<String>,
}

/// A single selectable resource.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResourceItem {
    pub path: String,
    pub enabled: bool,
    pub metadata: ResourceMetadata,
    pub resource_type: ResourceType,
    pub display_name: String,
}

/// Resources of one kind inside a group.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResourceSubgroup {
    pub resource_type: ResourceType,
    pub label: String,
    pub items: Vec<ResourceItem>,
}

/// Resources that share an origin, scope, source and base directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResourceGroup {
    pub key: String,
    pub label: String,
    pub scope: ResourceScope,
    pub origin: ResourceOrigin,
    pub source: String,
    pub subgroups: Vec<ResourceSubgroup>,
}

/// The four resolved resource lists of one write scope.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ResolvedResources {
    pub extensions: Vec<ResourceItem>,
    pub skills: Vec<ResourceItem>,
    pub prompts: Vec<ResourceItem>,
    pub themes: Vec<ResourceItem>,
}

impl ResolvedResources {
    /// The resources of one kind.
    pub(crate) fn of(&self, resource_type: ResourceType) -> &[ResourceItem] {
        match resource_type {
            ResourceType::Extensions => &self.extensions,
            ResourceType::Skills => &self.skills,
            ResourceType::Prompts => &self.prompts,
            ResourceType::Themes => &self.themes,
        }
    }
}

/// Result of a toggle, handed back to the interactive-mode host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ToggleOutcome {
    pub item_path: String,
    pub enabled: bool,
    pub state: ProjectOverrideState,
    pub scope: WriteScope,
}

/// Persistence backend for the selector.
///
/// The interactive-mode host implements this over `crate::settings::Settings`;
/// the selector itself only reads and rewrites the four resource arrays.
pub(crate) trait ConfigResourceStore: Send + Sync {
    /// Current contents of the settings array for `scope` and `resource_type`.
    fn entries(&self, scope: WriteScope, resource_type: ResourceType) -> Vec<String>;

    /// Replace the settings array for `scope` and `resource_type`.
    fn set_entries(&self, scope: WriteScope, resource_type: ResourceType, entries: Vec<String>);
}

/// Render a base directory for display, replacing the home directory with `~`.
pub(crate) fn format_base_dir(base_dir: &str, home_dir: &str) -> String {
    let display = if !home_dir.is_empty() && base_dir == home_dir {
        "~".to_string()
    } else if !home_dir.is_empty() && base_dir.starts_with(home_dir) {
        format!("~{}", base_dir[home_dir.len()..].replace('\\', "/"))
    } else {
        base_dir.replace('\\', "/")
    };
    if display.ends_with('/') {
        display
    } else {
        format!("{}/", display)
    }
}

/// Heading of the group a resource belongs to.
pub(crate) fn group_label(metadata: &ResourceMetadata, agent_dir: &str, home_dir: &str) -> String {
    if metadata.origin == ResourceOrigin::Package {
        return format!("{} ({})", metadata.source, metadata.scope.name());
    }
    if metadata.source == BUILTIN_SOURCE {
        return if metadata.scope == ResourceScope::User {
            "Built-in".to_string()
        } else {
            "Built-in (project override)".to_string()
        };
    }
    if metadata.source == AUTO_SOURCE {
        return match metadata.base_dir.as_deref() {
            Some(base_dir) => {
                let base = format_base_dir(base_dir, home_dir);
                if metadata.scope == ResourceScope::User {
                    format!("User ({})", base)
                } else {
                    format!("Project ({})", base)
                }
            }
            None => {
                if metadata.scope == ResourceScope::User {
                    format!("User ({})", format_base_dir(agent_dir, home_dir))
                } else {
                    format!("Project ({}/)", crate::config::CONFIG_DIR_NAME)
                }
            }
        };
    }
    if metadata.scope == ResourceScope::User {
        "User settings".to_string()
    } else {
        "Project settings".to_string()
    }
}

/// Label of a resource inside the list.
pub(crate) fn display_name(
    path: &str,
    resource_type: ResourceType,
    builtin_prefix: &str,
) -> String {
    let file_name = path_basename(path);
    let parent_folder = path_basename(path_dirname(path));
    if !builtin_prefix.is_empty() && path.starts_with(builtin_prefix) {
        return path[builtin_prefix.len()..].to_string();
    }
    if resource_type == ResourceType::Extensions && parent_folder != "extensions" {
        return format!("{}/{}", parent_folder, file_name);
    }
    if resource_type == ResourceType::Skills && file_name == "SKILL.md" {
        return parent_folder.to_string();
    }
    file_name.to_string()
}

/// Group the resolved resources the way the original does.
///
/// Packages come first, then top-level resources; user scope before project
/// scope; groups are ordered by source. Inside a group the subgroups follow the
/// extensions → skills → prompts → themes order and the items are sorted by
/// their display name.
pub(crate) fn build_groups(resolved: &ResolvedResources, agent_dir: &str) -> Vec<ResourceGroup> {
    build_groups_with_home(resolved, agent_dir, &home_directory())
}

/// [`build_groups`] with an explicit home directory, for deterministic output.
pub(crate) fn build_groups_with_home(
    resolved: &ResolvedResources,
    agent_dir: &str,
    home_dir: &str,
) -> Vec<ResourceGroup> {
    let mut groups: Vec<ResourceGroup> = Vec::new();

    for resource_type in ResourceType::ALL {
        for resource in resolved.of(resource_type) {
            let metadata = &resource.metadata;
            let group_key = format!(
                "{}:{}:{}:{}",
                metadata.origin.name(),
                metadata.scope.name(),
                metadata.source,
                metadata.base_dir.clone().unwrap_or_default()
            );

            let existing_group = groups.iter().position(|group| group.key == group_key);
            let group_index = match existing_group {
                Some(index) => index,
                None => {
                    groups.push(ResourceGroup {
                        key: group_key.clone(),
                        label: group_label(metadata, agent_dir, home_dir),
                        scope: metadata.scope,
                        origin: metadata.origin,
                        source: metadata.source.clone(),
                        subgroups: Vec::new(),
                    });
                    groups.len() - 1
                }
            };

            let group = &mut groups[group_index];
            let existing_subgroup = group
                .subgroups
                .iter()
                .position(|subgroup| subgroup.resource_type == resource_type);
            let subgroup_index = match existing_subgroup {
                Some(index) => index,
                None => {
                    group.subgroups.push(ResourceSubgroup {
                        resource_type,
                        label: resource_type.label().to_string(),
                        items: Vec::new(),
                    });
                    group.subgroups.len() - 1
                }
            };

            let builtin_prefix = if metadata.source == BUILTIN_SOURCE {
                BUILTIN_PATH_PREFIX
            } else {
                ""
            };
            let name = display_name(&resource.path, resource_type, builtin_prefix);
            group.subgroups[subgroup_index].items.push(ResourceItem {
                path: resource.path.clone(),
                enabled: resource.enabled,
                metadata: metadata.clone(),
                resource_type,
                display_name: name,
            });
        }
    }

    groups.sort_by(|a, b| {
        a.origin
            .rank()
            .cmp(&b.origin.rank())
            .then_with(|| a.scope.rank().cmp(&b.scope.rank()))
            .then_with(|| a.source.cmp(&b.source))
    });

    for group in &mut groups {
        group
            .subgroups
            .sort_by_key(|subgroup| subgroup.resource_type.order());
        for subgroup in &mut group.subgroups {
            subgroup
                .items
                .sort_by(|a, b| a.display_name.cmp(&b.display_name));
        }
    }

    groups
}

/// Pattern a settings entry uses to address a resource.
///
/// A top-level resource is addressed by its path, a package resource by the
/// package source it was resolved from.
pub(crate) fn resource_pattern(item: &ResourceItem) -> String {
    match item.metadata.origin {
        ResourceOrigin::TopLevel => item.path.clone(),
        ResourceOrigin::Package => item.metadata.source.clone(),
    }
}

/// Strip the leading `!`, `+` or `-` of a settings entry.
fn strip_pattern(entry: &str) -> &str {
    match entry.as_bytes().first() {
        Some(b'!') | Some(b'+') | Some(b'-') => &entry[1..],
        _ => entry,
    }
}

/// Rewrite a settings array for one resource.
///
/// Every entry that addresses the resource is dropped (ignoring a leading `!`,
/// `+` or `-`), then `+${pattern}` is appended for `Load` and `-${pattern}` for
/// `Unload`. `Inherit` only removes the entries.
pub(crate) fn apply_toggle(
    entries: &mut Vec<String>,
    item: &ResourceItem,
    state: ProjectOverrideState,
) -> Vec<String> {
    let pattern = resource_pattern(item);
    let mut updated: Vec<String> = entries
        .iter()
        .filter(|entry| strip_pattern(entry) != pattern)
        .cloned()
        .collect();
    match state {
        ProjectOverrideState::Inherit => {}
        ProjectOverrideState::Load => updated.push(format!("+{}", pattern)),
        ProjectOverrideState::Unload => updated.push(format!("-{}", pattern)),
    }
    *entries = updated.clone();
    updated
}

/// Rewrite the project settings array for one resource.
///
/// A resource inherited from the global scope is named by its plain path in the
/// project array, so the project states which file it overrides.
pub(crate) fn apply_project_toggle(
    entries: &mut Vec<String>,
    item: &ResourceItem,
    state: ProjectOverrideState,
) -> Vec<String> {
    let mut updated = apply_toggle(entries, item, state);
    if state == ProjectOverrideState::Inherit {
        return updated;
    }
    if item.metadata.origin != ResourceOrigin::TopLevel {
        return updated;
    }
    if item.metadata.scope != ResourceScope::User {
        return updated;
    }
    if item.metadata.source == BUILTIN_SOURCE {
        return updated;
    }
    let sign = if state == ProjectOverrideState::Load {
        "+"
    } else {
        "-"
    };
    let signed = format!("{}{}", sign, resource_pattern(item));
    let position = updated.iter().position(|entry| *entry == signed);
    match position {
        Some(index) => updated.insert(index, item.path.clone()),
        None => updated.push(item.path.clone()),
    }
    *entries = updated.clone();
    updated
}

/// Override state a settings array states for one resource.
pub(crate) fn override_state_from_entries(
    entries: &[String],
    item: &ResourceItem,
) -> ProjectOverrideState {
    let pattern = resource_pattern(item);
    let mut state = ProjectOverrideState::Inherit;
    for entry in entries {
        if strip_pattern(entry) != pattern {
            continue;
        }
        state = if entry.starts_with('!') || entry.starts_with('-') {
            ProjectOverrideState::Unload
        } else {
            ProjectOverrideState::Load
        };
    }
    state
}

/// Next state of the `inherit` → `load` → `unload` → `inherit` cycle.
pub(crate) fn next_override_state(state: ProjectOverrideState) -> ProjectOverrideState {
    match state {
        ProjectOverrideState::Inherit => ProjectOverrideState::Load,
        ProjectOverrideState::Load => ProjectOverrideState::Unload,
        ProjectOverrideState::Unload => ProjectOverrideState::Inherit,
    }
}

/// Home directory of the current user.
fn home_directory() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default()
}

/// Last path segment of a path.
fn path_basename(path: &str) -> &str {
    let trimmed = path.trim_end_matches(['/', '\\']);
    match trimmed.rfind(['/', '\\']) {
        Some(index) => &trimmed[index + 1..],
        None => trimmed,
    }
}

/// Parent directory of a path.
fn path_dirname(path: &str) -> &str {
    let trimmed = path.trim_end_matches(['/', '\\']);
    match trimmed.rfind(['/', '\\']) {
        Some(index) => &trimmed[..index],
        None => ".",
    }
}

/// One entry of the flattened resource list.
#[derive(Debug, Clone)]
enum FlatEntry {
    Group {
        group_index: usize,
        label: String,
        scope: ResourceScope,
    },
    Subgroup {
        group_index: usize,
        subgroup_index: usize,
        label: String,
        scope: ResourceScope,
    },
    Item {
        item: ResourceItem,
    },
}

/// Header of the selector: the title and the key hint.
pub(crate) struct ConfigSelectorHeader {
    write_scope: WriteScope,
    project_mode_available: bool,
}

impl ConfigSelectorHeader {
    /// Build a header for the given write scope.
    pub(crate) fn new(write_scope: WriteScope, project_mode_available: bool) -> Self {
        Self {
            write_scope,
            project_mode_available,
        }
    }

    /// Switch the header to another write scope.
    pub(crate) fn set_write_scope(&mut self, scope: WriteScope) {
        self.write_scope = scope;
    }

    /// Title of the header.
    pub(crate) fn title(&self) -> &'static str {
        match self.write_scope {
            WriteScope::Project => "Project Local Resources",
            WriteScope::Global => "Global Resources",
        }
    }

    /// Key hint of the header.
    pub(crate) fn hint(&self) -> String {
        let action = match self.write_scope {
            WriteScope::Project => raw_key_hint("space", "cycle inherit/+/-"),
            WriteScope::Global => raw_key_hint("space", "toggle"),
        };
        let mut parts: Vec<String> = Vec::new();
        if self.project_mode_available {
            parts.push(raw_key_hint("tab", "switch mode"));
        }
        parts.push(action);
        parts.push(raw_key_hint("esc", "close"));
        parts.join(" · ")
    }

    /// The line under the title: which settings file this scope writes.
    pub(crate) fn scope_hint(&self) -> String {
        match self.write_scope {
            WriteScope::Project => {
                ".pi/settings.json · inherited global resources are dimmed".to_string()
            }
            WriteScope::Global => "~/.pi/agent/settings.json".to_string(),
        }
    }

    /// Render the header.
    pub(crate) fn render(&self, width: usize) -> Vec<String> {
        let colors = theme().colors;
        let title = bold(self.title());
        let hint = self.hint();
        let pad = width
            .saturating_sub(visible_width(&title))
            .saturating_sub(visible_width(&hint))
            .max(1);
        vec![
            truncate_to_width(&format!("{title}{}{hint}", " ".repeat(pad)), width, ""),
            truncate_to_width(&colors.muted.fg(&self.scope_hint()), width, ""),
        ]
    }
}

/// Mutable state of the selector.
struct ConfigSelectorState {
    groups_by_scope: HashMap<WriteScope, Vec<ResourceGroup>>,
    write_scope: WriteScope,
    header: ConfigSelectorHeader,
    project_mode_available: bool,
    entries: Vec<FlatEntry>,
    filtered: Vec<FlatEntry>,
    selected: usize,
    search: Input,
    store: Option<Arc<dyn ConfigResourceStore>>,
    on_toggle: Option<Arc<dyn Fn(&ResourceItem, bool) + Send + Sync>>,
    focused: bool,
}

impl ConfigSelectorState {
    /// Rebuild the flattened list from the groups of the current write scope.
    fn rebuild_flat(&mut self) {
        let groups = self
            .groups_by_scope
            .get(&self.write_scope)
            .cloned()
            .unwrap_or_default();
        let mut entries = Vec::new();
        for (group_index, group) in groups.iter().enumerate() {
            entries.push(FlatEntry::Group {
                group_index,
                label: group.label.clone(),
                scope: group.scope,
            });
            for (subgroup_index, subgroup) in group.subgroups.iter().enumerate() {
                entries.push(FlatEntry::Subgroup {
                    group_index,
                    subgroup_index,
                    label: subgroup.label.clone(),
                    scope: group.scope,
                });
                for item in &subgroup.items {
                    entries.push(FlatEntry::Item { item: item.clone() });
                }
            }
        }
        self.entries = entries;
        self.apply_filter();
    }

    /// Filter the flattened list by the search text.
    fn apply_filter(&mut self) {
        let query = self.search.get_value().trim().to_lowercase();
        if query.is_empty() {
            self.filtered = self.entries.clone();
            self.select_first_item();
            return;
        }

        let groups = self
            .groups_by_scope
            .get(&self.write_scope)
            .cloned()
            .unwrap_or_default();

        let mut matching_items: HashSet<String> = HashSet::new();
        for entry in &self.entries {
            if let FlatEntry::Item { item } = entry {
                let hit = item.display_name.to_lowercase().contains(&query)
                    || item.resource_type.settings_key().contains(&query)
                    || item.path.to_lowercase().contains(&query);
                if hit {
                    matching_items.insert(item_key(item));
                }
            }
        }

        let mut matching_subgroups: HashSet<(usize, usize)> = HashSet::new();
        for (group_index, group) in groups.iter().enumerate() {
            for (subgroup_index, subgroup) in group.subgroups.iter().enumerate() {
                if subgroup
                    .items
                    .iter()
                    .any(|item| matching_items.contains(&item_key(item)))
                {
                    matching_subgroups.insert((group_index, subgroup_index));
                }
            }
        }

        self.filtered = self
            .entries
            .iter()
            .filter(|entry| match entry {
                FlatEntry::Group { group_index, .. } => groups
                    .get(*group_index)
                    .map(|group| {
                        group
                            .subgroups
                            .iter()
                            .enumerate()
                            .any(|(subgroup_index, _)| {
                                matching_subgroups.contains(&(*group_index, subgroup_index))
                            })
                    })
                    .unwrap_or(false),
                FlatEntry::Subgroup {
                    group_index,
                    subgroup_index,
                    ..
                } => matching_subgroups.contains(&(*group_index, *subgroup_index)),
                FlatEntry::Item { item } => matching_items.contains(&item_key(item)),
            })
            .cloned()
            .collect();
        self.select_first_item();
    }

    /// Move the selection to the first resource of the filtered list.
    fn select_first_item(&mut self) {
        self.selected = self
            .filtered
            .iter()
            .position(|entry| matches!(entry, FlatEntry::Item { .. }))
            .unwrap_or(0);
    }

    /// The resource under the selection.
    fn selected_item(&self) -> Option<&ResourceItem> {
        match self.filtered.get(self.selected) {
            Some(FlatEntry::Item { item }) => Some(item),
            _ => None,
        }
    }

    /// Move the selection to the next resource in `direction`.
    fn move_selection(&mut self, direction: isize) {
        let len = self.filtered.len();
        if len == 0 {
            return;
        }
        let mut index = self.selected as isize;
        loop {
            index += direction;
            if index < 0 || index >= len as isize {
                return;
            }
            if matches!(self.filtered[index as usize], FlatEntry::Item { .. }) {
                self.selected = index as usize;
                return;
            }
        }
    }

    /// Entries of the project settings array of one resource kind.
    fn project_entries(&self, resource_type: ResourceType) -> Vec<String> {
        match &self.store {
            Some(store) => store.entries(WriteScope::Project, resource_type),
            None => Vec::new(),
        }
    }

    /// Override state of one resource in the project scope.
    fn override_state(&self, item: &ResourceItem, entries: &[String]) -> ProjectOverrideState {
        if self.write_scope != WriteScope::Project {
            return ProjectOverrideState::Inherit;
        }
        override_state_from_entries(entries, item)
    }

    /// Override state of one resource, read from the project settings array.
    fn current_override_state(&self, item: &ResourceItem) -> ProjectOverrideState {
        if self.write_scope != WriteScope::Project {
            return ProjectOverrideState::Inherit;
        }
        let entries = self.project_entries(item.resource_type);
        override_state_from_entries(&entries, item)
    }

    /// Whether the resource is inherited from the global scope.
    fn is_inherited_global(&self, item: &ResourceItem) -> bool {
        if item.metadata.scope == ResourceScope::User {
            return true;
        }
        self.global_enabled(item).is_some()
    }

    /// Enabled flag of the resource in the global scope.
    fn global_enabled(&self, item: &ResourceItem) -> Option<bool> {
        let groups = self.groups_by_scope.get(&WriteScope::Global)?;
        for group in groups {
            for subgroup in &group.subgroups {
                for candidate in &subgroup.items {
                    if item_key(candidate) == item_key(item) {
                        return Some(candidate.enabled);
                    }
                }
            }
        }
        None
    }

    /// Enabled flag a resource inherits from the global scope.
    fn inherited_enabled(&self, item: &ResourceItem) -> bool {
        self.global_enabled(item)
            .unwrap_or(if item.metadata.scope == ResourceScope::User {
                item.enabled
            } else {
                true
            })
    }

    /// Write the new state of a resource into the settings array.
    fn persist(&self, item: &ResourceItem, state: ProjectOverrideState, scope: WriteScope) {
        let Some(store) = self.store.as_ref() else {
            return;
        };
        let mut entries = store.entries(scope, item.resource_type);
        entries = if scope == WriteScope::Project {
            apply_project_toggle(&mut entries, item, state)
        } else {
            apply_toggle(&mut entries, item, state)
        };
        store.set_entries(scope, item.resource_type, entries);
    }

    /// Update the enabled flag of a resource in the list and in the groups.
    fn update_item_enabled(&mut self, item: &ResourceItem, enabled: bool) {
        for entry in &mut self.entries {
            if let FlatEntry::Item { item: candidate } = entry {
                if item_key(candidate) == item_key(item) {
                    candidate.enabled = enabled;
                }
            }
        }
        for entry in &mut self.filtered {
            if let FlatEntry::Item { item: candidate } = entry {
                if item_key(candidate) == item_key(item) {
                    candidate.enabled = enabled;
                }
            }
        }
        if let Some(groups) = self.groups_by_scope.get_mut(&self.write_scope) {
            for group in groups.iter_mut() {
                for subgroup in group.subgroups.iter_mut() {
                    for candidate in subgroup.items.iter_mut() {
                        if item_key(candidate) == item_key(item) {
                            candidate.enabled = enabled;
                        }
                    }
                }
            }
        }
    }
}

/// Key of a resource: its kind and its path.
fn item_key(item: &ResourceItem) -> String {
    format!("{}:{}", item.resource_type.settings_key(), item.path)
}

/// TUI component that lists and toggles the package resources.
pub(crate) struct ConfigSelector {
    state: Mutex<ConfigSelectorState>,
}

impl ConfigSelector {
    /// Build a selector over the groups of one write scope.
    pub(crate) fn new(
        groups: Vec<ResourceGroup>,
        write_scope: WriteScope,
        project_mode_available: bool,
    ) -> Self {
        let mut state = ConfigSelectorState {
            groups_by_scope: HashMap::new(),
            write_scope,
            header: ConfigSelectorHeader::new(write_scope, project_mode_available),
            project_mode_available,
            entries: Vec::new(),
            filtered: Vec::new(),
            selected: 0,
            search: Input::new(),
            store: None,
            on_toggle: None,
            focused: false,
        };
        state.groups_by_scope.insert(write_scope, groups);
        state.rebuild_flat();
        Self {
            state: Mutex::new(state),
        }
    }

    /// Install the groups of a write scope.
    pub(crate) fn set_groups(&self, scope: WriteScope, groups: Vec<ResourceGroup>) {
        let mut state = self.lock();
        state.groups_by_scope.insert(scope, groups);
        if state.write_scope == scope {
            state.rebuild_flat();
        }
    }

    /// Switch to another write scope.
    pub(crate) fn set_write_scope(&self, scope: WriteScope) {
        let mut state = self.lock();
        if scope == WriteScope::Project && !state.project_mode_available {
            return;
        }
        if state.write_scope == scope {
            return;
        }
        state.write_scope = scope;
        state.header.set_write_scope(scope);
        state.rebuild_flat();
    }

    /// The write scope the selector edits.
    pub(crate) fn write_scope(&self) -> WriteScope {
        self.lock().write_scope
    }

    /// Whether the project scope can be selected.
    pub(crate) fn project_mode_available(&self) -> bool {
        self.lock().project_mode_available
    }

    /// Set the search query and filter the list.
    pub(crate) fn set_search_text(&self, text: &str) {
        let mut state = self.lock();
        state.search.set_value(text);
        state.apply_filter();
    }

    /// The current search query.
    pub(crate) fn search_text(&self) -> String {
        self.lock().search.get_value()
    }

    /// Index of the selection inside the filtered list.
    pub(crate) fn selected_index(&self) -> usize {
        self.lock().selected
    }

    /// Number of entries of the filtered list.
    pub(crate) fn flattened_len(&self) -> usize {
        self.lock().filtered.len()
    }

    /// The resource under the selection.
    pub(crate) fn selected_item(&self) -> Option<ResourceItem> {
        self.lock().selected_item().cloned()
    }

    /// Move the selection to the previous resource.
    pub(crate) fn move_up(&self) {
        self.lock().move_selection(-1);
    }

    /// Move the selection to the next resource.
    pub(crate) fn move_down(&self) {
        self.lock().move_selection(1);
    }

    /// Toggle the resource under the selection.
    ///
    /// In the global scope the enabled flag flips; in the project scope the
    /// override cycles through `inherit` → `load` → `unload` → `inherit`.
    pub(crate) fn activate(&self) -> Option<ToggleOutcome> {
        let mut state = self.lock();
        let item = state.selected_item()?.clone();
        let scope = state.write_scope;
        let (enabled, override_state) = match scope {
            WriteScope::Global => {
                let enabled = !item.enabled;
                let override_state = if enabled {
                    ProjectOverrideState::Load
                } else {
                    ProjectOverrideState::Unload
                };
                (enabled, override_state)
            }
            WriteScope::Project => {
                let current = state.current_override_state(&item);
                let next = next_override_state(current);
                let enabled = match next {
                    ProjectOverrideState::Inherit => state.inherited_enabled(&item),
                    ProjectOverrideState::Load => true,
                    ProjectOverrideState::Unload => false,
                };
                (enabled, next)
            }
        };
        state.persist(&item, override_state, scope);
        state.update_item_enabled(&item, enabled);
        let outcome = ToggleOutcome {
            item_path: item.path.clone(),
            enabled,
            state: override_state,
            scope,
        };
        let callback = state.on_toggle.clone();
        drop(state);
        if let Some(callback) = callback {
            callback(&item, outcome.enabled);
        }
        Some(outcome)
    }

    /// Register the callback that runs after a resource was toggled.
    pub(crate) fn on_toggle(&self, callback: Arc<dyn Fn(&ResourceItem, bool) + Send + Sync>) {
        let mut state = self.lock();
        state.on_toggle = Some(callback);
    }

    /// Install the persistence backend.
    pub(crate) fn set_store(&self, store: Arc<dyn ConfigResourceStore>) {
        let mut state = self.lock();
        state.store = Some(store);
    }

    /// Lock the state, ignoring a poisoned lock.
    fn lock(&self) -> std::sync::MutexGuard<'_, ConfigSelectorState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

impl Component for ConfigSelector {
    fn render(&self, width: usize) -> Vec<String> {
        let state = self.lock();
        let colors = theme().colors;
        let mut lines = state.header.render(width);
        lines.extend(state.search.render(width));
        lines.push(String::new());

        if state.filtered.is_empty() {
            lines.push(colors.muted.fg("  No resources found"));
            return lines;
        }

        let mut project_entries: HashMap<ResourceType, Vec<String>> = HashMap::new();
        if state.write_scope == WriteScope::Project {
            for resource_type in ResourceType::ALL {
                project_entries.insert(resource_type, state.project_entries(resource_type));
            }
        }

        for (index, entry) in state.filtered.iter().enumerate() {
            let selected = index == state.selected;
            match entry {
                FlatEntry::Group { label, scope, .. } => {
                    let inherited =
                        state.write_scope == WriteScope::Project && *scope == ResourceScope::User;
                    let text = if inherited {
                        format!("{} · inherited global", label)
                    } else {
                        label.clone()
                    };
                    let styled = if inherited {
                        colors.dim.fg(&bold(&text))
                    } else {
                        colors.accent.fg(&bold(&text))
                    };
                    lines.push(truncate_to_width(&format!("  {}", styled), width, ""));
                }
                FlatEntry::Subgroup { label, scope, .. } => {
                    let inherited =
                        state.write_scope == WriteScope::Project && *scope == ResourceScope::User;
                    let color = if inherited { colors.dim } else { colors.muted };
                    lines.push(truncate_to_width(
                        &format!("    {}", color.fg(label)),
                        width,
                        "",
                    ));
                }
                FlatEntry::Item { item } => {
                    let cursor = if selected { "→ " } else { "  " };
                    let override_state = state.override_state(
                        item,
                        project_entries
                            .get(&item.resource_type)
                            .map(|entries| entries.as_slice())
                            .unwrap_or(&[]),
                    );
                    let inherited_global = state.is_inherited_global(item);
                    let dimmed = state.write_scope == WriteScope::Project
                        && inherited_global
                        && override_state == ProjectOverrideState::Inherit;
                    let name_text = if selected && !dimmed {
                        bold(&item.display_name)
                    } else {
                        item.display_name.clone()
                    };
                    let name = if dimmed {
                        colors.dim.fg(&name_text)
                    } else {
                        name_text
                    };
                    let checkbox =
                        render_checkbox(&colors, item, state.write_scope, override_state);
                    let suffix = render_suffix(
                        &colors,
                        item,
                        state.write_scope,
                        override_state,
                        inherited_global,
                    );
                    lines.push(truncate_to_width(
                        &format!("{}    {} {}{}", cursor, checkbox, name, suffix),
                        width,
                        "...",
                    ));
                }
            }
        }

        lines
    }

    fn invalidate(&self) {}

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_focusable(&self) -> Option<&dyn Focusable> {
        Some(self)
    }
}

impl Focusable for ConfigSelector {
    fn set_focused(&self, focused: bool) {
        let mut state = self.lock();
        state.focused = focused;
    }

    fn is_focused(&self) -> bool {
        self.lock().focused
    }
}

/// Checkbox of a resource.
fn render_checkbox(
    colors: &rpi_tui::theme::ThemeColors,
    item: &ResourceItem,
    scope: WriteScope,
    override_state: ProjectOverrideState,
) -> String {
    if scope == WriteScope::Project {
        match override_state {
            ProjectOverrideState::Load => return colors.success.fg("[+]"),
            ProjectOverrideState::Unload => return colors.warning.fg("[-]"),
            ProjectOverrideState::Inherit => {}
        }
    }
    if item.enabled {
        colors.success.fg("[x]")
    } else {
        colors.dim.fg("[ ]")
    }
}

/// Suffix that names the project override of a resource.
fn render_suffix(
    colors: &rpi_tui::theme::ThemeColors,
    _item: &ResourceItem,
    scope: WriteScope,
    override_state: ProjectOverrideState,
    inherited_global: bool,
) -> String {
    if scope != WriteScope::Project {
        return String::new();
    }
    match override_state {
        ProjectOverrideState::Load => colors.muted.fg("  project load"),
        ProjectOverrideState::Unload => colors.muted.fg("  project unload"),
        ProjectOverrideState::Inherit => {
            if inherited_global {
                colors.dim.fg("  inherited global")
            } else {
                String::new()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rpi_tui::ansi::strip_ansi;

    fn metadata(
        origin: ResourceOrigin,
        scope: ResourceScope,
        source: &str,
        base_dir: Option<&str>,
    ) -> ResourceMetadata {
        ResourceMetadata {
            origin,
            scope,
            source: source.to_string(),
            base_dir: base_dir.map(|dir| dir.to_string()),
        }
    }

    fn item(
        path: &str,
        enabled: bool,
        metadata: ResourceMetadata,
        resource_type: ResourceType,
    ) -> ResourceItem {
        ResourceItem {
            path: path.to_string(),
            enabled,
            metadata,
            resource_type,
            display_name: String::new(),
        }
    }

    fn top_level(path: &str, enabled: bool, resource_type: ResourceType) -> ResourceItem {
        item(
            path,
            enabled,
            metadata(
                ResourceOrigin::TopLevel,
                ResourceScope::User,
                AUTO_SOURCE,
                Some("/home/u/.pi/agent"),
            ),
            resource_type,
        )
    }

    fn group_of<'a>(
        groups: &'a [ResourceGroup],
        origin: ResourceOrigin,
        source: &str,
    ) -> &'a ResourceGroup {
        groups
            .iter()
            .find(|group| group.origin == origin && group.source == source)
            .expect("group")
    }

    #[test]
    fn format_base_dir_replaces_the_home_directory() {
        assert_eq!(format_base_dir("/home/u", "/home/u"), "~/");
        assert_eq!(
            format_base_dir("/home/u/.pi/agent", "/home/u"),
            "~/.pi/agent/"
        );
        assert_eq!(format_base_dir("/home/u/x/", "/home/u"), "~/x/");
    }

    #[test]
    fn format_base_dir_keeps_paths_outside_the_home_directory() {
        assert_eq!(format_base_dir("/opt/tools", "/home/u"), "/opt/tools/");
        assert_eq!(format_base_dir("/opt/tools/", "/home/u"), "/opt/tools/");
        assert_eq!(format_base_dir("C:\\tools", "/home/u"), "C:/tools/");
    }

    #[test]
    fn group_label_names_packages_with_their_scope() {
        let meta = metadata(
            ResourceOrigin::Package,
            ResourceScope::User,
            "npm:pkg",
            None,
        );
        assert_eq!(
            group_label(&meta, "/home/u/.pi/agent", "/home/u"),
            "npm:pkg (user)"
        );
        let meta = metadata(
            ResourceOrigin::Package,
            ResourceScope::Project,
            "npm:pkg",
            None,
        );
        assert_eq!(
            group_label(&meta, "/home/u/.pi/agent", "/home/u"),
            "npm:pkg (project)"
        );
    }

    #[test]
    fn group_label_names_the_builtin_source() {
        let meta = metadata(
            ResourceOrigin::TopLevel,
            ResourceScope::User,
            BUILTIN_SOURCE,
            None,
        );
        assert_eq!(
            group_label(&meta, "/home/u/.pi/agent", "/home/u"),
            "Built-in"
        );
        let meta = metadata(
            ResourceOrigin::TopLevel,
            ResourceScope::Project,
            BUILTIN_SOURCE,
            None,
        );
        assert_eq!(
            group_label(&meta, "/home/u/.pi/agent", "/home/u"),
            "Built-in (project override)"
        );
    }

    #[test]
    fn group_label_names_auto_discovered_resources() {
        let meta = metadata(
            ResourceOrigin::TopLevel,
            ResourceScope::User,
            AUTO_SOURCE,
            Some("/home/u/.pi/agent"),
        );
        assert_eq!(
            group_label(&meta, "/home/u/.pi/agent", "/home/u"),
            "User (~/.pi/agent/)"
        );
        let meta = metadata(
            ResourceOrigin::TopLevel,
            ResourceScope::Project,
            AUTO_SOURCE,
            Some("/proj/.pi"),
        );
        assert_eq!(
            group_label(&meta, "/home/u/.pi/agent", "/home/u"),
            "Project (/proj/.pi/)"
        );
        let meta = metadata(
            ResourceOrigin::TopLevel,
            ResourceScope::User,
            AUTO_SOURCE,
            None,
        );
        assert_eq!(
            group_label(&meta, "/home/u/.pi/agent", "/home/u"),
            "User (~/.pi/agent/)"
        );
        let meta = metadata(
            ResourceOrigin::TopLevel,
            ResourceScope::Project,
            AUTO_SOURCE,
            None,
        );
        assert_eq!(
            group_label(&meta, "/home/u/.pi/agent", "/home/u"),
            format!("Project ({}/)", crate::config::CONFIG_DIR_NAME)
        );
    }

    #[test]
    fn group_label_names_the_settings_sources() {
        let meta = metadata(
            ResourceOrigin::TopLevel,
            ResourceScope::User,
            "settings",
            None,
        );
        assert_eq!(
            group_label(&meta, "/home/u/.pi/agent", "/home/u"),
            "User settings"
        );
        let meta = metadata(
            ResourceOrigin::TopLevel,
            ResourceScope::Project,
            "settings",
            None,
        );
        assert_eq!(
            group_label(&meta, "/home/u/.pi/agent", "/home/u"),
            "Project settings"
        );
    }

    #[test]
    fn display_name_names_the_folder_of_an_extension() {
        assert_eq!(
            display_name(
                "/home/u/.pi/agent/extensions/my-ext/index.ts",
                ResourceType::Extensions,
                BUILTIN_PATH_PREFIX
            ),
            "my-ext/index.ts"
        );
        assert_eq!(
            display_name(
                "/home/u/.pi/agent/extensions/plain.ts",
                ResourceType::Extensions,
                BUILTIN_PATH_PREFIX
            ),
            "plain.ts"
        );
    }

    #[test]
    fn display_name_names_the_folder_of_a_skill() {
        assert_eq!(
            display_name(
                "/home/u/.pi/agent/skills/my-skill/SKILL.md",
                ResourceType::Skills,
                BUILTIN_PATH_PREFIX
            ),
            "my-skill"
        );
        assert_eq!(
            display_name(
                "/home/u/.pi/agent/skills/other.md",
                ResourceType::Skills,
                BUILTIN_PATH_PREFIX
            ),
            "other.md"
        );
    }

    #[test]
    fn display_name_strips_the_builtin_prefix() {
        assert_eq!(
            display_name(
                "builtin:read",
                ResourceType::Extensions,
                BUILTIN_PATH_PREFIX
            ),
            "read"
        );
        assert_eq!(
            display_name("builtin:mcp", ResourceType::Extensions, BUILTIN_PATH_PREFIX),
            "mcp"
        );
    }

    fn resolved_fixture() -> ResolvedResources {
        ResolvedResources {
            extensions: vec![
                top_level(
                    "/home/u/.pi/agent/extensions/zeta.ts",
                    true,
                    ResourceType::Extensions,
                ),
                top_level(
                    "/home/u/.pi/agent/extensions/alpha.ts",
                    true,
                    ResourceType::Extensions,
                ),
                item(
                    "npm:pkg/ext.ts",
                    true,
                    metadata(
                        ResourceOrigin::Package,
                        ResourceScope::User,
                        "npm:pkg",
                        None,
                    ),
                    ResourceType::Extensions,
                ),
            ],
            skills: vec![top_level(
                "/home/u/.pi/agent/skills/beta/SKILL.md",
                true,
                ResourceType::Skills,
            )],
            prompts: vec![item(
                "/proj/.pi/prompts/greet.md",
                false,
                metadata(
                    ResourceOrigin::TopLevel,
                    ResourceScope::Project,
                    AUTO_SOURCE,
                    Some("/proj/.pi"),
                ),
                ResourceType::Prompts,
            )],
            themes: Vec::new(),
        }
    }

    #[test]
    fn build_groups_orders_packages_before_top_level_resources() {
        let groups = build_groups_with_home(&resolved_fixture(), "/home/u/.pi/agent", "/home/u");
        assert_eq!(groups.len(), 3);
        assert_eq!(groups[0].origin, ResourceOrigin::Package);
        assert_eq!(groups[1].origin, ResourceOrigin::TopLevel);
        assert_eq!(groups[1].scope, ResourceScope::User);
        assert_eq!(groups[2].scope, ResourceScope::Project);
    }

    #[test]
    fn build_groups_orders_the_subgroups_by_resource_type() {
        let groups = build_groups_with_home(&resolved_fixture(), "/home/u/.pi/agent", "/home/u");
        let group = group_of(&groups, ResourceOrigin::TopLevel, AUTO_SOURCE);
        let kinds: Vec<ResourceType> = group
            .subgroups
            .iter()
            .map(|subgroup| subgroup.resource_type)
            .collect();
        assert_eq!(kinds, vec![ResourceType::Extensions, ResourceType::Skills]);
        let group = group_of(&groups, ResourceOrigin::TopLevel, AUTO_SOURCE);
        let labels: Vec<&str> = group
            .subgroups
            .iter()
            .map(|subgroup| subgroup.label.as_str())
            .collect();
        assert_eq!(labels, vec!["Extensions", "Skills"]);
    }

    #[test]
    fn build_groups_sorts_the_items_by_display_name() {
        let groups = build_groups_with_home(&resolved_fixture(), "/home/u/.pi/agent", "/home/u");
        let group = group_of(&groups, ResourceOrigin::TopLevel, AUTO_SOURCE);
        let names: Vec<&str> = group.subgroups[0]
            .items
            .iter()
            .map(|item| item.display_name.as_str())
            .collect();
        assert_eq!(names, vec!["alpha.ts", "zeta.ts"]);
    }

    #[test]
    fn apply_toggle_enables_a_resource() {
        let resource = top_level(
            "/home/u/.pi/agent/extensions/a.ts",
            false,
            ResourceType::Extensions,
        );
        let mut entries: Vec<String> = Vec::new();
        let updated = apply_toggle(&mut entries, &resource, ProjectOverrideState::Load);
        assert_eq!(
            updated,
            vec!["+/home/u/.pi/agent/extensions/a.ts".to_string()]
        );
        assert_eq!(entries, updated);
    }

    #[test]
    fn apply_toggle_disables_a_resource() {
        let resource = top_level(
            "/home/u/.pi/agent/extensions/a.ts",
            true,
            ResourceType::Extensions,
        );
        let mut entries = vec!["+/home/u/.pi/agent/extensions/a.ts".to_string()];
        let updated = apply_toggle(&mut entries, &resource, ProjectOverrideState::Unload);
        assert_eq!(
            updated,
            vec!["-/home/u/.pi/agent/extensions/a.ts".to_string()]
        );
    }

    #[test]
    fn apply_toggle_replaces_an_existing_entry_instead_of_duplicating_it() {
        let resource = top_level(
            "/home/u/.pi/agent/extensions/a.ts",
            true,
            ResourceType::Extensions,
        );
        let mut entries = vec![
            "+/home/u/.pi/agent/extensions/a.ts".to_string(),
            "other.ts".to_string(),
        ];
        let updated = apply_toggle(&mut entries, &resource, ProjectOverrideState::Load);
        assert_eq!(
            updated,
            vec![
                "other.ts".to_string(),
                "+/home/u/.pi/agent/extensions/a.ts".to_string()
            ]
        );
    }

    #[test]
    fn apply_toggle_removes_the_entry_for_the_inherit_state() {
        let resource = top_level(
            "/home/u/.pi/agent/extensions/a.ts",
            true,
            ResourceType::Extensions,
        );
        let mut entries = vec![
            "-/home/u/.pi/agent/extensions/a.ts".to_string(),
            "other.ts".to_string(),
        ];
        let updated = apply_toggle(&mut entries, &resource, ProjectOverrideState::Inherit);
        assert_eq!(updated, vec!["other.ts".to_string()]);
    }

    #[test]
    fn apply_toggle_ignores_the_leading_sign_when_matching_an_entry() {
        let resource = top_level(
            "/home/u/.pi/agent/extensions/a.ts",
            true,
            ResourceType::Extensions,
        );
        let mut entries = vec!["!/home/u/.pi/agent/extensions/a.ts".to_string()];
        let updated = apply_toggle(&mut entries, &resource, ProjectOverrideState::Load);
        assert_eq!(
            updated,
            vec!["+/home/u/.pi/agent/extensions/a.ts".to_string()]
        );
    }

    #[test]
    fn apply_toggle_uses_the_package_source_for_package_resources() {
        let resource = item(
            "npm:pkg/ext.ts",
            false,
            metadata(
                ResourceOrigin::Package,
                ResourceScope::User,
                "npm:pkg",
                None,
            ),
            ResourceType::Extensions,
        );
        let mut entries: Vec<String> = Vec::new();
        let updated = apply_toggle(&mut entries, &resource, ProjectOverrideState::Load);
        assert_eq!(updated, vec!["+npm:pkg".to_string()]);
    }

    #[test]
    fn the_override_state_cycles_from_inherit_to_load_to_unload() {
        assert_eq!(
            next_override_state(ProjectOverrideState::Inherit),
            ProjectOverrideState::Load
        );
        assert_eq!(
            next_override_state(ProjectOverrideState::Load),
            ProjectOverrideState::Unload
        );
        assert_eq!(
            next_override_state(ProjectOverrideState::Unload),
            ProjectOverrideState::Inherit
        );
    }

    #[test]
    fn apply_project_toggle_names_the_inherited_file() {
        let resource = top_level(
            "/home/u/.pi/agent/extensions/a.ts",
            true,
            ResourceType::Extensions,
        );
        let mut entries: Vec<String> = Vec::new();
        let updated = apply_project_toggle(&mut entries, &resource, ProjectOverrideState::Load);
        assert_eq!(
            updated,
            vec![
                "/home/u/.pi/agent/extensions/a.ts".to_string(),
                "+/home/u/.pi/agent/extensions/a.ts".to_string()
            ]
        );
    }

    #[test]
    fn the_override_state_is_read_from_the_settings_entries() {
        let resource = top_level(
            "/home/u/.pi/agent/extensions/a.ts",
            true,
            ResourceType::Extensions,
        );
        assert_eq!(
            override_state_from_entries(&[], &resource),
            ProjectOverrideState::Inherit
        );
        assert_eq!(
            override_state_from_entries(
                &["+/home/u/.pi/agent/extensions/a.ts".to_string()],
                &resource
            ),
            ProjectOverrideState::Load
        );
        assert_eq!(
            override_state_from_entries(
                &["-/home/u/.pi/agent/extensions/a.ts".to_string()],
                &resource
            ),
            ProjectOverrideState::Unload
        );
    }

    struct MemoryStore {
        global: Mutex<HashMap<ResourceType, Vec<String>>>,
        project: Mutex<HashMap<ResourceType, Vec<String>>>,
    }

    impl MemoryStore {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                global: Mutex::new(HashMap::new()),
                project: Mutex::new(HashMap::new()),
            })
        }
    }

    impl ConfigResourceStore for MemoryStore {
        fn entries(&self, scope: WriteScope, resource_type: ResourceType) -> Vec<String> {
            let map = match scope {
                WriteScope::Global => &self.global,
                WriteScope::Project => &self.project,
            };
            map.lock()
                .unwrap_or_else(|error| error.into_inner())
                .get(&resource_type)
                .cloned()
                .unwrap_or_default()
        }

        fn set_entries(
            &self,
            scope: WriteScope,
            resource_type: ResourceType,
            entries: Vec<String>,
        ) {
            let map = match scope {
                WriteScope::Global => &self.global,
                WriteScope::Project => &self.project,
            };
            map.lock()
                .unwrap_or_else(|error| error.into_inner())
                .insert(resource_type, entries);
        }
    }

    fn selector_fixture() -> ConfigSelector {
        let resolved = ResolvedResources {
            extensions: vec![
                top_level(
                    "/home/u/.pi/agent/extensions/a.ts",
                    true,
                    ResourceType::Extensions,
                ),
                top_level(
                    "/home/u/.pi/agent/extensions/b.ts",
                    false,
                    ResourceType::Extensions,
                ),
            ],
            skills: Vec::new(),
            prompts: Vec::new(),
            themes: Vec::new(),
        };
        let groups = build_groups_with_home(&resolved, "/home/u/.pi/agent", "/home/u");
        let selector = ConfigSelector::new(groups.clone(), WriteScope::Global, true);
        selector.set_groups(WriteScope::Project, groups);
        selector
    }

    #[test]
    fn the_selector_renders_the_title_the_hint_and_the_resources() {
        let selector = selector_fixture();
        let output = strip_ansi(&selector.render(80).join("\n"));
        assert!(output.contains("Global Resources"));
        assert!(output.contains("space toggle"));
        assert!(output.contains("[x]"));
        assert!(output.contains("[ ]"));
        assert!(output.contains("→ "));
        assert!(output.contains("a.ts"));
        assert!(output.contains("b.ts"));
    }

    #[test]
    fn the_selector_renders_the_project_title_and_hint() {
        let selector = selector_fixture();
        selector.set_write_scope(WriteScope::Project);
        let output = strip_ansi(&selector.render(80).join("\n"));
        assert!(output.contains("Project Local Resources"));
        assert!(output.contains("space cycle inherit/+/-"));
    }

    #[test]
    fn the_search_filters_the_flattened_entries() {
        let selector = selector_fixture();
        assert_eq!(selector.flattened_len(), 4);
        selector.set_search_text("b.ts");
        let output = strip_ansi(&selector.render(80).join("\n"));
        assert!(output.contains("b.ts"));
        assert!(!output.contains("a.ts"));
    }

    #[test]
    fn the_selection_moves_between_the_resources() {
        let selector = selector_fixture();
        assert_eq!(selector.selected_index(), 2);
        selector.move_down();
        assert_eq!(selector.selected_index(), 3);
        selector.move_up();
        assert_eq!(selector.selected_index(), 2);
    }

    #[test]
    fn activating_a_resource_in_the_global_scope_flips_the_enabled_flag() {
        let store = MemoryStore::new();
        let selector = selector_fixture();
        selector.set_store(store.clone());
        let outcome = selector.activate().expect("outcome");
        assert_eq!(outcome.item_path, "/home/u/.pi/agent/extensions/a.ts");
        assert!(!outcome.enabled);
        assert_eq!(outcome.scope, WriteScope::Global);
        assert_eq!(outcome.state, ProjectOverrideState::Unload);
        assert_eq!(
            store.entries(WriteScope::Global, ResourceType::Extensions),
            vec!["-/home/u/.pi/agent/extensions/a.ts".to_string()]
        );
    }

    #[test]
    fn activating_a_resource_in_the_project_scope_cycles_the_override() {
        let store = MemoryStore::new();
        let selector = selector_fixture();
        selector.set_store(store.clone());
        selector.set_write_scope(WriteScope::Project);

        let outcome = selector.activate().expect("outcome");
        assert_eq!(outcome.state, ProjectOverrideState::Load);
        assert!(outcome.enabled);

        let outcome = selector.activate().expect("outcome");
        assert_eq!(outcome.state, ProjectOverrideState::Unload);
        assert!(!outcome.enabled);

        let outcome = selector.activate().expect("outcome");
        assert_eq!(outcome.state, ProjectOverrideState::Inherit);
    }

    #[test]
    fn the_toggle_callback_runs_after_a_toggle() {
        let selector = selector_fixture();
        let seen: Arc<Mutex<Vec<(String, bool)>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        selector.on_toggle(Arc::new(move |item: &ResourceItem, enabled: bool| {
            sink.lock()
                .unwrap_or_else(|error| error.into_inner())
                .push((item.path.clone(), enabled));
        }));
        selector.activate();
        let seen = seen.lock().unwrap_or_else(|error| error.into_inner());
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].0, "/home/u/.pi/agent/extensions/a.ts");
        assert!(!seen[0].1);
    }
}
