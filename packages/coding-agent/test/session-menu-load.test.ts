import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { SessionInfo } from "../src/core/session-manager.ts";
import { SessionMenuComponent } from "../src/modes/interactive/components/session-menu.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

async function flushPromises(): Promise<void> {
	await new Promise<void>((resolve) => {
		setImmediate(resolve);
	});
}

function makeSession(id: string): SessionInfo {
	return {
		path: `/tmp/${id}.jsonl`,
		id,
		cwd: "",
		created: new Date(0),
		modified: new Date(0),
		messageCount: 1,
		firstMessage: `message ${id}`,
		allMessagesText: `message ${id}`,
	};
}

describe("session menu loading", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	it("requests a render once the sessions are loaded", async () => {
		const onRequestRender = vi.fn();
		const menu = new SessionMenuComponent({
			currentLoad: async () => [makeSession("a")],
			allLoad: async () => [],
			onSelect: () => {},
			onCancel: () => {},
			onRequestRender,
		});
		await flushPromises();

		expect(onRequestRender).toHaveBeenCalled();
		expect(stripAnsi(menu.render(80).join("\n"))).toContain("message a");
	});

	it("shows the sessions that have been discovered so far while still loading", async () => {
		let publish: ((loaded: number, total: number, partial: readonly SessionInfo[]) => void) | undefined;
		const onRequestRender = vi.fn();
		const menu = new SessionMenuComponent({
			currentLoad: async (onProgress) =>
				new Promise<SessionInfo[]>((resolve) => {
					publish = (loaded, total, partial) => onProgress?.(loaded, total, partial);
					setTimeout(() => resolve([makeSession("a")]), 50);
				}),
			allLoad: async () => [],
			onSelect: () => {},
			onCancel: () => {},
			onRequestRender,
		});
		await flushPromises();

		publish?.(1, 2, [makeSession("partial")]);
		await flushPromises();

		const output = stripAnsi(menu.render(80).join("\n"));
		expect(output).toContain("message partial");
		expect(output).toContain("loaded 1 of 2");
	});
});
