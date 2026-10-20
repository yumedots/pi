import { APP_NAME } from "../config.ts";
import type { SourceInfo } from "./source-info.ts";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	sourceInfo: SourceInfo;
}

export interface BuiltinSlashCommand {
	name: string;
	description: string;
	argumentHint?: string;
	/** Other names the command answers to, e.g. "history" for "/resume". */
	aliases?: readonly string[];
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "settings", description: "Open settings menu" },
	{ name: "model", description: "Select model (opens selector UI)", argumentHint: "<provider/model>" },
	{ name: "tree", description: "Navigate session tree (switch branches)" },
	{ name: "thinking", description: "Set thinking level", argumentHint: "<level>" },
	{ name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
	{ name: "skills", description: "Browse and run a skill" },
	{ name: "theme", description: "Change the color theme", argumentHint: "<name>" },
	{ name: "export", description: "Export session (HTML default, or specify path: .html/.jsonl)" },
	{ name: "import", description: "Import and resume a session from a JSONL file" },
	{ name: "share", description: "Share session via a Radius artifact or a GitHub gist" },
	{ name: "bug", description: "Report a bug to the Pi developers", argumentHint: "<description>" },
	{ name: "copy", description: "Copy last agent message to clipboard" },
	{ name: "name", description: "Set session display name" },
	{ name: "stats", description: "Show session info and stats" },
	{ name: "changelog", description: "Show changelog entries" },
	{ name: "hotkeys", description: "Show all keyboard shortcuts" },
	{ name: "fork", description: "Create a new fork from a previous user message" },
	{ name: "clone", description: "Duplicate the current session at the current position" },
	{ name: "trust", description: "Save project trust decision for future sessions" },
	{ name: "login", description: "Configure provider authentication", argumentHint: "<provider>" },
	{ name: "logout", description: "Remove provider authentication" },
	{ name: "new", description: "Start a new session" },
	{ name: "compact", description: "Manually compact the session context" },
	{ name: "resume", description: "Resume a different session", aliases: ["history", "sessions"] },
	{ name: "reload", description: "Reload keybindings, extensions, skills, prompts, themes, and context files" },
	{ name: "quit", description: `Quit ${APP_NAME}` },
];

/**
 * Map an alias to the command it points at, e.g. "/history" to "/resume".
 *
 * Only a bare command name is rewritten, so a message that starts with an alias
 * and continues with text is left alone.
 */
export function resolveBuiltinSlashAlias(text: string): string {
	const match = /^\/([^\s/]+)$/.exec(text);
	if (!match) return text;
	const name = match[1]!;
	const command = BUILTIN_SLASH_COMMANDS.find((candidate) => candidate.aliases?.includes(name));
	return command ? `/${command.name}` : text;
}
