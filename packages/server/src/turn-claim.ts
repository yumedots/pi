/**
 * Turn claims.
 *
 * A claim is the server's record that a turn is running. It is written when a turn starts
 * and removed when it ends. A claim that survives a crash is what tells the next server
 * that the work was interrupted.
 */

import { chmodSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The record of a running turn. */
export interface TurnClaim {
	/** The session the turn belongs to. */
	sessionId: string;
	/** The working directory of the session. */
	cwd: string;
	/** The session file the turn writes to. */
	sessionFile: string;
	/** When the turn started. */
	startedAt: number;
	/** The process that runs the turn. */
	pid: number;
	/** How often the turn was already resumed. */
	attempt: number;
}

/** The suffix of a claim file. */
export const TURN_CLAIM_SUFFIX = ".turn.json";

/**
 * The path of the claim file of a session.
 */
export function claimPath(sessionDir: string, sessionId: string): string {
	return join(sessionDir, `${sessionId}${TURN_CLAIM_SUFFIX}`);
}

/**
 * Write a claim.
 *
 * The file is written to a temporary path and renamed, so a reader never sees a partial
 * claim, and it is only readable by its owner.
 */
export function writeTurnClaim(claim: TurnClaim): string {
	const sessionDir = dirname(claim.sessionFile);
	const target = claimPath(sessionDir, claim.sessionId);
	const temp = `${target}.${process.pid}.tmp`;
	writeFileSync(temp, `${JSON.stringify(claim, null, 2)}\n`, { mode: 0o600 });
	chmodSync(temp, 0o600);
	renameSync(temp, target);
	return target;
}

/**
 * Remove the claim of a session.
 */
export function clearTurnClaim(sessionDir: string, sessionId: string): void {
	rmSync(claimPath(sessionDir, sessionId), { force: true });
}

/**
 * Read the claim of a session.
 */
export function readTurnClaim(sessionDir: string, sessionId: string): TurnClaim | undefined {
	const path = claimPath(sessionDir, sessionId);
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as TurnClaim;
	} catch {
		return undefined;
	}
}

/**
 * The claims of every session of every project.
 */
export function listTurnClaims(agentDir: string): TurnClaim[] {
	const sessionsDir = join(agentDir, "sessions");
	if (!existsSync(sessionsDir)) return [];
	const claims: TurnClaim[] = [];
	let projectDirs: string[];
	try {
		projectDirs = readdirSync(sessionsDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
			.map((entry) => join(sessionsDir, entry.name));
	} catch {
		return [];
	}
	for (const projectDir of projectDirs) {
		let files: string[];
		try {
			files = readdirSync(projectDir).filter((file) => file.endsWith(TURN_CLAIM_SUFFIX));
		} catch {
			continue;
		}
		for (const file of files) {
			try {
				const parsed = JSON.parse(readFileSync(join(projectDir, file), "utf8")) as TurnClaim;
				if (typeof parsed.sessionId !== "string" || typeof parsed.sessionFile !== "string") continue;
				claims.push(parsed);
			} catch {}
		}
	}
	return claims;
}
