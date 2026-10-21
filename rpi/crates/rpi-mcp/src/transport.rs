use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::mpsc;

use crate::protocol::McpError;

#[derive(Debug, Clone)]
pub enum TransportEvent {
    Message(Value),
    Error(String),
    Closed,
}

#[derive(Clone)]
pub struct TransportSink {
    sender: mpsc::UnboundedSender<TransportEvent>,
}

impl TransportSink {
    pub fn new(sender: mpsc::UnboundedSender<TransportEvent>) -> Self {
        Self { sender }
    }

    pub fn message(&self, value: Value) {
        let _ = self.sender.send(TransportEvent::Message(value));
    }

    pub fn error(&self, message: impl Into<String>) {
        let _ = self.sender.send(TransportEvent::Error(message.into()));
    }

    pub fn closed(&self) {
        let _ = self.sender.send(TransportEvent::Closed);
    }

    pub fn is_closed(&self) -> bool {
        self.sender.is_closed()
    }
}

#[async_trait]
pub trait McpTransport: Send + Sync {
    async fn start(&self, sink: TransportSink) -> Result<(), McpError>;
    async fn send(&self, message: &Value) -> Result<(), McpError>;
    async fn close(&self) -> Result<(), McpError>;
}

pub fn parse_json_line(line: &str) -> Result<Value, McpError> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Err(McpError::protocol("empty MCP message"));
    }
    serde_json::from_str(trimmed).map_err(|error| McpError::protocol(error.to_string()))
}
