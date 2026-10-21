pub mod client;
pub mod config;
pub mod http;
pub mod protocol;
pub mod stdio;
pub mod tools;
pub mod transport;

pub use client::{ClientState, McpClient, McpClientOptions};
pub use config::{
    create_tool_name_matcher, get_mcp_tool_exposure, load_mcp_config, mcp_namespace,
    validate_mcp_server_config, LoadedMcpConfig, McpExposure, McpScope, McpServerConfig,
    McpServerEntry, McpTransportKind,
};
pub use protocol::{
    CallToolResult, ContentBlock, Implementation, InitializeResult, McpError, McpRoot, McpTool,
    ReadResourceResult, Resource, ResourceContents, ResourceTemplate,
};
pub use tools::create_mcp_tool_name;
pub use transport::{McpTransport, TransportEvent, TransportSink};
