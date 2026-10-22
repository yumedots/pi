/**
 * The opencode-compatible HTTP surface.
 *
 * These routes mirror the opencode API the opencode clients depend on. The shapes come
 * from the opencode OpenAPI schema; the parity harness compares the route table and the
 * produced keys against it.
 */

import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import {
	BUILTIN_SLASH_COMMANDS,
	CURRENT_SESSION_VERSION,
	ModelRuntime,
	type RpcResponse,
	type SessionEntry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { type RouteContext, type Router, sendError, sendJson } from "../http/router.ts";
import type { ServerContext } from "../server-context.ts";
import type { ServerSession } from "../session-registry.ts";
import {
	type OpencodeMessageInfo,
	type OpencodeModelInfo,
	type OpencodeSessionInfo,
	type SessionSummary,
	toAgentInfo,
	toCommandInfo,
	toMessageInfo,
	toModelInfo,
	toProviderInfo,
	toSessionInfo,
} from "./opencode-shapes.ts";

/**
 * The model runtime of the server's own location.
 *
 * The server builds one for its agent directory, the same way the runtime factory builds
 * the runtime of a session. A server that already has one hands it over, so the catalog
 * of the location and the catalog of its sessions come from the same place.
 */
const locationRuntimes = new WeakMap<ServerContext, ModelRuntime>();
const pendingLocationRuntimes = new WeakMap<ServerContext, Promise<ModelRuntime>>();

/**
 * Give the server the model runtime of its own location.
 */
export function setLocationModelRuntime(ctx: ServerContext, runtime: ModelRuntime): void {
	locationRuntimes.set(ctx, runtime);
}

/**
 * Register the opencode-compatible routes.
 */
export function registerOpencodeRoutes(router: Router, ctx: ServerContext): void {
	router.add("GET", "/api/session", ({ res, url }) => {
		const directory = url.searchParams.get("directory") ?? undefined;
		void ctx.registry.list(directory).then(
			async (sessions) => {
				const data = await Promise.all(
					sessions.map(async (session) =>
						toSessionInfo(
							{ ...session, model: liveModel(ctx.registry.get(session.id)) },
							entriesOf(session.path),
						),
					),
				);
				sendJson(res, 200, { data, cursor: { previous: null, next: null } });
			},
			(error: unknown) => {
				sendError(res, 500, "InternalError", error instanceof Error ? error.message : String(error));
			},
		);
	});

	router.add("POST", "/api/session", async (route) => {
		const body = await readJson(route);
		const directory = sessionDirectory(body) ?? ctx.cwd;
		const title = stringField(body, "title");
		const id = stringField(body, "id");
		const reference = modelRef(body);
		try {
			const model = reference ? await findModel(ctx, reference) : undefined;
			if (reference && !model) {
				throw new Error(`The model ${reference.providerID}/${reference.id} is not available on this server`);
			}
			const session = await createSession(ctx, directory, id);
			if (title) session.runtime.session.setSessionName(title);
			if (model) await applyModel(session, model);
			sendJson(route.res, 200, { data: toSessionInfo(await summaryOf(ctx, session.id)) });
		} catch (error) {
			sendError(route.res, 400, errorTag(error), errorMessage(error));
		}
	});

	router.add("GET", "/api/session/:id", async (route) => {
		const id = route.params.id ?? "";
		const session = ctx.registry.get(id);
		if (session) {
			const summary = await summaryOf(ctx, session.id);
			const entries = session.sessionFile ? entriesOf(session.sessionFile) : [];
			sendJson(route.res, 200, { data: toSessionInfo(summary, entries) });
			return;
		}
		const path = await findSessionPath(id);
		if (!path) {
			sendSessionNotFound(route.res, id);
			return;
		}
		let summary: SessionSummary;
		try {
			summary = summaryFromPath(path);
		} catch (error) {
			sendError(route.res, 500, "InternalError", errorMessage(error));
			return;
		}
		sendJson(route.res, 200, { data: toSessionInfo(summary, entriesOf(path)) });
	});

	router.add("DELETE", "/api/session/:id", async (route) => {
		const id = route.params.id ?? "";
		try {
			await ctx.registry.close(id);
		} catch (error) {
			sendError(route.res, 500, "InternalError", errorMessage(error));
			return;
		}
		const path = await findSessionPath(id);
		if (!path) {
			sendSessionNotFound(route.res, id);
			return;
		}
		rmSync(path, { force: true });
		route.res.writeHead(204).end();
	});

	router.add("PATCH", "/api/session/:id", async (route) => {
		const id = route.params.id ?? "";
		const body = await readJson(route);
		const title = stringField(body, "title");
		const session = await lookupSession(ctx, id).catch(() => undefined);
		if (!session) {
			sendSessionNotFound(route.res, id);
			return;
		}
		if (title && title.length > 0) {
			session.runtime.session.setSessionName(title);
		}
		route.res.writeHead(204).end();
	});

	router.add("POST", "/api/session/:id/prompt", async (route) => {
		const id = route.params.id ?? "";
		const body = await readJson(route);
		const text = stringField(body, "text");
		if (!text || text.length === 0) {
			sendError(route.res, 400, "BadRequestError", "Expected a prompt with a text");
			return;
		}
		const messageId = stringField(body, "id") ?? randomUUID();
		const session = await lookupSession(ctx, id).catch(() => undefined);
		if (!session) {
			sendSessionNotFound(route.res, id);
			return;
		}
		let response: RpcResponse | undefined;
		try {
			response = await session.controller.handle({
				id: messageId,
				type: "prompt",
				message: text,
			});
		} catch (error) {
			sendError(route.res, 500, "InternalError", errorMessage(error));
			return;
		}
		if (response && "success" in response && response.success === false) {
			sendError(route.res, 400, "BadRequestError", await promptFailure(session, response.error));
			return;
		}
		sendJson(route.res, 200, {
			data: {
				id: messageId,
				sessionID: id,
				time: { created: Date.now() },
			},
		});
	});

	router.add("POST", "/api/session/:id/interrupt", async (route) => {
		const id = route.params.id ?? "";
		const session = await lookupSession(ctx, id).catch(() => undefined);
		if (!session) {
			sendSessionNotFound(route.res, id);
			return;
		}
		try {
			await session.controller.handle({ type: "abort" });
		} catch (error) {
			sendError(route.res, 500, "InternalError", errorMessage(error));
			return;
		}
		sendJson(route.res, 200, { interrupted: true });
	});

	router.add("POST", "/api/session/:id/compact", async (route) => {
		const id = route.params.id ?? "";
		const body = await readJson(route);
		const session = await lookupSession(ctx, id).catch(() => undefined);
		if (!session) {
			sendSessionNotFound(route.res, id);
			return;
		}
		const customInstructions = stringField(body, "customInstructions");
		try {
			await session.controller.handle({ type: "compact", customInstructions });
		} catch (error) {
			sendError(route.res, 500, "InternalError", errorMessage(error));
			return;
		}
		sendJson(route.res, 200, { data: true });
	});

	router.add("GET", "/api/session/:id/message", async (route) => {
		const id = route.params.id ?? "";
		const session = await lookupSession(ctx, id).catch(() => undefined);
		if (!session) {
			sendSessionNotFound(route.res, id);
			return;
		}
		const messages = session.runtime.session.messages.map((message, index) =>
			toMessageInfo(message, `${id}-${index}`, message.timestamp ?? Date.now()),
		);
		const { limit, order, cursor, type } = readPaging(route);
		const filtered = type ? messages.filter((message) => message.type === type) : messages;
		const ordered = order === "asc" ? filtered : [...filtered].reverse();
		const start = cursor ? cursorStart(ordered, cursor) : 0;
		const page = ordered.slice(start, start + limit);
		const last = page[page.length - 1];
		const next = last && start + limit < ordered.length ? encodeCursor(last.id, order, "next") : null;
		const previous = start > 0 && ordered[start - 1] ? encodeCursor(ordered[start - 1]!.id, order, "prev") : null;
		sendJson(route.res, 200, { data: page, cursor: { previous, next } });
	});

	router.add("GET", "/api/model", async (route) => {
		const models = await listModels(ctx);
		sendJson(route.res, 200, { location: { directory: ctx.cwd }, data: models });
	});

	router.add("GET", "/api/model/default", async (route) => {
		const models = await listModels(ctx);
		sendJson(route.res, 200, { location: { directory: ctx.cwd }, data: models[0] ?? null });
	});

	router.add("GET", "/api/provider", async (route) => {
		const models = await listModels(ctx);
		const providers = new Map<string, { id: string; name: string }>();
		for (const model of models) {
			if (providers.has(model.providerID)) continue;
			providers.set(model.providerID, { id: model.providerID, name: model.providerID });
		}
		sendJson(route.res, 200, {
			location: { directory: ctx.cwd },
			data: [...providers.values()].map((provider) => toProviderInfo(provider)),
		});
	});

	router.add("GET", "/api/agent", ({ res }) => {
		sendJson(res, 200, { location: { directory: ctx.cwd }, data: [toAgentInfo()] });
	});

	router.add("GET", "/api/command", ({ res }) => {
		const session = [...ctx.registry.sessions.values()][0];
		const commands = [...BUILTIN_SLASH_COMMANDS.map((command) => toCommandInfo(command))];
		try {
			for (const command of session?.runtime.session.extensionRunner.getRegisteredCommands() ?? []) {
				commands.push(toCommandInfo({ name: command.invocationName, description: command.description }));
			}
		} catch {
			// The extension commands are a bonus: the builtin ones are always there.
		}
		sendJson(res, 200, { location: { directory: ctx.cwd }, data: commands });
	});

	router.add("POST", "/api/session/:id/permission/:requestID/reply", ({ res }) => {
		sendError(res, 404, "NotFoundError", "the pi server does not implement permission requests");
	});
}

/**
 * The models the server offers, taken from the model runtime of a session.
 */
async function listModels(ctx: ServerContext): Promise<OpencodeModelInfo[]> {
	const session = [...ctx.registry.sessions.values()][0];
	if (!session) return [];
	try {
		return session.runtime.session.modelRuntime.getAvailableSnapshot().map(toModelInfo);
	} catch {
		return [];
	}
}

async function locationRuntime(ctx: ServerContext): Promise<ModelRuntime | undefined> {
	const known = locationRuntimes.get(ctx);
	if (known) return known;
	let pending = pendingLocationRuntimes.get(ctx);
	if (!pending) {
		pending = ModelRuntime.create({
			authPath: join(ctx.agentDir, "auth.json"),
			modelsPath: join(ctx.agentDir, "models.json"),
		});
		pendingLocationRuntimes.set(ctx, pending);
	}
	try {
		return await pending;
	} catch {
		return undefined;
	}
}

/**
 * The entries of a session file.
 */
function entriesOf(sessionPath: string): SessionEntry[] {
	try {
		return SessionManager.open(sessionPath).getEntries();
	} catch {
		return [];
	}
}

/**
 * The summary of a session, from the registry when it is open and from disk otherwise.
 */
async function summaryOf(ctx: ServerContext, id: string): Promise<SessionSummary> {
	const sessions = await ctx.registry.list();
	const found = sessions.find((session) => session.id === id);
	const open = ctx.registry.get(id);
	if (found) return { ...found, model: liveModel(open) };
	if (open) {
		return {
			id: open.id,
			path: open.sessionFile ?? "",
			cwd: open.cwd,
			created: Date.now(),
			modified: Date.now(),
			messageCount: 0,
			firstMessage: "",
			busy: open.busy,
			model: liveModel(open),
		};
	}
	return {
		id,
		path: "",
		cwd: ctx.cwd,
		created: Date.now(),
		modified: Date.now(),
		messageCount: 0,
		firstMessage: "",
		busy: false,
	};
}

/**
 * The model of an open session, as the opencode clients expect it: the id of the model
 * and the provider it belongs to.
 */
function liveModel(session: ServerSession | undefined): { id: string; providerID: string } | undefined {
	if (!session) return undefined;
	const model = session.runtime.session.model;
	if (!model) return undefined;
	return { id: model.id, providerID: model.provider };
}

/**
 * The summary of a session file.
 */
function summaryFromPath(path: string): SessionSummary {
	const manager = SessionManager.open(path);
	return {
		id: manager.getSessionId(),
		path,
		cwd: manager.getCwd(),
		name: manager.getSessionName(),
		created: 0,
		modified: 0,
		messageCount: 0,
		firstMessage: "",
		busy: false,
	};
}

/**
 * The path of the session file of a session id.
 */
async function findSessionPath(id: string): Promise<string | undefined> {
	try {
		const sessions = await SessionManager.listAll();
		return sessions.find((session) => session.id === id)?.path;
	} catch {
		return undefined;
	}
}

/**
 * The session of an id, opened when it is not open yet.
 *
 * @returns `undefined` when no session with that id exists.
 */
async function lookupSession(ctx: ServerContext, id: string): Promise<ServerSession | undefined> {
	const existing = ctx.registry.get(id);
	if (existing) return existing;
	const path = await findSessionPath(id);
	if (!path) return undefined;
	return ctx.registry.open(path);
}

/**
 * Create a session, with the id the client asked for when it sent one.
 *
 * The opencode clients name the session themselves, so the server has to keep that id.
 * pi generates its own ids, so the session file is written with the client's id before
 * the registry opens it.
 */
async function createSession(ctx: ServerContext, directory: string, id: string | undefined): Promise<ServerSession> {
	if (!id) return ctx.registry.create(directory);
	const open = ctx.registry.get(id);
	if (open) return open;
	const existing = SessionManager.findById(directory, id);
	if (existing) return ctx.registry.open(existing);
	const manager = SessionManager.create(directory, undefined, { id });
	const file = manager.getSessionFile();
	if (!file) throw new Error("The session has no file to open");
	writeFileSync(
		file,
		`${JSON.stringify({
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id,
			timestamp: new Date().toISOString(),
			cwd: manager.getCwd(),
		})}\n`,
		{ flag: "wx" },
	);
	return ctx.registry.open(file);
}

/**
 * A model of the catalog: the provider it belongs to and its id.
 */
interface CatalogModel {
	provider: string;
	id: string;
}

/**
 * The model a reference points at.
 *
 * The opencode clients send a model reference: the catalog id of the model and the
 * provider it belongs to. The catalog id of pi is `provider/model`, the model id alone
 * is accepted as well.
 */
async function findModel(
	ctx: ServerContext,
	reference: { id: string; providerID: string },
): Promise<CatalogModel | undefined> {
	const session = [...ctx.registry.sessions.values()][0];
	const runtime = session?.runtime.session.modelRuntime ?? (await locationRuntime(ctx));
	if (!runtime) return undefined;
	const models = runtime.getAvailableSnapshot();
	const model = models.find(
		(candidate) =>
			candidate.provider === reference.providerID &&
			(candidate.id === reference.id || `${candidate.provider}/${candidate.id}` === reference.id),
	);
	return model ? { provider: model.provider, id: model.id } : undefined;
}

/**
 * Select the model of a new session.
 */
async function applyModel(session: ServerSession, model: CatalogModel): Promise<void> {
	const response = await session.controller.handle({
		type: "set_model",
		provider: model.provider,
		modelId: model.id,
	});
	if (response && "success" in response && response.success === false) {
		throw new Error(response.error ?? `The model ${model.provider}/${model.id} could not be selected`);
	}
}

/**
 * The directory a create body asks for.
 *
 * The opencode clients send `location.directory`, pi's own clients send `directory`.
 */
function sessionDirectory(body: unknown): string | undefined {
	return stringField(field(body, "location"), "directory") ?? stringField(body, "directory");
}

/**
 * The model a create body asks for.
 *
 * The opencode clients send a model reference: `{ id, providerID }`, where the id is the
 * catalog id of the model. A plain `provider/model` string is accepted as well.
 */
function modelRef(body: unknown): { id: string; providerID: string } | undefined {
	const model = field(body, "model");
	if (typeof model === "string") {
		const separator = model.indexOf("/");
		if (separator <= 0) return undefined;
		return { providerID: model.slice(0, separator), id: model.slice(separator + 1) };
	}
	const id = stringField(model, "id");
	if (!id) return undefined;
	const providerID = stringField(model, "providerID");
	if (providerID) return { id, providerID };
	const separator = id.indexOf("/");
	if (separator <= 0) return undefined;
	return { providerID: id.slice(0, separator), id: id.slice(separator + 1) };
}

/**
 * Answer the opencode session-not-found error.
 *
 * The opencode clients detect a missing session by the tag and the session id, so the
 * answer carries both.
 */
function sendSessionNotFound(res: ServerResponse, id: string): void {
	sendJson(res, 404, {
		_tag: "SessionNotFoundError",
		sessionID: id,
		message: `Session not found: ${id}`,
	});
}

/**
 * Why a prompt did not run.
 *
 * The opencode clients show the message of a refused prompt, so it has to name what the
 * server is missing instead of repeating the guidance of the pi terminal.
 */
async function promptFailure(session: ServerSession, reason: string | undefined): Promise<string> {
	const model = session.runtime.session.model;
	if (!model) {
		return "The pi server has no model for this session, so it cannot run the prompt. Configure a model for the server first.";
	}
	const runtime = session.runtime.session.modelRuntime;
	if (!runtime.getModel(model.provider, model.id)) {
		return "The pi server has no model for this session, so it cannot run the prompt. Configure a model for the server first.";
	}
	const configured =
		runtime.hasConfiguredAuth(model.provider) || (await runtime.checkAuth(model.provider)) !== undefined;
	if (!configured) {
		return `The pi server has no API key for ${model.provider}, so it cannot run the prompt. Log in to ${model.provider} first.`;
	}
	return reason ?? "The prompt was rejected";
}

/**
 * The paging parameters of a message list.
 */
function readPaging(route: RouteContext): {
	limit: number;
	order: "asc" | "desc";
	cursor: MessageCursor | undefined;
	type: string | undefined;
} {
	const rawLimit = Number(route.url.searchParams.get("limit") ?? 50);
	const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.floor(rawLimit))) : 50;
	const order = route.url.searchParams.get("order") === "asc" ? "asc" : "desc";
	const cursor = decodeCursor(route.url.searchParams.get("cursor") ?? "");
	const type = route.url.searchParams.get("type") ?? undefined;
	return { limit, order, cursor, type };
}

/**
 * A paging cursor: the id of the last message of the page, the order and the direction.
 */
interface MessageCursor {
	id: string;
	order: "asc" | "desc";
	direction: "next" | "prev";
}

/**
 * Encode a paging cursor.
 */
function encodeCursor(id: string, order: "asc" | "desc", direction: "next" | "prev"): string {
	return Buffer.from(JSON.stringify({ id, order, direction }), "utf8").toString("base64url");
}

/**
 * Decode a paging cursor.
 */
function decodeCursor(raw: string): MessageCursor | undefined {
	if (raw.length === 0) return undefined;
	try {
		const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<MessageCursor>;
		if (typeof parsed.id !== "string") return undefined;
		return {
			id: parsed.id,
			order: parsed.order === "asc" ? "asc" : "desc",
			direction: parsed.direction === "prev" ? "prev" : "next",
		};
	} catch {
		return undefined;
	}
}

/**
 * The index the page starts at, given the cursor.
 */
function cursorStart(messages: readonly OpencodeMessageInfo[], cursor: MessageCursor): number {
	const index = messages.findIndex((message) => message.id === cursor.id);
	if (index < 0) return 0;
	return cursor.direction === "prev" ? 0 : index + 1;
}

async function readJson(route: RouteContext): Promise<unknown> {
	try {
		return await route.json();
	} catch {
		return undefined;
	}
}

/**
 * A string field of a JSON body.
 *
 * The body is external data, so the handlers check the fields they use before they trust
 * them. A missing body, or a body that is not an object, has no fields.
 */
function stringField(body: unknown, name: string): string | undefined {
	const value = field(body, name);
	return typeof value === "string" ? value : undefined;
}

/**
 * A field of a JSON body.
 *
 * A missing body, or a body that is not an object, has no fields.
 */
function field(body: unknown, name: string): unknown {
	if (typeof body !== "object" || body === null) return undefined;
	return Reflect.get(body, name);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function errorTag(error: unknown): string {
	if (error && typeof error === "object" && "_tag" in error && typeof error._tag === "string") {
		return error._tag;
	}
	return "BadRequestError";
}

export type { OpencodeMessageInfo, OpencodeSessionInfo };
