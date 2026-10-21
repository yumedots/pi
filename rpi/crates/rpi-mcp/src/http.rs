use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use futures::StreamExt;
use serde_json::Value;

use crate::protocol::McpError;
use crate::transport::{McpTransport, TransportSink};

const MAX_ERROR_BODY_BYTES: usize = 8 * 1024;
const ERROR_MESSAGE_BODY_CHARS: usize = 500;

#[derive(Debug, Clone, Default)]
pub struct HttpOptions {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub open_get_stream: bool,
}

pub struct StreamableHttpTransport {
    options: HttpOptions,
    client: reqwest::Client,
    session_id: Mutex<Option<String>>,
    protocol_version: Mutex<Option<String>>,
    sink: Mutex<Option<TransportSink>>,
}

impl StreamableHttpTransport {
    pub fn new(options: HttpOptions) -> Self {
        StreamableHttpTransport {
            options,
            client: reqwest::Client::new(),
            session_id: Mutex::new(None),
            protocol_version: Mutex::new(None),
            sink: Mutex::new(None),
        }
    }

    pub fn session_id(&self) -> Option<String> {
        self.session_id
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub fn set_protocol_version(&self, version: &str) {
        *self
            .protocol_version
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(version.to_string());
    }

    fn build_headers(&self) -> reqwest::header::HeaderMap {
        let mut headers = reqwest::header::HeaderMap::new();
        for (name, value) in &self.options.headers {
            if let (Ok(name), Ok(value)) = (
                reqwest::header::HeaderName::from_bytes(name.as_bytes()),
                reqwest::header::HeaderValue::from_str(value),
            ) {
                headers.insert(name, value);
            }
        }
        if let Some(session_id) = self.session_id() {
            if let Ok(value) = reqwest::header::HeaderValue::from_str(&session_id) {
                headers.insert("mcp-session-id", value);
            }
        }
        if let Some(version) = self
            .protocol_version
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
        {
            if let Ok(value) = reqwest::header::HeaderValue::from_str(&version) {
                headers.insert("mcp-protocol-version", value);
            }
        }
        headers
    }

    fn capture_session(&self, response: &reqwest::Response) {
        if let Some(session_id) = response
            .headers()
            .get("mcp-session-id")
            .and_then(|value| value.to_str().ok())
        {
            *self
                .session_id
                .lock()
                .unwrap_or_else(|error| error.into_inner()) = Some(session_id.to_string());
        }
    }

    async fn consume_stream(&self, response: reqwest::Response, sink: TransportSink) {
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut data_lines: Vec<String> = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(chunk) => chunk,
                Err(error) => {
                    sink.error(error.to_string());
                    break;
                }
            };
            let text = String::from_utf8_lossy(&chunk).to_string();
            buffer.push_str(&text);
            while let Some(index) = buffer.find('\n') {
                let line = buffer[..index].trim_end_matches('\r').to_string();
                buffer = buffer[index + 1..].to_string();
                if line.is_empty() {
                    if !data_lines.is_empty() {
                        let payload = data_lines.join("\n");
                        data_lines.clear();
                        match serde_json::from_str::<Value>(&payload) {
                            Ok(message) => sink.message(message),
                            Err(error) => sink.error(error.to_string()),
                        }
                    }
                    continue;
                }
                if let Some(rest) = line.strip_prefix("data:") {
                    data_lines.push(rest.strip_prefix(' ').unwrap_or(rest).to_string());
                }
            }
        }
        if !data_lines.is_empty() {
            let payload = data_lines.join("\n");
            if let Ok(message) = serde_json::from_str::<Value>(&payload) {
                sink.message(message);
            }
        }
        sink.closed();
    }

    fn open_get_stream(&self, sink: TransportSink) {
        if !self.options.open_get_stream {
            return;
        }
        let client = self.client.clone();
        let url = self.options.url.clone();
        let headers = self.build_headers();
        tokio::spawn(async move {
            let request = client
                .get(&url)
                .headers(headers)
                .header("accept", "text/event-stream");
            match request.send().await {
                Ok(response) if response.status().is_success() => {
                    let mut stream = response.bytes_stream();
                    let mut buffer = String::new();
                    let mut data_lines: Vec<String> = Vec::new();
                    while let Some(chunk) = stream.next().await {
                        let Ok(chunk) = chunk else { break };
                        buffer.push_str(&String::from_utf8_lossy(&chunk));
                        while let Some(index) = buffer.find('\n') {
                            let line = buffer[..index].trim_end_matches('\r').to_string();
                            buffer = buffer[index + 1..].to_string();
                            if line.is_empty() {
                                if !data_lines.is_empty() {
                                    let payload = data_lines.join("\n");
                                    data_lines.clear();
                                    if let Ok(message) = serde_json::from_str::<Value>(&payload) {
                                        sink.message(message);
                                    }
                                }
                                continue;
                            }
                            if let Some(rest) = line.strip_prefix("data:") {
                                data_lines.push(rest.strip_prefix(' ').unwrap_or(rest).to_string());
                            }
                        }
                    }
                }
                Ok(response) => {
                    sink.error(format!(
                        "MCP server-to-client stream failed with status {}",
                        response.status().as_u16()
                    ));
                }
                Err(error) => sink.error(error.to_string()),
            }
        });
    }
}

#[async_trait]
impl McpTransport for StreamableHttpTransport {
    async fn start(&self, sink: TransportSink) -> Result<(), McpError> {
        if self.options.url.is_empty() {
            return Err(McpError::transport("the MCP server has no url"));
        }
        *self.sink.lock().unwrap_or_else(|error| error.into_inner()) = Some(sink);
        Ok(())
    }

    async fn send(&self, message: &Value) -> Result<(), McpError> {
        let sink = self
            .sink
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
            .ok_or(McpError::ConnectionClosed)?;
        let mut headers = self.build_headers();
        headers.insert(
            reqwest::header::ACCEPT,
            reqwest::header::HeaderValue::from_static("application/json, text/event-stream"),
        );
        headers.insert(
            reqwest::header::CONTENT_TYPE,
            reqwest::header::HeaderValue::from_static("application/json"),
        );
        let body = serde_json::to_string(message)
            .map_err(|error| McpError::protocol(error.to_string()))?;
        let response = self
            .client
            .post(&self.options.url)
            .headers(headers)
            .body(body)
            .send()
            .await
            .map_err(|error| McpError::transport(error.to_string()))?;
        let status = response.status();
        if status.as_u16() == 401 {
            return Err(McpError::AuthRequired);
        }
        if status.as_u16() == 404 {
            return Err(McpError::Http {
                status: 404,
                message: "MCP session expired".to_string(),
            });
        }
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            let snippet: String = text.chars().take(ERROR_MESSAGE_BODY_CHARS).collect();
            return Err(McpError::Http {
                status: status.as_u16(),
                message: snippet.trim().to_string(),
            });
        }
        self.capture_session(&response);
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| {
                value
                    .split(';')
                    .next()
                    .unwrap_or_default()
                    .trim()
                    .to_lowercase()
            })
            .unwrap_or_default();
        let is_request = message.get("id").is_some() && message.get("method").is_some();
        if !is_request {
            if message.get("method").and_then(Value::as_str) == Some("notifications/initialized") {
                self.open_get_stream(sink.clone());
            }
            return Ok(());
        }
        if content_type == "application/json" {
            let body = response
                .text()
                .await
                .map_err(|error| McpError::transport(error.to_string()))?;
            let parsed: Value = serde_json::from_str(&body)
                .map_err(|error| McpError::protocol(error.to_string()))?;
            let messages = match parsed {
                Value::Array(items) => items,
                other => vec![other],
            };
            for item in messages {
                sink.message(item);
            }
            return Ok(());
        }
        if content_type == "text/event-stream" {
            self.consume_stream(response, sink).await;
            return Ok(());
        }
        Err(McpError::Http {
            status: status.as_u16(),
            message: format!(
                "Unsupported MCP response content type: {}",
                if content_type.is_empty() {
                    "missing"
                } else {
                    &content_type
                }
            ),
        })
    }

    async fn close(&self) -> Result<(), McpError> {
        if let Some(session_id) = self.session_id() {
            let headers = self.build_headers();
            let _ = self
                .client
                .delete(&self.options.url)
                .headers(headers)
                .timeout(std::time::Duration::from_secs(1))
                .send()
                .await;
            let _ = session_id;
        }
        let sink = self
            .sink
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        if let Some(sink) = sink {
            sink.closed();
        }
        Ok(())
    }
}

pub fn body_snippet(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.len() <= MAX_ERROR_BODY_BYTES {
        return trimmed.to_string();
    }
    trimmed[..MAX_ERROR_BODY_BYTES].to_string()
}

pub fn shared_client() -> Arc<reqwest::Client> {
    Arc::new(reqwest::Client::new())
}
