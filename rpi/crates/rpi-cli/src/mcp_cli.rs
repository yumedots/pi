//! `rpi mcp` — add, remove, and check MCP servers outside a session.
//!
//! The original's `pi mcp` (`packages/coding-agent/src/extensions/mcp/cli.ts`)
//! lets an agent configure a server, verify an `mcp.json` it wrote, and start
//! an OAuth sign-in. The port brings the configuration and the check; the
//! OAuth sign-in (`login`/`logout`) needs the credential store and the browser
//! flow, which the port does not have yet.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::mcp::McpManager;
use rpi_mcp::config::{
    add_mcp_server_config, load_mcp_config, remove_mcp_server_config, validate_mcp_server_config,
    McpExposure,
};

const HELP: &str = "Usage:
  rpi mcp add <server> [options] -- <command> [args...]
  rpi mcp add <server> [options] --url <url>
  rpi mcp remove <server> [-l]
  rpi mcp list [--json]

Configure and check MCP servers without starting a session.
Reads ~/.pi/agent/mcp.json and, in trusted projects, .pi/mcp.json.

Commands:
  add <server>            Add or replace a server in mcp.json
  remove <server>         Remove a server from mcp.json
  list                    Show state, tools, and errors (exits 1 on failure)

Options for add and remove:
  -l, --local             Use .pi/mcp.json in the current project instead of the global file

Options for add:
  --url <url>             Streamable HTTP server URL (instead of a command)
  --env <KEY=VALUE>       Environment variable for a stdio server (repeatable)
  --cwd <dir>             Working directory for a stdio server
  --header <KEY=VALUE>    HTTP header (repeatable)
  --exposure <mode>       codemode (default), deferred, direct, or hidden
  --description <text>    What the server offers, shown in the system prompt

Other options:
  --json                  Print the list as JSON";

const HELP_HINT: &str = "Use \"rpi mcp --help\" for usage.";

pub async fn run(args: &[String]) -> i32 {
    let command = args.first().map(String::as_str);
    if command.is_none() || command == Some("help") || args.iter().any(|arg| arg == "--help" || arg == "-h")
    {
        println!("{HELP}");
        return 0;
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let agent_dir = crate::config::agent_dir().unwrap_or_else(|_| cwd.clone());
    let project_config = cwd.join(".pi").join("mcp.json");
    let rest = &args[1..];
    match command {
        Some("list") => list(rest, &cwd, &agent_dir, &project_config).await,
        Some("add") => add(rest, &agent_dir, &project_config),
        Some("remove") => remove(rest, &agent_dir, &project_config),
        Some("login") | Some("logout") => {
            eprintln!(
                "Error: `rpi mcp {}` needs the MCP OAuth flow, which the port does not have yet.",
                command.unwrap_or_default()
            );
            eprintln!("{HELP_HINT}");
            1
        }
        Some(other) => {
            eprintln!("Error: unknown mcp command \"{other}\".");
            eprintln!("{HELP_HINT}");
            1
        }
        None => 0,
    }
}

async fn list(args: &[String], cwd: &Path, agent_dir: &Path, project_config: &Path) -> i32 {
    let mut json_output = false;
    for arg in args {
        match arg.as_str() {
            "--json" => json_output = true,
            other => {
                eprintln!("Error: unknown option {other}.");
                eprintln!("{HELP_HINT}");
                return 1;
            }
        }
    }
    let trusted = crate::config::nearest_project_trust_decision(cwd)
        .ok()
        .flatten()
        .unwrap_or(false);
    let loaded = load_mcp_config(agent_dir, cwd, trusted);
    let untrusted_note = if !trusted && project_config.exists() {
        Some(format!(
            "{} is ignored because the project is not trusted. Start rpi in the project to trust it.",
            project_config.display()
        ))
    } else {
        None
    };

    let manager = McpManager::new(cwd.to_path_buf(), agent_dir.to_path_buf());
    manager.load_config(trusted);
    manager.connect_all().await;

    let statuses = manager.statuses();
    let reports: Vec<Value> = statuses
        .iter()
        .map(|status| {
            let tools = manager.tools_of(&status.name);
            let mut report = serde_json::Map::new();
            report.insert("name".into(), Value::String(status.name.clone()));
            report.insert("scope".into(), Value::String(status.scope.as_str().into()));
            report.insert("source".into(), Value::String(status.source.clone()));
            if let Some(override_path) = &status.override_path {
                report.insert("override".into(), Value::String(override_path.clone()));
            }
            report.insert("enabled".into(), Value::Bool(status.enabled));
            report.insert(
                "exposure".into(),
                Value::String(status.exposure.as_str().into()),
            );
            report.insert("transport".into(), Value::String(status.transport.clone()));
            report.insert(
                "state".into(),
                Value::String(status.state.as_str().into()),
            );
            report.insert(
                "tools".into(),
                Value::Array(tools.into_iter().map(Value::String).collect()),
            );
            let mut overrides = serde_json::Map::new();
            for tool in manager.server_tools(&status.name) {
                if tool.exposure != status.exposure {
                    overrides.insert(
                        tool.name,
                        Value::String(tool.exposure.as_str().into()),
                    );
                }
            }
            if !overrides.is_empty() {
                report.insert("toolExposure".into(), Value::Object(overrides));
            }
            if status.has_resources {
                report.insert("resources".into(), Value::Bool(true));
            }
            if let Some(error) = &status.error {
                report.insert("error".into(), Value::String(error.clone()));
            }
            Value::Object(report)
        })
        .collect();
    let failed = !loaded.errors.is_empty()
        || reports.iter().any(|report| {
            report.get("enabled").and_then(Value::as_bool) == Some(true)
                && report.get("state").and_then(Value::as_str) != Some("connected")
        });

    if json_output {
        let mut payload = json!({ "servers": reports, "errors": loaded.errors });
        if let Some(note) = &untrusted_note {
            payload["note"] = Value::String(note.clone());
        }
        println!("{}", serde_json::to_string_pretty(&payload).unwrap_or_default());
        return i32::from(failed);
    }

    if reports.is_empty() && loaded.errors.is_empty() {
        println!(
            "No MCP servers configured. Add them to {} or .pi/mcp.json.",
            agent_dir.join("mcp.json").display()
        );
    }
    for report in reports.iter() {
        let name = report.get("name").and_then(Value::as_str).unwrap_or_default();
        let state = report.get("state").and_then(Value::as_str).unwrap_or_default();
        let exposure = report.get("exposure").and_then(Value::as_str).unwrap_or_default();
        let scope = report.get("scope").and_then(Value::as_str).unwrap_or_default();
        let tools = report
            .get("tools")
            .and_then(Value::as_array)
            .map(|tools| {
                tools
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        let described = match state {
            "connected" => format!(
                "connected, {} tool{}",
                tools.len(),
                if tools.len() == 1 { "" } else { "s" }
            ),
            "needs-auth" => "needs sign-in".to_string(),
            other => other.to_string(),
        };
        println!("{name}: {described} ({exposure}, {scope})");
        if let Some(transport) = report.get("transport").and_then(Value::as_str) {
            println!("  {transport}");
        }
        if let Some(override_path) = report.get("override").and_then(Value::as_str) {
            println!("  project override: {override_path}");
        }
        if state == "needs-auth" {
            println!("  sign in with: rpi mcp login {name}");
        }
        if !tools.is_empty() {
            let exposures = report.get("toolExposure").and_then(Value::as_object);
            let listed: Vec<String> = tools
                .iter()
                .map(|tool| match exposures.and_then(|entries| entries.get(tool)) {
                    Some(Value::String(exposure)) => format!("{tool} [{exposure}]"),
                    _ => tool.clone(),
                })
                .collect();
            println!("  tools: {}", listed.join(", "));
        }
        if report.get("resources").and_then(Value::as_bool) == Some(true) {
            println!("  offers resources");
        }
        if let Some(error) = report.get("error").and_then(Value::as_str) {
            for line in error.lines() {
                println!("  {line}");
            }
        }
    }
    for error in loaded.errors.iter() {
        println!("config error: {error}");
    }
    if let Some(note) = &untrusted_note {
        println!("{note}");
    }
    i32::from(failed)
}

fn add(args: &[String], agent_dir: &Path, project_config: &Path) -> i32 {
    let mut name: Option<String> = None;
    let mut url: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut exposure: Option<String> = None;
    let mut description: Option<String> = None;
    let mut env: Vec<(String, String)> = Vec::new();
    let mut headers: Vec<(String, String)> = Vec::new();
    let mut local = false;
    let mut command: Vec<String> = Vec::new();
    let mut index = 0;
    while index < args.len() {
        let arg = args[index].as_str();
        match arg {
            "--" => {
                command = args[index + 1..].to_vec();
                break;
            }
            "-l" | "--local" => local = true,
            "--url" | "--cwd" | "--exposure" | "--description" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    eprintln!("Error: {arg} needs a value.");
                    return 1;
                };
                match arg {
                    "--url" => url = Some(value.clone()),
                    "--cwd" => cwd = Some(value.clone()),
                    "--exposure" => exposure = Some(value.clone()),
                    _ => description = Some(value.clone()),
                }
            }
            "--env" | "--header" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    eprintln!("Error: {arg} needs a value.");
                    return 1;
                };
                let Some(pair) = value.split_once('=') else {
                    eprintln!("Error: {arg} expects KEY=VALUE, got \"{value}\".");
                    return 1;
                };
                if arg == "--env" {
                    env.push((pair.0.to_string(), pair.1.to_string()));
                } else {
                    headers.push((pair.0.to_string(), pair.1.to_string()));
                }
            }
            other if other.starts_with('-') => {
                eprintln!("Error: unknown option {other}.");
                eprintln!("{HELP_HINT}");
                return 1;
            }
            other => {
                if name.is_none() {
                    name = Some(other.to_string());
                } else {
                    command.push(other.to_string());
                }
            }
        }
        index += 1;
    }
    let Some(name) = name else {
        eprintln!("Error: `rpi mcp add` needs a server name.");
        eprintln!("{HELP_HINT}");
        return 1;
    };
    if url.is_some() == command.is_empty() {
        eprintln!("Error: `rpi mcp add` needs either --url <url> or -- <command> [args...].");
        eprintln!("{HELP_HINT}");
        return 1;
    }
    let mut config = if let Some(url) = url {
        json!({ "url": url, "headers": headers.into_iter().collect::<std::collections::BTreeMap<String, String>>() })
    } else {
        let mut command_parts = command.into_iter();
        let executable = command_parts.next().unwrap_or_default();
        let rest: Vec<String> = command_parts.collect();
        let mut config = json!({ "command": executable });
        if !rest.is_empty() {
            config["args"] = json!(rest);
        }
        if !env.is_empty() {
            config["env"] =
                json!(env.into_iter().collect::<std::collections::BTreeMap<String, String>>());
        }
        if let Some(cwd) = cwd {
            config["cwd"] = Value::String(cwd);
        }
        config
    };
    if let Some(exposure) = exposure {
        let Some(parsed) = McpExposure::parse(&exposure) else {
            eprintln!(
                "Error: --exposure must be one of \"codemode\", \"deferred\", \"direct\", \"hidden\"."
            );
            return 1;
        };
        config["exposure"] = Value::String(parsed.as_str().to_string());
    }
    if let Some(description) = description {
        config["description"] = Value::String(description);
    }
    let validated = match validate_mcp_server_config(&name, &config) {
        Ok(validated) => validated,
        Err(error) => {
            eprintln!("Error: {error}");
            return 1;
        }
    };
    let path = if local {
        project_config.to_path_buf()
    } else {
        agent_dir.join("mcp.json")
    };
    let scope = if local { "project" } else { "global" };
    let value = crate::mcp::server_config_to_value(&validated);
    match add_mcp_server_config(&path, &name, value) {
        Ok(replaced) => {
            println!(
                "{} {scope} MCP server \"{name}\" in {}.",
                if replaced { "Replaced" } else { "Added" },
                path.display()
            );
            println!("Check it with: rpi mcp list");
            0
        }
        Err(error) => {
            eprintln!("Error: Could not update {}: {error}", path.display());
            1
        }
    }
}

fn remove(args: &[String], agent_dir: &Path, project_config: &Path) -> i32 {
    let mut name: Option<String> = None;
    let mut local = false;
    for arg in args {
        match arg.as_str() {
            "-l" | "--local" => local = true,
            other if other.starts_with('-') => {
                eprintln!("Error: unknown option {other}.");
                eprintln!("{HELP_HINT}");
                return 1;
            }
            other => {
                if name.is_some() {
                    eprintln!("Error: `rpi mcp remove` takes one server name.");
                    eprintln!("{HELP_HINT}");
                    return 1;
                }
                name = Some(other.to_string());
            }
        }
    }
    let Some(name) = name else {
        eprintln!("Error: `rpi mcp remove` needs a server name.");
        eprintln!("{HELP_HINT}");
        return 1;
    };
    let path = if local {
        project_config.to_path_buf()
    } else {
        agent_dir.join("mcp.json")
    };
    let scope = if local { "project" } else { "global" };
    match remove_mcp_server_config(&path, &name) {
        Ok(true) => {
            println!(
                "Removed {scope} MCP server \"{name}\" from {}.",
                path.display()
            );
            0
        }
        Ok(false) => {
            eprintln!(
                "Error: No {scope} MCP server named \"{name}\" in {}.",
                path.display()
            );
            1
        }
        Err(error) => {
            eprintln!("Error: Could not update {}: {error}", path.display());
            1
        }
    }
}
