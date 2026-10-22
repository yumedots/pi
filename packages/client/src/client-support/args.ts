/**
 * The command line of the client.
 *
 * The client is a renderer: it starts the interactive terminal UI and drives a pi server
 * over HTTP. The flags it parses are the ones that shape the session it opens; the
 * runtime modes of the coding agent belong to the server.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { TuiMode } from "../client-settings.ts";
import { APP_NAME, CONFIG_DIR_NAME, ENV_AGENT_DIR, ENV_SESSION_DIR } from "./config.ts";
import { detectSupportedImageMimeTypeFromFile } from "./mime.ts";
import { stripBom } from "./text.ts";

/** The output mode of a run. */
export type Mode = "text" | "json" | "rpc";

/** The parsed command line. */
export interface Args {
	provider?: string;
	model?: string;
	apiKey?: string;
	systemPrompt?: string;
	appendSystemPrompt?: string[];
	thinking?: ThinkingLevel;
	continue?: boolean;
	resume?: boolean;
	help?: boolean;
	version?: boolean;
	mode?: Mode;
	name?: string;
	noSession?: boolean;
	session?: string;
	sessionId?: string;
	fork?: string;
	sessionDir?: string;
	models?: string[];
	tools?: string[];
	excludeTools?: string[];
	noTools?: boolean;
	noBuiltinTools?: boolean;
	extensions?: string[];
	noExtensions?: boolean;
	noMcp?: boolean;
	print?: boolean;
	export?: string;
	noSkills?: boolean;
	skills?: string[];
	promptTemplates?: string[];
	noPromptTemplates?: boolean;
	themes?: string[];
	useTheme?: string;
	noThemes?: boolean;
	noContextFiles?: boolean;
	listModels?: string | true;
	offline?: boolean;
	tuiMode?: TuiMode;
	verbose?: boolean;
	projectTrustOverride?: boolean;
	messages: string[];
	fileArgs: string[];
	/** Unknown flags (potentially extension flags) - map of flag name to value */
	unknownFlags: Map<string, boolean | string>;
	diagnostics: Array<{ type: "warning" | "error"; message: string }>;
}

const VALID_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Whether a string names a thinking level. */
export function isValidThinkingLevel(level: string): level is ThinkingLevel {
	return VALID_THINKING_LEVELS.includes(level as ThinkingLevel);
}

/** The name of a session, or nothing when the name is empty. */
export function normalizeSessionName(value: string): string | undefined {
	const name = value.trim();
	return name.length > 0 ? name : undefined;
}

/** Whether a tool entry changes the default selection instead of naming a tool. */
function isToolModifier(entry: unknown): boolean {
	return typeof entry === "string" && (entry.startsWith("+") || entry.startsWith("-"));
}

/**
 * The problem of a tool list, or nothing when the list is fine.
 *
 * @returns The problem of the list, or `undefined` when it is valid.
 */
function getToolListError(entries: readonly string[]): string | undefined {
	const modifiers = entries.filter(isToolModifier);
	if (modifiers.length === 0) return undefined;
	if (modifiers.length !== entries.length) return "tool names cannot be mixed with +name or -name entries";
	const pattern = entries.find((entry) => entry.includes("*"));
	if (pattern) return `+name and -name entries take exact tool names, not patterns: ${pattern}`;
	return undefined;
}

/**
 * Parse the command line of the client.
 *
 * The flags the client does not act on are still parsed, so that the command line of the
 * client stays the command line the coding agent accepts.
 */
export function parseArgs(args: string[]): Args {
	const result: Args = {
		messages: [],
		fileArgs: [],
		unknownFlags: new Map(),
		diagnostics: [],
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--") {
			for (const positionalArg of args.slice(i + 1)) {
				if (positionalArg.startsWith("@")) {
					result.fileArgs.push(positionalArg.slice(1));
				} else {
					result.messages.push(positionalArg);
				}
			}
			break;
		} else if (arg === "--help" || arg === "-h") {
			result.help = true;
		} else if (arg === "--version" || arg === "-v") {
			result.version = true;
		} else if (arg === "--mode") {
			const mode = args[i + 1];
			if (mode === undefined || mode.startsWith("-")) {
				result.diagnostics.push({ type: "error", message: "--mode requires text, json, or rpc" });
				continue;
			}
			i++;
			if (mode !== "text" && mode !== "json" && mode !== "rpc") {
				result.diagnostics.push({
					type: "error",
					message: `Invalid mode "${mode}". Valid values: text, json, rpc`,
				});
				continue;
			}
			result.mode = mode;
		} else if (arg === "--continue" || arg === "-c") {
			result.continue = true;
		} else if (arg === "--resume" || arg === "-r") {
			result.resume = true;
		} else if (arg === "--provider" && i + 1 < args.length) {
			result.provider = args[++i];
		} else if (arg === "--model" && i + 1 < args.length) {
			result.model = args[++i];
		} else if (arg === "--api-key" && i + 1 < args.length) {
			result.apiKey = args[++i];
		} else if (arg === "--system-prompt" && i + 1 < args.length) {
			result.systemPrompt = args[++i];
		} else if (arg === "--append-system-prompt" && i + 1 < args.length) {
			result.appendSystemPrompt = result.appendSystemPrompt ?? [];
			result.appendSystemPrompt.push(args[++i]);
		} else if (arg === "--name" || arg === "-n") {
			if (i + 1 < args.length) {
				result.name = args[++i];
			} else {
				result.diagnostics.push({ type: "error", message: "--name requires a value" });
			}
		} else if (arg === "--no-session") {
			result.noSession = true;
		} else if (arg === "--session" && i + 1 < args.length) {
			result.session = args[++i];
		} else if (arg === "--session-id" && i + 1 < args.length) {
			result.sessionId = args[++i];
		} else if (arg === "--fork" && i + 1 < args.length) {
			result.fork = args[++i];
		} else if (arg === "--session-dir" && i + 1 < args.length) {
			result.sessionDir = args[++i];
		} else if (arg === "--models" && i + 1 < args.length) {
			result.models = args[++i]
				.split(",")
				.map((s) => s.trim())
				.filter((pattern) => pattern.length > 0);
		} else if (arg === "--no-tools" || arg === "-nt") {
			result.noTools = true;
		} else if (arg === "--no-builtin-tools" || arg === "-nbt") {
			result.noBuiltinTools = true;
		} else if ((arg === "--tools" || arg === "-t") && i + 1 < args.length) {
			const tools = args[++i]
				.split(",")
				.map((s) => s.trim())
				.filter((name) => name.length > 0);
			const error = getToolListError(tools);
			if (error) {
				result.diagnostics.push({ type: "error", message: `${arg}: ${error}` });
			} else {
				result.tools = tools;
			}
		} else if ((arg === "--exclude-tools" || arg === "-xt") && i + 1 < args.length) {
			result.excludeTools = args[++i]
				.split(",")
				.map((s) => s.trim())
				.filter((name) => name.length > 0);
		} else if (arg === "--thinking" && i + 1 < args.length) {
			const level = args[++i];
			if (isValidThinkingLevel(level)) {
				result.thinking = level;
			} else {
				result.diagnostics.push({
					type: "warning",
					message: `Invalid thinking level "${level}". Valid values: ${VALID_THINKING_LEVELS.join(", ")}`,
				});
			}
		} else if (arg === "--print" || arg === "-p") {
			result.print = true;
			const next = args[i + 1];
			if (next !== undefined && !next.startsWith("@") && (!next.startsWith("-") || next.startsWith("---"))) {
				result.messages.push(next);
				i++;
			}
		} else if (arg === "--export" && i + 1 < args.length) {
			result.export = args[++i];
		} else if ((arg === "--extension" || arg === "-e") && i + 1 < args.length) {
			result.extensions = result.extensions ?? [];
			result.extensions.push(args[++i]);
		} else if (arg === "--no-extensions" || arg === "-ne") {
			result.noExtensions = true;
		} else if (arg === "--no-mcp") {
			result.noMcp = true;
		} else if (arg === "--skill" && i + 1 < args.length) {
			result.skills = result.skills ?? [];
			result.skills.push(args[++i]);
		} else if (arg === "--prompt-template" && i + 1 < args.length) {
			result.promptTemplates = result.promptTemplates ?? [];
			result.promptTemplates.push(args[++i]);
		} else if (arg === "--theme" && i + 1 < args.length) {
			result.themes = result.themes ?? [];
			result.themes.push(args[++i]);
		} else if (arg === "--use-theme") {
			const themeName = args[i + 1];
			if (themeName === undefined || themeName.startsWith("-")) {
				result.diagnostics.push({ type: "error", message: "--use-theme requires a theme name" });
			} else {
				result.useTheme = themeName;
				i++;
			}
		} else if (arg === "--no-skills" || arg === "-ns") {
			result.noSkills = true;
		} else if (arg === "--no-prompt-templates" || arg === "-np") {
			result.noPromptTemplates = true;
		} else if (arg === "--no-themes") {
			result.noThemes = true;
		} else if (arg === "--no-context-files" || arg === "-nc") {
			result.noContextFiles = true;
		} else if (arg === "--list-models") {
			if (i + 1 < args.length && !args[i + 1].startsWith("-") && !args[i + 1].startsWith("@")) {
				result.listModels = args[++i];
			} else {
				result.listModels = true;
			}
		} else if (arg === "--tui-mode") {
			const mode = args[i + 1];
			if (mode === "regular" || mode === "fullscreen") {
				result.tuiMode = mode;
				i++;
			} else if (mode === undefined || mode.startsWith("-")) {
				result.diagnostics.push({ type: "error", message: "--tui-mode requires regular or fullscreen" });
			} else {
				i++;
				result.diagnostics.push({
					type: "error",
					message: `Invalid TUI mode "${mode}". Valid values: regular, fullscreen`,
				});
			}
		} else if (arg === "--verbose") {
			result.verbose = true;
		} else if (arg === "--approve" || arg === "-a") {
			result.projectTrustOverride = true;
		} else if (arg === "--no-approve" || arg === "-na") {
			result.projectTrustOverride = false;
		} else if (arg === "--offline") {
			result.offline = true;
		} else if (arg.startsWith("@")) {
			result.fileArgs.push(arg.slice(1));
		} else if (arg.startsWith("--")) {
			const eqIndex = arg.indexOf("=");
			if (eqIndex !== -1) {
				result.unknownFlags.set(arg.slice(2, eqIndex), arg.slice(eqIndex + 1));
			} else {
				const flagName = arg.slice(2);
				const next = args[i + 1];
				if (next !== undefined && !next.startsWith("-") && !next.startsWith("@")) {
					result.unknownFlags.set(flagName, next);
					i++;
				} else {
					result.unknownFlags.set(flagName, true);
				}
			}
		} else if (arg.startsWith("-") && !arg.startsWith("--")) {
			result.diagnostics.push({ type: "error", message: `Unknown option: ${arg}` });
		} else if (!arg.startsWith("-")) {
			result.messages.push(arg);
		}
	}

	return result;
}

/** The usage of the client. */
export function printHelp(): void {
	console.log(`${APP_NAME} - the terminal UI of the pi coding agent

Usage:
  ${APP_NAME} [options] [--] [@files...] [messages...]

Options:
  --provider <name>              Provider to search for --model
  --model <pattern>              Model pattern or ID (supports "provider/id")
  --thinking <level>             Set thinking level: off, minimal, low, medium, high, xhigh, max
  --name, -n <name>              Set session display name
  --session <path|id>            Use a specific session file or id
  --session-dir <dir>            Directory for session storage and lookup
  --continue, -c                 Continue the most recent session
  --resume, -r                   Pick a session to resume
  --use-theme <name[/name]>      Set the initial interactive theme for this run
  --tui-mode <mode>              TUI mode: fullscreen (default) or regular
  --verbose                      Force verbose startup (overrides quietStartup setting)
  --offline                      Disable startup network operations (same as PI_OFFLINE=1)
  --                             End option parsing; treat remaining arguments as messages/files
  --help, -h                     Show this help
  --version, -v                  Show version number

The runtime modes of the coding agent belong to the server: the client draws the
terminal UI of a session.

Environment Variables:
  ${ENV_AGENT_DIR.padEnd(32)} - Config directory (default: ~/${CONFIG_DIR_NAME}/agent)
  ${ENV_SESSION_DIR.padEnd(32)} - Session storage directory (overridden by --session-dir)
  PI_OFFLINE                       - Disable startup network operations when set to 1/true/yes
`);
}

/** The initial message of a session. */
export interface InitialMessageResult {
	/** The text of the first message. */
	initialMessage?: string;
	/** The images that go with it. */
	initialImages?: ImageContent[];
}

/**
 * Combine the text of the @file arguments and the first message into the initial prompt.
 */
export function buildInitialMessage(input: {
	parsed: Args;
	fileText?: string;
	fileImages?: ImageContent[];
}): InitialMessageResult {
	const parts: string[] = [];
	if (input.fileText) {
		parts.push(input.fileText);
	}

	if (input.parsed.messages.length > 0) {
		parts.push(input.parsed.messages[0]);
		input.parsed.messages.shift();
	}

	return {
		initialMessage: parts.length > 0 ? parts.join("") : undefined,
		initialImages: input.fileImages && input.fileImages.length > 0 ? input.fileImages : undefined,
	};
}

/**
 * Read the files of the @file arguments.
 *
 * A file that is an image goes with the message as an image, every other file goes with
 * it as text.
 */
export async function readFileArguments(fileArgs: readonly string[]): Promise<{
	text: string;
	images: ImageContent[];
}> {
	let text = "";
	const images: ImageContent[] = [];

	for (const fileArg of fileArgs) {
		const path = resolve(fileArg);
		let content: Buffer;
		try {
			content = await readFile(path);
		} catch {
			throw new Error(`File not found: ${path}`);
		}
		if (content.length === 0) continue;

		const mimeType = await detectSupportedImageMimeTypeFromFile(path);
		if (mimeType) {
			images.push({ type: "image", mimeType, data: content.toString("base64") });
			text += `<file name="${path}"></file>\n`;
			continue;
		}
		text += `<file name="${path}">\n${stripBom(content.toString("utf-8"))}\n</file>\n`;
	}

	return { text, images };
}
