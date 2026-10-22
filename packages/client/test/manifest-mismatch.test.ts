/**
 * The client refuses to start against a server it does not match.
 *
 * The server publishes the extensions it loaded in its manifest; the client knows the
 * extension files it has on its own disk. When the two do not match, the client says so
 * and does not start the terminal UI: a client that draws half of a session is worse
 * than a client that says what is missing.
 *
 * The three situations are built with a real server: the manifest comes from the server
 * itself, and the refusal comes from the module the client uses.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "@earendil-works/pi-coding-agent";
import { type PiServer, startServer } from "@earendil-works/pi-server";
import { type PiManifest, PiServerClient } from "@earendil-works/pi-server/client";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { ClientState } from "../src/client-state.ts";
import { ManifestMismatchError } from "../src/manifest-check.ts";

/** The environment variable that moves the agent directory, and with it the sessions. */
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/** The password the client and the server share. */
const PASSWORD = "manifest-mismatch";

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
	sessionManager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
	const services = await createAgentSessionServices({ cwd, agentDir });
	const created = await createAgentSessionFromServices({ services, sessionManager });
	return { ...created, services, diagnostics: [] };
};

/**
 * Write an extension into the extensions directory of an agent directory.
 *
 * @returns The path of the extension file.
 */
function writeExtension(agentDir: string, name: string, side: "client" | "server" | "both"): string {
	const dir = join(agentDir, "extensions");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${name}.ts`);
	writeFileSync(path, `export default function (pi) {\n\tpi.setSide("${side}");\n}\n`);
	return path;
}

/**
 * Start a server that runs in the given directories.
 */
async function startTestServer(agentDir: string, cwd: string): Promise<PiServer> {
	process.env[AGENT_DIR_ENV] = agentDir;
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "always" }));
	const server = await startServer({
		port: 0,
		password: PASSWORD,
		agentDir,
		cwd,
		createRuntime: realRuntime,
		idleTimeoutMs: 0,
	});
	servers.push(server);
	return server;
}

/**
 * The manifest of a session of the server.
 */
async function manifestOf(server: PiServer, cwd: string): Promise<PiManifest> {
	const client = new PiServerClient({ url: server.url, password: PASSWORD });
	const snapshot = await client.openSession({ cwd });
	return client.manifest(snapshot.sessionId);
}

/**
 * The refusal of the client, when it refuses.
 */
function refusal(state: ClientState): ManifestMismatchError {
	try {
		state.assertExtensionsMatch();
	} catch (error) {
		if (error instanceof ManifestMismatchError) return error;
		throw error;
	}
	throw new Error("The client started against a server it does not match.");
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

describe("the client and a server it does not match", () => {
	test("the server has a client-side extension the client does not have", async () => {
		const serverAgentDir = makeTempDir("pi-manifest-server-");
		const clientAgentDir = makeTempDir("pi-manifest-client-");
		const cwd = makeTempDir("pi-manifest-cwd-");
		const extensionPath = writeExtension(serverAgentDir, "render-only", "client");

		const server = await startTestServer(serverAgentDir, cwd);
		const manifest = await manifestOf(server, cwd);

		expect(manifest.extensions.map((extension) => extension.path)).toContain(extensionPath);

		const state = new ClientState({ manifest, agentDir: clientAgentDir });
		const error = refusal(state);

		const hash = error.mismatches[0]?.server?.hash ?? "";
		expect(hash).not.toBe("");
		expect(error.mismatches.map((mismatch) => mismatch.kind)).toEqual(["server-only"]);
		expect(error.mismatches[0]?.server?.side).toBe("client");
		expect(error.message).toContain("This client does not match the server.");
		expect(error.message).toContain(extensionPath);
		expect(error.message).toContain(`(client, ${hash})`);
	});

	test("the client has an extension the server does not know", async () => {
		const serverAgentDir = makeTempDir("pi-manifest-server-");
		const clientAgentDir = makeTempDir("pi-manifest-client-");
		const cwd = makeTempDir("pi-manifest-cwd-");
		const extensionPath = writeExtension(clientAgentDir, "extra", "client");

		const server = await startTestServer(serverAgentDir, cwd);
		const manifest = await manifestOf(server, cwd);

		const state = new ClientState({ manifest, agentDir: clientAgentDir });
		const error = refusal(state);

		const hash = error.mismatches[0]?.client?.hash ?? "";
		expect(hash).not.toBe("");
		expect(error.mismatches.map((mismatch) => mismatch.kind)).toEqual(["client-only"]);
		expect(error.message).toContain("This client does not match the server.");
		expect(error.message).toContain(extensionPath);
		expect(error.message).toContain(`(client, ${hash})`);
	});

	test("a matched pair starts", async () => {
		const agentDir = makeTempDir("pi-manifest-agent-");
		const cwd = makeTempDir("pi-manifest-cwd-");
		const extensionPath = writeExtension(agentDir, "render-only", "client");

		const server = await startTestServer(agentDir, cwd);
		const manifest = await manifestOf(server, cwd);

		expect(manifest.extensions.map((extension) => extension.path)).toContain(extensionPath);

		const state = new ClientState({ manifest, agentDir });
		expect(() => state.assertExtensionsMatch()).not.toThrow();
		expect(state.cwd).toBe(cwd);
		expect(() => state.installTheme()).not.toThrow();
	});
});
