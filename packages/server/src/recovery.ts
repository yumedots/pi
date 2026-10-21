/**
 * Crash recovery.
 *
 * When the server dies in the middle of a turn, the claim of that turn survives. The next
 * server finds the claim, sees that the last entry of the session is a user message without
 * an answer, and continues the work with a synthetic message. The claim carries an attempt
 * counter, so a session that keeps crashing is eventually abandoned instead of looping.
 */

import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionRegistry } from "./session-registry.ts";
import { clearTurnClaim, listTurnClaims, writeTurnClaim } from "./turn-claim.ts";

/** How often a turn may be resumed before the session is abandoned. */
export const MAX_RESUME_ATTEMPTS = 10;

/** The message that asks the agent to continue the interrupted work. */
export const RESTART_CONTINUATION_MESSAGE =
	"The server restarted while you were working. Continue from where you left off without repeating completed work.";

/** The message that records that the interrupted work was not resumed. */
export const RESTART_ABANDONED_MESSAGE =
	"The server restarted while you were working and this session was not resumed automatically.";

/** The outcome of the recovery sweep. */
export interface RecoveryResult {
	/** The sessions that were resumed. */
	resumed: string[];
	/** The sessions that were abandoned. */
	abandoned: string[];
}

/**
 * Resume the sessions whose turn was interrupted.
 *
 * @param registry The registry the resumed sessions are opened in.
 * @param agentDir The agent directory that holds the sessions and the claims.
 */
export async function resumeInterruptedSessions(registry: SessionRegistry, agentDir: string): Promise<RecoveryResult> {
	const result: RecoveryResult = { resumed: [], abandoned: [] };
	const claims = listTurnClaims(agentDir);

	for (const claim of claims) {
		const sessionDir = dirname(claim.sessionFile);
		const attempt = claim.attempt + 1;

		if (attempt > MAX_RESUME_ATTEMPTS) {
			appendUserMessage(claim.sessionFile, RESTART_ABANDONED_MESSAGE);
			clearTurnClaim(sessionDir, claim.sessionId);
			result.abandoned.push(claim.sessionId);
			continue;
		}

		if (!isInterrupted(claim.sessionFile)) {
			// The turn had already completed; the claim is stale.
			clearTurnClaim(sessionDir, claim.sessionId);
			continue;
		}

		// The claim is rewritten before the prompt, so a crash during the resume still
		// counts as an attempt.
		writeTurnClaim({ ...claim, attempt });

		try {
			const session = await registry.open(claim.sessionFile);
			await session.controller.handle({
				type: "prompt",
				message: RESTART_CONTINUATION_MESSAGE,
				streamingBehavior: "followUp",
			});
			result.resumed.push(claim.sessionId);
		} catch {
			clearTurnClaim(sessionDir, claim.sessionId);
			result.abandoned.push(claim.sessionId);
		}
	}

	return result;
}

/**
 * Whether the session ends with a user message that was never answered.
 */
export function isInterrupted(sessionFile: string): boolean {
	if (!existsSync(sessionFile)) return false;
	const sessionManager = SessionManager.open(sessionFile);
	const entries = sessionManager.getEntries();
	if (entries.length === 0) return false;
	const last = entries[entries.length - 1]!;
	if (last.type !== "message") return false;
	const message = last.message;
	if (message.role !== "user") return false;
	// A user message that was answered is followed by an assistant message, so a user
	// message as the last entry means the turn never produced an answer.
	return true;
}

/**
 * Append a user message to a session file, without running a turn.
 */
export function appendUserMessage(sessionFile: string, text: string): void {
	if (!existsSync(sessionFile)) return;
	const sessionManager = SessionManager.open(sessionFile);
	sessionManager.appendMessage({ role: "user", content: text, timestamp: Date.now() });
}
