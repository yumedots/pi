use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::protocol::{
    error_code, is_json_rpc_request, is_json_rpc_response, parse_message, CallToolResult,
    Implementation, InitializeResult, McpError, McpRoot, McpTool, ReadResourceResult, Resource,
    ResourceTemplate, LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS,
};
use crate::transport::{McpTransport, TransportEvent, TransportSink};

const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 30_000;
const MAX_LIST_PAGES: usize = 1_000;

#[derive(Debug, Clone)]
pub struct McpClientOptions {
    pub name: String,
    pub version: String,
    pub protocol_version: Option<String>,
    pub request_timeout_ms: Option<u64>,
    /// The roots the server may ask for with `roots/list`. The session's
    /// working directory is the one the original offers.
    pub roots: Vec<McpRoot>,
}

impl Default for McpClientOptions {
    fn default() -> Self {
        McpClientOptions {
            name: "rpi".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            protocol_version: None,
            request_timeout_ms: None,
            roots: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientState {
    Idle,
    Connecting,
    Connected,
    Closed,
}

pub struct McpClient {
    options: McpClientOptions,
    transport: Mutex<Option<Arc<dyn McpTransport>>>,
    next_id: AtomicI64,
    pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, McpError>>>>>,
    state: Arc<Mutex<ClientState>>,
    server_info: Arc<Mutex<Option<Implementation>>>,
    capabilities: Arc<Mutex<Value>>,
    instructions: Arc<Mutex<Option<String>>>,
    protocol_version: Arc<Mutex<Option<String>>>,
    last_error: Arc<Mutex<Option<String>>>,
    reader: Mutex<Option<JoinHandle<()>>>,
}

impl McpClient {
    pub fn new(options: McpClientOptions) -> Self {
        McpClient {
            options,
            transport: Mutex::new(None),
            next_id: AtomicI64::new(1),
            pending: Arc::new(Mutex::new(HashMap::new())),
            state: Arc::new(Mutex::new(ClientState::Idle)),
            server_info: Arc::new(Mutex::new(None)),
            capabilities: Arc::new(Mutex::new(Value::Null)),
            instructions: Arc::new(Mutex::new(None)),
            protocol_version: Arc::new(Mutex::new(None)),
            last_error: Arc::new(Mutex::new(None)),
            reader: Mutex::new(None),
        }
    }

    pub fn state(&self) -> ClientState {
        *self.state.lock().unwrap_or_else(|error| error.into_inner())
    }

    pub fn server_info(&self) -> Option<Implementation> {
        self.server_info
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub fn capabilities(&self) -> Value {
        self.capabilities
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub fn instructions(&self) -> Option<String> {
        self.instructions
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub fn last_error(&self) -> Option<String> {
        self.last_error
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub fn protocol_version(&self) -> Option<String> {
        self.protocol_version
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub async fn connect(&self, transport: Arc<dyn McpTransport>) -> Result<InitializeResult, McpError> {
        if self.state() != ClientState::Idle {
            return Err(McpError::transport(format!(
                "cannot connect an MCP client in the {:?} state",
                self.state()
            )));
        }
        *self.state.lock().unwrap_or_else(|error| error.into_inner()) = ClientState::Connecting;
        *self.transport.lock().unwrap_or_else(|error| error.into_inner()) = Some(transport.clone());

        let (sender, mut receiver) = mpsc::unbounded_channel();
        if let Err(error) = transport.start(TransportSink::new(sender)).await {
            self.mark_closed();
            return Err(error);
        }

        let pending = Arc::clone(&self.pending);
        let last_error = Arc::clone(&self.last_error);
        let state = Arc::clone(&self.state);
        let roots = self.options.roots.clone();
        let reader = tokio::spawn(async move {
            while let Some(event) = receiver.recv().await {
                match event {
                    TransportEvent::Message(message) => {
                        handle_message(message, &pending, &transport, &roots).await;
                    }
                    TransportEvent::Error(message) => {
                        *last_error.lock().unwrap_or_else(|error| error.into_inner()) = Some(message);
                    }
                    TransportEvent::Closed => {
                        reject_pending(&pending, McpError::ConnectionClosed);
                        *state.lock().unwrap_or_else(|error| error.into_inner()) = ClientState::Closed;
                    }
                }
            }
        });
        *self.reader.lock().unwrap_or_else(|error| error.into_inner()) = Some(reader);

        let mut capabilities = serde_json::Map::new();
        if !self.options.roots.is_empty() {
            capabilities.insert("roots".to_string(), json!({}));
        }
        let params = json!({
            "protocolVersion": self
                .options
                .protocol_version
                .clone()
                .unwrap_or_else(|| LATEST_PROTOCOL_VERSION.to_string()),
            "capabilities": Value::Object(capabilities),
            "clientInfo": {
                "name": self.options.name,
                "version": self.options.version,
            }
        });
        let result = match self.request("initialize", Some(params), None).await {
            Ok(result) => result,
            Err(error) => {
                self.mark_closed();
                return Err(error);
            }
        };
        let initialized = match validate_initialize_result(result) {
            Ok(initialized) => initialized,
            Err(error) => {
                self.mark_closed();
                return Err(error);
            }
        };
        if !SUPPORTED_PROTOCOL_VERSIONS.contains(&initialized.protocol_version.as_str()) {
            let message = format!(
                "MCP server selected unsupported protocol version {}",
                initialized.protocol_version
            );
            self.mark_closed();
            return Err(McpError::protocol(message));
        }
        *self.protocol_version.lock().unwrap_or_else(|error| error.into_inner()) =
            Some(initialized.protocol_version.clone());
        *self.server_info.lock().unwrap_or_else(|error| error.into_inner()) =
            Some(initialized.server_info.clone());
        *self.capabilities.lock().unwrap_or_else(|error| error.into_inner()) =
            initialized.capabilities.clone();
        *self.instructions.lock().unwrap_or_else(|error| error.into_inner()) =
            initialized.instructions.clone();
        if let Err(error) = self.notify("notifications/initialized", None).await {
            self.mark_closed();
            return Err(error);
        }
        *self.state.lock().unwrap_or_else(|error| error.into_inner()) = ClientState::Connected;
        Ok(initialized)
    }

    pub async fn request(
        &self,
        method: &str,
        params: Option<Value>,
        timeout_ms: Option<u64>,
    ) -> Result<Value, McpError> {
        let transport = self.require_transport()?;
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let mut message = json!({ "jsonrpc": "2.0", "id": id, "method": method });
        if let Some(params) = params {
            message["params"] = params;
        }
        let (reply, answers) = oneshot::channel();
        self.pending
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(id, reply);
        let timeout_ms = timeout_ms
            .or(self.options.request_timeout_ms)
            .unwrap_or(DEFAULT_REQUEST_TIMEOUT_MS);
        if let Err(error) = transport.send(&message).await {
            self.pending
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .remove(&id);
            return Err(error);
        }
        match tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), answers).await {
            Ok(Ok(answer)) => answer,
            Ok(Err(_)) => Err(McpError::ConnectionClosed),
            Err(_) => {
                self.pending
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .remove(&id);
                Err(McpError::Timeout(timeout_ms))
            }
        }
    }

    pub async fn notify(&self, method: &str, params: Option<Value>) -> Result<(), McpError> {
        let transport = self.require_transport()?;
        let mut message = json!({ "jsonrpc": "2.0", "method": method });
        if let Some(params) = params {
            message["params"] = params;
        }
        transport.send(&message).await
    }

    pub async fn ping(&self) -> Result<(), McpError> {
        self.request("ping", None, None).await.map(|_| ())
    }

    pub async fn list_tools(&self) -> Result<Vec<McpTool>, McpError> {
        let items = self.list_all("tools/list", "tools").await?;
        let mut tools = Vec::with_capacity(items.len());
        for item in items {
            let tool: McpTool = serde_json::from_value(item)
                .map_err(|error| McpError::protocol(error.to_string()))?;
            tools.push(tool);
        }
        Ok(tools)
    }

    pub async fn call_tool(
        &self,
        name: &str,
        arguments: Value,
        timeout_ms: Option<u64>,
    ) -> Result<CallToolResult, McpError> {
        let mut params = json!({ "name": name });
        if !arguments.is_null() {
            params["arguments"] = arguments;
        }
        let result = self.request("tools/call", Some(params), timeout_ms).await?;
        Ok(CallToolResult::from_value(result))
    }

    pub async fn list_resources(&self) -> Result<Vec<Resource>, McpError> {
        let items = self.list_all("resources/list", "resources").await?;
        let mut resources = Vec::with_capacity(items.len());
        for item in items {
            let uri = item.get("uri").and_then(Value::as_str).unwrap_or_default();
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(uri)
                .to_string();
            resources.push(Resource {
                uri: uri.to_string(),
                name,
                title: item.get("title").and_then(Value::as_str).map(str::to_string),
                description: item
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                mime_type: item.get("mimeType").and_then(Value::as_str).map(str::to_string),
                size: item.get("size").and_then(Value::as_u64),
            });
        }
        Ok(resources)
    }

    pub async fn list_resource_templates(&self) -> Result<Vec<ResourceTemplate>, McpError> {
        let items = self
            .list_all("resources/templates/list", "resourceTemplates")
            .await?;
        let mut templates = Vec::with_capacity(items.len());
        for item in items {
            let uri_template = item
                .get("uriTemplate")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(uri_template)
                .to_string();
            templates.push(ResourceTemplate {
                uri_template: uri_template.to_string(),
                name,
                title: item.get("title").and_then(Value::as_str).map(str::to_string),
                description: item
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                mime_type: item.get("mimeType").and_then(Value::as_str).map(str::to_string),
            });
        }
        Ok(templates)
    }

    pub async fn read_resource(&self, uri: &str) -> Result<ReadResourceResult, McpError> {
        let result = self
            .request("resources/read", Some(json!({ "uri": uri })), None)
            .await?;
        let contents = result
            .get("contents")
            .and_then(Value::as_array)
            .ok_or_else(|| McpError::protocol("Invalid MCP resources/read result"))?;
        let mut parsed = Vec::with_capacity(contents.len());
        for entry in contents {
            let uri = entry.get("uri").and_then(Value::as_str).unwrap_or_default();
            let text = entry.get("text").and_then(Value::as_str).map(str::to_string);
            let blob = entry.get("blob").and_then(Value::as_str).map(str::to_string);
            if text.is_none() && blob.is_none() {
                return Err(McpError::protocol(
                    "Invalid contents in MCP resources/read result",
                ));
            }
            parsed.push(crate::protocol::ResourceContents {
                uri: uri.to_string(),
                mime_type: entry.get("mimeType").and_then(Value::as_str).map(str::to_string),
                text,
                blob,
            });
        }
        Ok(ReadResourceResult { contents: parsed })
    }

    pub async fn close(&self) {
        let transport = self
            .transport
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take();
        self.mark_closed();
        if let Some(transport) = transport {
            let _ = transport.close().await;
        }
        if let Some(reader) = self
            .reader
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
        {
            reader.abort();
        }
    }

    async fn list_all(&self, method: &str, key: &str) -> Result<Vec<Value>, McpError> {
        let mut items = Vec::new();
        let mut cursors: Vec<String> = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..MAX_LIST_PAGES {
            let params = match &cursor {
                Some(cursor) => Some(json!({ "cursor": cursor })),
                None => None,
            };
            let result = self.request(method, params, None).await?;
            let page = result
                .get(key)
                .and_then(Value::as_array)
                .ok_or_else(|| McpError::protocol(format!("Invalid MCP {method} result")))?;
            items.extend(page.iter().cloned());
            let next = match result.get("nextCursor") {
                Some(Value::String(cursor)) if !cursor.is_empty() => Some(cursor.clone()),
                _ => None,
            };
            let Some(next) = next else {
                return Ok(items);
            };
            if cursors.contains(&next) {
                return Err(McpError::protocol(format!(
                    "MCP {method} returned duplicate cursor: {next}"
                )));
            }
            cursors.push(next.clone());
            cursor = Some(next);
        }
        Err(McpError::protocol(format!(
            "MCP {method} exceeded {MAX_LIST_PAGES} pages"
        )))
    }

    fn require_transport(&self) -> Result<Arc<dyn McpTransport>, McpError> {
        let transport = self
            .transport
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        match transport {
            Some(transport) => Ok(transport),
            None => Err(McpError::ConnectionClosed),
        }
    }

    fn mark_closed(&self) {
        *self.state.lock().unwrap_or_else(|error| error.into_inner()) = ClientState::Closed;
        reject_pending(&self.pending, McpError::ConnectionClosed);
    }
}

fn validate_initialize_result(value: Value) -> Result<InitializeResult, McpError> {
    let protocol_version = value
        .get("protocolVersion")
        .and_then(Value::as_str)
        .ok_or_else(|| McpError::protocol("Invalid MCP initialize result"))?;
    let capabilities = value
        .get("capabilities")
        .filter(|value| value.is_object())
        .cloned()
        .ok_or_else(|| McpError::protocol("Invalid MCP initialize result"))?;
    let server_info = value
        .get("serverInfo")
        .filter(|value| value.is_object())
        .ok_or_else(|| McpError::protocol("Invalid MCP initialize result"))?;
    let name = server_info
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| McpError::protocol("Invalid MCP initialize result"))?;
    let version = server_info
        .get("version")
        .and_then(Value::as_str)
        .ok_or_else(|| McpError::protocol("Invalid MCP initialize result"))?;
    let instructions = match value.get("instructions") {
        Some(Value::String(instructions)) => Some(instructions.clone()),
        None | Some(Value::Null) => None,
        Some(_) => return Err(McpError::protocol("Invalid MCP initialize result")),
    };
    Ok(InitializeResult {
        protocol_version: protocol_version.to_string(),
        capabilities,
        server_info: Implementation {
            name: name.to_string(),
            version: version.to_string(),
            title: server_info
                .get("title")
                .and_then(Value::as_str)
                .map(str::to_string),
        },
        instructions,
    })
}

fn reject_pending(
    pending: &Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, McpError>>>>>,
    error: McpError,
) {
    let mut pending = pending.lock().unwrap_or_else(|error| error.into_inner());
    for (_, reply) in pending.drain() {
        let _ = reply.send(Err(error.clone()));
    }
}

async fn handle_message(
    message: Value,
    pending: &Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, McpError>>>>>,
    transport: &Arc<dyn McpTransport>,
    roots: &[McpRoot],
) {
    let message = match parse_message(message) {
        Ok(message) => message,
        Err(_) => return,
    };
    if is_json_rpc_response(&message) {
        let id = message
            .get("id")
            .and_then(Value::as_i64)
            .or_else(|| message.get("id").and_then(Value::as_str).and_then(|id| id.parse().ok()));
        let Some(id) = id else { return };
        let reply = pending
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&id);
        let Some(reply) = reply else { return };
        let answer = match message.get("error") {
            Some(error) => {
                let code = error.get("code").and_then(Value::as_i64).unwrap_or(-32603);
                let text = error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("MCP error")
                    .to_string();
                Err(McpError::rpc(code, text))
            }
            None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
        };
        let _ = reply.send(answer);
        return;
    }
    if !is_json_rpc_request(&message) {
        return;
    }
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let result = match method.as_str() {
        "ping" => json!({}),
        "roots/list" => json!({ "roots": roots }),
        _ => {
            let error = json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": error_code::METHOD_NOT_FOUND,
                    "message": format!("Method not found: {method}"),
                }
            });
            let _ = transport.send(&error).await;
            return;
        }
    };
    let response = json!({ "jsonrpc": "2.0", "id": id, "result": result });
    let _ = transport.send(&response).await;
}
