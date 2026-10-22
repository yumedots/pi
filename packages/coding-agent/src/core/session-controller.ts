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
	ExtensionMode,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	WorkingIndicatorOptions,
} from "./extensions/index.ts";
import type { ExtensionCustomFactory, ExtensionFooterFactory, ExtensionHeaderFactory } from "./extensions/types.ts";
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
	private readonly extensionMode: ExtensionMode;
	private _session: AgentSession;
	private readonly listeners = new Set<(event: AgentSessionEvent) => void>();
	private unsubscribeSession?: () => void;
	private disposed = false;
	private extensionHeaderFactory: ExtensionHeaderFactory | undefined;
	private extensionFooterFactory: ExtensionFooterFactory | undefined;
	private extensionCustomFactory: ExtensionCustomFactory | undefined;
	private readonly extensionWidgets = new Map<
		string,
		{ key: string; lines: string[] | undefined; placement?: string }
	>();

	constructor(runtime: AgentSessionRuntime, hooks: SessionControllerHooks, extensionMode: ExtensionMode = "rpc") {
		this.runtime = runtime;
		this.hooks = hooks;
		this.extensionMode = extensionMode;
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
	 * The factory of the custom header of the session.
	 *
	 * A factory cannot travel over the wire, so the controller keeps it and the server
	 * renders it.
	 */
	getExtensionHeaderFactory(): ExtensionHeaderFactory | undefined {
		return this.extensionHeaderFactory;
	}

	/**
	 * The factory of the custom footer of the session.
	 *
	 * A factory cannot travel over the wire, so the controller keeps it and the server
	 * renders it.
	 */
	getExtensionFooterFactory(): ExtensionFooterFactory | undefined {
		return this.extensionFooterFactory;
	}

	/**
	 * The factory of the custom dialog of the session.
	 *
	 * A factory cannot travel over the wire, so the controller keeps it and the server
	 * renders it.
	 */
	getExtensionCustomFactory(): ExtensionCustomFactory | undefined {
		return this.extensionCustomFactory;
	}

	/**
	 * The widgets the extensions of the session set.
	 *
	 * A client that joins later asks for them, so it sees the widgets that are already
	 * there.
	 */
	getExtensionWidgets(): Array<{ key: string; lines: string[] | undefined; placement?: string }> {
		return [...this.extensionWidgets.values()];
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
		this.extensionHeaderFactory = undefined;
		this.extensionFooterFactory = undefined;
		this.extensionCustomFactory = undefined;
		this.extensionWidgets.clear();
		this.notifyExtensionChrome("setHeader");
		this.notifyExtensionChrome("setFooter");
		await this._session.bindExtensions({
			uiContext: this.createExtensionUIContext(),
			mode: this.extensionMode,
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
	 * Ask the transport for an extension UI request.
	 *
	 * The transport answers the dialogs; the fire-and-forget methods are answered right
	 * away, since nobody answers them.
	 */
	private requestExtensionUi(payload: RpcExtensionUIRequest): Promise<RpcExtensionUIResponse> {
		if (this.disposed) {
			return Promise.resolve({ type: "extension_ui_response", id: payload.id, cancelled: true });
		}
		return this.hooks.requestExtensionUi(payload);
	}

	/**
	 * Tell the client that the chrome of the session changed.
	 *
	 * The header and the footer are drawn by the server, so the client asks for them again
	 * when the extensions change them.
	 */
	private notifyExtensionChrome(method: "setHeader" | "setFooter" | "setCustom"): void {
		void this.requestExtensionUi({
			type: "extension_ui_request",
			id: crypto.randomUUID(),
			method,
		} as RpcExtensionUIRequest);
	}

	/**
	 * Build the extension UI context.
	 *
	 * Every dialog is answered by the transport; the controller only shapes the request and
	 * interprets the answer.
	 */
	private createExtensionUIContext(): ExtensionUIContext {
		const request = (payload: RpcExtensionUIRequest): Promise<RpcExtensionUIResponse> =>
			this.requestExtensionUi(payload);
		// The object literal below is not a method of the controller, so `this` inside it
		// is the literal. The state of the controller is captured here.
		const controller = this;

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

			setWorkingMessage(message?: string): void {
				void request({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setWorkingMessage",
					message,
				} as RpcExtensionUIRequest);
			},

			setWorkingVisible(visible: boolean): void {
				void request({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setWorkingVisible",
					visible,
				} as RpcExtensionUIRequest);
			},

			setWorkingIndicator(options?: WorkingIndicatorOptions): void {
				void request({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setWorkingIndicator",
					options: options ? { frames: options.frames, intervalMs: options.intervalMs } : undefined,
				} as RpcExtensionUIRequest);
			},

			setHiddenThinkingLabel(label?: string): void {
				void request({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setHiddenThinkingLabel",
					label,
				} as RpcExtensionUIRequest);
			},

			setWidget(key: string, content: unknown, options?: ExtensionWidgetOptions): void {
				if (content === undefined || Array.isArray(content)) {
					controller.extensionWidgets.set(key, {
						key,
						lines: content as string[] | undefined,
						placement: options?.placement,
					});
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

			setFooter: (factory) => {
				controller.extensionFooterFactory = factory;
				controller.notifyExtensionChrome("setFooter");
			},

			setHeader: (factory) => {
				controller.extensionHeaderFactory = factory;
				controller.notifyExtensionChrome("setHeader");
			},

			setTitle(title: string): void {
				void request({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setTitle",
					title,
				} as RpcExtensionUIRequest);
			},

			custom: async <T>(factory: ExtensionCustomFactory<T>): Promise<T> => {
				controller.extensionCustomFactory = factory;
				controller.notifyExtensionChrome("setCustom");
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
