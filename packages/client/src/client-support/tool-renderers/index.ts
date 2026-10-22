/**
 * The built-in tool renderers of the client.
 *
 * The client draws the tools it knows while it waits for the server: the server draws the
 * rows of the tools only it knows. The renderers live here, apart from the tools themselves,
 * so the client does not load the execution path of the agent.
 */

import type { ToolRenderers } from "@earendil-works/pi-coding-agent/core/extensions/types";
import { createShellRenderers } from "./bash.ts";
import { editRenderers } from "./edit.ts";
import { findRenderers } from "./find.ts";
import { grepRenderers } from "./grep.ts";
import { lsRenderers } from "./ls.ts";
import { readRenderers } from "./read.ts";
import { writeRenderers } from "./write.ts";

export type { ToolRenderers };

export {
	createShellRenderers,
	editRenderers,
	findRenderers,
	grepRenderers,
	lsRenderers,
	readRenderers,
	writeRenderers,
};

/** The names of the built-in tools. */
export type BuiltInToolName = "read" | "bash" | "powershell" | "edit" | "write" | "grep" | "find" | "ls";

/** Renderers for every built-in tool, keyed by tool name. */
export function createAllToolRenderers(): Record<BuiltInToolName, ToolRenderers> {
	return {
		read: readRenderers,
		bash: createShellRenderers("$"),
		powershell: createShellRenderers("PS>"),
		edit: editRenderers,
		write: writeRenderers,
		grep: grepRenderers,
		find: findRenderers,
		ls: lsRenderers,
	};
}

/**
 * Merge the built-in renderers into a tool definition that does not supply its own.
 *
 * The caller does the merge, so a process that renders can import the renderers alone.
 */
export function withBuiltInRenderers<TDefinition extends ToolRenderers>(
	toolName: string,
	definition: TDefinition | undefined,
): TDefinition | ToolRenderers | undefined {
	const builtIn = createAllToolRenderers()[toolName as BuiltInToolName];
	if (!definition) return builtIn;
	if (!builtIn) return definition;
	return {
		...definition,
		renderCall: definition.renderCall ?? builtIn.renderCall,
		renderResult: definition.renderResult ?? builtIn.renderResult,
	};
}
