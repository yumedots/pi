//! Mirrors `packages/agent/src/harness/tools/*` — the built-in `read`/`write`/
//! `edit`/`bash` `AgentTool` impls + the read-only `grep`/`find`/`ls` ports
//! (port of `packages/coding-agent/src/core/tools/{grep,find,ls}.ts`) + their
//! shared helpers.

pub mod bash;
pub mod edit;
pub mod edit_diff;
pub mod find;
pub mod grep;
pub mod image;
pub mod ls;
pub mod powershell;
pub mod read;
pub mod tool_context;
pub mod write;

/// A tool's contribution to the system prompt. Mirrors TS
/// `ToolDefinition.promptSnippet` / `promptGuidelines`.
#[derive(Debug, Clone)]
pub struct PromptContribution {
    /// One-line description used in the prompt's tool list.
    pub snippet: &'static str,
    /// Guideline bullets contributed to the prompt's rules.
    pub guidelines: Vec<String>,
}

impl PromptContribution {
    /// Build a contribution from a static snippet and its guideline bullets.
    pub fn new(snippet: &'static str, guidelines: &[&str]) -> Self {
        Self {
            snippet,
            guidelines: guidelines.iter().map(|g| (*g).to_string()).collect(),
        }
    }
}

pub use bash::{create_bash_tool, BashExecution, BashPrepare, BashToolOptions};
pub use edit::create_edit_tool;
pub use find::create_find_tool;
pub use grep::create_grep_tool;
pub use image::{create_image_tool, create_image_tool_with_config, ImageToolConfig};
pub use ls::create_ls_tool;
pub use powershell::create_powershell_tool;
pub use read::{create_read_tool, ProcessedImage, ReadImageProcessor, ReadToolOptions};
pub use tool_context::ExecutionToolContext;
pub use write::create_write_tool;
