import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentSession, SettingsManager } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager } from "@earendil-works/pi-coding-agent/core/keybindings";
import { afterEach, describe, expect, test } from "vitest";
import { basicAuthHeader } from "../src/auth.ts";
import { buildManifest, type PiManifest } from "../src/manifest.ts";
import { type PiServer, startServer } from "../src/server.ts";
import type { ServerSession, SessionRegistry } from "../src/session-registry.ts";
import type { ServerHandshake } from "../src/types.ts";

/** An extension the fake session loaded. */
interface FakeExtension {
	path: string;
	resolvedPath: string;
	side: "client" | "server" | "both";
}

/** The digest the manifest carries for a file. */
function digestOf(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12);
}

/**
 * A session with the state the manifest reads.
 */
function fakeSession(
	options: {
		extensions?: FakeExtension[];
		commands?: Array<{ invocationName: string; description?: string }>;
		settings?: Parameters<typeof SettingsManager.inMemory>[0];
	} = {},
): AgentSession {
	const extensions = options.extensions ?? [];
	const agentSession = {
		settingsManager: SettingsManager.inMemory(options.settings ?? {}),
		extensionRunner: {
			getRegisteredCommands: () => options.commands ?? [],
		},
		resourceLoader: {
			getExtensionsBySide: (side: "client" | "server") =>
				extensions.filter((extension) => extension.side === side || extension.side === "both"),
			getExtensions: () => ({ extensions, errors: [], runtime: {} }),
			getThemes: () => ({ themes: [], diagnostics: [] }),
		},
	};
	return agentSession as unknown as AgentSession;
}

/**
 * A server session that holds the fake session.
 */
function fakeServerSession(session: AgentSession, id = "session-1"): ServerSession {
	return {
		id,
		cwd: "/tmp/project",
		runtime: { session },
		controller: {},
		sessionFile: undefined,
		busy: false,
	} as unknown as ServerSession;
}

/**
 * A registry that knows the one session of the test.
 */
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

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-server-manifest-"));
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

describe("the manifest of a session", () => {
	test("lists the extensions with their side and the digest of the file", () => {
		const dir = makeTempDir();
		const file = join(dir, "demo-extension.ts");
		writeFileSync(file, "export default () => {};\n", "utf8");
		const session = fakeSession({ extensions: [{ path: file, resolvedPath: file, side: "both" }] });

		const manifest = buildManifest({
			version: "1.3.0",
			cwd: dir,
			session,
			settingsManager: session.settingsManager,
		});

		expect(manifest.extensions).toEqual([{ path: file, side: "both", hash: digestOf(file) }]);
		expect(manifest.extensions[0]?.hash).toHaveLength(12);
	});

	test("changes the digest of an extension when the file changes", () => {
		const dir = makeTempDir();
		const file = join(dir, "demo-extension.ts");
		writeFileSync(file, "export default () => {};\n", "utf8");
		const session = fakeSession({ extensions: [{ path: file, resolvedPath: file, side: "server" }] });
		const build = () =>
			buildManifest({ version: "1.3.0", cwd: dir, session, settingsManager: session.settingsManager });

		const before = build();
		writeFileSync(file, "export default () => {\n\tconsole.log('changed');\n};\n", "utf8");
		const after = build();

		expect(after.extensions[0]?.hash).not.toBe(before.extensions[0]?.hash);
		expect(after.extensions[0]?.hash).toBe(digestOf(file));
	});

	test("lists the extensions of every side, with the side they declare", () => {
		const dir = makeTempDir();
		const clientFile = join(dir, "client-extension.ts");
		const serverFile = join(dir, "server-extension.ts");
		writeFileSync(clientFile, "export default () => {};\n", "utf8");
		writeFileSync(serverFile, "export default () => {};\n", "utf8");
		const session = fakeSession({
			extensions: [
				{ path: clientFile, resolvedPath: clientFile, side: "client" },
				{ path: serverFile, resolvedPath: serverFile, side: "server" },
			],
		});

		const manifest = buildManifest({
			version: "1.3.0",
			cwd: dir,
			session,
			settingsManager: session.settingsManager,
		});

		expect(manifest.extensions.map((extension) => extension.side)).toEqual(["client", "server"]);
	});

	test("fills in the theme, the settings, the commands and the keybindings", () => {
		const dir = makeTempDir();
		const session = fakeSession({
			commands: [{ invocationName: "demo", description: "A command of an extension" }],
			settings: { theme: "dark", defaultProvider: "anthropic" },
		});
		const keybindings = new KeybindingsManager({ "app.quit": "ctrl+q" });

		const manifest = buildManifest({
			version: "1.3.0",
			cwd: dir,
			session,
			settingsManager: session.settingsManager,
			keybindings,
		});

		expect(manifest.version).toBe("1.3.0");
		expect(manifest.cwd).toBe(dir);
		expect(manifest.theme.name).toBe("dark");
		expect(manifest.theme.json).toMatchObject({ name: "dark" });
		expect(manifest.settings.theme).toBe("dark");
		expect(manifest.settings.defaultProvider).toBe("anthropic");
		expect(manifest.commands.map((command) => command.name)).toContain("settings");
		expect(manifest.commands).toContainEqual({ name: "demo", description: "A command of an extension" });
		expect(manifest.keybindings["app.quit"]).toEqual(["ctrl+q"]);
		expect(manifest.keybindings["app.interrupt"]).toEqual(["escape"]);
	});
});

describe("the manifest route", () => {
	test("answers with the manifest of the session", async () => {
		const dir = makeTempDir();
		const file = join(dir, "demo-extension.ts");
		writeFileSync(file, "export default () => {};\n", "utf8");
		const session = fakeSession({
			extensions: [{ path: file, resolvedPath: file, side: "both" }],
			settings: { theme: "dark" },
		});
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeTempDir(),
			registry: registryWith(fakeServerSession(session)),
		});

		const response = await fetch(`${server.url}/pi/session/session-1/manifest`, {
			headers: { authorization: basicAuthHeader("test-password") },
		});

		expect(response.status).toBe(200);
		const body = (await response.json()) as { data: PiManifest };
		expect(body.data.extensions).toEqual([{ path: file, side: "both", hash: digestOf(file) }]);
		expect(body.data.theme.name).toBe("dark");
		expect(body.data.commands.map((command) => command.name)).toContain("quit");
		expect(body.data.keybindings["app.quit"]).toEqual(["ctrl+c"]);
	});

	test("answers with the manifest of the session on the other route too", async () => {
		const session = fakeSession({ settings: { theme: "dark" } });
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeTempDir(),
			registry: registryWith(fakeServerSession(session)),
		});

		const response = await fetch(`${server.url}/pi/manifest/session-1`, {
			headers: { authorization: basicAuthHeader("test-password") },
		});

		expect(response.status).toBe(200);
		const body = (await response.json()) as { data: PiManifest };
		expect(body.data.theme.name).toBe("dark");
	});

	test("answers with the manifest of the session named in the query", async () => {
		const session = fakeSession({ settings: { theme: "dark" } });
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeTempDir(),
			registry: registryWith(fakeServerSession(session)),
		});

		const response = await fetch(`${server.url}/pi/manifest?session=session-1`, {
			headers: { authorization: basicAuthHeader("test-password") },
		});

		expect(response.status).toBe(200);
		const body = (await response.json()) as { data: PiManifest };
		expect(body.data.theme.name).toBe("dark");
	});

	test("answers an unknown session with an error", async () => {
		const session = fakeSession();
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeTempDir(),
			registry: registryWith(fakeServerSession(session)),
		});

		const response = await fetch(`${server.url}/pi/manifest/unknown`, {
			headers: { authorization: basicAuthHeader("test-password") },
		});

		expect(response.status).toBe(404);
		const body = (await response.json()) as { _tag: string; message: string };
		expect(body._tag).toBe("NotFoundError");
	});
});

describe("the handshake of the server", () => {
	test("names the directory the server works in", async () => {
		const cwd = makeTempDir();
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeTempDir(),
			cwd,
			registry: registryWith(fakeServerSession(fakeSession())),
		});

		const response = await fetch(`${server.url}/pi/server`, {
			headers: { authorization: basicAuthHeader("test-password") },
		});

		expect(response.status).toBe(200);
		const body = (await response.json()) as { data: ServerHandshake };
		expect(body.data.cwd).toBe(cwd);
		expect(body.data.trust.required).toBe(false);
		expect(body.data.trust.decided).toBe(false);
		expect(body.data.trust.trusted).toBe(false);
	});

	test("says that the project needs a trust decision", async () => {
		const cwd = makeTempDir();
		mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeTempDir(),
			cwd,
			registry: registryWith(fakeServerSession(fakeSession())),
		});

		const response = await fetch(`${server.url}/pi/server`, {
			headers: { authorization: basicAuthHeader("test-password") },
		});

		const body = (await response.json()) as { data: ServerHandshake };
		expect(body.data.trust.required).toBe(true);
		expect(body.data.trust.decided).toBe(false);
	});
});

describe("the trust decision", () => {
	test("is stored in the trust store of the server", async () => {
		const cwd = makeTempDir();
		const agentDir = makeTempDir();
		mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir,
			cwd,
			registry: registryWith(fakeServerSession(fakeSession())),
		});

		const decision = await fetch(`${server.url}/pi/trust`, {
			method: "POST",
			headers: {
				authorization: basicAuthHeader("test-password"),
				"content-type": "application/json",
			},
			body: JSON.stringify({ cwd, trusted: true }),
		});

		expect(decision.status).toBe(200);
		expect(await decision.json()).toEqual({ ok: true });

		const handshake = await fetch(`${server.url}/pi/server`, {
			headers: { authorization: basicAuthHeader("test-password") },
		});
		const body = (await handshake.json()) as { data: ServerHandshake };
		expect(body.data.trust.decided).toBe(true);
		expect(body.data.trust.trusted).toBe(true);
	});

	test("is refused when it is not a decision", async () => {
		const cwd = makeTempDir();
		server = await startServer({
			port: 0,
			password: "test-password",
			agentDir: makeTempDir(),
			cwd,
			registry: registryWith(fakeServerSession(fakeSession())),
		});

		const decision = await fetch(`${server.url}/pi/trust`, {
			method: "POST",
			headers: {
				authorization: basicAuthHeader("test-password"),
				"content-type": "application/json",
			},
			body: JSON.stringify({ cwd }),
		});

		expect(decision.status).toBe(400);
		const body = (await decision.json()) as { _tag: string };
		expect(body._tag).toBe("BadRequestError");
	});
});
