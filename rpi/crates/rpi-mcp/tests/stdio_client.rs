//! The client against a real MCP server over stdio.
//!
//! The server is a small JSON-RPC program that speaks the MCP protocol: the
//! test binary re-executes itself with `RPI_MCP_TEST_SERVER=1`, and the test
//! named `mcp_test_server` then serves the protocol instead of asserting.

use std::io::{BufRead, Write};

use rpi_mcp::client::{McpClient, McpClientOptions};
use rpi_mcp::stdio::{StdioOptions, StdioTransport};
use serde_json::{json, Value};

const SERVER_ENV: &str = "RPI_MCP_TEST_SERVER";

#[test]
fn mcp_test_server() {
    if std::env::var(SERVER_ENV).is_err() {
        return;
    }
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
                    "serverInfo": { "name": "test-server", "version": "1.0" },
                    "instructions": "A test server."
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

fn server_command() -> StdioOptions {
    StdioOptions {
        command: std::env::current_exe()
            .expect("the test binary")
            .to_string_lossy()
            .into_owned(),
        args: vec!["--exact".to_string(), "mcp_test_server".to_string()],
        env: vec![(SERVER_ENV.to_string(), "1".to_string())],
        inherit_env: true,
        ..Default::default()
    }
}

#[tokio::test]
async fn the_client_talks_to_a_stdio_server() {
    let transport = std::sync::Arc::new(StdioTransport::new(server_command()));
    let client = McpClient::new(McpClientOptions::default());
    let initialized = client
        .connect(transport)
        .await
        .expect("the server answers the handshake");
    assert_eq!(initialized.protocol_version, "2025-11-25");
    assert_eq!(initialized.server_info.name, "test-server");
    assert_eq!(client.instructions().as_deref(), Some("A test server."));

    let tools = client.list_tools().await.expect("the tools are listed");
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name, "echo");
    assert_eq!(tools[0].description.as_deref(), Some("Echo the text back"));
    assert_eq!(tools[0].input_schema["properties"]["text"]["type"], "string");

    let result = client
        .call_tool("echo", json!({ "text": "hi" }), None)
        .await
        .expect("the tool answers");
    assert_eq!(result.text(), "echoed");
    assert!(!result.is_error);

    let resources = client.list_resources().await.expect("the resources are listed");
    assert_eq!(resources.len(), 1);
    assert_eq!(resources[0].uri, "file:///a.txt");

    let read = client
        .read_resource("file:///a.txt")
        .await
        .expect("the resource is read");
    assert_eq!(read.contents.len(), 1);
    assert_eq!(read.contents[0].text.as_deref(), Some("hello"));

    client.close().await;
}
