/**
 * The shared server context.
 *
 * The route modules need the registry, the event feed and the connection bookkeeping. The
 * context is the one object they share, so the server stays the only owner of that state.
 */

import type { AgentSessionEvent, RpcExtensionUIRequest, RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import type { EventFeed } from "./events.ts";
import type { SseConnection } from "./http/sse.ts";
import type { SessionRegistry } from "./session-registry.ts";

/** How long the server waits for a client to answer an extension UI request. */
export const EXTENSION_UI_TIMEOUT_MS = 60_000;

/**
 * The shared server state.
 */
export interface ServerContext {
	/** The sessions the server hosts. */
	registry: SessionRegistry;
	/** The global event feed. */
	feed: EventFeed;
	/** The working directory of the server. */
	cwd: string;
	/** The agent directory. */
	agentDir: string;
	/** The password clients authenticate with. */
	password: string;
	/** Track an SSE connection so the server can close it on shutdown. */
	trackSse(connection: SseConnection): void;
	/** Stop tracking an SSE connection that ended. */
	untrackSse(connection: SseConnection): void;
	/** The number of connected clients. */
	connectedClients(): number;
	/** Deliver a session event to the feed. */
	publishEvent(sessionId: string, event: AgentSessionEvent): void;
	/** Deliver an event to the stream of one session. */
	publishSessionEvent(sessionId: string, event: unknown): void;
	/** Subscribe to the events of one session's stream. */
	subscribeSessionEvents(sessionId: string, listener: (event: unknown) => void): () => void;
	/** Answer a pending extension UI request. */
	answerExtensionUi(sessionId: string, response: RpcExtensionUIResponse): void;
	/** Register a pending extension UI request, so the client can answer it later. */
	registerExtensionUiRequest(
		sessionId: string,
		request: RpcExtensionUIRequest,
		resolve: (response: RpcExtensionUIResponse) => void,
	): void;
}
