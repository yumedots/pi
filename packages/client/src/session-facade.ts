/**
 * The session facade.
 *
 * The TUI used to hold an `AgentSession` and call its members directly. It now holds a
 * facade with the same shape, implemented on top of the pi server: the state comes from
 * the server's snapshot, the commands travel over HTTP.
 *
 * A member that has no faithful counterpart over the wire is typed honestly instead of
 * pretending: the narrow views below carry only what the server can actually provide,
 * and the members that need a round trip return a promise rather than a value.
 */

import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
	AuthCheck,
	AuthInteraction,
	AuthOperationOptions,
	AuthResult,
	AuthType,
	Credential,
	CredentialInfo,
	ImageContent,
	LoginOptions,
	Model,
	ModelsRefreshOptions,
	ModelsRefreshResult,
	Provider,
	Transport,
} from "@earendil-works/pi-ai";
import type {
	AgentSessionEvent,
	CacheWarmingMode,
	CacheWarmingStatus,
	CompactionResult,
	ContextUsage,
	ExtensionUIContext,
	InputSource,
	ModelCycleResult,
	PromptOptions,
	ResourceDiagnostic,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	SessionEntry,
	SessionStats,
	SessionTreeNode,
	SettingsManager,
	SourceInfo,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { BashResult } from "@earendil-works/pi-coding-agent/core/bash-executor";
import type { ModelRuntime, ModelRuntimeAuthOverrides } from "@earendil-works/pi-coding-agent/core/model-runtime";
import type { AuthStatus } from "@earendil-works/pi-coding-agent/core/provider-composer";
import type {
	RemoteSessionInfo,
	RenderRequest,
	RenderResponse,
	SessionStateSnapshot,
} from "@earendil-works/pi-server/client";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

export type { RenderRequest, RenderResponse, RenderToolResult } from "@earendil-works/pi-server/client";

/**
 * The model surface the terminal UI reads.
 *
 * The models themselves come from the server: the server owns the catalog, and the client
 * asks it for the list instead of building a catalog of its own. The provider and the
 * credential surface stays with the client, because the login menu runs the provider
 * login flows in this process.
 */
export interface SessionModelRuntime {
	/** The models the user can pick from. */
	getAvailableSnapshot(): readonly Model<any>[];
	/** The models of one provider, or of every provider. */
	getModels(providerId?: string): readonly Model<any>[];
	/** One model of one provider. */
	getModel(providerId: string, modelId: string): Model<any> | undefined;
	/** The providers the client knows. */
	getProviders(): readonly Provider[];
	/** One provider. */
	getProvider(providerId: string): Provider | undefined;
	/** Whether the provider has credentials, and where they come from. */
	getProviderAuthStatus(providerId: string): AuthStatus;
	/** Whether the provider is used with OAuth. */
	isUsingOAuth(providerId: string): boolean;
	/** Whether the provider is used with a subscription. */
	isUsingSubscription(providerId: string): boolean;
	/** Whether the provider has a complete configuration. */
	hasConfiguredAuth(providerId: string): boolean;
	/** The providers an extension registered. */
	getRegisteredProviderIds(): readonly string[];
	/** Check the credentials of a provider. */
	checkAuth(providerId: string, options?: AuthOperationOptions): Promise<AuthCheck | undefined>;
	/** The credential of a provider. */
	getAuth(providerId: string, overrides?: ModelRuntimeAuthOverrides): Promise<AuthResult | undefined>;
	/** The stored credentials. */
	listCredentials(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]>;
	/** Log a provider in and store its credential. */
	login(providerId: string, type: AuthType, interaction: AuthInteraction, options?: LoginOptions): Promise<Credential>;
	/** Remove the stored credential of a provider. */
	logout(providerId: string, options?: AuthOperationOptions): Promise<void>;
	/** Reload the model list of the server. */
	refresh(options?: ModelsRefreshOptions): Promise<ModelsRefreshResult>;
	/** The error of the last load, if there was one. */
	getError(): string | undefined;
}

/**
 * The provider the components ask when only the server can draw a piece of the transcript.
 *
 * The components cannot hold a facade, so the facade publishes a provider when it is
 * created. The client drives one session at a time, so one provider is enough.
 */
export interface ServerRenderProvider {
	/** Render a piece of the transcript on the server. */
	render(request: RenderRequest): Promise<RenderResponse>;
}

let activeRenderProvider: ServerRenderProvider | undefined;

/**
 * Publish the provider the components ask for a rendering.
 *
 * The client draws the transcript with its own renderers and asks the server for the
 * pieces only the server can draw: the renderers of the extensions that live in the
 * server's process.
 */
export function setServerRenderProvider(provider: ServerRenderProvider | undefined): void {
	activeRenderProvider = provider;
}

/** The provider the components ask for a rendering, when there is one. */
export function getServerRenderProvider(): ServerRenderProvider | undefined {
	return activeRenderProvider;
}

/** How a queued user input was handled. */
export type QueuedInputDisposition = "handled" | "queued";

/** How a prompt was handled. */
export type PromptDisposition = QueuedInputDisposition | "started";

/** The options of a model or thinking level change. */
export interface SessionModelMutationOptions {
	/** Persist the new value to the global defaults. Defaults to session-only. */
	persist?: boolean;
}

/** The options of {@link SessionFacade.navigateTree}. */
export interface SessionNavigateTreeOptions {
	/** Summarize the branch that is left behind. */
	summarize?: boolean;
	/** The instructions for the summary. */
	customInstructions?: string;
	/** Whether the summary replaces the branch instructions. */
	replaceInstructions?: boolean;
	/** The label of the new branch. */
	label?: string;
}

/** The result of {@link SessionFacade.navigateTree}. */
export interface SessionNavigateTreeResult {
	/** Whether the navigation was cancelled. */
	cancelled: boolean;
	/**
	 * Whether the branch summary was aborted.
	 *
	 * The session returns this when the user aborted the summarization of the branch it
	 * left behind. The tree selector is shown again in that case.
	 */
	aborted?: boolean;
	/** The text of the user message the session navigated to, for the editor. */
	editorText?: string;
}

/** The options of {@link SessionFacade.executeBash}. */
export interface SessionExecuteBashOptions {
	/** Whether the output stays out of the context. */
	excludeFromContext?: boolean;
	/** The id of the bash execution. */
	id?: string;
}

/**
 * The state of the session, as the TUI sees it.
 *
 * The live `AgentState` of the agent core cannot travel over the wire: it carries the
 * executable tools and the streaming message, both of which belong to the server's
 * process. The facade exposes the part the TUI reads.
 */
export interface SessionStateView {
	/** The effective system prompt. */
	readonly systemPrompt: string;
	/** The active model, when the client could resolve it. */
	readonly model: Model<any> | undefined;
	/** The active thinking level. */
	readonly thinkingLevel: ThinkingLevel;
	/** Whether the agent is streaming right now. */
	readonly isStreaming: boolean;
	/** The transcript of the session. */
	readonly messages: AgentMessage[];
}

/**
 * The agent of the session, as the TUI sees it.
 *
 * The agent itself lives in the server's process; only its observable state is visible.
 */
export interface SessionAgentView {
	/** The observable state of the agent. */
	readonly state: SessionStateView;
	/**
	 * The signal that ends the current turn.
	 *
	 * The server owns the run, so the signal is the client's mirror of it: it fires when
	 * the turn is aborted or settled.
	 */
	readonly signal: AbortSignal;
	/**
	 * The transport the agent talks to the provider with.
	 *
	 * Writing it stores the transport in the client's settings, the same file the server
	 * reads. The running turn keeps the transport it started with.
	 */
	transport: Transport;
}

/** The options of a new session. */
export interface SessionNewOptions {
	/** The session file the new session continues from. */
	parentSession?: string;
}

/** The result of a session replacement. */
export interface SessionReplacementResult {
	/** Whether the replacement was cancelled. */
	cancelled: boolean;
}

/** The result of a fork. */
export interface SessionForkResult extends SessionReplacementResult {
	/** The text the fork selected, when the fork forked a user message. */
	text?: string;
}

/** What the client binds to the session so the server can ask the user. */
export interface SessionExtensionBindings {
	/**
	 * The UI the server asks when an extension needs the user.
	 *
	 * The server sends the dialogs over the event stream; the client answers them with
	 * the same UI the interactive mode uses.
	 */
	uiContext?: ExtensionUIContext;
	/** Called when the turn is aborted. */
	abortHandler?: () => void;
}

/** A command the session offers. */
export interface SessionCommand {
	/** The name of the command, without the leading slash. */
	readonly name: string;
	/** The name the command is invoked with. */
	readonly invocationName: string;
	/** What the command does. */
	readonly description?: string;
	/** The completions for the command arguments. */
	readonly getArgumentCompletions?: (
		argumentPrefix: string,
	) => AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>;
}

/** The extension commands of the session. */
export interface SessionExtensionRunner {
	/** The commands the extensions registered. */
	getRegisteredCommands(): SessionCommand[];
}

/** A skill the session offers. */
export interface SessionSkill {
	/** The name of the skill, without the leading `@`. */
	readonly name: string;
	/** What the skill does. */
	readonly description: string;
	/** Where the skill comes from. */
	readonly sourceInfo?: SourceInfo;
}

/**
 * A tool the session declares to the model.
 *
 * The server owns the tools, so the client learns about them from the resource
 * snapshot: the name is what the TUI needs to resolve a renderer, the schema is what
 * the shared session export carries.
 */
export interface SessionTool {
	/** The name of the tool, as the model calls it. */
	readonly name: string;
	/** What the tool does. */
	readonly description?: string;
	/** The JSON schema of the tool arguments. */
	readonly parameters?: unknown;
}

/** An extension the server loaded. */
export interface SessionExtensionInfo {
	/** The path of the extension. */
	readonly path: string;
	/** The side the extension declared. */
	readonly side: "client" | "server" | "both";
	/** Where the extension comes from. */
	readonly sourceInfo?: SourceInfo;
}

/** The resources of the session. */
export interface SessionResourceLoader {
	/** The skills the session offers. */
	getSkills(): { skills: SessionSkill[]; diagnostics: ResourceDiagnostic[] };
}

/** A prompt template the session offers. */
export interface SessionPromptTemplate {
	/** The name of the template, without the leading slash. */
	readonly name: string;
	/** What the template does. */
	readonly description: string;
	/** The hint for the template arguments. */
	readonly argumentHint?: string;
	/** Where the template comes from. */
	readonly sourceInfo?: SourceInfo;
}

/**
 * The read-only view of the session store.
 *
 * The server owns the session file. The client sees the entries, the tree and the leaf
 * of the session, and nothing else.
 */
export interface SessionManagerView {
	/** The working directory of the session. */
	getCwd(): string;
	/** The directory the session file lives in. */
	getSessionDir(): string;
	/** The session file, or `undefined` for an in-memory session. */
	getSessionFile(): string | undefined;
	/** The id of the session. */
	getSessionId(): string;
	/** Whether the session lives in the default session directory. */
	usesDefaultSessionDir(): boolean;
	/**
	 * Whether the session continues an earlier one.
	 *
	 * The client reads the header of the session file, which means the client and the
	 * server must share a filesystem.
	 */
	isContinuation(): boolean;
	/** The entries of the session. */
	getEntries(): SessionEntry[];
	/** The tree of the session. */
	getTree(): SessionTreeNode[];
	/** The id of the entry the session continues from. */
	getLeafId(): string | null;
	/** The display name of the session. */
	getSessionName(): string | undefined;
	/** The branch that leads to the given entry, or to the leaf. */
	getBranch(fromId?: string): SessionEntry[];
	/** The entries that make up the context of the session. */
	buildContextEntries(): SessionEntry[];
	/** Label an entry of the session. */
	appendLabelChange(entryId: string, label: string | undefined): Promise<void>;
	/** Append a custom entry to the session, as a child of the current leaf. */
	appendCustomEntry(customType: string, data?: unknown): Promise<void>;
}

/**
 * The session the TUI drives.
 *
 * The shape mirrors `AgentSession`: the members the TUI reads, the members it calls and
 * the resources it renders.
 */
export interface SessionFacade {
	/**
	 * The id the client addresses the session with.
	 *
	 * The server keys its session registry with this id, so it survives a session
	 * replacement. The id of the session file the server currently runs is
	 * `sessionManager.getSessionId()`.
	 */
	readonly sessionId: string;

	/**
	 * The working directory of the session.
	 *
	 * The server owns the session, so the directory comes from the state snapshot.
	 */
	readonly cwd: string;

	// --- Lifecycle ---

	/** Build the client-local resources and load the session. */
	load(): Promise<void>;
	/** Point the facade at another session of the server. */
	switchTo(sessionId: string): Promise<void>;
	/** Release the connection to the server. */
	dispose(): void;
	/** The agent directory of the client. */
	readonly agentDir: string;
	/** Replace the session with a new one. */
	newSession(options?: SessionNewOptions): Promise<SessionReplacementResult>;
	/** Continue another session file. */
	switchSession(sessionPath: string): Promise<SessionReplacementResult>;
	/** Fork the session at an entry. */
	fork(entryId: string): Promise<SessionForkResult>;
	/** Copy the session at its leaf. */
	clone(): Promise<SessionReplacementResult>;
	/**
	 * Import a session from a JSONL file.
	 *
	 * The file is copied into the session directory of the server, which means the client
	 * and the server must share a filesystem.
	 */
	importFromJsonl(inputPath: string, cwdOverride?: string): Promise<SessionReplacementResult>;
	/** Run a hook before the session is replaced. */
	setBeforeSessionInvalidate(handler: () => void | Promise<void>): void;
	/** Run a hook after the session was replaced. */
	setRebindSession(handler: () => void | Promise<void>): void;
	/** Bind the extension UI of the client to the session. */
	bindExtensions(bindings: SessionExtensionBindings): Promise<void>;

	// --- State ---

	/** The active model of the session, when the client could resolve it. */
	readonly model: Model<any> | undefined;
	/** The active thinking level. */
	readonly thinkingLevel: ThinkingLevel;
	/** The models the session cycles through. */
	readonly scopedModels: ReadonlyArray<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;
	/** Whether the agent is streaming right now. */
	readonly isStreaming: boolean;
	/** Whether the session is compacting right now. */
	readonly isCompacting: boolean;
	/** Whether the session has nothing to do. */
	readonly isIdle: boolean;
	/** Whether a bash command is running. */
	readonly isBashRunning: boolean;
	/** The retry attempt of the current turn. */
	readonly retryAttempt: number;
	/** The number of queued messages. */
	readonly pendingMessageCount: number;
	/** The transcript of the session. */
	readonly messages: AgentMessage[];
	/** The session file, or `undefined` for an in-memory session. */
	readonly sessionFile: string | undefined;
	/** How steering messages are queued. */
	readonly steeringMode: "all" | "one-at-a-time";
	/** How follow-up messages are queued. */
	readonly followUpMode: "all" | "one-at-a-time";
	/** Whether the session compacts itself when the context grows. */
	readonly autoCompactionEnabled: boolean;
	/**
	 * The cache warming status of the session.
	 *
	 * The server knows the warming mode but not the state of its warming run, so the
	 * remote facade leaves this undefined.
	 */
	readonly cacheWarmingStatus: CacheWarmingStatus | undefined;
	/** The effective system prompt. */
	readonly systemPrompt: string;
	/**
	 * The context usage of the session, as the last snapshot reported it.
	 *
	 * Use {@link SessionFacade.getContextUsage} for a fresh value.
	 */
	readonly contextUsage: ContextUsage | undefined;
	/**
	 * The statistics of the session, as the last snapshot reported them.
	 *
	 * Use {@link SessionFacade.getSessionStats} for a fresh value.
	 */
	readonly sessionStats: SessionStats | undefined;
	/** The state of the agent, as the TUI sees it. */
	readonly state: SessionStateView;

	// --- Reads that need a round trip ---

	/**
	 * Read the state of the session from the server again.
	 *
	 * The refresh covers the state snapshot and the transcript, so a caller that missed
	 * an event can catch up with one round trip.
	 */
	refresh(): Promise<SessionStateSnapshot>;
	/**
	 * The sessions the server knows about.
	 *
	 * The list covers every project of the server unless a directory is given.
	 */
	listSessions(cwd?: string): Promise<RemoteSessionInfo[]>;
	/** The queued steering messages. */
	getSteeringMessages(): readonly string[];
	/** The queued follow-up messages. */
	getFollowUpMessages(): readonly string[];
	/** The statistics of the session. */
	getSessionStats(): Promise<SessionStats | undefined>;
	/** The context usage of the session. */
	getContextUsage(): Promise<ContextUsage | undefined>;
	/** The text of the last assistant message. */
	getLastAssistantText(): Promise<string | undefined>;
	/** The user messages the session can be forked from. */
	getUserMessagesForForking(): Promise<Array<{ entryId: string; text: string }>>;
	/** The thinking levels the active model supports. */
	getAvailableThinkingLevels(): Promise<ThinkingLevel[]>;
	/** The definition of a tool. */
	getToolDefinition(name: string): Promise<ToolDefinition | undefined>;
	/**
	 * Render a piece of the transcript on the server.
	 *
	 * The renderers of the extensions that live in the server's process run there, so the
	 * server is the only place that can draw what they draw. An empty answer means that
	 * nothing could render the piece.
	 */
	render(request: RenderRequest): Promise<RenderResponse>;
	/**
	 * Ask the session model to describe what went wrong, for a bug report.
	 *
	 * The model runs in the server's process, so the summary is produced there.
	 */
	summarizeForBugReport(hint?: string): Promise<string>;

	// --- Commands ---

	/** Send a prompt to the session. */
	prompt(message: string, options?: PromptOptions): Promise<PromptDisposition>;
	/** Queue a steering message. */
	steer(message: string, images?: ImageContent[], options?: { source?: InputSource }): Promise<QueuedInputDisposition>;
	/** Queue a follow-up message. */
	followUp(
		message: string,
		images?: ImageContent[],
		options?: { source?: InputSource },
	): Promise<QueuedInputDisposition>;
	/** Stop the current turn. */
	abort(): Promise<void>;
	/** Stop the retry of a failed turn. */
	abortRetry(): Promise<void>;
	/** Stop the running compaction. */
	abortCompaction(): Promise<void>;
	/** Stop the running branch summary. */
	abortBranchSummary(): Promise<void>;
	/** Stop the running bash command. */
	abortBash(): Promise<void>;
	/** Drop the queued messages. */
	clearQueue(): Promise<{ steering: string[]; followUp: string[] }>;
	/** Compact the session. */
	compact(customInstructions?: string): Promise<CompactionResult | undefined>;
	/** Switch to the next or previous model. */
	cycleModel(direction?: "forward" | "backward"): Promise<ModelCycleResult | undefined>;
	/** Switch to the next or previous thinking level. */
	cycleThinkingLevel(): Promise<ThinkingLevel | undefined>;
	/** Change the active model. */
	setModel(model: Model<any>, options?: SessionModelMutationOptions): Promise<void>;
	/** Change the active thinking level. */
	setThinkingLevel(level: ThinkingLevel, options?: SessionModelMutationOptions): Promise<void>;
	/** Change the models the session cycles through. */
	setScopedModels(scoped: ReadonlyArray<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>): Promise<void>;
	/** Change how steering messages are queued. */
	setSteeringMode(mode: "all" | "one-at-a-time"): Promise<void>;
	/** Change how follow-up messages are queued. */
	setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<void>;
	/** Turn the automatic compaction on or off. */
	setAutoCompactionEnabled(enabled: boolean): Promise<void>;
	/** Change the cache warming mode. */
	setCacheWarmingMode(mode: CacheWarmingMode): Promise<void>;
	/** Rename the session. */
	setSessionName(name: string): Promise<void>;
	/** Move the session to another entry of its tree. */
	navigateTree(targetId: string, options?: SessionNavigateTreeOptions): Promise<SessionNavigateTreeResult>;
	/** Reload the session and its resources. */
	reload(): Promise<void>;
	/** Run a bash command in the session's working directory. */
	executeBash(
		command: string,
		onChunk?: (chunk: string) => void,
		options?: SessionExecuteBashOptions,
	): Promise<BashResult | undefined>;
	/** Record the result of a bash command the client ran itself. */
	recordBashResult(command: string, result: BashResult, options?: { excludeFromContext?: boolean }): Promise<void>;
	/** Export the session as JSONL. */
	exportToJsonl(outputPath?: string): Promise<string>;
	/** Export the session as HTML. */
	exportToHtml(outputPath?: string): Promise<string>;
	/** Wait until the session has nothing to do. */
	waitForIdle(): Promise<void>;
	/** Subscribe to the events of the session. */
	subscribe(listener: (event: AgentSessionEvent) => void): () => void;
	/** Subscribe to the extension UI requests of the session. */
	subscribeExtensionUi(listener: (request: RpcExtensionUIRequest) => void): () => void;
	/** Answer a pending extension UI request. */
	respondExtensionUi(response: RpcExtensionUIResponse): Promise<void>;

	// --- Client-local and server resources ---

	/**
	 * The model surface of the client.
	 *
	 * The models come from the server, so the client never builds a catalog of its own.
	 * The provider and credential surface is the client's own, and it never changes the
	 * model the server runs with.
	 *
	 * The type is the one of the coding agent: the bug report reads the providers from
	 * it, and the coding agent describes them with its own model runtime.
	 */
	readonly modelRuntime: ModelRuntime;
	/** The extension commands of the session. */
	readonly extensionRunner: SessionExtensionRunner;
	/**
	 * The tools the session declares to the model.
	 *
	 * The server owns the tools, so the client learns their names from the resource
	 * snapshot instead of asking for them one at a time.
	 */
	readonly tools: ReadonlyArray<SessionTool>;
	/** The extensions the server loaded, with the side each one declares. */
	readonly sessionExtensions: ReadonlyArray<SessionExtensionInfo>;
	/** The extensions that failed to load on the server. */
	readonly extensionErrors: ReadonlyArray<{ readonly path: string; readonly error: string }>;
	/** The resources of the session. */
	readonly resourceLoader: SessionResourceLoader;
	/** The prompt templates of the session. */
	readonly promptTemplates: ReadonlyArray<SessionPromptTemplate>;
	/** The session store, read-only. */
	readonly sessionManager: SessionManagerView;
	/** The settings of the client. */
	readonly settingsManager: SettingsManager;
	/** The agent of the session, as the TUI sees it. */
	readonly agent: SessionAgentView;
}
