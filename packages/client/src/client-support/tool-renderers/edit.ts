/**
 * Presentation for the edit tool.
 *
 * The client draws the call of the edit and the diff of the result. The diff of a pending
 * edit needs the file it changes, and the file belongs to the server: the server draws that
 * diff, the client draws the rest.
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent/core/extensions/types";
import type { EditToolDetails } from "@earendil-works/pi-coding-agent/core/tools/edit";
import { Box } from "@earendil-works/pi-tui/components/box";
import { Spacer } from "@earendil-works/pi-tui/components/spacer";
import { Text } from "@earendil-works/pi-tui/components/text";
import { Container } from "@earendil-works/pi-tui/tui";
import { theme } from "../../client-theme.ts";
import { renderDiff } from "../diff.ts";
import { renderToolPath, str } from "../render-utils.ts";

type RenderableEditArgs = {
	path?: string;
	file_path?: string;
};
type EditToolResultLike = {
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
	details?: EditToolDetails;
};
type EditCallRenderComponent = Box & {
	settledError?: boolean;
};
function createEditCallRenderComponent(): EditCallRenderComponent {
	return Object.assign(new Box(1, 1, (text: string) => text), {
		settledError: false,
	});
}
function getEditCallRenderComponent(state: any, lastComponent: unknown): EditCallRenderComponent {
	if (lastComponent instanceof Box) {
		return lastComponent as EditCallRenderComponent;
	}
	if (state.callComponent) {
		return state.callComponent as EditCallRenderComponent;
	}
	const component = createEditCallRenderComponent();
	state.callComponent = component;
	return component;
}
function formatEditCall(args: RenderableEditArgs | undefined, cwd: string): string {
	const pathDisplay = renderToolPath(str(args?.file_path ?? args?.path), theme, cwd);
	return `${theme.fg("toolTitle", theme.bold("edit"))} ${pathDisplay}`;
}
function formatEditResult(result: EditToolResultLike, isError: boolean): string | undefined {
	if (isError) {
		const errorText = result.content
			.filter((c) => c.type === "text")
			.map((c) => c.text || "")
			.join("\n");
		return errorText ? theme.fg("error", errorText) : undefined;
	}

	const resultDiff = result.details?.diff;
	if (!resultDiff) {
		return undefined;
	}
	return renderDiff(resultDiff);
}
function getEditHeaderBg(settledError: boolean | undefined): (text: string) => string {
	if (settledError) {
		return (text: string) => theme.bg("toolErrorBg", text);
	}
	return (text: string) => theme.bg("toolPendingBg", text);
}
function buildEditCallComponent(
	component: EditCallRenderComponent,
	args: RenderableEditArgs | undefined,
	cwd: string,
	outputPad: number,
): EditCallRenderComponent {
	component.setBgFn(getEditHeaderBg(component.settledError));
	component.setPaddingX(outputPad);
	component.clear();
	component.addChild(new Text(formatEditCall(args, cwd), 0, 0));
	return component;
}

export const editRenderers: Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> = {
	renderCall(args, _theme, context) {
		const component = getEditCallRenderComponent(context.state, context.lastComponent);
		return buildEditCallComponent(component, args as RenderableEditArgs | undefined, context.cwd, context.outputPad);
	},
	renderResult(result, _options, _theme, context) {
		const callComponent = context.state.callComponent as EditCallRenderComponent | undefined;
		if (callComponent) {
			callComponent.settledError = context.isError;
			buildEditCallComponent(
				callComponent,
				context.args as RenderableEditArgs | undefined,
				context.cwd,
				context.outputPad,
			);
		}

		const output = formatEditResult(result as EditToolResultLike, context.isError);
		const component = (context.lastComponent as Container | undefined) ?? new Container();
		component.clear();
		if (!output) {
			return component;
		}
		component.addChild(new Spacer(1));
		component.addChild(new Text(output, context.outputPad, 0));
		return component;
	},
};
