//! The MCP client against a real MCP server.
//!
//! The server is a small JSON-RPC program that speaks the MCP protocol over
//! stdio. It runs as its own process: the test binary re-executes itself with
//! `RPI_MCP_TEST_SERVER=1`, and the test named `mcp_test_server` then serves
//! the protocol instead of running an assertion.

use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;

use rpi_cli::args::Args;
use rpi_cli::js_extensions::{JsExtensions, JsSession};
use rpi_cli::mcp::McpManager;
use rpi_cli::session::{merge_mcp_tools, prepare_extensions};
use serde_json::{json, Value};

const SERVER_ENV: &str = "RPI_MCP_TEST_SERVER";

#[test]
fn mcp_test_server() {
    if std::env::var(SERVER_ENV).is_err() {
        return;
    }
    serve();
}

fn serve() {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let id = message.get("id").cloned().unwrap_or(Value::Null);
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");
        let response = match method {
            "initialize" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": { "tools": {}, "resources": {} },
                    "serverInfo": { "name": "test-server", "version": "1.0" }
                }
            }),
            "tools/list" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "tools": [
                        {
                            "name": "echo",
                            "description": "Echo the text back",
                            "inputSchema": {
                                "type": "object",
                                "properties": { "text": { "type": "string" } }
                            }
                        }
                    ]
                }
            }),
            "tools/call" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "content": [{ "type": "text", "text": "echoed" }] }
            }),
            "resources/list" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "resources": [{ "uri": "file:///a.txt", "name": "a.txt" }] }
            }),
            "resources/read" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "contents": [{ "uri": "file:///a.txt", "text": "hello" }] }
            }),
            _ => continue,
        };
        let _ = writeln!(stdout, "{response}");
        let _ = stdout.flush();
    }
}

fn server_command() -> Command {
    let mut command = Command::new(std::env::current_exe().expect("the test binary"));
    command
        .args(["--exact", "mcp_test_server"])
        .env(SERVER_ENV, "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    command
}

fn server_path() -> PathBuf {
    std::env::current_exe().expect("the test binary")
}

#[tokio::test(flavor = "multi_thread")]
async fn a_registered_server_reaches_the_model() {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let agent_dir = directory.path().join("agent");
    std::fs::create_dir_all(&agent_dir).expect("the agent directory");

    let manager = std::sync::Arc::new(McpManager::new(
        directory.path().to_path_buf(),
        agent_dir.clone(),
    ));
    manager.set_runtime(tokio::runtime::Handle::current());

    let session = std::sync::Arc::new(JsSession {
        mcp: Some(std::sync::Arc::clone(&manager)),
        ..Default::default()
    });
    let extensions = JsExtensions::new();
    extensions.set_session(session);

    let registered = extensions.host_call(
        "mcp.register",
        json!({
            "name": "test",
            "config": { "command": server_path().to_string_lossy() },
            "extensionPath": "test-extension",
        }),
    );
    assert!(registered.is_ok(), "the host operation answered: {registered:?}");

    manager.ensure_connected("test").await.expect("the server connects");

    let statuses = manager.statuses();
    assert_eq!(statuses.len(), 1);
    assert_eq!(statuses[0].name, "test");
    assert_eq!(statuses[0].state, rpi_cli::mcp::ServerState::Connected);
    assert_eq!(statuses[0].tool_count, 1);

    let mut tools = Vec::new();
    let mut active = Vec::new();
    let args = Args::default();
    rpi_cli::session::merge_mcp_tools(&mut tools, &mut active, &manager, &args);

    let names: Vec<String> = tools
        .iter()
        .map(|tool| tool.tool.schema().name.clone())
        .collect();
    assert!(
        names.contains(&"mcp__test__echo".to_string()),
        "the server's tool reached the tool set: {names:?}"
    );
    assert!(
        active.contains(&"mcp__test__echo".to_string()),
        "the server's tool is active: {active:?}"
    );

    let tool = tools
        .iter()
        .find(|tool| tool.tool.schema().name == "mcp__test__echo")
        .expect("the MCP tool");
    assert_eq!(
        tool.tool.schema().description,
        "Echo the text back",
        "the tool carries the server's description"
    );

    manager.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn the_tool_calls_the_server() {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let agent_dir = directory.path().join("agent");
    std::fs::create_dir_all(&agent_dir).expect("the agent directory");
    let manager = std::sync::Arc::new(McpManager::new(
        directory.path().to_path_buf(),
        agent_dir,
    ));
    manager.set_runtime(tokio::runtime::Handle::current());
    manager
        .register(
            "test",
            &json!({ "command": server_path().to_string_lossy() }),
            "test-extension",
        )
        .expect("the server registers");
    manager.ensure_connected("test").await.expect("the server connects");

    let result = manager
        .call_tool("test", "echo", json!({ "text": "hi" }))
        .await
        .expect("the tool call answers");
    assert_eq!(result.text(), "echoed");

    manager.close().await;
}

#[test]
fn a_malformed_server_config_is_rejected() {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let manager = McpManager::new(
        directory.path().to_path_buf(),
        directory.path().join("agent"),
    );
    let error = manager
        .register("broken", &json!({ "not": "a server" }), "test-extension")
        .expect_err("the config is rejected");
    assert!(error.contains("needs either"), "{error}");
}

/// The `mcp.json` the session reads: the server the fixture runs as.
fn write_mcp_json(agent_dir: &std::path::Path) {
    std::fs::create_dir_all(agent_dir).expect("the agent directory");
    let config = json!({
        "mcpServers": {
            "test": {
                "command": server_path().to_string_lossy(),
                "args": ["--exact", "mcp_test_server"],
                "env": { SERVER_ENV: "1" },
                "exposure": "direct"
            }
        }
    });
    std::fs::write(
        agent_dir.join("mcp.json"),
        serde_json::to_string_pretty(&config).expect("the config renders"),
    )
    .expect("the config is written");
}

/// The tool set the model sees, with the names of the active tools.
fn model_tools(
    manager: &std::sync::Arc<McpManager>,
    args: &Args,
) -> (Vec<rpi_harness::types::HarnessTool>, Vec<String>) {
    let mut tools = Vec::new();
    let mut active = Vec::new();
    merge_mcp_tools(&mut tools, &mut active, manager, args);
    (tools, active)
}

#[tokio::test(flavor = "multi_thread")]
async fn a_configured_server_reaches_the_model() {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let agent_dir = directory.path().join("agent");
    write_mcp_json(&agent_dir);

    let manager = std::sync::Arc::new(McpManager::new(
        directory.path().to_path_buf(),
        agent_dir.clone(),
    ));
    manager.set_runtime(tokio::runtime::Handle::current());
    manager.load_config(true);
    manager.connect_all().await;

    let statuses = manager.statuses();
    assert_eq!(statuses.len(), 1, "the configured server is known");
    assert_eq!(statuses[0].name, "test");
    assert_eq!(statuses[0].state, rpi_cli::mcp::ServerState::Connected);
    assert_eq!(statuses[0].tool_count, 1);
    assert!(statuses[0].has_resources, "the server offers resources");

    let args = Args::default();
    let (tools, active) = model_tools(&manager, &args);
    let names: Vec<String> = tools
        .iter()
        .map(|tool| tool.tool.schema().name.clone())
        .collect();
    assert!(
        names.contains(&"mcp__test__echo".to_string()),
        "the server's tool reached the tool set: {names:?}"
    );
    assert!(
        active.contains(&"mcp__test__echo".to_string()),
        "the server's tool is active: {active:?}"
    );
    assert!(
        names.contains(&"list_mcp_resources".to_string()),
        "the resource tools reached the tool set: {names:?}"
    );

    let tool = tools
        .iter()
        .find(|tool| tool.tool.schema().name == "mcp__test__echo")
        .expect("the MCP tool");
    assert_eq!(
        tool.tool.schema().description,
        "Echo the text back",
        "the tool carries the server's description"
    );
    assert_eq!(
        tool.tool.schema().parameters.as_value(),
        &json!({
            "type": "object",
            "properties": { "text": { "type": "string" } }
        }),
        "the tool carries the server's schema"
    );

    // The call reaches the server and its result comes back to the model.
    let result = tool
        .tool
        .execute(
            "call-1",
            json!({ "text": "hi" }),
            tokio_util::sync::CancellationToken::new(),
            std::sync::Arc::new(|_| {}),
        )
        .await
        .expect("the tool answers");
    let text = result
        .content
        .iter()
        .filter_map(|block| match block {
            rpi_agent::types::TextContentOrImage::Text(text) => Some(text.text.clone()),
            _ => None,
        })
        .collect::<Vec<String>>()
        .join("\n");
    assert_eq!(text, "echoed", "the server's result reaches the model");
    assert!(!result.is_error);

    manager.close().await;
}

/// The environment of the test process is shared, so the tests that point the
/// agent directory somewhere else take turns.
fn env_lock() -> &'static Mutex<()> {
    static LOCK: std::sync::LazyLock<Mutex<()>> =
        std::sync::LazyLock::new(|| Mutex::new(()));
    &LOCK
}

#[tokio::test(flavor = "multi_thread")]
async fn no_mcp_leaves_the_tool_out() {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let agent_dir = directory.path().join("agent");
    write_mcp_json(&agent_dir);

    let guard = env_lock().lock().unwrap_or_else(|error| error.into_inner());
    let previous = std::env::var_os(rpi_cli::config::CONFIG_DIR_ENV);
    std::env::set_var(rpi_cli::config::CONFIG_DIR_ENV, &agent_dir);

    let mut args = Args::default();
    args.no_extensions = true;

    // Without `--no-mcp` the server's tools join the model's tool set.
    let prepared = prepare_extensions(&args, directory.path(), true)
        .expect("the session prepares");
    let manager = prepared.mcp.expect("the MCP client exists");
    manager.set_runtime(tokio::runtime::Handle::current());
    manager.connect_all().await;
    let (tools, _) = model_tools(&manager, &args);
    let names: Vec<String> = tools
        .iter()
        .map(|tool| tool.tool.schema().name.clone())
        .collect();
    assert!(
        names.contains(&"mcp__test__echo".to_string()),
        "the server's tool reached the tool set: {names:?}"
    );
    manager.close().await;

    // With `--no-mcp` there is no MCP client at all, so no MCP tool is declared.
    args.no_mcp = true;
    let prepared = prepare_extensions(&args, directory.path(), true)
        .expect("the session prepares");
    assert!(
        prepared.mcp.is_none(),
        "--no-mcp leaves the session without an MCP client"
    );

    match previous {
        Some(value) => std::env::set_var(rpi_cli::config::CONFIG_DIR_ENV, value),
        None => std::env::remove_var(rpi_cli::config::CONFIG_DIR_ENV),
    }
    drop(guard);
}
