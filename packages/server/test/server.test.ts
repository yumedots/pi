import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { basicAuthHeader } from "../src/auth.ts";
import { readRegistration } from "../src/registration.ts";
import { type PiServer, startRemoteTunnel, startServer } from "../src/server.ts";
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

/** What the tunnel command prints when it added a route. */
const TUNNEL_OUTPUT = '#!/bin/sh\necho "Added route pi → 127.0.0.1:4321"\necho "https://pi.example.opentunnel.xyz"\n';

function makeAgentDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-server-agent-"));
	tempDirs.push(dir);
	return dir;
}

/** The addresses of the machine that are not the loopback address. */
function lanAddresses(): string[] {
	const addresses: string[] = [];
	for (const [name, infos] of Object.entries(networkInterfaces())) {
		// The server skips the virtual interfaces: a phone cannot reach them.
		if (/^(docker|br-|bridge|veth|virbr|vmnet|vboxnet|utun|tun|tap|wg|zt)/i.test(name)) continue;
		for (const info of infos ?? []) {
			const isIpv4 = info.family === "IPv4" || String(info.family) === "4";
			if (!isIpv4 || info.internal) continue;
			addresses.push(info.address);
		}
	}
	return addresses;
}

/** The addresses the server advertises. */
async function advertisedUrls(): Promise<string[]> {
	const response = await fetch(`${server?.url}/api/info`, {
		headers: { authorization: basicAuthHeader("test-password") },
	});
	const body = (await response.json()) as { urls: string[] };
	return body.urls;
}

/**
 * Put a fake tunnel binary on the path.
 *
 * @returns The directory the binary lives in.
 */
function makeFakeTunnel(script: string): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-server-tunnel-"));
	tempDirs.push(dir);
	const binary = join(dir, "opentunnel");
	writeFileSync(binary, script, "utf8");
	chmodSync(binary, 0o755);
	return dir;
}

/**
 * Run something with a different path.
 */
async function withPath(path: string, run: () => Promise<void>): Promise<void> {
	const previous = process.env.PATH;
	process.env.PATH = path;
	try {
		await run();
	} finally {
		if (previous === undefined) delete process.env.PATH;
		else process.env.PATH = previous;
	}
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

describe("the addresses of the server", () => {
	test("advertises every address it listens on when it binds every interface", async () => {
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeAgentDir(),
			registry: emptyRegistry(),
			hostname: "0.0.0.0",
		});
		const port = server.port;
		const expected = [`http://127.0.0.1:${port}`, ...lanAddresses().map((address) => `http://${address}:${port}`)];
		expect(await advertisedUrls()).toEqual(expected);
		expect(server.url).toBe(`http://127.0.0.1:${port}`);
	});

	test("advertises only the loopback address when it binds the loopback address", async () => {
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeAgentDir(),
			registry: emptyRegistry(),
			hostname: "127.0.0.1",
		});
		expect(await advertisedUrls()).toEqual([`http://127.0.0.1:${server.port}`]);
	});

	test("writes the addresses into the registration file", async () => {
		const agentDir = makeAgentDir();
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir,
			registry: emptyRegistry(),
			hostname: "127.0.0.1",
		});
		const registration = readRegistration(agentDir);
		expect(registration?.urls).toEqual([`http://127.0.0.1:${server.port}`]);
	});
});

describe("the remote tunnel", () => {
	test("says what is missing when the tunnel binary is not installed", async () => {
		await withPath(makeAgentDir(), async () => {
			const result = await startRemoteTunnel({ port: 4321 });
			expect(result.ok).toBe(false);
			expect(result.reason).toContain("opentunnel");
		});
	});

	test("reports the url of the tunnel it opened", async () => {
		await withPath(makeFakeTunnel(TUNNEL_OUTPUT), async () => {
			const result = await startRemoteTunnel({ port: 4321 });
			expect(result.ok).toBe(true);
			expect(result.url).toBe("https://pi.example.opentunnel.xyz");
		});
	});

	test("reports why the tunnel command failed", async () => {
		await withPath(makeFakeTunnel('#!/bin/sh\necho "no tunnel for you" >&2\nexit 1\n'), async () => {
			const result = await startRemoteTunnel({ port: 4321 });
			expect(result.ok).toBe(false);
			expect(result.reason).toContain("no tunnel for you");
		});
	});

	test("adds the tunnel url to the addresses of the server", async () => {
		await withPath(makeFakeTunnel(TUNNEL_OUTPUT), async () => {
			server = await startServer({
				port: 0,
				password: "test-password",
				agentDir: makeAgentDir(),
				registry: emptyRegistry(),
				hostname: "127.0.0.1",
				remote: true,
			});
			expect(server.tunnel?.ok).toBe(true);
			expect(await advertisedUrls()).toContain("https://pi.example.opentunnel.xyz");
		});
	});

	test("starts without a tunnel when the tunnel binary is missing", async () => {
		await withPath(makeAgentDir(), async () => {
			server = await startServer({
				port: 0,
				password: "test-password",
				agentDir: makeAgentDir(),
				registry: emptyRegistry(),
				hostname: "127.0.0.1",
				remote: true,
			});
			expect(server.tunnel?.ok).toBe(false);
			expect(server.tunnel?.reason).toContain("opentunnel");
			expect(await advertisedUrls()).toEqual([`http://127.0.0.1:${server.port}`]);
		});
	});
});
