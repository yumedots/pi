/**
 * The opencode surface the opencode iOS app depends on, driven over real HTTP.
 *
 * The app points at a pi server, so every route it calls has to answer with the
 * opencode wire shapes. This test starts a real server on a free port with a
 * temporary agent directory and drives the whole dependency list of the app:
 *
 *   GET  /api/info
 *   POST /api/pair
 *   GET  /auth/connect/{code}
 *   GET  /api/session
 *   POST /api/session
 *   GET  /api/session/{id}
 *   POST /api/session/{id}/prompt
 *   GET  /api/session/{id}/message
 *   GET  /api/event
 *   GET  /api/model
 *   GET  /api/provider
 *   GET  /api/agent
 *   GET  /api/command
 *   POST /api/session/{id}/interrupt
 *   POST /api/session/{id}/permission/{requestID}/reply
 *
 * The opencode OpenAPI schema is the reference for every shape; the fixture is the
 * committed copy of opencode's `packages/protocol/openapi.json`. The test needs no
 * network and no API key: the runtime is built from the local model catalog, and the
 * prompt route is exercised on a session that has no model, which is the state of a
 * fresh pi server.
 *
 * Where pi deliberately diverges from opencode, the test asserts the pi behaviour
 * and says so in a comment.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionServices,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { basicAuthHeader } from "../src/auth.ts";
import { toModelInfo } from "../src/routes/opencode-shapes.ts";
import { type PiServer, startServer } from "../src/server.ts";

const PASSWORD = "test-password";

/** The committed opencode OpenAPI schema. */
const FIXTURE_PATH = fileURLToPath(new URL("./fixtures/opencode-openapi.json", import.meta.url));

interface Fixture {
	paths: Record<
		string,
		Record<string, { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> }>
	>;
	components: { schemas: Record<string, { properties?: Record<string, unknown>; required?: string[] }> };
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;

/**
 * The property names a schema of the fixture declares.
 */
function schemaProperties(name: string): string[] {
	const schema = fixture.components.schemas[name];
	expect(schema, `the fixture has no schema ${name}`).toBeDefined();
	return Object.keys(schema?.properties ?? {});
}

/**
 * The property names a schema of the fixture requires.
 */
function schemaRequired(name: string): string[] {
	const schema = fixture.components.schemas[name];
	expect(schema, `the fixture has no schema ${name}`).toBeDefined();
	return schema?.required ?? [];
}

/**
 * The schema of the success body of a route, with the local references resolved.
 */
function routeBodySchema(method: string, path: string): { properties?: Record<string, unknown> } {
	const route = fixture.paths[path]?.[method.toLowerCase()];
	expect(route, `the fixture has no route ${method} ${path}`).toBeDefined();
	const schema = route?.responses?.["200"]?.content?.["application/json"]?.schema as
		| { properties?: Record<string, unknown>; $ref?: string }
		| undefined;
	if (!schema?.$ref) return schema ?? {};
	const name = schema.$ref.replace("#/components/schemas/", "");
	const referenced = fixture.components.schemas[name];
	expect(referenced, `the fixture has no schema ${name}`).toBeDefined();
	return referenced ?? {};
}

/**
 * The property names the fixture declares for the success body of a route.
 */
function routeBodyProperties(method: string, path: string): string[] {
	return Object.keys(routeBodySchema(method, path).properties ?? {});
}

/**
 * Assert that a produced body only carries keys the schema of the fixture knows.
 *
 * A produced key the schema does not declare is a divergence the test reports.
 */
function expectKnownKeys(schemaName: string, value: unknown): void {
	const produced = Object.keys((value ?? {}) as Record<string, unknown>);
	for (const key of produced) {
		expect(schemaProperties(schemaName), `${schemaName} does not declare "${key}"`).toContain(key);
	}
}

/**
 * Assert that a produced body carries the keys the schema of the fixture requires.
 */
function expectRequiredKeys(schemaName: string, value: unknown): void {
	const produced = (value ?? {}) as Record<string, unknown>;
	for (const key of schemaRequired(schemaName)) {
		expect(produced, `${schemaName} requires "${key}"`).toHaveProperty(key);
	}
}

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

let agentDir: string;
let serverCwd: string;
let previousAgentDir: string | undefined;
let server: PiServer;

/**
 * A runtime factory that builds a real pi session without a model.
 *
 * The model catalog of a fresh agent directory has no authenticated model, which is
 * the state of a fresh pi server. The session is real, so the routes that need one
 * answer with real data.
 */
const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, agentDir: dir, sessionManager }) => {
	const services = await createAgentSessionServices({ cwd, agentDir: dir });
	const created = await createAgentSessionFromServices({ services, sessionManager });
	return { ...created, services, diagnostics: services.diagnostics };
};

beforeAll(async () => {
	agentDir = makeTempDir("pi-ios-compat-agent-");
	serverCwd = makeTempDir("pi-ios-compat-cwd-");
	// The session manager stores its files under the agent directory of the process,
	// so the temporary directory keeps the test off the real session store.
	previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	server = await startServer({
		port: 0,
		password: PASSWORD,
		agentDir,
		cwd: serverCwd,
		createRuntime,
	});
});

afterAll(async () => {
	await server?.close();
	if (previousAgentDir === undefined) {
		delete process.env.PI_CODING_AGENT_DIR;
	} else {
		process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	}
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * A GET against the server with the password.
 */
function get(path: string, credential: string = PASSWORD, target: PiServer = server): Promise<Response> {
	return fetch(`${target.url}${path}`, { headers: { authorization: basicAuthHeader(credential) } });
}

/**
 * A POST against the server with a JSON body.
 */
function post(
	path: string,
	body: unknown,
	credential: string = PASSWORD,
	target: PiServer = server,
): Promise<Response> {
	return fetch(`${target.url}${path}`, {
		method: "POST",
		headers: { authorization: basicAuthHeader(credential), "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

/**
 * The body of a response, parsed as JSON.
 */
async function json(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}

/**
 * A session on disk with a title and one user message.
 *
 * A persisted session is what the opencode routes read, so it is the state in which
 * their shapes are observable.
 */
function persistedSession(title: string): SessionManager {
	const manager = SessionManager.create(serverCwd);
	manager.appendSessionInfo(title);
	manager.appendMessage({ role: "user", content: "hello from the app", timestamp: Date.now() });
	return manager;
}

describe("the opencode surface the iOS app depends on", () => {
	test("GET /api/info answers the opencode server info shape", async () => {
		const response = await get("/api/info");
		expect(response.status).toBe(200);
		const body = await json(response);
		expectKnownKeys("ServerInfo", body);
		expectRequiredKeys("ServerInfo", body);
		expect(body.version).toEqual(expect.any(String));
		expect(body.pid).toBe(process.pid);
		expect(body.urls).toContain(server.url);
	});

	test("POST /api/pair issues a pairing code", async () => {
		const response = await post("/api/pair", {});
		expect(response.status).toBe(200);
		const body = await json(response);
		expectKnownKeys("PairingCode", body);
		expectRequiredKeys("PairingCode", body);
		expect(body.code).toEqual(expect.any(String));
		expect(body.expires_in).toBe(300);
	});

	test("GET /auth/connect/{code} exchanges a code for a session token", async () => {
		const pair = await post("/api/pair", {});
		const { code } = await json(pair);
		const response = await fetch(`${server.url}/auth/connect/${code}`);
		expect(response.status).toBe(200);
		const body = await json(response);
		expectKnownKeys("PairingSession", body);
		expectRequiredKeys("PairingSession", body);
		expect(body.token).toEqual(expect.any(String));

		// The token is a credential of its own: it opens the protected routes.
		expect((await get("/api/info", body.token as string)).status).toBe(200);

		// A code is single use.
		expect((await fetch(`${server.url}/auth/connect/${code}`)).status).toBe(404);
	});

	test("the pairing token outlives the pairing code", async () => {
		const pair = await post("/api/pair", {});
		const { code } = await json(pair);
		const connect = await fetch(`${server.url}/auth/connect/${code}`);
		const { token } = await json(connect);
		const expiresAt = Number((token as string).split(".")[0]);
		// The code lives five minutes; the token it hands out is the password of the
		// app, so it lives for thirty days like an opencode session.
		expect(expiresAt - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
		expect(expiresAt - Date.now()).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000);
	});

	test("GET /api/session answers the opencode session list shape", async () => {
		const response = await get("/api/session");
		expect(response.status).toBe(200);
		const body = await json(response);
		expect(Object.keys(body).sort()).toEqual(routeBodyProperties("GET", "/api/session").sort());
		expect(Array.isArray(body.data)).toBe(true);
		expect(body.cursor).toEqual({ previous: null, next: null });
	});

	test("GET /api/session lists sessions with the opencode session info shape", async () => {
		const created = await post("/api/session", { title: "iOS compat session" });
		const { data } = await json(created);
		const id = (data as Record<string, unknown>).id as string;

		const response = await get("/api/session");
		expect(response.status).toBe(200);
		const body = await json(response);
		const sessions = body.data as Array<Record<string, unknown>>;
		const listed = sessions.find((session) => session.id === id);
		expect(listed, "the created session is listed").toBeDefined();
		expectKnownKeys("Session.Info", listed);
		expectRequiredKeys("Session.Info", listed);
		expect(listed?.location).toEqual({ directory: serverCwd });
		expect(typeof listed?.title).toBe("string");
		expect(typeof listed?.projectID).toBe("string");
		expect(typeof (listed?.cost as number)).toBe("number");
		const tokens = listed?.tokens as Record<string, unknown>;
		expect(typeof tokens.input).toBe("number");
		expect(typeof tokens.output).toBe("number");
		expect(typeof tokens.reasoning).toBe("number");
		expect(tokens.cache).toEqual({ read: expect.any(Number), write: expect.any(Number) });
	});

	test("POST /api/session creates a session with the opencode session info shape", async () => {
		const response = await post("/api/session", { title: "iOS compat" });
		expect(response.status).toBe(200);
		const body = await json(response);
		expectKnownKeys("Session.Info", body.data);
		expectRequiredKeys("Session.Info", body.data);
		const info = body.data as Record<string, unknown>;
		expect(info.id).toEqual(expect.any(String));
		expect(info.location).toEqual({ directory: serverCwd });
		expect(typeof info.title).toBe("string");
		// Divergence: opencode prefixes its session ids with "ses_". pi generates its
		// own ids, a uuidv7, and the clients treat session ids as opaque strings.
		expect(info.id).not.toMatch(/^ses/);
	});

	test("POST /api/session honours the id and the location the app asks for", async () => {
		// The body the opencode app sends: an id it picked, an agent and a location.
		// pi has one agent, so the agent is accepted and ignored.
		const response = await post("/api/session", {
			id: "ses_clientchosen",
			agent: "build",
			location: { directory: serverCwd },
		});
		expect(response.status).toBe(200);
		const body = await json(response);
		const info = body.data as Record<string, unknown>;
		expect(info.id).toBe("ses_clientchosen");
		expect(info.location).toEqual({ directory: serverCwd });
	});

	test("GET /api/session/{id} finds the session the app named", async () => {
		const response = await get("/api/session/ses_clientchosen");
		expect(response.status).toBe(200);
		const body = await json(response);
		expect((body.data as Record<string, unknown>).id).toBe("ses_clientchosen");
	});

	test("GET /api/session/{id} answers the opencode session info shape", async () => {
		const manager = persistedSession("iOS compat session");
		const response = await get(`/api/session/${manager.getSessionId()}`);
		expect(response.status).toBe(200);
		const body = await json(response);
		expectKnownKeys("Session.Info", body.data);
		expectRequiredKeys("Session.Info", body.data);
		const info = body.data as Record<string, unknown>;
		expect(info.id).toBe(manager.getSessionId());
		expect(info.location).toEqual({ directory: serverCwd });
		// Divergence: opencode prefixes its session ids with "ses_".
		expect(info.id).not.toMatch(/^ses/);
	});

	test("GET /api/session/{id} answers the opencode session-not-found error", async () => {
		const response = await get("/api/session/ses_does_not_exist");
		expect(response.status).toBe(404);
		const body = await json(response);
		// The opencode clients detect a missing session by the tag and the session id.
		expect(body._tag).toBe("SessionNotFoundError");
		expect(body.sessionID).toBe("ses_does_not_exist");
		expect(body.message).toEqual(expect.any(String));
	});

	test("the session routes answer the opencode session-not-found error", async () => {
		const missing = "ses_does_not_exist";
		const routes: Array<[string, Promise<Response>]> = [
			[
				"DELETE",
				fetch(`${server.url}/api/session/${missing}`, {
					method: "DELETE",
					headers: { authorization: basicAuthHeader(PASSWORD) },
				}),
			],
			[
				"PATCH",
				fetch(`${server.url}/api/session/${missing}`, {
					method: "PATCH",
					headers: { authorization: basicAuthHeader(PASSWORD), "content-type": "application/json" },
					body: JSON.stringify({ title: "x" }),
				}),
			],
			["prompt", post(`/api/session/${missing}/prompt`, { text: "hello" })],
			["message", get(`/api/session/${missing}/message`)],
			["interrupt", post(`/api/session/${missing}/interrupt`, {})],
			["compact", post(`/api/session/${missing}/compact`, {})],
		];
		for (const [name, request] of routes) {
			const response = await request;
			expect(response.status, `${name} answers 404`).toBe(404);
			const body = await json(response);
			expect(body._tag, `${name} answers the session-not-found error`).toBe("SessionNotFoundError");
			expect(body.sessionID, `${name} carries the session id`).toBe(missing);
		}
	});

	test("POST /api/session/{id}/prompt answers cleanly without a model", async () => {
		const manager = persistedSession("iOS compat session");
		const response = await post(`/api/session/${manager.getSessionId()}/prompt`, { text: "hello" });
		expect(response.status).toBe(400);
		const body = await json(response);
		expect(body._tag).toEqual(expect.any(String));
		expect(body.message).toEqual(expect.any(String));
		// The message says why the prompt did not run.
		expect(String(body.message)).toContain("no model");
		// Divergence: opencode answers 200 with the inbox entry it accepted. The pi
		// server refuses the prompt when the session has no model to run it with.
		expect(body._tag).not.toBe("InvalidRequestError");

		// A prompt without text is refused before the session is even opened.
		const empty = await post(`/api/session/${manager.getSessionId()}/prompt`, {});
		expect(empty.status).toBe(400);
		expect((await json(empty))._tag).toEqual(expect.any(String));
	});

	test("GET /api/session/{id}/message answers the opencode message list shape", async () => {
		const manager = persistedSession("iOS compat session");
		const response = await get(`/api/session/${manager.getSessionId()}/message`);
		expect(response.status).toBe(200);
		const body = await json(response);
		expect(Object.keys(body).sort()).toEqual(routeBodyProperties("GET", "/api/session/{sessionID}/message").sort());
		expect(Array.isArray(body.data)).toBe(true);
		expect(body.cursor).toEqual({ previous: null, next: null });

		const messages = body.data as Array<Record<string, unknown>>;
		expect(messages.length).toBeGreaterThan(0);
		for (const message of messages) {
			expectKnownKeys("Session.Message.User", message);
			expectRequiredKeys("Session.Message.User", message);
			expect(message.type).toBe("user");
			expect(message.text).toBe("hello from the app");
		}
		// Divergence: opencode prefixes its message ids with "msg_", pi message ids
		// are derived from the session id.
		expect(String(messages[0]?.id)).not.toMatch(/^msg_/);
	});

	test("GET /api/event opens an opencode event stream", async () => {
		const controller = new AbortController();
		const response = await fetch(`${server.url}/api/event`, {
			headers: { authorization: basicAuthHeader(PASSWORD) },
			signal: controller.signal,
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/event-stream");
		expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
		expect(response.headers.get("x-accel-buffering")).toBe("no");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");

		const reader = response.body?.getReader();
		expect(reader).toBeDefined();
		const first = await reader!.read();
		const text = new TextDecoder().decode(first.value);
		expect(text.startsWith("data: ")).toBe(true);
		const frame = JSON.parse(text.slice("data: ".length).split("\n")[0] ?? "") as Record<string, unknown>;
		expect(frame.type).toBe("server.connected");
		expect(frame.data).toEqual({});
		expect(frame.id).toEqual(expect.any(String));

		controller.abort();
		await reader!.cancel().catch(() => {});
	});

	test("GET /api/event publishes the opencode event names", async () => {
		const controller = new AbortController();
		const response = await fetch(`${server.url}/api/event`, {
			headers: { authorization: basicAuthHeader(PASSWORD) },
			signal: controller.signal,
		});
		const reader = response.body!.getReader();
		await reader.read();

		// A session that renames itself publishes an event.
		const created = await post("/api/session", { title: "iOS compat session" });
		const { data } = await json(created);
		const id = (data as Record<string, unknown>).id as string;
		await fetch(`${server.url}/api/session/${id}`, {
			method: "PATCH",
			headers: { authorization: basicAuthHeader(PASSWORD), "content-type": "application/json" },
			body: JSON.stringify({ title: "renamed by the app" }),
		});

		let frame: Record<string, unknown> | undefined;
		for (let attempt = 0; attempt < 20 && !frame; attempt++) {
			const chunk = await reader.read();
			if (chunk.done) break;
			const text = new TextDecoder().decode(chunk.value);
			for (const line of text.split("\n")) {
				if (!line.startsWith("data: ")) continue;
				const parsed = JSON.parse(line.slice("data: ".length)) as Record<string, unknown>;
				if (parsed.type !== "server.connected") {
					frame = parsed;
					break;
				}
			}
		}
		controller.abort();
		await reader.cancel().catch(() => {});

		expect(frame, "the stream carries a session event").toBeDefined();
		// The opencode clients switch on the opencode event names, so the pi events
		// have to carry them: a renamed session is a "session.renamed".
		expect(frame?.type).toBe("session.renamed");
		// Every frame carries the id, the type, the timestamp and the payload.
		expect(frame?.id).toEqual(expect.any(String));
		expect(frame?.created).toEqual(expect.any(Number));
		expect(frame?.data).toEqual(expect.any(Object));
		expect((frame?.data as Record<string, unknown>).sessionID).toBe(id);
	});

	test("GET /api/model answers the opencode catalog envelope", async () => {
		const response = await get("/api/model");
		expect(response.status).toBe(200);
		const body = await json(response);
		expect(Object.keys(body).sort()).toEqual(routeBodyProperties("GET", "/api/model").sort());
		expect(body.location).toEqual({ directory: serverCwd });
		expect(Array.isArray(body.data)).toBe(true);
		// The catalog of the agent directory of this server: it has no authenticated
		// model, so it is empty.
	});

	test("GET /api/provider answers the opencode catalog envelope", async () => {
		const response = await get("/api/provider");
		expect(response.status).toBe(200);
		const body = await json(response);
		expect(Object.keys(body).sort()).toEqual(routeBodyProperties("GET", "/api/provider").sort());
		expect(body.location).toEqual({ directory: serverCwd });
		expect(Array.isArray(body.data)).toBe(true);
	});

	test("GET /api/agent answers the opencode agent shape", async () => {
		const response = await get("/api/agent");
		expect(response.status).toBe(200);
		const body = await json(response);
		expect(Object.keys(body).sort()).toEqual(routeBodyProperties("GET", "/api/agent").sort());
		expect(body.location).toEqual({ directory: serverCwd });
		const agents = body.data as Array<Record<string, unknown>>;
		expect(agents.length).toBeGreaterThan(0);
		for (const agent of agents) {
			expectKnownKeys("Agent.Info", agent);
			expectRequiredKeys("Agent.Info", agent);
			expect(agent.id).toEqual(expect.any(String));
		}
		// The opencode agent schema requires "request", "hidden" and "permissions".
		expect(schemaRequired("Agent.Info")).toEqual(expect.arrayContaining(["request", "hidden", "permissions"]));
		const request = agents[0]?.request as Record<string, unknown>;
		expect(request.settings).toEqual(expect.any(Object));
		expect(request.headers).toEqual(expect.any(Object));
		expect(request.body).toEqual(expect.any(Object));
		expect(agents[0]?.hidden).toBe(false);
		const permissions = agents[0]?.permissions as Array<Record<string, unknown>>;
		expect(Array.isArray(permissions)).toBe(true);
		for (const rule of permissions) {
			expect(rule.action).toEqual(expect.any(String));
			expect(rule.resource).toEqual(expect.any(String));
			expect(["allow", "deny", "ask"]).toContain(rule.effect);
		}
	});

	test("GET /api/command answers the opencode command shape", async () => {
		const response = await get("/api/command");
		expect(response.status).toBe(200);
		const body = await json(response);
		expect(Object.keys(body).sort()).toEqual(routeBodyProperties("GET", "/api/command").sort());
		expect(body.location).toEqual({ directory: serverCwd });
		const commands = body.data as Array<Record<string, unknown>>;
		expect(commands.length).toBeGreaterThan(0);
		for (const command of commands) {
			expectKnownKeys("Command.Info", command);
			expectRequiredKeys("Command.Info", command);
		}
	});

	test("POST /api/session/{id}/interrupt answers the opencode interrupt shape", async () => {
		const created = await post("/api/session", {});
		const { data } = await json(created);
		const id = (data as Record<string, unknown>).id as string;
		const response = await post(`/api/session/${id}/interrupt`, {});
		expect(response.status).toBe(200);
		const body = await json(response);
		expectKnownKeys("SessionInterruptResponse", body);
		expectRequiredKeys("SessionInterruptResponse", body);
		expect(body.interrupted).toBe(true);
	});

	test("POST /api/session/{id}/permission/{requestID}/reply answers 404 with the error body", async () => {
		const manager = persistedSession("iOS compat session");
		const response = await post(`/api/session/${manager.getSessionId()}/permission/req_1/reply`, {
			action: "allow",
		});
		expect(response.status).toBe(404);
		const body = await json(response);
		expect(body._tag).toEqual(expect.any(String));
		expect(body.message).toEqual(expect.any(String));
		// Deliberate divergence: pi has no permission prompts, so the route always
		// answers 404. opencode answers 204 for a reply it accepts.
		expect(body._tag).not.toBe("PermissionNotFoundError");
	});
});

describe("the authentication of the opencode surface", () => {
	test("the password opens the routes", async () => {
		expect((await get("/api/info")).status).toBe(200);
	});

	test("a request without a credential is refused with 401", async () => {
		const response = await fetch(`${server.url}/api/info`);
		expect(response.status).toBe(401);
		// The opencode client decodes the error body as JSON, so the answer has to
		// carry one: without it, a wrong password and a broken server look the same.
		expect(response.headers.get("content-type")).toContain("application/json");
		const body = await json(response);
		expect(body._tag).toBe("UnauthorizedError");
		expect(body.message).toEqual(expect.any(String));
		expect(response.headers.get("www-authenticate")).toContain("Basic");
	});

	test("a request with a wrong credential is refused with 401", async () => {
		expect((await get("/api/info", "wrong-password")).status).toBe(401);
	});

	test("a pairing token opens the routes", async () => {
		const pair = await post("/api/pair", {});
		const { code } = await json(pair);
		const connect = await fetch(`${server.url}/auth/connect/${code}`);
		const { token } = await json(connect);
		expect((await get("/api/info", token as string)).status).toBe(200);
	});
});

describe("the catalog of the server's location", () => {
	let catalogServer: PiServer;
	let catalogAgentDir: string;
	let catalogAgentDirEnv: string | undefined;

	beforeAll(async () => {
		catalogAgentDir = makeTempDir("pi-ios-compat-catalog-");
		// A credential for a provider whose models ship with pi: the catalog of a
		// location is the list of the models of the providers that are configured.
		writeFileSync(
			join(catalogAgentDir, "auth.json"),
			JSON.stringify({ anthropic: { type: "api_key", key: "sk-pi-ios-compat" } }),
		);
		catalogAgentDirEnv = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = catalogAgentDir;
		catalogServer = await startServer({
			port: 0,
			password: PASSWORD,
			agentDir: catalogAgentDir,
			cwd: serverCwd,
			createRuntime,
		});
	});

	afterAll(async () => {
		await catalogServer?.close();
		if (catalogAgentDirEnv === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = catalogAgentDirEnv;
		}
	});

	test("GET /api/model answers the catalog of the server's location", async () => {
		const response = await get("/api/model", PASSWORD, catalogServer);
		expect(response.status).toBe(200);
		const body = await json(response);
		expect(body.location).toEqual({ directory: serverCwd });
		const models = body.data as Array<Record<string, unknown>>;
		expect(models.length).toBeGreaterThan(0);
		// The catalog is the one of the location of the server, not of a session.
		const runtime = await ModelRuntime.create({
			authPath: join(catalogAgentDir, "auth.json"),
			modelsPath: join(catalogAgentDir, "models.json"),
		});
		expect(models).toEqual(runtime.getAvailableSnapshot().map(toModelInfo));
	});

	test("GET /api/provider answers the catalog of the server's location", async () => {
		const response = await get("/api/provider", PASSWORD, catalogServer);
		expect(response.status).toBe(200);
		const body = await json(response);
		expect(body.location).toEqual({ directory: serverCwd });
		const providers = body.data as Array<Record<string, unknown>>;
		expect(providers.length).toBeGreaterThan(0);
		expect(providers.map((provider) => provider.id)).toContain("anthropic");
	});

	test("POST /api/session honours the model the app asks for", async () => {
		const catalog = await json(await get("/api/model", PASSWORD, catalogServer));
		const model = (catalog.data as Array<Record<string, unknown>>)[0];
		expect(model, "the catalog has a model to ask for").toBeDefined();
		const response = await post(
			"/api/session",
			{
				id: "ses_with_model",
				agent: "build",
				model: { id: model?.id, providerID: model?.providerID },
				location: { directory: serverCwd },
			},
			PASSWORD,
			catalogServer,
		);
		expect(response.status).toBe(200);
		const info = (await json(response)).data as Record<string, unknown>;
		expect(info.id).toBe("ses_with_model");
		expect(info.model).toEqual({ id: model?.modelID, providerID: model?.providerID });
	});
});
