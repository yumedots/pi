//! The host side of the JavaScript boundary.
//!
//! Everything that crosses the boundary is JSON: the host answers a named
//! operation with a JSON value, and the extension host answers with a JSON
//! value as well.

use std::path::{Path, PathBuf};
use std::time::Instant;

use serde_json::{json, Map, Value};

/// The operations the embedded JavaScript may ask the host for.
///
/// The operation names are the contract between the Rust host and the
/// bundled extension host. Every argument and every result is JSON.
pub trait Host: Send + Sync {
	/// Runs one host operation.
	fn call(&self, op: &str, args: Value) -> Result<Value, String>;
}

/// A host that runs the operations the embedded JavaScript needs out of the
/// current process.
///
/// The file system operations are scoped to `root`: a path that resolves
/// outside the root is refused.
pub struct ProcessHost {
	root: Option<PathBuf>,
	argv: Vec<String>,
	started: Instant,
}

impl Default for ProcessHost {
	fn default() -> Self {
		Self::new()
	}
}

impl ProcessHost {
	/// A host with the current process environment and no file system scope.
	pub fn new() -> Self {
		Self {
			root: None,
			argv: std::env::args().collect(),
			started: Instant::now(),
		}
	}

	/// A host whose file system operations stay inside `root`.
	pub fn with_root(root: impl Into<PathBuf>) -> Self {
		Self {
			root: Some(root.into()),
			argv: std::env::args().collect(),
			started: Instant::now(),
		}
	}

	fn resolve(&self, path: &str) -> Result<PathBuf, String> {
		let candidate = Path::new(path);
		let joined = match &self.root {
			Some(root) if candidate.is_relative() => root.join(candidate),
			_ => candidate.to_path_buf(),
		};
		let normalized = normalize(&joined);
		if let Some(root) = &self.root {
			let root = normalize(root);
			if !normalized.starts_with(&root) {
				return Err(format!("path {path} is outside the allowed root"));
			}
		}
		Ok(normalized)
	}
}

fn normalize(path: &Path) -> PathBuf {
	let mut out = PathBuf::new();
	for part in path.components() {
		match part {
			std::path::Component::ParentDir => {
				out.pop();
			}
			std::path::Component::CurDir => {}
			other => out.push(other.as_os_str()),
		}
	}
	out
}

impl Host for ProcessHost {
	fn call(&self, op: &str, args: Value) -> Result<Value, String> {
		match op {
			"process.env" => {
				let mut env = Map::new();
				for (key, value) in std::env::vars() {
					env.insert(key, Value::String(value));
				}
				Ok(Value::Object(env))
			}
			"process.cwd" => Ok(json!(std::env::current_dir().map_err(|e| e.to_string())?)),
			"process.argv" => Ok(json!(self.argv)),
			"process.platform" => Ok(json!(std::env::consts::OS)),
			"process.pid" => Ok(json!(std::process::id())),
			"performance.now" => Ok(json!(self.started.elapsed().as_secs_f64() * 1000.0)),
			"console.log" | "console.info" | "console.warn" | "console.error" | "console.debug" => {
				let level = op.trim_start_matches("console.").to_string();
				let message = args.get("message").and_then(Value::as_str).unwrap_or_default().to_string();
				match level.as_str() {
					"error" => eprintln!("{message}"),
					"warn" => eprintln!("{message}"),
					_ => println!("{message}"),
				}
				Ok(Value::Null)
			}
			"fs.readFile" => {
				let path = string_arg(&args, "path")?;
				let path = self.resolve(&path)?;
				let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
				Ok(json!(content))
			}
			"fs.writeFile" => {
				let path = string_arg(&args, "path")?;
				let content = args.get("content").and_then(Value::as_str).unwrap_or_default().to_string();
				let path = self.resolve(&path)?;
				if let Some(parent) = path.parent() {
					std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
				}
				std::fs::write(&path, content).map_err(|e| e.to_string())?;
				Ok(Value::Null)
			}
			"fs.exists" => {
				let path = string_arg(&args, "path")?;
				let path = self.resolve(&path)?;
				Ok(json!(path.exists()))
			}
			"fs.readdir" => {
				let path = string_arg(&args, "path")?;
				let path = self.resolve(&path)?;
				let mut entries = Vec::new();
				for entry in std::fs::read_dir(&path).map_err(|e| e.to_string())? {
					let entry = entry.map_err(|e| e.to_string())?;
					entries.push(entry.file_name().to_string_lossy().to_string());
				}
				entries.sort();
				Ok(json!(entries))
			}
			"fs.stat" => {
				let path = string_arg(&args, "path")?;
				let path = self.resolve(&path)?;
				let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
				Ok(json!({
					"isDirectory": meta.is_dir(),
					"isFile": meta.is_file(),
					"size": meta.len(),
				}))
			}
			"text.encode" => {
				let text = args.get("text").and_then(Value::as_str).unwrap_or_default();
				Ok(json!(text.as_bytes().to_vec()))
			}
			"text.decode" => {
				let bytes = args
					.get("bytes")
					.and_then(Value::as_array)
					.map(|items| {
						items
							.iter()
							.filter_map(Value::as_u64)
							.map(|byte| byte as u8)
							.collect::<Vec<u8>>()
					})
					.unwrap_or_default();
				Ok(json!(String::from_utf8_lossy(&bytes).to_string()))
			}
			"model.get" => Ok(Value::Null),
			"model.getThinkingLevel" => Ok(Value::Null),
			"agent.isIdle" => Ok(json!(true)),
			"agent.isProjectTrusted" => Ok(json!(true)),
			"agent.hasPendingMessages" => Ok(json!(false)),
			"agent.getContextUsage" => Ok(Value::Null),
			"agent.getSystemPrompt" => Ok(json!("")),
			"tools.getActive" => Ok(json!([])),
			"tools.getAll" => Ok(json!([])),
			"settings.get" => Ok(json!({})),
			"commands.get" => Ok(json!([])),
			"mcp.list" => Ok(json!([])),
			"session.getSessionName" => Ok(Value::Null),
			other => Err(format!("unknown host operation: {other}")),
		}
	}
}

fn string_arg(args: &Value, key: &str) -> Result<String, String> {
	args.get(key)
		.and_then(Value::as_str)
		.map(str::to_string)
		.ok_or_else(|| format!("missing argument: {key}"))
}
