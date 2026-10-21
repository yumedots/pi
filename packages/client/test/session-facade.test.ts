import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type {
	AgentSessionEvent,
	ExtensionUIContext,
	ModelRuntime,
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
} from "@earendil-works/pi-coding-agent";
import type { SessionStateSnapshot } from "@earendil-works/pi-server";
import type { PiServerClient } from "@earendil-works/pi-server/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RemoteSessionFacade } from "../src/remote-facade.ts";

/** The model the fake catalog knows. */
const testModel = {
	id: "model-1",
	name: "Model 1",
	provider: "test",
	api: "openai-completions",
	baseUrl: "https://example.test",
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	reasoning: false,
	contextWindow: 128000,
	maxTokens: 4096,
} as unknown as Model<any>;

/** The model runtime of the client: a catalog with a single model. */
const fakeModelRuntime = {
	getModel: (providerId: string, modelId: string) =>
		providerId === "test" && modelId === "model-1" ? testModel : undefined,
	getProviders: () => [{ id: "test" }],
} as unknown as ModelRuntime;

/**
 * The state of a session.
 */
function stateSnapshot(overrides: Partial<SessionStateSnapshot> = {}): SessionStateSnapshot {
	return {
		sessionId: "session-1",
		cwd: "/tmp/project",
		sessionFile: "/tmp/agent/sessions/project/session-1.jsonl",
		title: "The session",
		model: "test/model-1",
		thinkingLevel: "medium",
		scopedModels: [{ provider: "test", modelId: "model-1", thinkingLevel: "high" }],
		steeringMode: "all",
		followUpMode: "one-at-a-time",
		autoCompactionEnabled: true,
		cacheWarmingMode: "off",
		isStreaming: true,
		isIdle: false,
		isCompacting: false,
		isBashRunning: true,
		retryAttempt: 2,
		pendingMessageCount: 3,
		queue: { steering: ["steer me"], followUp: ["follow me"] },
		systemPrompt: "You are pi.",
		sessionStats: undefined,
		contextUsage: undefined,
		...overrides,
	};
}

/**
 * A server client that records what the facade asks of it.
 */
class FakeServerClient {
	/** The commands the facade sent. */
	readonly commands: RpcCommand[] = [];
	/** The sessions whose state was read. */
	readonly stateRequests: string[] = [];
	/** The sessions whose resources were read. */
	readonly resourceRequests: string[] = [];
	/** The answers the client sent to the extension UI requests. */
	readonly extensionUiResponses: RpcExtensionUIResponse[] = [];
	private readonly extensionUiWaiters: Array<(response: RpcExtensionUIResponse) => void> = [];
	/** The known sessions. */
	readonly sessions = new Map<string, SessionStateSnapshot>();
	/** The transcript the server answers with. */
	messages: AgentMessage[] = [];
	/** The resources the server answers with. */
	resources: unknown = {
		promptTemplates: [{ name: "review", description: "Review the diff" }],
		skills: [{ name: "pdf", description: "Read a pdf" }],
		commands: [
			{ name: "deploy", description: "Deploy the app", source: "extension" },
			{ name: "review", description: "Review the diff", source: "prompt" },
		],
	};
	private readonly listeners = new Map<string, Set<(event: AgentSessionEvent) => void>>();

	async getSessionState(sessionId: string): Promise<SessionStateSnapshot> {
		this.stateRequests.push(sessionId);
		const state = this.sessions.get(sessionId);
		if (!state) throw new Error(`Unknown session: ${sessionId}`);
		return state;
	}

	async sendCommand(_sessionId: string, command: RpcCommand): Promise<RpcResponse> {
		this.commands.push(command);
		if (command.type === "get_messages") {
			return { type: "response", command: "get_messages", success: true, data: { messages: this.messages } };
		}
		return respond(command);
	}

	async getSessionResources(sessionId: string): Promise<unknown> {
		this.resourceRequests.push(sessionId);
		return this.resources;
	}

	async respondExtensionUi(_sessionId: string, response: RpcExtensionUIResponse): Promise<void> {
		this.extensionUiResponses.push(response);
		this.extensionUiWaiters.shift()?.(response);
	}

	/** Resolves with the next answer the client sends to an extension UI request. */
	waitForExtensionUiResponse(): Promise<RpcExtensionUIResponse> {
		return new Promise((resolve) => {
			this.extensionUiWaiters.push(resolve);
		});
	}

	events(sessionId: string, onEvent: (event: AgentSessionEvent) => void): () => void {
		const listeners = this.listeners.get(sessionId) ?? new Set<(event: AgentSessionEvent) => void>();
		listeners.add(onEvent);
		this.listeners.set(sessionId, listeners);
		return () => {
			listeners.delete(onEvent);
		};
	}

	/** Deliver an event to the listeners of a session. */
	emit(sessionId: string, event: AgentSessionEvent): void {
		for (const listener of this.listeners.get(sessionId) ?? []) {
			listener(event);
		}
	}

	/** Deliver an extension UI request to the listeners of a session. */
	emitExtensionUi(sessionId: string, request: RpcExtensionUIRequest): void {
		for (const listener of this.listeners.get(sessionId) ?? []) {
			listener(request as unknown as AgentSessionEvent);
		}
	}
}

/**
 * The answer of the fake server to a command.
 */
function respond(command: RpcCommand): RpcResponse {
	switch (command.type) {
		case "prompt":
			return { type: "response", command: "prompt", success: true, data: { disposition: "started" } };
		case "steer":
			return { type: "response", command: "steer", success: true, data: { disposition: "queued" } };
		case "follow_up":
			return { type: "response", command: "follow_up", success: true, data: { disposition: "queued" } };
		case "abort":
			return { type: "response", command: "abort", success: true };
		case "abort_retry":
			return { type: "response", command: "abort_retry", success: true };
		case "abort_compaction":
			return { type: "response", command: "abort_compaction", success: true };
		case "abort_branch_summary":
			return { type: "response", command: "abort_branch_summary", success: true };
		case "abort_bash":
			return { type: "response", command: "abort_bash", success: true };
		case "clear_queue":
			return {
				type: "response",
				command: "clear_queue",
				success: true,
				data: { steering: ["steer me"], followUp: ["follow me"] },
			};
		case "compact":
			return {
				type: "response",
				command: "compact",
				success: true,
				data: { summary: "summary", firstKeptEntryId: "entry-1", tokensBefore: 100 },
			};
		case "cycle_model":
			return {
				type: "response",
				command: "cycle_model",
				success: true,
				data: { model: testModel, thinkingLevel: "high", isScoped: true },
			};
		case "cycle_thinking_level":
			return { type: "response", command: "cycle_thinking_level", success: true, data: { level: "high" } };
		case "set_model":
			return { type: "response", command: "set_model", success: true, data: testModel };
		case "set_thinking_level":
			return { type: "response", command: "set_thinking_level", success: true };
		case "set_scoped_models":
			return { type: "response", command: "set_scoped_models", success: true };
		case "set_steering_mode":
			return { type: "response", command: "set_steering_mode", success: true };
		case "set_follow_up_mode":
			return { type: "response", command: "set_follow_up_mode", success: true };
		case "set_auto_compaction":
			return { type: "response", command: "set_auto_compaction", success: true };
		case "set_cache_warming_mode":
			return { type: "response", command: "set_cache_warming_mode", success: true };
		case "set_session_name":
			return { type: "response", command: "set_session_name", success: true };
		case "navigate_tree":
			return { type: "response", command: "navigate_tree", success: true, data: { cancelled: false } };
		case "new_session":
			return { type: "response", command: "new_session", success: true, data: { cancelled: false } };
		case "switch_session":
			return { type: "response", command: "switch_session", success: true, data: { cancelled: false } };
		case "fork":
			return { type: "response", command: "fork", success: true, data: { text: "selected", cancelled: false } };
		case "clone":
			return { type: "response", command: "clone", success: true, data: { cancelled: false } };
		case "label_entry":
			return { type: "response", command: "label_entry", success: true };
		case "reload":
			return { type: "response", command: "reload", success: true };
		case "execute_bash":
			return {
				type: "response",
				command: "execute_bash",
				success: true,
				data: { output: "hello", exitCode: 0, cancelled: false, truncated: false },
			};
		case "record_bash_result":
			return { type: "response", command: "record_bash_result", success: true };
		case "export_jsonl":
			return { type: "response", command: "export_jsonl", success: true, data: { path: "/tmp/out.jsonl" } };
		case "export_html":
			return { type: "response", command: "export_html", success: true, data: { path: "/tmp/out.html" } };
		case "get_tool_definition":
			return {
				type: "response",
				command: "get_tool_definition",
				success: true,
				data: {
					name: "read",
					label: "Read",
					description: "Read a file",
					parameters: { type: "object" },
					execute: async () => ({ content: [], details: undefined }),
				},
			};
		case "get_session_stats":
			return {
				type: "response",
				command: "get_session_stats",
				success: true,
				data: {
					sessionFile: "/tmp/agent/sessions/project/session-1.jsonl",
					sessionId: "session-1",
					userMessages: 1,
					assistantMessages: 2,
					toolCalls: 3,
					toolResults: 3,
					totalMessages: 3,
					tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 },
					cost: 0.5,
				},
			};
		case "get_context_usage":
			return {
				type: "response",
				command: "get_context_usage",
				success: true,
				data: { tokens: 1000, contextWindow: 128000, percent: 0.8 },
			};
		case "get_last_assistant_text":
			return { type: "response", command: "get_last_assistant_text", success: true, data: { text: "the answer" } };
		case "get_fork_messages":
			return {
				type: "response",
				command: "get_fork_messages",
				success: true,
				data: { messages: [{ entryId: "entry-1", text: "the question" }] },
			};
		case "get_available_thinking_levels":
			return {
				type: "response",
				command: "get_available_thinking_levels",
				success: true,
				data: { levels: ["off", "medium", "high"] },
			};
		case "get_entries":
			return { type: "response", command: "get_entries", success: true, data: { entries: [], leafId: null } };
		case "get_tree":
			return { type: "response", command: "get_tree", success: true, data: { tree: [], leafId: null } };
		default:
			return { type: "response", command: command.type, success: false, error: "unsupported command" };
	}
}

describe("the remote session facade", () => {
	let workspace: string;
	let client: FakeServerClient;
	let facade!: RemoteSessionFacade;

	beforeEach(async () => {
		workspace = mkdtempSync(join(tmpdir(), "pi-facade-"));
		client = new FakeServerClient();
		client.sessions.set("session-1", stateSnapshot());
		facade = new RemoteSessionFacade(client as unknown as PiServerClient, "session-1", join(workspace, "project"), {
			agentDir: join(workspace, "agent"),
			modelRuntime: fakeModelRuntime,
		});
		await facade.load();
		client.commands.length = 0;
	});

	afterEach(() => {
		facade?.dispose();
		rmSync(workspace, { recursive: true, force: true });
	});

	test("sends the expected command for every command-backed member", async () => {
		await facade.prompt("hello");
		expect(client.commands.pop()).toEqual({ type: "prompt", message: "hello" });

		await facade.steer("slow down");
		expect(client.commands.pop()).toEqual({ type: "steer", message: "slow down" });

		await facade.followUp("and then");
		expect(client.commands.pop()).toEqual({ type: "follow_up", message: "and then" });

		await facade.abort();
		expect(client.commands.pop()).toEqual({ type: "abort" });

		await facade.abortRetry();
		expect(client.commands.pop()).toEqual({ type: "abort_retry" });

		await facade.abortCompaction();
		expect(client.commands.pop()).toEqual({ type: "abort_compaction" });

		await facade.abortBranchSummary();
		expect(client.commands.pop()).toEqual({ type: "abort_branch_summary" });

		await facade.abortBash();
		expect(client.commands.pop()).toEqual({ type: "abort_bash" });

		await facade.clearQueue();
		expect(client.commands.pop()).toEqual({ type: "clear_queue" });

		await facade.compact("keep the tests");
		expect(client.commands.pop()).toEqual({ type: "compact", customInstructions: "keep the tests" });

		await facade.cycleModel();
		expect(client.commands.pop()).toEqual({ type: "cycle_model" });

		await facade.cycleThinkingLevel();
		expect(client.commands.pop()).toEqual({ type: "cycle_thinking_level" });

		await facade.setModel(testModel);
		expect(client.commands.pop()).toEqual({ type: "set_model", provider: "test", modelId: "model-1" });

		await facade.setThinkingLevel("high");
		expect(client.commands.pop()).toEqual({ type: "set_thinking_level", level: "high" });

		await facade.setScopedModels([{ model: testModel, thinkingLevel: "high" }]);
		expect(client.commands.pop()).toEqual({
			type: "set_scoped_models",
			scopedModels: [{ provider: "test", modelId: "model-1", thinkingLevel: "high" }],
		});

		await facade.setSteeringMode("one-at-a-time");
		expect(client.commands.pop()).toEqual({ type: "set_steering_mode", mode: "one-at-a-time" });

		await facade.setFollowUpMode("all");
		expect(client.commands.pop()).toEqual({ type: "set_follow_up_mode", mode: "all" });

		await facade.setAutoCompactionEnabled(true);
		expect(client.commands.pop()).toEqual({ type: "set_auto_compaction", enabled: true });

		await facade.setCacheWarmingMode("off");
		expect(client.commands.pop()).toEqual({ type: "set_cache_warming_mode", mode: "off" });

		await facade.setSessionName("The session");
		expect(client.commands.pop()).toEqual({ type: "set_session_name", name: "The session" });

		await facade.navigateTree("entry-1", { summarize: true, label: "back" });
		expect(client.commands.pop()).toEqual({
			type: "navigate_tree",
			targetId: "entry-1",
			summarize: true,
			label: "back",
		});

		await facade.reload();
		expect(client.commands).toContainEqual({ type: "reload" });

		await facade.executeBash("ls");
		expect(client.commands.pop()).toEqual({ type: "execute_bash", command: "ls" });

		const bashResult = { output: "hello", exitCode: 0, cancelled: false, truncated: false };
		await facade.recordBashResult("ls", bashResult, { excludeFromContext: true });
		expect(client.commands.pop()).toEqual({
			type: "record_bash_result",
			command: "ls",
			result: bashResult,
			excludeFromContext: true,
		});

		await facade.exportToJsonl("/tmp/out.jsonl");
		expect(client.commands.pop()).toEqual({ type: "export_jsonl", outputPath: "/tmp/out.jsonl" });

		await facade.exportToHtml("/tmp/out.html");
		expect(client.commands.pop()).toEqual({ type: "export_html", outputPath: "/tmp/out.html" });

		await facade.getToolDefinition("read");
		expect(client.commands.pop()).toEqual({ type: "get_tool_definition", name: "read" });

		await facade.getSessionStats();
		expect(client.commands.pop()).toEqual({ type: "get_session_stats" });

		await facade.getContextUsage();
		expect(client.commands.pop()).toEqual({ type: "get_context_usage" });

		await facade.getLastAssistantText();
		expect(client.commands.pop()).toEqual({ type: "get_last_assistant_text" });

		await facade.getUserMessagesForForking();
		expect(client.commands.pop()).toEqual({ type: "get_fork_messages" });

		await facade.getAvailableThinkingLevels();
		expect(client.commands.pop()).toEqual({ type: "get_available_thinking_levels" });
	});

	test("returns the data of the command", async () => {
		await expect(facade.prompt("hello")).resolves.toBe("started");
		await expect(facade.steer("slow down")).resolves.toBe("queued");
		await expect(facade.followUp("and then")).resolves.toBe("queued");
		await expect(facade.clearQueue()).resolves.toEqual({ steering: ["steer me"], followUp: ["follow me"] });
		await expect(facade.getLastAssistantText()).resolves.toBe("the answer");
		await expect(facade.getUserMessagesForForking()).resolves.toEqual([{ entryId: "entry-1", text: "the question" }]);
		await expect(facade.getAvailableThinkingLevels()).resolves.toEqual(["off", "medium", "high"]);
		await expect(facade.getToolDefinition("read")).resolves.toMatchObject({ name: "read" });
		await expect(facade.exportToJsonl()).resolves.toBe("/tmp/out.jsonl");
		await expect(facade.exportToHtml()).resolves.toBe("/tmp/out.html");
		await expect(facade.getContextUsage()).resolves.toMatchObject({ tokens: 1000 });
		await expect(facade.getSessionStats()).resolves.toMatchObject({ userMessages: 1 });
	});

	test("reflects the snapshot of the session", () => {
		expect(facade.sessionId).toBe("session-1");
		expect(facade.model?.id).toBe("model-1");
		expect(facade.model?.provider).toBe("test");
		expect(facade.thinkingLevel).toBe("medium");
		expect(facade.scopedModels).toEqual([{ model: testModel, thinkingLevel: "high" }]);
		expect(facade.isStreaming).toBe(true);
		expect(facade.isIdle).toBe(false);
		expect(facade.isCompacting).toBe(false);
		expect(facade.isBashRunning).toBe(true);
		expect(facade.retryAttempt).toBe(2);
		expect(facade.pendingMessageCount).toBe(3);
		expect(facade.sessionFile).toBe("/tmp/agent/sessions/project/session-1.jsonl");
		expect(facade.steeringMode).toBe("all");
		expect(facade.followUpMode).toBe("one-at-a-time");
		expect(facade.autoCompactionEnabled).toBe(true);
		expect(facade.systemPrompt).toBe("You are pi.");
		expect(facade.getSteeringMessages()).toEqual(["steer me"]);
		expect(facade.getFollowUpMessages()).toEqual(["follow me"]);
		expect(facade.state.messages).toEqual([]);
		expect(facade.state.isStreaming).toBe(true);
		expect(facade.agent.state.thinkingLevel).toBe("medium");
		expect(facade.sessionManager.getCwd()).toBe("/tmp/project");
		expect(facade.sessionManager.getSessionName()).toBe("The session");
	});

	test("exposes the resources of the session", () => {
		expect(facade.promptTemplates).toEqual([{ name: "review", description: "Review the diff" }]);
		expect(facade.resourceLoader.getSkills().skills).toEqual([{ name: "pdf", description: "Read a pdf" }]);
		expect(facade.extensionRunner.getRegisteredCommands()).toEqual([
			{ name: "deploy", invocationName: "deploy", description: "Deploy the app" },
		]);
	});

	test("forwards the events of the session", () => {
		const seen: AgentSessionEvent[] = [];
		const unsubscribe = facade.subscribe((event) => seen.push(event));
		client.emit("session-1", {
			type: "auto_retry_start",
			attempt: 1,
			maxAttempts: 3,
			delayMs: 1000,
			errorMessage: "boom",
		});
		expect(seen).toHaveLength(1);
		unsubscribe();
		client.emit("session-1", {
			type: "auto_retry_start",
			attempt: 2,
			maxAttempts: 3,
			delayMs: 1000,
			errorMessage: "boom",
		});
		expect(seen).toHaveLength(1);
	});

	test("replaces the session on the server", async () => {
		await expect(facade.fork("entry-1")).resolves.toEqual({ text: "selected", cancelled: false });
		expect(client.commands).toContainEqual({ type: "fork", entryId: "entry-1" });

		await expect(facade.newSession()).resolves.toEqual({ cancelled: false });
		expect(client.commands).toContainEqual({ type: "new_session", parentSession: undefined });

		await expect(facade.switchSession("/tmp/other.jsonl")).resolves.toEqual({ cancelled: false });
		expect(client.commands).toContainEqual({ type: "switch_session", sessionPath: "/tmp/other.jsonl" });

		await expect(facade.clone()).resolves.toEqual({ cancelled: false });
		expect(client.commands).toContainEqual({ type: "clone" });

		await facade.sessionManager.appendLabelChange("entry-1", "the label");
		expect(client.commands.pop()).toEqual({ type: "label_entry", entryId: "entry-1", label: "the label" });
	});

	test("runs the rebind hooks around a session replacement", async () => {
		const order: string[] = [];
		facade.setBeforeSessionInvalidate(() => {
			order.push("before");
		});
		facade.setRebindSession(() => {
			order.push("rebind");
		});
		await facade.newSession();
		expect(order).toEqual(["before", "rebind"]);
	});

	test("answers the extension ui requests of the server", async () => {
		const asked: string[] = [];
		const uiContext = {
			confirm: async (title: string) => {
				asked.push(title);
				return true;
			},
		} as unknown as ExtensionUIContext;
		await facade.bindExtensions({ uiContext });
		const answer = client.waitForExtensionUiResponse();
		client.emitExtensionUi("session-1", {
			type: "extension_ui_request",
			id: "req-1",
			method: "confirm",
			title: "Sure?",
			message: "Really?",
		});
		await expect(answer).resolves.toEqual({ type: "extension_ui_response", id: "req-1", confirmed: true });
		expect(asked).toEqual(["Sure?"]);
	});

	test("reloads the transcript of the session", async () => {
		client.messages = [{ role: "user", content: "hello", timestamp: 1 }];
		await facade.reload();
		expect(facade.messages).toEqual([{ role: "user", content: "hello", timestamp: 1 }]);
	});

	test("exposes the context usage of the last snapshot", async () => {
		client.sessions.set(
			"session-2",
			stateSnapshot({
				sessionId: "session-2",
				contextUsage: { tokens: 1000, contextWindow: 128000, percent: 0.8 },
			}),
		);
		await facade.switchTo("session-2");
		expect(facade.contextUsage).toEqual({ tokens: 1000, contextWindow: 128000, percent: 0.8 });
	});

	test("exposes the agent of the session", () => {
		expect(facade.agent.state.thinkingLevel).toBe("medium");
		expect(facade.agent.signal.aborted).toBe(false);
		facade.agent.transport = "sse";
		expect(facade.agent.transport).toBe("sse");
	});

	test("re-points the connection when the session changes", async () => {
		client.sessions.set(
			"session-2",
			stateSnapshot({ sessionId: "session-2", title: "The other session", thinkingLevel: "high" }),
		);
		await facade.switchTo("session-2");
		expect(facade.sessionId).toBe("session-2");
		expect(facade.thinkingLevel).toBe("high");
		expect(facade.sessionManager.getSessionName()).toBe("The other session");
		expect(client.stateRequests).toContain("session-2");
		expect(client.resourceRequests).toContain("session-2");
	});
});
