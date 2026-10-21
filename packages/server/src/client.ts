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
import { basicAuthHeader } from "./auth.ts";
import type { PiServerInfo, SessionStateSnapshot } from "./types.ts";

/** The options of {@link PiServerClient}. */
export interface PiServerClientOptions {
	/** The base URL of the server. */
	url: string;
	/** The password, or a pairing token. */
	password: string;
	/** The fetch implementation. Defaults to the global one. */
	fetch?: typeof globalThis.fetch;
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
	 * The sessions the server knows about.
	 */
	async listSessions(cwd?: string): Promise<RemoteSessionInfo[]> {
		const query = cwd ? `?directory=${encodeURIComponent(cwd)}` : "";
		const body = await this.request<{ data: RemoteSessionInfo[] }>("GET", `/pi/session${query}`);
		return body.data;
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
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
		};

		void connect();

		return () => {
			stopped = true;
			controller.abort();
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
			onEvent(parsed.data);
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
