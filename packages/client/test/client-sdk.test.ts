/**
 * The client SDK and the members of the facade that talk to it.
 *
 * Everything here runs against a stub: no server is started and no socket is opened.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { AgentSessionEvent, ModelRuntime, RpcCommand, RpcResponse } from "@earendil-works/pi-coding-agent";
import type { SessionStateSnapshot } from "@earendil-works/pi-server";
import { PiServerClient, type RemoteSessionInfo } from "@earendil-works/pi-server/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
 * A fetch stub that records what the client asked of the server.
 */
class FetchStub {
	/** The requests the client made. */
	readonly requests: Array<{ url: string; method: string; body: string | undefined }> = [];
	/** The answers the stub hands out, one per request. */
	readonly answers: Array<() => Promise<Response>> = [];

	/** The fetch implementation of the stub. */
	readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		this.requests.push({
			url,
			method: init?.method ?? "GET",
			body: typeof init?.body === "string" ? init.body : undefined,
		});
		const answer = this.answers.shift();
		if (!answer) throw new Error(`The stub has no answer for ${url}`);
		return answer();
	};
}

/**
 * A server client that answers from memory.
 */
class StubServerClient {
	/** The state of the session. */
	state: SessionStateSnapshot = stateSnapshot();
	/** The transcript of the session. */
	messages: AgentMessage[] = [];
	/** The sessions the server knows about. */
	sessions: RemoteSessionInfo[] = [];
	/** The number of times the state was read. */
	stateReads = 0;
	/** When set, the state reads wait for this gate. */
	gate: Promise<void> | undefined;
	private readonly listeners = new Set<(event: AgentSessionEvent) => void>();

	async getSessionState(_sessionId: string): Promise<SessionStateSnapshot> {
		const state = this.state;
		this.stateReads++;
		if (this.gate) await this.gate;
		return state;
	}

	async sendCommand(_sessionId: string, command: RpcCommand): Promise<RpcResponse> {
		if (command.type === "get_messages") {
			return { type: "response", command: "get_messages", success: true, data: { messages: this.messages } };
		}
		if (command.type === "get_entries") {
			return { type: "response", command: "get_entries", success: true, data: { entries: [], leafId: null } };
		}
		if (command.type === "get_tree") {
			return { type: "response", command: "get_tree", success: true, data: { tree: [], leafId: null } };
		}
		return { type: "response", command: command.type, success: true } as RpcResponse;
	}

	async getSessionResources(_sessionId: string): Promise<unknown> {
		return { promptTemplates: [], skills: [], commands: [], tools: [], extensions: [], extensionErrors: [] };
	}

	async listSessions(cwd?: string): Promise<RemoteSessionInfo[]> {
		return cwd === undefined ? this.sessions : this.sessions.filter((session) => session.cwd === cwd);
	}

	async respondExtensionUi(): Promise<void> {}

	events(_sessionId: string, onEvent: (event: AgentSessionEvent) => void): () => void {
		this.listeners.add(onEvent);
		return () => {
			this.listeners.delete(onEvent);
		};
	}

	/** Deliver an event to the subscribers. */
	emit(event: AgentSessionEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}

describe("the client SDK", () => {
	test("openSession posts to the session route and answers with the snapshot", async () => {
		const stub = new FetchStub();
		const snapshot = stateSnapshot({ sessionId: "session-9", cwd: "/tmp/other" });
		stub.answers.push(async () => new Response(JSON.stringify({ data: snapshot }), { status: 200 }));
		const client = new PiServerClient({ url: "http://localhost:1234", password: "secret", fetch: stub.fetch });

		const opened = await client.openSession({
			cwd: "/tmp/other",
			title: "A session",
			model: "test/model-1",
			thinkingLevel: "medium",
			resume: "recent",
		});

		expect(opened).toEqual(snapshot);
		expect(stub.requests).toHaveLength(1);
		expect(stub.requests[0].url).toBe("http://localhost:1234/pi/session");
		expect(stub.requests[0].method).toBe("POST");
		expect(JSON.parse(stub.requests[0].body ?? "{}")).toEqual({
			cwd: "/tmp/other",
			title: "A session",
			model: "test/model-1",
			thinkingLevel: "medium",
			resume: "recent",
		});
	});

	test("openSession leaves out the options that were not given", async () => {
		const stub = new FetchStub();
		stub.answers.push(async () => new Response(JSON.stringify({ data: stateSnapshot() }), { status: 200 }));
		const client = new PiServerClient({ url: "http://localhost:1234", password: "secret", fetch: stub.fetch });

		await client.openSession();

		expect(JSON.parse(stub.requests[0].body ?? "{}")).toEqual({});
	});

	test("a subscriber always receives an event with a type", async () => {
		const stub = new FetchStub();
		const frames = [
			'data: {"id":"1","type":"session.connected","data":{}}\n\n',
			'data: {"id":"2","type":"agent_start","data":{"type":"agent_start","sessionId":"session-1"}}\n\n',
		].join("");
		stub.answers.push(async () => new Response(frames, { status: 200 }));
		const client = new PiServerClient({ url: "http://localhost:1234", password: "secret", fetch: stub.fetch });

		const events: AgentSessionEvent[] = [];
		const received = Promise.withResolvers<void>();
		const stop = client.events("session-1", (event) => {
			events.push(event);
			if (events.length === 2) received.resolve();
		});
		await received.promise;
		stop();

		expect(events).toHaveLength(2);
		for (const event of events) {
			expect(typeof event.type).toBe("string");
			expect(event.type.length).toBeGreaterThan(0);
		}
		expect(events[0].type).toBe("session.connected");
		expect(events[1].type).toBe("agent_start");
	});

	test("the reconnect timer does not keep the process alive", async () => {
		const failed = Promise.withResolvers<void>();
		const client = new PiServerClient({
			url: "http://localhost:1234",
			password: "secret",
			fetch: async () => {
				failed.resolve();
				throw new Error("the server is gone");
			},
		});

		const timersBefore = process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;
		const stop = client.events("session-1", () => {});
		await failed.promise;
		// A macrotask lets the client schedule its reconnect timer.
		const flushed = Promise.withResolvers<void>();
		setImmediate(() => flushed.resolve());
		await flushed.promise;

		expect(process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length).toBe(timersBefore);
		stop();
	});

	test("stopping the subscription stops the reconnect", async () => {
		vi.useFakeTimers();
		try {
			let attempts = 0;
			const firstAttempt = Promise.withResolvers<void>();
			const secondAttempt = Promise.withResolvers<void>();
			const client = new PiServerClient({
				url: "http://localhost:1234",
				password: "secret",
				fetch: async () => {
					attempts++;
					if (attempts === 1) firstAttempt.resolve();
					if (attempts === 2) secondAttempt.resolve();
					throw new Error("the server is gone");
				},
			});

			const stop = client.events("session-1", () => {});
			await firstAttempt.promise;
			await vi.advanceTimersByTimeAsync(0);
			expect(attempts).toBe(1);

			await vi.advanceTimersByTimeAsync(1000);
			await secondAttempt.promise;
			await vi.advanceTimersByTimeAsync(0);
			expect(attempts).toBe(2);

			stop();
			await vi.advanceTimersByTimeAsync(5000);
			await vi.advanceTimersByTimeAsync(0);
			expect(attempts).toBe(2);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("the remote session facade", () => {
	let workspace: string;
	let client: StubServerClient;
	let facade!: RemoteSessionFacade;

	beforeEach(async () => {
		workspace = mkdtempSync(join(tmpdir(), "pi-client-sdk-"));
		client = new StubServerClient();
		facade = new RemoteSessionFacade(client as unknown as PiServerClient, "session-1", join(workspace, "project"), {
			agentDir: join(workspace, "agent"),
			modelRuntime: fakeModelRuntime,
		});
		await facade.load();
	});

	afterEach(() => {
		facade.dispose();
		rmSync(workspace, { recursive: true, force: true });
	});

	test("the facade reports the directory of the session", () => {
		expect(facade.cwd).toBe("/tmp/project");
	});

	test("the facade refreshes the snapshot and the transcript", async () => {
		client.state = stateSnapshot({ title: "Renamed elsewhere" });
		client.messages = [{ role: "user", content: "hello" } as unknown as AgentMessage];

		const snapshot = await facade.refresh();

		expect(snapshot.title).toBe("Renamed elsewhere");
		expect(facade.sessionManager.getSessionName()).toBe("Renamed elsewhere");
		expect(facade.messages).toHaveLength(1);
	});

	test("the facade knows the name of the session right after the rename", async () => {
		await facade.setSessionName("A better name");

		expect(facade.sessionManager.getSessionName()).toBe("A better name");
	});

	test("the facade lists the sessions of the server", async () => {
		client.sessions = [
			{
				id: "session-1",
				path: "/tmp/agent/sessions/project/session-1.jsonl",
				cwd: "/tmp/project",
				name: "The session",
				created: 1,
				modified: 2,
				messageCount: 3,
				firstMessage: "hello",
				busy: false,
			},
		];

		const sessions = await facade.listSessions();

		expect(sessions).toHaveLength(1);
		expect(sessions[0].id).toBe("session-1");
	});

	test("a change that arrives during a refresh schedules another refresh", async () => {
		const gate = Promise.withResolvers<void>();
		client.gate = gate.promise;
		client.state = stateSnapshot({ title: "Before" });

		const settled = Promise.withResolvers<void>();
		const unsubscribe = facade.subscribe((event) => {
			if (event.type === "session_info_changed") settled.resolve();
		});

		const readsBefore = client.stateReads;
		client.emit({ type: "session_info_changed", name: "Before" });
		client.state = stateSnapshot({ title: "After" });
		client.emit({ type: "session_info_changed", name: "After" });
		gate.resolve();
		await settled.promise;
		unsubscribe();

		expect(client.stateReads).toBe(readsBefore + 2);
		expect(facade.sessionManager.getSessionName()).toBe("After");
	});
});
