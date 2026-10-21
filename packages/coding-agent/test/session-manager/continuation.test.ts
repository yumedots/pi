import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";

function userMessage(text: string) {
	return {
		role: "user" as const,
		content: [{ type: "text" as const, text }],
		timestamp: Date.now(),
	};
}

describe("SessionManager.isContinuation", () => {
	it("is false for a fresh session and true for one loaded from a file", () => {
		const tempDir = join(tmpdir(), `session-continuation-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });

		try {
			const created = SessionManager.create(tempDir, tempDir);
			expect(created.isContinuation()).toBe(false);

			created.appendMessage(userMessage("hello"));
			const file = created.getSessionFile();
			expect(file).toBeDefined();

			const reopened = SessionManager.open(file!, tempDir);
			expect(reopened.isContinuation()).toBe(true);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("is false for a session file that does not exist yet", () => {
		const tempDir = join(tmpdir(), `session-continuation-missing-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });

		try {
			const opened = SessionManager.open(join(tempDir, "missing.jsonl"), tempDir);
			expect(opened.isContinuation()).toBe(false);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("follows what continueRecent picks", () => {
		const tempDir = join(tmpdir(), `session-continuation-recent-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });

		try {
			expect(SessionManager.continueRecent(tempDir, tempDir).isContinuation()).toBe(false);

			const created = SessionManager.create(tempDir, tempDir);
			created.appendMessage(userMessage("hello"));

			expect(SessionManager.continueRecent(tempDir, tempDir).isContinuation()).toBe(true);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
