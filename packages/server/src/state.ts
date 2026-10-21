/**
 * The session state snapshot.
 *
 * The client reads the state of a session from the server instead of holding a session
 * object, so the snapshot is the contract between the two.
 */

import type { ServerSession } from "./session-registry.ts";
import type { SessionStateSnapshot } from "./types.ts";

/**
 * Build the state snapshot of a session.
 */
export function toSessionStateSnapshot(session: ServerSession): SessionStateSnapshot {
	const agentSession = session.runtime.session;
	const model = agentSession.model;
	return {
		sessionId: agentSession.sessionId,
		cwd: agentSession.sessionManager.getCwd(),
		sessionFile: agentSession.sessionFile,
		title: agentSession.sessionName,
		model: model ? `${model.provider}/${model.id}` : undefined,
		thinkingLevel: agentSession.thinkingLevel,
		scopedModels: agentSession.scopedModels.map((scoped) => ({
			provider: scoped.model.provider,
			modelId: scoped.model.id,
			thinkingLevel: scoped.thinkingLevel,
		})),
		steeringMode: agentSession.steeringMode,
		followUpMode: agentSession.followUpMode,
		autoCompactionEnabled: agentSession.autoCompactionEnabled,
		cacheWarmingMode: session.runtime.services.settingsManager.getCacheWarmingMode(),
		isStreaming: agentSession.isStreaming,
		isIdle: agentSession.isIdle,
		isCompacting: agentSession.isCompacting,
		isBashRunning: agentSession.isBashRunning,
		retryAttempt: agentSession.retryAttempt,
		pendingMessageCount: agentSession.pendingMessageCount,
		queue: {
			steering: [...agentSession.getSteeringMessages()],
			followUp: [...agentSession.getFollowUpMessages()],
		},
		systemPrompt: agentSession.systemPrompt,
		sessionStats: agentSession.getSessionStats(),
		contextUsage: agentSession.getContextUsage(),
	};
}
