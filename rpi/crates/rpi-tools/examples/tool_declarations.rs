//! Prints the tool declarations the model is offered, as JSON.
//!
//! The parity harness compares these against the original's declarations
//! (`scripts/parity/tools-tokens.mjs`): the name, the description and the
//! parameter schema of every tool, plus its contribution to the system
//! prompt. Run it with
//! `cargo run --example tool_declarations -p rpi-tools`.

use std::sync::Arc;

use rpi_agent::agent_tool::AgentTool;
use rpi_tools::{
    create_bash_tool, create_edit_tool, create_find_tool, create_grep_tool, create_ls_tool,
    create_powershell_tool, create_read_tool, create_write_tool, ExecutionToolContext,
    InMemoryExecutionEnv,
};

fn main() {
    let env: Arc<dyn rpi_tools::ExecutionEnv> =
        Arc::new(InMemoryExecutionEnv::with_cwd("/tmp/work".into()));
    let mut_env: Arc<dyn rpi_tools::MutatingEnv> =
        Arc::new(InMemoryExecutionEnv::with_cwd("/tmp/work".into()));
    let ctx = ExecutionToolContext::new(env, Some(mut_env));

    let tools: Vec<Arc<dyn AgentTool>> = vec![
        create_read_tool(&ctx, None),
        create_bash_tool(&ctx, None),
        create_edit_tool(&ctx),
        create_write_tool(&ctx),
        create_grep_tool(&ctx, None),
        create_find_tool(&ctx, None),
        create_ls_tool(&ctx, None),
        create_powershell_tool(&ctx),
    ];

    let mut out = serde_json::Map::new();
    for tool in tools {
        let schema = tool.schema();
        out.insert(
            schema.name.clone(),
            serde_json::json!({
                "name": schema.name,
                "label": tool.label(),
                "description": schema.description,
                "parameters": schema.parameters.as_value(),
                "constrainedSampling": schema.constrained_sampling,
                "promptSnippet": tool.prompt_snippet(),
                "promptGuidelines": tool.prompt_guidelines(),
            }),
        );
    }
    println!("{}", serde_json::to_string_pretty(&serde_json::Value::Object(out)).unwrap());
}
