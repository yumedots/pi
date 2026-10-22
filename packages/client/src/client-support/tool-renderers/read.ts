/**
 * Presentation for the read tool.
 *
 * The client does not carry a syntax highlighter: the code it shows is drawn in the color of
 * the tool output. The server draws the highlighted code of the rows it renders.
 */

import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { ToolDefinition, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent/core/extensions/types";
import type { ReadToolDetails } from "@earendil-works/pi-coding-agent/core/tools/read";
import { formatPathRelativeToCwdOrAbsolute, resolvePath } from "@earendil-works/pi-support/paths";
import {
	formatReadLineRange,
	getTextOutput,
	renderToolPath,
	replaceTabs,
	str,
} from "@earendil-works/pi-support/render-utils";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@earendil-works/pi-support/truncate";
import { Text } from "@earendil-works/pi-tui/components/text";
import { theme } from "../../client-theme.ts";
import { getReadmePath } from "../config.ts";
import { keyHint, keyText } from "../keybinding-hints.ts";

interface CompactReadClassification {
	kind: "docs" | "resource" | "skill";
	label: string;
}
const COMPACT_RESOURCE_FILE_NAMES = new Set(["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]);
type ReadRenderArgs = { path?: string; file_path?: string; offset?: unknown; limit?: unknown };
function styledReadLineRange(args: ReadRenderArgs | undefined): string {
	const range = formatReadLineRange(args?.offset, args?.limit);
	return range ? theme.fg("warning", range) : "";
}
function formatReadCall(args: ReadRenderArgs | undefined, cwd: string): string {
	const pathDisplay = renderToolPath(str(args?.file_path ?? args?.path), theme, cwd);
	return `${theme.fg("toolTitle", theme.bold("read"))} ${pathDisplay}${styledReadLineRange(args)}`;
}
function trimTrailingEmptyLines(lines: string[]): string[] {
	let end = lines.length;
	while (end > 0 && lines[end - 1] === "") {
		end--;
	}
	return lines.slice(0, end);
}
function toPosixPath(filePath: string): string {
	return filePath.split(sep).join("/");
}
function resolveToCwd(filePath: string, cwd: string): string {
	return resolvePath(filePath, cwd, { normalizeUnicodeSpaces: true, stripAtPrefix: true });
}
function getPiDocsClassification(absolutePath: string): CompactReadClassification | undefined {
	const packageRoot = dirname(getReadmePath());
	const relativePath = relative(resolve(packageRoot), resolve(absolutePath));
	if (
		relativePath === "" ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		return undefined;
	}

	const label = toPosixPath(relativePath);
	if (label === "README.md" || label.startsWith("docs/") || label.startsWith("examples/")) {
		return { kind: "docs", label };
	}
	return undefined;
}
function getCompactReadClassification(
	args: ReadRenderArgs | undefined,
	cwd: string,
): CompactReadClassification | undefined {
	const rawPath = str(args?.file_path ?? args?.path);
	if (!rawPath) return undefined;

	const absolutePath = resolveToCwd(rawPath, cwd);
	const fileName = basename(absolutePath);
	if (fileName === "SKILL.md") {
		return { kind: "skill", label: basename(dirname(absolutePath)) || fileName };
	}

	const docsClassification = getPiDocsClassification(absolutePath);
	if (docsClassification) return docsClassification;

	if (COMPACT_RESOURCE_FILE_NAMES.has(fileName)) {
		return { kind: "resource", label: formatPathRelativeToCwdOrAbsolute(absolutePath, cwd) };
	}

	return undefined;
}
function formatCompactReadCall(classification: CompactReadClassification, args: ReadRenderArgs | undefined): string {
	const expandHint = theme.fg("dim", ` (${keyText("app.tools.expand")} to expand)`);
	if (classification.kind === "skill") {
		return (
			theme.fg("customMessageLabel", `\x1b[1m[skill]\x1b[22m `) +
			theme.fg("customMessageText", classification.label) +
			styledReadLineRange(args) +
			expandHint
		);
	}

	return (
		theme.fg("toolTitle", theme.bold(`read ${classification.kind}`)) +
		" " +
		theme.fg("accent", classification.label) +
		styledReadLineRange(args) +
		expandHint
	);
}
function formatReadResult(
	result: { content: (TextContent | ImageContent)[]; details?: ReadToolDetails },
	options: ToolRenderResultOptions,
	showImages: boolean,
	isError: boolean,
): string {
	if (!options.expanded && !isError) {
		return "";
	}

	const output = getTextOutput(result, showImages);
	const lines = trimTrailingEmptyLines(output.split("\n"));
	const maxLines = options.expanded ? lines.length : 10;
	const displayLines = lines.slice(0, maxLines);
	const remaining = lines.length - maxLines;
	let text = `\n${displayLines.map((line) => theme.fg("toolOutput", replaceTabs(line))).join("\n")}`;
	if (remaining > 0) {
		text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
	}

	const truncation = result.details?.truncation;
	if (truncation?.truncated) {
		if (truncation.firstLineExceedsLimit) {
			text += `\n${theme.fg("warning", `[First line exceeds ${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit]`)}`;
		} else if (truncation.truncatedBy === "lines") {
			text += `\n${theme.fg("warning", `[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${truncation.maxLines ?? DEFAULT_MAX_LINES} line limit)]`)}`;
		} else {
			text += `\n${theme.fg("warning", `[Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)]`)}`;
		}
	}
	return text;
}

export const readRenderers: Pick<ToolDefinition<any, ReadToolDetails | undefined>, "renderCall" | "renderResult"> = {
	renderCall(rawArgs, _theme, context) {
		const args = rawArgs as ReadRenderArgs | undefined;
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		const classification = !context.expanded ? getCompactReadClassification(args, context.cwd) : undefined;
		text.setText(classification ? formatCompactReadCall(classification, args) : formatReadCall(args, context.cwd));
		return text;
	},
	renderResult(result, options, _theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(formatReadResult(result, options, context.showImages, context.isError));
		return text;
	},
};
