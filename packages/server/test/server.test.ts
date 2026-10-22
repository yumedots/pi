import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { basicAuthHeader } from "../src/auth.ts";
import { readRegistration } from "../src/registration.ts";
import { type PiServer, startServer } from "../src/server.ts";
import type { SessionRegistry } from "../src/session-registry.ts";

/** A registry without sessions, so the test does not need a runtime. */
function emptyRegistry(): SessionRegistry {
	return {
		sessions: new Map(),
		list: async () => [],
		get: () => undefined,
		close: async () => {},
		closeAll: async () => {},
	} as unknown as SessionRegistry;
}

let server: PiServer | undefined;
const tempDirs: string[] = [];

function makeAgentDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-server-agent-"));
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

describe("the server", () => {
	test("answers /api/info with the version, the pid and the urls", async () => {
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeAgentDir(),
			registry: emptyRegistry(),
		});
		const response = await fetch(`${server.url}/api/info`, {
			headers: { authorization: basicAuthHeader("test-password") },
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as { version: string; pid: number; urls: string[] };
		expect(body.version).toBe("1.3.0");
		expect(body.pid).toBe(process.pid);
		expect(body.urls[0]).toBe(server.url);
	});

	test("answers /api/session with the session list", async () => {
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeAgentDir(),
			registry: emptyRegistry(),
		});
		const response = await fetch(`${server.url}/api/session`, {
			headers: { authorization: basicAuthHeader("test-password") },
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as { data: unknown[] };
		expect(body.data).toEqual([]);
	});

	test("refuses requests without credentials", async () => {
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeAgentDir(),
			registry: emptyRegistry(),
		});
		const response = await fetch(`${server.url}/api/info`);
		expect(response.status).toBe(401);
	});

	test("binds a free port when the port is 0", async () => {
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeAgentDir(),
			registry: emptyRegistry(),
		});
		expect(server.port).toBeGreaterThan(0);
	});

	test("writes the registration file and removes it on close", async () => {
		const agentDir = makeAgentDir();
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir,
			registry: emptyRegistry(),
		});
		const registration = readRegistration(agentDir);
		expect(registration?.url).toBe(server.url);
		expect(registration?.password).toBe("test-password");
		await server.close();
		server = undefined;
		expect(readRegistration(agentDir)).toBeUndefined();
	});

	test("issues a pairing token that authenticates the client", async () => {
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeAgentDir(),
			registry: emptyRegistry(),
		});
		const pair = await fetch(`${server.url}/api/pair`, { method: "POST" });
		const { code } = (await pair.json()) as { code: string };
		expect(code).toEqual(expect.any(String));

		const connect = await fetch(`${server.url}/auth/connect/${code}`);
		const { token } = (await connect.json()) as { token: string };
		expect(token).not.toBe("test-password");

		const withToken = await fetch(`${server.url}/api/info`, {
			headers: { authorization: basicAuthHeader(token) },
		});
		expect(withToken.status).toBe(200);

		const withPassword = await fetch(`${server.url}/api/info`, {
			headers: { authorization: basicAuthHeader("test-password") },
		});
		expect(withPassword.status).toBe(200);

		const withWrong = await fetch(`${server.url}/api/info`, {
			headers: { authorization: basicAuthHeader("wrong") },
		});
		expect(withWrong.status).toBe(401);
	});

	test("refuses an expired pairing code", async () => {
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeAgentDir(),
			registry: emptyRegistry(),
		});
		const pair = await fetch(`${server.url}/api/pair`, { method: "POST" });
		const { code } = (await pair.json()) as { code: string };
		const connect = await fetch(`${server.url}/auth/connect/${code}`);
		expect(connect.status).toBe(200);
		const again = await fetch(`${server.url}/auth/connect/${code}`);
		expect(again.status).toBe(404);
	});
});
