//! The `/mcp` manager: the servers, their state, and their tools.
//!
//! The content follows the original's manager
//! (`packages/coding-agent/src/extensions/mcp/index.ts:790-980`): the server
//! list, the per-server menu, and the tool list. The screens are the port's
//! own selectors.

use super::*;

use crate::mcp::{McpExposure, McpManager, McpServerStatus};

const EXPOSURE_DESCRIPTIONS: [(McpExposure, &str); 3] = [
    (
        McpExposure::Codemode,
        "called from codemode scripts, which find them with searchTools()",
    ),
    (
        McpExposure::Deferred,
        "not declared until tool_search loads them, then called directly; no codemode needed",
    ),
    (
        McpExposure::Direct,
        "declared to the model like built-in tools",
    ),
];

fn scope_label(status: &McpServerStatus) -> String {
    if status.override_path.is_some() {
        return "global, project override".to_string();
    }
    match status.scope {
        crate::mcp::McpScope::Extension => status.source.clone(),
        scope => scope.as_str().to_string(),
    }
}

/// The order the servers need the user in: the ones that failed or need a
/// sign-in come first, the connected ones last.
fn attention_rank(status: &McpServerStatus) -> u8 {
    if !status.enabled {
        return 5;
    }
    match status.state {
        crate::mcp::ServerState::NeedsAuth => 0,
        crate::mcp::ServerState::Failed => 1,
        crate::mcp::ServerState::Disconnected => 2,
        crate::mcp::ServerState::Connected => 4,
        _ => 3,
    }
}

/// Open the manager on the list of servers.
pub(super) fn open_mcp_manager(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    chat: &Arc<Container>,
    manager: Arc<McpManager>,
) {
    let mut statuses = manager.statuses();
    statuses.sort_by(|a, b| {
        attention_rank(a)
            .cmp(&attention_rank(b))
            .then_with(|| a.name.cmp(&b.name))
    });
    if statuses.is_empty() {
        add_note_message(
            chat,
            &format!(
                "No MCP servers configured. Add them to {} or .pi/mcp.json.",
                manager
                    .agent_dir()
                    .join("mcp.json")
                    .display()
            ),
        );
        tui.request_render(false);
        return;
    }
    let items: Vec<SelectItem> = statuses
        .iter()
        .map(|status| {
            let mut description = format!("{} · {}", status.describe(), status.exposure.as_str());
            description.push_str(&format!(" · {}", scope_label(status)));
            SelectItem {
                value: status.name.clone(),
                label: status.name.clone(),
                description: Some(description),
                search_text: None,
            }
        })
        .collect();
    let list = Arc::new(SelectList::new(items, 12));

    let state_sel = state.clone();
    let ec_sel = editor_container.clone();
    let editor_sel = editor.clone();
    let tui_sel = tui.clone();
    let chat_sel = chat.clone();
    let manager_sel = Arc::clone(&manager);
    list.on_select(Arc::new(move |item| {
        open_mcp_server_menu(
            &state_sel,
            &ec_sel,
            &editor_sel,
            &tui_sel,
            &chat_sel,
            Arc::clone(&manager_sel),
            item.value.clone(),
        );
    }));
    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    list.on_cancel(Arc::new(move || {
        close_selector(&state_cancel, &ec_cancel, &editor_cancel, &tui_cancel);
    }));

    let errors = manager.config_errors();
    let description = if errors.is_empty() {
        None
    } else {
        Some(errors.join("\n"))
    };
    let searchable = open_searchable_selector(
        state,
        editor_container,
        editor,
        tui,
        Some("MCP servers"),
        description.as_deref(),
        list,
        SelectorKind::Mcp,
    );
    searchable.set_hint(Some(
        [
            format!("{} to manage", rpi_tui::key_display_text("tui.select.confirm")),
            format!("{} to close", rpi_tui::key_display_text("tui.select.cancel")),
        ]
        .join(" · "),
    ));
}

/// Open the menu of one server: its state, its tools, and its actions.
fn open_mcp_server_menu(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    chat: &Arc<Container>,
    manager: Arc<McpManager>,
    name: String,
) {
    let Some(status) = manager.statuses().into_iter().find(|entry| entry.name == name) else {
        add_note_message(chat, "This server is no longer configured.");
        tui.request_render(false);
        return;
    };
    let mut items: Vec<SelectItem> = Vec::new();
    let in_project = manager.can_change_in_project(&name);
    if status.enabled {
        if status.state == crate::mcp::ServerState::Connected {
            items.push(SelectItem {
                value: "tools".to_string(),
                label: "Tools".to_string(),
                description: Some(format!("{} offered", status.tool_count)),
                search_text: None,
            });
        }
        if matches!(
            status.state,
            crate::mcp::ServerState::Failed
                | crate::mcp::ServerState::Disconnected
                | crate::mcp::ServerState::Connected
                | crate::mcp::ServerState::NeedsAuth
        ) {
            items.push(SelectItem {
                value: "reconnect".to_string(),
                label: "Reconnect".to_string(),
                description: None,
                search_text: None,
            });
        }
        items.push(SelectItem {
            value: "exposure".to_string(),
            label: "Exposure".to_string(),
            description: Some(status.exposure.as_str().to_string()),
            search_text: None,
        });
        items.push(SelectItem {
            value: "disable".to_string(),
            label: "Disable".to_string(),
            description: Some(saved_label(&status)),
            search_text: None,
        });
        if in_project {
            items.push(SelectItem {
                value: "disable-project".to_string(),
                label: "Disable in this project".to_string(),
                description: Some("saved to the project mcp.json".to_string()),
                search_text: None,
            });
        }
    } else {
        items.push(SelectItem {
            value: "enable".to_string(),
            label: "Enable".to_string(),
            description: Some(saved_label(&status)),
            search_text: None,
        });
        if in_project {
            items.push(SelectItem {
                value: "enable-project".to_string(),
                label: "Enable in this project".to_string(),
                description: Some("saved to the project mcp.json".to_string()),
                search_text: None,
            });
        }
    }
    let mut details = format!(
        "{}\n{}: {}\nState: {}",
        status.transport,
        status.scope.as_str(),
        status.source,
        status.describe()
    );
    if let Some(override_path) = &status.override_path {
        details.push_str(&format!("\nproject override: {override_path}"));
    }
    let list = Arc::new(SelectList::new(items, 12));
    let menu_name = name.clone();

    let state_sel = state.clone();
    let ec_sel = editor_container.clone();
    let editor_sel = editor.clone();
    let tui_sel = tui.clone();
    let chat_sel = chat.clone();
    let manager_sel = Arc::clone(&manager);
    list.on_select(Arc::new(move |item| {
        let manager = Arc::clone(&manager_sel);
        let name = name.clone();
        match item.value.as_str() {
            "tools" => open_mcp_tools_menu(
                &state_sel,
                &ec_sel,
                &editor_sel,
                &tui_sel,
                &chat_sel,
                manager,
                name,
            ),
            "exposure" => open_mcp_exposure_menu(
                &state_sel,
                &ec_sel,
                &editor_sel,
                &tui_sel,
                &chat_sel,
                manager,
                name,
            ),
            "reconnect" | "enable" | "disable" | "enable-project" | "disable-project" => {
                let action = item.value.clone();
                let state = state_sel.clone();
                let ec = ec_sel.clone();
                let editor = editor_sel.clone();
                let tui = tui_sel.clone();
                let chat = chat_sel.clone();
                tokio::spawn(async move {
                    let outcome = match action.as_str() {
                        "reconnect" => manager.reconnect(&name).await,
                        "enable" => manager.enable(&name).await,
                        "disable" => manager.disable(&name).await,
                        "enable-project" => manager.enable_in_project(&name).await,
                        _ => manager.disable_in_project(&name).await,
                    };
                    if let Err(error) = outcome {
                        add_note_message(&chat, &format!("MCP server \"{name}\": {error}"));
                        tui.request_render(false);
                        return;
                    }
                    open_mcp_server_menu(&state, &ec, &editor, &tui, &chat, manager, name);
                });
            }
            _ => {}
        }
    }));
    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    let chat_cancel = chat.clone();
    let manager_cancel = Arc::clone(&manager);
    let name_cancel = menu_name.clone();
    list.on_cancel(Arc::new(move || {
        open_mcp_manager(
            &state_cancel,
            &ec_cancel,
            &editor_cancel,
            &tui_cancel,
            &chat_cancel,
            Arc::clone(&manager_cancel),
        );
    }));

    let searchable = open_searchable_selector(
        state,
        editor_container,
        editor,
        tui,
        Some(&format!("MCP server {menu_name}")),
        Some(&details),
        list,
        SelectorKind::Mcp,
    );
    searchable.set_hint(Some(
        [
            format!("{} to select", rpi_tui::key_display_text("tui.select.confirm")),
            format!("{} to back", rpi_tui::key_display_text("tui.select.cancel")),
        ]
        .join(" · "),
    ));
}

/// Open the list of the tools a server offers.
fn open_mcp_tools_menu(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    chat: &Arc<Container>,
    manager: Arc<McpManager>,
    name: String,
) {
    let Some(status) = manager.statuses().into_iter().find(|entry| entry.name == name) else {
        add_note_message(chat, "This server is no longer configured.");
        tui.request_render(false);
        return;
    };
    let exposure = status.exposure;
    let items: Vec<SelectItem> = manager
        .server_tools(&name)
        .into_iter()
        .map(|tool| {
            let description = tool
                .description
                .as_deref()
                .map(first_line)
                .unwrap_or_default();
            let description = if tool.exposure == exposure {
                description
            } else {
                format!("[{}] {}", tool.exposure.as_str(), description)
            };
            SelectItem {
                value: tool.name.clone(),
                label: tool.name,
                description: Some(description),
                search_text: None,
            }
        })
        .collect();
    if items.is_empty() {
        add_note_message(chat, "The server offers no tools.");
        tui.request_render(false);
        return;
    }
    let mut details = format!(
        "Exposure {}: {}",
        exposure.as_str(),
        EXPOSURE_DESCRIPTIONS
            .iter()
            .find(|(entry, _)| *entry == exposure)
            .map(|(_, text)| *text)
            .unwrap_or("unreachable")
    );
    if status.has_tool_exposure {
        details.push_str("\nSome tools override it with toolExposure.");
    }
    let list = Arc::new(SelectList::new(items, 12));
    let menu_name = name.clone();
    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    let chat_cancel = chat.clone();
    let manager_cancel = Arc::clone(&manager);
    let name_cancel = menu_name.clone();
    list.on_cancel(Arc::new(move || {
        open_mcp_server_menu(
            &state_cancel,
            &ec_cancel,
            &editor_cancel,
            &tui_cancel,
            &chat_cancel,
            Arc::clone(&manager_cancel),
            name_cancel.clone(),
        );
    }));
    let searchable = open_searchable_selector(
        state,
        editor_container,
        editor,
        tui,
        Some(&format!("Tools of {menu_name}")),
        Some(&details),
        list,
        SelectorKind::Mcp,
    );
    searchable.set_hint(Some(format!(
        "{} to back",
        rpi_tui::key_display_text("tui.select.cancel")
    )));
}

/// Open the menu that changes a server's exposure.
fn open_mcp_exposure_menu(
    state: &Arc<TuiState>,
    editor_container: &Arc<Container>,
    editor: &Arc<Editor>,
    tui: &Arc<TuiAltScreen>,
    chat: &Arc<Container>,
    manager: Arc<McpManager>,
    name: String,
) {
    let Some(status) = manager.statuses().into_iter().find(|entry| entry.name == name) else {
        add_note_message(chat, "This server is no longer configured.");
        tui.request_render(false);
        return;
    };
    let current = status.exposure;
    let items: Vec<SelectItem> = EXPOSURE_DESCRIPTIONS
        .iter()
        .map(|(exposure, description)| SelectItem {
            value: exposure.as_str().to_string(),
            label: format!(
                "{}{}",
                if *exposure == current { "✓ " } else { "  " },
                exposure.as_str()
            ),
            description: Some((*description).to_string()),
            search_text: None,
        })
        .collect();
    let list = Arc::new(SelectList::new(items, 12));
    let menu_name = name.clone();
    let state_sel = state.clone();
    let ec_sel = editor_container.clone();
    let editor_sel = editor.clone();
    let tui_sel = tui.clone();
    let chat_sel = chat.clone();
    let manager_sel = Arc::clone(&manager);
    list.on_select(Arc::new(move |item| {
        let Some(exposure) = McpExposure::parse(&item.value) else {
            return;
        };
        let manager = Arc::clone(&manager_sel);
        let name = name.clone();
        let state = state_sel.clone();
        let ec = ec_sel.clone();
        let editor = editor_sel.clone();
        let tui = tui_sel.clone();
        let chat = chat_sel.clone();
        tokio::spawn(async move {
            if let Err(error) = manager.set_exposure(&name, exposure).await {
                add_note_message(&chat, &format!("MCP server \"{name}\": {error}"));
                tui.request_render(false);
                return;
            }
            open_mcp_server_menu(&state, &ec, &editor, &tui, &chat, manager, name);
        });
    }));
    let state_cancel = state.clone();
    let ec_cancel = editor_container.clone();
    let editor_cancel = editor.clone();
    let tui_cancel = tui.clone();
    let chat_cancel = chat.clone();
    let manager_cancel = Arc::clone(&manager);
    let name_cancel = menu_name.clone();
    list.on_cancel(Arc::new(move || {
        open_mcp_server_menu(
            &state_cancel,
            &ec_cancel,
            &editor_cancel,
            &tui_cancel,
            &chat_cancel,
            Arc::clone(&manager_cancel),
            name_cancel.clone(),
        );
    }));
    let details = format!("Saved to {}.", status.source);
    let searchable = open_searchable_selector(
        state,
        editor_container,
        editor,
        tui,
        Some(&format!("Exposure of {menu_name}")),
        Some(&details),
        list,
        SelectorKind::Mcp,
    );
    searchable.set_hint(Some(
        [
            format!("{} to save", rpi_tui::key_display_text("tui.select.confirm")),
            format!("{} to back", rpi_tui::key_display_text("tui.select.cancel")),
        ]
        .join(" · "),
    ));
}

/// Where a change to a server is saved.
fn saved_label(status: &McpServerStatus) -> String {
    if status.override_path.is_some() {
        return "saved to the project mcp.json".to_string();
    }
    match status.scope {
        crate::mcp::McpScope::Extension => "for this session".to_string(),
        crate::mcp::McpScope::Project => "saved to the project mcp.json".to_string(),
        crate::mcp::McpScope::Global => "saved to the global mcp.json".to_string(),
    }
}

/// The first line of a text, the way the original shows a tool's description.
fn first_line(text: &str) -> String {
    text.lines().next().unwrap_or_default().to_string()
}
