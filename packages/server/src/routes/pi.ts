/**
 * The pi-native HTTP surface.
 *
 * These routes are what the pi client uses: the session list, the session state snapshot,
 * the command channel and the event stream. They carry the raw pi protocol, so the client
 * does not need a translation layer.
 */

import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
	type AgentSession,
	BUILTIN_SLASH_COMMANDS,
	hasTrustRequiringProjectResources,
	ProjectTrustStore,
	type RpcCommand,
	type RpcExtensionUIResponse,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { ToolRenderContext } from "@earendil-works/pi-coding-agent/core/extensions/types";
import { KeybindingsManager } from "@earendil-works/pi-coding-agent/core/keybindings";
import type { CustomMessage } from "@earendil-works/pi-coding-agent/core/messages";
import { DefaultPackageManager, type ResolvedPaths } from "@earendil-works/pi-coding-agent/core/package-manager";
import type { CustomEntry } from "@earendil-works/pi-coding-agent/core/session-manager";
import { initTheme, type Theme, theme } from "@earendil-works/pi-coding-agent/core/theme/theme";
import { withBuiltInRenderers } from "@earendil-works/pi-coding-agent/core/tools/renderers/index";
import {
	renderExtensionCustom,
	renderExtensionFooter,
	renderExtensionHeader,
	SERVER_RENDER_WIDTH,
} from "../extension-ui.ts";
import { type RouteContext, type Router, sendError, sendJson } from "../http/router.ts";
import { openSse, sseFrame } from "../http/sse.ts";
import { buildManifest, getServerVersion } from "../manifest.ts";
import type { ServerContext } from "../server-context.ts";
import type { ServerSession } from "../session-registry.ts";
import { applyClientSetting } from "../settings-apply.ts";
import { toSessionStateSnapshot } from "../state.ts";
import type { RenderRequest, ServerHandshake } from "../types.ts";

/** The theme the server renders with, and the name it was loaded from. */
let renderThemeName: string | undefined;
let renderThemeReady = false;

/**
 * How long the server waits for a renderer that started work in the background.
 *
 * The edit renderer computes the diff of a pending edit in the background and asks for a
 * redraw when it is done, so the server draws the row again after that work.
 */
const RENDER_SETTLE_MS = 50;

/**
 * The state the renderers keep between the call and the result.
 *
 * A renderer may start a timer for a row that is still running, so the server clears it
 * when the row is drawn.
 */
interface ServerRenderState extends Record<string, unknown> {
	interval?: NodeJS.Timeout;
}

/** The body of `POST /pi/session`. */
export interface CreatePiSessionBody {
	/** The working directory of the session. */
	cwd?: string;
	/** The session directory. */
	sessionDir?: string;
	/** The display name of the session. */
	title?: string;
	/** The model to start with, as `provider/model`. */
	model?: string;
	/** The thinking level to start with. */
	thinkingLevel?: string;
	/** Continue the most recent session of the directory, or a session file. */
	resume?: "recent" | string;
}

/**
 * Register the pi-native routes.
 */
export function registerPiRoutes(router: Router, ctx: ServerContext): void {
	router.add("GET", "/pi/server", ({ res }) => {
		sendJson(res, 200, { data: serverHandshake(ctx) });
	});

	router.add("POST", "/pi/trust", async (route) => {
		const body = (await readJson(route)) as { cwd?: unknown; trusted?: unknown } | undefined;
		if (!body || typeof body.cwd !== "string" || (typeof body.trusted !== "boolean" && body.trusted !== null)) {
			sendError(route.res, 400, "BadRequestError", "Expected a trust decision");
			return;
		}
		serverTrustStore(ctx.agentDir).set(body.cwd, body.trusted);
		sendJson(route.res, 200, { ok: true });
	});

	router.add("POST", "/pi/settings", async (route) => {
		const body = (await readJson(route)) as { key?: unknown; value?: unknown; scope?: unknown } | undefined;
		if (!body || typeof body.key !== "string") {
			sendError(route.res, 400, "BadRequestError", "Expected a setting key");
			return;
		}
		const scope = body.scope === "project" ? "project" : "global";
		const settingsManager = serverSettings(ctx.agentDir, ctx.cwd);
		if (!applyClientSetting(settingsManager, body.key, body.value, scope)) {
			sendError(route.res, 400, "BadRequestError", `Unknown setting: ${body.key}`);
			return;
		}
		sendJson(route.res, 200, { data: { settings: settingsManager.getSettings() } });
	});

	router.add("POST", "/pi/session/:id/settings", async (route) => {
		const session = ctx.registry.get(route.params.id ?? "");
		if (!session) {
			sendError(route.res, 404, "NotFoundError", `Unknown session: ${route.params.id}`);
			return;
		}
		const body = (await readJson(route)) as { key?: unknown; value?: unknown; scope?: unknown } | undefined;
		if (!body || typeof body.key !== "string") {
			sendError(route.res, 400, "BadRequestError", "Expected a setting key");
			return;
		}
		const scope = body.scope === "project" ? "project" : "global";
		const settingsManager = session.runtime.session.settingsManager;
		if (!applyClientSetting(settingsManager, body.key, body.value, scope)) {
			sendError(route.res, 400, "BadRequestError", `Unknown setting: ${body.key}`);
			return;
		}
		sendJson(route.res, 200, { data: { settings: settingsManager.getSettings() } });
	});

	router.add("GET", "/pi/paths", async ({ res }) => {
		try {
			const resolvedPaths = await serverResolvedPaths(ctx);
			sendJson(res, 200, { data: { global: resolvedPaths.global, project: resolvedPaths.project } });
		} catch (error: unknown) {
			sendError(res, 500, "InternalError", errorMessage(error));
		}
	});

	router.add("GET", "/pi/package/updates", async ({ res }) => {
		try {
			const packageManager = new DefaultPackageManager({
				cwd: ctx.cwd,
				agentDir: ctx.agentDir,
				settingsManager: serverSettings(ctx.agentDir, ctx.cwd),
			});
			const updates = await packageManager.checkForAvailableUpdates();
			sendJson(res, 200, { data: { updates: updates.map((update) => update.displayName) } });
		} catch (error: unknown) {
			sendError(res, 500, "InternalError", errorMessage(error));
		}
	});

	router.add("POST", "/pi/session/rename", async (route) => {
		const body = (await readJson(route)) as { path?: unknown; name?: unknown } | undefined;
		if (!body || typeof body.path !== "string" || typeof body.name !== "string") {
			sendError(route.res, 400, "BadRequestError", "Expected a session path and a name");
			return;
		}
		try {
			SessionManager.open(body.path).appendSessionInfo(body.name);
			sendJson(route.res, 200, { ok: true });
		} catch (error: unknown) {
			sendError(route.res, 400, errorTag(error), errorMessage(error));
		}
	});

	router.add("GET", "/pi/session", ({ res, url }) => {
		const directory = url.searchParams.get("directory") ?? undefined;
		void ctx.registry.list(directory).then(
			(sessions) => sendJson(res, 200, { data: sessions }),
			(error: unknown) => sendError(res, 500, "InternalError", errorMessage(error)),
		);
	});

	router.add("POST", "/pi/session", async (route) => {
		const body = ((await readJson(route)) ?? {}) as CreatePiSessionBody;
		const cwd = body.cwd ?? ctx.cwd;
		try {
			const session =
				body.resume === "recent"
					? await ctx.registry.continueRecent(cwd)
					: body.resume
						? await ctx.registry.open(body.resume)
						: await ctx.registry.create(cwd);
			if (body.title) session.runtime.session.setSessionName(body.title);
			sendJson(route.res, 200, { data: toSessionStateSnapshot(session) });
		} catch (error) {
			if (errorTag(error) === "ProjectNotTrustedError") {
				// The directory travels with the error, so the client asks about the
				// directory the server refused and not about its own.
				sendJson(route.res, 400, {
					_tag: "ProjectNotTrustedError",
					message: errorMessage(error),
					cwd: refusedCwd(body, ctx),
				});
				return;
			}
			sendError(route.res, 400, errorTag(error), errorMessage(error));
		}
	});

	router.add("GET", "/pi/session/:id", ({ res, params }) => {
		const session = ctx.registry.get(params.id ?? "");
		if (!session) {
			sendError(res, 404, "NotFoundError", `Unknown session: ${params.id}`);
			return;
		}
		sendJson(res, 200, { data: toSessionStateSnapshot(session) });
	});

	router.add("GET", "/pi/session/:id/messages", ({ res, params }) => {
		const session = ctx.registry.get(params.id ?? "");
		if (!session) {
			sendError(res, 404, "NotFoundError", `Unknown session: ${params.id}`);
			return;
		}
		sendJson(res, 200, { data: session.runtime.session.messages });
	});

	router.add("GET", "/pi/session/:id/tree", ({ res, params }) => {
		const session = ctx.registry.get(params.id ?? "");
		if (!session) {
			sendError(res, 404, "NotFoundError", `Unknown session: ${params.id}`);
			return;
		}
		const sessionManager = session.runtime.session.sessionManager;
		sendJson(res, 200, { data: { tree: sessionManager.getTree(), leafId: sessionManager.getLeafId() } });
	});

	router.add("GET", "/pi/session/:id/widgets", ({ res, params }) => {
		const session = ctx.registry.get(params.id ?? "");
		if (!session) {
			sendError(res, 404, "NotFoundError", `Unknown session: ${params.id}`);
			return;
		}
		sendJson(res, 200, { data: { widgets: session.controller.getExtensionWidgets() } });
	});

	router.add("GET", "/pi/session/:id/resources", ({ res, params }) => {
		const session = ctx.registry.get(params.id ?? "");
		if (!session) {
			sendError(res, 404, "NotFoundError", `Unknown session: ${params.id}`);
			return;
		}
		const agentSession = session.runtime.session;
		const commands: Array<{ name: string; description?: string; source?: string; sourceInfo?: unknown }> = [];
		for (const command of BUILTIN_SLASH_COMMANDS) {
			commands.push({ name: command.name, description: command.description, source: "builtin" });
		}
		for (const command of agentSession.extensionRunner.getRegisteredCommands()) {
			commands.push({
				name: command.invocationName,
				description: command.description,
				source: "extension",
				sourceInfo: command.sourceInfo,
			});
		}
		for (const template of agentSession.promptTemplates) {
			commands.push({ name: template.name, description: template.description, source: "prompt" });
		}
		for (const skill of agentSession.resourceLoader.getSkills().skills) {
			commands.push({ name: `skill:${skill.name}`, description: skill.description, source: "skill" });
		}
		sendJson(res, 200, {
			data: {
				promptTemplates: agentSession.promptTemplates.map((template) => ({
					name: template.name,
					description: template.description,
				})),
				skills: agentSession.resourceLoader.getSkills().skills.map((skill) => ({
					name: skill.name,
					description: skill.description,
				})),
				commands,
				extensions: agentSession.resourceLoader.getExtensions().extensions.map((extension) => ({
					path: extension.path,
					side: extension.side,
					sourceInfo: extension.sourceInfo,
				})),
				extensionErrors: agentSession.resourceLoader.getExtensions().errors.map((error) => ({
					path: error.path,
					error: error.error,
				})),
				tools: agentSession.agent.state.tools.map((tool) => ({
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters,
				})),
			},
		});
	});

	router.add("POST", "/pi/session/:id/command", async (route) => {
		const session = ctx.registry.get(route.params.id ?? "");
		if (!session) {
			sendError(route.res, 404, "NotFoundError", `Unknown session: ${route.params.id}`);
			return;
		}
		const body = (await readJson(route)) as RpcCommand | undefined;
		if (!body || typeof body !== "object" || typeof body.type !== "string") {
			sendError(route.res, 400, "BadRequestError", "Expected an RPC command");
			return;
		}
		try {
			const response = await session.controller.handle(body);
			sendJson(route.res, 200, { data: response ?? null });
		} catch (error) {
			sendError(route.res, 500, "InternalError", errorMessage(error));
		}
	});

	router.add("POST", "/pi/session/:id/extension-ui", async (route) => {
		const body = (await readJson(route)) as RpcExtensionUIResponse | undefined;
		if (!body || typeof body.id !== "string") {
			sendError(route.res, 400, "BadRequestError", "Expected an extension UI response");
			return;
		}
		ctx.answerExtensionUi(route.params.id ?? "", body);
		sendJson(route.res, 200, { data: { ok: true } });
	});

	router.add("POST", "/pi/session/:id/render", async (route) => {
		const session = ctx.registry.get(route.params.id ?? "");
		if (!session) {
			sendError(route.res, 404, "NotFoundError", `Unknown session: ${route.params.id}`);
			return;
		}
		const body = await readJson(route);
		if (!isRenderRequest(body)) {
			sendError(route.res, 400, "BadRequestError", "Expected a render request");
			return;
		}
		try {
			const lines = await renderOnServer(session, body, serverKeybindings(ctx.agentDir));
			sendJson(route.res, 200, { lines });
		} catch (error) {
			sendError(route.res, 500, "InternalError", errorMessage(error));
		}
	});

	router.add("GET", "/pi/session/:id/manifest", ({ res, params }) => {
		sendManifest(res, ctx, params.id ?? "");
	});

	router.add("GET", "/pi/manifest/:id", ({ res, params }) => {
		sendManifest(res, ctx, params.id ?? "");
	});

	router.add("GET", "/pi/manifest", ({ res, url }) => {
		sendManifest(res, ctx, url.searchParams.get("session") ?? "");
	});

	router.add("GET", "/pi/session/:id/events", ({ res, params }) => {
		const session = ctx.registry.get(params.id ?? "");
		if (!session) {
			sendError(res, 404, "NotFoundError", `Unknown session: ${params.id}`);
			return;
		}
		const connection = openSse(res);
		ctx.trackSse(connection);
		connection.send(sseFrame({ id: randomUUID(), type: "session.connected", data: {} }));
		const unsubscribe = session.controller.subscribe((event) => {
			connection.send(sseFrame({ id: randomUUID(), type: event.type, data: event }));
		});
		const unsubscribeSessionEvents = ctx.subscribeSessionEvents(params.id ?? "", (event) => {
			connection.send(sseFrame({ id: randomUUID(), type: "extension_ui_request", data: event }));
		});
		res.on("close", () => {
			unsubscribe();
			unsubscribeSessionEvents();
			ctx.untrackSse(connection);
			connection.close();
		});
	});
}

async function readJson(route: RouteContext): Promise<unknown> {
	try {
		return await route.json();
	} catch {
		return undefined;
	}
}

/**
 * The keys the server binds, per agent directory.
 *
 * The keybindings are read from the agent directory, so they are read once per server
 * instead of once per request.
 */
const keybindingsByAgentDir = new Map<string, KeybindingsManager>();

function serverKeybindings(agentDir: string): KeybindingsManager {
	const cached = keybindingsByAgentDir.get(agentDir);
	if (cached) return cached;
	const keybindings = KeybindingsManager.create(agentDir);
	keybindingsByAgentDir.set(agentDir, keybindings);
	return keybindings;
}

/**
 * The trust store of the server, per agent directory.
 *
 * The trust store lives in the agent directory, so the client and the server share it:
 * the client asks, the server decides.
 */
const trustStoresByAgentDir = new Map<string, ProjectTrustStore>();

function serverTrustStore(agentDir: string): ProjectTrustStore {
	const cached = trustStoresByAgentDir.get(agentDir);
	if (cached) return cached;
	const store = new ProjectTrustStore(agentDir);
	trustStoresByAgentDir.set(agentDir, store);
	return store;
}

/**
 * The settings of the server, per agent directory.
 *
 * The settings decide whether a project is trusted without asking, so the handshake has
 * to read them.
 */
const settingsByAgentDir = new Map<string, SettingsManager>();

function serverSettings(agentDir: string, cwd: string): SettingsManager {
	const cached = settingsByAgentDir.get(agentDir);
	if (cached) return cached;
	const settings = SettingsManager.create(cwd, agentDir);
	settingsByAgentDir.set(agentDir, settings);
	return settings;
}

/**
 * The resource paths of the server, per scope.
 *
 * The packages belong to the server, so the paths of the resources they hold are
 * resolved here and not in the client.
 */
async function serverResolvedPaths(ctx: ServerContext): Promise<{ global: ResolvedPaths; project: ResolvedPaths }> {
	const globalSettingsManager = SettingsManager.create(ctx.cwd, ctx.agentDir, { projectTrusted: false });
	const global = await new DefaultPackageManager({
		cwd: ctx.cwd,
		agentDir: ctx.agentDir,
		settingsManager: globalSettingsManager,
	}).resolve();
	const settingsManager = serverSettings(ctx.agentDir, ctx.cwd);
	if (!settingsManager.isProjectTrusted()) {
		return { global, project: global };
	}
	const project = await new DefaultPackageManager({
		cwd: ctx.cwd,
		agentDir: ctx.agentDir,
		settingsManager,
	}).resolve();
	return { global, project };
}

/**
 * The directory a session-open request is about.
 *
 * The session runs in the directory of the server, unless the request asks for another
 * one. A session that is resumed runs in the directory of its session file, because
 * that is the directory the server has to trust.
 */
function refusedCwd(body: CreatePiSessionBody, ctx: ServerContext): string {
	if (typeof body.resume === "string" && body.resume !== "recent") {
		try {
			return SessionManager.open(body.resume).getCwd();
		} catch {
			return ctx.cwd;
		}
	}
	return body.cwd ?? ctx.cwd;
}

/**
 * The handshake of the server: its directory and the trust state of that directory.
 *
 * The server owns the working directory, so the client works in the directory of the
 * server and never in its own. The trust state tells the client whether it has to ask
 * before it opens a session.
 */
function serverHandshake(ctx: ServerContext): ServerHandshake {
	const decision = serverTrustStore(ctx.agentDir).get(ctx.cwd);
	const policy = serverSettings(ctx.agentDir, ctx.cwd).getDefaultProjectTrust();
	return {
		cwd: ctx.cwd,
		trust: {
			required: hasTrustRequiringProjectResources(ctx.cwd),
			decided: decision !== null,
			trusted: policy === "always" ? true : policy === "never" ? false : decision === true,
		},
		agentDir: ctx.agentDir,
	};
}

/**
 * Answer with the manifest of a session.
 *
 * The manifest tells the client what the server loaded and how it is configured, so the
 * client can refuse to start when the two do not match.
 */
function sendManifest(res: ServerResponse, ctx: ServerContext, sessionId: string): void {
	const session = ctx.registry.get(sessionId);
	if (!session) {
		sendError(res, 404, "NotFoundError", `Unknown session: ${sessionId}`);
		return;
	}
	const agentSession = session.runtime.session;
	const manifest = buildManifest({
		version: getServerVersion(),
		cwd: ctx.cwd,
		session: agentSession,
		settingsManager: agentSession.settingsManager,
		keybindings: serverKeybindings(ctx.agentDir),
	});
	sendJson(res, 200, { data: manifest });
}

/**
 * Whether the body of a render request is a request the server can answer.
 *
 * The body comes from the network, so it is checked before it is used.
 */
function isRenderRequest(value: unknown): value is RenderRequest {
	if (!value || typeof value !== "object" || !("kind" in value)) return false;
	const kind = value.kind;
	if (kind === "tool") {
		if (!("toolName" in value) || typeof value.toolName !== "string") return false;
		if (!("result" in value) || value.result === undefined) return true;
		if (!value.result || typeof value.result !== "object") return false;
		return "content" in value.result && Array.isArray(value.result.content);
	}
	if (kind === "message" || kind === "entry") {
		return "customType" in value && typeof value.customType === "string";
	}
	if (kind === "header" || kind === "footer") return true;
	if (kind === "custom") {
		if ("title" in value && value.title !== undefined && typeof value.title !== "string") return false;
		if ("prefill" in value && value.prefill !== undefined && typeof value.prefill !== "string") return false;
		return true;
	}
	return false;
}

/**
 * Render a piece of the transcript on the server.
 *
 * The extension renderers live in the server's process, so this is the only place that can
 * draw what they draw. The built-in renderers are the fallback, so the answer is the same
 * as what the client would have drawn, unless an extension changed it.
 */
async function renderOnServer(
	session: ServerSession,
	request: RenderRequest,
	keybindings: KeybindingsManager,
): Promise<string[]> {
	const agentSession = session.runtime.session;
	switch (request.kind) {
		case "tool":
			return renderTool(agentSession, request);
		case "message":
			return renderMessage(agentSession, request);
		case "entry":
			return renderEntry(agentSession, request);
		case "header":
			return renderExtensionHeader(session, renderTheme(agentSession));
		case "footer":
			return renderExtensionFooter(session, renderTheme(agentSession));
		case "custom":
			return renderExtensionCustom(session, renderTheme(agentSession), keybindings);
	}
}

/**
 * Render a tool call, and its result when it already ran.
 *
 * The call and the result share the renderer state, the way they share it in the client,
 * so a renderer that draws the result from the call (the edit renderer draws the diff of
 * the pending edit) sees the same thing it would see there.
 */
async function renderTool(
	agentSession: AgentSession,
	request: Extract<RenderRequest, { kind: "tool" }>,
): Promise<string[]> {
	const renderers = agentSession.extensionRunner.resolveToolRenderers(request.toolName, () =>
		withBuiltInRenderers(request.toolName, agentSession.getToolDefinition(request.toolName)),
	);
	if (!renderers) return [];

	const activeTheme = renderTheme(agentSession);
	const state: ServerRenderState = {};
	const redraw = Promise.withResolvers<void>();
	let redrawPending = false;
	const context: ToolRenderContext = {
		args: request.args,
		toolCallId: request.toolCallId ?? "",
		invalidate: () => {
			if (redrawPending) return;
			redrawPending = true;
			redraw.resolve();
		},
		lastComponent: undefined,
		state,
		cwd: agentSession.sessionManager.getCwd(),
		executionStarted: request.result !== undefined,
		argsComplete: true,
		isPartial: request.isPartial ?? false,
		expanded: request.expanded ?? false,
		showImages: true,
		isError: request.result?.isError ?? false,
		durationMs: request.result?.durationMs,
		outputPad: 1,
	};

	const draw = (): string[] => {
		const lines: string[] = [];
		try {
			if (renderers.renderCall) {
				try {
					const component = renderers.renderCall(request.args, activeTheme, {
						...context,
						lastComponent: undefined,
					});
					if (component) lines.push(...component.render(SERVER_RENDER_WIDTH));
				} catch {
					// A renderer that fails must not take the whole row down.
				}
			}
			if (request.result !== undefined && renderers.renderResult) {
				// The renderers expect the result of the tool itself; the client sends what it holds.
				const toolResult = request.result as AgentToolResult<unknown>;
				try {
					const component = renderers.renderResult(
						toolResult,
						{ expanded: context.expanded, isPartial: context.isPartial },
						activeTheme,
						{ ...context, lastComponent: undefined },
					);
					if (component) lines.push(...component.render(SERVER_RENDER_WIDTH));
				} catch {
					// A renderer that fails must not take the whole row down.
				}
			}
		} finally {
			// A renderer may start a timer for a row that is still running, and the server
			// must not keep it.
			if (state.interval) {
				clearInterval(state.interval);
				state.interval = undefined;
			}
		}
		return lines;
	};

	const lines = draw();
	if (!redrawPending) return lines;

	// A renderer started work that finishes later (the edit renderer computes the diff of
	// a pending edit), so the server waits for it and draws the row again.
	const timer = setTimeout(() => redraw.resolve(), RENDER_SETTLE_MS);
	timer.unref?.();
	await redraw.promise;
	clearTimeout(timer);
	return draw();
}

/** Render a custom message with the renderer of the extension that registered it. */
function renderMessage(agentSession: AgentSession, request: Extract<RenderRequest, { kind: "message" }>): string[] {
	const renderer = agentSession.extensionRunner.getMessageRenderer(request.customType);
	if (!renderer) return [];
	// The renderer expects the custom message; the client sends the message it holds.
	const message = request.message as CustomMessage<unknown>;
	try {
		const component = renderer(message, { expanded: false, outputPad: 1 }, renderTheme(agentSession));
		return component ? component.render(SERVER_RENDER_WIDTH) : [];
	} catch {
		return [];
	}
}

/** Render a custom entry with the renderer of the extension that registered it. */
function renderEntry(agentSession: AgentSession, request: Extract<RenderRequest, { kind: "entry" }>): string[] {
	const renderer = agentSession.extensionRunner.getEntryRenderer(request.customType);
	if (!renderer) return [];
	// The renderer expects the custom entry; the client sends the entry it holds.
	const entry = request.entry as CustomEntry<unknown>;
	try {
		const component = renderer(entry, { expanded: false }, renderTheme(agentSession));
		return component ? component.render(SERVER_RENDER_WIDTH) : [];
	} catch {
		return [];
	}
}

/**
 * The theme the server renders with.
 *
 * The renderers use the theme of the process, so the process theme follows the theme the
 * session's settings name. The theme is loaded once and reloaded when the name changes.
 */
function renderTheme(agentSession: AgentSession): Theme {
	const name = agentSession.settingsManager.getTheme();
	if (!renderThemeReady || name !== renderThemeName) {
		initTheme(name);
		renderThemeName = name;
		renderThemeReady = true;
	}
	return theme;
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
