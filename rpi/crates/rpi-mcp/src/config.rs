use std::path::{Path, PathBuf};

use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpExposure {
    Codemode,
    Deferred,
    Direct,
    Hidden,
}

impl McpExposure {
    pub fn as_str(&self) -> &'static str {
        match self {
            McpExposure::Codemode => "codemode",
            McpExposure::Deferred => "deferred",
            McpExposure::Direct => "direct",
            McpExposure::Hidden => "hidden",
        }
    }

    pub fn parse(value: &str) -> Option<McpExposure> {
        match value {
            "codemode" | "codemode-deferred" => Some(McpExposure::Codemode),
            "deferred" => Some(McpExposure::Deferred),
            "direct" => Some(McpExposure::Direct),
            "hidden" => Some(McpExposure::Hidden),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpTransportKind {
    Stdio,
    Http,
}

#[derive(Debug, Clone)]
pub struct McpServerConfig {
    pub transport: McpTransportKind,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cwd: Option<String>,
    pub url: Option<String>,
    pub headers: Vec<(String, String)>,
    pub exposure: McpExposure,
    pub description: Option<String>,
    pub tool_exposure: Vec<(String, McpExposure)>,
    pub enabled: bool,
    pub timeout_seconds: Option<u64>,
}

impl Default for McpServerConfig {
    fn default() -> Self {
        McpServerConfig {
            transport: McpTransportKind::Stdio,
            command: None,
            args: Vec::new(),
            env: Vec::new(),
            cwd: None,
            url: None,
            headers: Vec::new(),
            exposure: McpExposure::Codemode,
            description: None,
            tool_exposure: Vec::new(),
            enabled: true,
            timeout_seconds: None,
        }
    }
}

impl McpServerConfig {
    pub fn describe_transport(&self) -> String {
        match self.transport {
            McpTransportKind::Http => self.url.clone().unwrap_or_default(),
            McpTransportKind::Stdio => {
                let mut parts = Vec::new();
                if let Some(command) = &self.command {
                    parts.push(command.clone());
                }
                parts.extend(self.args.iter().cloned());
                parts.join(" ")
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpScope {
    Global,
    Project,
    Extension,
}

impl McpScope {
    pub fn as_str(&self) -> &'static str {
        match self {
            McpScope::Global => "global",
            McpScope::Project => "project",
            McpScope::Extension => "extension",
        }
    }
}

#[derive(Debug, Clone)]
pub struct McpServerEntry {
    pub name: String,
    pub config: McpServerConfig,
    pub source: String,
    pub scope: McpScope,
    pub override_path: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct LoadedMcpConfig {
    pub servers: Vec<McpServerEntry>,
    pub errors: Vec<String>,
    pub project_config: Option<PathBuf>,
}

pub fn mcp_namespace(server: &str) -> String {
    format!("mcp__{}", server.replace('-', "_"))
}

pub fn tool_pattern_matches(pattern: &str, name: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let name: Vec<char> = name.chars().collect();
    matches_from(&pattern, 0, &name, 0)
}

fn matches_from(pattern: &[char], pattern_index: usize, name: &[char], name_index: usize) -> bool {
    if pattern_index == pattern.len() {
        return name_index == name.len();
    }
    if pattern[pattern_index] == '*' {
        for skip in name_index..=name.len() {
            if matches_from(pattern, pattern_index + 1, name, skip) {
                return true;
            }
        }
        return false;
    }
    if name_index < name.len() && pattern[pattern_index] == name[name_index] {
        return matches_from(pattern, pattern_index + 1, name, name_index + 1);
    }
    false
}

pub fn create_tool_name_matcher(entries: &[String]) -> impl Fn(&str) -> bool + '_ {
    let names: Vec<String> = entries
        .iter()
        .filter(|entry| !entry.contains('*'))
        .cloned()
        .collect();
    let patterns: Vec<String> = entries
        .iter()
        .filter(|entry| entry.contains('*'))
        .cloned()
        .collect();
    move |name: &str| {
        names.iter().any(|entry| entry == name)
            || patterns
                .iter()
                .any(|pattern| tool_pattern_matches(pattern, name))
    }
}

pub fn get_mcp_tool_exposure(config: &McpServerConfig, tool_name: &str) -> McpExposure {
    if let Some((_, exposure)) = config
        .tool_exposure
        .iter()
        .find(|(name, _)| name == tool_name)
    {
        return *exposure;
    }
    for (pattern, exposure) in &config.tool_exposure {
        if pattern.contains('*') && tool_pattern_matches(pattern, tool_name) {
            return *exposure;
        }
    }
    config.exposure
}

fn is_record(value: &Value) -> bool {
    value.is_object()
}

fn string_record(value: &Value) -> Option<Vec<(String, String)>> {
    let object = value.as_object()?;
    let mut entries = Vec::new();
    for (key, entry) in object {
        let text = entry.as_str()?;
        entries.push((key.clone(), text.to_string()));
    }
    Some(entries)
}

pub fn validate_mcp_server_config(name: &str, raw: &Value) -> Result<McpServerConfig, String> {
    if !is_valid_server_name(name) {
        return Err(format!(
            "invalid server name \"{name}\" (use letters, digits, \"_\" and \"-\")"
        ));
    }
    if !is_record(raw) {
        return Err(format!("server \"{name}\" must be an object"));
    }
    let object = raw.as_object().expect("checked above");
    let kind = object.get("type").and_then(Value::as_str);
    if kind == Some("sse") {
        return Err(format!(
            "server \"{name}\": legacy SSE transport is not supported; use the streamable HTTP URL"
        ));
    }
    let exposure = match object.get("exposure") {
        None | Some(Value::Null) => McpExposure::Codemode,
        Some(Value::String(value)) => match McpExposure::parse(value) {
            Some(exposure) => exposure,
            None => {
                return Err(format!(
                    "server \"{name}\": exposure must be one of \"codemode\", \"deferred\", \"direct\", \"hidden\""
                ))
            }
        },
        Some(_) => {
            return Err(format!(
                "server \"{name}\": exposure must be one of \"codemode\", \"deferred\", \"direct\", \"hidden\""
            ))
        }
    };
    let mut tool_exposure = Vec::new();
    match object.get("toolExposure") {
        None | Some(Value::Null) => {}
        Some(Value::Object(entries)) => {
            for (tool, value) in entries {
                let Some(text) = value.as_str() else {
                    return Err(format!(
                        "server \"{name}\": toolExposure \"{tool}\" must be one of \"codemode\", \"deferred\", \"direct\", \"hidden\""
                    ));
                };
                let Some(parsed) = McpExposure::parse(text) else {
                    return Err(format!(
                        "server \"{name}\": toolExposure \"{tool}\" must be one of \"codemode\", \"deferred\", \"direct\", \"hidden\""
                    ));
                };
                tool_exposure.push((tool.clone(), parsed));
            }
        }
        Some(_) => {
            return Err(format!(
                "server \"{name}\": toolExposure must map tool names to exposures"
            ))
        }
    }
    let enabled = match object.get("enabled") {
        None | Some(Value::Null) => true,
        Some(Value::Bool(enabled)) => *enabled,
        Some(_) => return Err(format!("server \"{name}\": enabled must be a boolean")),
    };
    let description = match object.get("description") {
        None | Some(Value::Null) => None,
        Some(Value::String(description)) => Some(description.clone()),
        Some(_) => return Err(format!("server \"{name}\": description must be a string")),
    };
    let timeout_seconds = match object.get("timeout") {
        None | Some(Value::Null) => None,
        Some(Value::Number(number)) => match number.as_u64() {
            Some(seconds) if seconds > 0 => Some(seconds),
            _ => {
                return Err(format!(
                    "server \"{name}\": timeout must be a positive number of seconds"
                ))
            }
        },
        Some(_) => {
            return Err(format!(
                "server \"{name}\": timeout must be a positive number of seconds"
            ))
        }
    };

    let url = object.get("url").and_then(Value::as_str);
    let command = object.get("command").and_then(Value::as_str);
    if let Some(url) = url {
        if !matches!(kind, None | Some("http") | Some("streamable-http")) {
            return Err(format!(
                "server \"{name}\" needs either \"command\" (stdio) or \"url\" (streamable HTTP)"
            ));
        }
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err(format!("server \"{name}\": url must be an http or https URL"));
        }
        let headers = match object.get("headers") {
            None | Some(Value::Null) => Vec::new(),
            Some(value) => string_record(value).ok_or_else(|| {
                format!("server \"{name}\": headers must map names to strings")
            })?,
        };
        return Ok(McpServerConfig {
            transport: McpTransportKind::Http,
            command: None,
            args: Vec::new(),
            env: Vec::new(),
            cwd: None,
            url: Some(url.to_string()),
            headers,
            exposure,
            description,
            tool_exposure,
            enabled,
            timeout_seconds,
        });
    }
    if let Some(command) = command {
        if !matches!(kind, None | Some("stdio")) {
            return Err(format!(
                "server \"{name}\" needs either \"command\" (stdio) or \"url\" (streamable HTTP)"
            ));
        }
        let args = match object.get("args") {
            None | Some(Value::Null) => Vec::new(),
            Some(Value::Array(items)) => {
                let mut args = Vec::new();
                for item in items {
                    let Some(text) = item.as_str() else {
                        return Err(format!(
                            "server \"{name}\": args must be an array of strings"
                        ));
                    };
                    args.push(text.to_string());
                }
                args
            }
            Some(_) => return Err(format!("server \"{name}\": args must be an array of strings")),
        };
        let env = match object.get("env") {
            None | Some(Value::Null) => Vec::new(),
            Some(value) => {
                string_record(value).ok_or_else(|| format!("server \"{name}\": env must map names to strings"))?
            }
        };
        let cwd = match object.get("cwd") {
            None | Some(Value::Null) => None,
            Some(Value::String(cwd)) => Some(cwd.clone()),
            Some(_) => return Err(format!("server \"{name}\": cwd must be a string")),
        };
        return Ok(McpServerConfig {
            transport: McpTransportKind::Stdio,
            command: Some(command.to_string()),
            args,
            env,
            cwd,
            url: None,
            headers: Vec::new(),
            exposure,
            description,
            tool_exposure,
            enabled,
            timeout_seconds,
        });
    }
    Err(format!(
        "server \"{name}\" needs either \"command\" (stdio) or \"url\" (streamable HTTP)"
    ))
}

fn is_valid_server_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
}

const OVERRIDE_KEYS: [&str; 3] = ["enabled", "exposure", "toolExposure"];

fn is_override(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.get("command").is_none()
        && object.get("url").is_none()
        && object.get("type").is_none()
}

fn read_config_file(
    path: &Path,
    scope: McpScope,
    servers: &mut Vec<McpServerEntry>,
    errors: &mut Vec<String>,
) {
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
    };
    let display = path.display().to_string();
    let parsed: Value = match serde_json::from_str(&text) {
        Ok(parsed) => parsed,
        Err(error) => {
            errors.push(format!("{display}: {error}"));
            return;
        }
    };
    if !parsed.is_object()
        || parsed
            .get("mcpServers")
            .map(|value| !value.is_object() && !value.is_null())
            .unwrap_or(false)
    {
        errors.push(format!(
            "{display}: expected an object with an \"mcpServers\" object"
        ));
        return;
    }
    let Some(entries) = parsed.get("mcpServers").and_then(Value::as_object) else {
        return;
    };
    for (name, value) in entries {
        if scope == McpScope::Project && is_override(value) {
            let base = servers.iter().find(|entry| &entry.name == name).cloned();
            let extra: Vec<String> = value
                .as_object()
                .map(|object| {
                    object
                        .keys()
                        .filter(|key| !OVERRIDE_KEYS.contains(&key.as_str()))
                        .cloned()
                        .collect()
                })
                .unwrap_or_default();
            let Some(base) = base else {
                errors.push(format!(
                    "{display}: server \"{name}\" needs \"command\" or \"url\", or a global server to override"
                ));
                continue;
            };
            if !extra.is_empty() {
                errors.push(format!(
                    "{display}: server \"{name}\": an override can only set {}",
                    OVERRIDE_KEYS.join(", ")
                ));
                continue;
            }
            let mut merged = base.config.clone();
            if let Some(enabled) = value.get("enabled").and_then(Value::as_bool) {
                merged.enabled = enabled;
            }
            if let Some(exposure) = value.get("exposure").and_then(Value::as_str) {
                match McpExposure::parse(exposure) {
                    Some(exposure) => merged.exposure = exposure,
                    None => {
                        errors.push(format!("{display}: server \"{name}\": invalid exposure"));
                        continue;
                    }
                }
            }
            if let Some(entries) = value.get("toolExposure").and_then(Value::as_object) {
                for (tool, exposure) in entries {
                    let Some(text) = exposure.as_str() else { continue };
                    let Some(exposure) = McpExposure::parse(text) else { continue };
                    merged
                        .tool_exposure
                        .retain(|(name, _)| name != tool);
                    merged.tool_exposure.push((tool.clone(), exposure));
                }
            }
            let mut entry = base;
            entry.config = merged;
            entry.override_path = Some(display.clone());
            servers.retain(|entry| &entry.name != name);
            servers.push(entry);
            continue;
        }
        let config = match validate_mcp_server_config(name, value) {
            Ok(config) => config,
            Err(error) => {
                errors.push(format!("{display}: {error}"));
                continue;
            }
        };
        if let Some(clash) = servers
            .iter()
            .find(|entry| entry.name != *name && mcp_namespace(&entry.name) == mcp_namespace(name))
        {
            let clash = clash.name.clone();
            errors.push(format!("{display}: server \"{name}\" conflicts with \"{clash}\""));
            continue;
        }
        servers.retain(|entry| &entry.name != name);
        servers.push(McpServerEntry {
            name: name.clone(),
            config,
            source: display.clone(),
            scope,
            override_path: None,
        });
    }
}

pub fn load_mcp_config(
    agent_dir: &Path,
    cwd: &Path,
    project_trusted: bool,
) -> LoadedMcpConfig {
    let mut servers = Vec::new();
    let mut errors = Vec::new();
    read_config_file(
        &agent_dir.join("mcp.json"),
        McpScope::Global,
        &mut servers,
        &mut errors,
    );
    let project_config = if project_trusted {
        Some(cwd.join(".pi").join("mcp.json"))
    } else {
        None
    };
    if let Some(project_config) = &project_config {
        read_config_file(
            project_config,
            McpScope::Project,
            &mut servers,
            &mut errors,
        );
    }
    LoadedMcpConfig {
        servers,
        errors,
        project_config,
    }
}

/// Change one server's settings in the `mcp.json` that defines it.
///
/// `enabled: true` and `exposure: "codemode"` are the defaults and remove the
/// key. The rest of the file is kept, and the file is rewritten with its own
/// indentation. With `override_entry`, a server the file does not define is
/// added as an override of the global one, the way a project's `mcp.json`
/// turns a global server off for one project.
pub fn update_mcp_server_config(
    path: &Path,
    name: &str,
    enabled: Option<bool>,
    exposure: Option<McpExposure>,
    override_entry: bool,
) -> Result<(), String> {
    let mut failure: Option<String> = None;
    edit_mcp_servers(path, |servers| {
        if !servers.contains_key(name) {
            if !override_entry {
                failure = Some(format!(
                    "{} does not define MCP server \"{name}\"",
                    path.display()
                ));
                return false;
            }
            servers.insert(name.to_string(), Value::Object(serde_json::Map::new()));
        }
        let Some(server) = servers.get_mut(name).and_then(Value::as_object_mut) else {
            failure = Some(format!(
                "{} does not define MCP server \"{name}\"",
                path.display()
            ));
            return false;
        };
        let keep_defaults = is_override(&Value::Object(server.clone()));
        if let Some(enabled) = enabled {
            if enabled && !keep_defaults {
                server.remove("enabled");
            } else {
                server.insert("enabled".to_string(), Value::Bool(enabled));
            }
        }
        if let Some(exposure) = exposure {
            if exposure == McpExposure::Codemode && !keep_defaults {
                server.remove("exposure");
            } else {
                server.insert(
                    "exposure".to_string(),
                    Value::String(exposure.as_str().to_string()),
                );
            }
        }
        true
    })?;
    match failure {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

/// Add a server to an `mcp.json`, creating the file when missing. An existing
/// entry with the same name is replaced. Returns `true` when an entry was
/// replaced.
pub fn add_mcp_server_config(
    path: &Path,
    name: &str,
    config: Value,
) -> Result<bool, String> {
    let mut replaced = false;
    edit_mcp_servers(path, |servers| {
        replaced = servers.contains_key(name);
        servers.insert(name.to_string(), config.clone());
        true
    })?;
    Ok(replaced)
}

/// Remove a server from an `mcp.json`. Returns `false` when the file does not
/// define it.
pub fn remove_mcp_server_config(path: &Path, name: &str) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    let mut removed = false;
    edit_mcp_servers(path, |servers| {
        if !servers.contains_key(name) {
            return false;
        }
        servers.remove(name);
        removed = true;
        true
    })?;
    Ok(removed)
}

/// Read an `mcp.json` (an empty config when missing), let `edit` change its
/// `mcpServers`, and write it back with its indentation when `edit` returns
/// true. The rest of the file is kept.
fn edit_mcp_servers(
    path: &Path,
    mut edit: impl FnMut(&mut serde_json::Map<String, Value>) -> bool,
) -> Result<(), String> {
    let text = std::fs::read_to_string(path).ok();
    let parsed: Value = match &text {
        Some(text) => serde_json::from_str(text).map_err(|error| error.to_string())?,
        None => serde_json::json!({}),
    };
    if !parsed.is_object()
        || parsed
            .get("mcpServers")
            .map(|value| !value.is_object() && !value.is_null())
            .unwrap_or(false)
    {
        return Err(format!(
            "{}: expected an object with an \"mcpServers\" object",
            path.display()
        ));
    }
    let mut root = parsed.as_object().cloned().unwrap_or_default();
    let mut servers = root
        .get("mcpServers")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    if !edit(&mut servers) {
        return Ok(());
    }
    root.insert("mcpServers".to_string(), Value::Object(servers));
    let indent = detect_indent(text.as_deref());
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let rendered = render_json(&Value::Object(root), &indent)?;
    std::fs::write(path, rendered).map_err(|error| error.to_string())
}

/// The indentation of a JSON file: the whitespace the first indented line
/// starts with, as the original's `JSON.stringify(parsed, null, indent)` does.
fn detect_indent(text: Option<&str>) -> String {
    text.and_then(|text| {
        text.lines().find_map(|line| {
            let trimmed = line.trim_start();
            if trimmed.is_empty() || trimmed.len() == line.len() {
                return None;
            }
            Some(&line[..line.len() - trimmed.len()])
        })
    })
    .unwrap_or("  ")
    .to_string()
}

/// A JSON value as the original's `JSON.stringify(value, null, indent)` writes
/// it: the same shape, with the file's own indentation.
fn render_json(value: &Value, indent: &str) -> Result<String, String> {
    let mut buffer = Vec::new();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(indent.as_bytes());
    let mut serializer = serde_json::Serializer::with_formatter(&mut buffer, formatter);
    serde::Serialize::serialize(value, &mut serializer).map_err(|error| error.to_string())?;
    buffer.push(b'\n');
    String::from_utf8(buffer).map_err(|error| error.to_string())
}

pub fn resolve_config_value(value: &str) -> Result<String, String> {
    if let Some(command) = value.strip_prefix('!') {
        return run_config_command(command);
    }
    let mut resolved = String::new();
    let mut rest = value;
    while let Some(index) = rest.find('$') {
        resolved.push_str(&rest[..index]);
        rest = &rest[index..];
        let Some(next) = rest.chars().nth(1) else {
            resolved.push('$');
            rest = "";
            break;
        };
        if next == '$' || next == '!' {
            resolved.push(next);
            rest = &rest[next.len_utf8()..];
            continue;
        }
        if next == '{' {
            let Some(end) = rest.find('}') else {
                resolved.push('$');
                rest = &rest[1..];
                continue;
            };
            let name = &rest[2..end];
            if is_env_name(name) {
                let Some(value) = std::env::var(name).ok() else {
                    return Err(format!(
                        "Failed to resolve the environment variable {name}"
                    ));
                };
                resolved.push_str(&value);
            } else {
                resolved.push_str(&rest[..=end]);
            }
            rest = &rest[end + 1..];
            continue;
        }
        let name: String = rest[1..]
            .chars()
            .take_while(|character| character.is_ascii_alphanumeric() || *character == '_')
            .collect();
        if name.is_empty() || !name.chars().next().map(|c| c.is_ascii_alphabetic() || c == '_').unwrap_or(false)
        {
            resolved.push('$');
            rest = &rest[1..];
            continue;
        }
        match std::env::var(&name) {
            Ok(value) => resolved.push_str(&value),
            Err(_) => {
                return Err(format!(
                    "Failed to resolve the environment variable {name}"
                ))
            }
        }
        rest = &rest[1 + name.len()..];
    }
    resolved.push_str(rest);
    Ok(resolved)
}

fn is_env_name(name: &str) -> bool {
    let mut characters = name.chars();
    match characters.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' => {}
        _ => return false,
    }
    characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

fn run_config_command(command: &str) -> Result<String, String> {
    let output = std::process::Command::new("sh")
        .arg("-c")
        .arg(command)
        .output()
        .map_err(|error| format!("Failed to resolve the shell command: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Failed to resolve the shell command: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        return Err("Failed to resolve the shell command".to_string());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stdio_server_is_validated() {
        let config = validate_mcp_server_config(
            "files",
            &serde_json::json!({ "command": "npx", "args": ["-y", "server"] }),
        )
        .unwrap();
        assert_eq!(config.transport, McpTransportKind::Stdio);
        assert_eq!(config.command.as_deref(), Some("npx"));
        assert_eq!(config.args, vec!["-y", "server"]);
        assert!(config.enabled);
    }

    #[test]
    fn an_http_server_is_validated() {
        let config = validate_mcp_server_config(
            "docs",
            &serde_json::json!({ "url": "https://example.com/mcp", "headers": { "A": "b" } }),
        )
        .unwrap();
        assert_eq!(config.transport, McpTransportKind::Http);
        assert_eq!(config.headers, vec![("A".to_string(), "b".to_string())]);
    }

    #[test]
    fn a_server_without_a_transport_is_rejected() {
        let error = validate_mcp_server_config("x", &serde_json::json!({})).unwrap_err();
        assert!(error.contains("needs either"));
    }

    #[test]
    fn a_bad_name_is_rejected() {
        let error =
            validate_mcp_server_config("bad name", &serde_json::json!({ "command": "x" })).unwrap_err();
        assert!(error.contains("invalid server name"));
    }

    #[test]
    fn the_namespace_replaces_dashes() {
        assert_eq!(mcp_namespace("my-server"), "mcp__my_server");
    }

    #[test]
    fn patterns_match_tool_names() {
        assert!(tool_pattern_matches("mcp__radius__*", "mcp__radius__search"));
        assert!(!tool_pattern_matches("mcp__radius__*", "mcp__other__search"));
        assert!(tool_pattern_matches("*", "anything"));
        assert!(tool_pattern_matches("mcp__a_*_b", "mcp__a_x_b"));
    }

    #[test]
    fn a_tool_exposure_overrides_the_server_exposure() {
        let config = validate_mcp_server_config(
            "x",
            &serde_json::json!({
                "command": "c",
                "exposure": "direct",
                "toolExposure": { "secret": "hidden", "slow_*": "deferred" }
            }),
        )
        .unwrap();
        assert_eq!(get_mcp_tool_exposure(&config, "secret"), McpExposure::Hidden);
        assert_eq!(get_mcp_tool_exposure(&config, "slow_one"), McpExposure::Deferred);
        assert_eq!(get_mcp_tool_exposure(&config, "other"), McpExposure::Direct);
    }

    #[test]
    fn the_config_file_is_read() {
        let dir = tempfile::tempdir().unwrap();
        let agent = dir.path().join("agent");
        std::fs::create_dir_all(&agent).unwrap();
        std::fs::write(
            agent.join("mcp.json"),
            serde_json::json!({ "mcpServers": { "one": { "command": "a" }, "two": { "command": "b" } } })
                .to_string(),
        )
        .unwrap();
        let loaded = load_mcp_config(&agent, dir.path(), false);
        assert_eq!(loaded.servers.len(), 2);
        assert!(loaded.errors.is_empty());
    }

    #[test]
    fn a_broken_config_file_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        let agent = dir.path().join("agent");
        std::fs::create_dir_all(&agent).unwrap();
        std::fs::write(agent.join("mcp.json"), "{ not json").unwrap();
        let loaded = load_mcp_config(&agent, dir.path(), false);
        assert_eq!(loaded.servers.len(), 0);
        assert_eq!(loaded.errors.len(), 1);
    }

    #[test]
    fn a_project_override_only_changes_the_allowed_keys() {
        let dir = tempfile::tempdir().unwrap();
        let agent = dir.path().join("agent");
        let project = dir.path().join(".pi");
        std::fs::create_dir_all(&agent).unwrap();
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(
            agent.join("mcp.json"),
            serde_json::json!({ "mcpServers": { "one": { "command": "a" } } }).to_string(),
        )
        .unwrap();
        std::fs::write(
            project.join("mcp.json"),
            serde_json::json!({ "mcpServers": { "one": { "enabled": false } } }).to_string(),
        )
        .unwrap();
        let loaded = load_mcp_config(&agent, dir.path(), true);
        assert_eq!(loaded.servers.len(), 1);
        assert!(!loaded.servers[0].config.enabled);
        assert!(loaded.servers[0].override_path.is_some());
    }

    #[test]
    fn env_values_are_resolved() {
        std::env::set_var("RPI_MCP_TEST_VALUE", "secret");
        assert_eq!(
            resolve_config_value("Bearer ${RPI_MCP_TEST_VALUE}").unwrap(),
            "Bearer secret"
        );
        std::env::remove_var("RPI_MCP_TEST_VALUE");
    }
}
