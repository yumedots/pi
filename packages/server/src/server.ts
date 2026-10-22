/**
 * The pi server.
 *
 * The server owns the agent runtime: it survives client crashes, resumes interrupted work
 * after a restart and shuts itself down when nothing is connected and nothing is running.
 * It speaks the opencode HTTP subset so the opencode clients can drive it, and the pi
 * native routes the pi client uses.
 */

import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { networkInterfaces, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
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
	/**
	 * The interface to bind. Defaults to `0.0.0.0`, which listens on every interface.
	 *
	 * The server is protected by a password, so listening on every interface is what
	 * makes it reachable from a phone on the same network. A server that only listens on
	 * the loopback address is reachable from the machine it runs on and nowhere else.
	 */
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
	/**
	 * Whether the server opens a tunnel to the internet.
	 *
	 * The tunnel needs the opentunnel binary, which is not part of pi: when it is
	 * missing the server says so and runs without a tunnel.
	 */
	remote?: boolean;
	/** The opentunnel profile that holds the tunnel. */
	tunnelProfile?: string;
	/** The route name the server claims on the tunnel. */
	tunnelName?: string;
}

/**
 * Whether the hostname stands for every interface of the machine.
 */
function isWildcardHostname(hostname: string): boolean {
	return hostname === "0.0.0.0" || hostname === "::" || hostname === "[::]";
}

/**
 * Whether an interface is a virtual one that a phone cannot reach.
 *
 * The addresses of a docker bridge, a virtual machine or a tunnel are on the machine but
 * not on the network the phone is on, so advertising them would send the phone to an
 * address that does not answer.
 */
function isVirtualInterface(name: string): boolean {
	return /^(docker|br-|bridge|veth|virbr|vmnet|vboxnet|utun|tun|tap|wg|zt)/i.test(name);
}

/**
 * The addresses the server can be reached at.
 *
 * A server that binds every interface listens on the loopback address and on every
 * address of the machine, so all of them are advertised. A server that binds a single
 * interface only listens there, so only that address is advertised: an address the
 * server does not listen on is worse than no address at all, because the client tries
 * it, waits for a timeout and reports the server as unreachable.
 */
function reachableUrls(hostname: string, port: number): string[] {
	const urls: string[] = [];
	const add = (url: string): void => {
		if (!urls.includes(url)) urls.push(url);
	};
	if (!isWildcardHostname(hostname)) {
		add(`http://${hostname}:${port}`);
		return urls;
	}
	add(`http://127.0.0.1:${port}`);
	for (const [name, infos] of Object.entries(networkInterfaces())) {
		if (isVirtualInterface(name)) continue;
		for (const info of infos ?? []) {
			const isIpv4 = info.family === "IPv4" || String(info.family) === "4";
			if (!isIpv4 || info.internal) continue;
			add(`http://${info.address}:${port}`);
		}
	}
	return urls;
}

/**
 * The url the server is reached at from the machine it runs on.
 *
 * A server that binds every interface has no address of its own, so the loopback
 * address stands in for it.
 */
function localUrl(hostname: string, port: number): string {
	if (isWildcardHostname(hostname)) return `http://127.0.0.1:${port}`;
	return `http://${hostname}:${port}`;
}

/** The binary that opens the tunnel to the internet. */
export const OPENTUNNEL_BINARY = "opentunnel";

/** How long the tunnel may take to come up before the server gives up on it. */
export const TUNNEL_TIMEOUT_MS = 120_000;

/**
 * A route name for the tunnel.
 *
 * The name is random, so the address of the tunnel cannot be guessed: the tunnel
 * hostname shows up in public certificate logs. The route is given back when the server
 * stops.
 */
function randomRouteName(): string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
	const bytes = randomBytes(16);
	let name = "";
	for (const byte of bytes) name += alphabet[byte % alphabet.length]!;
	return name;
}

/** The options of {@link startRemoteTunnel}. */
export interface RemoteTunnelOptions {
	/** The port the tunnel forwards to. */
	port: number;
	/** The host the tunnel forwards to. Defaults to the loopback address. */
	host?: string;
	/** The route name on the tunnel. */
	name?: string;
	/** The opentunnel profile that holds the tunnel. */
	profile?: string;
	/** How long the tunnel may take to come up. */
	timeoutMs?: number;
}

/** What the tunnel did. */
export interface RemoteTunnelResult {
	/** Whether the tunnel came up. */
	ok: boolean;
	/** The public url of the tunnel. */
	url?: string;
	/** Why the tunnel did not come up. */
	reason?: string;
}

/**
 * Find a binary on the path.
 *
 * @returns The path of the binary, or `undefined` when it is not installed.
 */
function findExecutable(name: string): string | undefined {
	const path = process.env.PATH;
	if (!path) return undefined;
	const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
	for (const directory of path.split(delimiter)) {
		if (!directory) continue;
		for (const extension of extensions) {
			const candidate = join(directory, `${name}${extension}`);
			try {
				if (!statSync(candidate).isFile()) continue;
				accessSync(candidate, constants.X_OK);
				return candidate;
			} catch {}
		}
	}
	return undefined;
}

/** The output of a finished command. */
interface CommandResult {
	/** The exit code of the command. */
	code: number | null;
	/** Everything the command wrote to stdout. */
	stdout: string;
	/** Everything the command wrote to stderr. */
	stderr: string;
	/** Whether the command had to be killed. */
	timedOut: boolean;
}

/**
 * Run a command and collect its output.
 *
 * The command is killed when it takes longer than the timeout.
 */
function runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
	const { promise, resolve } = Promise.withResolvers<CommandResult>();
	const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	let timedOut = false;
	child.stdout?.setEncoding("utf8");
	child.stderr?.setEncoding("utf8");
	child.stdout?.on("data", (chunk: string) => {
		stdout += chunk;
	});
	child.stderr?.on("data", (chunk: string) => {
		stderr += chunk;
	});
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGTERM");
	}, timeoutMs);
	timer.unref?.();
	child.on("error", (error: Error) => {
		clearTimeout(timer);
		resolve({ code: null, stdout, stderr: `${stderr}${error.message}`, timedOut });
	});
	child.on("close", (code: number | null) => {
		clearTimeout(timer);
		resolve({ code, stdout, stderr, timedOut });
	});
	return promise;
}

/**
 * The tunnel url in the output of the tunnel command.
 *
 * The command prints the route it added and the public url of the route on separate
 * lines, so the last url it printed is the one to use.
 */
function tunnelUrlFrom(stdout: string): string | undefined {
	const urls = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("https://"));
	return urls[urls.length - 1];
}

/**
 * Open a tunnel to the server through opentunnel.
 *
 * The tunnel binary is not part of pi: the user installs it. When it is missing the
 * server says so and runs without a tunnel.
 *
 * @returns What the tunnel did.
 */
export async function startRemoteTunnel(options: RemoteTunnelOptions): Promise<RemoteTunnelResult> {
	const binary = findExecutable(OPENTUNNEL_BINARY);
	if (!binary) {
		return {
			ok: false,
			reason: `the ${OPENTUNNEL_BINARY} binary was not found on the PATH; install it with "curl -fsSL https://opentunnel.xyz/install | sh"`,
		};
	}
	const host = options.host ?? "127.0.0.1";
	const name = options.name ?? randomRouteName();
	const args = [
		...(options.profile ? ["--profile", options.profile] : []),
		"route",
		"add",
		`${host}:${options.port}`,
		"--name",
		name,
	];
	const result = await runCommand(binary, args, options.timeoutMs ?? TUNNEL_TIMEOUT_MS);
	if (result.timedOut) {
		return { ok: false, reason: `the ${OPENTUNNEL_BINARY} command did not finish in time` };
	}
	if (result.code !== 0) {
		const message =
			(result.stderr.trim() || result.stdout.trim() || "it failed without a message").split("\n")[0] ?? "";
		return { ok: false, reason: `the ${OPENTUNNEL_BINARY} command failed: ${message}` };
	}
	const url = tunnelUrlFrom(result.stdout);
	if (!url) {
		return { ok: false, reason: `the ${OPENTUNNEL_BINARY} command did not report a tunnel url` };
	}
	return { ok: true, url };
}

/**
 * Give the tunnel route back to the user.
 *
 * The route is only removed when it still points at this server, so a server that took
 * over the route of another one does not cut it off.
 */
async function removeRemoteRoute(options: {
	host: string;
	port: number;
	name: string;
	profile?: string;
}): Promise<void> {
	const binary = findExecutable(OPENTUNNEL_BINARY);
	if (!binary) return;
	const prefix = options.profile ? ["--profile", options.profile] : [];
	const target = `${options.host}:${options.port}`;
	const list = await runCommand(binary, [...prefix, "route", "list"], 5_000);
	if (list.code !== 0) return;
	if (!list.stdout.includes(target)) return;
	await runCommand(binary, [...prefix, "route", "remove", options.name], 5_000);
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
	/** The addresses the server can be reached at. */
	readonly urls: readonly string[];
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
	/** What the remote tunnel did, when one was asked for. */
	readonly tunnel: RemoteTunnelResult | undefined;
	/** Stop the server and release everything. */
	close(): Promise<void>;
}

/**
 * Start the server.
 */
export async function startServer(options: PiServerOptions = {}): Promise<PiServer> {
	const agentDir = options.agentDir ?? getAgentDir();
	const version = options.version ?? "1.3.0";
	const cwd = options.cwd ?? process.cwd();
	const settingsManager = SettingsManager.create(cwd, agentDir);
	// The settings decide which interface the server listens on.
	const hostname = options.hostname || settingsManager.getServerHostname();
	const requestedPort = options.port ?? 4096;
	const password = options.password ?? randomBytes(24).toString("hex");

	const id = randomUUID();
	const feed = new EventFeed();
	const opencodeEvents = new OpencodeEventStream();
	const pairingCodes = new Map<string, number>();
	const sseConnections = new Set<SseConnection>();
	const pendingExtensionUi = new Map<string, (response: RpcExtensionUIResponse) => void>();
	const sessionEventListeners = new Map<string, Set<(event: unknown) => void>>();
	// The addresses the server advertises. They are filled in once the server has a
	// port, and the tunnel adds its url to them when it comes up.
	const advertisedUrls: string[] = [];
	// What the remote tunnel did, when one was asked for.
	let tunnel: RemoteTunnelResult | undefined;
	// The host the tunnel forwards to.
	const tunnelHost = isWildcardHostname(hostname) ? "127.0.0.1" : hostname;
	const tunnelName = options.tunnelName ?? randomRouteName();

	const registry =
		options.registry ??
		new SessionRegistry({
			agentDir,
			createRuntime: options.createRuntime ?? (() => Promise.reject(new Error("no runtime factory configured"))),
			settingsManager,
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
			urls: [...advertisedUrls],
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
		if (tunnel?.ok) {
			await removeRemoteRoute({
				host: tunnelHost,
				port,
				name: tunnelName,
				profile: options.tunnelProfile,
			});
		}
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
	const url = localUrl(hostname, port);
	advertisedUrls.push(...reachableUrls(hostname, port));

	if (options.remote) {
		tunnel = await startRemoteTunnel({
			port,
			host: tunnelHost,
			name: tunnelName,
			profile: options.tunnelProfile,
		});
		if (tunnel.ok && tunnel.url) advertisedUrls.push(tunnel.url);
	}

	if (options.resumeInterrupted && !options.registry) {
		await resumeInterruptedSessions(registry, agentDir);
	}
	writeRegistration(agentDir, { id, version, url, pid: process.pid, password, urls: [...advertisedUrls] });
	watchdog.start();

	return {
		url,
		get urls(): readonly string[] {
			return [...advertisedUrls];
		},
		port,
		pid: process.pid,
		password,
		registry,
		feed,
		router,
		get connectedClients(): number {
			return ctx.connectedClients();
		},
		tunnel,
		close: closeServer,
	};
}
