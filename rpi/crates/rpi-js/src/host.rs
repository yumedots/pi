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
				let modified = meta
					.modified()
					.ok()
					.and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
					.map(|elapsed| elapsed.as_millis() as u64)
					.unwrap_or(0);
				Ok(json!({
					"isDirectory": meta.is_dir(),
					"isFile": meta.is_file(),
					"size": meta.len(),
					"modified": modified,
					"mode": if meta.is_dir() { 0o040755 } else { 0o100644 },
				}))
			}
			"fs.access" => {
				let path = string_arg(&args, "path")?;
				let path = self.resolve(&path)?;
				Ok(json!(path.exists()))
			}
			"fs.realpath" => {
				let path = string_arg(&args, "path")?;
				let path = self.resolve(&path)?;
				let real = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
				Ok(json!(real.to_string_lossy()))
			}
			"fs.mkdir" => {
				let path = string_arg(&args, "path")?;
				let path = self.resolve(&path)?;
				std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
				Ok(Value::Null)
			}
			"fs.unlink" => {
				let path = string_arg(&args, "path")?;
				let path = self.resolve(&path)?;
				std::fs::remove_file(&path).map_err(|e| e.to_string())?;
				Ok(Value::Null)
			}
			"fs.rename" => {
				let from = string_arg(&args, "from")?;
				let to = string_arg(&args, "to")?;
				let from = self.resolve(&from)?;
				let to = self.resolve(&to)?;
				std::fs::rename(&from, &to).map_err(|e| e.to_string())?;
				Ok(Value::Null)
			}
			"fs.copyFile" => {
				let from = string_arg(&args, "from")?;
				let to = string_arg(&args, "to")?;
				let from = self.resolve(&from)?;
				let to = self.resolve(&to)?;
				std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
				Ok(Value::Null)
			}
			"fs.appendFile" => {
				let path = string_arg(&args, "path")?;
				let content = args
					.get("content")
					.and_then(Value::as_str)
					.unwrap_or_default()
					.to_string();
				let path = self.resolve(&path)?;
				let mut existing = std::fs::read_to_string(&path).unwrap_or_default();
				existing.push_str(&content);
				std::fs::write(&path, existing).map_err(|e| e.to_string())?;
				Ok(Value::Null)
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
			"model.getThinkingLevel" => Ok(json!("off")),
			"model.set" => Ok(json!(false)),
			"model.setThinkingLevel" => Ok(Value::Null),
			"model.registerVirtual" | "model.unregisterVirtual" => Ok(Value::Null),
			"agent.isIdle" => Ok(json!(true)),
			"agent.isProjectTrusted" => Ok(json!(false)),
			"agent.hasPendingMessages" => Ok(json!(false)),
			"agent.getContextUsage" => Ok(Value::Null),
			"agent.getSystemPrompt" => Ok(json!("")),
			"agent.abort" => Ok(Value::Null),
			"agent.compact" => Ok(Value::Null),
			"tools.getActive" => Ok(json!([])),
			"tools.getAll" => Ok(json!([])),
			"tools.setActive" => Ok(Value::Null),
			"tools.getExposure" => Ok(json!("direct")),
			"tools.getNamespace" => Ok(Value::Null),
			"tools.getPromptGuidelines" => Ok(json!([])),
			"tools.execute" => Ok(Value::Null),
			"settings.get" => Ok(json!({})),
			"commands.get" => Ok(json!([])),
			"mcp.list" => Ok(json!([])),
			"mcp.register" | "mcp.unregister" => Ok(Value::Null),
			"provider.register" | "provider.unregister" => Ok(Value::Null),
			"session.getSessionName" => Ok(Value::Null),
			"session.getBranch" => Ok(json!({ "entries": [] })),
			"session.getEntries" => Ok(json!([])),
			"session.getDir" => Ok(Value::Null),
			"session.getId" => Ok(Value::Null),
			"session.getFile" => Ok(Value::Null),
			"session.getLeafId" => Ok(Value::Null),
			"session.getLeafEntry" => Ok(Value::Null),
			"session.getEntry" => Ok(Value::Null),
			"session.getLabel" => Ok(Value::Null),
			"session.getLabelValue" => Ok(Value::Null),
			"session.buildContextEntries" => Ok(json!([])),
			"session.buildSessionProjection" => Ok(json!({})),
			"session.getHeader" => Ok(Value::Null),
			"session.getTree" => Ok(Value::Null),
			"session.setSessionName" | "session.setLabel" => Ok(Value::Null),
			"session.sendMessage" | "session.sendUserMessage" => Ok(Value::Null),
			"session.appendEntry" => Ok(Value::Null),
			"session.exec" => Ok(json!({ "stdout": "", "stderr": "", "code": 0, "killed": false })),
			"session.shutdown" => Ok(Value::Null),
			"session.getSystemPromptOptions" => Ok(json!({})),
			"session.waitForIdle" => Ok(Value::Null),
			"session.newSession" => Ok(json!({ "cancelled": false })),
			"session.fork" => Ok(json!({ "cancelled": false })),
			"session.navigateTree" => Ok(json!({ "cancelled": false })),
			"session.switchSession" => Ok(json!({ "cancelled": false })),
			"session.reload" => Ok(Value::Null),
			"context.mode" => Ok(json!("print")),
			"theme.get" => Ok(crate::theme::tokens()),
			"footer.getGitBranch" => Ok(Value::Null),
			"footer.getExtensionStatuses" => Ok(json!({})),
			"ui.notify"
			| "ui.setStatus"
			| "ui.setWidget"
			| "ui.setHeader"
			| "ui.setFooter"
			| "ui.setTitle"
			| "ui.setWorkingMessage"
			| "ui.setWorkingVisible"
			| "ui.setWorkingIndicator"
			| "ui.setHiddenThinkingLabel"
			| "ui.setEditorText"
			| "ui.pasteToEditor"
			| "ui.setEditorComponent"
			| "ui.setToolsExpanded"
			| "ui.custom" => Ok(Value::Null),
			"ui.getEditorText" => Ok(json!("")),
			"ui.select" => Ok(Value::Null),
			"ui.confirm" => Ok(json!(false)),
			"ui.input" | "ui.editor" => Ok(Value::Null),
			"ui.getEditorComponent" => Ok(Value::Null),
			"ui.getAllThemes" => Ok(json!([])),
			"ui.getTheme" => Ok(Value::Null),
			"ui.setTheme" => Ok(json!({ "success": false, "error": "no theme registry" })),
			"ui.getToolsExpanded" => Ok(json!(true)),
			"models.refresh" => Ok(json!({})),
			"models.getError" => Ok(Value::Null),
			"models.list" | "models.listAvailable" => Ok(json!([])),
			"models.find" => Ok(Value::Null),
			"models.hasConfiguredAuth" => Ok(json!(false)),
			"models.getProviderAuthStatus" => Ok(json!("unknown")),
			"models.getProvider" => Ok(Value::Null),
			"models.getProviderDisplayName" => Ok(Value::Null),
			"models.isUsingOAuth" => Ok(json!(false)),
			"models.getRegisteredProviderIds" => Ok(json!([])),
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

#[cfg(test)]
mod tests {
	use super::*;

	/// Every operation the bundled host asks the host for.
	///
	/// The bundle is the source of truth: a new `hostCall("…")` in the
	/// extension host shows up here, so the test below cannot drift from it.
	fn requested_operations() -> Vec<String> {
		let bundle = include_str!("../js/extension-host.bundle.js");
		let mut operations: Vec<String> = Vec::new();
		let mut rest = bundle;
		while let Some(index) = rest.find("hostCall(\"") {
			rest = &rest[index + "hostCall(\"".len()..];
			let end = rest.find('"').unwrap_or(rest.len());
			let operation = rest[..end].to_string();
			if !operations.contains(&operation) {
				operations.push(operation);
			}
		}
		operations
	}

	/// The fallback host answers every operation the bundle asks for.
	///
	/// A missing answer would reach the extension as
	/// `Error: unknown host operation: <op>`, which aborts whatever the
	/// extension was doing.
	#[test]
	fn the_fallback_host_answers_every_requested_operation() {
		let host = ProcessHost::new();
		let operations = requested_operations();
		assert!(
			operations.len() > 50,
			"the bundle should ask for many operations, found {}",
			operations.len()
		);
		for operation in operations {
			// `module.load` is answered by the runtime, which reads the file
			// and transpiles it before the host ever sees it.
			if operation == "module.load" {
				continue;
			}
			if let Err(error) = host.call(&operation, json!({})) {
				assert!(
					!error.starts_with("unknown host operation"),
					"the fallback host does not answer `{operation}`: {error}"
				);
			}
		}
	}

	/// The theme carries the original's 58 tokens: 49 foreground, 9 background.
	#[test]
	fn the_theme_carries_every_token() {
		let tokens = crate::theme::tokens();
		let foreground = tokens.get("fg").and_then(Value::as_object).unwrap();
		let background = tokens.get("bg").and_then(Value::as_object).unwrap();
		let colors = tokens.get("colors").and_then(Value::as_object).unwrap();
		assert_eq!(foreground.len(), 49, "the foreground tokens");
		assert_eq!(background.len(), 9, "the background tokens");
		assert_eq!(colors.len(), 58, "the color values");
		assert_eq!(
			foreground.get("accent").and_then(Value::as_str),
			Some("\x1b[38;2;167;152;215m"),
			"the accent escape"
		);
		assert_eq!(
			background.get("selectedBg").and_then(Value::as_str),
			Some("\x1b[48;2;33;59;73m"),
			"the selected background escape"
		);
	}
}
