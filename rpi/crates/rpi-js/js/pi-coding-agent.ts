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
export {
	CONFIG_DIR_NAME,
	getAgentDir,
	getDocsPath,
	getExamplesPath,
	getPackageDir,
	getReadmePath,
	VERSION,
} from "../../../../packages/coding-agent/src/config.ts";
export { parseArgs } from "../../../../packages/coding-agent/src/cli/args.ts";
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
export { ModelRegistry } from "../../../../packages/coding-agent/src/core/model-registry.ts";
export {
	resolveCliModel,
	resolveModelScopeWithDiagnostics,
} from "../../../../packages/coding-agent/src/core/model-resolver.ts";
export {
	CredentialSynchronizationError,
	ModelRuntime,
} from "../../../../packages/coding-agent/src/core/model-runtime.ts";
export { DefaultPackageManager } from "../../../../packages/coding-agent/src/core/package-manager.ts";
export {
	DefaultResourceLoader,
	loadProjectContextFiles,
} from "../../../../packages/coding-agent/src/core/resource-loader.ts";
export { readStoredCredential } from "../../../../packages/coding-agent/src/core/auth-storage.ts";
export {
	calculateContextTokens,
	compact,
	DEFAULT_COMPACTION_SETTINGS,
	estimateTokens,
	findCutPoint,
	findTurnStartIndex,
	generateBranchSummary,
	generateSummary,
	generateSummaryWithUsage,
	getLastAssistantUsage,
	prepareBranchEntries,
	serializeConversation,
	shouldCompact,
} from "../../../../packages/coding-agent/src/core/compaction/index.ts";
export {
	buildContextEntries,
	buildSessionContext,
	buildSessionProjection,
	CURRENT_SESSION_VERSION,
	getLatestCompactionEntry,
	migrateSessionEntries,
	parseSessionEntries,
	sessionEntryToContextMessages,
	SessionManager,
} from "../../../../packages/coding-agent/src/core/session-manager.ts";
export { SettingsManager } from "../../../../packages/coding-agent/src/core/settings-manager.ts";
export {
	formatSkillsForPrompt,
	loadSkills,
	loadSkillsFromDir,
} from "../../../../packages/coding-agent/src/core/skills.ts";
export { createSyntheticSourceInfo } from "../../../../packages/coding-agent/src/core/source-info.ts";
export {
	generateDiffString,
	generateUnifiedPatch,
} from "../../../../packages/coding-agent/src/core/tools/edit-diff.ts";
export {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLocalBashOperations,
	createLocalPowerShellOperations,
	createLsToolDefinition,
	createPowerShellToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	truncateTail,
	withFileMutationQueue,
} from "../../../../packages/coding-agent/src/core/tools/index.ts";
export { formatReadLineRange } from "../../../../packages/coding-agent/src/core/tools/render-utils.ts";
export {
	hasTrustRequiringProjectResources,
	ProjectTrustStore,
} from "../../../../packages/coding-agent/src/core/trust-manager.ts";
export { VIRTUAL_MODEL_STATE_ENTRY } from "../../../../packages/coding-agent/src/core/virtual-models.ts";
export { createBashTool } from "../../../../packages/coding-agent/src/core/tools/bash.ts";
export {
	createCodingToolDefinitions,
	createCodingTools,
	createReadOnlyToolDefinitions,
	createReadOnlyTools,
	createTool,
	createToolDefinition,
} from "../../../../packages/coding-agent/src/core/tools/index.ts";
export { createToolSearchExtension } from "../../../../packages/coding-agent/src/extensions/tool-search/index.ts";
export {
	AssistantMessageComponent,
	BashExecutionComponent,
	BorderedLoader,
	CustomEditor,
	CustomMessageComponent,
	DynamicBorder,
	ExtensionEditorComponent,
	ExtensionInputComponent,
	ExtensionSelectorComponent,
	FooterComponent,
	keyHint,
	keyText,
	rawKeyHint,
	renderDiff,
	SettingsSelectorComponent,
	ThemeSelectorComponent,
	ThinkingSelectorComponent,
	ToolExecutionComponent,
	truncateToVisualLines,
	UserMessageComponent,
	UserMessageSelectorComponent,
} from "../../../../packages/coding-agent/src/modes/interactive/components/index.ts";
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
export { getPowerShellConfig, getShellConfig } from "../../../../packages/coding-agent/src/utils/shell.ts";
