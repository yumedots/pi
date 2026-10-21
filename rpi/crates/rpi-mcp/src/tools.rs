use sha2::{Digest, Sha256};

pub const MAX_TOOL_NAME_LENGTH: usize = 64;

pub fn sanitize_tool_name(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect()
}

pub fn create_mcp_tool_name(
    server: &str,
    tool: &str,
    is_taken: impl Fn(&str) -> bool,
) -> String {
    let name = format!("mcp__{server}__{tool}");
    let name = sanitize_tool_name(&name);
    if name.len() <= MAX_TOOL_NAME_LENGTH && !is_taken(&name) {
        return name;
    }
    let hash = tool_hash(server, tool);
    let prefix_length = MAX_TOOL_NAME_LENGTH - hash.len() - 1;
    let mut prefix = name;
    prefix.truncate(prefix_length);
    format!("{prefix}_{hash}")
}

pub fn tool_hash(server: &str, tool: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(server.as_bytes());
    hasher.update([0]);
    hasher.update(tool.as_bytes());
    let digest = hasher.finalize();
    digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
        .chars()
        .take(8)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_short_name_is_kept() {
        assert_eq!(
            create_mcp_tool_name("docs", "search", |_| false),
            "mcp__docs__search"
        );
    }

    #[test]
    fn dashes_become_underscores() {
        assert_eq!(
            create_mcp_tool_name("my-server", "read-file", |_| false),
            "mcp__my_server__read_file"
        );
    }

    #[test]
    fn a_taken_name_gets_a_hash() {
        let name = create_mcp_tool_name("docs", "search", |candidate| candidate == "mcp__docs__search");
        assert_eq!(name, format!("mcp__docs__search_{}", tool_hash("docs", "search")));
        assert!(name.len() <= MAX_TOOL_NAME_LENGTH);
    }

    #[test]
    fn a_long_name_is_shortened() {
        let tool = "a".repeat(80);
        let name = create_mcp_tool_name("server", &tool, |_| false);
        assert_eq!(name.len(), MAX_TOOL_NAME_LENGTH);
    }
}
