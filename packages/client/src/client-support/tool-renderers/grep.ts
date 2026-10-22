/**
 * Presentation for the grep tool.
 */

import type { ToolDefinition, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent/core/extensions/types";
import type { GrepToolDetails } from "@earendil-works/pi-coding-agent/core/tools/grep";
import { getTextOutput, invalidArgText, shortenPath, str } from "@earendil-works/pi-support/render-utils";
import { DEFAULT_MAX_BYTES, formatSize } from "@earendil-works/pi-support/truncate";
import { Text } from "@earendil-works/pi-tui/components/text";
import { theme } from "../../client-theme.ts";
import { keyHint } from "../keybinding-hints.ts";

function formatGrepCall(args: { pattern: string; path?: string; glob?: string; limit?: number } | undefined): string {
	const pattern = str(args?.pattern);
	const rawPath = str(args?.path);
	const path = rawPath !== null ? shortenPath(rawPath || ".") : null;
	const glob = str(args?.glob);
	const limit = args?.limit;
	const invalidArg = invalidArgText(theme);
	let text =
		theme.fg("toolTitle", theme.bold("grep")) +
		" " +
		(pattern === null ? invalidArg : theme.fg("accent", `/${pattern || ""}/`)) +
		theme.fg("toolOutput", ` in ${path === null ? invalidArg : path}`);
	if (glob) text += theme.fg("toolOutput", ` (${glob})`);
	if (limit !== undefined) text += theme.fg("toolOutput", ` limit ${limit}`);
	return text;
}
function formatGrepResult(
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: GrepToolDetails;
	},
	options: ToolRenderResultOptions,
	showImages: boolean,
): string {
	const output = getTextOutput(result, showImages).trim();
	let text = "";
	if (output) {
		const lines = output.split("\n");
		const maxLines = options.expanded ? lines.length : 15;
		const displayLines = lines.slice(0, maxLines);
		const remaining = lines.length - maxLines;
		text += `\n${displayLines.map((line) => theme.fg("toolOutput", line)).join("\n")}`;
		if (remaining > 0) {
			text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
		}
	}

	const matchLimit = result.details?.matchLimitReached;
	const truncation = result.details?.truncation;
	const linesTruncated = result.details?.linesTruncated;
	if (matchLimit || truncation?.truncated || linesTruncated) {
		const warnings: string[] = [];
		if (matchLimit) warnings.push(`${matchLimit} matches limit`);
		if (truncation?.truncated) warnings.push(`${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
		if (linesTruncated) warnings.push("some lines truncated");
		text += `\n${theme.fg("warning", `[Truncated: ${warnings.join(", ")}]`)}`;
	}
	return text;
}

export const grepRenderers: Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> = {
	renderCall(args, _theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(formatGrepCall(args as any));
		return text;
	},
	renderResult(result, options, _theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(formatGrepResult(result as any, options, context.showImages));
		return text;
	},
};
