/**
 * Interactive mode for the coding agent.
 * Handles TUI rendering and user interaction, delegating business logic to AgentSession.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import {
	type AssistantMessage,
	type ImageContent,
	isRetryableAssistantError,
	type Message,
	type Model,
	type Usage,
} from "@earendil-works/pi-ai/compat";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	APP_NAME,
	APP_TITLE,
	CONFIG_DIR_NAME,
	detectInstallChange,
	getAgentDir,
	getAuthPath,
	getDebugLogPath,
	getDocsPath,
	VERSION,
} from "@earendil-works/pi-coding-agent/config";
import { type AgentSessionEvent, parseSkillMessage } from "@earendil-works/pi-coding-agent/core/agent-session";
import { SessionImportFileNotFoundError } from "@earendil-works/pi-coding-agent/core/agent-session-runtime";
import type { AgentSessionRuntimeDiagnostic } from "@earendil-works/pi-coding-agent/core/agent-session-services";
import {
	CACHE_TTL_MS,
	type CacheMiss,
	collectCacheMisses,
	computeCacheWaste,
	detectCacheMiss,
} from "@earendil-works/pi-coding-agent/core/cache-stats";
import { formatCacheWarmingStatus, formatCacheWarmingUsage } from "@earendil-works/pi-coding-agent/core/cache-warmer";
import {
	findExtensionStackMatches,
	recordCrash,
	takeUnnotifiedCrash,
} from "@earendil-works/pi-coding-agent/core/crash-log";
import { DEFAULT_THINKING_LEVEL, THINKING_LEVEL_OPTIONS } from "@earendil-works/pi-coding-agent/core/defaults";
import type {
	AutocompleteProviderFactory,
	EditorFactory,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	MarkdownTransformer,
	WorkingIndicatorOptions,
} from "@earendil-works/pi-coding-agent/core/extensions/index";
import {
	FooterDataProvider,
	type ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent/core/footer-data-provider";
import { configureHttpDispatcher, formatHttpIdleTimeoutMs } from "@earendil-works/pi-coding-agent/core/http-dispatcher";
import { type AppKeybinding, KeybindingsManager } from "@earendil-works/pi-coding-agent/core/keybindings";
import type { McpHttpServerConfig } from "@earendil-works/pi-coding-agent/core/mcp-servers";
import { createCompactionSummaryMessage, createCustomMessage } from "@earendil-works/pi-coding-agent/core/messages";
import {
	defaultModelPerProvider,
	findExactModelReferenceMatch,
	resolveModelScopeFromModels,
} from "@earendil-works/pi-coding-agent/core/model-resolver";
import { CredentialSynchronizationError } from "@earendil-works/pi-coding-agent/core/model-runtime";
import { DefaultPackageManager } from "@earendil-works/pi-coding-agent/core/package-manager";
import { RADIUS_MCP_URL, RADIUS_PROVIDER_ID } from "@earendil-works/pi-coding-agent/core/radius";
import type { ResourceDiagnostic } from "@earendil-works/pi-coding-agent/core/resource-loader";
import {
	formatMissingSessionCwdPrompt,
	MissingSessionCwdError,
} from "@earendil-works/pi-coding-agent/core/session-cwd";
import {
	type SessionEntry,
	SessionManager,
	sessionEntryToContextMessages,
	type UsageEntry,
} from "@earendil-works/pi-coding-agent/core/session-manager";
import {
	type FullscreenExitOutput,
	formatServerIdleTimeout,
	type TuiMode,
} from "@earendil-works/pi-coding-agent/core/settings-manager";
import { BUILTIN_SLASH_COMMANDS, resolveBuiltinSlashAlias } from "@earendil-works/pi-coding-agent/core/slash-commands";
import type { SourceInfo } from "@earendil-works/pi-coding-agent/core/source-info";
import {
	getAvailableThemes,
	getAvailableThemesWithPaths,
	getEditorTheme,
	getMarkdownTheme,
	getThemeByName,
	onThemeChange,
	SYSTEM_THEME_NAME,
	stopThemeWatcher,
	Theme,
	theme,
} from "@earendil-works/pi-coding-agent/core/theme/theme";
import { InteractiveThemeController } from "@earendil-works/pi-coding-agent/core/theme/theme-controller";
import { withBuiltInRenderers } from "@earendil-works/pi-coding-agent/core/tools/renderers/index";
import type { TruncationResult } from "@earendil-works/pi-coding-agent/core/tools/truncate";
import {
	hasTrustRequiringProjectResources,
	ProjectTrustStore,
} from "@earendil-works/pi-coding-agent/core/trust-manager";
import { DynamicBorder } from "@earendil-works/pi-coding-agent/core/ui/dynamic-border";
import {
	formatKeyText,
	keyDisplayText,
	keyHint,
	keyText,
	rawKeyHint,
} from "@earendil-works/pi-coding-agent/core/ui/keybinding-hints";
import { getUsageCostBreakdown } from "@earendil-works/pi-coding-agent/core/usage-totals";
import { addMcpServerConfig, loadMcpConfig } from "@earendil-works/pi-coding-agent/extensions/mcp/config";
import {
	getChangelogPath,
	getNewEntries,
	normalizeChangelogLinks,
	parseChangelog,
} from "@earendil-works/pi-coding-agent/utils/changelog";
import {
	copyToClipboard,
	readClipboardFilePaths,
	readClipboardText,
} from "@earendil-works/pi-coding-agent/utils/clipboard";
import { extensionForImageMimeType, readClipboardImage } from "@earendil-works/pi-coding-agent/utils/clipboard-image";
import { ensurePngTranscoder } from "@earendil-works/pi-coding-agent/utils/image-convert";
import { killTrackedDetachedChildren } from "@earendil-works/pi-coding-agent/utils/shell";
import { loadAllHighlightLanguages } from "@earendil-works/pi-coding-agent/utils/syntax-highlight";
import { ensureTool, type ToolStatus } from "@earendil-works/pi-coding-agent/utils/tools-manager";
import { checkForNewPiVersion, type LatestPiRelease } from "@earendil-works/pi-coding-agent/utils/version-check";
import type { ServerRegistration } from "@earendil-works/pi-server";
import { PiServerClient, type RemoteSessionInfo } from "@earendil-works/pi-server/client";
import type {
	AutocompleteItem,
	AutocompleteProvider,
	EditorComponent,
	Keybinding,
	MarkdownTheme,
	OverlayHandle,
	OverlayOptions,
	SlashCommand,
	TuiMainScreenRenderState,
} from "@earendil-works/pi-tui";
import * as TuiLayouts from "@earendil-works/pi-tui";
import {
	CombinedAutocompleteProvider,
	type Component,
	Container,
	fuzzyFilter,
	getCapabilities,
	hyperlink,
	Markdown,
	matchesKey,
	Spacer,
	setCapabilityOverrides,
	setKeybindings,
	type Terminal,
	Text,
	TruncatedText,
	type TUI,
	TuiAltScreen,
	TuiMainScreen,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { spawn } from "child_process";
import { reportBug } from "./bug-report.ts";
import { type ChatViewport, createChatViewport } from "./chat-viewport.ts";
import {
	type ClientExtensionCommand,
	ClientExtensionRuntime,
	createClientExtensionCommandContext,
	createClientExtensionContext,
} from "./client-extension-runtime.ts";
import { loadClientExtensions } from "./client-extensions.ts";
import { ArminComponent } from "./components/armin.ts";
import { AssistantMessageComponent } from "./components/assistant-message.ts";
import { BashExecutionComponent } from "./components/bash-execution.ts";
import { BranchSummaryMessageComponent } from "./components/branch-summary-message.ts";
import { Centered } from "./components/centered.ts";
import { CompactionSummaryMessageComponent } from "./components/compaction-summary-message.ts";
import { CustomEditor } from "./components/custom-editor.ts";
import { CustomEntryComponent } from "./components/custom-entry.ts";
import { CustomMessageComponent } from "./components/custom-message.ts";
import { EarendilAnnouncementComponent } from "./components/earendil-announcement.ts";
import { loadPiLogo3d, type PiLogo3d, playArmin3d, playPiLogo3d } from "./components/easter-egg-3d.lazy.ts";
import { EmptySessionScreen } from "./components/empty-session-screen.ts";
import { ExtensionEditorComponent } from "./components/extension-editor.ts";
import { ExtensionInputComponent } from "./components/extension-input.ts";
import { ExtensionSelectorComponent } from "./components/extension-selector.ts";
import { FooterComponent, formatTokens } from "./components/footer.ts";
import { LoginDialogComponent } from "./components/login-dialog.ts";
import { MenuComponent, type MenuItem } from "./components/menu.ts";
import { createMermaidMarkdownTransformer } from "./components/mermaid.ts";
import { ModelSelectorComponent } from "./components/model-selector.ts";
import {
	type AuthSelectorProvider,
	formatAuthSelectorProviderStatus,
	formatAuthSelectorProviderType,
	OAuthSelectorComponent,
} from "./components/oauth-selector.ts";
import { piLogoLines, piWordmark, supportsPiLogo } from "./components/pi-logo.ts";
import { AgentProgressBar } from "./components/progress-bar.ts";
import { createLoginMenuSelector } from "./components/radius-login-selector.ts";
import { ScopedModelsSelectorComponent } from "./components/scoped-models-selector.ts";
import { SessionMenuComponent } from "./components/session-menu.ts";
import { SessionSidebar, type SessionSidebarRow, type SessionSidebarSelection } from "./components/session-sidebar.ts";
import { SettingsSelectorComponent } from "./components/settings-selector.ts";
import { SkillInvocationMessageComponent } from "./components/skill-invocation-message.ts";
import {
	BranchSummaryStatusIndicator,
	CompactionStatusIndicator,
	IdleStatus,
	RetryStatusIndicator,
	type StatusIndicator,
	WorkingStatusIndicator,
} from "./components/status-indicator.ts";
import { ThemedText } from "./components/themed-text.ts";
import { ThinkingSelectorComponent } from "./components/thinking-selector.ts";
import { ToolExecutionComponent } from "./components/tool-execution.ts";
import { TreeSelectorComponent } from "./components/tree-selector.ts";
import { TrustSelectorComponent } from "./components/trust-selector.ts";
import { UserMessageComponent } from "./components/user-message.ts";
import { UserMessageSelectorComponent } from "./components/user-message-selector.ts";
import { editInExternalEditor } from "./external-editor.ts";
import { refreshModelCatalogs } from "./model-catalog-refresh.ts";
import { getModelSearchText } from "./model-search.ts";
import { PairDialog, type PairingFlow, runPairingFlow } from "./pair-dialog.ts";
import { type BlockedStatus, ProgramStatusReporter } from "./program-status-reporter.ts";
import { readServerRegistration } from "./server-launcher.ts";
import type { SessionExtensionRunner, SessionFacade } from "./session-facade.ts";
import { shareSession } from "./session-share.ts";
import { createInteractiveTui, createInteractiveTuiReference } from "./tui-renderer.ts";

export { createInteractiveTui, createInteractiveTuiReference } from "./tui-renderer.ts";

/** Interface for components that can be expanded/collapsed */
interface Expandable {
	setExpanded(expanded: boolean): void;
}

interface ActiveEditor extends EditorComponent {
	getCursor?(): { line: number; col: number };
}

function isExpandable(obj: unknown): obj is Expandable {
	return typeof obj === "object" && obj !== null && "setExpanded" in obj && typeof obj.setExpanded === "function";
}

/**
 * The slash commands the client adds on top of the built-in ones.
 *
 * They are client commands, so they live here and not in the shared built-in list.
 */
const CLIENT_SLASH_COMMANDS: ReadonlyArray<{ name: string; description: string }> = [
	{ name: "pair", description: "Pair a device with this server" },
	{ name: "server", description: "Show the server this client is connected to" },
	{ name: "sidebar", description: "Show or hide the session sidebar" },
];

/** The server the client is connected to. */
interface ClientServerInfo {
	/** The url of the server. */
	url: string;
	/** The process id of the server. */
	pid: number;
	/** The addresses the server answers on. */
	urls: string[];
	/** The version of the server. */
	version: string;
	/** Whether the server runs in its own process or inside the client. */
	mode: "server-backed" | "embedded";
}

/** The host and the port of a url, for the footer. */
function hostPortOf(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
	} catch {
		return url;
	}
}

class ExpandableText extends ThemedText implements Expandable {
	private readonly state: { expanded: boolean };

	constructor(
		getCollapsedText: () => string,
		getExpandedText: () => string,
		expanded = false,
		paddingX = 0,
		paddingY = 0,
	) {
		const state = { expanded };
		super(() => (state.expanded ? getExpandedText() : getCollapsedText()), paddingX, paddingY);
		this.state = state;
	}

	setExpanded(expanded: boolean): void {
		this.state.expanded = expanded;
		this.invalidate();
	}
}

/** The built-in header. Clicking its logo (the first two lines, after one column of padding) plays an easter egg. */
class BuiltInHeader extends ExpandableText {
	onLogoClick: ((column: number, row: number) => void) | undefined;

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "click" || event.y > 1 || event.x < 1 || event.x > 4 || !this.onLogoClick) return undefined;
		this.onLogoClick(event.screenX - event.x + 1, event.screenY - event.y);
		return { handled: true };
	}
}

type CompactionQueuedMessage = {
	text: string;
	mode: "steer" | "followUp";
};

type CompactionCostNotice = {
	type: "compaction_cost";
	kind: "compaction" | "branch_summary";
	usage: Usage;
};

type RenderSessionItem = AgentMessage | Extract<SessionEntry, { type: "custom" | "usage" }> | CompactionCostNotice;

function isCustomSessionEntry(item: RenderSessionItem): item is Extract<SessionEntry, { type: "custom" }> {
	return "type" in item && item.type === "custom";
}

function isCompactionCostNotice(item: RenderSessionItem): item is CompactionCostNotice {
	return "type" in item && item.type === "compaction_cost";
}

function isUsageSessionEntry(item: RenderSessionItem): item is Extract<SessionEntry, { type: "usage" }> {
	return "type" in item && item.type === "usage";
}

// EIO: tty reads/ioctls from an orphaned background process group, or writes after hangup.
// ENOTTY: the tty was revoked (macOS) and stdin is no longer a terminal.
const DEAD_TERMINAL_ERROR_CODES = new Set(["EIO", "EPIPE", "ENOTCONN", "ENOTTY"]);

function isDeadTerminalError(error: unknown): boolean {
	if (!error || typeof error !== "object" || !("code" in error)) {
		return false;
	}
	const code = (error as NodeJS.ErrnoException).code;
	return code !== undefined && DEAD_TERMINAL_ERROR_CODES.has(code);
}

export function formatCrashExtensionHint(extensionMatches: readonly string[] | undefined): string | undefined {
	const matches = Array.isArray(extensionMatches)
		? extensionMatches.filter((match): match is string => typeof match === "string" && match.length > 0)
		: [];
	if (matches.length === 0) return undefined;
	const quoted = matches.map((match) => `\`${match}\``);
	const labels =
		quoted.length === 1
			? quoted[0]
			: quoted.length === 2
				? quoted.join(" and ")
				: `${quoted.slice(0, -1).join(", ")}, and ${quoted[quoted.length - 1]}`;
	const noun = matches.length === 1 ? "extension" : "extensions";
	const pronoun = matches.length === 1 ? "it" : "them";
	return `A stack frame came from loaded ${noun} ${labels}, which may be involved. Try disabling ${pronoun} with \`${APP_NAME} config\`, or run \`${APP_NAME} -ne\` to confirm.`;
}

const ANTHROPIC_SUBSCRIPTION_AUTH_WARNING =
	"Anthropic subscription auth is active. Third-party harness usage draws from extra usage and is billed per token, not your Claude plan limits. Manage extra usage at https://claude.ai/settings/usage. Disable this warning in /settings.";

function isAnthropicSubscriptionAuthKey(apiKey: string | undefined): boolean {
	return typeof apiKey === "string" && apiKey.startsWith("sk-ant-oat");
}

function isUnknownModel(model: Model<any> | undefined): boolean {
	return !!model && model.provider === "unknown" && model.id === "unknown" && model.api === "unknown";
}

function quoteIfNeeded(value: string): string {
	if (value.length > 0 && !/[^a-zA-Z0-9_\-./~:@]/.test(value)) {
		return value;
	}
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The session store the resume command needs.
 *
 * The session lives in the server's process, so the client reads the file the server
 * reports. The view of the facade carries everything the command needs.
 */
export interface ResumeSessionInfo {
	/** Whether the session is stored on disk. */
	isPersisted?(): boolean;
	/** The session file, or `undefined` for an in-memory session. */
	getSessionFile(): string | undefined;
	/** Whether the session lives in the default session directory. */
	usesDefaultSessionDir(): boolean;
	/** The directory the session file lives in. */
	getSessionDir(): string;
	/** The id of the session. */
	getSessionId(): string;
}

export function formatResumeCommand(sessionManager: ResumeSessionInfo): string | undefined {
	if (!process.stdout.isTTY) return undefined;
	if (sessionManager.isPersisted?.() === false) return undefined;

	const sessionFile = sessionManager.getSessionFile();
	if (!sessionFile || !fs.existsSync(sessionFile)) return undefined;

	const args = [APP_NAME];
	if (!sessionManager.usesDefaultSessionDir()) {
		args.push("--session-dir", quoteIfNeeded(sessionManager.getSessionDir()));
	}
	args.push("--session", sessionManager.getSessionId());
	return args.join(" ");
}

function hasDefaultModelProvider(providerId: string): providerId is keyof typeof defaultModelPerProvider {
	return providerId in defaultModelPerProvider;
}

function llamaCppPostLoginGuidance(actionLabel: string, loadedModelCount: number): string {
	return loadedModelCount === 0
		? `${actionLabel}. No llama.cpp models are loaded. Use /llama to load a model, then /model to select it.`
		: `${actionLabel}. Use /model to select a loaded llama.cpp model, or /llama to manage models.`;
}

type LoginProviderCompletionOption = {
	id: string;
	name: string;
	authTypes: AuthSelectorProvider["authType"][];
	subscription?: boolean;
};

const RADIUS_LOGIN_INTRO = "Radius is a service crafted for Pi by the builders of Pi, Earendil Works";

const AUTH_TYPE_ORDER = { oauth: 0, api_key: 1 } satisfies Record<AuthSelectorProvider["authType"], number>;

/**
 * Text lines the input area shows at most. The input box grows with the prompt up to this
 * height and scrolls the overflow inside the box, so a multi-line prompt stays readable.
 */
const EDITOR_MAX_CONTENT_HEIGHT = 12;

/** Width of the input box on the empty-session screen. */
const EMPTY_SESSION_EDITOR_WIDTH = 72;

/** How often the sidebar asks the server for the sessions while a turn runs. */
const SESSION_LIST_REFRESH_INTERVAL_MS = 1000;

/** How long a repeated click on the same sidebar row is ignored. */
const SIDEBAR_SELECTION_DEBOUNCE_MS = 500;

function createFuzzyAutocompleteItems<T>(
	items: T[],
	prefix: string,
	getSearchText: (item: T) => string,
	toAutocompleteItem: (item: T) => AutocompleteItem,
): AutocompleteItem[] | null {
	const filtered = fuzzyFilter(items, prefix, getSearchText);
	if (filtered.length === 0) return null;
	return filtered.map(toAutocompleteItem);
}

function getLoginProviderCompletionOptions(
	providerOptions: readonly AuthSelectorProvider[],
): LoginProviderCompletionOption[] {
	const byId = new Map<string, LoginProviderCompletionOption>();
	for (const provider of providerOptions) {
		const existing = byId.get(provider.id);
		if (existing) {
			if (!existing.authTypes.includes(provider.authType)) {
				existing.authTypes.push(provider.authType);
				existing.authTypes.sort((a, b) => AUTH_TYPE_ORDER[a] - AUTH_TYPE_ORDER[b]);
			}
			continue;
		}
		byId.set(provider.id, {
			id: provider.id,
			name: provider.name,
			authTypes: [provider.authType],
			subscription: provider.subscription,
		});
	}
	return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function getLoginProviderSearchText(provider: LoginProviderCompletionOption): string {
	const authTypes = provider.authTypes
		.map((authType) => `${authType} ${formatAuthSelectorProviderType(authType, provider.subscription)}`)
		.join(" ");
	return `${provider.id} ${provider.name} ${authTypes}`;
}

function formatLoginProviderCompletionDescription(provider: LoginProviderCompletionOption): string {
	const authTypes = provider.authTypes
		.map((authType) => formatAuthSelectorProviderType(authType, provider.subscription))
		.join("/");
	return provider.name === provider.id ? authTypes : `${provider.name} · ${authTypes}`;
}

/**
 * Options for InteractiveMode initialization.
 */
export interface InteractiveModeOptions {
	/** Providers that were migrated to auth.json (shows warning) */
	migratedProviders?: string[];
	/** Diagnostics collected before the interactive TUI was initialized. */
	startupDiagnostics?: AgentSessionRuntimeDiagnostic[];
	/** Warning message if session model couldn't be restored */
	modelFallbackMessage?: string;
	/** Cwd to trust after reload if it gained a .pi directory during this implicitly trusted session. */
	autoTrustOnReloadCwd?: string;
	/** Initial message to send on startup (can include @file content) */
	initialMessage?: string;
	/** Images to attach to the initial message */
	initialImages?: ImageContent[];
	/** Additional messages to send after the initial message */
	initialMessages?: string[];
	/** Force verbose startup (overrides quietStartup setting) */
	verbose?: boolean;
	/** TUI layout mode. */
	tuiMode?: TuiMode;
	/** Initial interactive theme setting for this invocation. */
	initialThemeSetting?: string;
	/** Terminal implementation. Defaults to the current process terminal. */
	terminal?: Terminal;
}

export class InteractiveMode {
	private facade: SessionFacade;
	private renderer: TuiMainScreen | TuiAltScreen;
	private ui: TUI;
	private mainScreenRenderState: TuiMainScreenRenderState | undefined;
	private resourceDiagnosticsContainer: Container;
	private chatContainer: Container;
	private documentContainer: Container;
	private transcriptScrollView: TuiLayouts.ScrollView | undefined;
	private fullscreenLayoutRoot: Component | undefined;
	/** The session list beside the conversation, when the sidebar is enabled. */
	private sessionSidebar: SessionSidebar | undefined;
	/** The client that asks the server about itself. */
	private serverClient: PiServerClient | undefined;
	/** The registration of the server, read once. */
	private serverRegistration: ServerRegistration | undefined;
	/** Whether the registration was already read. */
	private serverRegistrationRead = false;
	/** What the server told the client about itself. */
	private serverInfo: ClientServerInfo | undefined;
	/** The timer that refreshes the session list while a turn runs. */
	private sessionListTimer: ReturnType<typeof setInterval> | undefined;
	/** The session files of the listed sessions, by session id. */
	private sessionPaths = new Map<string, string>();
	/** The last session the sidebar asked for, so a repeated click is ignored. */
	private lastSidebarSelection: { selection: SessionSidebarSelection; at: number } | undefined;
	private progressBar: AgentProgressBar;
	/** True while the agent runs, so a compaction inside a run does not end the progress bar. */
	private agentRunActive = false;
	private pendingMessagesContainer: Container;
	private statusContainer: Container;
	private defaultEditor: CustomEditor;
	private editor: ActiveEditor;
	private editorComponentFactory: EditorFactory | undefined;
	private autocompleteProvider: AutocompleteProvider | undefined;
	private autocompleteProviderWrappers: AutocompleteProviderFactory[] = [];
	private fdPath: string | undefined;
	private editorContainer: Container;
	/** The spinning logo above a centered input box, shown while the session is empty. */
	private emptySessionScreen: EmptySessionScreen | undefined;
	private emptySessionLogo: PiLogo3d | undefined;
	private emptySessionActive = false;
	private activeSelectorToken?: object;
	private activeSelectorDispose?: () => void;
	private footer: FooterComponent;
	private footerContainer: Container;
	private footerDataProvider: FooterDataProvider;
	// Stored so the same manager can be injected into custom editors, selectors, and extension UI.
	private keybindings: KeybindingsManager;
	private version: string;
	private isInitialized = false;
	private readonly launchContinuesSession: boolean;
	private introAllowed: boolean;
	private introShown = true;
	private onInputCallback?: (text: string) => void;
	private pendingUserInputs: string[] = [];
	/**
	 * User messages echoed into the chat the moment they are submitted, waiting for the run's own
	 * user message. The echo keeps the UI responsive while the run is prepared (extension hooks,
	 * compaction checks, session writes) before the request goes out.
	 */
	private pendingUserMessageEchoes: Array<{ text: string; component: UserMessageComponent; spacer?: Spacer }> = [];
	private activeStatusIndicator: StatusIndicator | undefined = undefined;
	private readonly idleStatus = new IdleStatus();
	private workingMessage: string | undefined = undefined;
	private workingVisible = true;
	private workingIndicatorOptions: WorkingIndicatorOptions | undefined = undefined;
	private readonly defaultWorkingMessage = "Working";
	private readonly defaultHiddenThinkingLabel = "Thinking...";
	private hiddenThinkingLabel = this.defaultHiddenThinkingLabel;

	private lastSigintTime = 0;
	private lastEscapeTime = 0;
	private changelogMarkdown: string | undefined = undefined;
	private startupNoticesShown = false;
	private anthropicSubscriptionWarningShown = false;

	// Status line tracking (for mutating immediately-sequential status updates)
	private lastStatusSpacer: Spacer | undefined = undefined;
	private lastStatusText: ThemedText | undefined = undefined;
	private lastStatusMessage = "";
	private managedToolStatusStarted = false;

	// Streaming message tracking
	private streamingComponent: AssistantMessageComponent | undefined = undefined;
	private readonly entriesRenderedByBoundaryCompaction = new Set<string>();
	private streamingMessage: AssistantMessage | undefined = undefined;

	// Tool execution tracking: toolCallId -> component
	private pendingTools = new Map<string, ToolExecutionComponent>();

	// The tool definitions the server reported, keyed by tool name.
	private readonly toolDefinitions = new Map<string, ToolDefinition | undefined>();

	// Tool output expansion state
	private toolOutputExpanded = false;

	// Thinking block visibility state
	private hideThinkingBlock = false;
	private outputPad = 1;
	private readonly mermaidMarkdownTransformer: MarkdownTransformer = createMermaidMarkdownTransformer({
		getMode: () => this.settingsManager.getMermaidRenderingMode(),
		theme,
	});

	// Agent subscription unsubscribe function
	private unsubscribe?: () => void;
	private signalCleanupHandlers: Array<() => void> = [];

	// Track if editor is in bash mode (text starts with !)
	private isBashMode = false;

	// Track current bash execution component
	private bashComponent: BashExecutionComponent | undefined = undefined;

	// Track pending bash components (shown in pending area, moved to chat on submit)
	private pendingBashComponents: BashExecutionComponent[] = [];

	// Auto-compaction state
	private autoCompactionEscapeHandler?: () => void;

	// Auto-retry state
	private retryEscapeHandler?: () => void;

	// Messages queued while compaction is running
	private compactionQueuedMessages: CompactionQueuedMessage[] = [];

	// Shutdown state
	private shutdownRequested = false;

	/** Reports working, blocked, done, and error states to terminals that support OSC 7501. */
	private readonly programStatus = new ProgramStatusReporter(
		() => this.ui.terminal,
		() => this.sessionManager.getSessionName(),
	);

	/** The `/bug` hint is shown at most once per session so error output stays readable. */
	private bugReportHintShown = false;
	private installChangeWarningShown = false;

	// Extension UI state
	private extensionSelector: ExtensionSelectorComponent | undefined = undefined;
	private extensionInput: ExtensionInputComponent | undefined = undefined;
	private extensionEditor: ExtensionEditorComponent | undefined = undefined;
	private extensionTerminalInputSubscriptions = new Set<{
		handler: (data: string) => { consume?: boolean; data?: string } | undefined;
		unsubscribe: () => void;
	}>();

	// Extension widgets (components rendered above/below the editor)
	private extensionWidgetsAbove = new Map<string, Component & { dispose?(): void }>();
	private extensionWidgetsBelow = new Map<string, Component & { dispose?(): void }>();
	private widgetContainerAbove!: Container;
	private widgetContainerBelow!: Container;
	private warningContainer!: Container;
	private warningText: ThemedText | undefined = undefined;

	// Custom footer from extension (undefined = use built-in footer)
	private customFooter: (Component & { dispose?(): void }) | undefined = undefined;

	// Header container that holds the built-in or custom header
	private headerContainer: Container;

	// Built-in header (logo + keybinding hints + changelog)
	private builtInHeader: Component | undefined = undefined;

	// Custom header from extension (undefined = use built-in header)
	private customHeader: (Component & { dispose?(): void }) | undefined = undefined;

	private options: InteractiveModeOptions;
	private readonly onRightClickPaste = (): void => {
		void this.handleRightClickPaste();
	};
	private autoTrustOnReloadCwd: string | undefined;
	private themeController: InteractiveThemeController;

	/**
	 * The extensions the client loaded from its own directories.
	 *
	 * Only the rendering parts of an extension belong to the client. The tools and the event
	 * handlers run in the server's process.
	 */
	private clientExtensions: ClientExtensionRuntime | undefined;

	// Convenience accessors
	private get agent() {
		return this.facade.agent;
	}
	private get sessionManager() {
		return this.facade.sessionManager;
	}
	private get settingsManager() {
		return this.facade.settingsManager;
	}

	constructor(facade: SessionFacade, options: InteractiveModeOptions = {}) {
		this.facade = facade;
		this.launchContinuesSession = this.sessionManager.isContinuation();
		this.introAllowed = !this.launchContinuesSession;
		this.introShown = !this.launchContinuesSession;
		setCapabilityOverrides(this.settingsManager.getTerminalCapabilityOverrides());
		const tuiMode = options.tuiMode ?? this.settingsManager.getTuiMode();
		this.options = { ...options, tuiMode };
		this.autoTrustOnReloadCwd = options.autoTrustOnReloadCwd;
		this.facade.setBeforeSessionInvalidate(() => {
			this.resetExtensionUI();
		});
		this.facade.setRebindSession(async () => {
			this.introAllowed = false;
			this.hideStartupIntro();
			await this.rebindCurrentSession({ renderBeforeBind: true });
			this.themeController.applyFromSettings();
		});
		this.version = VERSION;
		this.renderer = createInteractiveTui({
			tuiMode,
			showHardwareCursor: this.settingsManager.getShowHardwareCursor(),
			logDirectory: getAgentDir(),
			terminal: options.terminal,
			onRightClickPaste: this.onRightClickPaste,
			fullscreenCopyOnSelect: this.settingsManager.getFullscreenCopyOnSelect(),
			fullscreenWheelScrollLines: this.settingsManager.getFullscreenWheelScrollLines(),
		});
		this.ui = createInteractiveTuiReference(() => this.renderer);
		this.ui.setClearOnShrink(this.settingsManager.getClearOnShrink());
		this.progressBar = new AgentProgressBar(this.ui);
		this.updateProgressBar();
		this.headerContainer = new Container();
		this.resourceDiagnosticsContainer = new Container();
		this.chatContainer = new Container();
		this.documentContainer = new Container();
		this.documentContainer.addChild(this.headerContainer);
		this.documentContainer.addChild(this.resourceDiagnosticsContainer);
		this.documentContainer.addChild(this.chatContainer);
		this.pendingMessagesContainer = new Container();
		this.statusContainer = new Container();
		this.widgetContainerAbove = new Container();
		this.widgetContainerBelow = new Container();
		this.warningContainer = new Container();
		this.keybindings = KeybindingsManager.create();
		setKeybindings(this.keybindings);
		const editorPaddingX = this.settingsManager.getEditorPaddingX();
		const autocompleteMaxVisible = this.settingsManager.getAutocompleteMaxVisible();
		this.defaultEditor = new CustomEditor(this.ui, getEditorTheme(), this.keybindings, {
			paddingX: editorPaddingX,
			autocompleteMaxVisible,
			autocompletePosition: this.settingsManager.getAutocompletePosition(),
			maxContentHeight: EDITOR_MAX_CONTENT_HEIGHT,
			showScrollHints: false,
		});
		this.editor = this.defaultEditor;
		this.editorContainer = new Container();
		this.editorContainer.addChild(this.editor as Component);
		this.footerDataProvider = new FooterDataProvider(this.sessionManager.getCwd());
		this.footer = new FooterComponent(this.facade, this.footerDataProvider);
		this.footer.setNerdFonts(this.settingsManager.getNerdFonts());
		this.footerContainer = new Container();
		this.footerContainer.addChild(this.footer);

		// Load hide thinking block setting
		this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
		this.outputPad = this.settingsManager.getOutputPad();

		// Register themes from resource loader and initialize
		this.themeController = new InteractiveThemeController(this.ui, {
			getSettingsManager: () => this.settingsManager,
			showError: (message) => this.showError(message),
			onChanged: () => this.updateEditorBorderColor(),
			initialThemeSetting: options.initialThemeSetting,
		});
	}

	/**
	 * The commands of an extension that clash with a built-in interactive command.
	 *
	 * The server's resource snapshot merges the built-in commands with the commands of the
	 * extensions, so only the commands of an extension can be a conflict. A command that
	 * carries its source is an extension command when it says so. Without the source, the
	 * built-in command is the first one with that name, because the server puts the
	 * built-in commands first.
	 */
	private getBuiltInCommandConflictDiagnostics(extensionRunner: SessionExtensionRunner): ResourceDiagnostic[] {
		const builtinNames = new Set(BUILTIN_SLASH_COMMANDS.map((command) => command.name));
		const builtinAliases = new Set(BUILTIN_SLASH_COMMANDS.flatMap((command) => command.aliases ?? []));
		const seenBuiltin = new Set<string>();
		return extensionRunner
			.getRegisteredCommands()
			.filter((command) => builtinNames.has(command.name) || builtinAliases.has(command.name))
			.filter((command) => {
				const source = "source" in command && typeof command.source === "string" ? command.source : undefined;
				if (source !== undefined) return source === "extension";
				if (!builtinNames.has(command.name)) return true;
				if (seenBuiltin.has(command.name)) return true;
				seenBuiltin.add(command.name);
				return false;
			})
			.map((command) => ({
				type: "warning" as const,
				message:
					command.invocationName === command.name
						? `Extension command '/${command.name}' conflicts with built-in interactive command. Skipping in autocomplete.`
						: `Extension command '/${command.name}' conflicts with built-in interactive command. Available as '/${command.invocationName}'.`,
			}));
	}

	private createBaseAutocompleteProvider(): AutocompleteProvider {
		// Define commands for autocomplete. An alias is offered as its own entry, so it
		// can be found in the picker.
		const slashCommands: SlashCommand[] = [
			...BUILTIN_SLASH_COMMANDS.flatMap((command) => [
				{
					name: command.name,
					description: command.description,
					...(command.argumentHint && { argumentHint: command.argumentHint }),
				},
				...(command.aliases ?? []).map((alias) => ({
					name: alias,
					description: command.description,
				})),
			]),
			...CLIENT_SLASH_COMMANDS.map((command) => ({
				name: command.name,
				description: command.description,
			})),
		];

		const modelCommand = slashCommands.find((command) => command.name === "model");
		if (modelCommand) {
			modelCommand.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null => {
				const models =
					this.facade.scopedModels.length > 0
						? this.facade.scopedModels.map((s) => s.model)
						: this.facade.modelRuntime.getAvailableSnapshot();

				if (models.length === 0) return null;

				// Create items with provider/id format
				const items = models.map((m) => ({
					id: m.id,
					provider: m.provider,
					name: m.name,
					label: `${m.provider}/${m.id}`,
				}));

				return createFuzzyAutocompleteItems(items, prefix, getModelSearchText, (item) => ({
					value: item.label,
					label: item.id,
					description: item.provider,
				}));
			};
		}

		const thinkingCommand = slashCommands.find((command) => command.name === "thinking");
		if (thinkingCommand) {
			thinkingCommand.getArgumentCompletions = async (prefix: string): Promise<AutocompleteItem[] | null> => {
				return createFuzzyAutocompleteItems(
					await this.facade.getAvailableThinkingLevels(),
					prefix,
					(level) => level,
					(level) => ({
						value: level,
						label: level,
					}),
				);
			};
		}

		const loginCommand = slashCommands.find((command) => command.name === "login");
		if (loginCommand) {
			loginCommand.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null => {
				const providers = getLoginProviderCompletionOptions(this.getLoginProviderOptions());
				return createFuzzyAutocompleteItems(providers, prefix, getLoginProviderSearchText, (provider) => ({
					value: provider.id,
					label: provider.id,
					description: formatLoginProviderCompletionDescription(provider),
				}));
			};
		}

		// Convert prompt templates to SlashCommand format for autocomplete
		const templateCommands: SlashCommand[] = this.facade.promptTemplates.map((cmd) => ({
			name: cmd.name,
			description: cmd.description,
			...(cmd.argumentHint && { argumentHint: cmd.argumentHint }),
		}));

		// Convert extension commands to SlashCommand format
		const builtinCommandNames = new Set(slashCommands.map((c) => c.name));
		const extensionCommands: SlashCommand[] = this.facade.extensionRunner
			.getRegisteredCommands()
			.filter((cmd) => !builtinCommandNames.has(cmd.name))
			.map((cmd) => ({
				name: cmd.invocationName,
				description: cmd.description,
				getArgumentCompletions: cmd.getArgumentCompletions,
			}));

		// The commands of the client-side extensions run in the client.
		const clientCommands: SlashCommand[] = (this.clientExtensions?.getCommands() ?? [])
			.filter((cmd) => !builtinCommandNames.has(cmd.name))
			.map((cmd) => ({
				name: cmd.invocationName,
				description: cmd.description,
				getArgumentCompletions: cmd.getArgumentCompletions,
			}));

		// Skills are offered as "@name" mentions next to the file completions
		const skillMentions: AutocompleteItem[] = this.facade.resourceLoader.getSkills().skills.map((skill) => ({
			value: `@${skill.name}`,
			label: `@${skill.name}`,
			description: skill.description,
		}));

		return new CombinedAutocompleteProvider(
			[...slashCommands, ...templateCommands, ...extensionCommands, ...clientCommands],
			this.sessionManager.getCwd(),
			this.fdPath,
			skillMentions,
		);
	}

	private setupAutocompleteProvider(): void {
		let provider = this.createBaseAutocompleteProvider();
		const triggerCharacters: string[] = [];
		for (const wrapProvider of this.autocompleteProviderWrappers) {
			provider = wrapProvider(provider);
			triggerCharacters.push(...(provider.triggerCharacters ?? []));
		}
		if (triggerCharacters.length > 0) {
			provider.triggerCharacters = [...new Set(triggerCharacters)];
		}

		this.autocompleteProvider = provider;
		this.defaultEditor.setAutocompleteProvider(provider);
		if (this.editor !== this.defaultEditor) {
			this.editor.setAutocompleteProvider?.(provider);
		}
	}

	private showStartupNoticesIfNeeded(): void {
		if (this.startupNoticesShown) {
			return;
		}
		this.startupNoticesShown = true;

		if (!this.changelogMarkdown) {
			return;
		}

		if (this.chatContainer.children.length > 0) {
			this.chatContainer.addChild(new Spacer(1));
		}
		this.chatContainer.addChild(new DynamicBorder());
		if (this.settingsManager.getCollapseChangelog()) {
			const versionMatch = this.changelogMarkdown.match(/##\s+\[?(\d+\.\d+\.\d+)\]?/);
			const latestVersion = versionMatch ? versionMatch[1] : this.version;
			const condensedText = `Updated to v${latestVersion}. Use ${theme.bold("/changelog")} to view full changelog.`;
			this.chatContainer.addChild(new Text(condensedText, 1, 0));
		} else {
			this.chatContainer.addChild(new ThemedText(() => theme.bold(theme.fg("accent", "What's New")), 1, 0));
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(
				new Markdown(this.changelogMarkdown.trim(), 1, 0, this.getMarkdownThemeWithSettings()),
			);
			this.chatContainer.addChild(new Spacer(1));
		}
		this.chatContainer.addChild(new DynamicBorder());
	}

	private mountInteractiveTui(tui: TuiMainScreen | TuiAltScreen, components: readonly Component[]): void {
		for (const component of components) tui.addChild(component);
		if (TuiLayouts.isViewportTUI(tui)) {
			const root = this.layoutRoot();
			if (!root) throw new Error("Fullscreen layout is not initialized");
			tui.setLayoutRoot(root);
		}
	}

	/** The layout root of the fullscreen renderer. */
	private layoutRoot(): Component | undefined {
		if (this.emptySessionActive && this.emptySessionScreen) return this.emptySessionScreen;
		return this.fullscreenLayoutRoot;
	}

	/** The components mounted in the renderer. */
	private interactiveComponents(): Component[] {
		if (this.emptySessionActive && this.emptySessionScreen) return [this.emptySessionScreen];
		return [
			this.documentContainer,
			this.pendingMessagesContainer,
			// Regular mode scrolls its content, so the bar goes above the input box.
			this.progressBar,
			this.widgetContainerAbove,
			this.warningContainer,
			// The status sits directly above the input box, so the run state reads
			// as the line right on top of it.
			this.statusContainer,
			this.editorContainer,
			this.widgetContainerBelow,
			this.footerContainer,
		];
	}

	/** Load the spinning logo and the screen that shows it above a centered input box. */
	private async loadEmptySessionScreen(): Promise<void> {
		if (this.emptySessionScreen) return;
		const background = theme.appearance === "dark" ? ([0, 0, 0] as const) : ([255, 255, 255] as const);
		const logo = await loadPiLogo3d(this.ui, background);
		this.emptySessionLogo = logo;
		this.emptySessionScreen = new EmptySessionScreen(
			logo,
			this.emptySessionGreeting(),
			new Centered(this.editorContainer, EMPTY_SESSION_EDITOR_WIDTH),
			() => this.ui.terminal.rows,
		);
	}

	/** The greeting above the input box. */
	private emptySessionGreeting(): string {
		const username = os.userInfo().username;
		const name = username ? username.charAt(0).toUpperCase() + username.slice(1) : "there";
		return `Hi ${name}, what are we building today?`;
	}

	/** True when the setting is on and the session has no messages yet. */
	private shouldShowEmptySessionScreen(): boolean {
		if (!this.introAllowed) return false;
		return this.settingsManager.getThreeDEmptySession() && this.facade.state.messages.length === 0;
	}

	/** Show or hide the empty-session screen and remount the components. */
	private setEmptySessionScreen(active: boolean): void {
		if (active === this.emptySessionActive) return;
		this.emptySessionActive = active;
		this.applyAutocompletePosition();
		if (active) {
			void this.showEmptySessionScreen();
			return;
		}
		this.emptySessionLogo?.setActive(false);
		this.remountComponents();
	}

	/**
	 * The autocomplete position: below on the empty-session screen, where the list would
	 * otherwise cover the logo.
	 */
	private autocompletePosition(): "above" | "below" {
		return this.emptySessionActive ? "below" : this.settingsManager.getAutocompletePosition();
	}

	private applyAutocompletePosition(): void {
		const position = this.autocompletePosition();
		this.defaultEditor.setAutocompletePosition(position);
		if (this.editor !== this.defaultEditor) {
			this.editor.setAutocompletePosition?.(position);
		}
	}

	private async showEmptySessionScreen(): Promise<void> {
		await this.loadEmptySessionScreen();
		if (!this.emptySessionActive) return;
		this.emptySessionLogo?.setActive(true);
		this.remountComponents();
	}

	/** Update the empty-session screen after the session or the setting changed. */
	private syncEmptySessionScreen(): void {
		this.setEmptySessionScreen(this.shouldShowEmptySessionScreen());
	}

	/** Mount the components of the current layout again. */
	private remountComponents(): void {
		const tui = this.renderer;
		tui.clear();
		for (const component of this.interactiveComponents()) tui.addChild(component);
		if (TuiLayouts.isViewportTUI(tui)) {
			const root = this.layoutRoot();
			if (root) tui.setLayoutRoot(root);
		}
		tui.invalidate();
		tui.requestRender(true);
	}

	/**
	 * The progress bar is on top of the screen in fullscreen mode. Regular mode
	 * scrolls its content, so the bar sits above the input box there.
	 */
	private updateProgressBar(): void {
		this.progressBar.setEnabled(this.settingsManager.getShowTerminalProgress());
	}

	private stopInteractiveTui(fullscreenExitOutput: FullscreenExitOutput): void {
		if (this.renderer.mode === "fullscreen" && fullscreenExitOutput === "transcript") {
			while (this.renderer.hasOverlayEntries) this.renderer.hideOverlay();
			this.switchTuiMode("regular", false);
			this.renderer.renderNow();
		}
		this.ui.stop({ preserveScreen: this.renderer.mode === "fullscreen" });
	}

	private switchTuiMode(mode: TuiMode, startRenderer = true): boolean {
		const previousUi = this.renderer;
		if (mode === previousUi.mode) return true;
		if (previousUi.hasOverlayEntries) return false;

		const components = [...previousUi.children];
		const focus = previousUi.getFocusedComponent();
		const terminal = previousUi.terminal;
		const showHardwareCursor = previousUi.getShowHardwareCursor();
		const clearOnShrink = previousUi.getClearOnShrink();
		const onDebug = previousUi.onDebug;
		if (previousUi instanceof TuiMainScreen) {
			this.mainScreenRenderState = previousUi.captureRenderState();
		}

		previousUi.stop({ preserveScreen: true });
		previousUi.setFocus(null);
		previousUi.clear();
		if (TuiLayouts.isViewportTUI(previousUi)) previousUi.setLayoutRoot(undefined);

		const nextUi = createInteractiveTui({
			tuiMode: mode,
			showHardwareCursor,
			logDirectory: getAgentDir(),
			terminal,
			onRightClickPaste: this.onRightClickPaste,
			fullscreenCopyOnSelect: this.settingsManager.getFullscreenCopyOnSelect(),
			fullscreenWheelScrollLines: this.settingsManager.getFullscreenWheelScrollLines(),
		});
		nextUi.setClearOnShrink(clearOnShrink);
		nextUi.onDebug = onDebug;
		if (nextUi instanceof TuiMainScreen && this.mainScreenRenderState) {
			nextUi.restoreRenderState(this.mainScreenRenderState);
		}
		this.renderer = nextUi;
		this.options.tuiMode = mode;
		this.updateProgressBar();
		this.mountInteractiveTui(nextUi, components);
		nextUi.invalidate();
		nextUi.setFocus(focus);
		if (!startRenderer) return true;
		nextUi.start();
		this.themeController.rebindTui();
		this.rebindExtensionTerminalInputListeners();
		return true;
	}

	async init(): Promise<void> {
		if (this.isInitialized) return;

		this.registerSignalHandlers();

		// The extensions the client renders with are loaded before the first paint.
		await this.loadClientExtensions();

		// Load changelog (only show new entries, skip for resumed sessions)
		this.changelogMarkdown = this.getChangelogForDisplay();

		if (this.facade.scopedModels.length > 0 && this.shouldShowModelScope()) {
			const modelList = this.facade.scopedModels
				.map((sm) => {
					const thinkingStr = sm.thinkingLevel ? `:${sm.thinkingLevel}` : "";
					return `${sm.model.id}${thinkingStr}`;
				})
				.join(", ");
			const cycleKeys = this.keybindings.getKeys("app.model.cycleForward");
			const cycleHint =
				cycleKeys.length > 0
					? theme.fg("muted", ` (${formatKeyText(cycleKeys.join("/"), { capitalize: true })} to cycle)`)
					: "";
			console.log(theme.fg("dim", `Model scope: ${modelList}${cycleHint}`));
		}

		// Keep one component tree and remount it when changing renderers.
		this.renderWidgets(); // Initialize with default spacer
		if (this.settingsManager.getShowSessionSidebar()) {
			this.sessionSidebar = this.createSessionSidebar();
		}
		const viewport = this.createViewport();
		this.transcriptScrollView = viewport.transcript;
		this.fullscreenLayoutRoot = viewport.root;
		// The empty-session screen replaces the transcript while the session has no messages.
		if (this.shouldShowEmptySessionScreen()) {
			this.emptySessionActive = true;
			this.applyAutocompletePosition();
			await this.loadEmptySessionScreen();
			this.emptySessionLogo?.setActive(true);
		}
		this.mountInteractiveTui(this.renderer, this.interactiveComponents());
		// Accept text while startup completes, but only enable interrupt, exit, and submission feedback.
		this.defaultEditor.onAction("app.quit", () => this.handleQuit());
		this.defaultEditor.onCtrlD = () => this.handleCtrlD();
		this.defaultEditor.onSubmit = (text) => this.handleStartupSubmit(text);
		this.ui.setFocus(this.editor);

		// Start the UI before initializing extensions so session_start handlers can use interactive dialogs
		this.ui.start();
		this.isInitialized = true;
		this.programStatus.report();
		this.ensurePngTranscoder();

		this.themeController.applyFromSettings();
		// The header and startup notices bake theme colors into their text, so build them once the terminal
		// reported its colors. This ends at the terminal's DA1 reply, or after 100 ms if it answers nothing.
		await this.themeController.waitForTerminalColors();

		// Add header with keybindings from config (unless silenced)
		if (this.shouldShowStartupHeader()) {
			// Built on demand so the header follows theme changes. The logo's first line carries the version,
			// its second line the first line of key hints. Terminals that cannot render the logo get a
			// "Pi vX" line instead, with the key hints below it.
			const showLogo = supportsPiLogo();
			const withLogo = (hints: string) => {
				if (!showLogo) return `${piWordmark()} ${theme.fg("dim", `v${this.version}`)}\n${hints}`;
				const [top, bottom] = piLogoLines();
				return `${top} ${theme.fg("dim", `v${this.version}`)}\n${bottom} ${hints}`;
			};
			const logoOnly = () => withLogo("").trimEnd();

			// Build startup instructions using keybinding hint helpers
			const hint = (keybinding: AppKeybinding, description: string) => keyHint(keybinding, description);

			const expandedInstructions = () =>
				[
					hint("app.interrupt", "to interrupt"),
					rawKeyHint(`${keyText("app.quit")} twice`, "to exit"),
					hint("app.exit", "to exit (empty)"),
					hint("app.suspend", "to suspend"),
					keyHint("tui.editor.deleteToLineEnd", "to delete to end"),
					hint("app.thinking.cycle", "to cycle thinking level"),
					rawKeyHint(
						`${keyText("app.model.cycleForward")}/${keyText("app.model.cycleBackward")}`,
						"to cycle models",
					),
					hint("app.model.select", "to select model"),
					hint("app.tools.expand", "to expand tools"),
					hint("app.thinking.toggle", "to expand thinking"),
					hint("app.editor.external", "for external editor"),
					rawKeyHint("/", "for commands"),
					rawKeyHint("!", "to run bash"),
					rawKeyHint("!!", "to run bash (no context)"),
					hint("app.message.followUp", "to queue follow-up"),
					hint("app.message.dequeue", "to edit all queued messages"),
					hint("app.clipboard.pasteImage", "to paste files on macOS, images, or text"),
					rawKeyHint("drop files", "to attach"),
				].join("\n");
			const compactInstructions = () =>
				[
					hint("app.interrupt", "interrupt"),
					rawKeyHint(`${keyText("app.quit")} twice`, "to exit"),
					rawKeyHint("/", "commands"),
					rawKeyHint("!", "bash"),
					hint("app.tools.expand", "more"),
				].join(theme.fg("muted", " · "));
			const compactOnboarding = () =>
				theme.fg("dim", `Press ${keyText("app.tools.expand")} to show full startup help.`);
			const onboarding = () =>
				theme.fg("dim", `Pi can explain its own features and look up its docs. Ask it how to use or extend Pi.`);
			const header = new BuiltInHeader(
				() =>
					this.introShown
						? `${withLogo(compactInstructions())}\n${compactOnboarding()}\n\n${onboarding()}`
						: logoOnly(),
				() => (this.introShown ? `${withLogo(expandedInstructions())}\n\n${onboarding()}` : logoOnly()),
				this.getStartupExpansionState(),
				1,
				0,
			);
			if (showLogo) header.onLogoClick = (column, row) => playPiLogo3d(this.renderer, column, row);
			this.builtInHeader = header;

			// Setup UI layout
			this.headerContainer.addChild(new Spacer(1));
			this.headerContainer.addChild(this.builtInHeader);
			this.headerContainer.addChild(new Spacer(1));
		} else {
			// Minimal header when silenced
			this.builtInHeader = new Text("", 0, 0);
			this.headerContainer.addChild(this.builtInHeader);
		}
		this.ui.requestRender();

		// Ensure fd and rg are available after mounting the TUI (downloads if missing, adds to PATH via getBinDir)
		// so slow downloads do not make startup appear frozen.
		// Both are needed: fd for autocomplete, rg for grep tool and bash commands.
		const [fdPath] = await Promise.all([
			ensureTool("fd", (status) => this.showManagedToolStatus(status)),
			ensureTool("rg", (status) => this.showManagedToolStatus(status)),
		]);
		this.fdPath = fdPath;

		// Enable the remaining input handlers only after managed-tool setup completes.
		this.setupKeyHandlers();
		this.setupEditorSubmitHandler();
		this.ui.requestRender();

		// Initialize extensions first so resources are shown before messages
		await this.rebindCurrentSession();

		// Render initial messages AFTER showing resource diagnostics
		this.renderInitialMessages();

		// Set up theme file watcher
		onThemeChange(() => {
			this.ui.invalidate();
			this.updateEditorBorderColor();
			this.ui.requestRender();
		});

		// Set up git branch watcher (uses provider instead of footer)
		this.footerDataProvider.onBranchChange(() => {
			this.ui.requestRender();
		});

		// Initialize available provider count for footer display
		await this.updateAvailableProviderCount();

		// Flush the completed startup state before loading the remaining syntax grammars.
		this.ui.renderNow();
		// The sidebar lists the sessions the server knows about.
		void this.refreshSessionList();
		void loadAllHighlightLanguages().then(() => {
			if (!this.isInitialized) return;
			this.ui.invalidate();
			this.ui.requestRender();
		});
	}

	/**
	 * Update terminal title with session name and cwd.
	 */
	private updateTerminalTitle(): void {
		const cwdBasename = path.basename(this.sessionManager.getCwd());
		const sessionName = this.sessionManager.getSessionName();
		if (sessionName) {
			this.ui.terminal.setTitle(`${APP_TITLE} - ${sessionName} - ${cwdBasename}`);
		} else {
			this.ui.terminal.setTitle(`${APP_TITLE} - ${cwdBasename}`);
		}
	}

	/**
	 * Run the interactive mode. This is the main entry point.
	 * Initializes the UI, shows warnings, processes initial messages, and starts the interactive loop.
	 */
	async run(): Promise<void> {
		await this.init();

		// The client drives a server in another process, so the footer says which one.
		void this.updateServerStatus().catch(() => {});

		// The credentials live in the server's agent directory, so a server without a model
		// leaves the user with a TUI that cannot run a turn.
		if (!this.facade.model) {
			this.showWarning(
				"No model is configured on the server. Run /login in the server's agent directory, or set a default model, to run a turn.",
			);
		}

		if (!process.env.PI_OFFLINE) {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 15_000);
			void refreshModelCatalogs(this.facade.modelRuntime, controller.signal)
				.then(() => this.updateAvailableProviderCount())
				.catch(() => {})
				.finally(() => clearTimeout(timeout));
		}

		// Start version check asynchronously
		checkForNewPiVersion(this.version).then((newRelease) => {
			if (newRelease) {
				this.showNewVersionNotification(newRelease);
			}
		});

		// Start package update check asynchronously
		this.checkForPackageUpdates()
			.then((updates) => {
				if (updates.length > 0) {
					this.showPackageUpdateNotification(updates);
				}
			})
			.finally(() => {
				// On Windows, npm can overwrite the shared console title while checking
				// extension package versions. Restore Pi's title after the startup check.
				if (process.platform === "win32" && this.isInitialized) {
					this.updateTerminalTitle();
				}
			});

		// Check tmux keyboard setup asynchronously
		this.checkTmuxKeyboardSetup().then((warning) => {
			if (warning) {
				this.showWarning(warning);
			}
		});

		// Show startup warnings
		const {
			migratedProviders,
			startupDiagnostics,
			modelFallbackMessage,
			initialMessage,
			initialImages,
			initialMessages,
		} = this.options;

		for (const diagnostic of startupDiagnostics ?? []) {
			if (diagnostic.type === "error") {
				this.showError(diagnostic.message);
			} else if (diagnostic.type === "warning") {
				this.showWarning(diagnostic.message);
			} else {
				this.showStatus(diagnostic.message);
			}
		}

		if (migratedProviders && migratedProviders.length > 0) {
			this.showWarning(`Migrated credentials to auth.json: ${migratedProviders.join(", ")}`);
		}

		const modelsJsonError = this.facade.modelRuntime.getError();
		if (modelsJsonError) {
			this.showError(`models.json error: ${modelsJsonError}`);
		}

		if (modelFallbackMessage) {
			this.showWarning(modelFallbackMessage);
		}

		const crash = takeUnnotifiedCrash();
		if (crash) {
			const when = new Date(crash.timestamp).toLocaleString();
			this.showWarning(
				`${APP_NAME} crashed on ${when} (${crash.message}). Run /bug to report it; the crash details are attached automatically.`,
			);
		}

		void this.maybeWarnAboutAnthropicSubscriptionAuth();

		// Process initial messages
		if (initialMessage) {
			try {
				await this.facade.prompt(initialMessage, { images: initialImages });
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
				this.showError(errorMessage);
			}
		}

		if (initialMessages) {
			for (const message of initialMessages) {
				try {
					await this.facade.prompt(message);
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
					this.showError(errorMessage);
				}
			}
		}

		// Main interactive loop
		while (true) {
			const userInput = await this.getUserInput();
			try {
				await this.facade.prompt(userInput, {
					preflightResult: (disposition) => {
						// "handled" means an extension took the prompt, so it never becomes a
						// user message and the echo of it has to go.
						if (disposition === "handled") {
							this.discardUserMessageEcho(userInput);
						}
					},
				});
			} catch (error: unknown) {
				this.discardUserMessageEcho(userInput);
				const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
				this.showError(errorMessage);
			}
		}
	}

	private async checkForPackageUpdates(): Promise<string[]> {
		if (process.env.PI_OFFLINE) {
			return [];
		}

		try {
			const packageManager = new DefaultPackageManager({
				cwd: this.sessionManager.getCwd(),
				agentDir: getAgentDir(),
				settingsManager: this.settingsManager,
			});
			const updates = await packageManager.checkForAvailableUpdates();
			return updates.map((update) => update.displayName);
		} catch {
			return [];
		}
	}

	private async checkTmuxKeyboardSetup(): Promise<string | undefined> {
		if (!process.env.TMUX) return undefined;

		const runTmuxShow = (option: string): Promise<string | undefined> => {
			return new Promise((resolve) => {
				const proc = spawn("tmux", ["show", "-gv", option], {
					stdio: ["ignore", "pipe", "ignore"],
				});
				let stdout = "";
				const timer = setTimeout(() => {
					proc.kill();
					resolve(undefined);
				}, 2000);

				proc.stdout?.on("data", (data) => {
					stdout += data.toString();
				});
				proc.on("error", () => {
					clearTimeout(timer);
					resolve(undefined);
				});
				proc.on("close", (code) => {
					clearTimeout(timer);
					resolve(code === 0 ? stdout.trim() : undefined);
				});
			});
		};

		const [extendedKeys, extendedKeysFormat] = await Promise.all([
			runTmuxShow("extended-keys"),
			runTmuxShow("extended-keys-format"),
		]);

		// If we couldn't query tmux (timeout, sandbox, etc.), don't warn
		if (extendedKeys === undefined) return undefined;

		if (extendedKeys !== "on" && extendedKeys !== "always") {
			return "tmux extended-keys is off. Modified Enter keys may not work. Add `set -g extended-keys on` to ~/.tmux.conf and restart tmux.";
		}

		if (extendedKeysFormat === "xterm") {
			return "tmux extended-keys-format is xterm. Pi works best with csi-u. Add `set -g extended-keys-format csi-u` to ~/.tmux.conf and restart tmux.";
		}

		return undefined;
	}

	/**
	 * Get changelog entries to display on startup.
	 * Only shows new entries since last seen version, skips for resumed sessions.
	 */
	private getChangelogForDisplay(): string | undefined {
		// Skip changelog for resumed/continued sessions (already have messages)
		if (this.facade.state.messages.length > 0) {
			return undefined;
		}

		const lastVersion = this.settingsManager.getLastChangelogVersion();
		const changelogPath = getChangelogPath();
		const entries = parseChangelog(changelogPath);

		if (!lastVersion) {
			// Fresh install - record the version, don't show changelog
			this.settingsManager.setLastChangelogVersion(VERSION);
			return undefined;
		}

		const newEntries = getNewEntries(entries, lastVersion);
		if (newEntries.length > 0) {
			this.settingsManager.setLastChangelogVersion(VERSION);
			return newEntries.map((e) => normalizeChangelogLinks(e.content, e)).join("\n\n");
		}

		return undefined;
	}

	private getMarkdownThemeWithSettings(): MarkdownTheme {
		return {
			...getMarkdownTheme(),
			codeBlockIndent: this.settingsManager.getCodeBlockIndent(),
		};
	}

	// =========================================================================
	// Extension System
	// =========================================================================

	private formatDisplayPath(p: string): string {
		const home = os.homedir();
		let result = p;

		// Replace home directory with ~
		if (result.startsWith(home)) {
			result = `~${result.slice(home.length)}`;
		}

		return result;
	}

	private getStartupExpansionState(): boolean {
		return this.options.verbose || this.toolOutputExpanded;
	}

	/** Startup header (logo, version, key hints). Hidden only by quietStartup: true. */
	private shouldShowStartupHeader(): boolean {
		return this.options.verbose === true || this.settingsManager.getQuietStartup() !== true;
	}

	/** The intro belongs to the launch session: a session replaced from inside drops it. */
	private hideStartupIntro(): void {
		if (!this.introShown) return;
		this.introShown = false;
		this.builtInHeader?.invalidate?.();
		this.ui.requestRender();
	}

	/** The model scope line. Hidden by quietStartup: true or "header". */
	private shouldShowModelScope(): boolean {
		return this.options.verbose === true || this.settingsManager.getQuietStartup() === false;
	}

	/**
	 * Get a short path relative to the package root for display.
	 */
	private getShortPath(fullPath: string, sourceInfo?: SourceInfo): string {
		const normalizedFullPath = fullPath.replace(/\\/g, "/");
		const baseDir = sourceInfo?.baseDir;
		if (baseDir && this.isPackageSource(sourceInfo)) {
			const normalizedBaseDir = baseDir.replace(/\\/g, "/");
			const npmRootMatch = normalizedBaseDir.match(/^(.*\/node_modules)\/(@?[^/]+(?:\/[^/]+)?)$/);
			// If fullPath is under the same node_modules root as baseDir, preserve that relative topology.
			if (npmRootMatch?.[1] && normalizedFullPath.startsWith(`${npmRootMatch[1]}/`)) {
				return path.posix.relative(normalizedBaseDir, normalizedFullPath);
			}

			const relativePath = path.relative(path.resolve(baseDir), path.resolve(fullPath));
			if (
				relativePath &&
				relativePath !== "." &&
				!relativePath.startsWith("..") &&
				!relativePath.startsWith(`..${path.sep}`) &&
				!path.isAbsolute(relativePath)
			) {
				return relativePath.replace(/\\/g, "/");
			}
		}

		const source = sourceInfo?.source ?? "";
		const npmMatch = normalizedFullPath.match(/node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/);
		if (npmMatch && source.startsWith("npm:")) {
			return npmMatch[2];
		}

		const gitMatch = normalizedFullPath.match(/git\/[^/]+\/[^/]+\/(.*)/);
		if (gitMatch && source.startsWith("git:")) {
			return gitMatch[1];
		}

		return this.formatDisplayPath(fullPath);
	}

	private getDisplaySourceInfo(sourceInfo?: SourceInfo): {
		label: string;
		scopeLabel?: string;
		color: "accent" | "muted";
	} {
		const source = sourceInfo?.source ?? "local";
		const scope = sourceInfo?.scope ?? "project";
		if (source === "local") {
			if (scope === "user") {
				return { label: "user", color: "muted" };
			}
			if (scope === "project") {
				return { label: "project", color: "muted" };
			}
			if (scope === "temporary") {
				return { label: "path", scopeLabel: "temp", color: "muted" };
			}
			return { label: "path", color: "muted" };
		}

		if (source === "cli") {
			return { label: "path", scopeLabel: scope === "temporary" ? "temp" : undefined, color: "muted" };
		}

		const scopeLabel =
			scope === "user" ? "user" : scope === "project" ? "project" : scope === "temporary" ? "temp" : undefined;
		return { label: source, scopeLabel, color: "accent" };
	}

	private isPackageSource(sourceInfo?: SourceInfo): boolean {
		const source = sourceInfo?.source ?? "";
		return source.startsWith("npm:") || source.startsWith("git:");
	}

	private findSourceInfoForPath(p: string, sourceInfos: Map<string, SourceInfo>): SourceInfo | undefined {
		const exact = sourceInfos.get(p);
		if (exact) return exact;

		let current = p;
		while (current.includes("/")) {
			current = current.substring(0, current.lastIndexOf("/"));
			const parent = sourceInfos.get(current);
			if (parent) return parent;
		}

		return undefined;
	}

	private formatPathWithSource(p: string, sourceInfo?: SourceInfo): string {
		if (sourceInfo) {
			const shortPath = this.getShortPath(p, sourceInfo);
			const { label, scopeLabel } = this.getDisplaySourceInfo(sourceInfo);
			const labelText = scopeLabel ? `${label} (${scopeLabel})` : label;
			return `${labelText} ${shortPath}`;
		}
		return this.formatDisplayPath(p);
	}

	private formatDiagnostics(diagnostics: readonly ResourceDiagnostic[], sourceInfos: Map<string, SourceInfo>): string {
		const lines: string[] = [];

		// Group collision diagnostics by name
		const collisions = new Map<string, ResourceDiagnostic[]>();
		const otherDiagnostics: ResourceDiagnostic[] = [];

		for (const d of diagnostics) {
			if (d.type === "collision" && d.collision) {
				const list = collisions.get(d.collision.name) ?? [];
				list.push(d);
				collisions.set(d.collision.name, list);
			} else {
				otherDiagnostics.push(d);
			}
		}

		// Format collision diagnostics grouped by name
		for (const [name, collisionList] of collisions) {
			const first = collisionList[0]?.collision;
			if (!first) continue;
			lines.push(theme.fg("warning", `  "${name}" collision:`));
			lines.push(
				theme.fg(
					"dim",
					`    ${theme.fg("success", "✓")} ${this.formatPathWithSource(first.winnerPath, this.findSourceInfoForPath(first.winnerPath, sourceInfos))}`,
				),
			);
			for (const d of collisionList) {
				if (d.collision) {
					lines.push(
						theme.fg(
							"dim",
							`    ${theme.fg("warning", "✗")} ${this.formatPathWithSource(d.collision.loserPath, this.findSourceInfoForPath(d.collision.loserPath, sourceInfos))} (skipped)`,
						),
					);
				}
			}
		}

		for (const d of otherDiagnostics) {
			if (d.path) {
				const formattedPath = this.formatPathWithSource(d.path, this.findSourceInfoForPath(d.path, sourceInfos));
				lines.push(theme.fg(d.type === "error" ? "error" : "warning", `  ${formattedPath}`));
				lines.push(theme.fg(d.type === "error" ? "error" : "warning", `    ${d.message}`));
			} else {
				lines.push(theme.fg(d.type === "error" ? "error" : "warning", `  ${d.message}`));
			}
		}

		return lines.join("\n");
	}

	/**
	 * Show resource diagnostics (conflicts and load errors) above the transcript.
	 */
	private showResourceDiagnostics(): void {
		// Resource rendering is idempotent; chat clears no longer clear this separate container.
		this.resourceDiagnosticsContainer.clear();

		const skillsResult = this.facade.resourceLoader.getSkills();

		const sourceInfos = new Map<string, SourceInfo>();
		for (const skill of skillsResult.skills) {
			if (skill.sourceInfo) {
				sourceInfos.set(skill.sourceInfo.path, skill.sourceInfo);
			}
		}
		for (const prompt of this.facade.promptTemplates) {
			if (prompt.sourceInfo) {
				sourceInfos.set(prompt.sourceInfo.path, prompt.sourceInfo);
			}
		}

		const addDiagnostics = (name: string, diagnostics: readonly ResourceDiagnostic[]): void => {
			if (diagnostics.length === 0) return;
			const warningLines = () => this.formatDiagnostics(diagnostics, sourceInfos);
			this.resourceDiagnosticsContainer.addChild(
				new ThemedText(() => `${theme.fg("warning", `[${name}]`)}\n${warningLines()}`, 0, 0),
			);
			this.resourceDiagnosticsContainer.addChild(new Spacer(1));
		};

		addDiagnostics("Skill conflicts", skillsResult.diagnostics);
		addDiagnostics("Extension issues", this.getBuiltInCommandConflictDiagnostics(this.facade.extensionRunner));
		addDiagnostics("Client extension issues", this.getClientExtensionDiagnostics());
	}

	/**
	 * The diagnostics of the extensions the client loaded.
	 *
	 * An extension that declares the server side is not an issue: it runs on the server and
	 * the client does not render with it. Only the load errors and the "both" extensions the
	 * server does not have are worth reporting.
	 */
	private getClientExtensionDiagnostics(): ResourceDiagnostic[] {
		const runtime = this.clientExtensions;
		if (!runtime) return [];
		const diagnostics: ResourceDiagnostic[] = [...runtime.diagnostics];
		diagnostics.push(...runtime.getDiagnostics(this.facade.sessionExtensions));
		return diagnostics;
	}

	/**
	 * Initialize the extension system with TUI-based UI context.
	 */
	private async bindCurrentSessionExtensions(): Promise<void> {
		const uiContext = this.createExtensionUIContext();
		await this.facade.bindExtensions({
			uiContext,
			abortHandler: () => {
				void this.restoreQueuedMessagesToEditor({ abort: true });
			},
		});

		this.setupAutocompleteProvider();
		this.showResourceDiagnostics();
		this.showStartupNoticesIfNeeded();
	}

	private applyFullscreenScrollbarSetting(): void {
		this.transcriptScrollView?.setScrollbar(this.settingsManager.getFullscreenScrollbar());
	}

	/** The chat viewport of the current layout, with the sidebar when it is enabled. */
	private createViewport(): ChatViewport {
		return createChatViewport({
			document: this.documentContainer,
			pendingMessages: this.pendingMessagesContainer,
			status: this.statusContainer,
			widgetsAbove: this.widgetContainerAbove,
			warning: this.warningContainer,
			editor: this.editorContainer,
			widgetsBelow: this.widgetContainerBelow,
			footer: this.footerContainer,
			scrollbar: this.settingsManager.getFullscreenScrollbar(),
			scrollbarTrackStyle: (text) => theme.fg("scrollbarTrack", text),
			scrollbarThumbStyle: (text) => theme.fg("scrollbarThumb", text),
			progress: this.progressBar,
			sidebar: this.sessionSidebar,
		});
	}

	/** Rebuilds the screen, so the sidebar can be shown or hidden while the TUI runs. */
	private rebuildViewport(): void {
		const viewport = this.createViewport();
		this.transcriptScrollView = viewport.transcript;
		this.fullscreenLayoutRoot = viewport.root;
		this.applyFullscreenScrollbarSetting();
		this.remountComponents();
	}

	/** The sidebar that lists the sessions the server knows about. */
	private createSessionSidebar(): SessionSidebar {
		return new SessionSidebar({
			onSelect: (selection) => {
				void this.handleSessionSidebarSelection(selection);
			},
		});
	}

	/** Shows or hides the session sidebar and remembers the choice. */
	private toggleSessionSidebar(): void {
		this.settingsManager.setShowSessionSidebar(!this.settingsManager.getShowSessionSidebar());
		this.applySessionSidebar();
	}

	/** Creates or removes the sidebar and rebuilds the screen around it. */
	private applySessionSidebar(): void {
		const enabled = this.settingsManager.getShowSessionSidebar();
		this.sessionSidebar = enabled ? (this.sessionSidebar ?? this.createSessionSidebar()) : undefined;
		if (!enabled) {
			this.stopSessionListRefresh();
			this.sessionPaths.clear();
		}
		this.rebuildViewport();
		if (enabled) void this.refreshSessionList();
	}

	/** Opens the session of the picked row, or starts a new one. */
	private async handleSessionSidebarSelection(selection: SessionSidebarSelection): Promise<void> {
		// The sidebar reports a click twice, once for the press and once for the
		// click the terminal sends afterwards. The second report is ignored.
		const now = Date.now();
		const last = this.lastSidebarSelection;
		if (last !== undefined && last.selection === selection && now - last.at < SIDEBAR_SELECTION_DEBOUNCE_MS) {
			return;
		}
		this.lastSidebarSelection = { selection, at: now };
		try {
			if (selection === "new") {
				await this.facade.newSession();
				await this.refreshSessionList();
				return;
			}
			const path = this.sessionPaths.get(selection);
			if (path === undefined) {
				await this.facade.switchTo(selection);
			} else {
				const result = await this.facade.switchSession(path);
				if (result.cancelled) return;
			}
			await this.refreshSessionList();
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	/** The registration of the server the client talks to. */
	private getServerRegistration(): ServerRegistration | undefined {
		if (!this.serverRegistrationRead) {
			this.serverRegistrationRead = true;
			this.serverRegistration = readServerRegistration(this.facade.agentDir);
		}
		return this.serverRegistration;
	}

	/** The client that asks the server about itself. */
	private getServerClient(): PiServerClient | undefined {
		if (this.serverClient) return this.serverClient;
		const registration = this.getServerRegistration();
		if (!registration) return undefined;
		this.serverClient = new PiServerClient({ url: registration.url, password: registration.password });
		return this.serverClient;
	}

	/** What the server tells the client about itself. */
	private async loadServerInfo(): Promise<ClientServerInfo | undefined> {
		const client = this.getServerClient();
		if (!client) return undefined;
		try {
			const info = await client.info();
			return {
				url: client.serverUrl,
				pid: info.pid,
				urls: info.urls,
				version: info.version,
				mode: info.pid === process.pid ? "embedded" : "server-backed",
			};
		} catch {
			return undefined;
		}
	}

	/**
	 * Show the server the client is connected to in the footer.
	 *
	 * The client drives a server in another process, so the user needs to see which one.
	 */
	private async updateServerStatus(): Promise<void> {
		this.serverInfo = await this.loadServerInfo();
		this.applyServerStatus();
	}

	/** Put the server of the client into the footer. */
	private applyServerStatus(): void {
		try {
			if (this.serverInfo) {
				this.footerDataProvider.setExtensionStatus("server", `server ${hostPortOf(this.serverInfo.url)}`);
			} else {
				this.footerDataProvider.setExtensionStatus("server", undefined);
			}
			this.footer.invalidate();
			this.ui.requestRender();
		} catch {
			// The footer is not ready yet; the status shows up with the next render.
		}
	}

	/** Reads the sessions the server knows about and shows them in the sidebar. */
	private async refreshSessionList(): Promise<void> {
		const sidebar = this.sessionSidebar;
		if (!sidebar) return;
		let sessions: RemoteSessionInfo[];
		try {
			sessions = await this.facade.listSessions();
		} catch {
			// The server may be unreachable; the sidebar keeps the list it has.
			return;
		}
		const rows: SessionSidebarRow[] = [];
		const paths = new Map<string, string>();
		for (const session of sessions) {
			rows.push({
				id: session.id,
				title: session.name || session.firstMessage || session.id,
				directory: session.cwd,
				busy: session.busy,
			});
			paths.set(session.id, session.path);
		}
		this.sessionPaths = paths;
		sidebar.setSessions(rows);
		const current = this.sessionManager.getSessionId();
		const index = rows.findIndex((row) => row.id === current);
		if (index !== -1) sidebar.selectedIndex = index;
		this.ui.requestRender();
	}

	/** Refreshes the session list while a turn runs, so the working marker follows the run. */
	private startSessionListRefresh(): void {
		if (this.sessionListTimer) return;
		this.sessionListTimer = setInterval(() => {
			void this.refreshSessionList();
		}, SESSION_LIST_REFRESH_INTERVAL_MS);
	}

	private stopSessionListRefresh(): void {
		if (!this.sessionListTimer) return;
		clearInterval(this.sessionListTimer);
		this.sessionListTimer = undefined;
	}

	/** Lets extension images use the PNG transcoder; tool results register it themselves. */
	private ensurePngTranscoder(): void {
		ensurePngTranscoder(() => {
			this.ui.invalidate();
			this.ui.requestRender();
		});
	}

	private applyRuntimeSettings(): void {
		setCapabilityOverrides(this.settingsManager.getTerminalCapabilityOverrides());
		this.ensurePngTranscoder();
		configureHttpDispatcher(this.settingsManager.getHttpIdleTimeoutMs());
		this.applyFullscreenScrollbarSetting();
		if (this.renderer instanceof TuiAltScreen) {
			this.renderer.setCopyOnSelect(this.settingsManager.getFullscreenCopyOnSelect());
			this.renderer.setWheelScrollLines(this.settingsManager.getFullscreenWheelScrollLines());
		}
		this.footer.setSession(this.facade);
		this.footer.setNerdFonts(this.settingsManager.getNerdFonts());
		this.footerDataProvider.setCwd(this.sessionManager.getCwd());
		this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
		this.outputPad = this.settingsManager.getOutputPad();
		this.ui.setShowHardwareCursor(this.settingsManager.getShowHardwareCursor());
		const clearOnShrink = this.settingsManager.getClearOnShrink();
		this.ui.setClearOnShrink(clearOnShrink);
		if (!clearOnShrink && !this.activeStatusIndicator) {
			this.statusContainer.clear();
		}
		const editorPaddingX = this.settingsManager.getEditorPaddingX();
		const autocompleteMaxVisible = this.settingsManager.getAutocompleteMaxVisible();
		const autocompletePosition = this.autocompletePosition();
		this.defaultEditor.setPaddingX(editorPaddingX);
		this.defaultEditor.setAutocompleteMaxVisible(autocompleteMaxVisible);
		this.defaultEditor.setAutocompletePosition(autocompletePosition);
		if (this.editor !== this.defaultEditor) {
			this.editor.setPaddingX?.(editorPaddingX);
			this.editor.setAutocompleteMaxVisible?.(autocompleteMaxVisible);
			this.editor.setAutocompletePosition?.(autocompletePosition);
		}
	}

	private async rebindCurrentSession(options: { renderBeforeBind?: boolean } = {}): Promise<void> {
		const sessionId = this.sessionManager.getSessionId();

		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.programStatus.reset();
		this.applyRuntimeSettings();

		if (options.renderBeforeBind) {
			this.renderCurrentSessionState();
			this.subscribeToAgent();
		}

		await this.bindCurrentSessionExtensions();

		if (this.sessionManager.getSessionId() !== sessionId) {
			return;
		}

		if (!options.renderBeforeBind) {
			this.subscribeToAgent();
		}

		await this.updateAvailableProviderCount();
		this.updateEditorBorderColor();
		this.updateTerminalTitle();
		// A new or resumed session can be empty again, so the empty-session screen follows it.
		this.syncEmptySessionScreen();
		// The sidebar lists the sessions the server knows about.
		void this.refreshSessionList();
	}

	private async handleFatalRuntimeError(prefix: string, error: unknown): Promise<never> {
		const message = error instanceof Error ? error.message : String(error);
		this.showError(`${prefix}: ${message}`);
		const extensionHint = this.getCrashExtensionHint(error);
		if (extensionHint) {
			this.chatContainer.addChild(new ThemedText(() => theme.fg("warning", extensionHint), this.outputPad, 0));
		}
		if (this.recordCrash("fatal_error", error)) {
			const instructions = this.crashReportInstructions();
			this.chatContainer.addChild(new ThemedText(() => theme.fg("muted", instructions), this.outputPad, 0));
		}
		stopThemeWatcher();
		this.stop("transcript");
		process.exit(1);
	}

	private getCrashExtensionHint(error: unknown): string | undefined {
		try {
			return formatCrashExtensionHint(
				findExtensionStackMatches(error instanceof Error ? error.stack : undefined, []),
			);
		} catch {
			return undefined;
		}
	}

	/** Persist a crash so the next start can point the user at `/bug`. Returns false when nothing was written. */
	private recordCrash(kind: "uncaught_exception" | "fatal_error", error: unknown): boolean {
		try {
			return (
				recordCrash({
					kind,
					error,
					sessionFile: this.facade.sessionFile,
					cwd: this.facade.sessionManager.getCwd(),
				}) !== undefined
			);
		} catch {
			return false;
		}
	}

	private crashReportInstructions(): string {
		const resume = this.facade.sessionFile ? `run \`${APP_NAME} -r\` to resume the session, then` : "start pi and";
		return `To report this crash: ${resume} run /bug. The crash details are attached automatically.`;
	}

	private suggestBugReport(): void {
		if (this.bugReportHintShown) return;
		this.bugReportHintShown = true;
		this.chatContainer.addChild(
			new ThemedText(
				() => theme.fg("muted", `If this looks like a ${APP_NAME} bug, /bug sends a report to the developers.`),
				this.outputPad,
				0,
			),
		);
		this.ui.requestRender();
	}

	private maybeSuggestBugReport(message: AssistantMessage): void {
		if (message.stopReason !== "error" || isRetryableAssistantError(message)) return;
		if (/\b(?:abort(?:ed)?|cancel(?:l?ed)?)\b/i.test(message.errorMessage ?? "")) return;
		if (this.maybeShowInstallChangeWarning()) return;
		this.suggestBugReport();
	}

	/**
	 * After an error, check whether an update replaced or removed this install while the session ran.
	 * Code loaded on demand then fails with missing modules until restart (#10439). Returns true when
	 * the install changed.
	 */
	private maybeShowInstallChangeWarning(): boolean {
		if (this.installChangeWarningShown) return true;
		const change = detectInstallChange();
		if (!change) return false;
		this.installChangeWarningShown = true;
		const cause =
			change.kind === "updated"
				? `${APP_NAME} was updated to ${change.version} while this session was running (${VERSION})`
				: `The ${APP_NAME} installation this session runs from was removed or replaced`;
		const resumeCommand = formatResumeCommand(this.sessionManager);
		const restart = resumeCommand
			? `Restart with \`${resumeCommand}\` to continue this session.`
			: `Restart ${APP_NAME}.`;
		this.showWarning(`${cause}. Features that load code on demand can fail until restart. ${restart}`);
		return true;
	}

	private renderCurrentSessionState(): void {
		this.resourceDiagnosticsContainer.clear();
		this.chatContainer.clear();
		this.pendingMessagesContainer.clear();
		this.compactionQueuedMessages = [];
		this.pendingUserMessageEchoes = [];
		this.streamingComponent = undefined;
		this.streamingMessage = undefined;
		this.pendingTools.clear();
		this.renderInitialMessages();
	}

	/**
	 * Get a registered tool definition by name (for custom rendering).
	 */
	/**
	 * Extension-registered definition, falling back to the built-in one. The renderer components take
	 * whatever this returns, so they never reach into the tool registry themselves.
	 */
	private getRegisteredToolDefinition(toolName: string) {
		void this.loadToolDefinition(toolName);
		return withBuiltInRenderers(toolName, this.toolDefinitions.get(toolName));
	}

	/**
	 * Fetch the definition of a tool from the server.
	 *
	 * The renderers of the definition stay on the server, so only the built-in renderers
	 * reach the screen. The definition is cached, because the render path is synchronous.
	 */
	private async loadToolDefinition(toolName: string): Promise<void> {
		if (this.toolDefinitions.has(toolName)) return;
		if (!this.sessionHasTool(toolName)) return;
		this.toolDefinitions.set(toolName, undefined);
		try {
			this.toolDefinitions.set(toolName, await this.facade.getToolDefinition(toolName));
		} catch {
			this.toolDefinitions.delete(toolName);
		}
	}

	/**
	 * Whether the session has a tool with that name.
	 *
	 * The server owns the tools and publishes them in its resource snapshot, so the TUI
	 * knows which tools exist without asking the server about every one of them. A
	 * server that publishes no tools is asked anyway, so an older server keeps working.
	 */
	private sessionHasTool(toolName: string): boolean {
		const tools = this.facade.tools;
		if (tools.length === 0) return true;
		return tools.some((tool) => tool.name === toolName);
	}

	private getMarkdownTransformers(): MarkdownTransformer[] {
		return [this.mermaidMarkdownTransformer, ...(this.clientExtensions?.getMarkdownTransformers() ?? [])];
	}

	/**
	 * The renderers of a tool call.
	 *
	 * The client-side extensions get the first word, the built-in renderers are the fallback.
	 */
	private getToolRenderers(toolName: string) {
		const builtIn = this.getRegisteredToolDefinition(toolName);
		return this.clientExtensions?.resolveToolRenderers(toolName, () => builtIn) ?? builtIn;
	}

	/**
	 * Load the extensions the client can use.
	 *
	 * The client loads them from its own directories, the same way the server does, and keeps
	 * the ones that declared the client side.
	 */
	private async loadClientExtensions(): Promise<void> {
		try {
			const load = await loadClientExtensions({
				cwd: this.sessionManager.getCwd(),
				agentDir: this.facade.agentDir,
				settingsManager: this.settingsManager,
			});
			this.clientExtensions = new ClientExtensionRuntime(load);
			this.clientExtensions.registerThemes();
			this.setupClientExtensionShortcuts();
		} catch (error) {
			this.showError(
				`Failed to load the client extensions: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Bind the shortcuts of the client-side extensions to the editor.
	 */
	private setupClientExtensionShortcuts(): void {
		const shortcuts = this.clientExtensions?.getShortcuts(this.keybindings.getEffectiveConfig());
		if (!shortcuts || shortcuts.size === 0) return;
		this.defaultEditor.onExtensionShortcut = (data: string) => {
			for (const [key, shortcut] of shortcuts) {
				if (!matchesKey(data, key)) continue;
				const context = createClientExtensionContext({
					ui: this.createExtensionUIContext(),
					facade: this.facade,
					shutdown: () => {
						void this.shutdown();
					},
				});
				Promise.resolve(shortcut.handler(context)).catch((error) => {
					this.showError(`Shortcut handler error: ${error instanceof Error ? error.message : String(error)}`);
				});
				return true;
			}
			return false;
		};
	}

	/**
	 * The client-side extension command the input runs, if there is one.
	 */
	private findClientExtensionCommand(text: string): { command: ClientExtensionCommand; args: string } | undefined {
		if (!text.startsWith("/")) return undefined;
		const spaceIndex = text.indexOf(" ");
		const name = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);
		const command = (this.clientExtensions?.getCommands() ?? []).find(
			(candidate) => candidate.invocationName === name || candidate.name === name,
		);
		return command ? { command, args } : undefined;
	}

	/**
	 * Run a command of a client-side extension.
	 */
	private async runClientExtensionCommand(command: ClientExtensionCommand, args: string): Promise<void> {
		const context = createClientExtensionCommandContext({
			ui: this.createExtensionUIContext(),
			facade: this.facade,
			shutdown: () => {
				void this.shutdown();
			},
		});
		try {
			await command.handler(args, context);
		} catch (error) {
			this.showError(`Command error: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Keep the transcript where it is when a card expands or collapses, so the card does not
	 * move out from under the pointer that toggled it.
	 */
	private keepTranscriptPosition(): void {
		if (this.renderer instanceof TuiAltScreen) this.renderer.keepScrollPosition();
	}

	/**
	 * Set extension status text in the footer.
	 */
	private setExtensionStatus(key: string, text: string | undefined): void {
		this.footerDataProvider.setExtensionStatus(key, text);
		this.ui.requestRender();
	}

	/**
	 * Show the status indicator on its own line above the input box.
	 */
	private showStatusIndicator(indicator: StatusIndicator): void {
		this.activeStatusIndicator?.dispose();
		this.activeStatusIndicator = indicator;
		this.statusContainer.clear();
		this.statusContainer.addChild(indicator);
	}

	private clearStatusIndicator(kind?: StatusIndicator["kind"]): void {
		if (kind && this.activeStatusIndicator?.kind !== kind) {
			return;
		}
		const clearedIndicator = this.activeStatusIndicator;
		clearedIndicator?.dispose();
		this.activeStatusIndicator = undefined;
		this.statusContainer.clear();
		if (clearedIndicator && this.options.tuiMode === "regular" && this.ui.getClearOnShrink()) {
			this.statusContainer.addChild(this.idleStatus);
		}
	}

	private showWorkingStatusIndicator(): void {
		this.showStatusIndicator(
			new WorkingStatusIndicator(
				this.ui,
				this.workingMessage ?? this.defaultWorkingMessage,
				this.workingIndicatorOptions,
			),
		);
	}

	private setWorkingVisible(visible: boolean): void {
		this.workingVisible = visible;
		if (!visible) {
			this.clearStatusIndicator("working");
			this.ui.requestRender();
			return;
		}
		if (this.facade.isStreaming && this.activeStatusIndicator?.kind !== "working") {
			this.showWorkingStatusIndicator();
		}
		this.ui.requestRender();
	}

	private setWorkingIndicator(options?: WorkingIndicatorOptions): void {
		this.workingIndicatorOptions = options;
		if (this.activeStatusIndicator?.kind === "working") {
			this.activeStatusIndicator.setIndicator(options);
		}
		this.ui.requestRender();
	}

	private setHiddenThinkingLabel(label?: string): void {
		this.hiddenThinkingLabel = label ?? this.defaultHiddenThinkingLabel;
		for (const child of this.chatContainer.children) {
			if (child instanceof AssistantMessageComponent) {
				child.setHiddenThinkingLabel(this.hiddenThinkingLabel);
			}
		}
		if (this.streamingComponent) {
			this.streamingComponent.setHiddenThinkingLabel(this.hiddenThinkingLabel);
		}
		this.ui.requestRender();
	}

	/**
	 * Set an extension widget (string array or custom component).
	 */
	private setExtensionWidget(
		key: string,
		content: string[] | ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined,
		options?: ExtensionWidgetOptions,
	): void {
		const placement = options?.placement ?? "aboveEditor";
		const removeExisting = (map: Map<string, Component & { dispose?(): void }>) => {
			const existing = map.get(key);
			if (existing?.dispose) existing.dispose();
			map.delete(key);
		};

		removeExisting(this.extensionWidgetsAbove);
		removeExisting(this.extensionWidgetsBelow);

		if (content === undefined) {
			this.renderWidgets();
			return;
		}

		let component: Component & { dispose?(): void };

		if (Array.isArray(content)) {
			// Wrap string array in a Container with Text components
			const container = new Container();
			for (const line of content.slice(0, InteractiveMode.MAX_WIDGET_LINES)) {
				container.addChild(new Text(line, 1, 0));
			}
			if (content.length > InteractiveMode.MAX_WIDGET_LINES) {
				container.addChild(new ThemedText(() => theme.fg("muted", "... (widget truncated)"), 1, 0));
			}
			component = container;
		} else {
			// Factory function - create component
			component = content(this.ui, theme);
		}

		const targetMap = placement === "belowEditor" ? this.extensionWidgetsBelow : this.extensionWidgetsAbove;
		targetMap.set(key, component);
		this.renderWidgets();
	}

	private clearExtensionWidgets(): void {
		for (const widget of this.extensionWidgetsAbove.values()) {
			widget.dispose?.();
		}
		for (const widget of this.extensionWidgetsBelow.values()) {
			widget.dispose?.();
		}
		this.extensionWidgetsAbove.clear();
		this.extensionWidgetsBelow.clear();
		this.renderWidgets();
	}

	private resetExtensionUI(): void {
		if (this.extensionSelector) {
			this.hideExtensionSelector();
		}
		if (this.extensionInput) {
			this.hideExtensionInput();
		}
		if (this.extensionEditor) {
			this.hideExtensionEditor();
		}
		this.ui.hideOverlay();
		this.clearExtensionTerminalInputListeners();
		this.setExtensionFooter(undefined);
		this.setExtensionHeader(undefined);
		this.clearExtensionWidgets();
		this.footerDataProvider.clearExtensionStatuses();
		// The reset clears the footer statuses of the extensions, so the server goes back in.
		this.applyServerStatus();
		this.footer.invalidate();
		this.autocompleteProviderWrappers = [];
		this.setCustomEditorComponent(undefined);
		this.setupAutocompleteProvider();
		this.defaultEditor.onExtensionShortcut = undefined;
		this.updateTerminalTitle();
		this.workingMessage = undefined;
		this.workingVisible = true;
		this.setWorkingIndicator();
		if (this.activeStatusIndicator?.kind === "working") {
			this.activeStatusIndicator.setMessage(
				`${this.defaultWorkingMessage} (${keyText("app.interrupt")} to interrupt)`,
			);
		}
		this.setHiddenThinkingLabel();
	}

	// Maximum total widget lines to prevent viewport overflow
	private static readonly MAX_WIDGET_LINES = 10;

	/**
	 * Render all extension widgets to the widget container.
	 */
	private renderWidgets(): void {
		if (!this.widgetContainerAbove || !this.widgetContainerBelow) return;
		this.renderWidgetContainer(this.widgetContainerAbove, this.extensionWidgetsAbove, true, true);
		this.renderWidgetContainer(this.widgetContainerBelow, this.extensionWidgetsBelow, false, false);
		this.ui.requestRender();
	}

	private renderWidgetContainer(
		container: Container,
		widgets: Map<string, Component & { dispose?(): void }>,
		spacerWhenEmpty: boolean,
		leadingSpacer: boolean,
	): void {
		container.clear();

		if (widgets.size === 0) {
			if (spacerWhenEmpty) {
				container.addChild(new Spacer(1));
			}
			return;
		}

		if (leadingSpacer) {
			container.addChild(new Spacer(1));
		}
		for (const component of widgets.values()) {
			container.addChild(component);
		}
	}

	/**
	 * Set a custom footer component, or restore the built-in footer.
	 */
	private setExtensionFooter(
		factory:
			| ((tui: TUI, thm: Theme, footerData: ReadonlyFooterDataProvider) => Component & { dispose?(): void })
			| undefined,
	): void {
		// Dispose existing custom footer
		if (this.customFooter?.dispose) {
			this.customFooter.dispose();
		}

		this.footerContainer.clear();
		if (factory) {
			// Create and add custom footer, passing the data provider
			this.customFooter = factory(this.ui, theme, this.footerDataProvider);
			this.footerContainer.addChild(this.customFooter);
		} else {
			// Restore built-in footer
			this.customFooter = undefined;
			this.footerContainer.addChild(this.footer);
		}

		this.ui.requestRender();
	}

	/**
	 * Set a custom header component, or restore the built-in header.
	 */
	private setExtensionHeader(factory: ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined): void {
		// Header may not be initialized yet if called during early initialization
		if (!this.builtInHeader) {
			return;
		}

		// Dispose existing custom header
		if (this.customHeader?.dispose) {
			this.customHeader.dispose();
		}

		// Find the index of the current header in the header container
		const currentHeader = this.customHeader || this.builtInHeader;
		const index = this.headerContainer.children.indexOf(currentHeader);

		if (factory) {
			// Create and add custom header
			this.customHeader = factory(this.ui, theme);
			if (isExpandable(this.customHeader)) {
				this.customHeader.setExpanded(this.toolOutputExpanded);
			}
			if (index !== -1) {
				this.headerContainer.children[index] = this.customHeader;
			} else {
				// If not found (e.g. builtInHeader was never added), add at the top
				this.headerContainer.children.unshift(this.customHeader);
			}
		} else {
			// Restore built-in header
			this.customHeader = undefined;
			if (isExpandable(this.builtInHeader)) {
				this.builtInHeader.setExpanded(this.toolOutputExpanded);
			}
			if (index !== -1) {
				this.headerContainer.children[index] = this.builtInHeader;
			}
		}

		this.ui.requestRender();
	}

	private addExtensionTerminalInputListener(
		handler: (data: string) => { consume?: boolean; data?: string } | undefined,
	): () => void {
		const subscription = { handler, unsubscribe: this.ui.addInputListener(handler) };
		this.extensionTerminalInputSubscriptions.add(subscription);
		return () => {
			subscription.unsubscribe();
			this.extensionTerminalInputSubscriptions.delete(subscription);
		};
	}

	private rebindExtensionTerminalInputListeners(): void {
		for (const subscription of this.extensionTerminalInputSubscriptions) {
			subscription.unsubscribe();
			subscription.unsubscribe = this.ui.addInputListener(subscription.handler);
		}
	}

	private clearExtensionTerminalInputListeners(): void {
		for (const subscription of this.extensionTerminalInputSubscriptions) subscription.unsubscribe();
		this.extensionTerminalInputSubscriptions.clear();
	}

	private createExtensionUIContext(): ExtensionUIContext {
		return {
			select: (title, options, opts) => this.showExtensionSelector(title, options, opts),
			confirm: (title, message, opts) => this.showExtensionConfirm(title, message, opts),
			input: (title, placeholder, opts) => this.showExtensionInput(title, placeholder, opts),
			notify: (message, type) => this.showExtensionNotify(message, type),
			onTerminalInput: (handler) => this.addExtensionTerminalInputListener(handler),
			setStatus: (key, text) => this.setExtensionStatus(key, text),
			setWorkingMessage: (message) => {
				this.workingMessage = message;
				if (this.activeStatusIndicator?.kind === "working") {
					this.activeStatusIndicator.setMessage(message ?? this.defaultWorkingMessage);
				}
			},
			setWorkingVisible: (visible) => this.setWorkingVisible(visible),
			setWorkingIndicator: (options) => this.setWorkingIndicator(options),
			setHiddenThinkingLabel: (label) => this.setHiddenThinkingLabel(label),
			setWidget: (key, content, options) => this.setExtensionWidget(key, content, options),
			setFooter: (factory) => this.setExtensionFooter(factory),
			setHeader: (factory) => this.setExtensionHeader(factory),
			setTitle: (title) => this.ui.terminal.setTitle(title),
			custom: (factory, options) => this.showExtensionCustom(factory, options),
			pasteToEditor: (text) => this.editor.handleInput(`\x1b[200~${text}\x1b[201~`),
			setEditorText: (text) => this.editor.setText(text),
			getEditorText: () => this.editor.getExpandedText?.() ?? this.editor.getText(),
			editor: (title, prefill) => this.showExtensionEditor(title, prefill),
			addAutocompleteProvider: (factory) => {
				this.autocompleteProviderWrappers.push(factory);
				this.setupAutocompleteProvider();
			},
			setEditorComponent: (factory) => this.setCustomEditorComponent(factory),
			getEditorComponent: () => this.editorComponentFactory,
			get theme() {
				return theme;
			},
			getAllThemes: () => getAvailableThemesWithPaths(),
			getTheme: (name) => getThemeByName(name),
			setTheme: (themeOrName) => {
				if (themeOrName instanceof Theme) {
					return this.themeController.setThemeInstance(themeOrName);
				}
				const result = this.themeController.setThemeName(themeOrName);
				if (result.success) {
					if (this.settingsManager.getTheme() !== themeOrName) {
						this.settingsManager.setTheme(themeOrName);
					}
				}
				return result;
			},
			getToolsExpanded: () => this.toolOutputExpanded,
			setToolsExpanded: (expanded) => this.setToolsExpanded(expanded),
		};
	}

	/**
	 * Show a selector for extensions.
	 */
	private showExtensionSelector(
		title: string,
		options: string[],
		opts?: ExtensionUIDialogOptions,
		blocked: BlockedStatus = { kind: "question", message: title },
	): Promise<string | undefined> {
		return new Promise((resolve) => {
			if (opts?.signal?.aborted) {
				resolve(undefined);
				return;
			}

			const onAbort = () => {
				this.hideExtensionSelector();
				resolve(undefined);
			};
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			this.extensionSelector = new ExtensionSelectorComponent(
				title,
				options,
				(option) => {
					opts?.signal?.removeEventListener("abort", onAbort);
					this.hideExtensionSelector();
					resolve(option);
				},
				() => {
					opts?.signal?.removeEventListener("abort", onAbort);
					this.hideExtensionSelector();
					resolve(undefined);
				},
				{ tui: this.ui, timeout: opts?.timeout, onToggleToolsExpanded: () => this.toggleToolOutputExpansion() },
			);

			this.disposeActiveSelector();
			this.editorContainer.clear();
			this.editorContainer.addChild(this.extensionSelector);
			this.ui.setFocus(this.extensionSelector);
			// Extension dialogs share the editor slot: opening one replaces the status of a displaced one.
			this.programStatus.setBlocked("extension-dialog", blocked);
			this.ui.requestRender();
		});
	}

	/**
	 * Hide the extension selector.
	 */
	private hideExtensionSelector(): void {
		this.extensionSelector?.dispose();
		this.editorContainer.clear();
		this.editorContainer.addChild(this.editor);
		this.extensionSelector = undefined;
		this.programStatus.setBlocked("extension-dialog", undefined);
		this.ui.setFocus(this.editor);
		this.ui.requestRender();
	}

	/**
	 * Show a confirmation dialog for extensions.
	 */
	private async showExtensionConfirm(
		title: string,
		message: string,
		opts?: ExtensionUIDialogOptions,
	): Promise<boolean> {
		const result = await this.showExtensionSelector(`${title}\n${message}`, ["Yes", "No"], opts, {
			kind: "permission",
			message: title,
		});
		return result === "Yes";
	}

	private async promptForMissingSessionCwd(error: MissingSessionCwdError): Promise<string | undefined> {
		const confirmed = await this.showExtensionConfirm(
			"Session cwd not found",
			formatMissingSessionCwdPrompt(error.issue),
		);
		return confirmed ? error.issue.fallbackCwd : undefined;
	}

	/**
	 * Show a text input for extensions.
	 */
	private showExtensionInput(
		title: string,
		placeholder?: string,
		opts?: ExtensionUIDialogOptions,
	): Promise<string | undefined> {
		return new Promise((resolve) => {
			if (opts?.signal?.aborted) {
				resolve(undefined);
				return;
			}

			const onAbort = () => {
				this.hideExtensionInput();
				resolve(undefined);
			};
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			this.extensionInput = new ExtensionInputComponent(
				title,
				placeholder,
				(value) => {
					opts?.signal?.removeEventListener("abort", onAbort);
					this.hideExtensionInput();
					resolve(value);
				},
				() => {
					opts?.signal?.removeEventListener("abort", onAbort);
					this.hideExtensionInput();
					resolve(undefined);
				},
				{ tui: this.ui, timeout: opts?.timeout },
			);

			this.disposeActiveSelector();
			this.editorContainer.clear();
			this.editorContainer.addChild(this.extensionInput);
			this.ui.setFocus(this.extensionInput);
			this.programStatus.setBlocked("extension-dialog", { kind: "question", message: title });
			this.ui.requestRender();
		});
	}

	/**
	 * Hide the extension input.
	 */
	private hideExtensionInput(): void {
		this.extensionInput?.dispose();
		this.editorContainer.clear();
		this.editorContainer.addChild(this.editor);
		this.extensionInput = undefined;
		this.programStatus.setBlocked("extension-dialog", undefined);
		this.ui.setFocus(this.editor);
		this.ui.requestRender();
	}

	/**
	 * Show a multi-line editor for extensions (with Ctrl+G support).
	 */
	private showExtensionEditor(title: string, prefill?: string): Promise<string | undefined> {
		return new Promise((resolve) => {
			this.extensionEditor = new ExtensionEditorComponent(
				this.ui,
				this.keybindings,
				title,
				prefill,
				(value) => {
					this.hideExtensionEditor();
					resolve(value);
				},
				() => {
					this.hideExtensionEditor();
					resolve(undefined);
				},
				undefined,
				this.settingsManager.getExternalEditorCommand(),
			);

			this.disposeActiveSelector();
			this.editorContainer.clear();
			this.editorContainer.addChild(this.extensionEditor);
			this.ui.setFocus(this.extensionEditor);
			this.programStatus.setBlocked("extension-dialog", { kind: "question", message: title });
			this.ui.requestRender();
		});
	}

	/**
	 * Hide the extension editor.
	 */
	private hideExtensionEditor(): void {
		this.editorContainer.clear();
		this.editorContainer.addChild(this.editor);
		this.extensionEditor = undefined;
		this.programStatus.setBlocked("extension-dialog", undefined);
		this.ui.setFocus(this.editor);
		this.ui.requestRender();
	}

	/**
	 * Set a custom editor component from an extension.
	 * Pass undefined to restore the default editor.
	 */
	private setCustomEditorComponent(factory: EditorFactory | undefined): void {
		this.editorComponentFactory = factory;

		// Save text from current editor before switching
		const currentText = this.editor.getText();

		this.disposeActiveSelector();
		this.editorContainer.clear();

		if (factory) {
			// Create the custom editor with tui, theme, and keybindings
			const newEditor = factory(this.ui, getEditorTheme(), this.keybindings);

			// Wire up callbacks from the default editor
			newEditor.onSubmit = this.defaultEditor.onSubmit;
			newEditor.onChange = this.defaultEditor.onChange;

			// Copy text from previous editor
			newEditor.setText(currentText);

			// Copy appearance settings if supported
			if (newEditor.borderColor !== undefined) {
				newEditor.borderColor = this.defaultEditor.borderColor;
			}
			if (newEditor.setPaddingX !== undefined) {
				newEditor.setPaddingX(this.defaultEditor.getPaddingX());
			}
			if (newEditor.setAutocompleteMaxVisible !== undefined) {
				newEditor.setAutocompleteMaxVisible(this.defaultEditor.getAutocompleteMaxVisible());
			}

			// Set autocomplete if supported
			if (newEditor.setAutocompleteProvider && this.autocompleteProvider) {
				newEditor.setAutocompleteProvider(this.autocompleteProvider);
			}

			// If extending CustomEditor, copy app-level handlers
			// Use duck typing since instanceof fails across jiti module boundaries
			const customEditor = newEditor as unknown as Record<string, unknown>;
			if ("actionHandlers" in customEditor && customEditor.actionHandlers instanceof Map) {
				if (!customEditor.onEscape) {
					customEditor.onEscape = () => this.defaultEditor.onEscape?.();
				}
				if (!customEditor.onCtrlD) {
					customEditor.onCtrlD = () => this.defaultEditor.onCtrlD?.();
				}
				if (!customEditor.onPasteImage) {
					customEditor.onPasteImage = () => this.defaultEditor.onPasteImage?.();
				}
				if (!customEditor.onExtensionShortcut) {
					customEditor.onExtensionShortcut = (data: string) => this.defaultEditor.onExtensionShortcut?.(data);
				}
				// Copy action handlers (clear, suspend, model switching, etc.)
				for (const [action, handler] of this.defaultEditor.actionHandlers) {
					(customEditor.actionHandlers as Map<string, () => void>).set(action, handler);
				}
			}

			this.editor = newEditor;
		} else {
			// Restore default editor with text from custom editor
			this.defaultEditor.setText(currentText);
			this.editor = this.defaultEditor;
		}

		this.editorContainer.addChild(this.editor as Component);
		if (this.activeStatusIndicator) {
			this.statusContainer.clear();
			this.statusContainer.addChild(this.activeStatusIndicator);
		}
		this.ui.setFocus(this.editor as Component);
		this.ui.requestRender();
	}

	/**
	 * Show a notification for extensions.
	 */
	private showExtensionNotify(message: string, type?: "info" | "warning" | "error"): void {
		if (type === "error") {
			this.showError(message);
		} else if (type === "warning") {
			this.showWarning(message);
		} else {
			this.showStatus(message);
		}
	}

	/** Show a custom component with keyboard focus. Overlay mode renders on top of existing content. */
	private async showExtensionCustom<T>(
		factory: (
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (result: T) => void,
		) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
		options?: {
			overlay?: boolean;
			overlayOptions?: OverlayOptions | (() => OverlayOptions);
			onHandle?: (handle: OverlayHandle) => void;
		},
	): Promise<T> {
		const savedText = this.editor.getText();
		const isOverlay = options?.overlay ?? false;

		const restoreEditor = () => {
			this.editorContainer.clear();
			this.editorContainer.addChild(this.editor);
			this.editor.setText(savedText);
			this.ui.setFocus(this.editor);
			this.ui.requestRender();
		};

		return new Promise((resolve, reject) => {
			let component: Component & { dispose?(): void };
			let overlayHandle: OverlayHandle | undefined;
			let closed = false;

			const close = (result: T) => {
				if (closed) return;
				closed = true;
				// Remove this overlay, not the topmost one: another overlay may have opened above it.
				if (isOverlay) overlayHandle?.hide();
				else restoreEditor();
				// Note: both branches above already call requestRender
				resolve(result);
				try {
					component?.dispose?.();
				} catch {
					/* ignore dispose errors */
				}
			};

			Promise.resolve(factory(this.ui, theme, this.keybindings, close))
				.then((c) => {
					if (closed) return;
					component = c;
					if (isOverlay) {
						// Resolve overlay options - can be static or dynamic function
						const resolveOptions = (): OverlayOptions | undefined => {
							if (options?.overlayOptions) {
								const opts =
									typeof options.overlayOptions === "function"
										? options.overlayOptions()
										: options.overlayOptions;
								return opts;
							}
							// Fallback: use component's width property if available
							const w = (component as { width?: number }).width;
							return w ? { width: w } : undefined;
						};
						overlayHandle = this.ui.showOverlay(component, resolveOptions());
						// Expose handle to caller for visibility control
						options?.onHandle?.(overlayHandle);
					} else {
						this.disposeActiveSelector();
						this.editorContainer.clear();
						this.editorContainer.addChild(component);
						this.ui.setFocus(component);
						this.ui.requestRender();
					}
				})
				.catch((err) => {
					if (closed) return;
					if (!isOverlay) restoreEditor();
					reject(err);
				});
		});
	}

	// =========================================================================
	// Key Handlers
	// =========================================================================

	private setupKeyHandlers(): void {
		// Set up handlers on defaultEditor - they use this.editor for text access
		// so they work correctly regardless of which editor is active
		this.defaultEditor.onEscape = () => {
			if (this.facade.isStreaming) {
				void this.restoreQueuedMessagesToEditor({ abort: true });
			} else if (this.facade.isBashRunning) {
				void this.facade.abortBash();
			} else if (this.isBashMode) {
				this.editor.setText("");
				this.isBashMode = false;
				this.updateEditorBorderColor();
			} else if (!this.editor.getText().trim()) {
				// Double-escape with empty editor triggers /tree, /fork, or nothing based on setting
				const action = this.settingsManager.getDoubleEscapeAction();
				if (action !== "none") {
					const now = Date.now();
					if (now - this.lastEscapeTime < 500) {
						if (action === "tree") {
							this.showTreeSelector();
						} else {
							void this.showUserMessageSelector();
						}
						this.lastEscapeTime = 0;
					} else {
						this.lastEscapeTime = now;
					}
				}
			}
		};

		// Register app action handlers
		this.defaultEditor.onAction("app.quit", () => this.handleQuit());
		this.defaultEditor.onCtrlD = () => this.handleCtrlD();
		this.defaultEditor.onAction("app.suspend", () => this.handleCtrlZ());
		this.defaultEditor.onAction("app.thinking.cycle", () => void this.cycleThinkingLevel());
		this.defaultEditor.onAction("app.model.cycleForward", () => this.cycleModel("forward"));
		this.defaultEditor.onAction("app.model.cycleBackward", () => this.cycleModel("backward"));

		// Global debug handler on TUI (works regardless of focus)
		this.ui.onDebug = () => this.handleDebugCommand();
		this.defaultEditor.onAction("app.model.select", () => this.showModelSelector());
		this.defaultEditor.onAction("app.tools.expand", () => this.toggleToolOutputExpansion());
		this.defaultEditor.onAction("app.thinking.toggle", () => this.toggleThinkingBlockVisibility());
		this.defaultEditor.onAction("app.editor.external", () => void this.handleOpenExternalEditor());
		this.defaultEditor.onAction(
			"app.message.copy",
			() => void this.handleCopyCommand({ flashConfirmation: true, preferSelection: true }),
		);
		this.defaultEditor.onAction("app.message.followUp", () => this.handleFollowUp());
		this.defaultEditor.onAction("app.message.dequeue", () => void this.handleDequeue());
		this.defaultEditor.onAction("app.session.new", () => this.handleClearCommand());
		this.defaultEditor.onAction("app.session.tree", () => this.showTreeSelector());
		this.defaultEditor.onAction("app.session.fork", () => void this.showUserMessageSelector());
		this.defaultEditor.onAction("app.session.resume", () => this.showSessionSelector());
		this.defaultEditor.onAction("app.sidebar.toggle", () => this.toggleSessionSidebar());

		this.defaultEditor.onChange = (text: string) => {
			const wasBashMode = this.isBashMode;
			this.isBashMode = text.trimStart().startsWith("!");
			if (wasBashMode !== this.isBashMode) {
				this.updateEditorBorderColor();
			}
		};

		// Handle clipboard paste (triggered on Ctrl+V). Copied files use their original paths,
		// images are attached via temporary files, and plain text is the final fallback.
		this.defaultEditor.onPasteImage = () => {
			void this.handleClipboardPaste();
		};
	}

	private async handleRightClickPaste(): Promise<void> {
		const target = this.renderer.getFocusedComponent();
		const handleInput = target?.handleInput;
		if (!target || !handleInput) return;
		try {
			const text = await readClipboardText();
			if (!text || this.renderer.getFocusedComponent() !== target) return;
			handleInput.call(target, `\x1b[200~${text}\x1b[201~`);
			this.ui.requestRender();
		} catch {
			// Silently ignore clipboard errors (may not have permission, etc.)
		}
	}

	private async handleClipboardPaste(): Promise<void> {
		try {
			const filePaths = await readClipboardFilePaths();
			if (filePaths) {
				if (filePaths.some((filePath) => /\p{Cc}/u.test(filePath))) {
					throw new Error("Clipboard file path contains control characters");
				}
				const paths = this.isBashMode ? filePaths.map(quoteIfNeeded).join(" ") : filePaths.join("\n");
				const cursor = this.editor.getCursor?.();
				const currentLine = cursor ? (this.editor.getText().split("\n")[cursor.line] ?? "") : "";
				const characterBeforeCursor = cursor && cursor.col > 0 ? currentLine[cursor.col - 1] : "";
				const characterAfterCursor = cursor ? currentLine[cursor.col] : "";
				const leadingSpace = characterBeforeCursor && !/\s/.test(characterBeforeCursor) ? " " : "";
				const trailingSpace = characterAfterCursor && !/\s/.test(characterAfterCursor) ? " " : "";
				this.editor.insertTextAtCursor?.(`${leadingSpace}${paths}${trailingSpace}`);
				this.ui.requestRender();
				return;
			}

			const image = await readClipboardImage();
			if (image) {
				const tmpDir = os.tmpdir();
				const ext = extensionForImageMimeType(image.mimeType) ?? "png";
				const fileName = `pi-clipboard-${crypto.randomUUID()}.${ext}`;
				const filePath = path.join(tmpDir, fileName);
				fs.writeFileSync(filePath, Buffer.from(image.bytes));

				this.editor.insertTextAtCursor?.(filePath);
				this.ui.requestRender();
				return;
			}

			const text = await readClipboardText();
			if (text) {
				this.editor.insertTextAtCursor?.(text);
				this.ui.requestRender();
			}
		} catch (error) {
			this.showError(`Failed to paste from clipboard: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private handleStartupSubmit(text: string): void {
		this.editor.setText(text);
		this.showStatus("Startup is still in progress");
	}

	private setupEditorSubmitHandler(): void {
		this.defaultEditor.onSubmit = async (text: string) => {
			text = text.trim();
			if (!text) return;

			// An alias runs the command it points at, e.g. "/history" runs "/resume".
			text = resolveBuiltinSlashAlias(text);

			// Handle commands
			if (text === "/settings") {
				this.showSettingsSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/scoped-models") {
				this.editor.setText("");
				await this.showModelsSelector();
				return;
			}
			if (text === "/model" || text.startsWith("/model ")) {
				const searchTerm = text.startsWith("/model ") ? text.slice(7).trim() : undefined;
				this.editor.setText("");
				await this.handleModelCommand(searchTerm);
				return;
			}
			if (text === "/thinking" || text.startsWith("/thinking ")) {
				const searchTerm = text.startsWith("/thinking ") ? text.slice(10).trim() : undefined;
				this.editor.setText("");
				await this.handleThinkingCommand(searchTerm);
				return;
			}
			if (text === "/export" || text.startsWith("/export ")) {
				await this.handleExportCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/import" || text.startsWith("/import ")) {
				await this.handleImportCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/share") {
				await this.handleShareCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/bug" || text.startsWith("/bug ")) {
				const hint = text.slice("/bug".length).trim();
				this.editor.setText("");
				await this.handleBugCommand(hint ? hint : undefined);
				return;
			}
			if (text === "/copy") {
				await this.handleCopyCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/name" || text.startsWith("/name ")) {
				await this.handleNameCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/stats") {
				await this.handleStatsCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/changelog") {
				this.handleChangelogCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/hotkeys") {
				this.handleHotkeysCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/pair") {
				this.editor.setText("");
				await this.handlePairCommand();
				return;
			}
			if (text === "/server") {
				this.editor.setText("");
				await this.handleServerCommand();
				return;
			}
			if (text === "/sidebar") {
				this.editor.setText("");
				this.toggleSessionSidebar();
				this.showStatus(`Session sidebar: ${this.settingsManager.getShowSessionSidebar() ? "on" : "off"}`);
				return;
			}
			if (text === "/fork") {
				await this.showUserMessageSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/clone") {
				this.editor.setText("");
				await this.handleCloneCommand();
				return;
			}
			if (text === "/tree") {
				this.showTreeSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/trust") {
				this.showTrustSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/login" || text.startsWith("/login ")) {
				const providerRef = text.startsWith("/login ") ? text.slice(7).trim() : undefined;
				this.editor.setText("");
				await this.handleLoginCommand(providerRef);
				return;
			}
			if (text === "/logout") {
				this.showOAuthSelector("logout");
				this.editor.setText("");
				return;
			}
			if (text === "/new") {
				this.editor.setText("");
				await this.handleClearCommand();
				return;
			}
			if (text === "/compact" || text.startsWith("/compact ")) {
				const customInstructions = text.startsWith("/compact ") ? text.slice(9).trim() : undefined;
				this.editor.setText("");
				await this.handleCompactCommand(customInstructions);
				return;
			}
			if (text === "/reload") {
				this.editor.setText("");
				await this.handleReloadCommand();
				return;
			}
			if (text === "/debug") {
				this.handleDebugCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/arminsayshi") {
				this.handleArminSaysHi();
				this.editor.setText("");
				return;
			}
			if (text === "/dementedelves") {
				this.handleDementedDelves();
				this.editor.setText("");
				return;
			}
			if (text === "/skills") {
				this.showSkillsSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/theme" || text.startsWith("/theme ")) {
				const argument = text.slice("/theme".length).trim();
				if (argument) {
					this.applyThemeArgument(argument);
				} else {
					this.showThemeSelector();
				}
				this.editor.setText("");
				return;
			}
			if (text === "/resume") {
				this.showSessionSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/quit") {
				this.editor.setText("");
				await this.shutdown();
				return;
			}

			// A command of a client-side extension runs in the client.
			const clientCommand = this.findClientExtensionCommand(text);
			if (clientCommand) {
				this.editor.addToHistory?.(text);
				this.editor.setText("");
				await this.runClientExtensionCommand(clientCommand.command, clientCommand.args);
				return;
			}

			// Handle bash command (! for normal, !! for excluded from context)
			if (text.startsWith("!")) {
				const isExcluded = text.startsWith("!!");
				const command = isExcluded ? text.slice(2).trim() : text.slice(1).trim();
				if (command) {
					if (this.facade.isBashRunning) {
						this.showWarning("A bash command is already running. Press Esc to cancel it first.");
						this.editor.setText(text);
						return;
					}
					this.editor.addToHistory?.(text);
					// The output goes to the transcript, so the empty-session screen has to go.
					this.setEmptySessionScreen(false);
					await this.handleBashCommand(command, isExcluded);
					this.isBashMode = false;
					this.updateEditorBorderColor();
					return;
				}
			}

			// Queue input during compaction (extension commands execute immediately)
			if (this.facade.isCompacting) {
				if (this.isExtensionCommand(text)) {
					this.editor.addToHistory?.(text);
					this.editor.setText("");
					await this.facade.prompt(text);
				} else {
					this.queueCompactionMessage(text, "steer");
				}
				return;
			}

			// If streaming, use prompt() with steer behavior
			// This handles extension commands (execute immediately), prompt template expansion, and queueing
			if (this.facade.isStreaming) {
				this.editor.addToHistory?.(text);
				this.editor.setText("");
				await this.facade.prompt(text, { streamingBehavior: "steer" });
				this.updatePendingMessagesDisplay();
				this.ui.requestRender();
				return;
			}

			// Normal message submission
			// First, move any pending bash components to chat
			this.flushPendingBashComponents();

			// The message shows in the transcript, so the empty-session screen has to go.
			this.setEmptySessionScreen(false);
			// The conversation starts here, so the intro has to go too.
			this.hideStartupIntro();

			// Show the message right away: the run is prepared in the background, and the user
			// should not wait for extension hooks or session writes to see their own prompt.
			this.echoUserMessage(text);
			if (this.onInputCallback) {
				this.onInputCallback(text);
			} else {
				this.pendingUserInputs.push(text);
			}
			this.editor.addToHistory?.(text);
		};
	}

	/**
	 * Render the submitted message in the chat immediately. The run's own user message replaces
	 * this echo once it arrives (or the echo is dropped when the prompt never reaches the model).
	 */
	private echoUserMessage(text: string): void {
		const spacer = this.chatContainer.children.length > 0 ? new Spacer(1) : undefined;
		if (spacer) this.chatContainer.addChild(spacer);
		const component = new UserMessageComponent(
			text,
			this.getMarkdownThemeWithSettings(),
			this.outputPad,
			this.getMarkdownTransformers(),
		);
		this.chatContainer.addChild(component);
		this.pendingUserMessageEchoes.push({ text, component, spacer });
		if (this.workingVisible) {
			this.showWorkingStatusIndicator();
		}
		this.ui.requestRender();
	}

	/** Remove an echoed message from the chat. */
	private removeUserMessageEcho(echo: { component: UserMessageComponent; spacer?: Spacer }): void {
		this.chatContainer.removeChild(echo.component);
		if (echo.spacer) this.chatContainer.removeChild(echo.spacer);
	}

	/** Drop the echo of a prompt that never reached the model (handled by an extension, or failed). */
	private discardUserMessageEcho(text: string): void {
		const index = this.pendingUserMessageEchoes.findIndex((echo) => echo.text === text);
		if (index === -1) return;
		const [echo] = this.pendingUserMessageEchoes.splice(index, 1);
		this.removeUserMessageEcho(echo);
		this.clearStatusIndicator("working");
		this.ui.requestRender();
	}

	/**
	 * Render a user message from the run. The echoed copy of the same text is kept as is; a
	 * different message (skill or prompt template expansion, attachments) replaces the echo.
	 */
	private renderUserMessage(message: Extract<AgentMessage, { role: "user" }>): void {
		const textContent = this.getUserMessageText(message);
		const isTextOnly = typeof message.content === "string" || message.content.every((block) => block.type === "text");
		if (textContent && isTextOnly) {
			const echoIndex = this.pendingUserMessageEchoes.findIndex((echo) => echo.text === textContent);
			if (echoIndex >= 0) {
				this.pendingUserMessageEchoes.splice(echoIndex, 1);
				return;
			}
		}
		const stale = this.pendingUserMessageEchoes.shift();
		if (stale) this.removeUserMessageEcho(stale);
		this.addMessageToChat(message);
	}

	private subscribeToAgent(): void {
		this.unsubscribe = this.facade.subscribe(async (event) => {
			await this.handleEvent(event);
		});
	}

	private async handleEvent(event: AgentSessionEvent): Promise<void> {
		if (!this.isInitialized) {
			await this.init();
		}

		this.footer.invalidate();
		this.programStatus.handleEvent(event);

		switch (event.type) {
			case "agent_start":
				this.pendingTools.clear();
				// The sidebar follows the sessions the server works on.
				this.startSessionListRefresh();
				void this.refreshSessionList();
				// Restore main escape handler if retry handler is still active
				// (retry success event fires later, but we need main handler now)
				if (this.retryEscapeHandler) {
					this.defaultEditor.onEscape = this.retryEscapeHandler;
					this.retryEscapeHandler = undefined;
				}
				break;

			case "turn_start":
				this.agentRunActive = true;
				this.progressBar.start();
				if (this.workingVisible) {
					if (this.activeStatusIndicator?.kind !== "working") {
						this.showWorkingStatusIndicator();
					}
				} else {
					this.clearStatusIndicator();
				}
				this.ui.requestRender();
				break;

			case "queue_update":
				this.updatePendingMessagesDisplay();
				this.ui.requestRender();
				break;

			case "entry_appended":
				if (this.entriesRenderedByBoundaryCompaction.delete(event.entry.id)) break;
				if (event.entry.type === "custom") {
					this.addCustomEntryToChat(event.entry);
					this.ui.requestRender();
				} else if (event.entry.type === "usage" && event.entry.kind === "cache_warm") {
					this.addCacheWarmingUsage(event.entry);
					this.ui.requestRender();
				} else if (event.entry.type === "custom_message" && event.entry.display) {
					this.addMessageToChat(
						createCustomMessage(
							event.entry.customType,
							event.entry.content,
							event.entry.display,
							event.entry.details,
							event.entry.timestamp,
						),
					);
					this.ui.requestRender();
				} else if (event.entry.type === "compaction") {
					const entries = this.sessionManager.buildContextEntries();
					if (entries[0]?.id !== event.entry.id) break;
					this.chatContainer.clear();
					this.pendingUserMessageEchoes = [];
					const branch = this.sessionManager.getBranch();
					const compactionIndex = branch.findIndex((entry) => entry.id === event.entry.id);
					const entriesAfterCompaction = new Set(branch.slice(compactionIndex + 1).map((entry) => entry.id));
					const retainedEntries = entries.slice(1);
					this.renderSessionEntries(retainedEntries.filter((entry) => !entriesAfterCompaction.has(entry.id)));
					this.addMessageToChat(
						createCompactionSummaryMessage(event.entry.summary, event.entry.tokensBefore, event.entry.timestamp),
					);
					if (event.entry.usage) {
						this.addCompactionCostNotice({
							type: "compaction_cost",
							kind: "compaction",
							usage: event.entry.usage,
						});
					}
					this.renderSessionEntries(retainedEntries.filter((entry) => entriesAfterCompaction.has(entry.id)));
					for (const entryId of entriesAfterCompaction) this.entriesRenderedByBoundaryCompaction.add(entryId);
					this.footer.invalidate();
					this.ui.requestRender();
				}
				break;

			case "session_info_changed":
				this.updateTerminalTitle();
				this.footer.invalidate();
				this.ui.requestRender();
				break;

			case "thinking_level_changed":
				this.footer.invalidate();
				this.updateEditorBorderColor();
				break;

			case "message_start":
				if (event.message.role === "custom") {
					this.addMessageToChat(event.message);
					this.ui.requestRender();
				} else if (event.message.role === "user") {
					this.hideStartupIntro();
					this.renderUserMessage(event.message);
					this.updatePendingMessagesDisplay();
					this.ui.requestRender();
				} else if (event.message.role === "assistant") {
					this.streamingComponent = new AssistantMessageComponent(
						undefined,
						this.hideThinkingBlock,
						this.getMarkdownThemeWithSettings(),
						this.hiddenThinkingLabel,
						this.outputPad,
						this.getMarkdownTransformers(),
					);
					this.streamingMessage = event.message;
					this.chatContainer.addChild(this.streamingComponent);
					this.streamingComponent.updateContent(this.streamingMessage, true);
					this.ui.requestRender();
				}
				break;

			case "message_update":
				if (this.streamingComponent && event.message.role === "assistant") {
					this.streamingMessage = event.message;
					this.streamingComponent.updateContent(this.streamingMessage, true);

					for (const content of this.streamingMessage.content) {
						if (content.type === "toolCall") {
							if (!this.pendingTools.has(content.id)) {
								const component = new ToolExecutionComponent(
									content.name,
									content.id,
									content.arguments,
									{
										showImages: this.settingsManager.getShowImages(),
										imageWidthCells: this.settingsManager.getImageWidthCells(),
										outputPad: this.outputPad,
									},
									this.getToolRenderers(content.name),
									this.ui,
									this.sessionManager.getCwd(),
								);
								component.setExpanded(this.toolOutputExpanded);
								this.chatContainer.addChild(component);
								this.pendingTools.set(content.id, component);
							} else {
								const component = this.pendingTools.get(content.id);
								if (component) {
									component.updateArgs(content.arguments);
								}
							}
						}
					}
					this.ui.requestRender();
				}
				break;

			case "message_end":
				if (event.message.role === "user") break;
				if (this.streamingComponent && event.message.role === "assistant") {
					this.streamingMessage = event.message;
					let errorMessage: string | undefined;
					if (this.streamingMessage.stopReason === "aborted") {
						const retryAttempt = this.facade.retryAttempt;
						errorMessage =
							retryAttempt > 0
								? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
								: "Operation aborted";
						this.streamingMessage.errorMessage = errorMessage;
					}
					this.streamingComponent.updateContent(this.streamingMessage, false);

					if (this.streamingMessage.stopReason === "aborted" || this.streamingMessage.stopReason === "error") {
						if (!errorMessage) {
							errorMessage = this.streamingMessage.errorMessage || "Error";
						}
						for (const [, component] of this.pendingTools.entries()) {
							component.updateResult({
								content: [{ type: "text", text: errorMessage }],
								isError: true,
							});
						}
						this.pendingTools.clear();
						this.maybeSuggestBugReport(this.streamingMessage);
					} else {
						// Args are now complete - trigger diff computation for edit tools
						for (const [, component] of this.pendingTools.entries()) {
							component.setArgsComplete();
						}
						this.maybeShowThinkingDropNotice(this.streamingMessage);
						this.maybeShowCacheMissNotice(this.streamingMessage);
					}
					this.streamingComponent = undefined;
					this.streamingMessage = undefined;
					this.footer.invalidate();
				}
				this.ui.requestRender();
				break;

			case "bash_execution_update":
				// The bash execution callback handles TUI output rendering.
				break;

			case "tool_execution_start": {
				// Nested calls (from codemode scripts) are shown inside their parent's row.
				if (event.parentToolCallId) break;
				let component = this.pendingTools.get(event.toolCallId);
				if (!component) {
					component = new ToolExecutionComponent(
						event.toolName,
						event.toolCallId,
						event.args,
						{
							showImages: this.settingsManager.getShowImages(),
							imageWidthCells: this.settingsManager.getImageWidthCells(),
							outputPad: this.outputPad,
						},
						this.getToolRenderers(event.toolName),
						this.ui,
						this.sessionManager.getCwd(),
					);
					component.setExpanded(this.toolOutputExpanded);
					this.chatContainer.addChild(component);
					this.pendingTools.set(event.toolCallId, component);
				}
				component.markExecutionStarted();
				this.ui.requestRender();
				break;
			}

			case "tool_execution_update": {
				const component = this.pendingTools.get(event.toolCallId);
				if (component) {
					component.updateResult({ ...event.partialResult, isError: false }, true);
					this.ui.requestRender();
				}
				break;
			}

			case "tool_execution_end": {
				if (event.isError) this.maybeShowInstallChangeWarning();
				const component = this.pendingTools.get(event.toolCallId);
				if (component) {
					component.updateResult({ ...event.result, isError: event.isError, durationMs: event.durationMs });
					this.pendingTools.delete(event.toolCallId);
					this.ui.requestRender();
				}
				break;
			}

			case "agent_end":
				this.agentRunActive = false;
				this.progressBar.complete();
				this.clearStatusIndicator("working");
				if (this.streamingComponent) {
					this.chatContainer.removeChild(this.streamingComponent);
					this.streamingComponent = undefined;
					this.streamingMessage = undefined;
				}
				this.pendingTools.clear();

				this.ui.requestRender();
				break;

			case "agent_settled":
				this.stopSessionListRefresh();
				await this.refreshSessionList();
				await this.checkShutdownRequested();
				break;

			case "compaction_start": {
				// A compaction inside a run is part of that run, so the bar keeps going.
				if (!this.agentRunActive) this.progressBar.start();
				// Keep editor active; submissions are queued during compaction.
				this.autoCompactionEscapeHandler = this.defaultEditor.onEscape;
				this.defaultEditor.onEscape = () => {
					void this.facade.abortCompaction();
				};
				this.showStatusIndicator(new CompactionStatusIndicator(this.ui, event.reason));
				this.ui.requestRender();
				break;
			}

			case "compaction_end": {
				if (!this.agentRunActive) this.progressBar.complete();
				if (this.autoCompactionEscapeHandler) {
					this.defaultEditor.onEscape = this.autoCompactionEscapeHandler;
					this.autoCompactionEscapeHandler = undefined;
				}
				this.clearStatusIndicator("compaction");
				if (event.aborted) {
					if (event.reason === "manual") {
						this.showError("Compaction cancelled");
					} else {
						this.showStatus("Auto-compaction cancelled");
					}
				} else if (event.result) {
					const entries = this.sessionManager.buildContextEntries();
					if (entries[0]?.type !== "compaction") {
						throw new Error("Completed compaction is missing from the session context");
					}
					this.chatContainer.clear();
					this.pendingUserMessageEchoes = [];
					// The latest compaction is prepended for model context; append it below at its chronological position.
					this.renderSessionEntries(entries.slice(1));
					this.addMessageToChat(
						createCompactionSummaryMessage(
							event.result.summary,
							event.result.tokensBefore,
							new Date().toISOString(),
						),
					);
					if (event.result.usage) {
						this.addCompactionCostNotice({
							type: "compaction_cost",
							kind: "compaction",
							usage: event.result.usage,
						});
					}
					this.footer.invalidate();
				} else if (event.errorMessage) {
					if (event.reason === "manual") {
						this.showError(event.errorMessage);
					} else {
						this.chatContainer.addChild(new Spacer(1));
						const errorMessage = event.errorMessage;
						this.chatContainer.addChild(new ThemedText(() => theme.fg("error", errorMessage), 1, 0));
					}
				}
				void this.flushCompactionQueue({ willRetry: event.willRetry });
				this.ui.requestRender();
				break;
			}

			case "auto_retry_start": {
				// Set up escape to abort retry
				this.retryEscapeHandler = this.defaultEditor.onEscape;
				this.defaultEditor.onEscape = () => {
					void this.facade.abortRetry();
				};
				this.showStatusIndicator(
					new RetryStatusIndicator(this.ui, event.attempt, event.maxAttempts, event.delayMs),
				);
				this.ui.requestRender();
				break;
			}

			case "auto_retry_end": {
				// Restore escape handler
				if (this.retryEscapeHandler) {
					this.defaultEditor.onEscape = this.retryEscapeHandler;
					this.retryEscapeHandler = undefined;
				}
				this.clearStatusIndicator("retry");
				// Show error only on final failure (success shows normal response)
				if (!event.success) {
					this.showError(`Retry failed after ${event.attempt} attempts: ${event.finalError || "Unknown error"}`);
				}
				this.ui.requestRender();
				break;
			}

			case "summarization_retry_scheduled": {
				this.showError(event.errorMessage);
				this.showStatusIndicator(
					new RetryStatusIndicator(this.ui, event.attempt, event.maxAttempts, event.delayMs),
				);
				this.ui.requestRender();
				break;
			}

			case "summarization_retry_attempt_start": {
				this.clearStatusIndicator("retry");
				if (event.source === "branchSummary") {
					this.showStatusIndicator(new BranchSummaryStatusIndicator(this.ui));
				} else {
					this.showStatusIndicator(new CompactionStatusIndicator(this.ui, event.reason));
				}
				this.ui.requestRender();
				break;
			}

			case "summarization_retry_finished": {
				this.clearStatusIndicator("retry");
				this.ui.requestRender();
				break;
			}
		}
	}

	/** Extract text content from a user message */
	private getUserMessageText(message: Message): string {
		if (message.role !== "user") return "";
		const textBlocks =
			typeof message.content === "string"
				? [{ type: "text", text: message.content }]
				: message.content.filter((c: { type: string }) => c.type === "text");
		return textBlocks.map((c) => (c as { text: string }).text).join("");
	}

	/** Show a managed-tool status update in the chat. */
	private showManagedToolStatus(status: ToolStatus): void {
		if (!this.managedToolStatusStarted) {
			this.chatContainer.addChild(new Spacer(1));
			this.managedToolStatusStarted = true;
		}
		const message = status.type === "warning" ? `Warning: ${status.message}` : status.message;
		const color = status.type === "warning" ? "warning" : "dim";
		this.chatContainer.addChild(new ThemedText(() => theme.fg(color, message), 1, 0));
		this.lastStatusSpacer = undefined;
		this.lastStatusText = undefined;
		this.ui.requestRender();
	}

	/**
	 * Show a status message in the chat.
	 *
	 * If multiple status messages are emitted back-to-back (without anything else being added to the chat),
	 * we update the previous status line instead of appending new ones to avoid log spam.
	 */
	private showStatus(message: string): void {
		const children = this.chatContainer.children;
		const last = children.length > 0 ? children[children.length - 1] : undefined;
		const secondLast = children.length > 1 ? children[children.length - 2] : undefined;

		if (last && secondLast && last === this.lastStatusText && secondLast === this.lastStatusSpacer) {
			this.lastStatusMessage = message;
			this.lastStatusText.invalidate();
			this.ui.requestRender();
			return;
		}

		const spacer = new Spacer(1);
		this.lastStatusMessage = message;
		const text = new ThemedText(() => theme.fg("dim", this.lastStatusMessage), 1, 0);
		this.chatContainer.addChild(spacer);
		this.chatContainer.addChild(text);
		this.lastStatusSpacer = spacer;
		this.lastStatusText = text;
		this.ui.requestRender();
	}

	/**
	 * Render a custom entry of the session.
	 *
	 * The entry is drawn by the renderer of the client-side extension that registered it.
	 * Without such a renderer the entry is not drawn: the server's extensions cannot render
	 * in the client's process.
	 */
	private addCustomEntryToChat(entry: Extract<SessionEntry, { type: "custom" }>): void {
		const renderer = this.clientExtensions?.getEntryRenderer(entry.customType);
		if (!renderer) return;
		const component = new CustomEntryComponent(entry, renderer, this.outputPad);
		if (!component.hasContent()) return;
		component.setExpanded(this.toolOutputExpanded);
		this.chatContainer.addChild(component);
	}

	private addMessageToChat(message: AgentMessage, options?: { populateHistory?: boolean }): void {
		switch (message.role) {
			case "bashExecution": {
				const component = new BashExecutionComponent(
					message.command,
					this.ui,
					message.excludeFromContext,
					this.outputPad,
				);
				if (message.output) {
					component.appendOutput(message.output);
				}
				component.setComplete(
					message.exitCode,
					message.cancelled,
					message.truncated ? ({ truncated: true } as TruncationResult) : undefined,
					message.fullOutputPath,
				);
				this.chatContainer.addChild(component);
				break;
			}
			case "custom": {
				if (message.display) {
					const component = new CustomMessageComponent(
						message,
						this.clientExtensions?.getMessageRenderer(message.customType),
						this.getMarkdownThemeWithSettings(),
						this.outputPad,
					);
					component.setExpanded(this.toolOutputExpanded);
					this.chatContainer.addChild(component);
				}
				break;
			}
			case "compactionSummary": {
				this.chatContainer.addChild(new Spacer(1));
				const component = new CompactionSummaryMessageComponent(
					message,
					this.getMarkdownThemeWithSettings(),
					this.outputPad,
				);
				component.setExpanded(this.toolOutputExpanded);
				this.chatContainer.addChild(component);
				break;
			}
			case "branchSummary": {
				this.chatContainer.addChild(new Spacer(1));
				const component = new BranchSummaryMessageComponent(
					message,
					this.getMarkdownThemeWithSettings(),
					this.outputPad,
				);
				component.setExpanded(this.toolOutputExpanded);
				this.chatContainer.addChild(component);
				break;
			}
			case "system":
				break;
			case "user": {
				const textContent = this.getUserMessageText(message);
				if (textContent) {
					if (this.chatContainer.children.length > 0) {
						this.chatContainer.addChild(new Spacer(1));
					}
					const skillMessage = parseSkillMessage(textContent);
					if (skillMessage) {
						// Render skill block (collapsible) with the request that came with it
						const component = new SkillInvocationMessageComponent(
							skillMessage,
							this.getMarkdownThemeWithSettings(),
							this.outputPad,
							this.getMarkdownTransformers(),
							() => this.keepTranscriptPosition(),
						);
						component.setExpanded(this.toolOutputExpanded);
						this.chatContainer.addChild(component);
					} else {
						const userComponent = new UserMessageComponent(
							textContent,
							this.getMarkdownThemeWithSettings(),
							this.outputPad,
							this.getMarkdownTransformers(),
						);
						this.chatContainer.addChild(userComponent);
					}
					if (options?.populateHistory) {
						this.editor.addToHistory?.(textContent);
					}
				}
				break;
			}
			case "assistant": {
				const assistantComponent = new AssistantMessageComponent(
					message,
					this.hideThinkingBlock,
					this.getMarkdownThemeWithSettings(),
					this.hiddenThinkingLabel,
					this.outputPad,
					this.getMarkdownTransformers(),
				);
				this.chatContainer.addChild(assistantComponent);
				break;
			}
			case "toolResult": {
				// Tool results are rendered inline with tool calls, handled separately
				break;
			}
			default: {
				const _exhaustive: never = message;
			}
		}
	}

	private renderSessionItems(
		items: readonly RenderSessionItem[],
		options: { updateFooter?: boolean; populateHistory?: boolean } = {},
	): void {
		this.pendingTools.clear();
		const renderedPendingTools = new Map<string, ToolExecutionComponent>();
		// Cache misses are not persisted, unlike successful cache-warming usage.
		// Re-derive them and inject them after the assistant messages that paid for them.
		const cacheMisses = this.settingsManager.getShowCacheMissNotices()
			? collectCacheMisses(this.sessionManager.getEntries(), this.facade.modelRuntime)
			: new Map<AssistantMessage, CacheMiss>();

		if (options.updateFooter) {
			this.footer.invalidate();
			this.updateEditorBorderColor();
		}

		for (const item of items) {
			if (isCustomSessionEntry(item)) {
				this.addCustomEntryToChat(item);
				continue;
			}
			if (isUsageSessionEntry(item)) {
				this.addCacheWarmingUsage(item);
				continue;
			}
			if (isCompactionCostNotice(item)) {
				this.addCompactionCostNotice(item);
				continue;
			}

			const message = item;
			// Assistant messages need special handling for tool calls
			if (message.role === "assistant") {
				this.addMessageToChat(message);
				// Render tool call components
				for (const content of message.content) {
					if (content.type === "toolCall") {
						const component = new ToolExecutionComponent(
							content.name,
							content.id,
							content.arguments,
							{
								showImages: this.settingsManager.getShowImages(),
								imageWidthCells: this.settingsManager.getImageWidthCells(),
								outputPad: this.outputPad,
							},
							this.getToolRenderers(content.name),
							this.ui,
							this.sessionManager.getCwd(),
						);
						component.setExpanded(this.toolOutputExpanded);
						this.chatContainer.addChild(component);

						if (message.stopReason === "aborted" || message.stopReason === "error") {
							let errorMessage: string;
							if (message.stopReason === "aborted") {
								const retryAttempt = this.facade.retryAttempt;
								errorMessage =
									retryAttempt > 0
										? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
										: "Operation aborted";
							} else {
								errorMessage = message.errorMessage || "Error";
							}
							component.updateResult({ content: [{ type: "text", text: errorMessage }], isError: true });
						} else {
							renderedPendingTools.set(content.id, component);
						}
					}
				}
				if (message.stopReason !== "aborted" && message.stopReason !== "error") {
					const miss = cacheMisses.get(message);
					if (miss) this.addCacheMissNotice(miss);
				}
			} else if (message.role === "toolResult") {
				// Match tool results to pending tool components
				const component = renderedPendingTools.get(message.toolCallId);
				if (component) {
					component.updateResult(message);
					renderedPendingTools.delete(message.toolCallId);
				}
			} else {
				// All other messages use standard rendering
				this.addMessageToChat(message, options);
			}
		}

		for (const [toolCallId, component] of renderedPendingTools) {
			this.pendingTools.set(toolCallId, component);
		}
		this.ui.requestRender();
	}

	/**
	 * Render session entries to chat. Used for initial load and rebuild after compaction.
	 * @param entries Compaction-aware session entries to render
	 * @param options.updateFooter Update footer state
	 * @param options.populateHistory Add user messages to editor history
	 */
	private renderSessionEntries(
		entries: SessionEntry[],
		options: { updateFooter?: boolean; populateHistory?: boolean } = {},
	): void {
		// Selection coordinates point into the transcript being replaced (#9311).
		if (this.renderer instanceof TuiAltScreen) this.renderer.resetTextSelection();
		const items = entries.flatMap((entry): RenderSessionItem[] => {
			if (entry.type === "custom" || (entry.type === "usage" && entry.kind === "cache_warm")) {
				return [entry];
			}
			const messages = sessionEntryToContextMessages(entry);
			if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage && messages.length > 0) {
				return [...messages, { type: "compaction_cost", kind: entry.type, usage: entry.usage }];
			}
			return messages;
		});
		this.renderSessionItems(items, options);
	}

	private addCacheWarmingUsage(entry: UsageEntry): void {
		if (!this.settingsManager.getShowCacheMissNotices()) return;
		this.chatContainer.addChild(new Spacer(1));
		const usage = formatCacheWarmingUsage(entry);
		this.chatContainer.addChild(new ThemedText(() => theme.fg("dim", usage), 1, 0));
	}

	/**
	 * Render billing usage for a compaction or branch summary. The notice is derived
	 * from persisted summary usage and is not stored as a separate session entry.
	 */
	private addCompactionCostNotice(notice: CompactionCostNotice): void {
		if (!this.settingsManager.getShowCacheMissNotices()) return;

		const { usage } = notice;
		const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
		const cost = usage.cost.total >= 0.01 ? ` (~$${usage.cost.total.toFixed(2)})` : "";
		const label = notice.kind === "compaction" ? "Compaction" : "Branch summary";
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(
			new ThemedText(() => theme.fg("warning", `${label}: ${formatTokens(tokens)} tokens billed${cost}`), 1, 0),
		);
	}

	private static countDroppedThinkingBlocks(message: AssistantMessage): number {
		let count = 0;
		for (const diagnostic of message.diagnostics ?? []) {
			if (diagnostic.type !== "anthropic_input_transformations") continue;
			const transformations = diagnostic.details?.transformations;
			if (!Array.isArray(transformations)) continue;
			count += transformations.filter(
				(transformation) =>
					typeof transformation === "object" &&
					transformation !== null &&
					(transformation as Record<string, unknown>).type === "thinking_dropped",
			).length;
		}
		return count;
	}

	private maybeShowThinkingDropNotice(message: AssistantMessage): void {
		if (!this.settingsManager.getShowCacheMissNotices()) return;

		const droppedCount = InteractiveMode.countDroppedThinkingBlocks(message);
		if (droppedCount === 0) return;

		let previousDroppedCount = 0;
		// message_end reaches the UI before the current message is persisted,
		// so the branch's last assistant message is the previous response.
		const branch = this.sessionManager.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i];
			if (entry.type === "message" && entry.message.role === "assistant") {
				previousDroppedCount = InteractiveMode.countDroppedThinkingBlocks(entry.message);
				break;
			}
		}
		if (droppedCount <= previousDroppedCount) return;

		const noun = droppedCount === 1 ? "thinking block" : "thinking blocks";
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(
			new ThemedText(
				() => theme.fg("warning", `Anthropic dropped ${droppedCount} ${noun} (details in session)`),
				1,
				0,
			),
		);
	}

	/**
	 * Show a transcript notice when a completed assistant message paid for a
	 * significant cache miss. Only states observable facts: the miss itself,
	 * a model switch, or an idle gap past the cache TTL.
	 */
	private maybeShowCacheMissNotice(message: AssistantMessage): void {
		if (!this.settingsManager.getShowCacheMissNotices()) return;

		// Entries don't contain `message` yet: message_end fires before persistence.
		const miss = detectCacheMiss(this.sessionManager.getEntries(), message, this.facade.modelRuntime);
		if (miss) this.addCacheMissNotice(miss);
	}

	private addCacheMissNotice(miss: CacheMiss): void {
		if (miss.missedTokens < 20_000 && miss.missedCost < 0.1) return;

		const cost = miss.missedCost >= 0.01 ? ` (~$${miss.missedCost.toFixed(2)})` : "";
		const reBilled = `${formatTokens(miss.missedTokens)} tokens re-billed${cost}`;
		let label = "Cache miss";
		if (miss.modelChanged) {
			label = "Cache miss after model switch";
		} else if (miss.idleMs >= CACHE_TTL_MS) {
			label = `Cache miss after ${Math.round(miss.idleMs / 60_000)}m idle`;
		}
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new ThemedText(() => theme.fg("warning", `${label}: ${reBilled}`), 1, 0));
	}

	renderInitialMessages(): void {
		const entries = this.sessionManager.buildContextEntries();
		this.renderSessionEntries(entries, {
			updateFooter: true,
			populateHistory: true,
		});
		this.renderProjectTrustWarningIfNeeded();

		// Show compaction info if session was compacted
		const allEntries = this.sessionManager.getEntries();
		const compactionCount = allEntries.filter((e) => e.type === "compaction").length;
		if (compactionCount > 0) {
			const times = compactionCount === 1 ? "1 time" : `${compactionCount} times`;
			this.showStatus(`Session compacted ${times}`);
		}
	}

	private renderProjectTrustWarningIfNeeded(): void {
		if (this.settingsManager.isProjectTrusted() || !hasTrustRequiringProjectResources(this.sessionManager.getCwd())) {
			return;
		}

		if (this.chatContainer.children.length > 0) {
			this.chatContainer.addChild(new Spacer(1));
		}
		this.chatContainer.addChild(
			new ThemedText(
				() =>
					theme.fg(
						"warning",
						`This project is not trusted. Project ${CONFIG_DIR_NAME} resources and packages are ignored. Use /trust to save a trust decision, then restart pi.`,
					),
				1,
				0,
			),
		);
	}

	async getUserInput(): Promise<string> {
		const queuedInput = this.pendingUserInputs.shift();
		if (queuedInput !== undefined) {
			return queuedInput;
		}

		return new Promise((resolve) => {
			this.onInputCallback = (text: string) => {
				this.onInputCallback = undefined;
				resolve(text);
			};
		});
	}

	private rebuildChatFromMessages(): void {
		this.chatContainer.clear();
		this.pendingUserMessageEchoes = [];
		this.renderSessionEntries(this.sessionManager.buildContextEntries());
	}

	// =========================================================================
	// Key handlers
	// =========================================================================

	/**
	 * Quit on a double press. Never touches the editor content.
	 */
	private handleQuit(): void {
		const now = Date.now();
		if (now - this.lastSigintTime < 500) {
			void this.shutdown();
			return;
		}
		this.lastSigintTime = now;
		const quitKey = keyDisplayText("app.quit");
		this.showWarningBanner(quitKey ? `Press ${quitKey} again to exit` : "Press again to exit");
	}

	private handleCtrlD(): void {
		// Only called when editor is empty (enforced by CustomEditor)
		void this.shutdown();
	}

	/**
	 * Gracefully shutdown the agent.
	 * Stops the TUI before emitting shutdown events so extension UI cleanup cannot
	 * repaint the final frame while the process is exiting.
	 */
	private isShuttingDown = false;

	private async shutdown(options?: { fromSignal?: boolean }): Promise<void> {
		if (this.isShuttingDown) return;
		this.isShuttingDown = true;
		// Keep signal handlers registered until terminal cleanup has completed.
		// `signal-exit` checks the listener list during the same SIGTERM/SIGHUP
		// dispatch and re-sends the signal if only its own listeners remain.

		if (options?.fromSignal) {
			// Signal-triggered shutdown (SIGTERM/SIGHUP). Emit extension cleanup
			// (session_shutdown) BEFORE touching the terminal. Extension teardown
			// such as removing sockets does not write to the tty, so it must not be
			// skipped if a later terminal-restore write fails on a dead or stalled
			// terminal. If the terminal is gone, the restore writes below emit EIO,
			// which the stdout/stderr error handler turns into emergencyTerminalExit;
			// the render loop is already idle, so this cannot hot-spin (see #4144).
			this.facade.dispose();
			this.themeController.disableAutoSync();
			await this.ui.terminal.drainInput(1000);
			this.stop();
			process.exit(0);
		}

		// Interactive quit (Ctrl+D, Ctrl+C, /quit, extension shutdown()). Stop the
		// TUI before emitting shutdown events so extension UI cleanup cannot repaint
		// the final frame while the process is exiting.
		// Drain any in-flight Kitty key release events before stopping.
		// This prevents escape sequences from leaking to the parent shell over slow SSH.
		this.themeController.disableAutoSync();
		await this.ui.terminal.drainInput(1000);

		this.stop();
		this.facade.dispose();

		const resumeCommand = formatResumeCommand(this.sessionManager);
		if (resumeCommand) {
			process.stdout.write(`${theme.fg("muted", "To resume this session:")} ${resumeCommand}\n`);
		}

		process.exit(0);
	}

	private emergencyTerminalExit(): never {
		this.isShuttingDown = true;
		this.unregisterSignalHandlers();
		killTrackedDetachedChildren();
		// The terminal is gone. Do not run normal shutdown because TUI and
		// extension cleanup can write restore sequences and re-trigger EIO.
		process.exit(129);
	}

	/**
	 * Last-resort handler for uncaught exceptions. The TUI puts stdin into raw
	 * mode and hides the cursor; without this handler, an uncaught throw from
	 * anywhere (e.g. an extension's async `ChildProcess.on("exit")` callback)
	 * tears down the process while leaving the terminal in raw mode with no
	 * cursor, requiring `stty sane && reset` to recover.
	 *
	 * Unlike emergencyTerminalExit, the terminal is still alive here, so we
	 * call ui.stop() to restore cooked mode, the cursor, and disable bracketed
	 * paste / Kitty / modifyOtherKeys sequences.
	 */
	private uncaughtCrash(error: Error): never {
		// A dead terminal is not a pi crash. Do not try to restore it or record it.
		if (isDeadTerminalError(error)) {
			this.emergencyTerminalExit();
		}
		if (this.isShuttingDown) {
			process.exit(1);
		}
		this.isShuttingDown = true;
		try {
			this.unregisterSignalHandlers();
		} catch {}
		try {
			killTrackedDetachedChildren();
		} catch {}
		try {
			this.ui.stop();
		} catch {}
		console.error(`${APP_NAME} exiting due to uncaughtException:`);
		console.error(error);
		const extensionHint = this.getCrashExtensionHint(error);
		if (extensionHint) console.error(`\n${extensionHint}`);
		if (this.recordCrash("uncaught_exception", error)) {
			console.error(`\n${this.crashReportInstructions()}`);
		}
		process.exit(1);
	}

	/**
	 * Check if shutdown was requested and perform shutdown if so.
	 */
	private async checkShutdownRequested(): Promise<void> {
		if (!this.shutdownRequested) return;
		await this.shutdown();
	}

	private registerSignalHandlers(): void {
		this.unregisterSignalHandlers();

		const signals: NodeJS.Signals[] = ["SIGTERM"];
		if (process.platform !== "win32") {
			signals.push("SIGHUP");
		}

		for (const signal of signals) {
			const handler = () => {
				// SIGHUP no longer hard-exits: graceful shutdown emits session_shutdown
				// first, then attempts terminal restore. A genuinely dead terminal
				// surfaces as an EIO on the restore writes, which the stdout/stderr
				// error handler converts into emergencyTerminalExit (see #4144, #5080).
				killTrackedDetachedChildren();
				void this.shutdown({ fromSignal: true });
			};
			process.prependListener(signal, handler);
			this.signalCleanupHandlers.push(() => process.off(signal, handler));
		}

		const terminalErrorHandler = (error: Error) => {
			if (isDeadTerminalError(error)) {
				this.emergencyTerminalExit();
			}
			throw error;
		};
		// stdin needs the handler too: once the terminal is gone, reads and setRawMode
		// fail with EIO (orphaned background process group) or ENOTTY (revoked tty).
		// Node emits these as stream errors, which are uncaught without a listener.
		for (const stream of [process.stdin, process.stdout, process.stderr]) {
			stream.on("error", terminalErrorHandler);
			this.signalCleanupHandlers.push(() => stream.off("error", terminalErrorHandler));
		}

		// Restore the terminal before the process dies on any uncaught throw.
		// Without this, an unhandled exception from extension code (or anywhere
		// in pi) leaves the terminal in raw mode with no cursor.
		const uncaughtExceptionHandler = (error: Error) => this.uncaughtCrash(error);
		process.prependListener("uncaughtException", uncaughtExceptionHandler);
		this.signalCleanupHandlers.push(() => process.off("uncaughtException", uncaughtExceptionHandler));
	}

	private unregisterSignalHandlers(): void {
		for (const cleanup of this.signalCleanupHandlers) {
			cleanup();
		}
		this.signalCleanupHandlers = [];
	}

	private handleCtrlZ(): void {
		if (process.platform === "win32") {
			this.showStatus("Suspend to background is not supported on Windows");
			return;
		}

		// Keep the event loop alive while suspended. Without this, stopping the TUI
		// can leave Node with no ref'ed handles, causing the process to exit on fg
		// before the SIGCONT handler gets a chance to restore the terminal.
		const suspendKeepAlive = setInterval(() => {}, 2 ** 30);

		// Ignore SIGINT while suspended so Ctrl+C in the terminal does not
		// kill the backgrounded process. The handler is removed on resume.
		const ignoreSigint = () => {};
		process.on("SIGINT", ignoreSigint);

		// Set up handler to restore TUI when resumed
		process.once("SIGCONT", () => {
			clearInterval(suspendKeepAlive);
			process.removeListener("SIGINT", ignoreSigint);
			this.ui.start();
			this.ui.requestRender(true);
		});

		try {
			// Stop the TUI (restore terminal to normal mode)
			this.ui.stop();

			// Send SIGTSTP to process group (pid=0 means all processes in group)
			process.kill(0, "SIGTSTP");
		} catch (error) {
			clearInterval(suspendKeepAlive);
			process.removeListener("SIGINT", ignoreSigint);
			throw error;
		}
	}

	private async handleFollowUp(): Promise<void> {
		const text = (this.editor.getExpandedText?.() ?? this.editor.getText()).trim();
		if (!text) return;

		// Queue input during compaction (extension commands execute immediately)
		if (this.facade.isCompacting) {
			if (this.isExtensionCommand(text)) {
				this.editor.addToHistory?.(text);
				this.editor.setText("");
				await this.facade.prompt(text);
			} else {
				this.queueCompactionMessage(text, "followUp");
			}
			return;
		}

		// Alt+Enter queues a follow-up message (waits until agent finishes)
		// This handles extension commands (execute immediately), prompt template expansion, and queueing
		if (this.facade.isStreaming) {
			this.editor.addToHistory?.(text);
			this.editor.setText("");
			await this.facade.prompt(text, { streamingBehavior: "followUp" });
			this.updatePendingMessagesDisplay();
			this.ui.requestRender();
		}
		// If not streaming, Alt+Enter acts like regular Enter (trigger onSubmit)
		else if (this.editor.onSubmit) {
			this.editor.setText("");
			this.editor.onSubmit(text);
		}
	}

	private async handleDequeue(): Promise<void> {
		const restored = await this.restoreQueuedMessagesToEditor();
		if (restored === 0) {
			this.showStatus("No queued messages to restore");
		} else {
			this.showStatus(`Restored ${restored} queued message${restored > 1 ? "s" : ""} to editor`);
		}
	}

	private updateEditorBorderColor(): void {
		if (this.isBashMode) {
			this.editor.borderColor = theme.getBashModeBorderColor();
		} else {
			const level = this.facade.thinkingLevel || "off";
			this.editor.borderColor = theme.getThinkingBorderColor(level);
		}
		this.activeStatusIndicator?.invalidate();
		if (this.warningText) this.clearWarningBanner();
		this.ui.requestRender();
	}

	private async cycleThinkingLevel(): Promise<void> {
		const newLevel = await this.facade.cycleThinkingLevel();
		if (newLevel === undefined) {
			this.showStatus("Current model does not support thinking");
		} else {
			this.footer.invalidate();
			this.updateEditorBorderColor();
			this.showStatus(`Thinking level: ${newLevel}`);
		}
	}

	private async cycleModel(direction: "forward" | "backward"): Promise<void> {
		try {
			const result = await this.facade.cycleModel(direction);
			if (result === undefined) {
				const msg = this.facade.scopedModels.length > 0 ? "Only one model in scope" : "Only one model available";
				this.showStatus(msg);
			} else {
				this.footer.invalidate();
				this.updateEditorBorderColor();
				const thinkingStr =
					result.model.reasoning && result.thinkingLevel !== "off" ? ` (thinking: ${result.thinkingLevel})` : "";
				this.showStatus(`Switched to ${result.model.name || result.model.id}${thinkingStr}`);
				void this.maybeWarnAboutAnthropicSubscriptionAuth(result.model);
			}
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	private toggleToolOutputExpansion(): void {
		this.setToolsExpanded(!this.toolOutputExpanded);
	}

	private setToolsExpanded(expanded: boolean): void {
		if (expanded === this.toolOutputExpanded) return;

		this.toolOutputExpanded = expanded;
		const activeHeader = this.customHeader ?? this.builtInHeader;
		if (isExpandable(activeHeader)) {
			activeHeader.setExpanded(expanded);
		}
		for (const child of this.chatContainer.children) {
			if (isExpandable(child)) {
				child.setExpanded(expanded);
			}
		}
		this.showStatus(`Tool output: ${expanded ? "expanded" : "collapsed"}`);
	}

	/** Update rendered assistant messages without rebuilding live tool components. */
	private updateThinkingBlockVisibility(): void {
		for (const child of this.chatContainer.children) {
			if (child instanceof AssistantMessageComponent) {
				child.setHideThinkingBlock(this.hideThinkingBlock);
			}
		}
		this.ui.requestRender();
	}

	private toggleThinkingBlockVisibility(): void {
		this.hideThinkingBlock = !this.hideThinkingBlock;
		this.settingsManager.setHideThinkingBlock(this.hideThinkingBlock);
		this.updateThinkingBlockVisibility();
		this.showStatus(`Thinking blocks: ${this.hideThinkingBlock ? "hidden" : "visible"}`);
	}

	private async handleOpenExternalEditor(): Promise<void> {
		const editorCmd = this.settingsManager.getExternalEditorCommand();
		const content = this.editor.getExpandedText?.() ?? this.editor.getText();
		this.ui.stop();
		try {
			const result = await editInExternalEditor({
				command: editorCmd,
				content,
			});
			if (result.status === "complete") {
				this.editor.setText(result.content);
			}
		} finally {
			this.ui.start();
			this.ui.requestRender(true);
		}
	}

	// =========================================================================
	// UI helpers
	// =========================================================================

	private warningBannerTimer: ReturnType<typeof setTimeout> | undefined = undefined;

	showWarningBanner(message: string): void {
		if (this.warningBannerTimer) clearTimeout(this.warningBannerTimer);
		this.warningContainer.clear();
		this.warningText = new ThemedText(() => theme.fg("warning", message), 1, 0);
		this.warningContainer.addChild(this.warningText);
		this.ui.requestRender();
		this.warningBannerTimer = setTimeout(() => {
			this.warningContainer.clear();
			this.warningText = undefined;
			this.ui.requestRender();
		}, 3000);
	}

	clearWarningBanner(): void {
		if (this.warningBannerTimer) clearTimeout(this.warningBannerTimer);
		this.warningBannerTimer = undefined;
		this.warningContainer.clear();
		this.warningText = undefined;
		this.ui.requestRender();
	}

	showError(errorMessage: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new ThemedText(() => theme.fg("error", `Error: ${errorMessage}`), this.outputPad, 0));
		this.ui.requestRender();
	}

	showWarning(warningMessage: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new ThemedText(() => theme.fg("warning", `Warning: ${warningMessage}`), 1, 0));
		this.ui.requestRender();
	}

	showNewVersionNotification(release: LatestPiRelease): void {
		const updateInstruction = () =>
			theme.fg("muted", `New version ${release.version} is available. Run `) +
			theme.fg("accent", `${APP_NAME} update`);
		const changelogUrl = "https://pi.dev/changelog";
		const changelogLine = () => {
			const changelogLink = getCapabilities().hyperlinks
				? hyperlink(theme.fg("accent", changelogUrl), changelogUrl)
				: theme.fg("accent", changelogUrl);
			return theme.fg("muted", "Changelog: ") + changelogLink;
		};
		const note = release.note?.trim();

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.chatContainer.addChild(
			new ThemedText(() => `${theme.bold(theme.fg("warning", "Update Available"))}\n${updateInstruction()}`, 1, 0),
		);
		if (note) {
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(
				new Markdown(note, 1, 0, this.getMarkdownThemeWithSettings(), {
					color: (text) => theme.fg("muted", text),
				}),
			);
			this.chatContainer.addChild(new Spacer(1));
		}
		this.chatContainer.addChild(new ThemedText(changelogLine, 1, 0));
		this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.ui.requestRender();
	}

	showPackageUpdateNotification(packages: string[]): void {
		const updateInstruction = () =>
			theme.fg("muted", "Package updates are available. Run ") +
			theme.fg("accent", `${APP_NAME} update --extensions`);
		const packageLines = packages.map((pkg) => `- ${pkg}`).join("\n");

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.chatContainer.addChild(
			new ThemedText(
				() =>
					`${theme.bold(theme.fg("warning", "Package Updates Available"))}\n${updateInstruction()}\n${theme.fg("muted", "Packages:")}\n${packageLines}`,
				1,
				0,
			),
		);
		this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.ui.requestRender();
	}

	/**
	 * Get all queued messages (read-only).
	 * Combines session queue and compaction queue.
	 */
	private getAllQueuedMessages(): { steering: string[]; followUp: string[] } {
		return {
			steering: [
				...this.facade.getSteeringMessages(),
				...this.compactionQueuedMessages.filter((msg) => msg.mode === "steer").map((msg) => msg.text),
			],
			followUp: [
				...this.facade.getFollowUpMessages(),
				...this.compactionQueuedMessages.filter((msg) => msg.mode === "followUp").map((msg) => msg.text),
			],
		};
	}

	/**
	 * Clear all queued messages and return their contents.
	 * Clears both session queue and compaction queue.
	 */
	private async clearAllQueues(): Promise<{ steering: string[]; followUp: string[] }> {
		const { steering, followUp } = await this.facade.clearQueue();
		const compactionSteering = this.compactionQueuedMessages
			.filter((msg) => msg.mode === "steer")
			.map((msg) => msg.text);
		const compactionFollowUp = this.compactionQueuedMessages
			.filter((msg) => msg.mode === "followUp")
			.map((msg) => msg.text);
		this.compactionQueuedMessages = [];
		return {
			steering: [...steering, ...compactionSteering],
			followUp: [...followUp, ...compactionFollowUp],
		};
	}

	private updatePendingMessagesDisplay(): void {
		this.pendingMessagesContainer.clear();
		// Running bash commands live in the same container. Dropping them here would hide
		// their output until the next flush and resize the dock, which slides the transcript.
		for (const component of this.pendingBashComponents) {
			this.pendingMessagesContainer.addChild(component);
		}
		const { steering: steeringMessages, followUp: followUpMessages } = this.getAllQueuedMessages();
		if (steeringMessages.length > 0 || followUpMessages.length > 0) {
			this.pendingMessagesContainer.addChild(new Spacer(1));
			for (const message of steeringMessages) {
				const text = theme.fg("dim", `Steering: ${message}`);
				this.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
			}
			for (const message of followUpMessages) {
				const text = theme.fg("dim", `Follow-up: ${message}`);
				this.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
			}
			const dequeueHint = this.getAppKeyDisplay("app.message.dequeue");
			const hintText = theme.fg("dim", `↳ ${dequeueHint} to edit all queued messages`);
			this.pendingMessagesContainer.addChild(new TruncatedText(hintText, 1, 0));
		}
	}

	private async restoreQueuedMessagesToEditor(options?: { abort?: boolean; currentText?: string }): Promise<number> {
		const { steering, followUp } = await this.clearAllQueues();
		const allQueued = [...steering, ...followUp];
		if (allQueued.length === 0) {
			this.updatePendingMessagesDisplay();
			if (options?.abort) {
				void this.facade.abort();
			}
			return 0;
		}
		const queuedText = allQueued.join("\n\n");
		const currentText = options?.currentText ?? this.editor.getText();
		const combinedText = [queuedText, currentText].filter((t) => t.trim()).join("\n\n");
		this.editor.setText(combinedText);
		this.updatePendingMessagesDisplay();
		if (options?.abort) {
			void this.facade.abort();
		}
		return allQueued.length;
	}

	private queueCompactionMessage(text: string, mode: "steer" | "followUp"): void {
		this.compactionQueuedMessages.push({ text, mode });
		this.editor.addToHistory?.(text);
		this.editor.setText("");
		this.updatePendingMessagesDisplay();
		this.showStatus("Queued message for after compaction");
	}

	private isExtensionCommand(text: string): boolean {
		if (!text.startsWith("/")) return false;

		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		return this.facade.extensionRunner.getRegisteredCommands().some((command) => command.name === commandName);
	}

	private async flushCompactionQueue(options?: { willRetry?: boolean }): Promise<void> {
		if (this.compactionQueuedMessages.length === 0) {
			return;
		}

		const queuedMessages = [...this.compactionQueuedMessages];
		this.compactionQueuedMessages = [];
		this.updatePendingMessagesDisplay();

		const restoreQueue = (error: unknown) => {
			void this.facade.clearQueue();
			this.compactionQueuedMessages = queuedMessages;
			this.updatePendingMessagesDisplay();
			this.showError(
				`Failed to send queued message${queuedMessages.length > 1 ? "s" : ""}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		};

		try {
			if (options?.willRetry) {
				// When retry is pending, queue messages for the retry turn
				for (const message of queuedMessages) {
					if (this.isExtensionCommand(message.text)) {
						await this.facade.prompt(message.text);
					} else if (message.mode === "followUp") {
						await this.facade.followUp(message.text);
					} else {
						await this.facade.steer(message.text);
					}
				}
				this.updatePendingMessagesDisplay();
				return;
			}

			// Find first non-extension-command message to use as prompt
			const firstPromptIndex = queuedMessages.findIndex((message) => !this.isExtensionCommand(message.text));
			if (firstPromptIndex === -1) {
				// All extension commands - execute them all
				for (const message of queuedMessages) {
					await this.facade.prompt(message.text);
				}
				return;
			}

			// Execute any extension commands before the first prompt
			const preCommands = queuedMessages.slice(0, firstPromptIndex);
			const firstPrompt = queuedMessages[firstPromptIndex];
			const rest = queuedMessages.slice(firstPromptIndex + 1);

			for (const message of preCommands) {
				await this.facade.prompt(message.text);
			}

			// Start a prompt when idle, or queue it into a run still finishing compaction.
			const promptPromise = this.facade
				.prompt(firstPrompt.text, { streamingBehavior: firstPrompt.mode })
				.catch((error) => {
					restoreQueue(error);
				});

			// Queue remaining messages
			for (const message of rest) {
				if (this.isExtensionCommand(message.text)) {
					await this.facade.prompt(message.text);
				} else if (message.mode === "followUp") {
					await this.facade.followUp(message.text);
				} else {
					await this.facade.steer(message.text);
				}
			}
			this.updatePendingMessagesDisplay();
			void promptPromise;
		} catch (error) {
			restoreQueue(error);
		}
	}

	/** Move pending bash components from pending area to chat */
	private flushPendingBashComponents(): void {
		for (const component of this.pendingBashComponents) {
			this.pendingMessagesContainer.removeChild(component);
			this.chatContainer.addChild(component);
		}
		this.pendingBashComponents = [];
	}

	// =========================================================================
	// Selectors
	// =========================================================================

	private disposeActiveSelector(): void {
		const dispose = this.activeSelectorDispose;
		this.activeSelectorToken = undefined;
		this.activeSelectorDispose = undefined;
		dispose?.();
	}

	/**
	 * Shows a selector component in place of the editor.
	 * @param create Factory that receives a `done` callback and returns the component and focus target
	 */
	private showSelector(
		create: (done: () => void) => { component: Component; focus: Component; dispose?: () => void },
		options: { floating?: boolean } = {},
	): void {
		const token = {};
		let dispose: (() => void) | undefined;
		const done = () => {
			dispose?.();
			if (this.activeSelectorToken !== token) return;
			this.activeSelectorToken = undefined;
			this.activeSelectorDispose = undefined;
			this.editorContainer.clear();
			this.editorContainer.addChild(this.editor);
			this.ui.setFocus(this.editor);
		};
		const created = create(done);
		dispose = created.dispose;
		this.disposeActiveSelector();
		this.activeSelectorToken = token;
		this.activeSelectorDispose = dispose;
		this.editorContainer.clear();
		if (this.emptySessionActive) {
			// On the empty-session screen the selector opens below the input box, so it does
			// not cover the logo. The editor stays in place above it.
			const menu = created.component as { setFloating?: (floating: boolean) => void };
			menu.setFloating?.(false);
			this.editorContainer.addChild(this.editor as Component);
			this.editorContainer.addChild(created.component);
		} else if (options.floating) {
			// A floating selector is painted above the input box, so the editor stays
			// in place. The selector comes first, so the container picks its overlay.
			this.editorContainer.addChild(created.component);
			this.editorContainer.addChild(this.editor as Component);
		} else {
			this.editorContainer.addChild(created.component);
		}
		this.ui.setFocus(created.focus);
		this.ui.requestRender();
	}

	private showSettingsSelector(): void {
		this.showSelector((done) => {
			let selector: SettingsSelectorComponent | undefined;
			const defaultProvider = this.settingsManager.getDefaultProvider();
			const defaultModelId = this.settingsManager.getDefaultModel();
			const defaultModel = defaultProvider && defaultModelId ? `${defaultProvider}/${defaultModelId}` : "not set";
			selector = new SettingsSelectorComponent(
				{
					autoCompact: this.facade.autoCompactionEnabled,
					defaultModel,
					currentModel: this.facade.model,
					availableDefaultModels: this.facade.modelRuntime.getAvailableSnapshot(),
					showImages: this.settingsManager.getShowImages(),
					imageWidthCells: this.settingsManager.getImageWidthCells(),
					autoResizeImages: this.settingsManager.getImageAutoResize(),
					blockImages: this.settingsManager.getBlockImages(),
					enableSkillCommands: this.settingsManager.getEnableSkillCommands(),
					steeringMode: this.facade.steeringMode,
					followUpMode: this.facade.followUpMode,
					transport: this.settingsManager.getTransport(),
					sessionShareDestination: this.settingsManager.getSessionShareDestination(),
					httpIdleTimeoutMs: this.settingsManager.getHttpIdleTimeoutMs(),
					cacheWarmingMode: this.settingsManager.getCacheWarmingMode(),
					serverIdleTimeoutMs: this.settingsManager.getServerIdleTimeoutMs(),
					showSessionSidebar: this.settingsManager.getShowSessionSidebar(),
					thinkingLevel: this.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL,
					availableThinkingLevels: [...THINKING_LEVEL_OPTIONS],
					modelThinkingLevels: this.settingsManager.getAllModelThinkingLevels(),
					currentTheme: this.themeController.getThemeSelection() || SYSTEM_THEME_NAME,
					terminalTheme: this.themeController.getTerminalTheme(),
					availableThemes: getAvailableThemes(),
					hideThinkingBlock: this.hideThinkingBlock,
					mermaidRenderingMode: this.settingsManager.getMermaidRenderingMode(),
					collapseChangelog: this.settingsManager.getCollapseChangelog(),
					doubleEscapeAction: this.settingsManager.getDoubleEscapeAction(),
					treeFilterMode: this.settingsManager.getTreeFilterMode(),
					showHardwareCursor: this.settingsManager.getShowHardwareCursor(),
					showCacheMissNotices: this.settingsManager.getShowCacheMissNotices(),
					defaultProjectTrust: this.settingsManager.getDefaultProjectTrust(),
					editorPaddingX: this.settingsManager.getEditorPaddingX(),
					outputPad: this.settingsManager.getOutputPad(),
					nerdFonts: this.settingsManager.getNerdFonts(),
					threeDEmptySession: this.settingsManager.getThreeDEmptySession(),
					autocompleteMaxVisible: this.settingsManager.getAutocompleteMaxVisible(),
					autocompletePosition: this.settingsManager.getAutocompletePosition(),
					quietStartup: this.settingsManager.getQuietStartup(),
					clearOnShrink: this.settingsManager.getClearOnShrink(),
					showTerminalProgress: this.settingsManager.getShowTerminalProgress(),
					tuiMode: this.ui.mode,
					fullscreenExitOutput: this.settingsManager.getFullscreenExitOutput(),
					fullscreenScrollbar: this.settingsManager.getFullscreenScrollbar(),
					fullscreenCopyOnSelect: this.settingsManager.getFullscreenCopyOnSelect(),
					fullscreenWheelScrollLines: this.settingsManager.getFullscreenWheelScrollLines(),
					warnings: this.settingsManager.getWarnings(),
				},
				{
					onAutoCompactChange: (enabled) => {
						void this.facade.setAutoCompactionEnabled(enabled);
					},
					onShowImagesChange: (enabled) => {
						this.settingsManager.setShowImages(enabled);
						for (const child of this.chatContainer.children) {
							if (child instanceof ToolExecutionComponent) {
								child.setShowImages(enabled);
							}
						}
					},
					onImageWidthCellsChange: (width) => {
						this.settingsManager.setImageWidthCells(width);
						for (const child of this.chatContainer.children) {
							if (child instanceof ToolExecutionComponent) {
								child.setImageWidthCells(width);
							}
						}
					},
					onAutoResizeImagesChange: (enabled) => {
						this.settingsManager.setImageAutoResize(enabled);
					},
					onBlockImagesChange: (blocked) => {
						this.settingsManager.setBlockImages(blocked);
					},
					onEnableSkillCommandsChange: (enabled) => {
						this.settingsManager.setEnableSkillCommands(enabled);
						this.setupAutocompleteProvider();
					},
					onSteeringModeChange: (mode) => {
						void this.facade.setSteeringMode(mode);
					},
					onFollowUpModeChange: (mode) => {
						void this.facade.setFollowUpMode(mode);
					},
					onTransportChange: (transport) => {
						this.settingsManager.setTransport(transport);
						this.facade.agent.transport = transport;
					},
					onSessionShareDestinationChange: (destination) => {
						this.settingsManager.setSessionShareDestination(destination);
					},
					onHttpIdleTimeoutMsChange: (timeoutMs) => {
						this.settingsManager.setHttpIdleTimeoutMs(timeoutMs);
						configureHttpDispatcher(timeoutMs);
						this.showStatus(`HTTP idle timeout: ${formatHttpIdleTimeoutMs(timeoutMs)}`);
					},
					onCacheWarmingModeChange: (mode) => {
						void this.facade.setCacheWarmingMode(mode);
						this.showStatus(`Cache warming: ${mode}`);
					},
					onServerIdleTimeoutChange: (ms) => {
						this.settingsManager.setServerIdleTimeoutMs(ms);
						this.showStatus(`Server idle timeout: ${formatServerIdleTimeout(ms)}`);
					},
					onShowSessionSidebarChange: (enabled) => {
						this.settingsManager.setShowSessionSidebar(enabled);
						this.applySessionSidebar();
						this.showStatus(`Session sidebar: ${enabled ? "on" : "off"}`);
					},
					onModelThinkingLevelChange: async (provider, modelId, level) => {
						this.settingsManager.setModelThinkingLevel(provider, modelId, level);
						// If the override is for the current model, apply it to the session too
						const current = this.facade.model;
						if (current && current.provider === provider && current.id === modelId) {
							await this.facade.setThinkingLevel(level);
							this.footer.invalidate();
							this.updateEditorBorderColor();
						}
					},
					onModelThinkingLevelRemove: async (provider, modelId) => {
						this.settingsManager.removeModelThinkingLevel(provider, modelId);
						// If the override was for the current model, revert to global default
						const current = this.facade.model;
						if (current && current.provider === provider && current.id === modelId) {
							const globalDefault = this.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
							await this.facade.setThinkingLevel(globalDefault);
							this.footer.invalidate();
							this.updateEditorBorderColor();
						}
					},
					onThemeChange: (themeSetting) => {
						this.settingsManager.setTheme(themeSetting);
						this.themeController.setThemeSetting(themeSetting);
					},
					onThemePreview: (themeName) => this.themeController.preview(themeName),
					onHideThinkingBlockChange: (hidden) => {
						this.hideThinkingBlock = hidden;
						this.settingsManager.setHideThinkingBlock(hidden);
						this.updateThinkingBlockVisibility();
					},
					onMermaidRenderingModeChange: (mode) => {
						this.settingsManager.setMermaidRenderingMode(mode);
						this.chatContainer.invalidate();
						this.ui.requestRender();
					},
					onShowCacheMissNoticesChange: (shown) => {
						this.settingsManager.setShowCacheMissNotices(shown);
						this.rebuildChatFromMessages();
					},
					onCollapseChangelogChange: (collapsed) => {
						this.settingsManager.setCollapseChangelog(collapsed);
					},
					onQuietStartupChange: (quiet) => {
						this.settingsManager.setQuietStartup(quiet);
					},
					onDefaultProjectTrustChange: (defaultProjectTrust) => {
						this.settingsManager.setDefaultProjectTrust(defaultProjectTrust);
					},
					onDoubleEscapeActionChange: (action) => {
						this.settingsManager.setDoubleEscapeAction(action);
					},
					onTreeFilterModeChange: (mode) => {
						this.settingsManager.setTreeFilterMode(mode);
					},
					onShowHardwareCursorChange: (enabled) => {
						this.settingsManager.setShowHardwareCursor(enabled);
						this.ui.setShowHardwareCursor(enabled);
					},
					onEditorPaddingXChange: (padding) => {
						this.settingsManager.setEditorPaddingX(padding);
						this.defaultEditor.setPaddingX(padding);
						if (this.editor !== this.defaultEditor && this.editor.setPaddingX !== undefined) {
							this.editor.setPaddingX(padding);
						}
					},
					onOutputPadChange: (padding) => {
						this.settingsManager.setOutputPad(padding);
						this.outputPad = padding;
						for (const container of [this.chatContainer, this.pendingMessagesContainer]) {
							for (const child of container.children) {
								if ("setOutputPad" in child && typeof child.setOutputPad === "function") {
									child.setOutputPad(padding);
								}
							}
						}
						this.ui.requestRender();
					},
					onNerdFontsChange: (enabled) => {
						this.settingsManager.setNerdFonts(enabled);
						this.footer.setNerdFonts(enabled);
						this.ui.requestRender();
					},
					onThreeDEmptySessionChange: (enabled) => {
						this.settingsManager.setThreeDEmptySession(enabled);
						this.syncEmptySessionScreen();
					},
					onAutocompleteMaxVisibleChange: (maxVisible) => {
						this.settingsManager.setAutocompleteMaxVisible(maxVisible);
						this.defaultEditor.setAutocompleteMaxVisible(maxVisible);
						if (this.editor !== this.defaultEditor && this.editor.setAutocompleteMaxVisible !== undefined) {
							this.editor.setAutocompleteMaxVisible(maxVisible);
						}
					},
					onAutocompletePositionChange: (position) => {
						this.settingsManager.setAutocompletePosition(position);
						this.defaultEditor.setAutocompletePosition(position);
						if (this.editor !== this.defaultEditor && this.editor.setAutocompletePosition !== undefined) {
							this.editor.setAutocompletePosition(position);
						}
					},
					onClearOnShrinkChange: (enabled) => {
						this.settingsManager.setClearOnShrink(enabled);
						this.ui.setClearOnShrink(enabled);
						if (!enabled && !this.activeStatusIndicator) {
							this.statusContainer.clear();
						}
					},
					onShowTerminalProgressChange: (enabled) => {
						this.settingsManager.setShowTerminalProgress(enabled);
						this.updateProgressBar();
					},
					onTuiModeChange: (mode) => {
						if (!this.switchTuiMode(mode)) {
							selector?.getSettingsList().updateValue("tui-mode", this.ui.mode);
							this.showStatus("Close active overlays before changing TUI mode");
							return;
						}
						this.settingsManager.setTuiMode(mode);
						if (!this.activeStatusIndicator) this.statusContainer.clear();
						this.showStatus(`TUI mode: ${mode}`);
					},
					onFullscreenExitOutputChange: (output) => {
						this.settingsManager.setFullscreenExitOutput(output);
					},
					onFullscreenScrollbarChange: (mode) => {
						this.settingsManager.setFullscreenScrollbar(mode);
						this.applyFullscreenScrollbarSetting();
					},
					onFullscreenCopyOnSelectChange: (enabled) => {
						this.settingsManager.setFullscreenCopyOnSelect(enabled);
						if (this.renderer instanceof TuiAltScreen) this.renderer.setCopyOnSelect(enabled);
					},
					onFullscreenWheelScrollLinesChange: (lines) => {
						this.settingsManager.setFullscreenWheelScrollLines(lines);
						if (this.renderer instanceof TuiAltScreen) this.renderer.setWheelScrollLines(lines);
					},
					onWarningsChange: (warnings) => {
						this.settingsManager.setWarnings(warnings);
					},
					onCancel: () => {
						done();
						this.ui.requestRender();
					},
				},
			);
			return { component: selector, focus: selector.getSettingsList() };
		});
	}

	private async handleThinkingCommand(searchTerm?: string): Promise<void> {
		const availableLevels = await this.facade.getAvailableThinkingLevels();
		if (!searchTerm) {
			await this.showThinkingSelector();
			return;
		}

		const normalized = searchTerm.trim().toLowerCase();
		const level = availableLevels.find((candidate) => candidate.toLowerCase() === normalized);
		if (!level) {
			this.showError(`Unknown thinking level "${searchTerm}". Available levels: ${availableLevels.join(", ")}.`);
			return;
		}

		await this.selectThinkingLevel(level, false);
	}

	private async selectThinkingLevel(level: ThinkingLevel, persist: boolean): Promise<void> {
		try {
			await this.facade.setThinkingLevel(level, { persist });
			this.footer.invalidate();
			this.updateEditorBorderColor();
			this.showStatus(persist ? `Default thinking level: ${level}` : `Thinking level: ${level}`);
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	private async showThinkingSelector(): Promise<void> {
		const availableLevels = await this.facade.getAvailableThinkingLevels();
		this.showSelector((done) => {
			const selectLevel = (level: ThinkingLevel, persist: boolean) => {
				void this.selectThinkingLevel(level, persist);
				done();
			};
			const selector = new ThinkingSelectorComponent(
				this.facade.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
				availableLevels,
				(level) => selectLevel(level, false),
				() => {
					done();
					this.ui.requestRender();
				},
				(level) => selectLevel(level, true),
				this.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL,
			);
			return { component: selector, focus: selector };
		});
	}

	private async handleModelCommand(searchTerm?: string): Promise<void> {
		if (!searchTerm) {
			this.showModelSelector();
			return;
		}

		const model = await this.findExactModelMatch(searchTerm);
		if (model) {
			try {
				await this.facade.setModel(model, { persist: false });
				this.footer.invalidate();
				this.updateEditorBorderColor();
				this.showStatus(`Model: ${model.id}`);
				void this.maybeWarnAboutAnthropicSubscriptionAuth(model);
			} catch (error) {
				this.showError(error instanceof Error ? error.message : String(error));
			}
			return;
		}

		this.showModelSelector(searchTerm);
	}

	private async findExactModelMatch(searchTerm: string): Promise<Model<any> | undefined> {
		const cachedModels =
			this.facade.scopedModels.length > 0
				? this.facade.scopedModels.map((scoped) => scoped.model)
				: [...this.facade.modelRuntime.getAvailableSnapshot()];
		const cachedMatch = findExactModelReferenceMatch(searchTerm, cachedModels);
		if (cachedMatch || this.facade.scopedModels.length > 0) return cachedMatch;

		this.showStatus("Refreshing model catalogs…");
		const controller = new AbortController();
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, 15_000);
		try {
			const result = await refreshModelCatalogs(this.facade.modelRuntime, controller.signal);
			if (result.aborted && timedOut) {
				this.showWarning("Model refresh timed out; searching cached models.");
			} else if (result.errors.size > 0) {
				this.showWarning(`Could not refresh ${[...result.errors.keys()].join(", ")}; searching cached models.`);
			}
		} catch (error) {
			this.showWarning(
				timedOut
					? "Model refresh timed out; searching cached models."
					: `Could not refresh model catalogs: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			clearTimeout(timeout);
		}
		return findExactModelReferenceMatch(searchTerm, [...this.facade.modelRuntime.getAvailableSnapshot()]);
	}

	/** Update the footer's available provider count from the current snapshot without refreshing catalogs. */
	private updateAvailableProviderCount(): void {
		const models =
			this.facade.scopedModels.length > 0
				? this.facade.scopedModels.map((scoped) => scoped.model)
				: this.facade.modelRuntime.getAvailableSnapshot();
		const uniqueProviders = new Set(models.map((model) => model.provider));
		this.footerDataProvider.setAvailableProviderCount(uniqueProviders.size);
	}

	private async maybeWarnAboutAnthropicSubscriptionAuth(
		model: Model<any> | undefined = this.facade.model,
	): Promise<void> {
		if (this.settingsManager.getWarnings().anthropicExtraUsage === false) {
			return;
		}
		if (this.anthropicSubscriptionWarningShown) {
			return;
		}
		if (!model || model.provider !== "anthropic") {
			return;
		}

		try {
			if ((await this.facade.modelRuntime.checkAuth("anthropic"))?.type === "oauth") {
				this.anthropicSubscriptionWarningShown = true;
				this.showWarning(ANTHROPIC_SUBSCRIPTION_AUTH_WARNING);
				return;
			}
			const apiKey = (await this.facade.modelRuntime.getAuth(model.provider))?.auth.apiKey;
			if (!isAnthropicSubscriptionAuthKey(apiKey)) {
				return;
			}
			this.anthropicSubscriptionWarningShown = true;
			this.showWarning(ANTHROPIC_SUBSCRIPTION_AUTH_WARNING);
		} catch {
			// Ignore auth lookup failures for warning-only checks.
		}
	}

	private maybeSaveImplicitProjectTrustAfterReload(): boolean {
		const cwd = this.sessionManager.getCwd();
		if (this.autoTrustOnReloadCwd !== cwd) {
			return false;
		}
		if (!this.settingsManager.isProjectTrusted() || !hasTrustRequiringProjectResources(cwd)) {
			return false;
		}

		const trustStore = new ProjectTrustStore(this.facade.agentDir);
		try {
			if (trustStore.get(cwd) !== null) {
				this.autoTrustOnReloadCwd = undefined;
				return false;
			}
			trustStore.set(cwd, true);
			this.autoTrustOnReloadCwd = undefined;
			return true;
		} catch (error) {
			this.showWarning(
				`Could not save project trust after reload: ${error instanceof Error ? error.message : String(error)}`,
			);
			return false;
		}
	}

	private showTrustSelector(): void {
		const cwd = this.sessionManager.getCwd();
		const trustStore = new ProjectTrustStore(this.facade.agentDir);
		const savedDecision = trustStore.getEntry(cwd);
		this.showSelector((done) => {
			const selector = new TrustSelectorComponent({
				cwd,
				savedDecision,
				projectTrusted: this.settingsManager.isProjectTrusted(),
				onSelect: (selection) => {
					trustStore.setMany(selection.updates);
					done();
					this.showStatus(
						`Saved trust decision: ${selection.trusted ? "trusted" : "untrusted"}. Restart ${APP_NAME} for this to take effect.`,
					);
				},
				onCancel: () => {
					done();
					this.ui.requestRender();
				},
			});
			return { component: selector, focus: selector };
		});
	}

	private showModelSelector(initialSearchInput?: string): void {
		this.showSelector((done) => {
			const selectModel = async (model: Model<any>, persist: boolean) => {
				try {
					await this.facade.setModel(model, { persist });
					this.updateAvailableProviderCount();
					this.footer.invalidate();
					this.updateEditorBorderColor();
					done();
					this.showStatus(persist ? `Default model: ${model.provider}/${model.id}` : `Model: ${model.id}`);
					void this.maybeWarnAboutAnthropicSubscriptionAuth(model);
				} catch (error) {
					done();
					this.showError(error instanceof Error ? error.message : String(error));
				}
			};
			const defaultProvider = this.settingsManager.getDefaultProvider();
			const defaultModel = this.settingsManager.getDefaultModel();
			const selector = new ModelSelectorComponent(
				this.ui,
				this.facade.model,
				this.facade.modelRuntime,
				this.facade.scopedModels,
				(model) => selectModel(model, false),
				() => {
					done();
					this.ui.requestRender();
				},
				initialSearchInput,
				(model) => selectModel(model, true),
				defaultProvider && defaultModel ? { provider: defaultProvider, id: defaultModel } : undefined,
			);
			return { component: selector, focus: selector, dispose: () => selector.dispose() };
		});
	}

	private showModelsSelector(): void {
		let availableModels = [...this.facade.modelRuntime.getAvailableSnapshot()];
		let availableModelIds = new Set(availableModels.map((model) => `${model.provider}/${model.id}`));
		const configuredPatterns = this.settingsManager.getEnabledModels();
		const sessionScopedModels = this.facade.scopedModels;
		const configuredEnabledIds = (models: readonly Model<any>[]): string[] | null => {
			if (!configuredPatterns?.length) return null;
			const resolved = resolveModelScopeFromModels(configuredPatterns, models);
			const ids = resolved.scopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`);
			for (const diagnostic of resolved.diagnostics) {
				if (diagnostic.code === "no-match" && !ids.includes(diagnostic.pattern)) ids.push(diagnostic.pattern);
			}
			return ids;
		};

		let currentEnabledIds =
			sessionScopedModels.length > 0
				? sessionScopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`)
				: configuredEnabledIds(availableModels);
		let selectionChanged = false;

		const updateSessionModels = (enabledIds: string[] | null): void => {
			currentEnabledIds = enabledIds === null ? null : [...enabledIds];
			const hasEnabledAvailableModel = enabledIds?.some((id) => availableModelIds.has(id)) ?? false;
			const allAvailableModelsEnabled =
				enabledIds !== null && [...availableModelIds].every((id) => enabledIds.includes(id));
			if (enabledIds && hasEnabledAvailableModel && !allAvailableModelsEnabled) {
				const newScopedModels = resolveModelScopeFromModels(enabledIds, availableModels).scopedModels;
				void this.facade.setScopedModels(
					newScopedModels.map((scoped) => ({
						model: scoped.model,
						thinkingLevel: scoped.thinkingLevel,
					})),
				);
			} else {
				void this.facade.setScopedModels([]);
			}
			this.updateAvailableProviderCount();
			this.ui.requestRender();
		};

		this.showSelector((done) => {
			let disposed = false;
			let timedOut = false;
			const controller = new AbortController();
			const timeout = setTimeout(() => {
				timedOut = true;
				controller.abort();
			}, 15_000);
			const selector = new ScopedModelsSelectorComponent(
				{
					allModels: availableModels,
					enabledModelIds: currentEnabledIds,
					refreshStatus: "Refreshing model catalogs…",
				},
				{
					onChange: (enabledIds) => {
						selectionChanged = true;
						updateSessionModels(enabledIds);
					},
					onPersist: (enabledIds) => {
						const allEnabled =
							enabledIds !== null &&
							enabledIds.length === availableModels.length &&
							enabledIds.every((id) => availableModelIds.has(id));
						const newPatterns = enabledIds === null || allEnabled ? undefined : enabledIds;
						this.settingsManager.setEnabledModels(newPatterns ? [...newPatterns] : undefined);
						this.showStatus("Model selection saved to settings");
					},
					onCancel: () => {
						done();
						this.ui.requestRender();
					},
				},
			);
			void refreshModelCatalogs(this.facade.modelRuntime, controller.signal)
				.then((result) => {
					if (disposed) return;
					availableModels = [...this.facade.modelRuntime.getAvailableSnapshot()];
					availableModelIds = new Set(availableModels.map((model) => `${model.provider}/${model.id}`));
					if (!selectionChanged && sessionScopedModels.length === 0) {
						currentEnabledIds = configuredEnabledIds(availableModels);
						selector.updateModels(availableModels, currentEnabledIds);
					} else {
						selector.updateModels(availableModels);
					}
					if (currentEnabledIds !== null) updateSessionModels(currentEnabledIds);
					if (result.aborted && timedOut) {
						selector.setRefreshStatus("Model refresh timed out; showing cached models.", "warning");
					} else if (result.errors.size > 0) {
						selector.setRefreshStatus(
							`Could not refresh ${[...result.errors.keys()].join(", ")}; showing cached models.`,
							"warning",
						);
					} else {
						selector.setRefreshStatus("Model catalogs refreshed.", "success");
					}
					this.ui.requestRender();
				})
				.catch((error: unknown) => {
					if (disposed) return;
					selector.setRefreshStatus(
						timedOut
							? "Model refresh timed out; showing cached models."
							: `Could not refresh model catalogs: ${error instanceof Error ? error.message : String(error)}`,
						"warning",
					);
					this.ui.requestRender();
				})
				.finally(() => clearTimeout(timeout));
			return {
				component: selector,
				focus: selector,
				dispose: () => {
					disposed = true;
					clearTimeout(timeout);
					controller.abort();
				},
			};
		});
	}

	private async showUserMessageSelector(): Promise<void> {
		const userMessages = await this.facade.getUserMessagesForForking();

		if (userMessages.length === 0) {
			this.showStatus("No messages to fork from");
			return;
		}

		const initialSelectedId = userMessages[userMessages.length - 1]?.entryId;

		this.showSelector((done) => {
			const selector = new UserMessageSelectorComponent(
				userMessages.map((m) => ({ id: m.entryId, text: m.text })),
				async (entryId) => {
					done();
					try {
						const result = await this.facade.fork(entryId);
						if (result.cancelled) {
							this.ui.requestRender();
							return;
						}

						this.editor.setText(result.text ?? "");
						this.showStatus("Forked to new session");
					} catch (error: unknown) {
						this.showError(error instanceof Error ? error.message : String(error));
					}
				},
				() => {
					done();
					this.ui.requestRender();
				},
				initialSelectedId,
			);
			return { component: selector, focus: selector.getMessageList() };
		});
	}

	private async handleCloneCommand(): Promise<void> {
		const leafId = this.sessionManager.getLeafId();
		if (!leafId) {
			this.showStatus("Nothing to clone yet");
			return;
		}

		try {
			const result = await this.facade.clone();
			if (result.cancelled) {
				this.ui.requestRender();
				return;
			}

			this.editor.setText("");
			this.showStatus("Cloned to new session");
		} catch (error: unknown) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	private showTreeSelector(initialSelectedId?: string): void {
		const tree = this.sessionManager.getTree();
		const realLeafId = this.sessionManager.getLeafId();
		const initialFilterMode = this.settingsManager.getTreeFilterMode();

		if (tree.length === 0) {
			this.showStatus("No entries in session");
			return;
		}

		this.showSelector((done) => {
			const selector = new TreeSelectorComponent(
				tree,
				realLeafId,
				this.ui.terminal.rows,
				async (entryId) => {
					// Selecting the current leaf is a no-op (already there)
					if (entryId === this.sessionManager.getLeafId()) {
						done();
						this.showStatus("Already at this point");
						return;
					}

					// Ask about summarization
					done(); // Close selector first

					// Loop until user makes a complete choice or cancels to tree
					let wantsSummary = false;
					let customInstructions: string | undefined;

					// Check if we should skip the prompt (user preference to always default to no summary)
					if (!this.settingsManager.getBranchSummarySkipPrompt()) {
						while (true) {
							const summaryChoice = await this.showExtensionSelector("Summarize branch?", [
								"No summary",
								"Summarize",
								"Summarize with custom prompt",
							]);

							if (summaryChoice === undefined) {
								// User pressed escape - re-show tree selector with same selection
								this.showTreeSelector(entryId);
								return;
							}

							wantsSummary = summaryChoice !== "No summary";

							if (summaryChoice === "Summarize with custom prompt") {
								customInstructions = await this.showExtensionEditor("Custom summarization instructions");
								if (customInstructions === undefined) {
									// User cancelled - loop back to summary selector
									continue;
								}
							}

							// User made a complete choice
							break;
						}
					}

					// The user committed to navigating: stop the active response first.
					if (this.facade.isStreaming) {
						await this.restoreQueuedMessagesToEditor();
						await this.facade.abort();
					}

					// Recheck after the dialogs and streaming abort, before replacing another operation's UI.
					if (this.facade.isCompacting) {
						this.showError(
							"Wait for the current compaction or tree navigation to finish before navigating the session tree.",
						);
						return;
					}

					// Set up escape handler and status indicator if summarizing
					let showingSummaryIndicator = false;
					const originalOnEscape = this.defaultEditor.onEscape;

					if (wantsSummary) {
						this.defaultEditor.onEscape = () => {
							void this.facade.abortBranchSummary();
						};
						this.chatContainer.addChild(new Spacer(1));
						this.showStatusIndicator(new BranchSummaryStatusIndicator(this.ui));
						showingSummaryIndicator = true;
						this.ui.requestRender();
					}

					try {
						const result = await this.facade.navigateTree(entryId, {
							summarize: wantsSummary,
							customInstructions,
						});

						if (result.aborted) {
							// Summarization aborted - re-show tree selector with same selection
							this.showStatus("Branch summarization cancelled");
							this.showTreeSelector(entryId);
							return;
						}
						if (result.cancelled) {
							this.showStatus("Navigation cancelled");
							return;
						}

						// Update UI
						this.chatContainer.clear();
						this.pendingUserMessageEchoes = [];
						this.renderInitialMessages();
						if (result.editorText && !this.editor.getText().trim()) {
							this.editor.setText(result.editorText);
						}
						this.showStatus("Navigated to selected point");
						void this.flushCompactionQueue({ willRetry: false });
					} catch (error) {
						this.showError(error instanceof Error ? error.message : String(error));
					} finally {
						if (showingSummaryIndicator) {
							this.clearStatusIndicator("branchSummary");
						}
						this.defaultEditor.onEscape = originalOnEscape;
					}
				},
				() => {
					done();
					this.ui.requestRender();
				},
				(entryId, label) => {
					void this.sessionManager.appendLabelChange(entryId, label);
					this.ui.requestRender();
				},
				initialSelectedId,
				initialFilterMode,
			);
			selector.onCopy = async (text) => {
				if (!text) {
					this.showError("Selected entry has no text to copy");
					return;
				}
				try {
					await copyToClipboard(text);
					this.showStatus("Copied selected message to clipboard");
				} catch (error) {
					this.showError(error instanceof Error ? error.message : String(error));
				}
			};
			return { component: selector, focus: selector };
		});
	}

	private showSkillsSelector(): void {
		const skills = this.facade.resourceLoader.getSkills().skills;
		if (skills.length === 0) {
			this.showWarning("No skills available");
			return;
		}

		const items: MenuItem<string>[] = skills.map((skill) => ({
			title: skill.name,
			description: skill.description,
			value: skill.name,
		}));

		this.showMenu("Skills", items, (skillName) => {
			this.editor.setText(`@${skillName} `);
		});
	}

	private showThemeSelector(): void {
		const current = this.themeController.getThemeSelection() || SYSTEM_THEME_NAME;
		const items: MenuItem<string>[] = getAvailableThemes().map((name) => ({
			title: name,
			description: name === current ? "(current)" : undefined,
			value: name,
		}));

		this.showSelector(
			(done) => {
				const selector = new MenuComponent<string>(
					{ title: "Theme", items, floating: true },
					(themeName) => {
						done();
						this.applyTheme(themeName);
					},
					() => {
						done();
						// Restore the theme that was active before the preview.
						this.themeController.preview(current);
						this.ui.requestRender();
					},
				);
				// Preview the theme under the cursor so the choice is visible before confirming.
				selector.onSelectionChange = (themeName) => this.themeController.preview(themeName);
				return { component: selector, focus: selector };
			},
			{ floating: true },
		);
	}

	private applyTheme(themeName: string): void {
		const result = this.themeController.setThemeName(themeName);
		if (!result.success) {
			this.showError(result.error ?? `Failed to apply theme "${themeName}"`);
			return;
		}
		if (this.settingsManager.getTheme() !== themeName) {
			this.settingsManager.setTheme(themeName);
		}
		this.ui.invalidate();
		this.ui.requestRender();
	}

	private applyThemeArgument(argument: string): void {
		const themes = getAvailableThemes();
		const match = themes.find((name) => name.toLowerCase() === argument.toLowerCase());
		if (!match) {
			this.showError(`Unknown theme "${argument}". Available: ${themes.join(", ")}`);
			return;
		}
		this.applyTheme(match);
	}

	private showMenu<T>(title: string, items: MenuItem<T>[], onSelect: (value: T) => void): void {
		this.showSelector(
			(done) => {
				const selector = new MenuComponent<T>(
					{ title, items, floating: true },
					(value) => {
						done();
						onSelect(value);
					},
					() => {
						done();
						this.ui.requestRender();
					},
				);
				return { component: selector, focus: selector };
			},
			{ floating: true },
		);
	}

	private showSessionSelector(): void {
		this.showSelector(
			(done) => {
				const selector = new SessionMenuComponent({
					currentLoad: (onProgress, signal) =>
						SessionManager.list(
							this.sessionManager.getCwd(),
							this.sessionManager.getSessionDir(),
							onProgress,
							signal,
						),
					allLoad: (onProgress, signal) =>
						this.sessionManager.usesDefaultSessionDir()
							? SessionManager.listAll(onProgress, signal)
							: SessionManager.listAll(this.sessionManager.getSessionDir(), onProgress, signal),
					onSelect: (session) => {
						done();
						void this.handleResumeSession(session.path);
					},
					onCancel: () => {
						done();
						this.ui.requestRender();
					},
					onRequestRender: () => this.ui.requestRender(),
					renameSession: async (sessionFilePath: string, nextName: string | undefined) => {
						const next = (nextName ?? "").trim();
						if (!next) return;
						const mgr = SessionManager.open(sessionFilePath);
						mgr.appendSessionInfo(next);
					},
					currentSessionPath: this.sessionManager.getSessionFile(),
					floating: true,
				});
				return { component: selector, focus: selector, dispose: () => selector.dispose() };
			},
			{ floating: true },
		);
	}

	private async handleResumeSession(sessionPath: string): Promise<{ cancelled: boolean }> {
		this.clearStatusIndicator();
		try {
			const result = await this.facade.switchSession(sessionPath);
			if (result.cancelled) {
				return result;
			}
			this.showStatus("Resumed session");
			return result;
		} catch (error: unknown) {
			this.showError(`Failed to resume session: ${error instanceof Error ? error.message : String(error)}`);
			return { cancelled: true };
		}
	}

	private getLoginProviderOptions(authType?: "oauth" | "api_key"): AuthSelectorProvider[] {
		const options: AuthSelectorProvider[] = [];
		for (const provider of this.facade.modelRuntime.getProviders()) {
			const authStatus = this.facade.modelRuntime.getProviderAuthStatus(provider.id);
			const status = authStatus.configured
				? {
						type: this.facade.modelRuntime.isUsingOAuth(provider.id) ? ("oauth" as const) : ("api_key" as const),
						source: authStatus.label ?? authStatus.source,
					}
				: undefined;
			const subscription = provider.auth.oauth?.isSubscription === true;
			if ((!authType || authType === "oauth") && provider.auth.oauth) {
				options.push({
					id: provider.id,
					name: provider.name,
					authType: "oauth",
					method: provider.auth.oauth,
					status,
					subscription,
				});
			}
			if ((!authType || authType === "api_key") && provider.auth.apiKey) {
				options.push({
					id: provider.id,
					name: provider.name,
					authType: "api_key",
					method: provider.auth.apiKey,
					status,
					subscription,
				});
			}
		}
		return options.sort((a, b) => a.name.localeCompare(b.name));
	}

	private async getLogoutProviderOptions(): Promise<AuthSelectorProvider[]> {
		return (await this.facade.modelRuntime.listCredentials({ signal: AbortSignal.timeout(15_000) }))
			.map(({ providerId, type }) => {
				const provider = this.facade.modelRuntime.getProvider(providerId);
				return {
					id: providerId,
					name: provider?.name ?? providerId,
					authType: type,
					status: { type, source: "stored credential" },
					subscription: provider?.auth.oauth?.isSubscription === true,
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	private findLoginProviderOptions(providerRef: string): AuthSelectorProvider[] {
		const normalizedProviderRef = providerRef.trim().toLowerCase();
		if (!normalizedProviderRef) {
			return [];
		}

		return this.getLoginProviderOptions().filter(
			(provider) =>
				provider.id.toLowerCase() === normalizedProviderRef ||
				provider.name.toLowerCase() === normalizedProviderRef,
		);
	}

	private async handleLoginCommand(providerRef?: string): Promise<void> {
		if (!providerRef) {
			this.showLoginAuthTypeSelector();
			return;
		}

		const providerOptions = this.findLoginProviderOptions(providerRef);
		if (providerOptions.length === 1) {
			await this.startProviderLogin(providerOptions[0]!);
			return;
		}

		if (providerOptions.length > 1) {
			const providerIds = new Set(providerOptions.map((provider) => provider.id));
			if (providerIds.size === 1) {
				this.showLoginAuthTypeSelector(providerOptions);
				return;
			}
		}

		this.showLoginProviderSelector(undefined, providerRef);
	}

	/** `onBack` reopens the selector the login was started from when the user cancels it. */
	private async startProviderLogin(providerOption: AuthSelectorProvider, onBack?: () => void): Promise<void> {
		if (providerOption.authType === "oauth") {
			await this.showLoginDialog(providerOption.id, providerOption.name, onBack);
		} else if (providerOption.method?.login) {
			await this.showApiKeyLoginDialog(providerOption.id, providerOption.name, onBack);
		} else {
			this.showAmbientAuthDialog(providerOption, onBack);
		}
	}

	private showLoginAuthTypeSelector(providerOptions?: AuthSelectorProvider[]): void {
		// The top-level selector offers Radius directly, as its last option.
		const radiusOption = providerOptions
			? undefined
			: this.getLoginProviderOptions("oauth").find((provider) => provider.id === RADIUS_PROVIDER_ID);
		const radiusText = radiusOption ? `Sign in with ${radiusOption.name}` : undefined;
		const radiusLabel = radiusOption ? `${radiusText}${formatAuthSelectorProviderStatus(radiusOption)}` : undefined;
		const oauthProvider = providerOptions?.find((provider) => provider.authType === "oauth");
		const oauthLoginLabel =
			oauthProvider?.method && "loginLabel" in oauthProvider.method ? oauthProvider.method.loginLabel : undefined;
		const subscriptionLabel = oauthLoginLabel ?? "Sign in with an account";
		const apiKeyLabel = "Sign in with an API key";
		const availableAuthTypes = providerOptions
			? new Set(providerOptions.map((provider) => provider.authType))
			: new Set<AuthSelectorProvider["authType"]>(["oauth", "api_key"]);
		const options: string[] = [];
		if (availableAuthTypes.has("oauth")) {
			options.push(subscriptionLabel);
		}
		if (availableAuthTypes.has("api_key")) {
			options.push(apiKeyLabel);
		}
		if (radiusLabel) options.push(radiusLabel);

		if (options.length === 0) {
			this.showStatus("No login methods available.");
			return;
		}

		if (providerOptions && options.length === 1) {
			const providerOption = providerOptions[0];
			if (providerOption) {
				void this.startProviderLogin(providerOption);
			}
			return;
		}

		const title = providerOptions?.[0]
			? `Select authentication method for ${providerOptions[0].name}:`
			: "Select authentication method:";
		this.showSelector((done) => {
			const onSelect = (option: string) => {
				done();
				if (radiusOption && option === radiusLabel) {
					void this.startProviderLogin(radiusOption, () => this.showLoginAuthTypeSelector());
					return;
				}
				const authType = option === subscriptionLabel ? "oauth" : "api_key";
				if (providerOptions) {
					const providerOption = providerOptions.find((provider) => provider.authType === authType);
					if (providerOption) {
						void this.startProviderLogin(providerOption, () => this.showLoginAuthTypeSelector(providerOptions));
					}
					return;
				}
				this.showLoginProviderSelector(authType);
			};
			const onCancel = () => {
				done();
				this.ui.requestRender();
			};
			const selector =
				radiusLabel && radiusText
					? createLoginMenuSelector(
							this.ui,
							title,
							options,
							{ label: radiusLabel, text: radiusText },
							onSelect,
							onCancel,
						)
					: new ExtensionSelectorComponent(title, options, onSelect, onCancel);
			return { component: selector, focus: selector, dispose: () => selector.dispose() };
		});
	}

	private showLoginProviderSelector(authType?: AuthSelectorProvider["authType"], initialSearchInput?: string): void {
		const providerOptions = this.getLoginProviderOptions(authType);
		if (providerOptions.length === 0) {
			const message =
				authType === "oauth"
					? "No account providers available."
					: authType === "api_key"
						? "No API key providers available."
						: "No login providers available.";
			this.showStatus(message);
			return;
		}

		this.showSelector((done) => {
			const selector = new OAuthSelectorComponent(
				"login",
				providerOptions,
				async (providerId, selectedAuthType) => {
					done();

					const providerOption = providerOptions.find(
						(provider) => provider.id === providerId && provider.authType === selectedAuthType,
					);
					if (!providerOption) {
						return;
					}

					await this.startProviderLogin(providerOption, () =>
						this.showLoginProviderSelector(authType, initialSearchInput),
					);
				},
				() => {
					done();
					if (authType) {
						this.showLoginAuthTypeSelector();
					} else {
						this.ui.requestRender();
					}
				},
				initialSearchInput,
			);
			return { component: selector, focus: selector };
		});
	}

	private async showOAuthSelector(mode: "login" | "logout"): Promise<void> {
		if (mode === "login") {
			this.showLoginAuthTypeSelector();
			return;
		}

		let providerOptions: AuthSelectorProvider[];
		try {
			providerOptions = await this.getLogoutProviderOptions();
		} catch (error) {
			this.showError(`Could not read stored credentials: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		if (providerOptions.length === 0) {
			this.showStatus(
				"No stored credentials to remove. /logout only removes credentials saved by /login; environment variables and models.json config are unchanged.",
			);
			return;
		}

		this.showSelector((done) => {
			const selector = new OAuthSelectorComponent(
				mode,
				providerOptions,
				async (providerId: string) => {
					done();

					const providerOption = providerOptions.find((provider) => provider.id === providerId);
					if (!providerOption) {
						return;
					}

					try {
						await this.facade.modelRuntime.logout(providerOption.id, {
							signal: AbortSignal.timeout(15_000),
						});
						await this.updateAvailableProviderCount();
						const message =
							providerOption.authType === "oauth"
								? `Logged out of ${providerOption.name}`
								: `Removed stored API key for ${providerOption.name}. Environment variables and models.json config are unchanged.`;
						this.showStatus(message);
					} catch (error: unknown) {
						const message = error instanceof Error ? error.message : String(error);
						this.showError(
							error instanceof CredentialSynchronizationError
								? `Credentials removed for ${providerOption.name}, but local model state could not be synchronized: ${message}`
								: `Logout failed: ${message}`,
						);
					}
				},
				() => {
					done();
					this.ui.requestRender();
				},
			);
			return { component: selector, focus: selector };
		});
	}

	private async completeProviderAuthentication(
		providerId: string,
		providerName: string,
		authType: "oauth" | "api_key",
		previousModel: Model<any> | undefined,
	): Promise<void> {
		const actionLabel = authType === "oauth" ? `Logged in to ${providerName}` : `Saved API key for ${providerName}`;

		const session = this.facade;
		// Dynamic catalogs may be empty until the first authenticated network refresh.
		const deferSelection =
			isUnknownModel(previousModel) &&
			hasDefaultModelProvider(providerId) &&
			!session.modelRuntime
				.getAvailableSnapshot()
				.some((model) => model.provider === providerId && model.id === defaultModelPerProvider[providerId]);
		const finishAuthentication = async () => {
			let selectedModel: Model<any> | undefined;
			let selectionError: string | undefined;
			if (isUnknownModel(previousModel)) {
				const availableModels = this.facade.modelRuntime.getAvailableSnapshot();
				const providerModels = availableModels.filter((model) => model.provider === providerId);
				// Matches LLAMA_PROVIDER_ID from extensions/llama/provider.ts; kept inline to avoid coupling interactive mode to the built-in extension.
				if (providerId === "llama.cpp") {
					selectionError = llamaCppPostLoginGuidance(actionLabel, providerModels.length);
				} else if (!hasDefaultModelProvider(providerId)) {
					selectionError = `${actionLabel}, but no default model is configured for provider "${providerId}". Use /model to select a model.`;
				} else if (providerModels.length === 0) {
					selectionError = `${actionLabel}, but no models are available for that provider. Use /model to select a model.`;
				} else {
					const defaultModelId = defaultModelPerProvider[providerId];
					// Radius catalogs vary by account; prefer balanced, then use catalog order.
					selectedModel =
						providerModels.find((model) => model.id === defaultModelId) ??
						(providerId === "radius" ? providerModels[0] : undefined);
					if (!selectedModel) {
						selectionError = `${actionLabel}, but its default model "${defaultModelId}" is not available. Use /model to select a model.`;
					} else {
						try {
							await this.facade.setModel(selectedModel, { persist: true });
						} catch (error: unknown) {
							selectedModel = undefined;
							const errorMessage = error instanceof Error ? error.message : String(error);
							selectionError = `${actionLabel}, but selecting its default model failed: ${errorMessage}. Use /model to select a model.`;
						}
					}
				}
			}

			await this.updateAvailableProviderCount();
			this.footer.invalidate();
			this.updateEditorBorderColor();
			if (selectedModel) {
				this.showStatus(`${actionLabel}. Selected ${selectedModel.id}. Credentials saved to ${getAuthPath()}`);
				void this.maybeWarnAboutAnthropicSubscriptionAuth(selectedModel);
			} else {
				this.showStatus(`${actionLabel}. Credentials saved to ${getAuthPath()}`);
				if (selectionError) {
					this.showError(selectionError);
				} else {
					void this.maybeWarnAboutAnthropicSubscriptionAuth();
				}
			}
		};
		if (deferSelection) {
			this.showStatus(`${actionLabel}. Credentials saved to ${getAuthPath()}. Refreshing model catalog…`);
		} else {
			await finishAuthentication();
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15_000);
		void session.modelRuntime
			.refresh({ providers: [providerId], signal: controller.signal })
			.then(async (result) => {
				if (result.aborted) {
					this.showWarning(`${actionLabel}, but its model catalog refresh timed out; using cached models.`);
				} else if (result.errors.size > 0) {
					this.showWarning(`${actionLabel}, but its model catalog could not be refreshed; using cached models.`);
				}
				// Do not replace a model or session selected while the refresh was running.
				if (deferSelection && this.facade === session && session.model === previousModel) {
					await finishAuthentication();
				}
				this.updateAvailableProviderCount();
				this.footer.invalidate();
				this.ui.requestRender();
			})
			.catch((error: unknown) => {
				this.showWarning(
					`${actionLabel}, but its model catalog could not be refreshed: ${error instanceof Error ? error.message : String(error)}`,
				);
			})
			.finally(() => clearTimeout(timeout));
	}

	private showAmbientAuthDialog(providerOption: AuthSelectorProvider, onBack?: () => void): void {
		const restoreEditor = () => {
			this.editorContainer.clear();
			this.editorContainer.addChild(this.editor);
			this.ui.setFocus(this.editor);
			this.ui.requestRender();
		};

		const dialog = new LoginDialogComponent(
			this.ui,
			providerOption.id,
			() => {
				restoreEditor();
				onBack?.();
			},
			providerOption.name,
			`${providerOption.name} setup`,
		);
		dialog.showInfo(
			`${providerOption.method?.name ?? "Authentication"} is configured outside ${APP_NAME}.`,
			[],
			true,
		);

		this.editorContainer.clear();
		this.editorContainer.addChild(dialog);
		this.ui.setFocus(dialog);
		this.ui.requestRender();
	}

	private async showApiKeyLoginDialog(providerId: string, providerName: string, onBack?: () => void): Promise<void> {
		const previousModel = this.facade.model;

		const dialog = new LoginDialogComponent(
			this.ui,
			providerId,
			(_success, _message) => {
				// Completion handled below
			},
			providerName,
		);

		if (providerId === "amazon-bedrock") {
			dialog.showDetails([
				theme.fg("text", "You can also use an AWS profile, IAM keys, or role-based credentials."),
				theme.fg("muted", "See:"),
				theme.fg("accent", `  ${path.join(getDocsPath(), "providers.md")}`),
			]);
		}

		this.editorContainer.clear();
		this.editorContainer.addChild(dialog);
		this.ui.setFocus(dialog);
		this.ui.requestRender();

		const restoreEditor = () => {
			this.editorContainer.clear();
			this.editorContainer.addChild(this.editor);
			this.ui.setFocus(this.editor);
			this.ui.requestRender();
		};

		try {
			await this.loginProvider(dialog, providerId, providerName, "api_key");
			restoreEditor();
			await this.completeProviderAuthentication(providerId, providerName, "api_key", previousModel);
		} catch (error: unknown) {
			restoreEditor();
			const errorMsg = error instanceof Error ? error.message : String(error);
			if (error instanceof CredentialSynchronizationError) {
				this.showError(
					`Saved API key for ${providerName}, but local model state could not be synchronized: ${errorMsg}`,
				);
			} else if (errorMsg === "Login cancelled") {
				onBack?.();
			} else {
				this.showError(`Failed to save API key for ${providerName}: ${errorMsg}`);
			}
		}
	}

	private showAuthSelect(
		dialog: LoginDialogComponent,
		prompt: Extract<AuthPrompt, { type: "select" }>,
		providerId: string,
	): Promise<string> {
		return new Promise((resolve, reject) => {
			const restoreDialog = () => {
				this.editorContainer.clear();
				this.editorContainer.addChild(dialog);
				this.ui.setFocus(dialog);
				this.ui.requestRender();
			};
			const labels = prompt.options.map((option) => option.label);
			const selector = new ExtensionSelectorComponent(
				prompt.message,
				labels,
				(optionLabel) => {
					restoreDialog();
					const id = prompt.options.find((option) => option.label === optionLabel)?.id;
					if (id) resolve(id);
					else reject(new Error("Login cancelled"));
				},
				() => {
					restoreDialog();
					reject(new Error("Login cancelled"));
				},
				{ description: providerId === RADIUS_PROVIDER_ID ? RADIUS_LOGIN_INTRO : undefined },
			);
			this.editorContainer.clear();
			this.editorContainer.addChild(selector);
			this.ui.setFocus(selector);
			this.ui.requestRender();
		});
	}

	private async showAuthPrompt(dialog: LoginDialogComponent, prompt: AuthPrompt, providerId: string): Promise<string> {
		let response: Promise<string>;
		if (prompt.type === "select") {
			response = this.showAuthSelect(dialog, prompt, providerId);
		} else if (prompt.type === "manual_code") {
			response = dialog.showManualInput(prompt.message);
		} else {
			response = dialog.showPrompt(prompt.message, prompt.placeholder);
		}
		if (!prompt.signal) return response;
		if (prompt.signal.aborted) throw new Error("Login cancelled");
		const signal = prompt.signal;
		let onAbort: (() => void) | undefined;
		const aborted = new Promise<string>((_resolve, reject) => {
			onAbort = () => reject(new Error("Login cancelled"));
			signal.addEventListener("abort", onAbort, { once: true });
		});
		try {
			return await Promise.race([response, aborted]);
		} finally {
			if (onAbort) signal.removeEventListener("abort", onAbort);
		}
	}

	private notifyAuthDialog(dialog: LoginDialogComponent, event: AuthEvent): void {
		if (event.type === "auth_url") {
			dialog.showAuth(event.url, event.instructions);
		} else if (event.type === "device_code") {
			dialog.showDeviceCode(event);
			dialog.showWaiting("Waiting for authentication...");
		} else if (event.type === "info") {
			dialog.showInfo(event.message, event.links);
		} else {
			dialog.showProgress(event.message);
		}
	}

	private async loginProvider(
		dialog: LoginDialogComponent,
		providerId: string,
		providerName: string,
		method: "api_key" | "oauth",
	): Promise<void> {
		this.programStatus.setBlocked("login", { kind: "auth", message: `Log in to ${providerName}` });
		try {
			await this.facade.modelRuntime.login(
				providerId,
				method,
				{
					signal: dialog.signal,
					prompt: (prompt) => this.showAuthPrompt(dialog, prompt, providerId),
					notify: (event) => this.notifyAuthDialog(dialog, event),
				},
				{ getDeviceId: () => this.settingsManager.getOrCreateDeviceId() },
			);
		} finally {
			this.programStatus.setBlocked("login", undefined);
		}
	}

	private async showLoginDialog(providerId: string, providerName: string, onBack?: () => void): Promise<void> {
		const previousModel = this.facade.model;
		const dialog = new LoginDialogComponent(this.ui, providerId, (_success, _message) => {}, providerName);
		this.editorContainer.clear();
		this.editorContainer.addChild(dialog);
		this.ui.setFocus(dialog);
		this.ui.requestRender();

		const restoreEditor = () => {
			this.editorContainer.clear();
			this.editorContainer.addChild(this.editor);
			this.ui.setFocus(this.editor);
			this.ui.requestRender();
		};

		try {
			await this.loginProvider(dialog, providerId, providerName, "oauth");
			restoreEditor();
			await this.completeProviderAuthentication(providerId, providerName, "oauth", previousModel);
			if (providerId === RADIUS_PROVIDER_ID) this.offerRadiusMcpServer(providerId, providerName);
		} catch (error: unknown) {
			restoreEditor();
			const errorMsg = error instanceof Error ? error.message : String(error);
			if (error instanceof CredentialSynchronizationError) {
				this.showError(
					`Logged in to ${providerName}, but local model state could not be synchronized: ${errorMsg}`,
				);
			} else if (errorMsg === "Login cancelled") {
				onBack?.();
			} else {
				this.showError(`Failed to login to ${providerName}: ${errorMsg}`);
			}
		}
	}

	/**
	 * Offer to point the Radius MCP server in the global mcp.json at the Radius login, adding the server
	 * when missing. Nothing is asked when a global server already uses this login.
	 */
	private offerRadiusMcpServer(providerId: string, providerName: string): void {
		const mcpPath = path.join(getAgentDir(), "mcp.json");
		const normalizeUrl = (url: string) => url.replace(/\/+$/u, "");
		const { servers } = loadMcpConfig({
			agentDir: getAgentDir(),
			cwd: this.sessionManager.getCwd(),
			projectTrusted: false,
		});
		const existing = servers.find(
			(server) => "url" in server.config && normalizeUrl(server.config.url) === normalizeUrl(RADIUS_MCP_URL),
		);
		if (existing && "url" in existing.config && existing.config.auth?.provider === providerId) return;

		let name = existing?.name ?? "radius";
		if (!existing && servers.some((server) => server.name === name)) name = "radius-mcp";
		const config: McpHttpServerConfig =
			existing && "url" in existing.config
				? { ...existing.config, auth: { provider: providerId } }
				: { url: RADIUS_MCP_URL, auth: { provider: providerId } };
		// `auth` replaces the MCP OAuth sign-in.
		delete config.oauth;

		this.showSelector((done) => {
			const selector = new ExtensionSelectorComponent(
				`Configure ${providerName} MCP in ${mcpPath}?`,
				["Yes", "No"],
				(option) => {
					done();
					if (option !== "Yes") return;
					try {
						addMcpServerConfig(mcpPath, name, config);
					} catch (error: unknown) {
						this.showError(
							`Could not update ${mcpPath}: ${error instanceof Error ? error.message : String(error)}`,
						);
						return;
					}
					// The MCP extension reads mcp.json when the session starts.
					void this.handleReloadCommand();
				},
				() => {
					done();
					this.ui.requestRender();
				},
			);
			return { component: selector, focus: selector };
		});
	}

	// =========================================================================
	// Command handlers
	// =========================================================================

	private async handleReloadCommand(): Promise<void> {
		if (this.facade.isStreaming) {
			this.showWarning("Wait for the current response to finish before reloading.");
			return;
		}
		if (this.facade.isCompacting) {
			this.showWarning("Wait for compaction to finish before reloading.");
			return;
		}

		this.resetExtensionUI();

		const reloadBox = new Container();
		const borderColor = (s: string) => theme.fg("border", s);
		reloadBox.addChild(new DynamicBorder(borderColor));
		reloadBox.addChild(new Spacer(1));
		reloadBox.addChild(
			new ThemedText(
				() => theme.fg("muted", "Reloading keybindings, extensions, skills, prompts, themes, and context files..."),
				1,
				0,
			),
		);
		reloadBox.addChild(new Spacer(1));
		reloadBox.addChild(new DynamicBorder(borderColor));

		const previousEditor = this.editor;
		this.editorContainer.clear();
		this.editorContainer.addChild(reloadBox);
		this.ui.setFocus(reloadBox);
		this.ui.requestRender(true);
		await new Promise((resolve) => process.nextTick(resolve));

		const dismissReloadBox = (editor: Component) => {
			this.editorContainer.clear();
			this.editorContainer.addChild(editor);
			this.ui.setFocus(editor);
			this.ui.requestRender();
		};

		let chatRestoredBeforeSessionStart = false;
		let reloadBoxDismissed = false;
		const restoreChatBeforeSessionStart = () => {
			if (chatRestoredBeforeSessionStart) {
				return;
			}
			this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
			this.outputPad = this.settingsManager.getOutputPad();
			this.rebuildChatFromMessages();
			chatRestoredBeforeSessionStart = true;
		};

		try {
			await this.facade.reload();
			restoreChatBeforeSessionStart();
			this.keybindings.reload();
			const activeHeader = this.customHeader ?? this.builtInHeader;
			if (isExpandable(activeHeader)) {
				activeHeader.setExpanded(this.toolOutputExpanded);
			}
			this.applyRuntimeSettings();
			this.themeController.applyFromSettings();
			await this.loadClientExtensions();
			this.setupAutocompleteProvider();
			this.showResourceDiagnostics();
			const savedImplicitProjectTrust = this.maybeSaveImplicitProjectTrustAfterReload();
			const modelsJsonError = this.facade.modelRuntime.getError();
			if (modelsJsonError) {
				this.showError(`models.json error: ${modelsJsonError}`);
			}
			this.showStatus(
				savedImplicitProjectTrust
					? "Reloaded keybindings, extensions, skills, prompts, themes, and context files; saved project trust"
					: "Reloaded keybindings, extensions, skills, prompts, themes, and context files",
			);
			dismissReloadBox(this.editor as Component);
			reloadBoxDismissed = true;
		} catch (error) {
			if (!reloadBoxDismissed) {
				dismissReloadBox(previousEditor as Component);
			}
			this.showError(`Reload failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async handleExportCommand(text: string): Promise<void> {
		const outputPath = this.getPathCommandArgument(text, "/export");

		try {
			if (outputPath?.endsWith(".jsonl")) {
				const filePath = await this.facade.exportToJsonl(outputPath);
				this.showStatus(`Session exported to: ${filePath}`);
			} else {
				const filePath = await this.facade.exportToHtml(outputPath);
				this.showStatus(`Session exported to: ${filePath}`);
			}
		} catch (error: unknown) {
			this.showError(`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	}

	private getPathCommandArgument(text: string, command: "/export" | "/import"): string | undefined {
		if (text === command) {
			return undefined;
		}
		if (!text.startsWith(`${command} `)) {
			return undefined;
		}

		const argsString = text.slice(command.length + 1).trimStart();
		if (!argsString) {
			return undefined;
		}

		const firstChar = argsString[0];
		if (firstChar === '"' || firstChar === "'") {
			const closingQuoteIndex = argsString.indexOf(firstChar, 1);
			if (closingQuoteIndex < 0) {
				return undefined;
			}
			return argsString.slice(1, closingQuoteIndex);
		}

		const firstWhitespaceIndex = argsString.search(/\s/);
		if (firstWhitespaceIndex < 0) {
			return argsString;
		}
		return argsString.slice(0, firstWhitespaceIndex);
	}

	private async handleImportCommand(text: string): Promise<void> {
		const inputPath = this.getPathCommandArgument(text, "/import");
		if (!inputPath) {
			this.showError("Usage: /import <path.jsonl>");
			return;
		}

		const confirmed = await this.showExtensionConfirm("Import session", `Replace current session with ${inputPath}?`);
		if (!confirmed) {
			this.showStatus("Import cancelled");
			return;
		}

		try {
			this.clearStatusIndicator();
			const result = await this.facade.importFromJsonl(inputPath);
			if (result.cancelled) {
				this.showStatus("Import cancelled");
				return;
			}
			this.showStatus(`Session imported from: ${inputPath}`);
		} catch (error: unknown) {
			if (error instanceof MissingSessionCwdError) {
				const selectedCwd = await this.promptForMissingSessionCwd(error);
				if (!selectedCwd) {
					this.showStatus("Import cancelled");
					return;
				}
				const result = await this.facade.importFromJsonl(inputPath, selectedCwd);
				if (result.cancelled) {
					this.showStatus("Import cancelled");
					return;
				}
				this.showStatus(`Session imported from: ${inputPath}`);
				return;
			}
			if (error instanceof SessionImportFileNotFoundError) {
				this.showError(`Failed to import session: ${error.message}`);
				return;
			}
			this.showError(`Failed to import session: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async handleShareCommand(): Promise<void> {
		await shareSession({
			session: this.facade,
			ui: this.ui,
			editorContainer: this.editorContainer,
			editor: this.editor,
			showStatus: (message) => this.showStatus(message),
			showError: (message) => this.showError(message),
		});
	}

	private async handleBugCommand(hint: string | undefined): Promise<void> {
		await reportBug(
			{
				session: this.facade,
				ui: this.ui,
				editorContainer: this.editorContainer,
				editor: this.editor,
				keybindings: this.keybindings,
				showStatus: (message) => this.showStatus(message),
				showError: (message) => this.showError(message),
			},
			hint,
		);
	}

	private async handleCopyCommand(
		options: { flashConfirmation?: boolean; preferSelection?: boolean } = {},
	): Promise<void> {
		if (
			options.preferSelection &&
			this.ui instanceof TuiAltScreen &&
			!this.ui.getCopyOnSelect() &&
			this.ui.hasActiveSelection()
		) {
			await this.ui.copyActiveSelectionToClipboard();
			return;
		}

		const text = await this.facade.getLastAssistantText();
		if (!text) {
			this.showError("No agent messages to copy yet.");
			return;
		}

		try {
			await copyToClipboard(text);
			if (options.flashConfirmation && this.ui instanceof TuiAltScreen) {
				this.ui.flash("Copied!");
			} else {
				this.showStatus("Copied last agent message to clipboard");
			}
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	private async handleNameCommand(text: string): Promise<void> {
		const name = text.replace(/^\/name\s*/, "").trim();
		if (!name) {
			const currentName = this.sessionManager.getSessionName();
			if (currentName) {
				this.chatContainer.addChild(new Spacer(1));
				this.chatContainer.addChild(new ThemedText(() => theme.fg("dim", `Session name: ${currentName}`), 1, 0));
			} else {
				this.showWarning("Usage: /name <name>");
			}
			this.ui.requestRender();
			return;
		}

		await this.facade.setSessionName(name);
		const sessionName = this.sessionManager.getSessionName();
		if (sessionName !== name) {
			this.showWarning(`Session name was normalized from ${JSON.stringify(name)} to ${JSON.stringify(sessionName)}`);
		}
		this.chatContainer.addChild(new Spacer(1));
		const displayName = sessionName ?? name;
		this.chatContainer.addChild(new ThemedText(() => theme.fg("dim", `Session name set: ${displayName}`), 1, 0));
		this.ui.requestRender();
	}

	private async handleStatsCommand(): Promise<void> {
		const stats = await this.facade.getSessionStats();
		if (!stats) {
			this.showError("No session statistics available.");
			return;
		}
		const sessionName = this.sessionManager.getSessionName();
		const entries = this.sessionManager.getEntries();
		const cacheWaste = computeCacheWaste(entries, this.facade.modelRuntime);

		// Cost/token totals per provider/model actually used (e.g. OpenRouter `auto`
		// resolves to a concrete responseModel). Usage without model attribution is
		// grouped separately so the breakdown reconciles with the session total.
		const usageBreakdown = getUsageCostBreakdown(entries);

		// Snapshot the stats; the text is built on demand so it follows theme changes.
		const cacheWarmingStatus = this.facade.cacheWarmingStatus;
		const cacheWarmingMode = this.settingsManager.getCacheWarmingMode();
		const model = this.facade.model;
		const selectedModelKey = `${model?.provider}/${model?.id}`;
		const renderInfo = (): string => {
			let info = `${theme.bold("Session Stats")}\n\n`;
			if (sessionName) {
				info += `${theme.fg("dim", "Name:")} ${sessionName}\n`;
			}
			info += `${theme.fg("dim", "File:")} ${stats.sessionFile ?? "In-memory"}\n`;
			info += `${theme.fg("dim", "ID:")} ${stats.sessionId}\n\n`;
			info += `${theme.bold("Messages")}\n`;
			info += `${theme.fg("dim", "Total:")} ${stats.totalMessages}\n`;
			info += `${theme.fg("dim", "User:")} ${stats.userMessages}\n`;
			info += `${theme.fg("dim", "Assistant:")} ${stats.assistantMessages}\n`;
			info += `${theme.fg("dim", "Tools:")} ${stats.toolCalls} calls, ${stats.toolResults} results\n\n`;
			info += `${theme.bold("Tokens")}\n`;
			// "Input" is the full prompt volume. With cache activity, split it into
			// cached (served from cache) vs uncached (everything else) - the only
			// provider-independent split. Cache writes, where reported, are a detail
			// of the uncached portion.
			const { input, cacheRead, cacheWrite } = stats.tokens;
			const promptTokens = input + cacheRead + cacheWrite;
			info += `${theme.fg("dim", "Input:")} ${promptTokens.toLocaleString()}\n`;
			if (promptTokens > 0 && (cacheRead > 0 || cacheWrite > 0)) {
				const hitRate = theme.fg("dim", `(${((cacheRead / promptTokens) * 100).toFixed(1)}%)`);
				info += `  ${theme.fg("dim", "Cached:")} ${cacheRead.toLocaleString()} ${hitRate}\n`;
				const written =
					cacheWrite > 0 ? ` ${theme.fg("dim", `(${cacheWrite.toLocaleString()} written to cache)`)}` : "";
				info += `  ${theme.fg("dim", "Uncached:")} ${(input + cacheWrite).toLocaleString()}${written}\n`;
			}
			info += `${theme.fg("dim", "Output:")} ${stats.tokens.output.toLocaleString()}\n`;
			info += `${theme.fg("dim", "Total:")} ${stats.tokens.total.toLocaleString()}\n`;

			info += `\n${theme.bold("Cache Warming")}\n`;
			info += `${theme.fg("dim", "Mode:")} ${cacheWarmingMode}\n`;
			info += `${theme.fg("dim", "Status:")} ${cacheWarmingStatus ? formatCacheWarmingStatus(cacheWarmingStatus) : "Inactive (cache warming unavailable)"}\n`;
			const decision = cacheWarmingStatus?.decision;
			if (decision?.economicsAvailable) {
				info += `${theme.fg("dim", "Cache miss penalty:")} $${decision.missCost.toFixed(3)}\n`;
				info += `${theme.fg("dim", "Refresh cost:")} $${decision.warmCost.toFixed(3)}\n`;
			}

			if (stats.cost > 0 || cacheWaste.missedTokens > 0) {
				info += `\n${theme.bold("Cost")}\n`;
				info += `${theme.fg("dim", "Total:")} $${stats.cost.toFixed(3)}`;
				// A single entry repeats the total, unless it names a model other than the selected one.
				if (usageBreakdown.length > 1 || usageBreakdown[0]?.key !== selectedModelKey) {
					for (const entry of usageBreakdown) {
						info += `\n  ${theme.fg("dim", `${entry.key}:`)} $${entry.cost.toFixed(3)} ${theme.fg("dim", `(${formatTokens(entry.tokens)} tokens)`)}`;
					}
				}
				if (cacheWaste.missedTokens > 0) {
					const missLabel = cacheWaste.missCount === 1 ? "1 miss" : `${cacheWaste.missCount} misses`;
					const detail = `${cacheWaste.missedTokens.toLocaleString()} tokens, ${missLabel}`;
					info +=
						cacheWaste.missedCost >= 0.0001
							? `\n${theme.fg("dim", "Cache Re-billed:")} $${cacheWaste.missedCost.toFixed(3)} ${theme.fg("dim", `(${detail})`)}`
							: `\n${theme.fg("dim", "Cache Re-billed:")} ${detail}`;
				}
			}
			return info;
		};

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new ThemedText(renderInfo, 1, 0));
		this.ui.requestRender();
	}

	/**
	 * Ask the server for a pairing code and show the QR code of it.
	 *
	 * The opencode app reads the QR code: it carries the code and the addresses of the
	 * server, so the app can pair from the phone.
	 */
	private async handlePairCommand(): Promise<void> {
		const client = this.getServerClient();
		if (!client) {
			this.showError("No pi server is registered for this agent directory.");
			return;
		}
		const registration = this.getServerRegistration();
		let flow: PairingFlow;
		try {
			flow = await runPairingFlow({
				url: client.serverUrl,
				password: registration?.password,
			});
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
			return;
		}
		this.showPairDialog(flow);
	}

	/**
	 * Show the pairing code in the transcript.
	 *
	 * The pairing code is a chat message, not an overlay: the user keeps typing while it is
	 * on the screen, and the agent does not see it.
	 */
	private showPairDialog(flow: PairingFlow): void {
		const dialog = new PairDialog({
			payloadText: flow.payloadText,
			code: flow.code,
			expiresIn: flow.expiresIn,
			connectUrls: flow.connectUrls,
			reachable: flow.payload.urls.length > 0,
		});
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new ThemedText(() => theme.bold(theme.fg("accent", "Pair a device")), 1, 0));
		this.chatContainer.addChild(dialog);
		this.chatContainer.addChild(new Spacer(1));
		this.ui.requestRender();
	}

	/** Show the server the client is connected to. */
	private async handleServerCommand(): Promise<void> {
		const info = (await this.loadServerInfo()) ?? this.serverInfo;
		this.serverInfo = info;
		const sessionFile = this.sessionManager.getSessionFile();
		const renderInfo = (): string => {
			let text = `${theme.bold("Server")}\n\n`;
			if (!info) {
				text += `${theme.fg("dim", "Url:")} unknown\n`;
				text += `${theme.fg("dim", "The client could not reach a registered pi server.")}\n`;
			} else {
				text += `${theme.fg("dim", "Url:")} ${info.url}\n`;
				text += `${theme.fg("dim", "Pid:")} ${info.pid}\n`;
				text += `${theme.fg("dim", "Version:")} ${info.version}\n`;
				text += `${theme.fg("dim", "Mode:")} ${info.mode}\n`;
				for (const url of info.urls) {
					text += `${theme.fg("dim", "Address:")} ${url}\n`;
				}
			}
			text += `\n${theme.bold("Session")}\n`;
			text += `${theme.fg("dim", "Id:")} ${this.facade.sessionId}\n`;
			text += `${theme.fg("dim", "File:")} ${sessionFile ?? "In-memory"}\n`;
			text += `${theme.fg("dim", "Cwd:")} ${this.facade.cwd}\n`;
			return text;
		};

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new ThemedText(renderInfo, 1, 0));
		this.ui.requestRender();
	}

	private handleChangelogCommand(): void {
		const changelogPath = getChangelogPath();
		const allEntries = parseChangelog(changelogPath);

		const changelogMarkdown =
			allEntries.length > 0
				? allEntries
						.reverse()
						.map((e) => normalizeChangelogLinks(e.content, e))
						.join("\n\n")
				: "No changelog entries found.";

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder());
		this.chatContainer.addChild(new ThemedText(() => theme.bold(theme.fg("accent", "What's New")), 1, 0));
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Markdown(changelogMarkdown, 1, 1, this.getMarkdownThemeWithSettings()));
		this.chatContainer.addChild(new DynamicBorder());
		this.ui.requestRender();
	}

	/**
	 * Get capitalized display string for an app keybinding action.
	 */
	private getAppKeyDisplay(action: AppKeybinding): string {
		return keyDisplayText(action);
	}

	/**
	 * Get capitalized display string for an editor keybinding action.
	 */
	private getEditorKeyDisplay(action: Keybinding): string {
		return keyDisplayText(action);
	}

	private handleHotkeysCommand(): void {
		// Navigation keybindings
		const cursorUp = this.getEditorKeyDisplay("tui.editor.cursorUp");
		const cursorDown = this.getEditorKeyDisplay("tui.editor.cursorDown");
		const cursorLeft = this.getEditorKeyDisplay("tui.editor.cursorLeft");
		const cursorRight = this.getEditorKeyDisplay("tui.editor.cursorRight");
		const cursorWordLeft = this.getEditorKeyDisplay("tui.editor.cursorWordLeft");
		const cursorWordRight = this.getEditorKeyDisplay("tui.editor.cursorWordRight");
		const cursorLineStart = this.getEditorKeyDisplay("tui.editor.cursorLineStart");
		const jumpForward = this.getEditorKeyDisplay("tui.editor.jumpForward");
		const jumpBackward = this.getEditorKeyDisplay("tui.editor.jumpBackward");
		const pageUp = this.getEditorKeyDisplay("tui.editor.pageUp");
		const pageDown = this.getEditorKeyDisplay("tui.editor.pageDown");

		// Editing keybindings
		const submit = this.getEditorKeyDisplay("tui.input.submit");
		const newLine = this.getEditorKeyDisplay("tui.input.newLine");
		const deleteWordBackward = this.getEditorKeyDisplay("tui.editor.deleteWordBackward");
		const deleteWordForward = this.getEditorKeyDisplay("tui.editor.deleteWordForward");
		const deleteToLineStart = this.getEditorKeyDisplay("tui.editor.deleteToLineStart");
		const deleteToLineEnd = this.getEditorKeyDisplay("tui.editor.deleteToLineEnd");
		const yank = this.getEditorKeyDisplay("tui.editor.yank");
		const yankPop = this.getEditorKeyDisplay("tui.editor.yankPop");
		const undo = this.getEditorKeyDisplay("tui.editor.undo");
		const tab = this.getEditorKeyDisplay("tui.input.tab");

		// App keybindings
		const interrupt = this.getAppKeyDisplay("app.interrupt");
		const quit = this.getAppKeyDisplay("app.quit");
		const exit = this.getAppKeyDisplay("app.exit");
		const suspend = this.getAppKeyDisplay("app.suspend");
		const cycleThinkingLevel = this.getAppKeyDisplay("app.thinking.cycle");
		const cycleModelForward = this.getAppKeyDisplay("app.model.cycleForward");
		const selectModel = this.getAppKeyDisplay("app.model.select");
		const expandTools = this.getAppKeyDisplay("app.tools.expand");
		const toggleThinking = this.getAppKeyDisplay("app.thinking.toggle");
		const externalEditor = this.getAppKeyDisplay("app.editor.external");
		const cycleModelBackward = this.getAppKeyDisplay("app.model.cycleBackward");
		const copyMessage = this.getAppKeyDisplay("app.message.copy");
		const followUp = this.getAppKeyDisplay("app.message.followUp");
		const dequeue = this.getAppKeyDisplay("app.message.dequeue");
		const pasteImage = this.getAppKeyDisplay("app.clipboard.pasteImage");

		const hotkeys = `
**Navigation**
| Key | Action |
|-----|--------|
| \`${cursorUp}\` / \`${cursorDown}\` / \`${cursorLeft}\` / \`${cursorRight}\` | Move cursor / browse history |
| \`${cursorWordLeft}\` / \`${cursorWordRight}\` | Move by word |
| \`${cursorLineStart}\` | Start of line |
| \`${jumpForward}\` | Jump forward to character |
| \`${jumpBackward}\` | Jump backward to character |
| \`${pageUp}\` / \`${pageDown}\` | Scroll by page |

**Editing**
| Key | Action |
|-----|--------|
| \`${submit}\` | Send message |
| \`${newLine}\` | New line${process.platform === "win32" ? " (Ctrl+Enter on Windows Terminal)" : ""} |
| \`${deleteWordBackward}\` | Delete word backwards |
| \`${deleteWordForward}\` | Delete word forwards |
| \`${deleteToLineStart}\` | Delete to start of line |
| \`${deleteToLineEnd}\` | Delete to end of line |
| \`${yank}\` | Paste the most-recently-deleted text |
| \`${yankPop}\` | Cycle through the deleted text after pasting |
| \`${undo}\` | Undo |

**Other**
| Key | Action |
|-----|--------|
| \`${tab}\` | Path completion / accept autocomplete |
| \`${interrupt}\` | Cancel autocomplete / abort streaming |
| \`${quit}\` | Exit (press twice) |
| \`${exit}\` | Exit (when editor is empty) |
| \`${suspend}\` | Suspend to background |
| \`${cycleThinkingLevel}\` | Cycle thinking level |
| \`${cycleModelForward}\` / \`${cycleModelBackward}\` | Cycle models |
| \`${selectModel}\` | Open model selector |
| \`${expandTools}\` | Toggle tool output expansion |
| \`${toggleThinking}\` | Toggle thinking block visibility |
| \`${externalEditor}\` | Edit message in external editor |
| \`${copyMessage}\` | Copy selection or last assistant message |
| \`${followUp}\` | Queue follow-up message |
| \`${dequeue}\` | Restore queued messages |
| \`${pasteImage}\` | Paste files on macOS, images, or text from clipboard |
| \`/\` | Slash commands |
| \`!\` | Run bash command |
| \`!!\` | Run bash command (excluded from context) |
`;

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder());
		this.chatContainer.addChild(new ThemedText(() => theme.bold(theme.fg("accent", "Keyboard Shortcuts")), 1, 0));
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Markdown(hotkeys.trim(), 1, 1, this.getMarkdownThemeWithSettings()));
		this.chatContainer.addChild(new DynamicBorder());
		this.ui.requestRender();
	}

	private async handleClearCommand(): Promise<void> {
		this.clearStatusIndicator();
		try {
			const result = await this.facade.newSession();
			if (result.cancelled) {
				return;
			}
		} catch (error: unknown) {
			await this.handleFatalRuntimeError("Failed to create session", error);
		}
	}

	private handleDebugCommand(): void {
		const width = this.ui.terminal.columns;
		const height = this.ui.terminal.rows;
		const allLines = this.ui.render(width);

		const debugLogPath = getDebugLogPath();
		const debugData = [
			`Debug output at ${new Date().toISOString()}`,
			`Terminal: ${width}x${height}`,
			`Total lines: ${allLines.length}`,
			"",
			"=== All rendered lines with visible widths ===",
			...allLines.map((line, idx) => {
				const vw = visibleWidth(line);
				const escaped = JSON.stringify(line);
				return `[${idx}] (w=${vw}) ${escaped}`;
			}),
			"",
			"=== Agent messages (JSONL) ===",
			...this.facade.messages.map((msg) => JSON.stringify(msg)),
			"",
		].join("\n");

		fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
		fs.writeFileSync(debugLogPath, debugData);

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(
			new ThemedText(() => `${theme.fg("accent", "✓ Debug log written")}\n${theme.fg("muted", debugLogPath)}`, 1, 1),
		);
		this.ui.requestRender();
	}

	private handleArminSaysHi(): void {
		if (playArmin3d(this.renderer)) return;
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new ArminComponent(this.ui));
		this.ui.requestRender();
	}

	private handleDementedDelves(): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new EarendilAnnouncementComponent());
		this.ui.requestRender();
	}

	private async handleBashCommand(command: string, excludeFromContext = false): Promise<void> {
		const isDeferred = this.facade.isStreaming;
		this.bashComponent = new BashExecutionComponent(command, this.ui, excludeFromContext, this.outputPad);

		if (isDeferred) {
			// Show in pending area when agent is streaming
			this.pendingMessagesContainer.addChild(this.bashComponent);
			this.pendingBashComponents.push(this.bashComponent);
		} else {
			// Show in chat immediately when agent is idle
			this.chatContainer.addChild(this.bashComponent);
		}
		this.ui.requestRender();

		try {
			const result = await this.facade.executeBash(command, undefined, { excludeFromContext });

			if (this.bashComponent) {
				if (result?.output) {
					this.bashComponent.appendOutput(result.output);
				}
				this.bashComponent.setComplete(
					result?.exitCode,
					result?.cancelled ?? false,
					result?.truncated ? ({ truncated: true, content: result.output } as TruncationResult) : undefined,
					result?.fullOutputPath,
				);
			}
		} catch (error) {
			if (this.bashComponent) {
				this.bashComponent.setComplete(undefined, false);
			}
			this.showError(`Bash command failed: ${error instanceof Error ? error.message : "Unknown error"}`);
		}

		this.bashComponent = undefined;
		this.ui.requestRender();
	}

	private async handleCompactCommand(customInstructions?: string): Promise<void> {
		this.clearStatusIndicator();

		try {
			await this.facade.compact(customInstructions);
		} catch {
			// Ignore, will be emitted as an event
		}
	}

	stop(fullscreenExitOutput = this.settingsManager.getFullscreenExitOutput()): void {
		this.disposeActiveSelector();
		this.progressBar.dispose();
		this.clearStatusIndicator();
		this.themeController.disableAutoSync();
		this.clearExtensionTerminalInputListeners();
		this.footer.dispose();
		this.footerDataProvider.dispose();
		if (this.unsubscribe) {
			this.unsubscribe();
		}
		if (this.isInitialized) {
			this.stopInteractiveTui(fullscreenExitOutput);
			this.isInitialized = false;
		}
		this.unregisterSignalHandlers();
	}
}
