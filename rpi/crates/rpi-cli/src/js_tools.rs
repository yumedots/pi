//! The JavaScript extension's tools, declared to the model.
//!
//! A tool an extension registers lives in the extension's registry; the model
//! only knows about the session's tool set. This module is the bridge: the
//! extension's tool is declared to the model with the schema the extension
//! gave it, and calling it runs the extension's own `execute`.

use std::sync::Arc;

use rpi_agent::agent_tool::AgentTool;
use rpi_agent::error::AgentError;
use rpi_agent::types::{AgentToolResult, TextContentOrImage, ToolResultPartial};
use rpi_ai::types::{Schema, Tool};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::js_extensions::JsExtensions;

/// A tool an extension registered in JavaScript.
pub struct JsTool {
    extensions: JsExtensions,
    schema: Tool,
    label: String,
}

impl JsTool {
    /// Build the tool from the schema the extension registered it with.
    pub fn new(extensions: JsExtensions, name: &str, label: &str, description: &str, parameters: Value) -> Self {
        Self {
            extensions,
            schema: Tool {
                name: name.to_string(),
                description: description.to_string(),
                parameters: Schema::new(parameters),
                constrained_sampling: None,
            },
            label: label.to_string(),
        }
    }
}

#[async_trait::async_trait]
impl AgentTool for JsTool {
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
        _on_update: Arc<dyn Fn(ToolResultPartial) + Send + Sync>,
    ) -> Result<AgentToolResult, AgentError> {
        let name = self.schema.name.clone();
        let answer = self
            .extensions
            .call_tool(&name, params)
            .map_err(AgentError::Tool)?;
        Ok(tool_result(&answer))
    }
}

/// The result an extension's tool returned, in the agent's shape.
///
/// The extension returns the original's `AgentToolResult`: `content` is a list
/// of content blocks, and `output` is the shorthand for a single text block.
pub fn tool_result(answer: &Value) -> AgentToolResult {
    let content = answer
        .get("content")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|block| {
                    let text = block.get("text").and_then(Value::as_str)?;
                    Some(TextContentOrImage::text(text))
                })
                .collect::<Vec<TextContentOrImage>>()
        })
        .unwrap_or_default();
    let content = if content.is_empty() {
        vec![TextContentOrImage::text(
            answer
                .get("output")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        )]
    } else {
        content
    };
    AgentToolResult {
        content,
        details: answer.get("details").cloned().unwrap_or(Value::Null),
        structured_content: answer.get("structuredContent").cloned(),
        usage: None,
        added_tool_names: Vec::new(),
        is_error: answer
            .get("isError")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        terminate: answer
            .get("terminate")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    }
}
