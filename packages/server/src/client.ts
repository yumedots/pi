/**
 * The client SDK.
 *
 * The pi client talks to the server over HTTP and SSE. This module is the whole client
 * surface: the server info, the session list, the command channel, the event stream and the
 * extension UI answers.
 */

import type {
	AgentSessionEvent,
	RpcCommand,
	RpcExtensionUIResponse,
	RpcResponse,
} from "@earendil-works/pi-coding-agent";
import type { ResolvedPaths } from "@earendil-works/pi-coding-agent/core/package-manager";
import { basicAuthHeader } from "./auth.ts";
import type { PiManifest } from "./manifest.ts";
import type { OpencodeModelInfo } from "./routes/opencode-shapes.ts";
import type { PiServerInfo, RenderRequest, RenderResponse, ServerHandshake, SessionStateSnapshot } from "./types.ts";

export { basicAuthHeader } from "./auth.ts";
export type { PiManifest } from "./manifest.ts";
export type { ServerRegistration } from "./registration.ts";
export type { OpencodeModelInfo } from "./routes/opencode-shapes.ts";
export type {
	PiServerInfo,
	RenderRequest,
	RenderResponse,
	RenderToolResult,
	ServerHandshake,
	ServerTrustState,
	SessionStateSnapshot,
} from "./types.ts";

/** How long the client waits before it reconnects to the event stream. */
const RECONNECT_DELAY_MS = 1000;

/**
 * The event of a frame, with the type of the frame when the payload carries none.
 *
 * A session event is its own payload, so it keeps its type. The frame that opens the
 * stream carries an empty payload, so the type of the frame is what names it.
 */
function withFrameType(event: AgentSessionEvent, frameType: string | undefined): AgentSessionEvent {
	const payload = event as unknown as Record<string, unknown>;
	if (typeof payload.type === "string") return event;
	return { ...payload, type: frameType ?? "unknown" } as unknown as AgentSessionEvent;
}

/** The options of {@link PiServerClient}. */
export interface PiServerClientOptions {
	/** The base URL of the server. */
	url: string;
	/** The password, or a pairing token. */
	password: string;
	/** The fetch implementation. Defaults to the global one. */
	fetch?: typeof globalThis.fetch;
}

/** The options of {@link PiServerClient.openSession}. */
export interface OpenSessionOptions {
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

/** A session as the server lists it. */
export interface RemoteSessionInfo {
	id: string;
	path: string;
	cwd: string;
	name?: string;
	created: number;
	modified: number;
	messageCount: number;
	firstMessage: string;
	allMessagesText: string;
	busy: boolean;
}

/**
 * A client for the pi server.
 */
export class PiServerClient {
	private readonly url: string;
	private readonly password: string;
	private readonly fetchImpl: typeof globalThis.fetch;

	constructor(options: PiServerClientOptions) {
		this.url = options.url.replace(/\/$/, "");
		this.password = options.password;
		this.fetchImpl = options.fetch ?? globalThis.fetch;
	}

	/** The base URL of the server. */
	get serverUrl(): string {
		return this.url;
	}

	/**
	 * The server information.
	 */
	async info(): Promise<PiServerInfo> {
		return this.request<PiServerInfo>("GET", "/api/info");
	}

	/**
	 * The handshake of the server: its working directory and the trust state of it.
	 *
	 * The server owns the working directory: the client works in the directory of the
	 * server and never in its own. The trust state tells the client whether it has to
	 * ask the user before it opens a session.
	 */
	async handshake(): Promise<ServerHandshake> {
		const body = await this.request<ServerHandshake & { data?: ServerHandshake }>("GET", "/pi/server");
		return body.data ?? body;
	}

	/**
	 * Store the trust decision of a directory in the trust store of the server.
	 *
	 * The trust store lives in the agent directory the server uses, so both sides share
	 * it: the client asks, the server decides.
	 */
	async setTrust(cwd: string, trusted: boolean | null): Promise<void> {
		await this.request<void>("POST", "/pi/trust", { cwd, trusted });
	}

	/**
	 * Change a setting of the server.
	 *
	 * The settings belong to the server: the client draws with them and hands the
	 * changes over. The answer carries the settings the server made of the change.
	 *
	 * @param sessionId the session whose settings change; without one the settings of the
	 *   server itself change.
	 */
	async setSetting(
		key: string,
		value: unknown,
		sessionId?: string,
		scope: "global" | "project" = "global",
	): Promise<Record<string, unknown>> {
		const path = sessionId ? `/pi/session/${encodeURIComponent(sessionId)}/settings` : "/pi/settings";
		const body = await this.request<{ data: { settings: Record<string, unknown> } }>("POST", path, {
			key,
			value,
			scope,
		});
		return body.data.settings;
	}

	/**
	 * The messages of a session.
	 */
	async messages(sessionId: string): Promise<unknown[]> {
		const body = await this.request<{ data: unknown[] }>(
			"GET",
			`/pi/session/${encodeURIComponent(sessionId)}/messages`,
		);
		return body.data;
	}

	/**
	 * The widgets the extensions of a session set.
	 */
	async extensionWidgets(sessionId: string): Promise<Array<{ key: string; lines: string[]; placement?: string }>> {
		const body = await this.request<{
			data: { widgets: Array<{ key: string; lines: string[]; placement?: string }> };
		}>("GET", `/pi/session/${encodeURIComponent(sessionId)}/widgets`);
		return body.data.widgets;
	}

	/**
	 * The resource paths of the server, per scope.
	 *
	 * The packages belong to the server, so the paths of the resources they hold are
	 * resolved there.
	 */
	async paths(): Promise<{ global: ResolvedPaths; project: ResolvedPaths }> {
		const body = await this.request<{ data: { global: ResolvedPaths; project: ResolvedPaths } }>("GET", "/pi/paths");
		return body.data;
	}

	/**
	 * Give a session of the disk a name.
	 *
	 * The session files belong to the server, so the client asks it to rename one.
	 */
	async renameSession(path: string, name: string): Promise<void> {
		await this.request<void>("POST", "/pi/session/rename", { path, name });
	}

	/**
	 * The packages that have an update waiting.
	 *
	 * The packages belong to the server, so it is the one that looks for the updates.
	 */
	async packageUpdates(): Promise<string[]> {
		const body = await this.request<{ data: { updates: string[] } }>("GET", "/pi/package/updates");
		return body.data.updates;
	}

	/**
	 * The sessions the server knows about.
	 */
	async listSessions(cwd?: string): Promise<RemoteSessionInfo[]> {
		const query = cwd ? `?directory=${encodeURIComponent(cwd)}` : "";
		const body = await this.request<{ data: RemoteSessionInfo[] }>("GET", `/pi/session${query}`);
		return body.data;
	}

	/**
	 * The models the server offers.
	 *
	 * The server owns the catalog: the client asks it for the list instead of building a
	 * catalog of its own.
	 */
	async listModels(): Promise<OpencodeModelInfo[]> {
		const body = await this.request<{ data: OpencodeModelInfo[] }>("GET", "/api/model");
		return body.data;
	}

	/**
	 * Open a session on the server.
	 *
	 * The server answers with the state snapshot of the new session, so the caller does
	 * not have to ask for it again.
	 */
	async openSession(options: OpenSessionOptions = {}): Promise<SessionStateSnapshot> {
		const body: Record<string, unknown> = {};
		if (options.cwd !== undefined) body.cwd = options.cwd;
		if (options.sessionDir !== undefined) body.sessionDir = options.sessionDir;
		if (options.title !== undefined) body.title = options.title;
		if (options.model !== undefined) body.model = options.model;
		if (options.thinkingLevel !== undefined) body.thinkingLevel = options.thinkingLevel;
		if (options.resume !== undefined) body.resume = options.resume;
		const response = await this.request<{ data: SessionStateSnapshot }>("POST", "/pi/session", body);
		return response.data;
	}

	/**
	 * The state snapshot of a session.
	 */
	async getSessionState(sessionId: string): Promise<SessionStateSnapshot> {
		const body = await this.request<{ data: SessionStateSnapshot }>(
			"GET",
			`/pi/session/${encodeURIComponent(sessionId)}`,
		);
		return body.data;
	}

	/**
	 * Send a command to a session.
	 */
	async sendCommand(sessionId: string, command: RpcCommand): Promise<RpcResponse> {
		const body = await this.request<{ data: RpcResponse | null }>(
			"POST",
			`/pi/session/${encodeURIComponent(sessionId)}/command`,
			command,
		);
		if (!body.data) {
			return { id: command.id, type: "response", command: command.type, success: false, error: "no response" };
		}
		return body.data;
	}

	/**
	 * The resources of a session.
	 */
	async getSessionResources(sessionId: string): Promise<unknown> {
		const body = await this.request<{ data: unknown }>(
			"GET",
			`/pi/session/${encodeURIComponent(sessionId)}/resources`,
		);
		return body.data;
	}

	/**
	 * The manifest of the server: what it loaded and how it is configured.
	 *
	 * The client compares the extensions of the manifest with its own list and refuses to
	 * start when the two do not match.
	 */
	async manifest(sessionId: string): Promise<PiManifest> {
		const body = await this.request<PiManifest & { data?: PiManifest }>(
			"GET",
			`/pi/session/${encodeURIComponent(sessionId)}/manifest`,
		);
		return body.data ?? body;
	}

	/**
	 * Render a piece of the transcript on the server.
	 *
	 * The extension renderers live in the server's process, so the server is the only place
	 * that can draw what they draw. The server answers with the lines it produced; an empty
	 * answer means that nothing could render the piece.
	 */
	async render(sessionId: string, request: RenderRequest): Promise<RenderResponse> {
		const body = await this.request<{ lines?: string[]; data?: { lines?: string[] } }>(
			"POST",
			`/pi/session/${encodeURIComponent(sessionId)}/render`,
			request,
		);
		return { lines: body.lines ?? body.data?.lines ?? [] };
	}

	/**
	 * Answer a pending extension UI request.
	 */
	async respondExtensionUi(sessionId: string, response: RpcExtensionUIResponse): Promise<void> {
		await this.request("POST", `/pi/session/${encodeURIComponent(sessionId)}/extension-ui`, response);
	}

	/**
	 * Subscribe to the events of a session.
	 *
	 * The stream reconnects on its own, so a client that loses the connection keeps
	 * receiving events. The frames are parsed like the opencode client parses them:
	 * `data:` lines carry JSON, everything else is a comment.
	 *
	 * @returns A function that stops the subscription.
	 */
	events(sessionId: string, onEvent: (event: AgentSessionEvent) => void): () => void {
		const controller = new AbortController();
		let stopped = false;
		let reconnectTimer: NodeJS.Timeout | undefined;
		let resolveReconnect: (() => void) | undefined;

		const waitForReconnect = async (): Promise<void> => {
			const { promise, resolve } = Promise.withResolvers<void>();
			resolveReconnect = () => resolve();
			reconnectTimer = setTimeout(() => {
				reconnectTimer = undefined;
				resolveReconnect?.();
				resolveReconnect = undefined;
			}, RECONNECT_DELAY_MS);
			reconnectTimer.unref?.();
			await promise;
		};

		const connect = async (): Promise<void> => {
			while (!stopped) {
				try {
					const response = await this.fetchImpl(`${this.url}/pi/session/${encodeURIComponent(sessionId)}/events`, {
						headers: { authorization: basicAuthHeader(this.password) },
						signal: controller.signal,
					});
					if (!response.ok || !response.body) {
						throw new Error(`The server answered ${response.status}`);
					}
					await this.readFrames(response.body, onEvent);
				} catch {
					if (stopped) return;
				}
				if (stopped) return;
				await waitForReconnect();
			}
		};

		void connect();

		return () => {
			stopped = true;
			controller.abort();
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
				reconnectTimer = undefined;
			}
			resolveReconnect?.();
			resolveReconnect = undefined;
		};
	}

	private async readFrames(
		body: ReadableStream<Uint8Array>,
		onEvent: (event: AgentSessionEvent) => void,
	): Promise<void> {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		while (true) {
			const { done, value } = await reader.read();
			if (done) return;
			buffer += decoder.decode(value, { stream: true });
			let boundary = buffer.indexOf("\n\n");
			while (boundary !== -1) {
				const frame = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				this.handleFrame(frame, onEvent);
				boundary = buffer.indexOf("\n\n");
			}
		}
	}

	private handleFrame(frame: string, onEvent: (event: AgentSessionEvent) => void): void {
		const data = frame
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice("data:".length).trim())
			.join("\n");
		if (data.length === 0) return;
		try {
			const parsed = JSON.parse(data) as { type?: string; data?: AgentSessionEvent };
			if (!parsed.data) return;
			onEvent(withFrameType(parsed.data, parsed.type));
		} catch {
			// A malformed frame must not kill the stream.
		}
	}

	private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const response = await this.fetchImpl(`${this.url}${path}`, {
			method,
			headers: {
				authorization: basicAuthHeader(this.password),
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`The server answered ${response.status}: ${text}`);
		}
		if (text.length === 0) return undefined as T;
		return JSON.parse(text) as T;
	}
}
