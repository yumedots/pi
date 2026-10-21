/**
 * The remote session facade.
 *
 * The facade implements the TUI's session contract on top of the pi server: the state
 * comes from the server's snapshot, the commands travel over HTTP, and the resources come
 * from the server's resource snapshot. The model catalog and the settings stay in the
 * client, because they are the client's own business.
 */

import { constants, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model, Transport } from "@earendil-works/pi-ai";
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
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
	SessionEntry,
	SessionStats,
	SessionTreeNode,
	SourceInfo,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	buildContextEntries,
	getAgentDir,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { BashResult } from "@earendil-works/pi-coding-agent/core/bash-executor";
import type { SessionStateSnapshot } from "@earendil-works/pi-server";
import type { PiServerClient } from "@earendil-works/pi-server/client";
import { RemoteSessionConnection } from "./remote-session.ts";
import { STATE_REFRESHING_EVENTS } from "./session-connection.ts";
import type {
	PromptDisposition,
	QueuedInputDisposition,
	SessionAgentView,
	SessionCommand,
	SessionExecuteBashOptions,
	SessionExtensionBindings,
	SessionExtensionInfo,
	SessionExtensionRunner,
	SessionFacade,
	SessionForkResult,
	SessionManagerView,
	SessionModelMutationOptions,
	SessionNavigateTreeOptions,
	SessionNavigateTreeResult,
	SessionNewOptions,
	SessionPromptTemplate,
	SessionReplacementResult,
	SessionResourceLoader,
	SessionSkill,
	SessionStateView,
	SessionTool,
} from "./session-facade.ts";

/** How long {@link RemoteSessionFacade.waitForIdle} waits before it gives up. */
const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

/** The successful responses of the server. */
type RpcSuccessResponse = Extract<RpcResponse, { success: true }>;

/** The options of {@link RemoteSessionFacade}. */
export interface RemoteSessionFacadeOptions {
	/** The agent directory, used for the client-local model runtime and the settings. */
	agentDir?: string;
	/** How long {@link RemoteSessionFacade.waitForIdle} waits before it gives up. */
	idleTimeoutMs?: number;
	/** The model runtime of the client. One is built from the agent directory when omitted. */
	modelRuntime?: ModelRuntime;
}

/** The resources of a session, as the facade reads them. */
interface FacadeResources {
	promptTemplates: SessionPromptTemplate[];
	skills: SessionSkill[];
	commands: SessionCommand[];
	tools: SessionTool[];
	extensions: SessionExtensionInfo[];
	extensionErrors: Array<{ path: string; error: string }>;
}

/** The raw payload of the server's resource snapshot. */
interface RawResources {
	promptTemplates?: Array<{ name?: string; description?: string; argumentHint?: string; sourceInfo?: unknown }>;
	skills?: Array<{ name?: string; description?: string; sourceInfo?: unknown }>;
	commands?: Array<{ name?: string; description?: string; source?: string; sourceInfo?: unknown }>;
	tools?: Array<{ name?: string; description?: string; parameters?: unknown }>;
	extensions?: Array<{ path?: string; side?: string; sourceInfo?: unknown }>;
	extensionErrors?: Array<{ path?: string; error?: string }>;
}

/**
 * The agent of the session, as the TUI sees it.
 *
 * The agent itself lives in the server's process, so only its state is visible.
 */
class RemoteAgentView implements SessionAgentView {
	private readonly read: () => SessionStateView;
	private readonly readSignal: () => AbortSignal;
	private readonly readTransport: () => Transport;
	private readonly writeTransport: (transport: Transport) => void;

	constructor(
		read: () => SessionStateView,
		readSignal: () => AbortSignal,
		readTransport: () => Transport,
		writeTransport: (transport: Transport) => void,
	) {
		this.read = read;
		this.readSignal = readSignal;
		this.readTransport = readTransport;
		this.writeTransport = writeTransport;
	}

	get state(): SessionStateView {
		return this.read();
	}

	get signal(): AbortSignal {
		return this.readSignal();
	}

	get transport(): Transport {
		return this.readTransport();
	}

	set transport(transport: Transport) {
		this.writeTransport(transport);
	}
}

/**
 * A session that lives on the server.
 *
 * The facade owns the connection to the session: it keeps the state snapshot fresh, sends
 * the commands and hands the resources to the TUI.
 */
export class RemoteSessionFacade implements SessionFacade {
	private readonly client: PiServerClient;
	private readonly agentDirectory: string;
	private readonly idleTimeoutMs: number;
	private readonly modelRuntimeOption: ModelRuntime | undefined;
	private readonly connection: RemoteSessionConnection;
	private readonly listeners = new Set<(event: AgentSessionEvent) => void>();
	private readonly extensionUiListeners = new Set<(request: RpcExtensionUIRequest) => void>();
	private readonly extensionRunnerView: SessionExtensionRunner;
	private readonly resourceLoaderView: SessionResourceLoader;
	private readonly sessionManagerView: SessionManagerView;
	private readonly agentView: SessionAgentView;
	private modelRuntimeInstance: ModelRuntime | undefined;
	private settings: SettingsManager | undefined;
	private snapshot: SessionStateSnapshot | undefined;
	private resources: FacadeResources | undefined;
	private resolvedModel: Model<any> | undefined;
	private resolvedScopedModels: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }> = [];
	private transcript: AgentMessage[] = [];
	private entries: SessionEntry[] = [];
	private tree: SessionTreeNode[] = [];
	private leafId: string | null = null;
	private refreshPromise: Promise<void> | undefined;
	private beforeSessionInvalidate: (() => void | Promise<void>) | undefined;
	private rebindSession: (() => void | Promise<void>) | undefined;
	private uiContext: ExtensionUIContext | undefined;
	private abortHandler: (() => void) | undefined;
	private turnAbort = new AbortController();
	private usesDefaultSessionDir = true;
	private disposed = false;

	constructor(client: PiServerClient, sessionId: string, cwd: string, options: RemoteSessionFacadeOptions = {}) {
		this.client = client;
		this.agentDirectory = options.agentDir ?? getAgentDir();
		this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
		this.modelRuntimeOption = options.modelRuntime;
		this.connection = new RemoteSessionConnection(client, sessionId, cwd, { autoRefresh: false });
		this.connection.subscribe((event) => this.handleEvent(event));
		this.extensionRunnerView = {
			getRegisteredCommands: () => this.resources?.commands ?? [],
		};
		this.resourceLoaderView = {
			getSkills: () => ({ skills: this.resources?.skills ?? [], diagnostics: [] }),
		};
		this.sessionManagerView = {
			getCwd: () => this.snapshot?.cwd ?? "",
			getSessionDir: () => {
				const file = this.snapshot?.sessionFile;
				return file ? dirname(file) : "";
			},
			getSessionFile: () => this.snapshot?.sessionFile,
			getSessionId: () => this.snapshot?.sessionId ?? this.connection.sessionId,
			usesDefaultSessionDir: () => this.usesDefaultSessionDir,
			isContinuation: () => this.isContinuation(),
			getEntries: () => this.entries,
			getTree: () => this.tree,
			getLeafId: () => this.leafId,
			getSessionName: () => this.snapshot?.title,
			getBranch: (fromId?: string) => branchOf(this.entries, fromId ?? this.leafId),
			buildContextEntries: () => buildContextEntries(this.entries, this.leafId),
			appendLabelChange: (entryId: string, label: string | undefined) => this.appendLabelChange(entryId, label),
			appendCustomEntry: (customType: string, data?: unknown) => this.appendCustomEntry(customType, data),
		};
		this.agentView = new RemoteAgentView(
			() => this.stateView,
			() => this.turnAbort.signal,
			() => this.settings?.getTransport() ?? "auto",
			(transport) => {
				this.settings?.setTransport(transport);
			},
		);
	}

	/**
	 * Build the client-local model runtime and load the session.
	 */
	async load(): Promise<void> {
		this.modelRuntimeInstance =
			this.modelRuntimeOption ??
			(await ModelRuntime.create({
				authPath: join(this.agentDirectory, "auth.json"),
				modelsPath: join(this.agentDirectory, "models.json"),
			}));
		await this.loadSession();
	}

	/**
	 * Point the facade at another session of the server.
	 *
	 * The connection follows, the snapshot and the resources are loaded again.
	 */
	async switchTo(sessionId: string): Promise<void> {
		this.connection.repoint(sessionId, this.snapshot?.cwd ?? "");
		this.snapshot = undefined;
		this.resources = undefined;
		this.resolvedModel = undefined;
		this.resolvedScopedModels = [];
		this.transcript = [];
		this.entries = [];
		this.tree = [];
		this.leafId = null;
		await this.loadSession();
	}

	/**
	 * Stop the facade and its connection.
	 */
	dispose(): void {
		this.disposed = true;
		this.listeners.clear();
		this.connection.dispose();
	}

	/**
	 * The agent directory of the client.
	 */
	get agentDir(): string {
		return this.agentDirectory;
	}

	/**
	 * Replace the session with a new one.
	 */
	async newSession(options?: SessionNewOptions): Promise<SessionReplacementResult> {
		return this.replaceSession(async () => {
			const response = await this.send({ type: "new_session", parentSession: options?.parentSession });
			return response.command === "new_session" ? response.data : { cancelled: true };
		});
	}

	/**
	 * Continue another session file.
	 */
	async switchSession(sessionPath: string): Promise<SessionReplacementResult> {
		return this.replaceSession(async () => {
			const response = await this.send({ type: "switch_session", sessionPath });
			return response.command === "switch_session" ? response.data : { cancelled: true };
		});
	}

	/**
	 * Fork the session at an entry.
	 */
	async fork(entryId: string): Promise<SessionForkResult> {
		return this.replaceSession(async () => {
			const response = await this.send({ type: "fork", entryId });
			if (response.command !== "fork") return { cancelled: true };
			return { text: response.data.text, cancelled: response.data.cancelled };
		});
	}

	/**
	 * Copy the session at its leaf.
	 */
	async clone(): Promise<SessionReplacementResult> {
		return this.replaceSession(async () => {
			const response = await this.send({ type: "clone" });
			return response.command === "clone" ? response.data : { cancelled: true };
		});
	}

	/**
	 * Import a session from a JSONL file.
	 *
	 * The file is copied into the session directory of the server, which means the client
	 * and the server must share a filesystem.
	 */
	async importFromJsonl(inputPath: string, _cwdOverride?: string): Promise<SessionReplacementResult> {
		const source = resolveInputPath(inputPath);
		if (!existsSync(source)) {
			throw new Error(`The session file does not exist: ${source}`);
		}
		const sessionDir = this.sessionManager.getSessionDir();
		if (!sessionDir) {
			throw new Error("The session has no session directory, so it cannot import a session file");
		}
		if (!existsSync(sessionDir)) {
			mkdirSync(sessionDir, { recursive: true });
		}
		let destination = join(sessionDir, basename(source));
		if (resolve(destination) !== source) {
			const { name, ext } = parse(destination);
			let suffix = 1;
			while (existsSync(destination)) {
				destination = join(sessionDir, `${name}-${suffix++}${ext}`);
			}
			copyFileSync(source, destination, constants.COPYFILE_EXCL);
		}
		return this.switchSession(destination);
	}

	/**
	 * Label an entry of the session.
	 */
	async appendLabelChange(entryId: string, label: string | undefined): Promise<void> {
		await this.send({ type: "label_entry", entryId, label });
	}

	/**
	 * Append a custom entry to the session.
	 */
	async appendCustomEntry(customType: string, data?: unknown): Promise<void> {
		await this.send({ type: "append_custom_entry", customType, data });
	}

	/**
	 * Run a hook before the session is replaced.
	 */
	setBeforeSessionInvalidate(handler: () => void | Promise<void>): void {
		this.beforeSessionInvalidate = handler;
	}

	/**
	 * Run a hook after the session was replaced.
	 */
	setRebindSession(handler: () => void | Promise<void>): void {
		this.rebindSession = handler;
	}

	/**
	 * Bind the extension UI of the client to the session.
	 *
	 * The server sends the dialogs of its extensions over the event stream; the client
	 * answers them with the UI of the interactive mode.
	 */
	async bindExtensions(bindings: SessionExtensionBindings): Promise<void> {
		this.uiContext = bindings.uiContext;
		this.abortHandler = bindings.abortHandler;
	}

	// --- State ---

	get sessionId(): string {
		return this.connection.sessionId;
	}

	get model(): Model<any> | undefined {
		return this.resolvedModel;
	}

	get thinkingLevel(): ThinkingLevel {
		return this.snapshot?.thinkingLevel ?? "off";
	}

	get scopedModels(): ReadonlyArray<{ model: Model<any>; thinkingLevel?: ThinkingLevel }> {
		return this.resolvedScopedModels;
	}

	get isStreaming(): boolean {
		return this.snapshot?.isStreaming ?? false;
	}

	get isCompacting(): boolean {
		return this.snapshot?.isCompacting ?? false;
	}

	get isIdle(): boolean {
		return this.snapshot?.isIdle ?? true;
	}

	get isBashRunning(): boolean {
		return this.snapshot?.isBashRunning ?? false;
	}

	get retryAttempt(): number {
		return this.snapshot?.retryAttempt ?? 0;
	}

	get pendingMessageCount(): number {
		return this.snapshot?.pendingMessageCount ?? 0;
	}

	get messages(): AgentMessage[] {
		return this.transcript;
	}

	get sessionFile(): string | undefined {
		return this.snapshot?.sessionFile;
	}

	get steeringMode(): "all" | "one-at-a-time" {
		return this.snapshot?.steeringMode ?? "all";
	}

	get followUpMode(): "all" | "one-at-a-time" {
		return this.snapshot?.followUpMode ?? "all";
	}

	get autoCompactionEnabled(): boolean {
		return this.snapshot?.autoCompactionEnabled ?? false;
	}

	/**
	 * The server knows the warming mode but not the state of its warming run, so the
	 * remote facade has nothing to report here.
	 */
	get cacheWarmingStatus(): CacheWarmingStatus | undefined {
		return undefined;
	}

	get systemPrompt(): string {
		return this.snapshot?.systemPrompt ?? "";
	}

	get contextUsage(): ContextUsage | undefined {
		return this.snapshot?.contextUsage;
	}

	get sessionStats(): SessionStats | undefined {
		return this.snapshot?.sessionStats;
	}

	get state(): SessionStateView {
		return this.stateView;
	}

	// --- Reads ---

	getSteeringMessages(): readonly string[] {
		return this.snapshot?.queue.steering ?? [];
	}

	getFollowUpMessages(): readonly string[] {
		return this.snapshot?.queue.followUp ?? [];
	}

	async getSessionStats(): Promise<SessionStats | undefined> {
		const response = await this.send({ type: "get_session_stats" });
		return response.command === "get_session_stats" ? response.data : undefined;
	}

	async getContextUsage(): Promise<ContextUsage | undefined> {
		const response = await this.send({ type: "get_context_usage" });
		return response.command === "get_context_usage" ? (response.data ?? undefined) : undefined;
	}

	async getLastAssistantText(): Promise<string | undefined> {
		const response = await this.send({ type: "get_last_assistant_text" });
		return response.command === "get_last_assistant_text" ? (response.data.text ?? undefined) : undefined;
	}

	async getUserMessagesForForking(): Promise<Array<{ entryId: string; text: string }>> {
		const response = await this.send({ type: "get_fork_messages" });
		return response.command === "get_fork_messages" ? response.data.messages : [];
	}

	async getAvailableThinkingLevels(): Promise<ThinkingLevel[]> {
		const response = await this.send({ type: "get_available_thinking_levels" });
		return response.command === "get_available_thinking_levels" ? response.data.levels : [];
	}

	async getToolDefinition(name: string): Promise<ToolDefinition | undefined> {
		const response = await this.send({ type: "get_tool_definition", name });
		return response.command === "get_tool_definition" ? (response.data ?? undefined) : undefined;
	}

	async summarizeForBugReport(hint?: string): Promise<string> {
		const response = await this.send({ type: "summarize_for_bug_report", hint });
		return response.command === "summarize_for_bug_report" ? response.data.summary : "";
	}

	// --- Commands ---

	async prompt(message: string, options?: PromptOptions): Promise<PromptDisposition> {
		const rpc: RpcCommand = {
			type: "prompt",
			message,
			images: options?.images,
			streamingBehavior: options?.streamingBehavior,
		};
		const response = await this.send(rpc);
		const disposition: PromptDisposition = response.command === "prompt" ? response.data.disposition : "handled";
		options?.preflightResult?.(disposition);
		return disposition;
	}

	async steer(
		message: string,
		images?: ImageContent[],
		_options?: { source?: InputSource },
	): Promise<QueuedInputDisposition> {
		const rpc: RpcCommand = {
			type: "steer",
			message,
			images,
		};
		const response = await this.send(rpc);
		return response.command === "steer" ? response.data.disposition : "handled";
	}

	async followUp(
		message: string,
		images?: ImageContent[],
		_options?: { source?: InputSource },
	): Promise<QueuedInputDisposition> {
		const rpc: RpcCommand = {
			type: "follow_up",
			message,
			images,
		};
		const response = await this.send(rpc);
		return response.command === "follow_up" ? response.data.disposition : "handled";
	}

	async abort(): Promise<void> {
		await this.send({ type: "abort" });
		this.turnAbort.abort();
		this.abortHandler?.();
	}

	async abortRetry(): Promise<void> {
		await this.send({ type: "abort_retry" });
	}

	async abortCompaction(): Promise<void> {
		await this.send({ type: "abort_compaction" });
	}

	async abortBranchSummary(): Promise<void> {
		await this.send({ type: "abort_branch_summary" });
	}

	async abortBash(): Promise<void> {
		await this.send({ type: "abort_bash" });
	}

	async clearQueue(): Promise<{ steering: string[]; followUp: string[] }> {
		const response = await this.send({ type: "clear_queue" });
		return response.command === "clear_queue" ? response.data : { steering: [], followUp: [] };
	}

	async compact(customInstructions?: string): Promise<CompactionResult | undefined> {
		const rpc: RpcCommand = { type: "compact", customInstructions };
		const response = await this.send(rpc);
		return response.command === "compact" ? response.data : undefined;
	}

	async cycleModel(_direction?: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		const response = await this.send({ type: "cycle_model" });
		return response.command === "cycle_model" ? (response.data ?? undefined) : undefined;
	}

	async cycleThinkingLevel(): Promise<ThinkingLevel | undefined> {
		const response = await this.send({ type: "cycle_thinking_level" });
		return response.command === "cycle_thinking_level" ? (response.data?.level ?? undefined) : undefined;
	}

	async setModel(model: Model<any>, options?: SessionModelMutationOptions): Promise<void> {
		await this.send({ type: "set_model", provider: model.provider, modelId: model.id });
		if (options?.persist) {
			this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
		}
	}

	async setThinkingLevel(level: ThinkingLevel, options?: SessionModelMutationOptions): Promise<void> {
		await this.send({ type: "set_thinking_level", level });
		if (options?.persist) {
			this.settingsManager.setDefaultThinkingLevel(level);
		}
	}

	async setScopedModels(scoped: ReadonlyArray<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>): Promise<void> {
		const scopedModels = scoped.map((entry) => ({
			provider: entry.model.provider,
			modelId: entry.model.id,
			thinkingLevel: entry.thinkingLevel,
		}));
		await this.send({ type: "set_scoped_models", scopedModels });
	}

	async setSteeringMode(mode: "all" | "one-at-a-time"): Promise<void> {
		await this.send({ type: "set_steering_mode", mode });
	}

	async setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<void> {
		await this.send({ type: "set_follow_up_mode", mode });
	}

	async setAutoCompactionEnabled(enabled: boolean): Promise<void> {
		await this.send({ type: "set_auto_compaction", enabled });
	}

	async setCacheWarmingMode(mode: CacheWarmingMode): Promise<void> {
		await this.send({ type: "set_cache_warming_mode", mode });
	}

	async setSessionName(name: string): Promise<void> {
		await this.send({ type: "set_session_name", name });
	}

	async navigateTree(targetId: string, options?: SessionNavigateTreeOptions): Promise<SessionNavigateTreeResult> {
		const rpc: RpcCommand = {
			type: "navigate_tree",
			targetId,
			summarize: options?.summarize,
			customInstructions: options?.customInstructions,
			replaceInstructions: options?.replaceInstructions,
			label: options?.label,
		};
		const response = await this.send(rpc);
		return response.command === "navigate_tree" ? response.data : { cancelled: true };
	}

	async reload(): Promise<void> {
		await this.send({ type: "reload" });
		this.snapshot = await this.connection.refresh();
		this.applySnapshot();
		await this.refreshSessionData();
	}

	async executeBash(
		command: string,
		_onChunk?: (chunk: string) => void,
		options?: SessionExecuteBashOptions,
	): Promise<BashResult | undefined> {
		const rpc: RpcCommand = {
			type: "execute_bash",
			command,
			excludeFromContext: options?.excludeFromContext,
		};
		const response = await this.send(rpc);
		return response.command === "execute_bash" ? response.data : undefined;
	}

	async recordBashResult(
		command: string,
		result: BashResult,
		options?: { excludeFromContext?: boolean },
	): Promise<void> {
		const rpc: RpcCommand = {
			type: "record_bash_result",
			command,
			result,
			excludeFromContext: options?.excludeFromContext,
		};
		await this.send(rpc);
	}

	async exportToJsonl(outputPath?: string): Promise<string> {
		const rpc: RpcCommand = { type: "export_jsonl", outputPath };
		const response = await this.send(rpc);
		return response.command === "export_jsonl" ? response.data.path : "";
	}

	async exportToHtml(outputPath?: string): Promise<string> {
		const rpc: RpcCommand = { type: "export_html", outputPath };
		const response = await this.send(rpc);
		return response.command === "export_html" ? response.data.path : "";
	}

	async waitForIdle(): Promise<void> {
		if (this.isIdle) return;
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		let unsubscribe: () => void = () => {};
		const timer = setTimeout(() => {
			unsubscribe();
			reject(new Error(`The session was still busy after ${this.idleTimeoutMs} ms`));
		}, this.idleTimeoutMs);
		timer.unref?.();
		unsubscribe = this.subscribe((event) => {
			if (event.type !== "agent_settled") return;
			unsubscribe();
			clearTimeout(timer);
			resolve();
		});
		await promise;
	}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	subscribeExtensionUi(listener: (request: RpcExtensionUIRequest) => void): () => void {
		this.extensionUiListeners.add(listener);
		return () => {
			this.extensionUiListeners.delete(listener);
		};
	}

	async respondExtensionUi(response: RpcExtensionUIResponse): Promise<void> {
		await this.connection.respondExtensionUi(response);
	}

	// --- Client-local and server resources ---

	get modelRuntime(): ModelRuntime {
		if (!this.modelRuntimeInstance) {
			throw new Error("The model runtime of the client was not built yet");
		}
		return this.modelRuntimeInstance;
	}

	get extensionRunner(): SessionExtensionRunner {
		return this.extensionRunnerView;
	}

	get tools(): ReadonlyArray<SessionTool> {
		return this.resources?.tools ?? [];
	}

	get sessionExtensions(): ReadonlyArray<SessionExtensionInfo> {
		return this.resources?.extensions ?? [];
	}

	get extensionErrors(): ReadonlyArray<{ readonly path: string; readonly error: string }> {
		return this.resources?.extensionErrors ?? [];
	}

	get resourceLoader(): SessionResourceLoader {
		return this.resourceLoaderView;
	}

	get promptTemplates(): ReadonlyArray<SessionPromptTemplate> {
		return this.resources?.promptTemplates ?? [];
	}

	get sessionManager(): SessionManagerView {
		return this.sessionManagerView;
	}

	get settingsManager(): SettingsManager {
		if (!this.settings) {
			throw new Error("The settings of the client were not loaded yet");
		}
		return this.settings;
	}

	get agent(): SessionAgentView {
		return this.agentView;
	}

	// --- Internals ---

	private get stateView(): SessionStateView {
		return {
			systemPrompt: this.systemPrompt,
			model: this.resolvedModel,
			thinkingLevel: this.thinkingLevel,
			isStreaming: this.isStreaming,
			messages: this.transcript,
		};
	}

	private async loadSession(): Promise<void> {
		const snapshot = await this.connection.load();
		this.snapshot = snapshot;
		this.applySnapshot();
		this.settings = SettingsManager.create(snapshot.cwd, this.agentDirectory);
		this.usesDefaultSessionDir = this.computeUsesDefaultSessionDir();
		await this.refreshSessionData();
	}

	private async refreshSessionData(): Promise<void> {
		await Promise.all([this.refreshResources(), this.refreshMessages(), this.refreshEntries()]);
	}

	private async replaceSession(operation: () => Promise<SessionReplacementResult>): Promise<SessionReplacementResult> {
		await this.beforeSessionInvalidate?.();
		const result = await operation();
		if (result.cancelled) return result;
		this.snapshot = await this.connection.refresh();
		this.applySnapshot();
		this.settings = SettingsManager.create(this.snapshot.cwd, this.agentDirectory);
		this.usesDefaultSessionDir = this.computeUsesDefaultSessionDir();
		await this.refreshSessionData();
		await this.rebindSession?.();
		return result;
	}

	private applySnapshot(): void {
		this.resolvedModel = this.resolveModel(this.snapshot?.model);
		this.resolvedScopedModels = [];
		for (const scoped of this.snapshot?.scopedModels ?? []) {
			const model = this.resolveModel(`${scoped.provider}/${scoped.modelId}`);
			if (!model) continue;
			this.resolvedScopedModels.push({
				model,
				...(scoped.thinkingLevel !== undefined ? { thinkingLevel: scoped.thinkingLevel } : {}),
			});
		}
	}

	private computeUsesDefaultSessionDir(): boolean {
		const cwd = this.snapshot?.cwd;
		if (!cwd) return true;
		const dir = this.sessionManagerView.getSessionDir();
		if (!dir) return true;
		return SessionManager.create(cwd, dir).usesDefaultSessionDir();
	}

	private isContinuation(): boolean {
		const file = this.snapshot?.sessionFile;
		if (!file) return false;
		try {
			return SessionManager.open(file).isContinuation();
		} catch {
			return false;
		}
	}

	private resolveModel(value: string | undefined): Model<any> | undefined {
		if (!value) return undefined;
		const runtime = this.modelRuntimeInstance;
		if (!runtime) return undefined;
		const separator = value.indexOf("/");
		if (separator > 0) {
			const model = runtime.getModel(value.slice(0, separator), value.slice(separator + 1));
			if (model) return model;
		}
		for (const provider of runtime.getProviders()) {
			const prefix = `${provider.id}/`;
			if (!value.startsWith(prefix)) continue;
			const model = runtime.getModel(provider.id, value.slice(prefix.length));
			if (model) return model;
		}
		return undefined;
	}

	private async refreshResources(): Promise<void> {
		const raw = (await this.client.getSessionResources(this.connection.sessionId)) as RawResources | undefined;
		this.resources = {
			promptTemplates: (raw?.promptTemplates ?? [])
				.filter((template) => typeof template.name === "string")
				.map((template) => ({
					name: template.name as string,
					description: template.description ?? "",
					...(template.argumentHint !== undefined ? { argumentHint: template.argumentHint } : {}),
					...(template.sourceInfo !== undefined ? { sourceInfo: template.sourceInfo as SourceInfo } : {}),
				})),
			skills: (raw?.skills ?? [])
				.filter((skill) => typeof skill.name === "string")
				.map((skill) => ({
					name: skill.name as string,
					description: skill.description ?? "",
					...(skill.sourceInfo !== undefined ? { sourceInfo: skill.sourceInfo as SourceInfo } : {}),
				})),
			commands: (raw?.commands ?? [])
				.filter(
					(command) =>
						typeof command.name === "string" && command.source !== "prompt" && command.source !== "skill",
				)
				.map((command) => ({
					name: command.name as string,
					invocationName: command.name as string,
					...(command.description !== undefined ? { description: command.description } : {}),
				})),
			tools: (raw?.tools ?? [])
				.filter((tool) => typeof tool.name === "string")
				.map((tool) => ({
					name: tool.name as string,
					...(tool.description !== undefined ? { description: tool.description } : {}),
					...(tool.parameters !== undefined ? { parameters: tool.parameters } : {}),
				})),
			extensions: (raw?.extensions ?? [])
				.filter((extension) => typeof extension.path === "string")
				.map((extension) => ({
					path: extension.path as string,
					side: extension.side === "client" || extension.side === "both" ? extension.side : "server",
					...(extension.sourceInfo !== undefined ? { sourceInfo: extension.sourceInfo as SourceInfo } : {}),
				})),
			extensionErrors: (raw?.extensionErrors ?? [])
				.filter((error) => typeof error.path === "string" && typeof error.error === "string")
				.map((error) => ({ path: error.path as string, error: error.error as string })),
		};
	}

	private async refreshMessages(): Promise<void> {
		const response = await this.send({ type: "get_messages" });
		if (response.command === "get_messages") {
			this.transcript = response.data.messages;
		}
	}

	private async refreshEntries(): Promise<void> {
		const entriesResponse = await this.send({ type: "get_entries" });
		if (entriesResponse.command === "get_entries") {
			this.entries = entriesResponse.data.entries;
			this.leafId = entriesResponse.data.leafId;
		}
		const treeResponse = await this.send({ type: "get_tree" });
		if (treeResponse.command === "get_tree") {
			this.tree = treeResponse.data.tree;
		}
	}

	private handleEvent(event: AgentSessionEvent): void {
		if (isExtensionUiRequest(event)) {
			void this.notifyExtensionUi(event);
			return;
		}
		if (event.type === "agent_start") {
			this.turnAbort = new AbortController();
		}
		if (event.type === "agent_settled" && event.aborted) {
			this.turnAbort.abort();
			this.abortHandler?.();
		}
		const refreshesState = event.type in STATE_REFRESHING_EVENTS;
		const refreshesMessages = event.type === "agent_settled" || event.type === "agent_end";
		if (!refreshesState && !refreshesMessages) {
			this.notify(event);
			return;
		}
		void this.refreshState(refreshesMessages).then(() => this.notify(event));
	}

	private async notifyExtensionUi(request: RpcExtensionUIRequest): Promise<void> {
		for (const listener of this.extensionUiListeners) {
			listener(request);
		}
		const ui = this.uiContext;
		if (!ui) {
			await this.answerExtensionUi(request.id, undefined);
			return;
		}
		switch (request.method) {
			case "select":
				await this.answerExtensionUi(request.id, await ui.select(request.title, request.options));
				return;
			case "confirm":
				await this.respondExtensionUi({
					type: "extension_ui_response",
					id: request.id,
					confirmed: await ui.confirm(request.title, request.message),
				});
				return;
			case "input":
				await this.answerExtensionUi(request.id, await ui.input(request.title, request.placeholder));
				return;
			case "editor":
				await this.answerExtensionUi(request.id, await ui.editor(request.title, request.prefill));
				return;
			case "notify":
				ui.notify(request.message, request.notifyType);
				return;
			case "setStatus":
				ui.setStatus(request.statusKey, request.statusText);
				return;
			case "setWidget":
				ui.setWidget(request.widgetKey, request.widgetLines);
				return;
			case "setTitle":
				ui.setTitle(request.title);
				return;
			case "set_editor_text":
				ui.setEditorText(request.text);
				return;
		}
	}

	private async answerExtensionUi(id: string, value: string | undefined): Promise<void> {
		await this.respondExtensionUi(
			value === undefined
				? { type: "extension_ui_response", id, cancelled: true }
				: { type: "extension_ui_response", id, value },
		);
	}

	private notify(event: AgentSessionEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	private refreshState(withMessages: boolean): Promise<void> {
		if (this.refreshPromise) return this.refreshPromise;
		this.refreshPromise = (async () => {
			if (this.disposed) return;
			try {
				this.snapshot = await this.connection.refresh();
				this.applySnapshot();
			} catch {
				return;
			}
			if (withMessages) {
				try {
					await this.refreshMessages();
				} catch {
					return;
				}
			}
		})().finally(() => {
			this.refreshPromise = undefined;
		});
		return this.refreshPromise;
	}

	private async send(rpc: RpcCommand): Promise<RpcSuccessResponse> {
		const response = await this.connection.send(rpc);
		if (!response.success) {
			throw new Error(response.error || `The server rejected the command "${rpc.type}"`);
		}
		return response;
	}
}

/**
 * The absolute path of a file the user picked.
 */
function resolveInputPath(input: string): string {
	if (input === "~") return homedir();
	if (input.startsWith("~/")) return join(homedir(), input.slice(2));
	return resolve(input);
}

/**
 * Whether an event of the server is an extension UI request.
 *
 * The server sends the extension dialogs over the same stream as the session events.
 * The dialogs carry a `method`, the session events do not.
 */
function isExtensionUiRequest(event: AgentSessionEvent): event is AgentSessionEvent & RpcExtensionUIRequest {
	return "method" in event;
}

/**
 * The branch that leads to an entry of the session.
 */
function branchOf(entries: SessionEntry[], leafId: string | null): SessionEntry[] {
	const byId = new Map<string, SessionEntry>();
	for (const entry of entries) {
		byId.set(entry.id, entry);
	}
	const path: SessionEntry[] = [];
	let current = leafId ? byId.get(leafId) : undefined;
	while (current) {
		path.push(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	path.reverse();
	return path;
}
