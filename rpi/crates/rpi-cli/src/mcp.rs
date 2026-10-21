use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rpi_agent::agent_tool::AgentTool;
use rpi_agent::error::AgentError;
use rpi_agent::types::{AgentToolResult, TextContentOrImage};
use rpi_ai::types::{ImageContent, Schema, Tool};
use rpi_mcp::client::{ClientState, McpClient, McpClientOptions};
use rpi_mcp::config::{
    get_mcp_tool_exposure, load_mcp_config, mcp_namespace, update_mcp_server_config,
    validate_mcp_server_config, McpServerConfig, McpServerEntry, McpTransportKind,
};
use rpi_mcp::http::{HttpOptions, StreamableHttpTransport};
use rpi_mcp::protocol::{CallToolResult, ContentBlock, McpRoot, McpTool};
use rpi_mcp::stdio::{StdioOptions, StdioTransport};
use rpi_mcp::tools::create_mcp_tool_name;
use rpi_mcp::transport::McpTransport;
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

pub use rpi_mcp::config::{McpExposure, McpScope};

pub const LIST_MCP_RESOURCES_TOOL: &str = "list_mcp_resources";
pub const LIST_MCP_RESOURCE_TEMPLATES_TOOL: &str = "list_mcp_resource_templates";
pub const READ_MCP_RESOURCE_TOOL: &str = "read_mcp_resource";

const DEFAULT_TIMEOUT_SECONDS: u64 = 60;
const MCP_OUTPUT_MAX_BYTES: usize = 20 * 1024;

pub fn is_mcp_tool_name(name: &str) -> bool {
    name.starts_with("mcp__")
        || matches!(
            name,
            LIST_MCP_RESOURCES_TOOL | LIST_MCP_RESOURCE_TEMPLATES_TOOL | READ_MCP_RESOURCE_TOOL
        )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerState {
    Disabled,
    Connecting,
    Connected,
    Disconnected,
    NeedsAuth,
    Failed,
}

impl ServerState {
    pub fn as_str(&self) -> &'static str {
        match self {
            ServerState::Disabled => "disabled",
            ServerState::Connecting => "connecting",
            ServerState::Connected => "connected",
            ServerState::Disconnected => "disconnected",
            ServerState::NeedsAuth => "needs-auth",
            ServerState::Failed => "failed",
        }
    }
}

struct Server {
    entry: McpServerEntry,
    state: ServerState,
    error: Option<String>,
    tools: Vec<McpTool>,
    tool_names: Vec<String>,
    has_resources: bool,
    instructions: Option<String>,
    client: Option<Arc<McpClient>>,
    connect_lock: Arc<tokio::sync::Mutex<()>>,
}

#[derive(Debug, Clone)]
pub struct McpServerStatus {
    pub name: String,
    pub state: ServerState,
    pub error: Option<String>,
    pub exposure: McpExposure,
    pub tool_count: usize,
    pub has_resources: bool,
    pub scope: McpScope,
    pub source: String,
    pub override_path: Option<String>,
    pub transport: String,
    pub enabled: bool,
    /// Whether the server's config overrides the exposure of single tools.
    pub has_tool_exposure: bool,
}

impl McpServerStatus {
    pub fn describe(&self) -> String {
        if !self.enabled {
            return "disabled".to_string();
        }
        match self.state {
            ServerState::NeedsAuth => "needs sign-in".to_string(),
            ServerState::Failed => match &self.error {
                Some(error) => format!("failed: {}", first_line(error)),
                None => "failed".to_string(),
            },
            ServerState::Connected => {
                let mut text = format!(
                    "connected · {} tool{}",
                    self.tool_count,
                    if self.tool_count == 1 { "" } else { "s" }
                );
                if self.has_resources {
                    text.push_str(" · resources");
                }
                text
            }
            ServerState::Connecting => "connecting…".to_string(),
            other => other.as_str().to_string(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct McpToolBinding {
    pub name: String,
    pub server: String,
    pub tool: String,
    pub description: String,
    pub parameters: Value,
    pub exposure: McpExposure,
}

/// A tool a server offers, as the manager shows it.
#[derive(Debug, Clone)]
pub struct McpToolInfo {
    pub name: String,
    pub description: Option<String>,
    pub exposure: McpExposure,
}

struct Inner {
    servers: Vec<Server>,
    config_errors: Vec<String>,
}

pub struct McpManager {
    inner: Mutex<Inner>,
    cwd: PathBuf,
    agent_dir: PathBuf,
    /// The trusted project's `mcp.json`, where the project overrides of the
    /// global servers are saved.
    project_config: Mutex<Option<PathBuf>>,
    runtime: Mutex<Option<tokio::runtime::Handle>>,
}

fn first_line(text: &str) -> String {
    text.lines().next().unwrap_or_default().to_string()
}

impl McpManager {
    pub fn new(cwd: PathBuf, agent_dir: PathBuf) -> Self {
        McpManager {
            inner: Mutex::new(Inner {
                servers: Vec::new(),
                config_errors: Vec::new(),
            }),
            cwd,
            agent_dir,
            project_config: Mutex::new(None),
            runtime: Mutex::new(None),
        }
    }

    pub fn set_runtime(&self, handle: tokio::runtime::Handle) {
        *self.runtime.lock().unwrap_or_else(|error| error.into_inner()) = Some(handle);
    }

    pub fn log_path(&self) -> PathBuf {
        self.agent_dir.join("mcp.log")
    }

    pub fn config_errors(&self) -> Vec<String> {
        self.inner
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .config_errors
            .clone()
    }

    pub fn load_config(&self, project_trusted: bool) {
        let loaded = load_mcp_config(&self.agent_dir, &self.cwd, project_trusted);
        *self
            .project_config
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = loaded.project_config.clone();
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        inner.config_errors = loaded.errors;
        let configured: Vec<McpServerEntry> = loaded.servers;
        let mut servers: Vec<Server> = Vec::new();
        for entry in configured {
            let state = if entry.config.enabled {
                ServerState::Connecting
            } else {
                ServerState::Disabled
            };
            servers.push(Server {
                entry,
                state,
                error: None,
                tools: Vec::new(),
                tool_names: Vec::new(),
                has_resources: false,
                instructions: None,
                client: None,
                connect_lock: Arc::new(tokio::sync::Mutex::new(())),
            });
        }
        for server in inner.servers.drain(..) {
            if server.entry.scope == McpScope::Extension {
                servers.push(server);
            }
        }
        inner.servers = servers;
    }

    pub fn has_servers(&self) -> bool {
        !self
            .inner
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .servers
            .is_empty()
    }

    pub fn register(
        &self,
        name: &str,
        config: &Value,
        extension_path: &str,
    ) -> Result<(), String> {
        let validated = validate_mcp_server_config(name, config)?;
        let entry = McpServerEntry {
            name: name.to_string(),
            config: validated,
            source: extension_path.to_string(),
            scope: McpScope::Extension,
            override_path: None,
        };
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        let existing = inner
            .servers
            .iter()
            .position(|server| server.entry.name == name);
        let server = Server {
            entry,
            state: ServerState::Connecting,
            error: None,
            tools: Vec::new(),
            tool_names: Vec::new(),
            has_resources: false,
            instructions: None,
            client: None,
            connect_lock: Arc::new(tokio::sync::Mutex::new(())),
        };
        match existing {
            Some(index) => inner.servers[index] = server,
            None => inner.servers.push(server),
        }
        Ok(())
    }

    pub fn unregister(&self, name: &str) {
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        inner.servers.retain(|server| server.entry.name != name);
    }

    pub fn list(&self) -> Vec<Value> {
        let inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        inner
            .servers
            .iter()
            .map(|server| {
                json!({
                    "name": server.entry.name,
                    "config": server_config_to_value(&server.entry.config),
                    "extensionPath": server.entry.source,
                })
            })
            .collect()
    }

    pub fn statuses(&self) -> Vec<McpServerStatus> {
        let inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        inner
            .servers
            .iter()
            .map(|server| {
                // A server whose process died is disconnected, not connected:
                // the original shows the same, and the next call reconnects.
                let state = match (&server.client, server.state) {
                    (Some(client), ServerState::Connected) => match client.state() {
                        ClientState::Connected => ServerState::Connected,
                        _ => ServerState::Disconnected,
                    },
                    _ => server.state,
                };
                McpServerStatus {
                    name: server.entry.name.clone(),
                    state,
                    error: server.error.clone(),
                    exposure: server.entry.config.exposure,
                    tool_count: server.tools.len(),
                    has_resources: server.has_resources,
                    scope: server.entry.scope,
                    source: server.entry.source.clone(),
                    override_path: server.entry.override_path.clone(),
                    transport: server.entry.config.describe_transport(),
                    enabled: server.entry.config.enabled,
                    has_tool_exposure: !server.entry.config.tool_exposure.is_empty(),
                }
            })
            .collect()
    }

    pub fn tools(&self) -> Vec<McpToolBinding> {
        let inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        let mut bindings = Vec::new();
        for server in inner.servers.iter() {
            if server.state != ServerState::Connected {
                continue;
            }
            for (index, tool) in server.tools.iter().enumerate() {
                let exposure = get_mcp_tool_exposure(&server.entry.config, &tool.name);
                if exposure == McpExposure::Hidden {
                    continue;
                }
                let name = server
                    .tool_names
                    .get(index)
                    .cloned()
                    .unwrap_or_else(|| create_mcp_tool_name(&server.entry.name, &tool.name, |_| false));
                bindings.push(McpToolBinding {
                    name,
                    server: server.entry.name.clone(),
                    tool: tool.name.clone(),
                    description: tool
                        .description
                        .clone()
                        .filter(|text| !text.trim().is_empty())
                        .or_else(|| tool.title.clone())
                        .unwrap_or_else(|| {
                            format!(
                                "MCP tool {} from server {}",
                                tool.name, server.entry.name
                            )
                        }),
                    parameters: tool.input_schema.clone(),
                    exposure,
                });
            }
        }
        bindings
    }

    /// The tools a server offers, with the exposure each one has. A tool's
    /// `toolExposure` entry wins over the server's exposure.
    pub fn server_tools(&self, server: &str) -> Vec<McpToolInfo> {
        let inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        inner
            .servers
            .iter()
            .filter(|entry| entry.entry.name == server)
            .flat_map(|entry| {
                entry
                    .tools
                    .iter()
                    .map(|tool| McpToolInfo {
                        name: tool.name.clone(),
                        description: tool.description.clone(),
                        exposure: get_mcp_tool_exposure(&entry.entry.config, &tool.name),
                    })
                    .collect::<Vec<McpToolInfo>>()
            })
            .collect()
    }

    pub fn tools_of(&self, server: &str) -> Vec<String> {
        let inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        inner
            .servers
            .iter()
            .filter(|entry| entry.entry.name == server)
            .flat_map(|entry| {
                entry
                    .tools
                    .iter()
                    .map(|tool| tool.name.clone())
                    .collect::<Vec<String>>()
            })
            .collect()
    }

    pub fn tool_names_for(&self, server: &str) -> Vec<(String, String)> {
        let inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        inner
            .servers
            .iter()
            .filter(|entry| entry.entry.name == server)
            .flat_map(|entry| {
                entry
                    .tool_names
                    .iter()
                    .cloned()
                    .zip(entry.tools.iter().map(|tool| tool.name.clone()))
                    .collect::<Vec<_>>()
            })
            .collect()
    }

    pub fn servers_section(&self) -> Option<String> {
        let inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        let mut listed: Vec<String> = Vec::new();
        for server in inner.servers.iter() {
            if !server.entry.config.enabled {
                continue;
            }
            let summary = server
                .entry
                .config
                .description
                .clone()
                .filter(|text| !text.trim().is_empty())
                .or_else(|| server.instructions.clone())
                .map(|text| first_line(&text))
                .unwrap_or_default();
            let head = format!("- {}", mcp_namespace(&server.entry.name));
            if summary.is_empty() {
                listed.push(head);
            } else {
                listed.push(format!("{head}: {summary}"));
            }
        }
        if listed.is_empty() {
            return None;
        }
        let mut lines = vec![
            "MCP servers. Their tools are declared to you as `mcp__<server>__<tool>`.".to_string(),
        ];
        lines.extend(listed);
        Some(lines.join("\n"))
    }

    pub fn connect_in_background(self: &Arc<Self>, name: &str) {
        let handle = self
            .runtime
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        let Some(handle) = handle else { return };
        let manager = Arc::clone(self);
        let name = name.to_string();
        handle.spawn(async move {
            let _ = manager.ensure_connected(&name).await;
        });
    }

    pub async fn connect_all(&self) {
        let names: Vec<String> = {
            let inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
            inner
                .servers
                .iter()
                .filter(|server| server.entry.config.enabled)
                .map(|server| server.entry.name.clone())
                .collect()
        };
        for name in names {
            let _ = self.ensure_connected(&name).await;
        }
        self.assign_tool_names();
    }

    pub async fn ensure_connected(&self, name: &str) -> Result<(), String> {
        let (entry, lock, connected) = {
            let inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
            let server = inner
                .servers
                .iter()
                .find(|server| server.entry.name == name)
                .ok_or_else(|| format!("No MCP server named \"{name}\""))?;
            (
                server.entry.clone(),
                server.connect_lock.clone(),
                server.client.as_ref().map(|client| client.state()) == Some(ClientState::Connected),
            )
        };
        if !entry.config.enabled {
            return Ok(());
        }
        let _guard = lock.lock().await;
        if connected {
            return Ok(());
        }
        self.drop_client(name).await;
        let transport = build_transport(&entry, &self.cwd)?;
        let timeout = self.timeout_of(name);
        let options = McpClientOptions {
            request_timeout_ms: Some(timeout),
            roots: vec![McpRoot {
                uri: file_url(&self.cwd),
                name: self
                    .cwd
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned()),
            }],
            ..McpClientOptions::default()
        };
        let client = Arc::new(McpClient::new(options));
        if let Err(error) = client.connect(transport).await {
            let message = error.to_string();
            self.set_failed(name, &message);
            self.write_log(name, &format!("failed: {message}"));
            return Err(message);
        }
        let tools = match client.list_tools().await {
            Ok(tools) => tools,
            Err(error) => {
                let message = error.to_string();
                self.set_failed(name, &message);
                return Err(message);
            }
        };
        let has_resources = client
            .capabilities()
            .get("resources")
            .map(|value| !value.is_null())
            .unwrap_or(false);
        let instructions = client.instructions();
        {
            let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
            if let Some(server) = inner
                .servers
                .iter_mut()
                .find(|server| server.entry.name == name)
            {
                server.state = ServerState::Connected;
                server.error = None;
                server.tools = tools;
                server.has_resources = has_resources;
                server.instructions = instructions;
                server.client = Some(client);
            }
        }
        self.assign_tool_names();
        self.write_log(name, "connected");
        Ok(())
    }

    /// Close the server's connection, if it has one.
    async fn drop_client(&self, name: &str) {
        let client = {
            let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
            inner
                .servers
                .iter_mut()
                .find(|server| server.entry.name == name)
                .and_then(|server| server.client.take())
        };
        if let Some(client) = client {
            client.close().await;
        }
    }

    /// Connect the server again, dropping the connection it has.
    ///
    /// The manager's "Reconnect" action: the server is closed and opened
    /// anew, so a server that was restarted is picked up.
    pub async fn reconnect(&self, name: &str) -> Result<(), String> {
        {
            let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
            let server = inner
                .servers
                .iter_mut()
                .find(|server| server.entry.name == name)
                .ok_or_else(|| format!("No MCP server named \"{name}\""))?;
            server.state = ServerState::Connecting;
            server.error = None;
            server.tools.clear();
            server.tool_names.clear();
            server.has_resources = false;
        }
        self.drop_client(name).await;
        self.ensure_connected(name).await
    }

    fn set_failed(&self, name: &str, message: &str) {
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(server) = inner
            .servers
            .iter_mut()
            .find(|server| server.entry.name == name)
        {
            server.state = if message.contains("authentication") {
                ServerState::NeedsAuth
            } else {
                ServerState::Failed
            };
            server.error = Some(message.to_string());
        }
    }

    pub async fn call_tool(
        &self,
        server: &str,
        tool: &str,
        arguments: Value,
    ) -> Result<CallToolResult, String> {
        let client = self.client_of(server).await?;
        let timeout = self.timeout_of(server);
        client
            .call_tool(tool, arguments, Some(timeout))
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn list_resources(&self, server: &str) -> Result<Value, String> {
        let client = self.client_of(server).await?;
        let resources = client
            .list_resources()
            .await
            .map_err(|error| error.to_string())?;
        let items: Vec<Value> = resources
            .iter()
            .map(|resource| {
                json!({
                    "server": server,
                    "uri": resource.uri,
                    "name": resource.name,
                    "title": resource.title,
                    "description": resource.description,
                    "mimeType": resource.mime_type,
                    "size": resource.size,
                })
            })
            .collect();
        Ok(json!({ "server": server, "resources": items }))
    }

    pub async fn list_resource_templates(&self, server: &str) -> Result<Value, String> {
        let client = self.client_of(server).await?;
        let templates = match client.list_resource_templates().await {
            Ok(templates) => templates,
            Err(error) => {
                if error
                    .to_string()
                    .contains("Method not found")
                    || error.to_string().contains("-32601")
                {
                    Vec::new()
                } else {
                    return Err(error.to_string());
                }
            }
        };
        let items: Vec<Value> = templates
            .iter()
            .map(|template| {
                json!({
                    "server": server,
                    "uriTemplate": template.uri_template,
                    "name": template.name,
                    "title": template.title,
                    "description": template.description,
                    "mimeType": template.mime_type,
                })
            })
            .collect();
        Ok(json!({ "server": server, "resourceTemplates": items }))
    }

    pub async fn read_resource(&self, server: &str, uri: &str) -> Result<Value, String> {
        let client = self.client_of(server).await?;
        let result = client
            .read_resource(uri)
            .await
            .map_err(|error| error.to_string())?;
        let contents: Vec<Value> = result
            .contents
            .iter()
            .map(|entry| {
                json!({
                    "uri": entry.uri,
                    "mimeType": entry.mime_type,
                    "text": entry.text,
                    "blob": entry.blob,
                })
            })
            .collect();
        Ok(json!({ "server": server, "uri": uri, "contents": contents }))
    }

    pub fn servers_with_resources(&self) -> Vec<String> {
        let inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        inner
            .servers
            .iter()
            .filter(|server| {
                server.has_resources
                    && server.state == ServerState::Connected
                    && server.entry.config.exposure != McpExposure::Hidden
            })
            .map(|server| server.entry.name.clone())
            .collect()
    }

    async fn client_of(&self, server: &str) -> Result<Arc<McpClient>, String> {
        self.ensure_connected(server).await?;
        let inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        inner
            .servers
            .iter()
            .find(|entry| entry.entry.name == server)
            .and_then(|entry| entry.client.clone())
            .ok_or_else(|| format!("MCP server \"{server}\" is not connected"))
    }

    fn timeout_of(&self, server: &str) -> u64 {
        let inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        inner
            .servers
            .iter()
            .find(|entry| entry.entry.name == server)
            .and_then(|entry| entry.entry.config.timeout_seconds)
            .unwrap_or(DEFAULT_TIMEOUT_SECONDS)
            * 1000
    }

    fn assign_tool_names(&self) {
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        let mut owners: HashMap<String, (String, String)> = HashMap::new();
        let mut order: Vec<String> = inner
            .servers
            .iter()
            .map(|server| server.entry.name.clone())
            .collect();
        order.sort();
        for name in order {
            let plain: Vec<String> = {
                let server = inner
                    .servers
                    .iter()
                    .find(|server| server.entry.name == name)
                    .expect("name comes from the servers");
                let mut unique: Vec<String> = Vec::new();
                for tool in server.tools.iter() {
                    let candidate = create_mcp_tool_name(&name, &tool.name, |_| false);
                    if !unique.contains(&candidate) {
                        unique.push(candidate);
                    }
                }
                unique
            };
            let server = inner
                .servers
                .iter_mut()
                .find(|server| server.entry.name == name)
                .expect("name comes from the servers");
            let mut assigned: Vec<String> = Vec::new();
            for tool in server.tools.iter() {
                let owner = (name.clone(), tool.name.clone());
                let is_taken = |candidate: &str| {
                    if let Some(existing) = owners.get(candidate) {
                        if existing != &owner {
                            return true;
                        }
                    }
                    plain.iter().filter(|entry| *entry == candidate).count() > 1
                        || assigned.iter().any(|entry| entry == candidate)
                };
                let assigned_name = create_mcp_tool_name(&name, &tool.name, is_taken);
                owners.insert(assigned_name.clone(), owner);
                assigned.push(assigned_name);
            }
            server.tool_names = assigned;
        }
    }

    pub fn agent_dir(&self) -> &Path {
        &self.agent_dir
    }

    /// Enable a server: the change is saved to the config that defines it.
    pub async fn enable(&self, name: &str) -> Result<(), String> {
        self.set_enabled(name, true, false).await
    }

    /// Disable a server: the change is saved to the config that defines it.
    pub async fn disable(&self, name: &str) -> Result<(), String> {
        self.set_enabled(name, false, false).await
    }

    /// Enable a server for this project only: the change is saved as an
    /// override in the project's `mcp.json`.
    pub async fn enable_in_project(&self, name: &str) -> Result<(), String> {
        self.set_enabled(name, true, true).await
    }

    /// Disable a server for this project only: the change is saved as an
    /// override in the project's `mcp.json`.
    pub async fn disable_in_project(&self, name: &str) -> Result<(), String> {
        self.set_enabled(name, false, true).await
    }

    /// Whether the server can be turned on or off for this project alone: a
    /// global server without an override, in a trusted project.
    pub fn can_change_in_project(&self, name: &str) -> bool {
        let has_project_config = self
            .project_config
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .is_some();
        if !has_project_config {
            return false;
        }
        let inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        inner
            .servers
            .iter()
            .find(|server| server.entry.name == name)
            .map(|server| {
                server.entry.scope == McpScope::Global && server.entry.override_path.is_none()
            })
            .unwrap_or(false)
    }

    async fn set_enabled(&self, name: &str, enabled: bool, in_project: bool) -> Result<(), String> {
        let (source, override_path, scope) = {
            let inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
            let server = inner
                .servers
                .iter()
                .find(|server| server.entry.name == name)
                .ok_or_else(|| format!("No MCP server named \"{name}\""))?;
            (
                server.entry.source.clone(),
                server.entry.override_path.clone(),
                server.entry.scope,
            )
        };
        // The project override wins over the file that defines the server, as
        // in the original: a project's `mcp.json` turns a global server off
        // for one project.
        let project_config = self
            .project_config
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        let target = if in_project {
            project_config.clone()
        } else {
            override_path.clone().map(PathBuf::from).or(Some(PathBuf::from(&source)))
        };
        if scope != McpScope::Extension {
            let Some(path) = target else {
                return Err("This project has no mcp.json to save the change in.".to_string());
            };
            let display = path.display().to_string();
            update_mcp_server_config(&path, name, Some(enabled), None, override_path.is_some() || in_project)
                .map_err(|error| format!("Could not update {display}: {error}"))?;
        }
        {
            let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
            if let Some(server) = inner
                .servers
                .iter_mut()
                .find(|server| server.entry.name == name)
            {
                server.entry.config.enabled = enabled;
                if in_project {
                    if let Some(project_config) = project_config {
                        server.entry.override_path =
                            Some(project_config.display().to_string());
                    }
                }
                server.state = if enabled {
                    ServerState::Connecting
                } else {
                    ServerState::Disabled
                };
                if !enabled {
                    server.client = None;
                    server.tools.clear();
                    server.tool_names.clear();
                    server.has_resources = false;
                }
            }
        }
        self.assign_tool_names();
        if enabled {
            self.ensure_connected(name).await?;
        }
        Ok(())
    }

    /// Change a server's exposure: the change is saved to the config that
    /// defines it.
    pub async fn set_exposure(&self, name: &str, exposure: McpExposure) -> Result<(), String> {
        let (source, override_path, scope) = {
            let inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
            let server = inner
                .servers
                .iter()
                .find(|server| server.entry.name == name)
                .ok_or_else(|| format!("No MCP server named \"{name}\""))?;
            (
                server.entry.source.clone(),
                server.entry.override_path.clone(),
                server.entry.scope,
            )
        };
        if scope != McpScope::Extension {
            let is_override = override_path.is_some();
            let path = override_path
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(&source));
            let display = path.display().to_string();
            update_mcp_server_config(&path, name, None, Some(exposure), is_override)
                .map_err(|error| format!("Could not update {display}: {error}"))?;
        }
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(server) = inner
            .servers
            .iter_mut()
            .find(|server| server.entry.name == name)
        {
            server.entry.config.exposure = exposure;
        }
        Ok(())
    }

    pub async fn close(&self) {
        let clients: Vec<Arc<McpClient>> = {
            let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
            inner
                .servers
                .iter_mut()
                .filter_map(|server| server.client.take())
                .collect()
        };
        for client in clients {
            client.close().await;
        }
    }

    fn write_log(&self, server: &str, message: &str) {
        let path = self.log_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let line = format!("{} {server} {message}\n", chrono_now());
        use std::io::Write;
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            let _ = file.write_all(line.as_bytes());
        }
    }
}

fn chrono_now() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default();
    format!("{seconds}")
}

fn expand_home(value: &str) -> String {
    if value == "~" {
        return home_dir().to_string_lossy().into_owned();
    }
    if let Some(rest) = value.strip_prefix("~/") {
        return home_dir().join(rest).to_string_lossy().into_owned();
    }
    value.to_string()
}

/// A `file://` URL for a path, the way the original's `pathToFileURL` builds
/// the root it offers the servers.
fn file_url(path: &Path) -> String {
    let text = path.to_string_lossy();
    let mut url = String::from("file://");
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                url.push(byte as char)
            }
            _ => url.push_str(&format!("%{byte:02X}")),
        }
    }
    url
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

fn build_transport(
    entry: &McpServerEntry,
    cwd: &Path,
) -> Result<Arc<dyn McpTransport>, String> {
    match entry.config.transport {
        McpTransportKind::Http => {
            let mut headers = Vec::new();
            for (name, value) in &entry.config.headers {
                let resolved = rpi_mcp::config::resolve_config_value(value).map_err(|error| {
                    format!("MCP server \"{}\" header \"{name}\": {error}", entry.name)
                })?;
                headers.push((name.clone(), resolved));
            }
            Ok(Arc::new(StreamableHttpTransport::new(HttpOptions {
                url: entry.config.url.clone().unwrap_or_default(),
                headers,
                open_get_stream: true,
            })))
        }
        McpTransportKind::Stdio => {
            let command = rpi_mcp::config::resolve_config_value(
                entry.config.command.as_deref().unwrap_or_default(),
            )
            .map_err(|error| format!("MCP server \"{}\": {error}", entry.name))?;
            let mut args = Vec::new();
            for argument in &entry.config.args {
                args.push(
                    rpi_mcp::config::resolve_config_value(argument)
                        .map_err(|error| format!("MCP server \"{}\": {error}", entry.name))?,
                );
            }
            let mut env = Vec::new();
            for (name, value) in &entry.config.env {
                let resolved = rpi_mcp::config::resolve_config_value(value).map_err(|error| {
                    format!("MCP server \"{}\" env \"{name}\": {error}", entry.name)
                })?;
                env.push((name.clone(), resolved));
            }
            let directory = match &entry.config.cwd {
                Some(configured) => {
                    let expanded = expand_home(configured);
                    let path = PathBuf::from(&expanded);
                    if path.is_absolute() {
                        path
                    } else {
                        cwd.join(path)
                    }
                }
                None => cwd.to_path_buf(),
            };
            Ok(Arc::new(StdioTransport::new(StdioOptions {
                command: expand_home(&command),
                args,
                cwd: Some(directory),
                env,
                inherit_env: true,
                ..Default::default()
            })))
        }
    }
}

pub struct McpToolAdapter {
    manager: Arc<McpManager>,
    name: String,
    label: String,
    schema: Tool,
    server: String,
    tool: String,
}

impl McpToolAdapter {
    pub fn new(manager: Arc<McpManager>, binding: &McpToolBinding) -> Self {
        McpToolAdapter {
            manager,
            name: binding.name.clone(),
            label: format!("{}/{}", binding.server, binding.tool),
            schema: Tool {
                name: binding.name.clone(),
                description: binding.description.clone(),
                parameters: Schema::new(binding.parameters.clone()),
                constrained_sampling: None,
            },
            server: binding.server.clone(),
            tool: binding.tool.clone(),
        }
    }
}

#[async_trait::async_trait]
impl AgentTool for McpToolAdapter {
    fn schema(&self) -> &Tool {
        &self.schema
    }

    fn label(&self) -> &str {
        &self.label
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        params: Value,
        _signal: CancellationToken,
        _on_update: Arc<dyn Fn(rpi_agent::types::ToolResultPartial) + Send + Sync>,
    ) -> Result<AgentToolResult, AgentError> {
        let result = self
            .manager
            .call_tool(&self.server, &self.tool, params)
            .await
            .map_err(AgentError::Tool)?;
        Ok(mcp_result_to_agent_result(&self.server, &self.tool, result))
    }
}

pub fn mcp_result_to_agent_result(
    server: &str,
    tool: &str,
    result: CallToolResult,
) -> AgentToolResult {
    let mut content: Vec<TextContentOrImage> = Vec::new();
    for block in result.content.iter() {
        match block {
            ContentBlock::Text { text } => content.push(TextContentOrImage::text(text.clone())),
            ContentBlock::Image { data, mime_type } => content.push(TextContentOrImage::Image(
                ImageContent {
                    kind: Default::default(),
                    data: data.clone(),
                    mime_type: mime_type.clone().unwrap_or_else(|| "image/png".to_string()),
                },
            )),
            ContentBlock::Audio { data, mime_type } => content.push(TextContentOrImage::text(
                format!(
                    "[Audio content ({} bytes, {})]",
                    data.len(),
                    mime_type.clone().unwrap_or_default()
                ),
            )),
            ContentBlock::Resource { contents } => {
                if let Some(text) = &contents.text {
                    content.push(TextContentOrImage::text(text.clone()));
                } else if let Some(blob) = &contents.blob {
                    let mime = contents.mime_type.clone().unwrap_or_default();
                    if mime.starts_with("image/") {
                        content.push(TextContentOrImage::Image(ImageContent {
                            kind: Default::default(),
                            data: blob.clone(),
                            mime_type: mime,
                        }));
                    } else {
                        content.push(TextContentOrImage::text(format!(
                            "[Binary resource {} ({mime})]",
                            contents.uri
                        )));
                    }
                }
            }
            ContentBlock::ResourceLink {
                uri,
                name,
                title,
                description,
                mime_type,
                size,
            } => {
                let mut details: Vec<String> = Vec::new();
                if let Some(mime_type) = mime_type {
                    details.push(mime_type.clone());
                }
                if let Some(size) = size {
                    details.push(format!("{size} bytes"));
                }
                let label = title.clone().or_else(|| name.clone()).unwrap_or_default();
                let mut text = format!("[Resource {uri} \"{label}\"");
                if !details.is_empty() {
                    text.push_str(&format!(" ({})", details.join(", ")));
                }
                text.push(']');
                if let Some(description) = description {
                    text.push_str(&format!(": {description}"));
                }
                text.push_str(&format!(
                    ". Read it with {READ_MCP_RESOURCE_TOOL} (server \"{server}\")"
                ));
                content.push(TextContentOrImage::text(text));
            }
            ContentBlock::Other(value) => {
                content.push(TextContentOrImage::text(value.to_string()));
            }
        }
    }
    if result.is_error && content.is_empty() {
        content.push(TextContentOrImage::text(format!(
            "MCP tool {server}/{tool} returned an error"
        )));
    }
    let (content, full_output_path) = limit_content(content);
    AgentToolResult {
        content,
        details: json!({
            "server": server,
            "tool": tool,
            "fullOutputPath": full_output_path,
        }),
        structured_content: result.structured_content,
        usage: None,
        added_tool_names: Vec::new(),
        is_error: result.is_error,
        terminate: false,
    }
}

fn limit_content(content: Vec<TextContentOrImage>) -> (Vec<TextContentOrImage>, Option<String>) {
    let combined: String = content
        .iter()
        .filter_map(|block| match block {
            TextContentOrImage::Text(text) => Some(text.text.clone()),
            TextContentOrImage::Image(_) => None,
        })
        .collect::<Vec<String>>()
        .join("\n");
    if combined.len() <= MCP_OUTPUT_MAX_BYTES {
        return (content, None);
    }
    let path = write_full_output(&combined);
    let half = MCP_OUTPUT_MAX_BYTES / 2;
    let head = &combined[..half.min(combined.len())];
    let tail = &combined[combined.len().saturating_sub(half)..];
    let tokens = combined.len().div_ceil(4);
    let lines = combined.lines().count();
    let where_ = match &path {
        Some(path) => format!("[Full output: {path} (read it with offset/limit)]"),
        None => "[Could not save the full output]".to_string(),
    };
    let text = format!(
        "Warning: truncated output (original token count: {tokens})\nTotal output lines: {lines}\n\n{head}\n\n{tail}\n\n{where_}"
    );
    let mut limited = vec![TextContentOrImage::text(text)];
    for block in content {
        if let TextContentOrImage::Image(_) = block {
            limited.push(block);
        }
    }
    (limited, path)
}

fn write_full_output(text: &str) -> Option<String> {
    let directory = std::env::temp_dir().join("rpi-mcp");
    std::fs::create_dir_all(&directory).ok()?;
    let name = format!("mcp-{}.txt", uuid::Uuid::new_v4());
    let path = directory.join(name);
    std::fs::write(&path, text).ok()?;
    Some(path.to_string_lossy().into_owned())
}

pub fn mcp_tool_schema(name: &str, description: &str, parameters: Value) -> Tool {
    Tool {
        name: name.to_string(),
        description: description.to_string(),
        parameters: Schema::new(parameters),
        constrained_sampling: None,
    }
}

pub fn resource_tools(manager: Arc<McpManager>) -> Vec<Arc<dyn AgentTool>> {
    vec![
        Arc::new(McpResourceTool::new(
            manager.clone(),
            LIST_MCP_RESOURCES_TOOL,
            "Lists resources provided by MCP servers. Resources allow servers to share data that provides context to language models, such as files, database schemas, or application-specific information. Prefer resources over web search when possible.",
            "list",
        )),
        Arc::new(McpResourceTool::new(
            manager.clone(),
            LIST_MCP_RESOURCE_TEMPLATES_TOOL,
            "Lists resource templates provided by MCP servers. Parameterized resource templates allow servers to share data that takes parameters and provides context to language models, such as files, database schemas, or application-specific information. Prefer resource templates over web search when possible.",
            "templates",
        )),
        Arc::new(McpResourceTool::new(
            manager,
            READ_MCP_RESOURCE_TOOL,
            "Read a specific resource from an MCP server given the server name and resource URI.",
            "read",
        )),
    ]
}

pub struct McpResourceTool {
    manager: Arc<McpManager>,
    name: String,
    description: String,
    kind: String,
    schema: Tool,
}

impl McpResourceTool {
    fn new(manager: Arc<McpManager>, name: &str, description: &str, kind: &str) -> Self {
        let parameters = if kind == "read" {
            json!({
                "type": "object",
                "properties": {
                    "server": {
                        "type": "string",
                        "description": "MCP server name exactly as configured. Must match the 'server' field returned by list_mcp_resources."
                    },
                    "uri": {
                        "type": "string",
                        "description": "Resource URI to read. Must be one of the URIs returned by list_mcp_resources."
                    }
                },
                "required": ["server", "uri"],
                "additionalProperties": false,
            })
        } else {
            json!({
                "type": "object",
                "properties": {
                    "server": {
                        "type": "string",
                        "description": "MCP server name. Omit to list every server with resources."
                    },
                    "cursor": {
                        "type": "string",
                        "description": "Opaque cursor from a previous call with the same server; omit for the first page."
                    }
                },
                "additionalProperties": false,
            })
        };
        McpResourceTool {
            manager,
            name: name.to_string(),
            description: description.to_string(),
            kind: kind.to_string(),
            schema: mcp_tool_schema(name, description, parameters),
        }
    }
}

#[async_trait::async_trait]
impl AgentTool for McpResourceTool {
    fn schema(&self) -> &Tool {
        &self.schema
    }

    fn label(&self) -> &str {
        &self.name
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        params: Value,
        _signal: CancellationToken,
        _on_update: Arc<dyn Fn(rpi_agent::types::ToolResultPartial) + Send + Sync>,
    ) -> Result<AgentToolResult, AgentError> {
        let payload = match self.kind.as_str() {
            "read" => {
                let server = params
                    .get("server")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .ok_or_else(|| AgentError::Tool("server must be provided".to_string()))?;
                let uri = params
                    .get("uri")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .ok_or_else(|| AgentError::Tool("uri must be provided".to_string()))?;
                self.manager
                    .read_resource(&server, &uri)
                    .await
                    .map_err(AgentError::Tool)?
            }
            "templates" => self.list(false, &params).await?,
            _ => self.list(true, &params).await?,
        };
        let text = serde_json::to_string_pretty(&payload)
            .unwrap_or_else(|_| payload.to_string());
        Ok(AgentToolResult {
            content: vec![TextContentOrImage::text(text)],
            details: json!({ "tool": self.name }),
            structured_content: Some(payload),
            usage: None,
            added_tool_names: Vec::new(),
            is_error: false,
            terminate: false,
        })
    }
}

impl McpResourceTool {
    async fn list(&self, resources: bool, params: &Value) -> Result<Value, AgentError> {
        let requested = params
            .get("server")
            .and_then(Value::as_str)
            .map(str::to_string);
        let servers = match requested {
            Some(name) => vec![name],
            None => self.manager.servers_with_resources(),
        };
        let mut items: Vec<Value> = Vec::new();
        let mut errors: Vec<Value> = Vec::new();
        for name in servers {
            let outcome = if resources {
                self.manager.list_resources(&name).await
            } else {
                self.manager.list_resource_templates(&name).await
            };
            match outcome {
                Ok(payload) => {
                    let key = if resources { "resources" } else { "resourceTemplates" };
                    if let Some(entries) = payload.get(key).and_then(Value::as_array) {
                        items.extend(entries.iter().cloned());
                    }
                }
                Err(error) => errors.push(json!({ "server": name, "error": error })),
            }
        }
        let key = if resources { "resources" } else { "resourceTemplates" };
        let mut payload = json!({ key: items });
        if !errors.is_empty() {
            payload["errors"] = Value::Array(errors);
        }
        Ok(payload)
    }
}

pub fn server_config_to_value(config: &McpServerConfig) -> Value {
    json!({
        "command": config.command,
        "args": config.args,
        "env": config.env.iter().cloned().collect::<std::collections::BTreeMap<String, String>>(),
        "cwd": config.cwd,
        "url": config.url,
        "headers": config.headers.iter().cloned().collect::<std::collections::BTreeMap<String, String>>(),
        "exposure": config.exposure.as_str(),
        "description": config.description,
        "enabled": config.enabled,
        "timeout": config.timeout_seconds,
    })
}
