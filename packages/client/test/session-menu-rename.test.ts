import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../../coding-agent/src/core/keybindings.ts";
import type { SessionInfo } from "../../coding-agent/src/core/session-manager.ts";
import { SessionMenuComponent } from "../src/components/session-menu.ts";
import { initDarkTheme } from "./theme-fixture.ts";

async function flushPromises(): Promise<void> {
	await new Promise<void>((resolve) => {
		setImmediate(resolve);
	});
}

function makeSession(overrides: Partial<SessionInfo> & { id: string }): SessionInfo {
	return {
		path: overrides.path ?? `/tmp/${overrides.id}.jsonl`,
		id: overrides.id,
		cwd: overrides.cwd ?? "",
		name: overrides.name,
		created: overrides.created ?? new Date(0),
		modified: overrides.modified ?? new Date(0),
		messageCount: overrides.messageCount ?? 1,
		firstMessage: overrides.firstMessage ?? "hello",
		allMessagesText: overrides.allMessagesText ?? "hello",
	};
}

// Kitty keyboard protocol encoding for Ctrl+R
const CTRL_R = "\x1b[114;5u";

describe("session menu rename", () => {
	beforeAll(() => {
		initDarkTheme();
	});

	beforeEach(() => {
		// Ensure test isolation: keybindings are a global singleton
		setKeybindings(new KeybindingsManager());
	});

	it("shows rename hint when renaming is enabled", async () => {
		const sessions = [makeSession({ id: "a" })];
		const selector = new SessionMenuComponent({
			currentLoad: async () => sessions,
			allLoad: async () => [],
			onSelect: () => {},
			onCancel: () => {},
			renameSession: async () => {},
		});
		await flushPromises();

		const output = selector.render(120).join("\n");
		expect(output).toContain("rename");
	});

	it("does not show rename hint when renaming is disabled", async () => {
		const sessions = [makeSession({ id: "a" })];
		const selector = new SessionMenuComponent({
			currentLoad: async () => sessions,
			allLoad: async () => [],
			onSelect: () => {},
			onCancel: () => {},
		});
		await flushPromises();

		const output = selector.render(120).join("\n");
		expect(output).not.toContain("rename");
	});

	it("enters rename mode on Ctrl+R and submits with Enter", async () => {
		const sessions = [makeSession({ id: "a", name: "Old" })];
		const renameSession = vi.fn(async () => {});

		const selector = new SessionMenuComponent({
			currentLoad: async () => sessions,
			allLoad: async () => [],
			onSelect: () => {},
			onCancel: () => {},
			renameSession,
		});
		await flushPromises();

		selector.handleInput(CTRL_R);
		await flushPromises();

		// Rename mode layout
		const output = selector.render(120).join("\n");
		expect(output).toContain("Rename Session");
		expect(output).not.toContain("Sessions");

		// Type and submit
		selector.handleInput("X");
		selector.handleInput("\r");
		await flushPromises();

		expect(renameSession).toHaveBeenCalledTimes(1);
		expect(renameSession).toHaveBeenCalledWith(sessions[0]!.path, "XOld");
	});
});
