/**
 * The pi-native HTTP surface.
 *
 * These routes are what the pi client uses: the session list, the session state snapshot,
 * the command channel and the event stream. They carry the raw pi protocol, so the client
 * does not need a translation layer.
 */

import { randomUUID } from "node:crypto";
import { BUILTIN_SLASH_COMMANDS, type RpcCommand, type RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import { type RouteContext, type Router, sendError, sendJson } from "../http/router.ts";
import { openSse, sseFrame } from "../http/sse.ts";
import type { ServerContext } from "../server-context.ts";
import { toSessionStateSnapshot } from "../state.ts";

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

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function errorTag(error: unknown): string {
	if (error && typeof error === "object" && "_tag" in error && typeof error._tag === "string") {
		return error._tag;
	}
	return "BadRequestError";
}
