/**
 * The remote session connection.
 *
 * The client drives the session through the server: commands go over HTTP, events arrive
 * over SSE, and the state snapshot is refreshed from the server whenever the session
 * changes.
 */

import type {
	AgentSessionEvent,
	RpcCommand,
	RpcExtensionUIResponse,
	RpcResponse,
} from "@earendil-works/pi-coding-agent";
import type { PiServerClient, SessionStateSnapshot } from "@earendil-works/pi-server/client";
import { type SessionConnection, STATE_REFRESHING_EVENTS } from "./session-connection.ts";

/** How long the client waits before it refreshes the state again. */
const STATE_REFRESH_DELAY_MS = 50;

/** The options of {@link RemoteSessionConnection}. */
export interface RemoteSessionConnectionOptions {
	/**
	 * Whether the connection refreshes the snapshot on its own when the session changes.
	 *
	 * Defaults to true. A facade that wants to refresh before it notifies its own
	 * listeners turns this off and calls {@link RemoteSessionConnection.refresh}.
	 */
	autoRefresh?: boolean;
}

/**
 * A session that lives on the server.
 */
export class RemoteSessionConnection implements SessionConnection {
	private readonly client: PiServerClient;
	private readonly autoRefresh: boolean;
	private readonly listeners = new Set<(event: AgentSessionEvent) => void>();
	private session: string;
	private directory: string;
	private unsubscribeEvents: () => void;
	private state: SessionStateSnapshot | undefined;
	private refreshTimer: NodeJS.Timeout | undefined;
	private disposed = false;

	constructor(client: PiServerClient, sessionId: string, cwd: string, options: RemoteSessionConnectionOptions = {}) {
		this.client = client;
		this.session = sessionId;
		this.directory = cwd;
		this.autoRefresh = options.autoRefresh ?? true;
		this.unsubscribeEvents = client.events(sessionId, (event) => this.handleEvent(event));
	}

	/**
	 * Load the state snapshot from the server.
	 */
	async load(): Promise<SessionStateSnapshot> {
		this.state = await this.client.getSessionState(this.session);
		return this.state;
	}

	/**
	 * Fetch the state snapshot from the server again.
	 */
	async refresh(): Promise<SessionStateSnapshot> {
		if (this.disposed) {
			if (!this.state) throw new Error("The session state was not loaded yet");
			return this.state;
		}
		this.state = await this.client.getSessionState(this.session);
		return this.state;
	}

	/**
	 * Point the connection at another session.
	 *
	 * The events of the old session are dropped and the snapshot is forgotten; the new
	 * session's state is loaded by the caller.
	 */
	repoint(sessionId: string, cwd: string): void {
		if (sessionId === this.session) {
			this.directory = cwd;
			return;
		}
		this.unsubscribeEvents();
		this.session = sessionId;
		this.directory = cwd;
		this.state = undefined;
		clearTimeout(this.refreshTimer);
		this.refreshTimer = undefined;
		this.unsubscribeEvents = this.client.events(sessionId, (event) => this.handleEvent(event));
	}

	get sessionId(): string {
		return this.session;
	}

	get cwd(): string {
		return this.directory;
	}

	getState(): SessionStateSnapshot {
		if (!this.state) {
			throw new Error("The session state was not loaded yet");
		}
		return this.state;
	}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async send(command: RpcCommand): Promise<RpcResponse> {
		return this.client.sendCommand(this.session, command);
	}

	async respondExtensionUi(response: RpcExtensionUIResponse): Promise<void> {
		await this.client.respondExtensionUi(this.session, response);
	}

	/**
	 * Stop the connection.
	 */
	dispose(): void {
		this.disposed = true;
		clearTimeout(this.refreshTimer);
		this.unsubscribeEvents();
		this.listeners.clear();
	}

	private handleEvent(event: AgentSessionEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
		if (!this.autoRefresh) return;
		if (!STATE_REFRESHING_EVENTS[event.type]) return;
		this.scheduleRefresh();
	}

	private scheduleRefresh(): void {
		if (this.disposed) return;
		if (this.refreshTimer) return;
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = undefined;
			void this.refresh().catch(() => undefined);
		}, STATE_REFRESH_DELAY_MS);
		this.refreshTimer.unref?.();
	}
}
