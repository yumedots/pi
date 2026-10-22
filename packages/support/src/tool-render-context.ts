/**
 * The context of a tool renderer.
 *
 * The renderers of the tools draw with the theme of the package they run in, and they read
 * the state of their row from this context. The coding agent and the client both render
 * tools, so the shape of the context lives here, in the package the two of them share.
 */

import type { Component } from "@earendil-works/pi-tui";

/** Context passed to tool renderers. */
export interface ToolRenderContext<TState = any, TArgs = any> {
	/** Current tool call arguments. Shared across call/result renders for the same tool call. */
	args: TArgs;
	/** Unique id for this tool execution. Stable across call/result renders for the same tool call. */
	toolCallId: string;
	/** Invalidate just this tool execution component for redraw. */
	invalidate: () => void;
	/** Previously returned component for this render slot, if any. */
	lastComponent: Component | undefined;
	/** Shared renderer state for this tool row. Initialized by tool-execution.ts. */
	state: TState;
	/** Working directory for this tool execution. */
	cwd: string;
	/** Whether the tool execution has started. */
	executionStarted: boolean;
	/** Whether the tool call arguments are complete. */
	argsComplete: boolean;
	/** Whether the tool result is partial/streaming. */
	isPartial: boolean;
	/** Whether the result view is expanded. */
	expanded: boolean;
	/** Whether inline images are currently shown in the TUI. */
	showImages: boolean;
	/** Whether the current result is an error. */
	isError: boolean;
	/**
	 * Milliseconds the tool's execution took, from the final result; `undefined` while it runs, when it did not run, or
	 * for results stored before durations were recorded.
	 */
	durationMs: number | undefined;
	/** Horizontal padding configured by the outputPad setting. Renderers with `renderShell: "self"` apply it themselves. */
	outputPad: number;
}
