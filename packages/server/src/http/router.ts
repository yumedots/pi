/**
 * Minimal HTTP router with `:param` path segments.
 *
 * The server has no framework dependency: the route table is small, the matching rules are
 * simple, and the parity harness needs to read the real table.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** The path parameters extracted from a matched route. */
export type RouteParams = Record<string, string>;

/** Everything a route handler needs to answer a request. */
export interface RouteContext {
	req: IncomingMessage;
	res: ServerResponse;
	params: RouteParams;
	url: URL;
	/** Reads and parses the JSON body. Returns `undefined` when the body is empty. */
	json(): Promise<unknown>;
}

/** A route handler. Returning `true` means the handler answered the request. */
export type RouteHandler = (ctx: RouteContext) => undefined | boolean | Promise<undefined | boolean>;

interface Route {
	method: string;
	path: string;
	handler: RouteHandler;
	segments: string[];
}

/**
 * The error body shape the opencode clients expect.
 */
export interface ApiErrorBody {
	_tag: string;
	message: string;
}

/** Send a JSON body with the given status. */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(payload),
	});
	res.end(payload);
}

/** Send an opencode-shaped error body. */
export function sendError(res: ServerResponse, status: number, tag: string, message: string): void {
	sendJson(res, status, { _tag: tag, message } satisfies ApiErrorBody);
}

/**
 * A path-pattern router.
 */
export class Router {
	private readonly routeTable: Route[] = [];

	/**
	 * Register a route.
	 *
	 * @param method The HTTP method, uppercase.
	 * @param path The path pattern, with `:name` placeholders for parameters.
	 * @param handler The handler.
	 */
	add(method: string, path: string, handler: RouteHandler): void {
		this.routeTable.push({
			method: method.toUpperCase(),
			path,
			handler,
			segments: path.split("/").filter((segment) => segment.length > 0),
		});
	}

	/**
	 * The registered routes, in registration order.
	 */
	routes(): ReadonlyArray<{ method: string; path: string }> {
		return this.routeTable.map((route) => ({ method: route.method, path: route.path }));
	}

	/**
	 * Match a request path.
	 *
	 * @returns The route and its parameters, or `undefined`.
	 */
	match(method: string, pathname: string): { route: Route; params: RouteParams } | undefined {
		const parts = pathname.split("/").filter((segment) => segment.length > 0);
		for (const route of this.routeTable) {
			if (route.method !== method.toUpperCase()) continue;
			if (route.segments.length !== parts.length) continue;
			const params: RouteParams = {};
			let matched = true;
			for (let index = 0; index < route.segments.length; index++) {
				const segment = route.segments[index]!;
				const part = parts[index]!;
				if (segment.startsWith(":")) {
					params[segment.slice(1)] = decodeURIComponent(part);
					continue;
				}
				if (segment !== part) {
					matched = false;
					break;
				}
			}
			if (matched) return { route, params };
		}
		return undefined;
	}

	/**
	 * Handle a request.
	 *
	 * @returns `false` when no route matched, so the caller can answer with a 404.
	 */
	async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
		const url = new URL(req.url ?? "/", "http://localhost");
		const matched = this.match(req.method ?? "GET", url.pathname);
		if (!matched) return false;

		const body = createBodyReader(req);
		const ctx: RouteContext = {
			req,
			res,
			params: matched.params,
			url,
			json: body,
		};
		const handled = await matched.route.handler(ctx);
		if (handled === false) return false;
		return true;
	}
}

/**
 * Read and parse a JSON request body.
 */
export function createBodyReader(req: IncomingMessage): () => Promise<unknown> {
	return async () => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
		}
		if (chunks.length === 0) return undefined;
		const text = Buffer.concat(chunks).toString("utf8").trim();
		if (text.length === 0) return undefined;
		return JSON.parse(text);
	};
}
