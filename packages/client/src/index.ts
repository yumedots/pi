/**
 * The pi client package.
 *
 * The client is the terminal UI of the pi coding agent. It never hosts the agent
 * runtime: it talks to a pi server over HTTP and SSE. This module is the public surface
 * of the package: the command line, the session connection, the session facade and the
 * terminal UI building blocks the extensions use.
 */

export type { InteractiveStartContext } from "@earendil-works/pi-coding-agent";
export { reportBug } from "./bug-report.ts";
export { type ChatViewport, type ChatViewportOptions, createChatViewport } from "./chat-viewport.ts";
export {
	type ConfigSelectorOptions,
	selectConfig,
} from "./cli/config-selector.ts";
export { selectSession } from "./cli/session-picker.ts";
export {
	createStartupTui,
	showFirstTimeSetup,
	showStartupInput,
	showStartupSelector,
	startStartupTui,
} from "./cli/startup-ui.ts";
export { runClient, SERVER_COMMAND } from "./cli.ts";
export type { ClientExtensionUIContext, ClientWidgetOptions } from "./client-extension-ui.ts";
export { ClientSettings } from "./client-settings.ts";
export { ClientState } from "./client-state.ts";
export * from "./components/index.ts";
export {
	type ExternalEditorOptions,
	type ExternalEditorResult,
	editInExternalEditor,
} from "./external-editor.ts";
export {
	formatCrashExtensionHint,
	formatResumeCommand,
	InteractiveMode,
	type InteractiveModeOptions,
} from "./interactive-mode.ts";
export {
	assertManifestMatches,
	collectClientExtensions,
	compareExtensionSets,
	type ExtensionMismatch,
	type ExtensionMismatchKind,
	extensionFileHash,
	formatExtensionMismatches,
	ManifestMismatchError,
	type PiExtensionInfo,
} from "./manifest-check.ts";
export { refreshModelCatalogs } from "./model-catalog-refresh.ts";
export {
	getModelSearchText,
	getModelSelectorSearchText,
	type ModelSearchItem,
} from "./model-search.ts";
export { type BlockedStatus, ProgramStatusReporter } from "./program-status-reporter.ts";
export { RemoteSessionFacade } from "./remote-facade.ts";
export { RemoteSessionConnection } from "./remote-session.ts";
export {
	type EnsureServerOptions,
	ensureServer,
	isServerAlive,
	type RunningServer,
	readServerRegistration,
	SERVER_START_TIMEOUT_MS,
} from "./server-launcher.ts";
export { type SessionConnection, STATE_REFRESHING_EVENTS } from "./session-connection.ts";
export type { SessionFacade, SessionModelRuntime } from "./session-facade.ts";
export {
	createShareTrailingEntries,
	exportSessionForShare,
	shareSession,
} from "./session-share.ts";
export {
	createInteractiveTui,
	createInteractiveTuiReference,
	type InteractiveTuiOptions,
} from "./tui-renderer.ts";
