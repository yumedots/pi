/**
 * Presentation for the ls tool.
 */

import type { ToolDefinition, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent/core/extensions/types";
import type { LsToolDetails } from "@earendil-works/pi-coding-agent/core/tools/ls";
import { getTextOutput, renderToolPath, str } from "@earendil-works/pi-support/render-utils";
import { DEFAULT_MAX_BYTES, formatSize } from "@earendil-works/pi-support/truncate";
import { Text } from "@earendil-works/pi-tui/components/text";
import { theme } from "../../client-theme.ts";
import { keyHint } from "../keybinding-hints.ts";

function formatLsCall(args: { path?: string; limit?: number } | undefined, cwd: string): string {
	const limit = args?.limit;
	const pathDisplay = renderToolPath(str(args?.path), theme, cwd, { emptyFallback: "." });
	let text = `${theme.fg("toolTitle", theme.bold("ls"))} ${pathDisplay}`;
	if (limit !== undefined) {
		text += theme.fg("toolOutput", ` (limit ${limit})`);
	}
	return text;
}
function formatLsResult(
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: LsToolDetails;
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

	const entryLimit = result.details?.entryLimitReached;
	const truncation = result.details?.truncation;
	if (entryLimit || truncation?.truncated) {
		const warnings: string[] = [];
		if (entryLimit) warnings.push(`${entryLimit} entries limit`);
		if (truncation?.truncated) warnings.push(`${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
		text += `\n${theme.fg("warning", `[Truncated: ${warnings.join(", ")}]`)}`;
	}
	return text;
}

export const lsRenderers: Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> = {
	renderCall(args, _theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(formatLsCall(args as any, context.cwd));
		return text;
	},
	renderResult(result, options, _theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(formatLsResult(result as any, options, context.showImages));
		return text;
	},
};
