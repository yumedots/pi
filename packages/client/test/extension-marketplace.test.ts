/**
 * The extensions of the marketplace, through the server.
 *
 * The extensions live in the server: it loads them and it draws what they draw. The client
 * is a renderer, so the same client shows the session of every server, and the extensions
 * of that server decide what it shows.
 *
 * The extensions here are the real ones of `packages/coding-agent/examples/extensions`. The
 * test copies them into the agent directory of a server, drives them and checks that the
 * client draws what the server drew.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import { stripAnsi } from "../src/client-support/ansi.ts";
import { ManifestMismatchError } from "../src/manifest-check.ts";

/** The environment variable that moves the agent directory, and with it the sessions. */
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/** The password the client and the server share. */
const PASSWORD = "extension-marketplace";

/** The examples of the coding agent: the extensions pi ships. */
const EXAMPLES = join(import.meta.dirname, "../../coding-agent/examples/extensions");

/** The extensions the test installs. */
const MARKETPLACE_EXTENSIONS = ["message-renderer.ts", "entry-renderer.ts", "custom-header.ts", "widget-placement.ts"];

const servers: PiServer[] = [];
const tempDirs: string[] = [];

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
 */
const realRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, agentDir, sessionManager }) => {
	const services = await createAgentSessionServices({ cwd, agentDir });
	const created = await createAgentSessionFromServices({ services, sessionManager });
	return { ...created, services, diagnostics: [] };
};

/**
 * Copy the real extensions into the agent directory of a server.
 */
function installExtensions(agentDir: string, names: readonly string[]): string[] {
	const dir = join(agentDir, "extensions");
	mkdirSync(dir, { recursive: true });
	const paths: string[] = [];
	for (const name of names) {
		const target = join(dir, name);
		cpSync(join(EXAMPLES, name), target);
		paths.push(target);
	}
	return paths;
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
 * A client of the server, and the session it opened.
 */
async function openSession(server: PiServer, cwd: string): Promise<{ client: PiServerClient; sessionId: string }> {
	const client = new PiServerClient({ url: server.url, password: PASSWORD });
	const snapshot = await client.openSession({ cwd });
	return { client, sessionId: snapshot.sessionId };
}

/**
 * The manifest of a session of the server.
 */
async function manifestOf(client: PiServerClient, sessionId: string): Promise<PiManifest> {
	return client.manifest(sessionId);
}

afterEach(() => {
	process.env[AGENT_DIR_ENV] = undefined;
});

afterAll(async () => {
	for (const server of servers.splice(0)) {
		await server.close();
	}
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("the extensions of the marketplace", () => {
	test("the server loads the real extensions and the client accepts them", async () => {
		const agentDir = makeTempDir("pi-marketplace-agent-");
		const cwd = makeTempDir("pi-marketplace-project-");
		const installed = installExtensions(agentDir, MARKETPLACE_EXTENSIONS);
		const server = await startTestServer(agentDir, cwd);
		const { client, sessionId } = await openSession(server, cwd);

		const manifest = await manifestOf(client, sessionId);

		const paths = manifest.extensions.map((extension) => extension.path);
		for (const path of installed) {
			expect(paths).toContain(path);
		}
		expect(manifest.extensions.every((extension) => extension.hash.length === 12)).toBe(true);

		const state = new ClientState({ manifest, agentDir });
		expect(() => state.assertExtensionsMatch()).not.toThrow();
	});

	test("the client refuses a server whose client-side extensions it does not have", async () => {
		const agentDir = makeTempDir("pi-marketplace-agent-");
		const cwd = makeTempDir("pi-marketplace-project-");
		const extensionsDir = join(agentDir, "extensions");
		mkdirSync(extensionsDir, { recursive: true });
		writeFileSync(
			join(extensionsDir, "client-side.ts"),
			`export default function (pi) {\n\tpi.setSide("client");\n}\n`,
		);
		const server = await startTestServer(agentDir, cwd);
		const { client, sessionId } = await openSession(server, cwd);

		const manifest = await manifestOf(client, sessionId);

		// The client has no extension file of its own: the server declares one for the
		// client side, so the two sides do not match.
		const emptyAgentDir = makeTempDir("pi-marketplace-client-");
		const state = new ClientState({ manifest, agentDir: emptyAgentDir });
		expect(() => state.assertExtensionsMatch()).toThrow(ManifestMismatchError);
	});

	test("the client refuses when it has an extension the server does not know", async () => {
		const agentDir = makeTempDir("pi-marketplace-agent-");
		const cwd = makeTempDir("pi-marketplace-project-");
		const server = await startTestServer(agentDir, cwd);
		const { client, sessionId } = await openSession(server, cwd);

		const manifest = await manifestOf(client, sessionId);

		const clientAgentDir = makeTempDir("pi-marketplace-client-");
		const extensionsDir = join(clientAgentDir, "extensions");
		mkdirSync(extensionsDir, { recursive: true });
		writeFileSync(join(extensionsDir, "stranger.ts"), `export default function (pi) {}\n`);

		const state = new ClientState({ manifest, agentDir: clientAgentDir });
		expect(() => state.assertExtensionsMatch()).toThrow(ManifestMismatchError);
	});

	test("the server draws the custom message of a real extension", async () => {
		const agentDir = makeTempDir("pi-marketplace-agent-");
		const cwd = makeTempDir("pi-marketplace-project-");
		installExtensions(agentDir, ["message-renderer.ts"]);
		const server = await startTestServer(agentDir, cwd);
		const { client, sessionId } = await openSession(server, cwd);

		await client.sendCommand(sessionId, { type: "prompt", message: "/status warn the server drew this" });

		const messages = await client.messages(sessionId);
		const custom = messages.find(
			(message): message is { role: "custom"; customType: string; content: unknown } =>
				typeof message === "object" && message !== null && "role" in message && message.role === "custom",
		);
		expect(custom).toBeDefined();

		const rendered = await client.render(sessionId, {
			kind: "message",
			customType: custom?.customType ?? "",
			message: custom,
		});
		const text = stripAnsi(rendered.lines.join("\n"));
		expect(text).toContain("[WARN]");
		expect(text).toContain("the server drew this");
	});

	test("the server draws the custom header of a real extension", async () => {
		const agentDir = makeTempDir("pi-marketplace-agent-");
		const cwd = makeTempDir("pi-marketplace-project-");
		installExtensions(agentDir, ["custom-header.ts"]);
		const server = await startTestServer(agentDir, cwd);
		const { client, sessionId } = await openSession(server, cwd);

		const rendered = await client.render(sessionId, { kind: "header" });
		const text = stripAnsi(rendered.lines.join("\n"));
		expect(text).toContain("shitty coding agent");
	});

	test("the widget of a real extension reaches the client", async () => {
		const agentDir = makeTempDir("pi-marketplace-agent-");
		const cwd = makeTempDir("pi-marketplace-project-");
		installExtensions(agentDir, ["widget-placement.ts"]);
		const server = await startTestServer(agentDir, cwd);
		const { client, sessionId } = await openSession(server, cwd);

		const widgets = await client.extensionWidgets(sessionId);
		expect(widgets.map((widget) => widget.lines.join(""))).toContain("Above editor widget");
	});
});
