/**
 * Presentation for the find tool.
 */

import type { ToolDefinition, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent/core/extensions/types";
import type { FindToolDetails } from "@earendil-works/pi-coding-agent/core/tools/find";
import { getTextOutput, invalidArgText, shortenPath, str } from "@earendil-works/pi-support/render-utils";
import { DEFAULT_MAX_BYTES, formatSize } from "@earendil-works/pi-support/truncate";
import { Text } from "@earendil-works/pi-tui/components/text";
import { theme } from "../../client-theme.ts";
import { keyHint } from "../keybinding-hints.ts";

function formatFindCall(args: { pattern: string; path?: string; limit?: number } | undefined): string {
	const pattern = str(args?.pattern);
	const rawPath = str(args?.path);
	const path = rawPath !== null ? shortenPath(rawPath || ".") : null;
	const limit = args?.limit;
	const invalidArg = invalidArgText(theme);
	let text =
		theme.fg("toolTitle", theme.bold("find")) +
		" " +
		(pattern === null ? invalidArg : theme.fg("accent", pattern || "")) +
		theme.fg("toolOutput", ` in ${path === null ? invalidArg : path}`);
	if (limit !== undefined) {
		text += theme.fg("toolOutput", ` (limit ${limit})`);
	}
	return text;
}
function formatFindResult(
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: FindToolDetails;
	},
	options: ToolRenderResultOptions,
	showImages: boolean,
): string {
	const output = getTextOutput(result, showImages).trim();
	let text = "";
	if (output) {
		const lines = output.split("\n");
		const maxLines = options.expanded ? lines.length : 20;
		const displayLines = lines.slice(0, maxLines);
		const remaining = lines.length - maxLines;
		text += `\n${displayLines.map((line) => theme.fg("toolOutput", line)).join("\n")}`;
		if (remaining > 0) {
			text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
		}
	}

	const resultLimit = result.details?.resultLimitReached;
	const truncation = result.details?.truncation;
	if (resultLimit || truncation?.truncated) {
		const warnings: string[] = [];
		if (resultLimit) warnings.push(`${resultLimit} results limit`);
		if (truncation?.truncated) warnings.push(`${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
		text += `\n${theme.fg("warning", `[Truncated: ${warnings.join(", ")}]`)}`;
	}
	return text;
}

export const findRenderers: Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> = {
	renderCall(args, _theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(formatFindCall(args as any));
		return text;
	},
	renderResult(result, options, _theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(formatFindResult(result as any, options, context.showImages));
		return text;
	},
};
