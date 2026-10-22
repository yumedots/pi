import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "@earendil-works/pi-coding-agent";
import { basicAuthHeader, type PiServer, startServer } from "@earendil-works/pi-server";
import { PiServerClient } from "@earendil-works/pi-server/client";
import { afterAll, afterEach, describe, expect, test } from "vitest";

/** The environment variable that moves the agent directory, and with it the sessions. */
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

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
 * A runtime factory that works: it builds a real session without needing a model.
 */
const workingRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, agentDir, sessionManager }) => {
	const services = await createAgentSessionServices({ cwd, agentDir });
	const created = await createAgentSessionFromServices({ services, sessionManager });
	// A session file is only written once the session has content.
	sessionManager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
	return { ...created, services, diagnostics: [] };
};

/**
 * A runtime factory that refuses: no session may be opened.
 */
const refusingRuntime: CreateAgentSessionRuntimeFactory = async () => {
	throw new Error("this server has no runtime factory");
};

/**
 * Open a session on the server.
 */
async function openSession(server: PiServer, cwd: string, password: string): Promise<string> {
	const response = await fetch(`${server.url}/pi/session`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: basicAuthHeader(password) },
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

describe("the client and an embedded server", () => {
	test("the server answers /api/info and the client lists the sessions", async () => {
		const agentDir = makeTempDir("pi-client-agent-");
		process.env[AGENT_DIR_ENV] = agentDir;
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "always" }));

		const server = await startServer({
			port: 0,
			password: "test",
			agentDir,
			createRuntime: refusingRuntime,
		});
		servers.push(server);

		const response = await fetch(`${server.url}/api/info`, {
			headers: { authorization: basicAuthHeader("test") },
		});
		expect(response.status).toBe(200);
		const info = (await response.json()) as { version: string; pid: number; urls: string[] };
		expect(info.version).toBe("1.3.0");
		expect(info.pid).toBe(process.pid);
		expect(info.urls[0]).toBe(server.url);

		const client = new PiServerClient({ url: server.url, password: "test" });
		const sessions = await client.listSessions();
		expect(Array.isArray(sessions)).toBe(true);
		expect(sessions).toEqual([]);
	});

	test("a session opened on the server shows up in the session list", async () => {
		const agentDir = makeTempDir("pi-client-agent-");
		const cwd = makeTempDir("pi-client-cwd-");
		process.env[AGENT_DIR_ENV] = agentDir;
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "always" }));

		const server = await startServer({
			port: 0,
			password: "test",
			agentDir,
			createRuntime: workingRuntime,
		});
		servers.push(server);

		const client = new PiServerClient({ url: server.url, password: "test" });
		const sessionId = await openSession(server, cwd, "test");
		expect(sessionId).toEqual(expect.any(String));

		const state = await client.getSessionState(sessionId);
		expect(state.sessionId).toBe(sessionId);
		expect(state.cwd).toBe(cwd);

		const named = await client.sendCommand(sessionId, { id: "name-1", type: "set_session_name", name: "Smoke test" });
		expect(named.success).toBe(true);

		const sessions = await client.listSessions(cwd);
		expect(sessions.map((session) => session.id)).toContain(sessionId);
	});
});
