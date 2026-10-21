/**
 * The opencode routes the pi server must implement.
 *
 * The list is the dependency set of the opencode clients: the routes the iOS app calls.
 * The parity harness compares it with the real route table of the server.
 */

import { EventFeed } from "../events.ts";
import { Router } from "../http/router.ts";
import type { ServerContext } from "../server-context.ts";
import type { SessionRegistry } from "../session-registry.ts";
import { registerOpencodeRoutes } from "./opencode.ts";
import { registerPiRoutes } from "./pi.ts";

/** One required route. */
export interface RequiredOpencodeRoute {
	/** The HTTP method. */
	method: string;
	/** The path, with `:name` for the parameters. */
	path: string;
	/** The opencode operation id. */
	operationId: string;
}

/** The routes the opencode clients depend on. */
export const REQUIRED_OPENCODE_ROUTES: readonly RequiredOpencodeRoute[] = [
	{ method: "GET", path: "/api/info", operationId: "server.info" },
	{ method: "POST", path: "/api/pair", operationId: "server.pair" },
	{ method: "GET", path: "/auth/connect/:code", operationId: "server.connect" },
	{ method: "GET", path: "/api/session", operationId: "session.list" },
	{ method: "POST", path: "/api/session", operationId: "session.create" },
	{ method: "GET", path: "/api/session/:id", operationId: "session.get" },
	{ method: "DELETE", path: "/api/session/:id", operationId: "session.remove" },
	{ method: "PATCH", path: "/api/session/:id", operationId: "session.update" },
	{ method: "POST", path: "/api/session/:id/prompt", operationId: "session.prompt" },
	{ method: "GET", path: "/api/session/:id/message", operationId: "session.message.list" },
	{ method: "POST", path: "/api/session/:id/interrupt", operationId: "session.interrupt" },
	{ method: "POST", path: "/api/session/:id/compact", operationId: "session.compact" },
	{ method: "GET", path: "/api/event", operationId: "event.subscribe" },
	{ method: "GET", path: "/api/model", operationId: "model.list" },
	{ method: "GET", path: "/api/model/default", operationId: "model.default" },
	{ method: "GET", path: "/api/provider", operationId: "provider.list" },
	{ method: "GET", path: "/api/agent", operationId: "agent.list" },
	{ method: "GET", path: "/api/command", operationId: "command.list" },
	{
		method: "POST",
		path: "/api/session/:id/permission/:requestID/reply",
		operationId: "session.permission.reply",
	},
];

/**
 * The opencode routes the server registers itself, outside the route modules.
 *
 * `server.ts` registers these four routes before it registers the route modules, because
 * they need the server's own state: the pairing codes, the event feed and the server
 * version. The parity harness reads them from here, so the list has to stay in sync with
 * `server.ts`.
 */
export const SERVER_CORE_ROUTES: readonly RequiredOpencodeRoute[] = [
	{ method: "GET", path: "/api/info", operationId: "server.info" },
	{ method: "POST", path: "/api/pair", operationId: "server.pair" },
	{ method: "GET", path: "/auth/connect/:code", operationId: "server.connect" },
	{ method: "GET", path: "/api/event", operationId: "event.subscribe" },
];

/**
 * Normalize a route path, so the paths of two APIs can be compared.
 *
 * opencode writes its parameters as `{sessionID}`, the pi server writes them as `:id`.
 * Both become `*`, so `/api/session/{sessionID}` and `/api/session/:id` are the same route.
 */
export function normalizeRoutePath(path: string): string {
	return path
		.split("/")
		.map((segment) => {
			if (segment.startsWith(":") || segment.startsWith("{")) return "*";
			return segment;
		})
		.join("/");
}

/**
 * The key of a route in a comparison: the method and the normalized path.
 */
export function routeKey(method: string, path: string): string {
	return `${method.toUpperCase()} ${normalizeRoutePath(path)}`;
}

/**
 * A context that never serves traffic: the parity harness only reads the route table.
 */
export function createParityContext(): ServerContext {
	const registry = {
		sessions: new Map(),
		list: async () => [],
		get: () => undefined,
		close: async () => {},
		closeAll: async () => {},
	} as unknown as SessionRegistry;
	return {
		registry,
		feed: new EventFeed(),
		cwd: process.cwd(),
		agentDir: "",
		password: "",
		trackSse: () => {},
		untrackSse: () => {},
		connectedClients: () => 0,
		publishEvent: () => {},
		publishSessionEvent: () => {},
		subscribeSessionEvents: () => () => {},
		answerExtensionUi: () => {},
		registerExtensionUiRequest: () => {},
	} as unknown as ServerContext;
}

/**
 * The route table of the server, built the way `server.ts` builds it.
 */
export function buildRouteTable(ctx: ServerContext = createParityContext()): Router {
	const router = new Router();
	for (const route of SERVER_CORE_ROUTES) {
		router.add(route.method, route.path, () => undefined);
	}
	registerOpencodeRoutes(router, ctx);
	registerPiRoutes(router, ctx);
	return router;
}
