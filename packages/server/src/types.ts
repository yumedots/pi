/**
 * The wire types the server and the pi client share.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { CacheWarmingMode, ContextUsage, SessionStats } from "@earendil-works/pi-coding-agent";

/** The queue state of a session. */
export interface SessionQueueState {
	/** The queued steering messages. */
	steering: string[];
	/** The queued follow-up messages. */
	followUp: string[];
}

/** The state of a session, as the client sees it. */
export interface SessionStateSnapshot {
	/** The session id. */
	sessionId: string;
	/** The working directory of the session. */
	cwd: string;
	/** The session file, or `undefined` for an in-memory session. */
	sessionFile: string | undefined;
	/** The display name of the session. */
	title: string | undefined;
	/** The active model as `provider/model`. */
	model: string | undefined;
	/** The active thinking level. */
	thinkingLevel: ThinkingLevel | undefined;
	/** The models the session cycles through. */
	scopedModels: Array<{ provider: string; modelId: string; thinkingLevel?: ThinkingLevel }>;
	/** How steering messages are queued. */
	steeringMode: "all" | "one-at-a-time";
	/** How follow-up messages are queued. */
	followUpMode: "all" | "one-at-a-time";
	/** Whether the session compacts itself when the context grows. */
	autoCompactionEnabled: boolean;
	/** The cache warming mode. */
	cacheWarmingMode: CacheWarmingMode;
	/** Whether the agent is streaming right now. */
	isStreaming: boolean;
	/** Whether the session is idle. */
	isIdle: boolean;
	/** Whether the session is compacting right now. */
	isCompacting: boolean;
	/** Whether a bash command is running. */
	isBashRunning: boolean;
	/** The retry attempt of the current turn. */
	retryAttempt: number;
	/** The number of queued messages. */
	pendingMessageCount: number;
	/** The queued messages. */
	queue: SessionQueueState;
	/** The system prompt of the session. */
	systemPrompt: string;
	/** The statistics of the session. */
	sessionStats: SessionStats | undefined;
	/** The context usage of the session. */
	contextUsage: ContextUsage | undefined;
}

/** The resources a session offers. */
export interface SessionResourcesSnapshot {
	/** The prompt templates of the session. */
	promptTemplates: Array<{ name: string; description?: string; sourceInfo?: unknown }>;
	/** The skills of the session. */
	skills: Array<{ name: string; description?: string; sourceInfo?: unknown }>;
	/** The commands of the session, builtin and from extensions. */
	commands: Array<{ name: string; description?: string; source?: string; sourceInfo?: unknown }>;
	/** The extensions of the session. */
	extensions: Array<{ path: string; side: "client" | "server" | "both"; sourceInfo?: unknown }>;
	/** The extensions that failed to load. */
	extensionErrors: Array<{ path: string; error: string }>;
	/** The tools the session declares to the model. */
	tools: Array<{ name: string; description?: string; parameters?: unknown }>;
}

/** The result of a tool call, as the server renders it. */
export interface RenderToolResult {
	/** The content blocks of the result. */
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
	/** The details the tool reported. */
	details?: unknown;
	/** Whether the tool failed. */
	isError?: boolean;
	/** How long the tool ran. */
	durationMs?: number;
}

/**
 * A piece of the transcript the server renders.
 *
 * The client cannot render what only the server can: an extension that lives in the
 * server's process registers its renderers there. The client sends the piece it wants
 * drawn and the server answers with the lines.
 */
export type RenderRequest =
	| {
			kind: "tool";
			/** The name of the tool, as the model called it. */
			toolName: string;
			/** The arguments of the call. */
			args: unknown;
			/** The id of the tool call. */
			toolCallId?: string;
			/** The result of the call, when it already ran. */
			result?: RenderToolResult;
			/** Whether the result is still streaming. */
			isPartial?: boolean;
			/** Whether the result is expanded. */
			expanded?: boolean;
	  }
	| {
			kind: "message";
			/** The custom type of the message. */
			customType: string;
			/** The message to draw. */
			message: unknown;
	  }
	| {
			kind: "entry";
			/** The custom type of the entry. */
			customType: string;
			/** The entry to draw. */
			entry: unknown;
	  };

/** The rendered lines of a piece of the transcript. */
export interface RenderResponse {
	/** The rendered lines, with the ANSI colors the server's theme produced. */
	lines: string[];
}

/** The server information reported by `/api/info`. */
export interface PiServerInfo {
	/** The server version. */
	version: string;
	/** The process id of the server. */
	pid: number;
	/** The URLs the server answers on. */
	urls: string[];
	/** The paths the server uses. */
	paths: { tmp: string };
	/** The capabilities of the server. */
	capabilities: { persistentPty: boolean };
}
