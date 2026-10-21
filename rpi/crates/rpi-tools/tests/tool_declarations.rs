//! The tool declarations the model reads on every request, pinned against the
//! originals in `packages/coding-agent/src/core/tools/*.ts`.
//!
//! The name, the description and the parameter schema of a tool are part of
//! the request the model sees, so a wording change or a schema change is a
//! behaviour change. Each test pins one tool against the original's exact
//! text.

use std::sync::Arc;

use rpi_agent::agent_tool::AgentTool;
use rpi_tools::{
    create_bash_tool, create_edit_tool, create_find_tool, create_grep_tool, create_ls_tool,
    create_powershell_tool, create_read_tool, create_write_tool, ExecutionToolContext,
    InMemoryExecutionEnv,
};

fn context() -> ExecutionToolContext {
    let env: Arc<dyn rpi_tools::ExecutionEnv> = Arc::new(InMemoryExecutionEnv::with_cwd("/tmp/work".into()));
    let mut_env: Arc<dyn rpi_tools::MutatingEnv> =
        Arc::new(InMemoryExecutionEnv::with_cwd("/tmp/work".into()));
    ExecutionToolContext::new(env, Some(mut_env))
}

fn declaration(tool: &Arc<dyn AgentTool>) -> (String, String, serde_json::Value) {
    let schema = tool.schema();
    (
        schema.name.clone(),
        schema.description.clone(),
        schema.parameters.as_value().clone(),
    )
}

#[test]
fn read_declaration_matches_the_original() {
    let tool = create_read_tool(&context(), None);
    let (name, description, parameters) = declaration(&tool);
    assert_eq!(name, "read");
    assert_eq!(
        description,
        "Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). \
         Images are sent as attachments. For text files, output is truncated to 2000 lines or 50KB \
         (whichever is hit first). Use offset/limit for large files. When you need the full file, \
         continue with offset until complete."
    );
    assert_eq!(
        parameters,
        serde_json::json!({
            "type": "object",
            "required": ["path"],
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to the file to read (relative or absolute)"
                },
                "offset": {
                    "type": "number",
                    "description": "Line number to start reading from (1-indexed)"
                },
                "limit": {
                    "type": "number",
                    "description": "Maximum number of lines to read"
                }
            }
        })
    );
    assert_eq!(tool.prompt_snippet(), Some("Read file contents"));
    assert_eq!(
        tool.prompt_guidelines(),
        Some(["Use read to examine files instead of cat or sed.".to_string()].as_slice())
    );
}

#[test]
fn bash_declaration_matches_the_original() {
    let tool = create_bash_tool(&context(), None);
    let (name, description, parameters) = declaration(&tool);
    assert_eq!(name, "bash");
    assert_eq!(
        description,
        "Execute a bash command in the current working directory. Returns stdout and stderr. \
         Output is truncated to last 2000 lines or 50KB (whichever is hit first). If truncated, \
         full output is saved to a temp file. Optionally provide a timeout in seconds."
    );
    assert_eq!(
        parameters,
        serde_json::json!({
            "type": "object",
            "required": ["command"],
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Shell command to execute"
                },
                "timeout": {
                    "type": "number",
                    "description": "Timeout in seconds (optional, no default timeout)"
                }
            }
        })
    );
    assert_eq!(
        tool.prompt_snippet(),
        Some("Execute bash commands (ls, grep, find, etc.)")
    );
    assert_eq!(
        tool.prompt_guidelines(),
        Some(
            ["You can inspect PI_* environment variables for current model and session details."
                .to_string()]
            .as_slice()
        )
    );
}

#[test]
fn edit_declaration_matches_the_original() {
    let tool = create_edit_tool(&context());
    let (name, description, parameters) = declaration(&tool);
    assert_eq!(name, "edit");
    assert_eq!(
        description,
        "Edit a single file using exact text replacement. Every edits[].oldText must match a \
         unique, non-overlapping region of the original file. If two changes affect the same \
         block or nearby lines, merge them into one edit instead of emitting overlapping edits. \
         Do not include large unchanged regions just to connect distant changes."
    );
    assert_eq!(
        parameters,
        serde_json::json!({
            "type": "object",
            "required": ["path", "edits"],
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to the file to edit (relative or absolute)"
                },
                "edits": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["oldText", "newText"],
                        "properties": {
                            "oldText": {
                                "type": "string",
                                "description": "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call."
                            },
                            "newText": {
                                "type": "string",
                                "description": "Replacement text for this targeted edit."
                            }
                        }
                    },
                    "description": "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead."
                }
            }
        })
    );
    assert_eq!(
        tool.prompt_snippet(),
        Some("Make precise file edits with exact text replacement, including multiple disjoint edits in one call")
    );
}

#[test]
fn write_declaration_matches_the_original() {
    let tool = create_write_tool(&context());
    let (name, description, parameters) = declaration(&tool);
    assert_eq!(name, "write");
    assert_eq!(
        description,
        "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. \
         Automatically creates parent directories."
    );
    assert_eq!(
        parameters,
        serde_json::json!({
            "type": "object",
            "required": ["path", "content"],
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to the file to write (relative or absolute)"
                },
                "content": {
                    "type": "string",
                    "description": "Content to write to the file"
                }
            }
        })
    );
    assert_eq!(tool.prompt_snippet(), Some("Create or overwrite files"));
    assert_eq!(
        tool.prompt_guidelines(),
        Some(["Use write only for new files or complete rewrites.".to_string()].as_slice())
    );
}

#[test]
fn grep_declaration_matches_the_original() {
    let tool = create_grep_tool(&context(), None);
    let (name, description, parameters) = declaration(&tool);
    assert_eq!(name, "grep");
    assert_eq!(
        description,
        "Search file contents for a pattern. Returns matching lines with file paths and line \
         numbers. Respects .gitignore. Output is truncated to 100 matches or 50KB (whichever is \
         hit first). Long lines are truncated to 500 chars."
    );
    assert_eq!(
        parameters,
        serde_json::json!({
            "type": "object",
            "required": ["pattern"],
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Search pattern (regex or literal string)"
                },
                "path": {
                    "type": "string",
                    "description": "Directory or file to search (default: current directory)"
                },
                "glob": {
                    "type": "string",
                    "description": "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'"
                },
                "ignoreCase": {
                    "type": "boolean",
                    "description": "Case-insensitive search (default: false)"
                },
                "literal": {
                    "type": "boolean",
                    "description": "Treat pattern as literal string instead of regex (default: false)"
                },
                "context": {
                    "type": "number",
                    "description": "Number of lines to show before and after each match (default: 0)"
                },
                "limit": {
                    "type": "number",
                    "description": "Maximum number of matches to return (default: 100)"
                }
            }
        })
    );
    assert_eq!(
        tool.prompt_snippet(),
        Some("Search file contents for patterns (respects .gitignore)")
    );
}

#[test]
fn find_declaration_matches_the_original() {
    let tool = create_find_tool(&context(), None);
    let (name, description, parameters) = declaration(&tool);
    assert_eq!(name, "find");
    assert_eq!(
        description,
        "Search for files by glob pattern. Returns matching file paths relative to the search \
         directory. Respects .gitignore. Output is truncated to 1000 results or 50KB (whichever \
         is hit first)."
    );
    assert_eq!(
        parameters,
        serde_json::json!({
            "type": "object",
            "required": ["pattern"],
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'"
                },
                "path": {
                    "type": "string",
                    "description": "Directory to search in (default: current directory)"
                },
                "limit": {
                    "type": "number",
                    "description": "Maximum number of results (default: 1000)"
                }
            }
        })
    );
    assert_eq!(
        tool.prompt_snippet(),
        Some("Find files by glob pattern (respects .gitignore)")
    );
}

#[test]
fn ls_declaration_matches_the_original() {
    let tool = create_ls_tool(&context(), None);
    let (name, description, parameters) = declaration(&tool);
    assert_eq!(name, "ls");
    assert_eq!(
        description,
        "List directory contents. Returns entries sorted alphabetically, with '/' suffix for \
         directories. Includes dotfiles. Output is truncated to 500 entries or 50KB (whichever is \
         hit first)."
    );
    assert_eq!(
        parameters,
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Directory to list (default: current directory)"
                },
                "limit": {
                    "type": "number",
                    "description": "Maximum number of entries to return (default: 500)"
                }
            }
        })
    );
    assert_eq!(tool.prompt_snippet(), Some("List directory contents"));
}

#[test]
fn powershell_declaration_matches_the_original() {
    let tool = create_powershell_tool(&context());
    let (name, description, parameters) = declaration(&tool);
    assert_eq!(name, "powershell");
    assert_eq!(
        description,
        "Execute a PowerShell command in the current working directory. Returns stdout and \
         stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first). If \
         truncated, full output is saved to a temp file. Optionally provide a timeout in seconds."
    );
    assert_eq!(
        parameters,
        serde_json::json!({
            "type": "object",
            "required": ["command"],
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Shell command to execute"
                },
                "timeout": {
                    "type": "number",
                    "description": "Timeout in seconds (optional, no default timeout)"
                }
            }
        })
    );
    assert_eq!(tool.prompt_snippet(), Some("Execute PowerShell commands"));
    assert_eq!(
        tool.prompt_guidelines(),
        Some(
            ["You can inspect PI_* environment variables for current model and session details."
                .to_string()]
            .as_slice()
        )
    );
}
