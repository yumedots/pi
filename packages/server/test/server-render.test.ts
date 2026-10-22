import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { basicAuthHeader } from "../src/auth.ts";
import { type PiServer, startServer } from "../src/server.ts";
import type { ServerSession, SessionRegistry } from "../src/session-registry.ts";

/** The text the extension of the fake session draws. */
const EXTENSION_CALL = "extension tool call";
const EXTENSION_RESULT = "extension tool result";
const EXTENSION_MESSAGE = "extension message";
const EXTENSION_ENTRY = "extension entry";

/** A component that draws fixed lines. */
class FixedComponent {
	private readonly lines: string[];

	constructor(lines: string[]) {
		this.lines = lines;
	}

	render(_width: number): string[] {
		return this.lines;
	}
}

/**
 * A session whose extension registered a tool renderer, a message renderer and an entry
 * renderer. The built-in renderers are the fallback for every other tool.
 */
function fakeSession(): ServerSession {
	const extensionRunner = {
		resolveToolRenderers: (toolName: string, base: () => unknown) =>
			toolName === "custom_tool"
				? {
						renderCall: () => new FixedComponent([EXTENSION_CALL]),
						renderResult: () => new FixedComponent([EXTENSION_RESULT]),
					}
				: base(),
		getMessageRenderer: (customType: string) =>
			customType === "custom_message" ? () => new FixedComponent([EXTENSION_MESSAGE]) : undefined,
		getEntryRenderer: (customType: string) =>
			customType === "custom_entry" ? () => new FixedComponent([EXTENSION_ENTRY]) : undefined,
	};
	const agentSession = {
		extensionRunner,
		getToolDefinition: () => undefined,
		settingsManager: { getTheme: () => "dark" },
		sessionManager: { getCwd: () => "/tmp/project" },
	};
	return {
		id: "session-1",
		cwd: "/tmp/project",
		runtime: { session: agentSession },
		controller: {},
		sessionFile: undefined,
		busy: false,
	} as unknown as ServerSession;
}

/** A registry that knows the one session of the test. */
function registryWith(session: ServerSession): SessionRegistry {
	return {
		sessions: new Map([[session.id, session]]),
		list: async () => [],
		get: (id: string) => (id === session.id ? session : undefined),
		close: async () => {},
		closeAll: async () => {},
	} as unknown as SessionRegistry;
}

let server: PiServer | undefined;
const tempDirs: string[] = [];

function makeAgentDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-server-render-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await server?.close();
	server = undefined;
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

async function render(body: unknown): Promise<{ status: number; lines: string[] }> {
	const response = await fetch(`${server?.url}/pi/session/session-1/render`, {
		method: "POST",
		headers: {
			authorization: basicAuthHeader("test-password"),
			"content-type": "application/json",
		},
		body: JSON.stringify(body),
	});
	const payload = (await response.json()) as { lines?: string[] };
	return { status: response.status, lines: payload.lines ?? [] };
}

describe("the server renders the transcript", () => {
	test("draws a tool call with the renderer of the extension", async () => {
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeAgentDir(),
			registry: registryWith(fakeSession()),
		});

		const answer = await render({ kind: "tool", toolName: "custom_tool", args: { path: "notes.txt" } });

		expect(answer.status).toBe(200);
		expect(answer.lines).toContain(EXTENSION_CALL);
	});

	test("draws the result of a tool call with the renderer of the extension", async () => {
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeAgentDir(),
			registry: registryWith(fakeSession()),
		});

		const answer = await render({
			kind: "tool",
			toolName: "custom_tool",
			args: { path: "notes.txt" },
			result: { content: [{ type: "text", text: "done" }], isError: false },
		});

		expect(answer.status).toBe(200);
		expect(answer.lines).toContain(EXTENSION_CALL);
		expect(answer.lines).toContain(EXTENSION_RESULT);
	});

	test("draws a tool without an extension renderer with the built-in renderer", async () => {
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeAgentDir(),
			registry: registryWith(fakeSession()),
		});

		const answer = await render({ kind: "tool", toolName: "read", args: { file_path: "notes.txt" } });

		expect(answer.status).toBe(200);
		expect(answer.lines.length).toBeGreaterThan(0);
		expect(answer.lines.join("\n")).toContain("notes.txt");
	});

	test("draws a custom message with the renderer of the extension", async () => {
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeAgentDir(),
			registry: registryWith(fakeSession()),
		});

		const answer = await render({
			kind: "message",
			customType: "custom_message",
			message: { role: "custom", customType: "custom_message", content: "hello", display: true, timestamp: 0 },
		});

		expect(answer.status).toBe(200);
		expect(answer.lines).toContain(EXTENSION_MESSAGE);
	});

	test("draws a custom entry with the renderer of the extension", async () => {
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeAgentDir(),
			registry: registryWith(fakeSession()),
		});

		const answer = await render({
			kind: "entry",
			customType: "custom_entry",
			entry: { type: "custom", customType: "custom_entry", data: {}, timestamp: 0 },
		});

		expect(answer.status).toBe(200);
		expect(answer.lines).toContain(EXTENSION_ENTRY);
	});

	test("answers with no lines when nothing can draw the piece", async () => {
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeAgentDir(),
			registry: registryWith(fakeSession()),
		});

		const answer = await render({ kind: "message", customType: "unknown_type", message: {} });

		expect(answer.status).toBe(200);
		expect(answer.lines).toEqual([]);
	});

	test("refuses a request it cannot understand", async () => {
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeAgentDir(),
			registry: registryWith(fakeSession()),
		});

		const answer = await render({ kind: "tool" });

		expect(answer.status).toBe(400);
	});

	test("answers an unknown session with an error", async () => {
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeAgentDir(),
			registry: registryWith(fakeSession()),
		});

		const response = await fetch(`${server.url}/pi/session/unknown/render`, {
			method: "POST",
			headers: {
				authorization: basicAuthHeader("test-password"),
				"content-type": "application/json",
			},
			body: JSON.stringify({ kind: "tool", toolName: "custom_tool", args: {} }),
		});

		expect(response.status).toBe(404);
	});
});
