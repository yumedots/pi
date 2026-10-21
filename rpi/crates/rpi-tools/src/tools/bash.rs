//! Mirrors `packages/agent/src/harness/tools/bash.ts` — the built-in `bash`
//! `AgentTool`. Drives `execute_shell_with_capture` with a 2-second checkpoint
//! throttle. A non-zero exit code is a soft failure: the tool returns a result
//! flagged `is_error` that keeps its `details` and its `structured_content`
//! (mirrors TS `isError: true`). The hard failures (timeout, abort,
//! executionError, a command killed without an exit code) still throw
//! `Err(AgentError)` — the agent loop encodes those into an error
//! `ToolResultMessage`.
//!
//! Throttle mirrors the TS `BASH_CHECKPOINT_INTERVAL_MS`: at most one
//! checkpoint update per 2-second window; a final flush always follows capture
//! resolution.

use futures::future::BoxFuture;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use rpi_agent::agent_tool::AgentTool;
use rpi_agent::error::AgentError;
use rpi_agent::types::{AgentToolResult, TextContentOrImage, ToolResultPartial};
use rpi_ai::types::{ConstrainedSamplingConfig, ConstrainedStrictness, Schema, Tool};
use serde::Deserialize;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::env::ExecutionEnv;
use crate::error::{ExecutionError, ExecutionErrorCode};
use crate::shell_output::{
    execute_shell_with_capture, ShellCaptureOptions, ShellCaptureProgress, ShellCaptureResult,
};
use crate::tools::tool_context::ExecutionToolContext;
use crate::tools::PromptContribution;
use crate::truncate::{format_size, TruncationResult, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES};

/// Throttle window for bash `on_update` flushes. Mirrors `BASH_UPDATE_THROTTLE_MS`.
const BASH_UPDATE_THROTTLE_MS: u64 = 2_000;

/// Output limit of `structured_content.output`, which programmatic callers
/// receive. Mirrors TS `STRUCTURED_OUTPUT_MAX_BYTES`.
const STRUCTURED_OUTPUT_MAX_BYTES: usize = 1024 * 1024;

/// Input for the bash tool. Mirrors TS `BashToolInput`. `timeout` is in seconds.
#[derive(Debug, Clone, Deserialize)]
pub struct BashInput {
    /// Shell command to execute.
    pub command: String,
    /// Timeout in seconds (optional, no default timeout).
    #[serde(default)]
    pub timeout: Option<f64>,
}

/// Structured details for the bash tool. Mirrors TS `BashToolDetails`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BashToolDetails {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncation: Option<TruncationResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_output_path: Option<String>,
}

/// Mutable execution description passed to the optional prepare hook.
#[derive(Debug, Clone)]
pub struct BashExecution {
    pub command: String,
    pub cwd: PathBuf,
    pub env: HashMap<String, String>,
    pub inherit_env: bool,
}

/// Async hook called immediately before shell execution, matching native Pi's
/// `BashPrepare` extension point.
pub type BashPrepare =
    Arc<dyn Fn(&mut BashExecution) -> BoxFuture<'static, Result<(), String>> + Send + Sync>;

/// Options for `create_bash_tool`. Mirrors TS `BashToolOptions`.
#[derive(Clone, Default)]
pub struct BashToolOptions {
    /// Prepended to the command (separated by `\n`) before execution.
    pub command_prefix: Option<String>,
    /// Fallback timeout in seconds applied when the model doesn't pass one.
    /// pi has no default, but a model that forgets `timeout` can hang the run
    /// forever (reported as "卡住") — rpi injects this at the harness build
    /// site. A model-supplied timeout still wins.
    pub default_timeout: Option<f64>,
    /// Optional async hook that can adjust command, cwd, and environment.
    pub prepare: Option<BashPrepare>,
}

/// The built-in `bash` tool. Holds an `Arc<dyn ExecutionEnv>` (read-only view
/// suffices — bash does not touch the mutation queue).
pub struct BashTool {
    schema: Tool,
    output_schema: Schema,
    env: Arc<dyn ExecutionEnv>,
    options: BashToolOptions,
    prompt: PromptContribution,
}

impl BashTool {
    /// The JSON Schema of the tool's `structured_content`. Mirrors TS
    /// `bashOutputSchema`.
    fn output_schema() -> Schema {
        Schema::new(serde_json::json!({
            "type": "object",
            "properties": {
                "output": {
                    "type": "string",
                    "description": "Combined stdout and stderr, possibly truncated"
                },
                "truncated": { "type": "boolean" },
                "full_output_path": {
                    "type": "string",
                    "description": "Full output, when truncated"
                },
                "exit_code": { "type": "number" },
                "wall_time_seconds": { "type": "number" }
            },
            "required": ["output", "truncated", "exit_code", "wall_time_seconds"]
        }))
    }

    fn schema() -> Tool {
        Tool {
            name: "bash".to_string(),
            description: format!(
                "Execute a bash command in the current working directory. Returns stdout and \
                 stderr. Output is truncated to last {DEFAULT_MAX_LINES} lines or {kb}KB \
                 (whichever is hit first). If truncated, full output is saved to a temp file. \
                 Optionally provide a timeout in seconds.",
                kb = DEFAULT_MAX_BYTES / 1024
            ),
            parameters: Schema::new(serde_json::json!({
                "type": "object",
                "required": ["command"],
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Shell command to execute"
                    },
                    "timeout": {
                        "type": "number",
                        "description": "Timeout in seconds (optional, no default timeout)"
                    }
                }
            })),
            constrained_sampling: Some(ConstrainedSamplingConfig::JsonSchema {
                strict: ConstrainedStrictness::Prefer,
            }),
        }
    }
}

/// Build the `bash` tool from a context. Mirrors TS `createBashTool`.
pub fn create_bash_tool(
    context: &ExecutionToolContext,
    options: Option<BashToolOptions>,
) -> Arc<dyn AgentTool> {
    Arc::new(BashTool {
        schema: BashTool::schema(),
        output_schema: BashTool::output_schema(),
        env: context.env().clone(),
        options: options.unwrap_or_default(),
        prompt: PromptContribution::new(
            "Execute bash commands (ls, grep, find, etc.)",
            &["You can inspect PI_* environment variables for current model and session details."],
        ),
    })
}

#[async_trait]
impl AgentTool for BashTool {
    fn schema(&self) -> &Tool {
        &self.schema
    }
    fn label(&self) -> &str {
        "bash"
    }

    /// Mirrors TS `AgentTool.outputSchema` (`bashOutputSchema`).
    fn output_schema(&self) -> Option<&Schema> {
        Some(&self.output_schema)
    }

    /// Mirrors TS `AgentTool.promptSnippet`.
    fn prompt_snippet(&self) -> Option<&str> {
        Some(self.prompt.snippet)
    }

    /// Mirrors TS `AgentTool.promptGuidelines`.
    fn prompt_guidelines(&self) -> Option<&[String]> {
        Some(&self.prompt.guidelines)
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        params: serde_json::Value,
        signal: CancellationToken,
        on_update: Arc<dyn Fn(ToolResultPartial) + Send + Sync>,
    ) -> Result<AgentToolResult, AgentError> {
        let input: BashInput = serde_json::from_value(params)
            .map_err(|e| AgentError::Validation(format!("bash input invalid: {e}")))?;
        validate_timeout(input.timeout)?;
        let mut execution = BashExecution {
            command: match &self.options.command_prefix {
                Some(p) => format!("{p}\n{}", input.command),
                None => input.command,
            },
            cwd: self.env.cwd().to_path_buf(),
            env: HashMap::new(),
            inherit_env: true,
        };
        if let Some(prepare) = &self.options.prepare {
            prepare(&mut execution).await.map_err(AgentError::Tool)?;
        }
        let command = execution.command;
        let timeout = input.timeout.or(self.options.default_timeout);

        // Initial empty update (mirrors TS `onUpdate?.({ content: [], details: undefined })`).
        emit_update(&on_update, String::new(), None, None);

        // The throttle state. Shared between the on_chunk callback (which marks
        // dirty + schedules a flush) and the post-capture final flush.
        let throttle = Arc::new(Mutex::new(ThrottleState {
            dirty: false,
            last_flush: Instant::now(),
            latest_output: String::new(),
            latest_truncation: None,
            latest_full_path: None,
        }));

        let throttle_for_cb = throttle.clone();
        let on_update_for_cb = on_update.clone();
        let on_chunk: Box<dyn FnMut(&str, &dyn Fn() -> ShellCaptureProgress) + Send> = Box::new(
            move |_chunk, get_progress: &dyn Fn() -> ShellCaptureProgress| {
                let progress = get_progress();
                // Snapshot the fields we need from the progress before touching
                // the async mutex — the on_chunk callback runs on whatever thread
                // the env's stdout/stderr callback is invoked from, which may be
                // a runtime worker. Use try_lock so we never block (and never
                // panic on a held lock); a missed flush is fine — the final
                // post-capture flush always emits the terminal state.
                let new_output = progress.output.clone();
                let new_truncation = if progress.truncation.truncated {
                    Some(progress.truncation.clone())
                } else {
                    None
                };
                let new_full_path = progress
                    .full_output_path
                    .as_ref()
                    .map(|p| p.to_string_lossy().into_owned());
                let mut st = match throttle_for_cb.try_lock() {
                    Ok(g) => g,
                    Err(_) => return, // busy — skip this update; final flush covers it
                };
                st.latest_output = new_output;
                st.latest_truncation = new_truncation;
                st.latest_full_path = new_full_path;
                st.dirty = true;
                let elapsed = st.last_flush.elapsed();
                let throttle_duration = Duration::from_millis(BASH_UPDATE_THROTTLE_MS);
                if elapsed >= throttle_duration {
                    flush_now(&mut st, &on_update_for_cb);
                } else {
                    // Schedule a delayed flush (mirrors TS setTimeout)
                    let remaining = throttle_duration - elapsed;
                    let throttle_clone = throttle_for_cb.clone();
                    let on_update_clone = on_update_for_cb.clone();
                    tokio::spawn(async move {
                        tokio::time::sleep(remaining).await;
                        let mut st = throttle_clone.lock().await;
                        flush_now(&mut st, &on_update_clone);
                    });
                }
            },
        );

        let cwd = execution.cwd;
        let env = self.env.clone();
        let capture_opts = ShellCaptureOptions {
            shell: None,
            cwd: Some(cwd),
            env: Some(execution.env),
            inherit_env: execution.inherit_env,
            timeout,
            cancel: Some(&signal),
            on_chunk: Some(on_chunk),
            return_execution_errors: true,
        };

        // execute_shell_with_capture wants `&Arc<dyn ExecutionEnv>`.
        let started_at = Instant::now();
        let capture = execute_shell_with_capture(&env, &command, capture_opts)
            .await
            .map_err(exec_err_to_agent)?;
        let wall_time_seconds = (started_at.elapsed().as_secs_f64() * 10.0).round() / 10.0;

        // Final flush + emit the terminal output via on_update.
        {
            let mut st = throttle.lock().await;
            st.latest_output = capture.output.clone();
            st.latest_truncation = if capture.truncated {
                Some(capture.truncation.clone())
            } else {
                None
            };
            st.latest_full_path = capture
                .full_output_path
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned());
            st.dirty = true;
            flush_now(&mut st, &on_update);
        }

        // Build the terminal output text + details, applying truncation notices.
        let (output_text, details) = build_bash_output(&capture);
        let details_value = serde_json::to_value(details).unwrap_or(serde_json::Value::Null);

        // Resolution: cancelled → aborted; timeout → timeout; other exec error;
        // no exit code → terminated; a non-zero exit is a soft failure (the
        // result keeps its details and is flagged `is_error`).
        let append_status = |text: &str, status: &str| -> String {
            if text.is_empty() {
                status.to_string()
            } else {
                format!("{text}\n\n{status}")
            }
        };
        if capture.cancelled {
            return Err(AgentError::Tool(append_status(
                &output_text,
                "Command aborted",
            )));
        }
        if let Some(ee) = &capture.execution_error {
            if ee.code == ExecutionErrorCode::Timeout {
                let limit = match timeout {
                    Some(secs) => format!("after {secs} seconds"),
                    None => String::new(),
                };
                return Err(AgentError::Tool(append_status(
                    &output_text,
                    &format!("Command timed out {limit}"),
                )));
            }
            return Err(AgentError::Tool(ee.to_string()));
        }
        let Some(exit_code) = capture.exit_code else {
            return Err(AgentError::Tool(append_status(
                &output_text,
                "Command terminated without an exit code",
            )));
        };
        let structured_content = build_structured_content(
            &self.env,
            &capture,
            exit_code,
            wall_time_seconds,
        )
        .await;
        if exit_code != 0 {
            let model_text = if output_text.is_empty() {
                "(no output)".to_string()
            } else {
                output_text.clone()
            };
            let text = append_status(&model_text, &format!("Command exited with code {exit_code}"));
            return Ok(AgentToolResult {
                content: vec![TextContentOrImage::text(text)],
                details: details_value,
                structured_content: Some(structured_content),
                is_error: true,
                ..Default::default()
            });
        }
        let text = if output_text.is_empty() {
            "(no output)".to_string()
        } else {
            output_text
        };
        Ok(AgentToolResult {
            content: vec![TextContentOrImage::text(text)],
            details: details_value,
            structured_content: Some(structured_content),
            ..Default::default()
        })
    }
}

/// Throttle state, shared between the on_chunk callback and the final flush.
struct ThrottleState {
    dirty: bool,
    last_flush: Instant,
    latest_output: String,
    latest_truncation: Option<TruncationResult>,
    latest_full_path: Option<String>,
}

/// Flush a dirty throttle state by emitting an `on_update`. Mirrors
/// `emitOutputUpdate`.
fn flush_now(st: &mut ThrottleState, on_update: &Arc<dyn Fn(ToolResultPartial) + Send + Sync>) {
    if !st.dirty {
        return;
    }
    st.dirty = false;
    st.last_flush = Instant::now();
    emit_update(
        on_update,
        st.latest_output.clone(),
        st.latest_truncation.clone(),
        st.latest_full_path.clone(),
    );
}

/// Emit a single `on_update` payload built from the given capture snapshot.
/// Mirrors the TS `onUpdate({ content:[{text:progress.output}], details:{...} })`.
fn emit_update(
    on_update: &Arc<dyn Fn(ToolResultPartial) + Send + Sync>,
    output: String,
    truncation: Option<TruncationResult>,
    full_output_path: Option<String>,
) {
    let details = match (&truncation, &full_output_path) {
        (None, None) => serde_json::Value::Null,
        _ => {
            let details = BashToolDetails {
                truncation,
                full_output_path,
            };
            serde_json::to_value(details).unwrap_or(serde_json::Value::Null)
        }
    };
    on_update(AgentToolResult {
        content: vec![TextContentOrImage::text(output)],
        details,
        ..Default::default()
    });
}

/// Build the terminal `(output_text, details)` from a capture, appending the
/// truncation continuation notice (mirrors the TS block).
fn build_bash_output(capture: &ShellCaptureResult) -> (String, BashToolDetails) {
    let mut output_text = capture.output.clone();
    let details = if capture.truncated {
        let t = &capture.truncation;
        let start_line = t.total_lines.saturating_sub(t.output_lines) + 1;
        let end_line = t.total_lines;
        let path_str = capture
            .full_output_path
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned());
        if t.last_line_partial {
            let last_line_size = format_size(capture.last_line_bytes);
            output_text.push_str(&format!(
                "\n\n[Showing last {} of line {end_line} (line is {last_line_size}). Full output: {}]",
                format_size(t.output_bytes),
                path_str.as_deref().unwrap_or("?")
            ));
        } else if matches!(
            t.truncated_by,
            Some(crate::truncate::TruncationLimit::Lines)
        ) {
            output_text.push_str(&format!(
                "\n\n[Showing lines {start_line}-{end_line} of {}. Full output: {}]",
                t.total_lines,
                path_str.as_deref().unwrap_or("?")
            ));
        } else {
            output_text.push_str(&format!(
                "\n\n[Showing lines {start_line}-{end_line} of {} ({} limit). Full output: {}]",
                t.total_lines,
                format_size(DEFAULT_MAX_BYTES),
                path_str.as_deref().unwrap_or("?")
            ));
        }
        BashToolDetails {
            truncation: Some(capture.truncation.clone()),
            full_output_path: path_str,
        }
    } else {
        BashToolDetails {
            truncation: None,
            full_output_path: None,
        }
    };
    (output_text, details)
}

/// Build the machine-readable payload of a bash run. Mirrors TS
/// `structuredContent` (`bashOutputSchema`).
async fn build_structured_content(
    env: &Arc<dyn ExecutionEnv>,
    capture: &ShellCaptureResult,
    exit_code: i32,
    wall_time_seconds: f64,
) -> serde_json::Value {
    let (output, truncated) = full_output(env, capture).await;
    let mut map = serde_json::Map::new();
    map.insert("output".into(), serde_json::Value::String(output));
    map.insert("truncated".into(), serde_json::Value::Bool(truncated));
    if truncated {
        if let Some(path) = &capture.full_output_path {
            map.insert(
                "full_output_path".into(),
                serde_json::Value::String(path.to_string_lossy().into_owned()),
            );
        }
    }
    map.insert("exit_code".into(), serde_json::json!(exit_code));
    map.insert(
        "wall_time_seconds".into(),
        serde_json::json!(wall_time_seconds),
    );
    serde_json::Value::Object(map)
}

/// The complete output of a run, capped at `STRUCTURED_OUTPUT_MAX_BYTES`.
/// Mirrors TS `OutputAccumulator.readFullOutput`.
async fn full_output(env: &Arc<dyn ExecutionEnv>, capture: &ShellCaptureResult) -> (String, bool) {
    let content = match &capture.full_output_path {
        Some(path) => env
            .read_text_file(&path.to_string_lossy(), None)
            .await
            .unwrap_or_else(|_| capture.output.clone()),
        None => capture.output.clone(),
    };
    cap_output(&content)
}

/// Cap the structured output, keeping the head and the tail around an omission
/// marker. Mirrors TS `OutputAccumulator.readFullOutput`.
fn cap_output(content: &str) -> (String, bool) {
    if content.len() <= STRUCTURED_OUTPUT_MAX_BYTES {
        return (content.to_string(), false);
    }
    let head_bytes = STRUCTURED_OUTPUT_MAX_BYTES / 2;
    let tail_bytes = STRUCTURED_OUTPUT_MAX_BYTES - head_bytes;
    let head_end = floor_char_boundary(content, head_bytes);
    let tail_start = ceil_char_boundary(content, content.len() - tail_bytes);
    let omitted = tail_start.saturating_sub(head_end);
    let text = format!(
        "{}\n\n[... {omitted} bytes omitted ...]\n\n{}",
        &content[..head_end],
        &content[tail_start..]
    );
    (text, true)
}

/// The largest index `<= idx` that is a char boundary.
fn floor_char_boundary(text: &str, mut idx: usize) -> usize {
    if idx >= text.len() {
        return text.len();
    }
    while idx > 0 && !text.is_char_boundary(idx) {
        idx -= 1;
    }
    idx
}

/// The smallest index `>= idx` that is a char boundary.
fn ceil_char_boundary(text: &str, mut idx: usize) -> usize {
    if idx >= text.len() {
        return text.len();
    }
    while idx < text.len() && !text.is_char_boundary(idx) {
        idx += 1;
    }
    idx
}

/// Validate a timeout (seconds). Mirrors `validateTimeout`.
fn validate_timeout(timeout: Option<f64>) -> Result<(), AgentError> {
    let Some(secs) = timeout else {
        return Ok(());
    };
    if !secs.is_finite() || secs <= 0.0 {
        return Err(AgentError::Tool(
            "Invalid timeout: must be a finite number of seconds".into(),
        ));
    }
    let max = 2_147_483_647.0 / 1000.0;
    if secs > max {
        return Err(AgentError::Tool(format!(
            "Invalid timeout: maximum is {max} seconds"
        )));
    }
    Ok(())
}

fn exec_err_to_agent(e: ExecutionError) -> AgentError {
    AgentError::Tool(e.to_string())
}
