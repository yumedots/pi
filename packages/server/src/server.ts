/**
 * The pi server.
 *
 * The server owns the agent runtime: it survives client crashes, resumes interrupted work
 * after a restart and shuts itself down when nothing is connected and nothing is running.
 * It speaks the opencode HTTP subset so the opencode clients can drive it, and the pi
 * native routes the pi client uses.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentSessionEvent,
	CreateAgentSessionRuntimeFactory,
	ModelRuntime,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createPairingCode, issueSessionToken, verifyBasicAuth, verifyCredential } from "./auth.ts";
import { EventFeed } from "./events.ts";
import { Router, sendError, sendJson } from "./http/router.ts";
import { openSse, SSE_HEARTBEAT, type SseConnection, sseFrame } from "./http/sse.ts";
import { IdleWatchdog } from "./idle.ts";
import { resumeInterruptedSessions } from "./recovery.ts";
import { clearRegistration, writeRegistration } from "./registration.ts";
import { registerOpencodeRoutes, setLocationModelRuntime } from "./routes/opencode.ts";
import { type OpencodeEvent, toOpencodeEvent } from "./routes/opencode-shapes.ts";
import { registerPiRoutes } from "./routes/pi.ts";
import { EXTENSION_UI_TIMEOUT_MS, type ServerContext } from "./server-context.ts";
import { SessionRegistry } from "./session-registry.ts";

/** The options of {@link startServer}. */
export interface PiServerOptions {
	/** The interface to bind. Defaults to `127.0.0.1`. */
	hostname?: string;
	/** The port to bind. `0` asks the OS for a free port. */
	port?: number;
	/** The password clients authenticate with. A random one is generated when omitted. */
	password?: string;
	/** The agent directory. Defaults to the pi agent directory. */
	agentDir?: string;
	/** The working directory of the server. */
	cwd?: string;
	/** The factory that builds runtimes. */
	createRuntime?: CreateAgentSessionRuntimeFactory;
	/**
	 * The model runtime of the server's own location.
	 *
	 * The opencode clients read the model catalog of a location, not of a session, so the
	 * server answers with this runtime when no session is open. The server builds one
	 * from the agent directory when this is omitted.
	 */
	modelRuntime?: ModelRuntime;
	/** The registry to use. A new one is created when omitted. */
	registry?: SessionRegistry;
	/** The server version reported by `/api/info`. */
	version?: string;
	/** How long the server stays up without a connected client. `0` disables the watchdog. */
	idleTimeoutMs?: number;
	/** Called when the server shuts itself down because it was idle. */
	onIdle?: () => void;
	/** Whether the interrupted sessions are resumed on boot. */
	resumeInterrupted?: boolean;
}

/**
 * The opencode event stream.
 *
 * Every subscriber gets the same frame, encoded once. The frames carry opencode's event
 * names, so the opencode clients recognize them.
 */
class OpencodeEventStream {
	private readonly subscribers = new Set<(frame: string) => void>();

	/** Publish one event to every subscriber. */
	publish(event: OpencodeEvent): void {
		if (this.subscribers.size === 0) return;
		const frame = sseFrame(event);
		for (const subscriber of this.subscribers) subscriber(frame);
	}

	/** Subscribe to the stream. */
	subscribe(send: (frame: string) => void): () => void {
		this.subscribers.add(send);
		return () => {
			this.subscribers.delete(send);
		};
	}
}

/** A running server. */
export interface PiServer {
	/** The base URL of the server. */
	readonly url: string;
	/** The port the server listens on. */
	readonly port: number;
	/** The process id of the server. */
	readonly pid: number;
	/** The password clients authenticate with. */
	readonly password: string;
	/** The sessions the server hosts. */
	readonly registry: SessionRegistry;
	/** The event feed. */
	readonly feed: EventFeed;
	/** The route table, for the parity harness. */
	readonly router: Router;
	/** The number of connected clients. */
	readonly connectedClients: number;
	/** Stop the server and release everything. */
	close(): Promise<void>;
}

/**
 * Start the server.
 */
export async function startServer(options: PiServerOptions = {}): Promise<PiServer> {
	const hostname = options.hostname ?? "127.0.0.1";
	const requestedPort = options.port ?? 4096;
	const password = options.password ?? randomBytes(24).toString("hex");
	const agentDir = options.agentDir ?? getAgentDir();
	const version = options.version ?? "1.3.0";
	const cwd = options.cwd ?? process.cwd();

	const id = randomUUID();
	const feed = new EventFeed();
	const opencodeEvents = new OpencodeEventStream();
	const pairingCodes = new Map<string, number>();
	const sseConnections = new Set<SseConnection>();
	const pendingExtensionUi = new Map<string, (response: RpcExtensionUIResponse) => void>();
	const sessionEventListeners = new Map<string, Set<(event: unknown) => void>>();

	const registry =
		options.registry ??
		new SessionRegistry({
			agentDir,
			createRuntime: options.createRuntime ?? (() => Promise.reject(new Error("no runtime factory configured"))),
			settingsManager: SettingsManager.create(cwd, agentDir),
			onEvent: (sessionId, event) => {
				publishEvent(sessionId, event);
			},
			requestExtensionUi: (sessionId, request) => handleExtensionUiRequest(sessionId, request),
		});

	function handleExtensionUiRequest(
		sessionId: string,
		request: RpcExtensionUIRequest,
	): Promise<RpcExtensionUIResponse> {
		if (feed.subscriberCount > 0) {
			feed.publish({ type: "extension_ui_request", data: { sessionID: sessionId, ...request } });
		}
		ctx.publishSessionEvent(sessionId, { ...request });
		const { promise, resolve } = Promise.withResolvers<RpcExtensionUIResponse>();
		ctx.registerExtensionUiRequest(sessionId, request, resolve);
		return promise;
	}

	function publishEvent(sessionId: string, event: AgentSessionEvent): void {
		const withSession = { sessionID: sessionId, ...(event as object) } as unknown as AgentSessionEvent;
		// The global feed keeps the pi events for the embedders that subscribe to it.
		if (feed.subscriberCount > 0) feed.publish({ type: event.type, data: withSession });
		// The opencode stream carries the opencode event names.
		opencodeEvents.publish(toOpencodeEvent(withSession));
	}

	const ctx: ServerContext = {
		registry,
		feed,
		cwd,
		agentDir,
		password,
		trackSse(connection: SseConnection): void {
			sseConnections.add(connection);
		},
		untrackSse(connection: SseConnection): void {
			sseConnections.delete(connection);
		},
		connectedClients(): number {
			return sseConnections.size;
		},
		publishEvent,
		publishSessionEvent(sessionId: string, event: unknown): void {
			const listeners = sessionEventListeners.get(sessionId);
			if (!listeners) return;
			for (const listener of listeners) {
				listener(event);
			}
		},
		subscribeSessionEvents(sessionId: string, listener: (event: unknown) => void): () => void {
			let listeners = sessionEventListeners.get(sessionId);
			if (!listeners) {
				listeners = new Set();
				sessionEventListeners.set(sessionId, listeners);
			}
			listeners.add(listener);
			return () => {
				listeners?.delete(listener);
			};
		},
		answerExtensionUi(sessionId: string, response: RpcExtensionUIResponse): void {
			const key = `${sessionId}:${response.id}`;
			const resolve = pendingExtensionUi.get(key);
			if (!resolve) return;
			pendingExtensionUi.delete(key);
			resolve(response);
		},
		registerExtensionUiRequest(
			sessionId: string,
			request: RpcExtensionUIRequest,
			resolve: (response: RpcExtensionUIResponse) => void,
		): void {
			const key = `${sessionId}:${request.id}`;
			pendingExtensionUi.set(key, resolve);
			setTimeout(() => {
				const pending = pendingExtensionUi.get(key);
				if (!pending) return;
				pendingExtensionUi.delete(key);
				pending({ type: "extension_ui_response", id: request.id, cancelled: true });
			}, EXTENSION_UI_TIMEOUT_MS).unref?.();
		},
	};

	const router = new Router();

	const isPublic = (pathname: string): boolean => pathname === "/api/pair" || pathname.startsWith("/auth/connect/");

	const authenticate = (req: IncomingMessage): boolean => {
		const header = req.headers.authorization;
		if (!header) return false;
		const [scheme, encoded] = header.split(" ");
		if (scheme?.toLowerCase() !== "basic" || !encoded) return false;
		let decoded: string;
		try {
			decoded = Buffer.from(encoded, "base64").toString("utf8");
		} catch {
			return false;
		}
		const separator = decoded.indexOf(":");
		if (separator === -1) return false;
		const credential = decoded.slice(separator + 1);
		return verifyBasicAuth(header, password) || verifyCredential(credential, password);
	};

	router.add("GET", "/api/info", ({ res }) => {
		sendJson(res, 200, {
			version,
			pid: process.pid,
			urls: [url],
			paths: { tmp: join(tmpdir(), "pi") },
			capabilities: { persistentPty: false },
		});
	});

	router.add("POST", "/api/pair", ({ res }) => {
		const pairing = createPairingCode();
		pairingCodes.set(pairing.code, pairing.expiresAt);
		sendJson(res, 200, { code: pairing.code, expires_in: 300 });
	});

	router.add("GET", "/auth/connect/:code", ({ res, params }) => {
		const code = params.code ?? "";
		const expiresAt = pairingCodes.get(code);
		if (!expiresAt || expiresAt <= Date.now()) {
			pairingCodes.delete(code);
			sendError(res, 404, "NotFoundError", "Unknown or expired pairing code");
			return;
		}
		pairingCodes.delete(code);
		// The code lives five minutes; the token it hands out is the password of the
		// client, so it lives as long as an opencode session.
		sendJson(res, 200, { token: issueSessionToken(password) });
	});

	router.add("GET", "/api/event", ({ res }) => {
		const connection = openSse(res);
		ctx.trackSse(connection);
		connection.send(sseFrame({ id: randomUUID(), type: "server.connected", created: Date.now(), data: {} }));
		const unsubscribe = opencodeEvents.subscribe((frame) => connection.send(frame));
		const heartbeat = setInterval(() => {
			connection.send(SSE_HEARTBEAT);
		}, 15_000);
		heartbeat.unref?.();
		res.on("close", () => {
			clearInterval(heartbeat);
			unsubscribe();
			ctx.untrackSse(connection);
			connection.close();
		});
	});

	if (options.modelRuntime) setLocationModelRuntime(ctx, options.modelRuntime);
	registerOpencodeRoutes(router, ctx);
	registerPiRoutes(router, ctx);

	let closing = false;
	const closeServer = async (): Promise<void> => {
		if (closing) return;
		closing = true;
		watchdog.stop();
		clearRegistration(agentDir, id);
		for (const connection of sseConnections) {
			connection.close();
		}
		sseConnections.clear();
		feed.closeAll();
		pendingExtensionUi.clear();
		await registry.closeAll();
		await new Promise<void>((resolve) => {
			httpServer.close(() => resolve());
			httpServer.closeAllConnections?.();
		});
	};

	const idleTimeoutMs = options.idleTimeoutMs ?? 0;
	const watchdog = new IdleWatchdog({
		idleTimeoutMs,
		intervalMs: idleTimeoutMs > 0 ? Math.min(15_000, Math.max(50, Math.floor(idleTimeoutMs / 4))) : 15_000,
		isIdle: () => ctx.connectedClients() === 0 && !registry.busy,
		onIdle: () => {
			void closeServer().then(() => options.onIdle?.());
		},
	});

	const httpServer = createServer((req, res) => {
		const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
		if (!isPublic(pathname) && !authenticate(req)) {
			res.setHeader("www-authenticate", 'Basic realm="pi"');
			sendJson(res, 401, { _tag: "UnauthorizedError", message: "Authentication required" });
			return;
		}
		void router.handle(req, res).then((handled) => {
			if (handled) return;
			sendError(res, 404, "NotFoundError", `No route for ${req.method} ${pathname}`);
		});
	});

	await new Promise<void>((resolve, reject) => {
		httpServer.once("error", reject);
		httpServer.listen(requestedPort, hostname, () => {
			httpServer.off("error", reject);
			resolve();
		});
	});

	const address = httpServer.address();
	if (address === null || typeof address === "string") {
		await new Promise<void>((resolve) => httpServer.close(() => resolve()));
		throw new Error("The server did not bind to a TCP port");
	}
	const port = address.port;
	const url = `http://${hostname}:${port}`;

	if (options.resumeInterrupted && !options.registry) {
		await resumeInterruptedSessions(registry, agentDir);
	}
	writeRegistration(agentDir, { id, version, url, pid: process.pid, password });
	watchdog.start();

	return {
		url,
		port,
		pid: process.pid,
		password,
		registry,
		feed,
		router,
		get connectedClients(): number {
			return ctx.connectedClients();
		},
		close: closeServer,
	};
}
