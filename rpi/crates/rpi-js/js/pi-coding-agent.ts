/**
 * The `@earendil-works/pi-coding-agent` module the extensions import.
 *
 * pi's package entry is the whole CLI, and the CLI cannot run inside the
 * embedded host: it replaces the global `process` when it loads, and every
 * extension dies with it. So this module re-exports the pieces of pi's
 * package entry that an extension can use — the same names, from the same
 * source files.
 *
 * NOT WIRED YET. The virtual module map still points at the contract's
 * `core/extensions/types.ts`, because two runtime problems remain (they are
 * written up in `scripts/parity/EXTENSION-API-PORT.md`, under "the module
 * surface"):
 *
 * 1. `which/which.js` reads `process.env.OSTYPE` and finds `process.env`
 *    null — the bundle replaces the global `process` when it loads.
 * 2. `config.ts` calls `fileURLToPath(import.meta.url)`, and the bundle
 *    gives the url shim an `import.meta.url` it cannot read.
 */

export {
	createEventBus,
	type EventBus,
	type EventBusController,
} from "../../../../packages/coding-agent/src/core/event-bus.ts";
// The config paths are the port's own: pi's `config.ts` reads the package
// directory at import time, which the embedded host cannot do.
export const CONFIG_DIR_NAME = ".pi";
export const getAgentDir = (): string => {
	const override = process.env.PI_CODING_AGENT_DIR;
	if (override) return override;
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "/";
	return `${home}/.pi/agent`;
};
export const getDocsPath = (): string => `${getAgentDir()}/docs`;
export const getExamplesPath = (): string => `${getAgentDir()}/examples`;
export const getPackageDir = (): string => getAgentDir();
export const getReadmePath = (): string => `${getAgentDir()}/README.md`;
export const VERSION = "1.3.0";
export {
	defineTool,
	isBashToolResult,
	isEditToolResult,
	isFindToolResult,
	isGrepToolResult,
	isLsToolResult,
	isPowerShellToolResult,
	isReadToolResult,
	isToolCallEventType,
	isWriteToolResult,
} from "../../../../packages/coding-agent/src/core/extensions/types.ts";
export { convertToLlm } from "../../../../packages/coding-agent/src/core/messages.ts";
export {
	generateDiffString,
	generateUnifiedPatch,
} from "../../../../packages/coding-agent/src/core/tools/edit-diff.ts";
// The tools are imported one by one: the barrel also pulls the renderers,
// which reach for the package directory at import time.
export {
	createBashToolDefinition,
	createLocalBashOperations,
} from "../../../../packages/coding-agent/src/core/tools/bash.ts";
export {
	createReadTool,
	createReadToolDefinition,
} from "../../../../packages/coding-agent/src/core/tools/read.ts";
export {
	createFindTool,
	createFindToolDefinition,
} from "../../../../packages/coding-agent/src/core/tools/find.ts";
export {
	createGrepTool,
	createGrepToolDefinition,
} from "../../../../packages/coding-agent/src/core/tools/grep.ts";
export {
	createLsTool,
	createLsToolDefinition,
} from "../../../../packages/coding-agent/src/core/tools/ls.ts";
export {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	truncateLine,
	truncateTail,
} from "../../../../packages/coding-agent/src/core/tools/truncate.ts";
export {
	createWriteTool,
	createWriteToolDefinition,
} from "../../../../packages/coding-agent/src/core/tools/write.ts";
export {
	createEditTool,
	createEditToolDefinition,
} from "../../../../packages/coding-agent/src/core/tools/edit.ts";
export { withFileMutationQueue } from "../../../../packages/coding-agent/src/core/tools/file-mutation-queue.ts";
export { formatReadLineRange } from "../../../../packages/coding-agent/src/core/tools/render-utils.ts";
export { createBashTool } from "../../../../packages/coding-agent/src/core/tools/bash.ts";
// The components are imported one by one: the barrel also pulls the
// components that reach for the session — and with it the network layer,
// which the embedded host has no use for.
export { BorderedLoader } from "../../../../packages/coding-agent/src/modes/interactive/components/bordered-loader.ts";
export { CustomEditor, type CustomEditorOptions } from "../../../../packages/coding-agent/src/modes/interactive/components/custom-editor.ts";
export { DynamicBorder } from "../../../../packages/coding-agent/src/modes/interactive/components/dynamic-border.ts";
export { keyHint, keyText, rawKeyHint } from "../../../../packages/coding-agent/src/modes/interactive/components/keybinding-hints.ts";
export { type RenderDiffOptions, renderDiff } from "../../../../packages/coding-agent/src/modes/interactive/components/diff.ts";
export { truncateToVisualLines, type VisualTruncateResult } from "../../../../packages/coding-agent/src/modes/interactive/components/visual-truncate.ts";
export {
	getLanguageFromPath,
	getMarkdownTheme,
	getSelectListTheme,
	getSettingsListTheme,
	highlightCode,
	initTheme,
	Theme,
} from "../../../../packages/coding-agent/src/modes/interactive/theme/theme.ts";
export { copyToClipboard } from "../../../../packages/coding-agent/src/utils/clipboard.ts";
export { parseFrontmatter, stripFrontmatter } from "../../../../packages/coding-agent/src/utils/frontmatter.ts";
export { convertToPng } from "../../../../packages/coding-agent/src/utils/image-convert.ts";
export { formatDimensionNote, resizeImage } from "../../../../packages/coding-agent/src/utils/image-resize.ts";
export { detectSupportedImageMimeTypeFromFile } from "../../../../packages/coding-agent/src/utils/mime.ts";
