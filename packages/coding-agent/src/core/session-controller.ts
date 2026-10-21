/**
 * Transport-neutral session controller.
 *
 * Owns the command vocabulary of the pi protocol and the extension UI bridge, so the
 * JSONL RPC mode and the HTTP server drive the same implementation. The controller never
 * touches stdout, never exits the process and never owns a transport: everything that
 * belongs to a transport arrives through `SessionControllerHooks`.
 */

import * as crypto from "node:crypto";
import type {
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
	RpcSessionState,
	RpcSlashCommand,
} from "../modes/rpc/rpc-types.ts";
import type { AgentSession, AgentSessionEvent } from "./agent-session.ts";
import type { AgentSessionRuntime } from "./agent-session-runtime.ts";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	WorkingIndicatorOptions,
} from "./extensions/index.ts";
import { type Theme, theme } from "./theme/theme.ts";

/**
 * Transport hooks for {@link SessionController}.
 */
export interface SessionControllerHooks {
	/** Deliver a session event to the transport. */
	onEvent(event: AgentSessionEvent): void;
	/**
	 * Ask the transport to collect a user answer for an extension UI request.
	 *
	 * The transport resolves with the raw response. Fire-and-forget methods (notify,
	 * setStatus, setTitle, setWidget, setEditorText) are resolved by the transport
	 * immediately, since nobody answers them.
	 */
	requestExtensionUi(request: RpcExtensionUIRequest): Promise<RpcExtensionUIResponse>;
	/** Called after the controller re-bound to a replaced session. */
	onSessionRebind?(): void;
	/** Called when an extension asks the host to shut down. */
	onShutdownRequested?(): void;
	/** Called when an extension handler throws. */
	onExtensionError?(error: { extensionPath: string; event: string; error: string }): void;
}

/**
 * Drives one agent session: it applies commands, forwards events and bridges extension UI.
 */
export class SessionController {
	private readonly runtime: AgentSessionRuntime;
	private readonly hooks: SessionControllerHooks;
	private _session: AgentSession;
	private readonly listeners = new Set<(event: AgentSessionEvent) => void>();
	private unsubscribeSession?: () => void;
	private disposed = false;

	constructor(runtime: AgentSessionRuntime, hooks: SessionControllerHooks) {
		this.runtime = runtime;
		this.hooks = hooks;
		this._session = runtime.session;
		this.runtime.setRebindSession(async () => {
			await this.rebind();
		});
	}

	/** The session the controller currently drives. */
	get session(): AgentSession {
		return this._session;
	}

	/**
	 * Subscribe to session events.
	 *
	 * @returns A function that removes the listener.
	 */
	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Re-bind to the runtime's current session.
	 *
	 * Called when the runtime replaced the session (new session, fork, resume).
	 */
	async rebind(): Promise<void> {
		this._session = this.runtime.session;
		await this._session.bindExtensions({
			uiContext: this.createExtensionUIContext(),
			mode: "rpc",
			commandContextActions: {
				waitForIdle: () => this._session.waitForIdle(),
				newSession: async (options) => this.runtime.newSession(options),
				fork: async (entryId, forkOptions) => {
					const result = await this.runtime.fork(entryId, forkOptions);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, options) => {
					const result = await this._session.navigateTree(targetId, {
						summarize: options?.summarize,
						customInstructions: options?.customInstructions,
						replaceInstructions: options?.replaceInstructions,
						label: options?.label,
					});
					return { cancelled: result.cancelled };
				},
				switchSession: async (sessionPath, options) => {
					return this.runtime.switchSession(sessionPath, options);
				},
				reload: async () => {
					await this._session.reload();
				},
			},
			shutdownHandler: () => {
				this.hooks.onShutdownRequested?.();
			},
			onError: (err) => {
				this.hooks.onExtensionError?.({
					extensionPath: err.extensionPath,
					event: err.event,
					error: err.error,
				});
			},
		});

		this.unsubscribeSession?.();
		this.unsubscribeSession = this._session.subscribe((event) => {
			for (const listener of this.listeners) {
				listener(event);
			}
			this.hooks.onEvent(event);
		});

		this.hooks.onSessionRebind?.();
	}

	/** Detach listeners. The runtime itself is owned by the caller. */
	dispose(): void {
		this.disposed = true;
		this.unsubscribeSession?.();
		this.unsubscribeSession = undefined;
		this.listeners.clear();
	}

	/**
	 * Apply one command.
	 *
	 * Returns the response for the command, or `undefined` when the command produces no
	 * response of its own.
	 */
	async handle(command: RpcCommand): Promise<RpcResponse | undefined> {
		const id = command.id;
		const session = this._session;

		switch (command.type) {
			// =================================================================
			// Prompting
			// =================================================================

			case "prompt": {
				// The response is emitted once the prompt preflight succeeds, so the
				// disposition is the authoritative answer. Queued and immediately handled
				// prompts also count as success.
				const { promise, resolve } = Promise.withResolvers<RpcResponse>();
				let settled = false;
				const settle = (response: RpcResponse) => {
					if (settled) return;
					settled = true;
					resolve(response);
				};
				session
					.prompt(command.message, {
						images: command.images,
						streamingBehavior: command.streamingBehavior,
						source: "rpc",
						preflightResult: (disposition) => {
							settle(this.success(id, "prompt", { disposition }));
						},
					})
					.catch((e: unknown) => {
						settle(this.error(id, "prompt", e instanceof Error ? e.message : String(e)));
					});
				return promise;
			}

			case "steer": {
				const disposition = await session.steer(command.message, command.images, { source: "rpc" });
				return this.success(id, "steer", { disposition });
			}

			case "follow_up": {
				const disposition = await session.followUp(command.message, command.images, { source: "rpc" });
				return this.success(id, "follow_up", { disposition });
			}

			case "abort": {
				await session.abort();
				return this.success(id, "abort");
			}

			case "clear_queue": {
				return this.success(id, "clear_queue", session.clearQueue());
			}

			case "new_session": {
				const options = command.parentSession ? { parentSession: command.parentSession } : undefined;
				const result = await this.runtime.newSession(options);
				if (!result.cancelled) {
					await this.rebind();
				}
				return this.success(id, "new_session", result);
			}

			// =================================================================
			// State
			// =================================================================

			case "get_state": {
				const state: RpcSessionState = {
					model: session.model,
					thinkingLevel: session.thinkingLevel,
					isStreaming: session.isStreaming,
					isCompacting: session.isCompacting,
					steeringMode: session.steeringMode,
					followUpMode: session.followUpMode,
					sessionFile: session.sessionFile,
					sessionId: session.sessionId,
					sessionName: session.sessionName,
					autoCompactionEnabled: session.autoCompactionEnabled,
					messageCount: session.messages.length,
					pendingMessageCount: session.pendingMessageCount,
				};
				return this.success(id, "get_state", state);
			}

			// =================================================================
			// Model
			// =================================================================

			case "set_model": {
				const models = session.modelRuntime.getAvailableSnapshot();
				const model = models.find((m) => m.provider === command.provider && m.id === command.modelId);
				if (!model) {
					return this.error(id, "set_model", `Model not found: ${command.provider}/${command.modelId}`);
				}
				await session.setModel(model);
				return this.success(id, "set_model", model);
			}

			case "cycle_model": {
				const result = await session.cycleModel();
				if (!result) {
					return this.success(id, "cycle_model", null);
				}
				return this.success(id, "cycle_model", result);
			}

			case "get_available_models": {
				const models = session.modelRuntime.getAvailableSnapshot();
				return this.success(id, "get_available_models", { models });
			}

			case "set_scoped_models": {
				const models = session.modelRuntime.getAvailableSnapshot();
				const scopedModels: Parameters<AgentSession["setScopedModels"]>[0] = [];
				for (const scoped of command.scopedModels) {
					const model = models.find((m) => m.provider === scoped.provider && m.id === scoped.modelId);
					if (!model) {
						return this.error(id, "set_scoped_models", `Model not found: ${scoped.provider}/${scoped.modelId}`);
					}
					scopedModels.push({ model, thinkingLevel: scoped.thinkingLevel });
				}
				session.setScopedModels(scopedModels);
				return this.success(id, "set_scoped_models");
			}

			// =================================================================
			// Thinking
			// =================================================================

			case "set_thinking_level": {
				session.setThinkingLevel(command.level);
				return this.success(id, "set_thinking_level");
			}

			case "cycle_thinking_level": {
				const level = session.cycleThinkingLevel();
				if (!level) {
					return this.success(id, "cycle_thinking_level", null);
				}
				return this.success(id, "cycle_thinking_level", { level });
			}

			case "get_available_thinking_levels": {
				const levels = session.getAvailableThinkingLevels();
				return this.success(id, "get_available_thinking_levels", { levels });
			}

			// =================================================================
			// Queue Modes
			// =================================================================

			case "set_steering_mode": {
				session.setSteeringMode(command.mode);
				return this.success(id, "set_steering_mode");
			}

			case "set_follow_up_mode": {
				session.setFollowUpMode(command.mode);
				return this.success(id, "set_follow_up_mode");
			}

			// =================================================================
			// Compaction
			// =================================================================

			case "compact": {
				const result = await session.compact(command.customInstructions);
				return this.success(id, "compact", result);
			}

			case "set_auto_compaction": {
				session.setAutoCompactionEnabled(command.enabled);
				return this.success(id, "set_auto_compaction");
			}

			case "abort_compaction": {
				session.abortCompaction();
				return this.success(id, "abort_compaction");
			}

			case "abort_branch_summary": {
				session.abortBranchSummary();
				return this.success(id, "abort_branch_summary");
			}

			// =================================================================
			// Cache Warming
			// =================================================================

			case "set_cache_warming_mode": {
				session.setCacheWarmingMode(command.mode);
				return this.success(id, "set_cache_warming_mode");
			}

			// =================================================================
			// Retry
			// =================================================================

			case "set_auto_retry": {
				session.setAutoRetryEnabled(command.enabled);
				return this.success(id, "set_auto_retry");
			}

			case "abort_retry": {
				session.abortRetry();
				return this.success(id, "abort_retry");
			}

			// =================================================================
			// Bash
			// =================================================================

			case "bash": {
				const eventResult = await session.extensionRunner.emitUserBash({
					type: "user_bash",
					command: command.command,
					excludeFromContext: command.excludeFromContext ?? false,
					cwd: session.sessionManager.getCwd(),
				});

				if (eventResult?.result) {
					session.recordBashResult(command.command, eventResult.result, {
						excludeFromContext: command.excludeFromContext,
					});
					return this.success(id, "bash", eventResult.result);
				}

				const result = await session.executeBash(command.command, undefined, {
					excludeFromContext: command.excludeFromContext,
					id,
					operations: eventResult?.operations,
				});
				return this.success(id, "bash", result);
			}

			case "abort_bash": {
				session.abortBash();
				return this.success(id, "abort_bash");
			}

			case "execute_bash": {
				const result = await session.executeBash(command.command, undefined, {
					excludeFromContext: command.excludeFromContext,
				});
				return this.success(id, "execute_bash", result);
			}

			case "record_bash_result": {
				session.recordBashResult(command.command, command.result, {
					excludeFromContext: command.excludeFromContext,
				});
				return this.success(id, "record_bash_result");
			}

			// =================================================================
			// Session
			// =================================================================

			case "get_session_stats": {
				const stats = session.getSessionStats();
				return this.success(id, "get_session_stats", stats);
			}

			case "export_html": {
				const path = await session.exportToHtml(command.outputPath);
				return this.success(id, "export_html", { path });
			}

			case "export_jsonl": {
				const path = session.exportToJsonl(command.outputPath);
				return this.success(id, "export_jsonl", { path });
			}

			case "reload": {
				await session.reload();
				return this.success(id, "reload");
			}

			case "navigate_tree": {
				const result = await session.navigateTree(command.targetId, {
					summarize: command.summarize,
					customInstructions: command.customInstructions,
					replaceInstructions: command.replaceInstructions,
					label: command.label,
				});
				return this.success(id, "navigate_tree", {
					cancelled: result.cancelled,
					...(result.aborted === undefined ? {} : { aborted: result.aborted }),
					...(result.editorText === undefined ? {} : { editorText: result.editorText }),
				});
			}

			case "get_context_usage": {
				const usage = session.getContextUsage();
				return this.success(id, "get_context_usage", usage ?? null);
			}

			case "get_tool_definition": {
				const definition = session.getToolDefinition(command.name);
				return this.success(id, "get_tool_definition", definition ?? null);
			}

			case "switch_session": {
				const result = await this.runtime.switchSession(command.sessionPath);
				if (!result.cancelled) {
					await this.rebind();
				}
				return this.success(id, "switch_session", result);
			}

			case "fork": {
				const result = await this.runtime.fork(command.entryId);
				if (!result.cancelled) {
					await this.rebind();
				}
				return this.success(id, "fork", { text: result.selectedText, cancelled: result.cancelled });
			}

			case "clone": {
				const leafId = session.sessionManager.getLeafId();
				if (!leafId) {
					return this.error(id, "clone", "Cannot clone session: no current entry selected");
				}
				const result = await this.runtime.fork(leafId, { position: "at" });
				if (!result.cancelled) {
					await this.rebind();
				}
				return this.success(id, "clone", { cancelled: result.cancelled });
			}

			case "get_fork_messages": {
				const messages = session.getUserMessagesForForking();
				return this.success(id, "get_fork_messages", { messages });
			}

			case "get_entries": {
				const sessionManager = session.sessionManager;
				let entries = sessionManager.getEntries();
				if (command.since !== undefined) {
					const sinceIndex = entries.findIndex((e) => e.id === command.since);
					if (sinceIndex === -1) {
						return this.error(id, "get_entries", `Entry not found: ${command.since}`);
					}
					entries = entries.slice(sinceIndex + 1);
				}
				return this.success(id, "get_entries", { entries, leafId: sessionManager.getLeafId() });
			}

			case "get_tree": {
				const sessionManager = session.sessionManager;
				return this.success(id, "get_tree", { tree: sessionManager.getTree(), leafId: sessionManager.getLeafId() });
			}

			case "get_last_assistant_text": {
				const text = session.getLastAssistantText();
				return this.success(id, "get_last_assistant_text", { text });
			}

			case "set_session_name": {
				const name = command.name.trim();
				if (!name) {
					return this.error(id, "set_session_name", "Session name cannot be empty");
				}
				session.setSessionName(name);
				return this.success(id, "set_session_name");
			}

			case "label_entry": {
				session.sessionManager.appendLabelChange(command.entryId, command.label);
				return this.success(id, "label_entry");
			}

			case "append_custom_entry": {
				const entryId = session.sessionManager.appendCustomEntry(command.customType, command.data);
				return this.success(id, "append_custom_entry", { entryId });
			}

			case "summarize_for_bug_report": {
				const summary = await session.summarizeForBugReport({
					hint: command.hint,
					signal: new AbortController().signal,
				});
				return this.success(id, "summarize_for_bug_report", { summary });
			}

			// =================================================================
			// Messages
			// =================================================================

			case "get_messages": {
				return this.success(id, "get_messages", { messages: session.messages });
			}

			// =================================================================
			// Commands (available for invocation via prompt)
			// =================================================================

			case "get_commands": {
				const commands: RpcSlashCommand[] = [];

				for (const command of session.extensionRunner.getRegisteredCommands()) {
					commands.push({
						name: command.invocationName,
						description: command.description,
						source: "extension",
						sourceInfo: command.sourceInfo,
					});
				}

				for (const template of session.promptTemplates) {
					commands.push({
						name: template.name,
						description: template.description,
						source: "prompt",
						sourceInfo: template.sourceInfo,
					});
				}

				for (const skill of session.resourceLoader.getSkills().skills) {
					commands.push({
						name: `skill:${skill.name}`,
						description: skill.description,
						source: "skill",
						sourceInfo: skill.sourceInfo,
					});
				}

				return this.success(id, "get_commands", { commands });
			}

			default: {
				const unknownCommand = command as { type: string };
				return this.error(id, unknownCommand.type, `Unknown command: ${unknownCommand.type}`);
			}
		}
	}

	private success<T extends RpcCommand["type"]>(
		id: string | undefined,
		command: T,
		data?: object | null,
	): RpcResponse {
		if (data === undefined) {
			return { id, type: "response", command, success: true } as RpcResponse;
		}
		return { id, type: "response", command, success: true, data } as RpcResponse;
	}

	private error(id: string | undefined, command: string, message: string): RpcResponse {
		return { id, type: "response", command, success: false, error: message };
	}

	/**
	 * Build the extension UI context.
	 *
	 * Every dialog is answered by the transport; the controller only shapes the request and
	 * interprets the answer.
	 */
	private createExtensionUIContext(): ExtensionUIContext {
		const request = async (payload: RpcExtensionUIRequest): Promise<RpcExtensionUIResponse> => {
			if (this.disposed) {
				return { type: "extension_ui_response", id: payload.id, cancelled: true };
			}
			return this.hooks.requestExtensionUi(payload);
		};

		const createDialogPromise = <T>(
			opts: ExtensionUIDialogOptions | undefined,
			defaultValue: T,
			payload: Record<string, unknown>,
			parseResponse: (response: RpcExtensionUIResponse) => T,
		): Promise<T> => {
			if (opts?.signal?.aborted) return Promise.resolve(defaultValue);

			const id = crypto.randomUUID();
			const { promise, resolve } = Promise.withResolvers<T>();
			let timeoutId: NodeJS.Timeout | undefined;

			const cleanup = () => {
				clearTimeout(timeoutId);
				opts?.signal?.removeEventListener("abort", onAbort);
			};

			const onAbort = () => {
				cleanup();
				resolve(defaultValue);
			};
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			if (opts?.timeout) {
				timeoutId = setTimeout(() => {
					cleanup();
					resolve(defaultValue);
				}, opts.timeout);
			}

			void request({ type: "extension_ui_request", id, ...payload } as RpcExtensionUIRequest)
				.then((response) => {
					cleanup();
					resolve(parseResponse(response));
				})
				.catch(() => {
					cleanup();
					resolve(defaultValue);
				});
			return promise;
		};

		return {
			select: (title, options, opts) =>
				createDialogPromise(opts, undefined, { method: "select", title, options, timeout: opts?.timeout }, (r) =>
					"cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined,
				),

			confirm: (title, message, opts) =>
				createDialogPromise(opts, false, { method: "confirm", title, message, timeout: opts?.timeout }, (r) =>
					"cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false,
				),

			input: (title, placeholder, opts) =>
				createDialogPromise(
					opts,
					undefined,
					{ method: "input", title, placeholder, timeout: opts?.timeout },
					(r) => ("cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined),
				),

			notify: (message: string, type?: "info" | "warning" | "error"): void => {
				void request({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "notify",
					message,
					notifyType: type,
				} as RpcExtensionUIRequest);
			},

			onTerminalInput(): () => void {
				return () => {};
			},

			setStatus(key: string, text: string | undefined): void {
				void request({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setStatus",
					statusKey: key,
					statusText: text,
				} as RpcExtensionUIRequest);
			},

			setWorkingMessage(_message?: string): void {
				// Working message needs TUI loader access.
			},

			setWorkingVisible(_visible: boolean): void {
				// Working visibility needs TUI loader access.
			},

			setWorkingIndicator(_options?: WorkingIndicatorOptions): void {
				// Working indicator customization needs TUI loader access.
			},

			setHiddenThinkingLabel(_label?: string): void {
				// Hidden thinking label needs TUI message rendering access.
			},

			setWidget(key: string, content: unknown, options?: ExtensionWidgetOptions): void {
				if (content === undefined || Array.isArray(content)) {
					void request({
						type: "extension_ui_request",
						id: crypto.randomUUID(),
						method: "setWidget",
						widgetKey: key,
						widgetLines: content as string[] | undefined,
						widgetPlacement: options?.placement,
					} as RpcExtensionUIRequest);
				}
			},

			setFooter(_factory: unknown): void {
				// Custom footer needs TUI access.
			},

			setHeader(_factory: unknown): void {
				// Custom header needs TUI access.
			},

			setTitle(title: string): void {
				void request({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setTitle",
					title,
				} as RpcExtensionUIRequest);
			},

			async custom() {
				return undefined as never;
			},

			pasteToEditor(text: string): void {
				this.setEditorText(text);
			},

			setEditorText(text: string): void {
				void request({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "set_editor_text",
					text,
				} as RpcExtensionUIRequest);
			},

			getEditorText(): string {
				return "";
			},

			async editor(title: string, prefill?: string): Promise<string | undefined> {
				const response = await request({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "editor",
					title,
					prefill,
				} as RpcExtensionUIRequest);
				if ("cancelled" in response && response.cancelled) {
					return undefined;
				}
				return "value" in response ? response.value : undefined;
			},

			addAutocompleteProvider(): void {
				// Autocomplete provider composition needs TUI access.
			},

			setEditorComponent(): void {
				// Custom editor components need TUI access.
			},

			getEditorComponent() {
				return undefined;
			},

			get theme() {
				return theme;
			},

			getAllThemes() {
				return [];
			},

			getTheme(_name: string) {
				return undefined;
			},

			setTheme(_theme: string | Theme) {
				return { success: false, error: "Theme switching is not supported without a TUI" };
			},

			getToolsExpanded() {
				return false;
			},

			setToolsExpanded(_expanded: boolean): void {
				// Tool expansion needs TUI access.
			},
		};
	}
}
