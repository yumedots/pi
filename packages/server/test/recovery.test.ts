import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	MAX_RESUME_ATTEMPTS,
	RESTART_ABANDONED_MESSAGE,
	RESTART_CONTINUATION_MESSAGE,
	resumeInterruptedSessions,
} from "../src/recovery.ts";
import type { SessionRegistry } from "../src/session-registry.ts";
import { claimPath, clearTurnClaim, writeTurnClaim } from "../src/turn-claim.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function makeAgentDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-server-recovery-"));
	tempDirs.push(dir);
	return dir;
}

/**
 * A session file that ends with a user message, so the turn was interrupted.
 */
function writeInterruptedSession(sessionDir: string, sessionId: string): string {
	const sessionFile = join(sessionDir, `${sessionId}.jsonl`);
	const entries = [
		{ type: "session", version: 1, id: sessionId, timestamp: new Date().toISOString(), cwd: sessionDir },
		{
			type: "message",
			id: "e1",
			parentId: null,
			timestamp: new Date().toISOString(),
			message: { role: "user", content: "do the thing", timestamp: Date.now() },
		},
	];
	writeFileSync(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
	return sessionFile;
}

/**
 * A registry that records the sessions it was asked to open.
 */
function fakeRegistry(opened: string[]): SessionRegistry {
	return {
		sessions: new Map(),
		list: async () => [],
		get: () => undefined,
		close: async () => {},
		closeAll: async () => {},
		open: async (path: string) => {
			opened.push(path);
			return {
				id: "session",
				cwd: "/tmp",
				runtime: {} as never,
				controller: { handle: async () => undefined } as never,
				sessionFile: path,
				busy: false,
			};
		},
	} as unknown as SessionRegistry;
}

describe("the recovery sweep", () => {
	test("resumes an interrupted session and counts the attempt", async () => {
		const agentDir = makeAgentDir();
		const sessionDir = join(agentDir, "sessions", "project");
		mkdirSync(sessionDir, { recursive: true });
		const sessionId = "session-1";
		const sessionFile = writeInterruptedSession(sessionDir, sessionId);
		writeTurnClaim({ sessionId, cwd: sessionDir, sessionFile, startedAt: Date.now(), pid: 1, attempt: 0 });

		const opened: string[] = [];
		const result = await resumeInterruptedSessions(fakeRegistry(opened), agentDir);

		expect(result.resumed).toEqual([sessionId]);
		expect(result.abandoned).toEqual([]);
		expect(opened).toEqual([sessionFile]);

		const claim = JSON.parse(readFileSync(claimPath(sessionDir, sessionId), "utf8")) as { attempt: number };
		expect(claim.attempt).toBe(1);
	});

	test("abandons a session that was resumed too often", async () => {
		const agentDir = makeAgentDir();
		const sessionDir = join(agentDir, "sessions", "project");
		mkdirSync(sessionDir, { recursive: true });
		const sessionId = "session-2";
		const sessionFile = writeInterruptedSession(sessionDir, sessionId);
		writeTurnClaim({
			sessionId,
			cwd: sessionDir,
			sessionFile,
			startedAt: Date.now(),
			pid: 1,
			attempt: MAX_RESUME_ATTEMPTS,
		});

		const opened: string[] = [];
		const result = await resumeInterruptedSessions(fakeRegistry(opened), agentDir);

		expect(result.abandoned).toEqual([sessionId]);
		expect(result.resumed).toEqual([]);
		expect(opened).toEqual([]);

		const contents = readFileSync(sessionFile, "utf8");
		expect(contents).toContain(RESTART_ABANDONED_MESSAGE);

		expect(() => readFileSync(claimPath(sessionDir, sessionId), "utf8")).toThrow();
	});

	test("drops the claim of a session whose turn had completed", async () => {
		const agentDir = makeAgentDir();
		const sessionDir = join(agentDir, "sessions", "project");
		mkdirSync(sessionDir, { recursive: true });
		const sessionId = "session-3";
		const sessionFile = join(sessionDir, `${sessionId}.jsonl`);
		const entries = [
			{ type: "session", version: 1, id: sessionId, timestamp: new Date().toISOString(), cwd: sessionDir },
			{
				type: "message",
				id: "e1",
				parentId: null,
				timestamp: new Date().toISOString(),
				message: { role: "user", content: "do the thing", timestamp: Date.now() },
			},
			{
				type: "message",
				id: "e2",
				parentId: "e1",
				timestamp: new Date().toISOString(),
				message: { role: "assistant", content: [], timestamp: Date.now() },
			},
		];
		writeFileSync(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
		writeTurnClaim({ sessionId, cwd: sessionDir, sessionFile, startedAt: Date.now(), pid: 1, attempt: 0 });

		const opened: string[] = [];
		const result = await resumeInterruptedSessions(fakeRegistry(opened), agentDir);

		expect(result.resumed).toEqual([]);
		expect(result.abandoned).toEqual([]);
		expect(opened).toEqual([]);
		expect(() => readFileSync(claimPath(sessionDir, sessionId), "utf8")).toThrow();
	});

	test("uses a synthetic continuation message instead of repeating the prompt", () => {
		expect(RESTART_CONTINUATION_MESSAGE).toContain("Continue from where you left off");
		expect(RESTART_CONTINUATION_MESSAGE).not.toBe("do the thing");
	});

	test("clears a claim", () => {
		const agentDir = makeAgentDir();
		const sessionDir = join(agentDir, "sessions", "project");
		mkdirSync(sessionDir, { recursive: true });
		const sessionId = "session-4";
		const sessionFile = writeInterruptedSession(sessionDir, sessionId);
		writeTurnClaim({ sessionId, cwd: sessionDir, sessionFile, startedAt: Date.now(), pid: 1, attempt: 0 });
		clearTurnClaim(sessionDir, sessionId);
		expect(() => readFileSync(claimPath(sessionDir, sessionId), "utf8")).toThrow();
	});
});
