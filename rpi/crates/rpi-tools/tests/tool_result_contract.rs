//! The tool-result contract of the built-in tools — mirrors the TS
//! `AgentToolResult` surface (`isError`, `structuredContent`, `outputSchema`)
//! and the per-tool system-prompt contributions
//! (`promptSnippet` / `promptGuidelines`).
//!
//! Cases:
//! - a bash run with a non-zero exit code is a soft failure: `Ok` with
//!   `is_error == true`, the text ends with "Command exited with code 3", and
//!   the `details` payload survives;
//! - a successful bash result carries a `structured_content` matching its
//!   `output_schema` (`output` / `truncated` / `exit_code` / `wall_time_seconds`);
//! - a successful read of a text file carries the file text as its
//!   `structured_content`;
//! - the seven built-in tools report their `prompt_snippet`, and read / edit /
//!   bash report their `prompt_guidelines`.

use std::sync::Arc;

use rpi_agent::agent_tool::AgentTool;
use rpi_agent::types::{AgentToolResult, TextContentOrImage};
use rpi_tools::{
    create_bash_tool, create_edit_tool, create_find_tool, create_grep_tool, create_ls_tool,
    create_read_tool, create_write_tool, ExecutionToolContext, FileSystem, InMemoryExecutionEnv,
    ShellScript, DEFAULT_MAX_LINES,
};
use tokio_util::sync::CancellationToken;

fn fresh_context() -> (Arc<InMemoryExecutionEnv>, ExecutionToolContext) {
    let env = Arc::new(InMemoryExecutionEnv::with_cwd("/tmp/work".into()));
    let env_dyn: Arc<dyn rpi_tools::ExecutionEnv> = env.clone();
    let mut_env: Arc<dyn rpi_tools::MutatingEnv> = env.clone();
    let ctx = ExecutionToolContext::new(env_dyn, Some(mut_env));
    (env, ctx)
}

async fn seed(env: &InMemoryExecutionEnv, rel: &str, bytes: Vec<u8>) {
    let abs = env
        .absolute_path(rel, None)
        .await
        .expect("absolute_path for seed");
    env.seed_file(&abs.to_string_lossy(), bytes).await;
}

async fn run(
    tool: Arc<dyn AgentTool>,
    params: serde_json::Value,
) -> Result<AgentToolResult, rpi_agent::error::AgentError> {
    let signal = CancellationToken::new();
    let on_update = Arc::new(|_p| ());
    tool.execute("tool-x", params, signal, on_update).await
}

fn text_output(r: &AgentToolResult) -> String {
    r.content
        .iter()
        .filter_map(|c| match c {
            TextContentOrImage::Text(t) => Some(t.text.clone()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[tokio::test]
async fn bash_nonzero_exit_is_a_soft_failure_that_keeps_details() {
    let (env, ctx) = fresh_context();
    env.register_shell(
        "boom",
        ShellScript {
            stdout: "hello".into(),
            stderr: String::new(),
            exit_code: 3,
            delay_ms: None,
        },
    )
    .await;
    let tool = create_bash_tool(&ctx, None);
    let result = run(tool, serde_json::json!({ "command": "boom" }))
        .await
        .expect("a non-zero exit is a soft failure, not a thrown error");

    assert!(result.is_error, "the result must be flagged as an error");
    let text = text_output(&result);
    assert!(text.contains("hello"), "{text}");
    assert!(
        text.ends_with("Command exited with code 3"),
        "the status is appended last: {text}"
    );
    assert!(
        result.details.is_object(),
        "the details payload survives a soft failure: {:?}",
        result.details
    );
}

#[tokio::test]
async fn bash_soft_failure_keeps_the_truncation_details() {
    let (env, ctx) = fresh_context();
    let lines: String = (0..(DEFAULT_MAX_LINES + 1))
        .map(|i| format!("line-{}", i + 1))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    env.register_shell(
        "big",
        ShellScript {
            stdout: lines,
            stderr: String::new(),
            exit_code: 3,
            delay_ms: None,
        },
    )
    .await;
    let tool = create_bash_tool(&ctx, None);
    let result = run(tool, serde_json::json!({ "command": "big" }))
        .await
        .expect("a non-zero exit is a soft failure");

    assert!(result.is_error);
    assert!(text_output(&result).ends_with("Command exited with code 3"));
    let truncation = result
        .details
        .get("truncation")
        .expect("the truncation details survive");
    assert_eq!(truncation["truncated"], true);
    assert_eq!(truncation["total_lines"], DEFAULT_MAX_LINES + 1);
    assert!(
        result.details.get("full_output_path").is_some(),
        "the full-output path survives: {:?}",
        result.details
    );
}

#[tokio::test]
async fn bash_success_carries_a_structured_content_matching_its_output_schema() {
    let (env, ctx) = fresh_context();
    env.register_shell("ok", ShellScript::success("all good")).await;
    let tool = create_bash_tool(&ctx, None);
    let result = run(tool.clone(), serde_json::json!({ "command": "ok" }))
        .await
        .expect("bash ok");

    assert!(!result.is_error);
    let structured = result
        .structured_content
        .expect("a successful bash result carries structured content");
    assert_eq!(structured["output"], "all good");
    assert_eq!(structured["truncated"], false);
    assert_eq!(structured["exit_code"], 0);
    assert!(
        structured["wall_time_seconds"].is_number(),
        "{structured}"
    );
    assert!(
        structured.get("full_output_path").is_none(),
        "the full-output path is only present when the output was truncated"
    );

    let schema = tool.output_schema().expect("bash declares an output schema");
    let required = schema
        .as_value()
        .get("required")
        .and_then(|v| v.as_array())
        .expect("the schema lists its required properties");
    for key in required {
        let key = key.as_str().expect("required entries are strings");
        assert!(
            structured.get(key).is_some(),
            "structured content is missing {key}: {structured}"
        );
    }
}

#[tokio::test]
async fn read_success_carries_the_file_text_as_structured_content() {
    let (env, ctx) = fresh_context();
    seed(&env, "note.txt", b"first line\nsecond line\n".to_vec()).await;
    let tool = create_read_tool(&ctx, None);
    let result = run(tool.clone(), serde_json::json!({ "path": "note.txt" }))
        .await
        .expect("read ok");

    assert!(!result.is_error);
    let structured = result
        .structured_content
        .expect("a successful read carries structured content");
    assert!(
        structured.is_string(),
        "a text file reads back as a string: {structured}"
    );
    assert_eq!(structured.as_str().unwrap(), "first line\nsecond line\n");
    assert!(tool.output_schema().is_some());
}

#[tokio::test]
#[cfg(unix)]
async fn bash_signal_killed_command_reports_128_plus_signal() {
    use rpi_tools::OsExecutionEnv;

    let tmp = tempfile::tempdir().expect("temp dir");
    let env = Arc::new(OsExecutionEnv::with_cwd(tmp.path().to_path_buf()));
    let env_dyn: Arc<dyn rpi_tools::ExecutionEnv> = env.clone();
    let ctx = ExecutionToolContext::new(env_dyn, None);
    let tool = create_bash_tool(&ctx, None);
    // The shell kills itself: it has no exit code, so the shell convention
    // (128 + signal) is what the caller sees — the original reports the same.
    let result = run(tool, serde_json::json!({ "command": "kill -9 $$" }))
        .await
        .expect("a signal-killed command is a result, not a thrown error");

    assert!(result.is_error, "a signal-killed command is a failure");
    let text = text_output(&result);
    let structured = result
        .structured_content
        .clone()
        .expect("the structured content carries the exit code");
    assert_eq!(structured["exit_code"], 137, "{structured}");
    assert!(
        text.ends_with("Command exited with code 137"),
        "{text}"
    );
}

#[tokio::test]
#[cfg(unix)]
async fn bash_timeout_reports_the_original_wording() {
    use rpi_agent::error::AgentError;
    use rpi_tools::OsExecutionEnv;

    let tmp = tempfile::tempdir().expect("temp dir");
    let env = Arc::new(OsExecutionEnv::with_cwd(tmp.path().to_path_buf()));
    let env_dyn: Arc<dyn rpi_tools::ExecutionEnv> = env.clone();
    let ctx = ExecutionToolContext::new(env_dyn, None);
    let tool = create_bash_tool(&ctx, None);
    let error = run(tool, serde_json::json!({ "command": "sleep 5", "timeout": 1 }))
        .await
        .expect_err("a timeout is a thrown error");
    let message = match error {
        AgentError::Tool(message) => message,
        other => panic!("expected a tool error, got {other:?}"),
    };
    assert!(
        message.contains("Command timed out after 1 seconds"),
        "{message}"
    );
}

#[tokio::test]
async fn every_builtin_tool_reports_its_prompt_contribution() {
    let (_env, ctx) = fresh_context();
    let cases: Vec<(
        Arc<dyn AgentTool>,
        &str,
        Option<&[&str]>,
    )> = vec![
        (
            create_read_tool(&ctx, None),
            "Read file contents",
            Some(&["Use read to examine files instead of cat or sed."]),
        ),
        (
            create_write_tool(&ctx),
            "Create or overwrite files",
            Some(&["Use write only for new files or complete rewrites."]),
        ),
        (
            create_edit_tool(&ctx),
            "Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
            Some(&[
                "Use edit for precise changes (edits[].oldText must match exactly)",
                "When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
                "Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
                "Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
            ]),
        ),
        (
            create_bash_tool(&ctx, None),
            "Execute bash commands (ls, grep, find, etc.)",
            Some(&[
                "You can inspect PI_* environment variables for current model and session details.",
            ]),
        ),
        (
            create_grep_tool(&ctx, None),
            "Search file contents for patterns (respects .gitignore)",
            Some(&[]),
        ),
        (
            create_find_tool(&ctx, None),
            "Find files by glob pattern (respects .gitignore)",
            Some(&[]),
        ),
        (
            create_ls_tool(&ctx, None),
            "List directory contents",
            Some(&[]),
        ),
    ];

    for (tool, snippet, guidelines) in cases {
        let name = tool.schema().name.clone();
        assert_eq!(
            tool.prompt_snippet(),
            Some(snippet),
            "{name} reports the wrong prompt snippet"
        );
        let reported = tool
            .prompt_guidelines()
            .unwrap_or_else(|| panic!("{name} must contribute guidelines"));
        let expected = guidelines.expect("guidelines expected for {name}");
        assert_eq!(
            reported.len(),
            expected.len(),
            "{name} reports the wrong number of guidelines"
        );
        for (got, want) in reported.iter().zip(expected.iter()) {
            assert_eq!(got, want, "{name} reports the wrong guideline");
        }
    }
}
