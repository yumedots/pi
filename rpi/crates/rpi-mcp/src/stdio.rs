use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};

use crate::protocol::McpError;
use crate::transport::{parse_json_line, McpTransport, TransportSink};

const DEFAULT_MAX_MESSAGE_BYTES: usize = 16 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES: usize = 64 * 1024;
const DEFAULT_CLOSE_TIMEOUT_MS: u64 = 2_000;

#[derive(Debug, Clone, Default)]
pub struct StdioOptions {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub env: Vec<(String, String)>,
    pub inherit_env: bool,
    pub max_message_bytes: usize,
    pub close_timeout_ms: u64,
}

pub struct StdioTransport {
    options: StdioOptions,
    child: Mutex<Option<Child>>,
    stdin: tokio::sync::Mutex<Option<ChildStdin>>,
    stderr_tail: Arc<Mutex<String>>,
    sink: Mutex<Option<TransportSink>>,
}

impl StdioTransport {
    pub fn new(options: StdioOptions) -> Self {
        let max_stderr_bytes = if options.max_message_bytes == 0 {
            DEFAULT_MAX_STDERR_BYTES
        } else {
            options.max_message_bytes
        };
        let _ = max_stderr_bytes;
        StdioTransport {
            options,
            child: Mutex::new(None),
            stdin: tokio::sync::Mutex::new(None),
            stderr_tail: Arc::new(Mutex::new(String::new())),
            sink: Mutex::new(None),
        }
    }

    pub fn stderr_tail(&self) -> String {
        self.stderr_tail
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    fn max_message_bytes(&self) -> usize {
        if self.options.max_message_bytes == 0 {
            DEFAULT_MAX_MESSAGE_BYTES
        } else {
            self.options.max_message_bytes
        }
    }
}

#[async_trait]
impl McpTransport for StdioTransport {
    async fn start(&self, sink: TransportSink) -> Result<(), McpError> {
        if self.options.command.is_empty() {
            return Err(McpError::transport("the MCP server has no command"));
        }
        let mut command = Command::new(&self.options.command);
        command
            .args(&self.options.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(cwd) = &self.options.cwd {
            command.current_dir(cwd);
        }
        if !self.options.inherit_env {
            command.env_clear();
        }
        for (key, value) in &self.options.env {
            command.env(key, value);
        }
        let mut child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                McpError::transport(format!("spawn {} ENOENT", self.options.command))
            } else {
                McpError::transport(error.to_string())
            }
        })?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let stdin = child.stdin.take();
        *self.child.lock().unwrap_or_else(|error| error.into_inner()) = Some(child);
        *self.stdin.lock().await = stdin;
        *self.sink.lock().unwrap_or_else(|error| error.into_inner()) = Some(sink.clone());

        if let Some(stdout) = stdout {
            let sink = sink.clone();
            let max_message_bytes = self.max_message_bytes();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.trim().is_empty() {
                        continue;
                    }
                    if line.len() > max_message_bytes {
                        sink.error(format!(
                            "MCP stdio message exceeds {max_message_bytes} bytes"
                        ));
                        continue;
                    }
                    match parse_json_line(&line) {
                        Ok(message) => sink.message(message),
                        Err(error) => sink.error(error.to_string()),
                    }
                }
                sink.closed();
            });
        }

        if let Some(stderr) = stderr {
            let tail = Arc::clone(&self.stderr_tail);
            let sink = sink.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let mut buffer = tail.lock().unwrap_or_else(|error| error.into_inner());
                    buffer.push_str(&line);
                    buffer.push('\n');
                    if buffer.len() > DEFAULT_MAX_STDERR_BYTES {
                        let start = buffer.len() - DEFAULT_MAX_STDERR_BYTES;
                        *buffer = buffer[start..].to_string();
                    }
                }
                let _ = sink;
            });
        }
        Ok(())
    }

    async fn send(&self, message: &Value) -> Result<(), McpError> {
        let mut guard = self.stdin.lock().await;
        let Some(stdin) = guard.as_mut() else {
            return Err(McpError::ConnectionClosed);
        };
        let mut payload = serde_json::to_string(message)
            .map_err(|error| McpError::protocol(error.to_string()))?;
        payload.push('\n');
        stdin
            .write_all(payload.as_bytes())
            .await
            .map_err(|error| McpError::transport(error.to_string()))?;
        stdin
            .flush()
            .await
            .map_err(|error| McpError::transport(error.to_string()))
    }

    async fn close(&self) -> Result<(), McpError> {
        {
            let mut guard = self.stdin.lock().await;
            guard.take();
        }
        let child = {
            let mut guard = self.child.lock().unwrap_or_else(|error| error.into_inner());
            guard.take()
        };
        if let Some(mut child) = child {
            let timeout = std::time::Duration::from_millis(if self.options.close_timeout_ms == 0 {
                DEFAULT_CLOSE_TIMEOUT_MS
            } else {
                self.options.close_timeout_ms
            });
            match tokio::time::timeout(timeout, child.wait()).await {
                Ok(Ok(_)) => {}
                Ok(Err(error)) => {
                    let _ = child.start_kill();
                    return Err(McpError::transport(error.to_string()));
                }
                Err(_) => {
                    let _ = child.start_kill();
                    let _ = child.wait().await;
                }
            }
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
