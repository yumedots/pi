/**
 * The client's view of a session.
 *
 * The client never holds an agent session. It holds a connection to one: a command
 * channel, an event stream and a state snapshot that the server keeps up to date.
 */

import type {
	AgentSessionEvent,
	RpcCommand,
	RpcExtensionUIResponse,
	RpcResponse,
} from "@earendil-works/pi-coding-agent";
import type { SessionStateSnapshot } from "@earendil-works/pi-server/client";

/**
 * A live connection to one session on the server.
 */
export interface SessionConnection {
	/** The id of the session. */
	readonly sessionId: string;
	/** The working directory of the session. */
	readonly cwd: string;
	/** The last known state of the session. */
	getState(): SessionStateSnapshot;
	/** Subscribe to the events of the session. */
	subscribe(listener: (event: AgentSessionEvent) => void): () => void;
	/** Send a command to the session. */
	send(command: RpcCommand): Promise<RpcResponse>;
	/** Answer a pending extension UI request. */
	respondExtensionUi(response: RpcExtensionUIResponse): Promise<void>;
}

/**
 * The events after which the state snapshot is refreshed.
 *
 * The server owns the truth about the session; the client refreshes its snapshot when
 * something happened that could have changed it.
 */
export const STATE_REFRESHING_EVENTS: Record<string, true> = {
	thinking_level_changed: true,
	session_info_changed: true,
	entry_appended: true,
	agent_start: true,
	agent_end: true,
	agent_settled: true,
	compaction_start: true,
	compaction_end: true,
	queue_update: true,
	model_change: true,
};
