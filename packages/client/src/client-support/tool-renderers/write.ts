/**
 * Presentation for the write tool.
 *
 * The client does not carry a syntax highlighter: the content it shows is drawn in the color
 * of the tool output. The server draws the highlighted content of the rows it renders.
 */

import type { ToolDefinition, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent/core/extensions/types";
import { normalizeDisplayText, renderToolPath, replaceTabs, str } from "@earendil-works/pi-support/render-utils";
import { Text } from "@earendil-works/pi-tui/components/text";
import { theme } from "../../client-theme.ts";
import { keyHint } from "../keybinding-hints.ts";

function trimTrailingEmptyLines(lines: string[]): string[] {
	let end = lines.length;
	while (end > 0 && lines[end - 1] === "") {
		end--;
	}
	return lines.slice(0, end);
}
function formatWriteCall(
	args: { path?: string; file_path?: string; content?: string } | undefined,
	options: ToolRenderResultOptions,
	cwd: string,
): string {
	const rawPath = str(args?.file_path ?? args?.path);
	const fileContent = str(args?.content);
	const pathDisplay = renderToolPath(rawPath, theme, cwd);
	let text = `${theme.fg("toolTitle", theme.bold("write"))} ${pathDisplay}`;

	if (fileContent === null) {
		text += `\n\n${theme.fg("error", "[invalid content arg - expected string]")}`;
	} else if (fileContent) {
		const lines = trimTrailingEmptyLines(normalizeDisplayText(fileContent).split("\n"));
		const totalLines = lines.length;
		const maxLines = options.expanded ? lines.length : 10;
		const displayLines = lines.slice(0, maxLines);
		const remaining = lines.length - maxLines;
		text += `\n\n${displayLines.map((line) => theme.fg("toolOutput", replaceTabs(line))).join("\n")}`;
		if (remaining > 0) {
			text += `${theme.fg("muted", `\n... (${remaining} more lines, ${totalLines} total,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
		}
	}

	return text;
}
function formatWriteResult(result: {
	content: Array<{ type: string; text?: string }>;
	isError?: boolean;
}): string | undefined {
	if (!result.isError) {
		return undefined;
	}
	const output = result.content
		.filter((c) => c.type === "text")
		.map((c) => c.text || "")
		.join("\n");
	if (!output) {
		return undefined;
	}
	return `\n${theme.fg("error", output)}`;
}

export const writeRenderers: Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> = {
	renderCall(args, _theme, context) {
		const renderArgs = args as { path?: string; file_path?: string; content?: string } | undefined;
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(
			formatWriteCall(renderArgs, { expanded: context.expanded, isPartial: context.isPartial }, context.cwd),
		);
		return text;
	},
	renderResult(result, _options, _theme, context) {
		const output = formatWriteResult({ ...result, isError: context.isError });
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(output ?? "");
		return text;
	},
};
