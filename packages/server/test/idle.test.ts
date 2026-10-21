import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { IdleWatchdog } from "../src/idle.ts";
import { readRegistration } from "../src/registration.ts";
import { type PiServer, startServer } from "../src/server.ts";
import type { SessionRegistry } from "../src/session-registry.ts";

function emptyRegistry(): SessionRegistry {
	return {
		sessions: new Map(),
		list: async () => [],
		get: () => undefined,
		close: async () => {},
		closeAll: async () => {},
	} as unknown as SessionRegistry;
}

describe("the idle watchdog", () => {
	test("fires once the idle timeout is reached", () => {
		let now = 1000;
		let fired = 0;
		const watchdog = new IdleWatchdog({
			idleTimeoutMs: 500,
			intervalMs: 100,
			now: () => now,
			isIdle: () => true,
			onIdle: () => {
				fired++;
			},
		});
		watchdog.start();
		now += 200;
		watchdog.check();
		expect(fired).toBe(0);
		now += 400;
		watchdog.check();
		expect(fired).toBe(1);
		watchdog.stop();
	});

	test("does not fire while the server is busy", () => {
		let now = 1000;
		let fired = 0;
		let idle = false;
		const watchdog = new IdleWatchdog({
			idleTimeoutMs: 500,
			intervalMs: 100,
			now: () => now,
			isIdle: () => idle,
			onIdle: () => {
				fired++;
			},
		});
		watchdog.start();
		now += 1000;
		watchdog.check();
		expect(fired).toBe(0);
		idle = true;
		now += 1000;
		watchdog.check();
		expect(fired).toBe(0);
		now += 1000;
		watchdog.check();
		expect(fired).toBe(1);
		watchdog.stop();
	});

	test("never fires when the timeout is zero", () => {
		let fired = 0;
		const watchdog = new IdleWatchdog({
			idleTimeoutMs: 0,
			intervalMs: 10,
			isIdle: () => true,
			onIdle: () => {
				fired++;
			},
		});
		watchdog.start();
		watchdog.check();
		expect(fired).toBe(0);
		watchdog.stop();
	});
});

describe("the server idle shutdown", () => {
	test("closes the server and removes the registration file when it stays idle", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "pi-server-idle-"));
		let server: PiServer | undefined;
		try {
			server = await startServer({
				port: 0,
				password: "test-password",
				agentDir,
				registry: emptyRegistry(),
				idleTimeoutMs: 200,
			});
			expect(readRegistration(agentDir)).toBeDefined();
			await new Promise((resolve) => setTimeout(resolve, 1200));
			expect(readRegistration(agentDir)).toBeUndefined();
		} finally {
			await server?.close();
			rmSync(agentDir, { recursive: true, force: true });
		}
	});

	test("stays up while a client is connected", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "pi-server-idle-"));
		let server: PiServer | undefined;
		try {
			server = await startServer({
				port: 0,
				password: "test-password",
				agentDir,
				registry: emptyRegistry(),
				idleTimeoutMs: 200,
			});
			const controller = new AbortController();
			const response = await fetch(`${server.url}/api/event`, {
				headers: { authorization: `Basic ${Buffer.from("opencode:test-password").toString("base64")}` },
				signal: controller.signal,
			});
			const reader = response.body?.getReader();
			await reader?.read();
			await new Promise((resolve) => setTimeout(resolve, 1200));
			expect(readRegistration(agentDir)).toBeDefined();
			controller.abort();
		} finally {
			await server?.close();
			rmSync(agentDir, { recursive: true, force: true });
		}
	});
});
