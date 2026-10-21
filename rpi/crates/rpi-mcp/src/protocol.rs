use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const LATEST_PROTOCOL_VERSION: &str = "2025-11-25";
pub const SUPPORTED_PROTOCOL_VERSIONS: &[&str] = &[
    "2025-11-25",
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
];

pub mod error_code {
    pub const PARSE_ERROR: i64 = -32700;
    pub const INVALID_REQUEST: i64 = -32600;
    pub const METHOD_NOT_FOUND: i64 = -32601;
    pub const INVALID_PARAMS: i64 = -32602;
    pub const INTERNAL_ERROR: i64 = -32603;
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum McpError {
    #[error("MCP connection closed")]
    ConnectionClosed,
    #[error("MCP request timed out after {0}ms")]
    Timeout(u64),
    #[error("MCP error {code}: {message}")]
    Rpc { code: i64, message: String },
    #[error("MCP transport error: {0}")]
    Transport(String),
    #[error("MCP protocol error: {0}")]
    Protocol(String),
    #[error("MCP HTTP request failed with status {status}: {message}")]
    Http { status: u16, message: String },
    #[error("MCP server requires authentication")]
    AuthRequired,
}

impl McpError {
    pub fn rpc(code: i64, message: impl Into<String>) -> Self {
        McpError::Rpc {
            code,
            message: message.into(),
        }
    }

    pub fn protocol(message: impl Into<String>) -> Self {
        McpError::Protocol(message.into())
    }

    pub fn transport(message: impl Into<String>) -> Self {
        McpError::Transport(message.into())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, Default, PartialEq, Eq)]
pub struct Implementation {
    pub name: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// A root the client offers the server, as in `roots/list`.
#[derive(Debug, Clone, Deserialize, Serialize, Default, PartialEq, Eq)]
pub struct McpRoot {
    pub uri: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct InitializeResult {
    pub protocol_version: String,
    pub capabilities: Value,
    pub server_info: Implementation,
    pub instructions: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct McpTool {
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub input_schema: Value,
    pub output_schema: Option<Value>,
    pub annotations: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct ToolWire {
    name: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default, rename = "inputSchema")]
    input_schema: Option<Value>,
    #[serde(default, rename = "outputSchema")]
    output_schema: Option<Value>,
    #[serde(default)]
    annotations: Option<Value>,
}

impl<'de> Deserialize<'de> for McpTool {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let wire = ToolWire::deserialize(deserializer)?;
        let input_schema = match wire.input_schema {
            Some(Value::Object(mut fields)) => {
                fields.entry("type").or_insert(Value::String("object".into()));
                if !fields.contains_key("properties") {
                    fields.insert("properties".into(), Value::Object(Default::default()));
                }
                Value::Object(fields)
            }
            Some(other) => other,
            None => serde_json::json!({ "type": "object", "properties": {} }),
        };
        Ok(McpTool {
            name: wire.name,
            title: wire.title,
            description: wire.description,
            input_schema,
            output_schema: wire.output_schema,
            annotations: wire.annotations,
        })
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ResourceContents {
    pub uri: String,
    pub mime_type: Option<String>,
    pub text: Option<String>,
    pub blob: Option<String>,
}

#[derive(Debug, Clone)]
pub enum ContentBlock {
    Text {
        text: String,
    },
    Image {
        data: String,
        mime_type: Option<String>,
    },
    Audio {
        data: String,
        mime_type: Option<String>,
    },
    Resource {
        contents: ResourceContents,
    },
    ResourceLink {
        uri: String,
        name: Option<String>,
        title: Option<String>,
        description: Option<String>,
        mime_type: Option<String>,
        size: Option<u64>,
    },
    Other(Value),
}

impl ContentBlock {
    pub fn from_value(value: Value) -> Self {
        let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "text" => ContentBlock::Text {
                text: value
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            },
            "image" => ContentBlock::Image {
                data: value
                    .get("data")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                mime_type: value
                    .get("mimeType")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            },
            "audio" => ContentBlock::Audio {
                data: value
                    .get("data")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                mime_type: value
                    .get("mimeType")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            },
            "resource" => {
                let resource = value.get("resource").cloned().unwrap_or(Value::Null);
                ContentBlock::Resource {
                    contents: ResourceContents {
                        uri: resource
                            .get("uri")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        mime_type: resource
                            .get("mimeType")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        text: resource
                            .get("text")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        blob: resource
                            .get("blob")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                    },
                }
            }
            "resource_link" => ContentBlock::ResourceLink {
                uri: value
                    .get("uri")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                name: value.get("name").and_then(Value::as_str).map(str::to_string),
                title: value.get("title").and_then(Value::as_str).map(str::to_string),
                description: value
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                mime_type: value
                    .get("mimeType")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                size: value.get("size").and_then(Value::as_u64),
            },
            _ => ContentBlock::Other(value),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct CallToolResult {
    pub content: Vec<ContentBlock>,
    pub structured_content: Option<Value>,
    pub is_error: bool,
}

impl CallToolResult {
    pub fn from_value(value: Value) -> Self {
        let content = value
            .get("content")
            .and_then(Value::as_array)
            .map(|blocks| blocks.iter().cloned().map(ContentBlock::from_value).collect())
            .unwrap_or_default();
        CallToolResult {
            content,
            structured_content: value.get("structuredContent").cloned(),
            is_error: value
                .get("isError")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        }
    }

    pub fn text(&self) -> String {
        self.content
            .iter()
            .filter_map(|block| match block {
                ContentBlock::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<&str>>()
            .join("\n")
    }
}

#[derive(Debug, Clone, Default)]
pub struct Resource {
    pub uri: String,
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub mime_type: Option<String>,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Default)]
pub struct ResourceTemplate {
    pub uri_template: String,
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ReadResourceResult {
    pub contents: Vec<ResourceContents>,
}

pub fn is_object(value: &Value) -> bool {
    value.is_object()
}

pub fn is_json_rpc_id(value: &Value) -> bool {
    match value {
        Value::String(_) => true,
        Value::Number(number) => number.as_f64().is_some_and(|value| value.is_finite()),
        _ => false,
    }
}

pub fn is_json_rpc_response(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return false;
    }
    let Some(id) = object.get("id") else {
        return false;
    };
    if !is_json_rpc_id(id) {
        return false;
    }
    if object.contains_key("result") {
        return !object.contains_key("error");
    }
    match object.get("error") {
        Some(error) => {
            error.get("code").and_then(Value::as_i64).is_some()
                && error.get("message").and_then(Value::as_str).is_some()
        }
        None => false,
    }
}

pub fn is_json_rpc_request(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.get("jsonrpc").and_then(Value::as_str) == Some("2.0")
        && object
            .get("id")
            .map(is_json_rpc_id)
            .unwrap_or(false)
        && object.get("method").and_then(Value::as_str).is_some()
}

pub fn is_json_rpc_notification(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.get("jsonrpc").and_then(Value::as_str) == Some("2.0")
        && !object.contains_key("id")
        && object.get("method").and_then(Value::as_str).is_some()
}

pub fn parse_message(value: Value) -> Result<Value, McpError> {
    if is_json_rpc_response(&value)
        || is_json_rpc_request(&value)
        || is_json_rpc_notification(&value)
    {
        return Ok(value);
    }
    Err(McpError::rpc(
        error_code::INVALID_REQUEST,
        "Invalid JSON-RPC message",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_schema_defaults_to_an_object() {
        let tool: McpTool = serde_json::from_value(serde_json::json!({ "name": "ping" })).unwrap();
        assert_eq!(tool.name, "ping");
        assert_eq!(tool.input_schema["type"], "object");
        assert!(tool.input_schema["properties"].is_object());
    }

    #[test]
    fn tool_schema_keeps_its_properties() {
        let tool: McpTool = serde_json::from_value(serde_json::json!({
            "name": "echo",
            "inputSchema": { "type": "object", "properties": { "text": { "type": "string" } } }
        }))
        .unwrap();
        assert_eq!(tool.input_schema["properties"]["text"]["type"], "string");
    }

    #[test]
    fn responses_are_recognized() {
        let response = serde_json::json!({ "jsonrpc": "2.0", "id": 1, "result": {} });
        assert!(is_json_rpc_response(&response));
        let error = serde_json::json!({ "jsonrpc": "2.0", "id": 1, "error": { "code": -32601, "message": "no" } });
        assert!(is_json_rpc_response(&error));
        let request = serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" });
        assert!(is_json_rpc_request(&request));
        let notification = serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
        assert!(is_json_rpc_notification(&notification));
    }

    #[test]
    fn call_tool_result_reads_the_error_flag() {
        let result = CallToolResult::from_value(serde_json::json!({
            "content": [{ "type": "text", "text": "boom" }],
            "isError": true
        }));
        assert!(result.is_error);
        assert_eq!(result.text(), "boom");
    }
}
