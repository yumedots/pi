/**
 * The end-to-end test of the client and the server.
 *
 * The test drives the whole path of a pi client: a real server hosts a real session, the
 * client reaches it over HTTP and SSE, a command travels over the wire, the session state
 * comes back, and the server releases everything when it shuts down.
 *
 * The test needs no network, no API key and no model: the session never runs a turn.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "@earendil-works/pi-coding-agent";
import { basicAuthHeader, type PiServer, startServer } from "@earendil-works/pi-server";
import { PiServerClient } from "@earendil-works/pi-server/client";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { RemoteSessionFacade } from "../src/remote-facade.ts";

/** The environment variable that moves the agent directory, and with it the sessions. */
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/** The password both sides of the test use. */
const PASSWORD = "end-to-end";

const servers: PiServer[] = [];
const tempDirs: string[] = [];
const previousAgentDir = process.env[AGENT_DIR_ENV];

/**
 * A temporary directory that is removed when the test ends.
 */
function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

/**
 * A runtime factory that builds a real session, without needing a model.
 *
 * The session never runs a turn, so it never needs credentials.
 */
const realRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, agentDir, sessionManager }) => {
	// A session file is only written once the session has content. The message is
	// appended before the session starts, so the session restores it.
	sessionManager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
	const services = await createAgentSessionServices({ cwd, agentDir });
	const created = await createAgentSessionFromServices({ services, sessionManager });
	return { ...created, services, diagnostics: [] };
};

/**
 * Wait for a promise, but not forever.
 *
 * The timeout is a safety net, not a fixed wait: the test awaits the real event. Fake
 * timers cannot be used here, because the server's HTTP and SSE stack and the client SDK
 * schedule real timers of their own.
 */
async function withTimeout<T>(promise: Promise<T>, description: string, timeoutMs = 10_000): Promise<T> {
	const { promise: guard, reject } = Promise.withResolvers<never>();
	const timer = setTimeout(
		() => reject(new Error(`Timed out after ${timeoutMs} ms waiting for ${description}`)),
		timeoutMs,
	);
	try {
		return await Promise.race([promise, guard]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Open a session on the server through its HTTP surface.
 */
async function openSession(server: PiServer, cwd: string): Promise<string> {
	const response = await fetch(`${server.url}/pi/session`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: basicAuthHeader(PASSWORD) },
		body: JSON.stringify({ cwd }),
	});
	if (!response.ok) {
		throw new Error(`The server refused to open the session: ${await response.text()}`);
	}
	const body = (await response.json()) as { data: { sessionId: string } };
	return body.data.sessionId;
}

afterEach(async () => {
	for (const server of servers.splice(0)) {
		await server.close();
	}
});

afterAll(() => {
	if (previousAgentDir === undefined) {
		delete process.env[AGENT_DIR_ENV];
	} else {
		process.env[AGENT_DIR_ENV] = previousAgentDir;
	}
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("the client and the server", () => {
	test("the facade drives a session that the server hosts, and the server shuts down", async () => {
		const agentDir = makeTempDir("pi-e2e-agent-");
		const cwd = makeTempDir("pi-e2e-cwd-");
		process.env[AGENT_DIR_ENV] = agentDir;
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "always" }));

		// 1. A real server with a real runtime.
		const server = await startServer({
			port: 0,
			password: PASSWORD,
			agentDir,
			cwd,
			createRuntime: realRuntime,
			idleTimeoutMs: 0,
		});
		servers.push(server);
		expect(server.port).toBeGreaterThan(0);

		// 2. A session that the server hosts.
		const sessionId = await openSession(server, cwd);
		expect(sessionId).toEqual(expect.any(String));

		const hosted = server.registry.get(sessionId);
		expect(hosted).toBeDefined();
		expect(hosted?.runtime.session.sessionId).toBe(sessionId);
		expect(hosted?.busy).toBe(false);

		// 3. The client and the facade.
		const client = new PiServerClient({ url: server.url, password: PASSWORD });
		const facade = new RemoteSessionFacade(client, sessionId, cwd, { agentDir });

		// The subscription is registered before the first await, so no frame of the
		// event stream can be missed.
		const events: AgentSessionEvent[] = [];
		const { promise: firstFrame, resolve: resolveFirstFrame } = Promise.withResolvers<void>();
		const { promise: renamed, resolve: resolveRenamed } = Promise.withResolvers<void>();
		const unsubscribe = facade.subscribe((event) => {
			events.push(event);
			resolveFirstFrame();
			if (event.type === "session_info_changed") resolveRenamed();
		});

		await facade.load();

		// The stream is live: the server opened it and sent its first frame.
		await withTimeout(firstFrame, "the event stream to open");

		// 4. The facade sees the state of the server.
		const state = await client.getSessionState(sessionId);
		expect(state.sessionId).toBe(sessionId);
		expect(state.cwd).toBe(cwd);
		expect(state.isStreaming).toBe(false);
		expect(state.isIdle).toBe(true);

		expect(facade.sessionId).toBe(state.sessionId);
		expect(facade.sessionManager.getCwd()).toBe(state.cwd);
		expect(facade.sessionManager.getSessionId()).toBe(state.sessionId);
		expect(facade.isStreaming).toBe(false);
		expect(facade.isIdle).toBe(true);
		expect(facade.sessionFile).toBe(state.sessionFile);
		expect(facade.getSteeringMessages()).toEqual(state.queue.steering);
		expect(facade.getFollowUpMessages()).toEqual(state.queue.followUp);
		expect(facade.getSteeringMessages()).toEqual([]);
		expect(facade.getFollowUpMessages()).toEqual([]);

		// The transcript comes from the server as well.
		const serverMessages = (await (
			await fetch(`${server.url}/pi/session/${encodeURIComponent(sessionId)}/messages`, {
				headers: { authorization: basicAuthHeader(PASSWORD) },
			})
		).json()) as { data: Array<{ role: string }> };
		expect(facade.messages.length).toBe(serverMessages.data.length);
		expect(facade.messages.length).toBeGreaterThan(0);
		expect(facade.messages[0]?.role).toBe("user");

		// The session file lives on the disk of the server, not of the client.
		expect(state.sessionFile).toBeDefined();
		expect(existsSync(state.sessionFile as string)).toBe(true);
		expect(state.sessionFile?.startsWith(agentDir)).toBe(true);

		// 5. A command over the wire.
		await facade.setSessionName("End to end session");

		const serverState = await client.sendCommand(sessionId, { id: "state-1", type: "get_state" });
		expect(serverState.success).toBe(true);
		if (!serverState.success || serverState.command !== "get_state") {
			throw new Error(`The server rejected the state command: ${JSON.stringify(serverState)}`);
		}
		expect(serverState.data.sessionName).toBe("End to end session");
		expect(serverState.data.sessionId).toBe(sessionId);
		expect(serverState.data.isStreaming).toBe(false);

		// The server applied the command, and the facade sees it.
		expect(server.registry.get(sessionId)?.runtime.session.sessionName).toBe("End to end session");
		await withTimeout(renamed, "the session_info_changed event");
		expect(facade.sessionManager.getSessionName()).toBe("End to end session");

		// 6. The event stream carried the event of the command.
		const changed = events.find((event) => event.type === "session_info_changed");
		expect(changed?.type === "session_info_changed" ? changed.name : undefined).toBe("End to end session");
		unsubscribe();

		// 7. The client and the server shut down.
		facade.dispose();
		await server.close();
		servers.splice(servers.indexOf(server), 1);

		expect(server.registry.sessions.size).toBe(0);
		await expect(fetch(`${server.url}/api/info`)).rejects.toThrow();
	});
});
