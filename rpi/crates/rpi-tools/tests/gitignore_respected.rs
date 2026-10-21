//! The `.gitignore` handling of the read-only search tools.
//!
//! pi's `grep` shells out to ripgrep and its `find` to fd, and both honour the
//! ignore files of the repository they walk. The port walks in-process, so it
//! has to apply the same rules: an ignored path is left out of the result,
//! and outside a repository the ignore files do not count.

use std::sync::Arc;

use rpi_agent::agent_tool::AgentTool;
use rpi_agent::types::TextContentOrImage;
use rpi_tools::{ExecutionToolContext, FileSystem, InMemoryExecutionEnv};
use tokio_util::sync::CancellationToken;

fn fresh_context() -> (Arc<InMemoryExecutionEnv>, ExecutionToolContext) {
    let env = Arc::new(InMemoryExecutionEnv::with_cwd("/tmp/work".into()));
    let env_dyn: Arc<dyn rpi_tools::ExecutionEnv> = env.clone();
    let mut_env: Arc<dyn rpi_tools::MutatingEnv> = env.clone();
    let ctx = ExecutionToolContext::new(env_dyn, Some(mut_env));
    (env, ctx)
}

async fn seed(env: &Arc<InMemoryExecutionEnv>, rel: &str, content: &str) {
    let abs = env
        .absolute_path(rel, None)
        .await
        .expect("absolute_path for seed");
    env.write_file(&abs.to_string_lossy(), content.to_string().into(), None)
        .await
        .expect("write_file for seed");
}

async fn run(
    tool: Arc<dyn AgentTool>,
    params: serde_json::Value,
) -> Result<rpi_agent::types::AgentToolResult, rpi_agent::error::AgentError> {
    let signal = CancellationToken::new();
    let on_update = Arc::new(|_p| ());
    tool.execute("tool-1", params, signal, on_update).await
}

fn text_output(result: &rpi_agent::types::AgentToolResult) -> String {
    result
        .content
        .iter()
        .filter_map(|c| match c {
            TextContentOrImage::Text(t) => Some(t.text.clone()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// A repository with one ignored file and one kept file.
async fn repo_with_ignore_file(env: &Arc<InMemoryExecutionEnv>) {
    env.create_dir("/tmp/work/.git", true, None)
        .await
        .expect("create .git");
    seed(&env, ".gitignore", "ignored.txt\n").await;
    seed(&env, "ignored.txt", "needle in an ignored file\n").await;
    seed(&env, "kept.txt", "needle in a kept file\n").await;
}

#[tokio::test]
async fn grep_leaves_out_the_files_the_ignore_file_excludes() {
    let (env, ctx) = fresh_context();
    repo_with_ignore_file(&env).await;

    let tool = rpi_tools::create_grep_tool(&ctx, None);
    let out = text_output(
        &run(tool, serde_json::json!({ "pattern": "needle", "path": "." }))
            .await
            .expect("grep ok"),
    );
    assert!(out.contains("kept.txt"), "got: {out}");
    assert!(!out.contains("ignored.txt"), "got: {out}");
}

#[tokio::test]
async fn find_leaves_out_the_files_the_ignore_file_excludes() {
    let (env, ctx) = fresh_context();
    repo_with_ignore_file(&env).await;

    let tool = rpi_tools::create_find_tool(&ctx, None);
    let out = text_output(
        &run(tool, serde_json::json!({ "pattern": "*.txt", "path": "." }))
            .await
            .expect("find ok"),
    );
    assert!(out.contains("kept.txt"), "got: {out}");
    assert!(!out.contains("ignored.txt"), "got: {out}");
}

#[tokio::test]
async fn the_ignore_files_do_not_count_outside_a_repository() {
    let (env, ctx) = fresh_context();
    seed(&env, ".gitignore", "ignored.txt\n").await;
    seed(&env, "ignored.txt", "needle in an ignored file\n").await;
    seed(&env, "kept.txt", "needle in a kept file\n").await;

    let tool = rpi_tools::create_grep_tool(&ctx, None);
    let out = text_output(
        &run(tool, serde_json::json!({ "pattern": "needle", "path": "." }))
            .await
            .expect("grep ok"),
    );
    assert!(out.contains("ignored.txt"), "got: {out}");
    assert!(out.contains("kept.txt"), "got: {out}");
}

#[tokio::test]
async fn an_ignore_file_in_a_subdirectory_applies_to_that_subtree() {
    let (env, ctx) = fresh_context();
    env.create_dir("/tmp/work/.git", true, None)
        .await
        .expect("create .git");
    env.create_dir("/tmp/work/sub", true, None)
        .await
        .expect("create sub");
    seed(&env, ".gitignore", "*.log\n").await;
    seed(&env, "sub/.gitignore", "local.txt\n").await;
    seed(&env, "sub/local.txt", "needle in a local file\n").await;
    seed(&env, "sub/other.txt", "needle in another file\n").await;
    seed(&env, "top.log", "needle in a log file\n").await;

    let tool = rpi_tools::create_grep_tool(&ctx, None);
    let out = text_output(
        &run(tool, serde_json::json!({ "pattern": "needle", "path": "." }))
            .await
            .expect("grep ok"),
    );
    assert!(out.contains("sub/other.txt"), "got: {out}");
    assert!(!out.contains("sub/local.txt"), "got: {out}");
    assert!(!out.contains("top.log"), "got: {out}");
}
