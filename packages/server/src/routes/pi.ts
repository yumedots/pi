/**
 * The pi-native HTTP surface.
 *
 * These routes are what the pi client uses: the session list, the session state snapshot,
 * the command channel and the event stream. They carry the raw pi protocol, so the client
 * does not need a translation layer.
 */

import { randomUUID } from "node:crypto";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
	type AgentSession,
	BUILTIN_SLASH_COMMANDS,
	type RpcCommand,
	type RpcExtensionUIResponse,
} from "@earendil-works/pi-coding-agent";
import type { ToolRenderContext } from "@earendil-works/pi-coding-agent/core/extensions/types";
import type { CustomMessage } from "@earendil-works/pi-coding-agent/core/messages";
import type { CustomEntry } from "@earendil-works/pi-coding-agent/core/session-manager";
import { initTheme, type Theme, theme } from "@earendil-works/pi-coding-agent/core/theme/theme";
import { withBuiltInRenderers } from "@earendil-works/pi-coding-agent/core/tools/renderers/index";
import { type RouteContext, type Router, sendError, sendJson } from "../http/router.ts";
import { openSse, sseFrame } from "../http/sse.ts";
import type { ServerContext } from "../server-context.ts";
import { toSessionStateSnapshot } from "../state.ts";
import type { RenderRequest } from "../types.ts";

/**
 * The width the server renders with.
 *
 * The client does not tell the server how wide its terminal is, so the server picks a
 * width and the client re-wraps the lines it receives.
 */
const SERVER_RENDER_WIDTH = 100;

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
			const lines = await renderOnServer(session.runtime.session, body);
			sendJson(route.res, 200, { lines });
		} catch (error) {
			sendError(route.res, 500, "InternalError", errorMessage(error));
		}
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
	return false;
}

/**
 * Render a piece of the transcript on the server.
 *
 * The extension renderers live in the server's process, so this is the only place that can
 * draw what they draw. The built-in renderers are the fallback, so the answer is the same
 * as what the client would have drawn, unless an extension changed it.
 */
async function renderOnServer(agentSession: AgentSession, request: RenderRequest): Promise<string[]> {
	switch (request.kind) {
		case "tool":
			return renderTool(agentSession, request);
		case "message":
			return renderMessage(agentSession, request);
		case "entry":
			return renderEntry(agentSession, request);
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
