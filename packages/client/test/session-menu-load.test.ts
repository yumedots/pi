import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../../coding-agent/src/core/keybindings.ts";
import type { SessionInfo } from "../../coding-agent/src/core/session-manager.ts";
import { initTheme } from "../../coding-agent/src/core/theme/theme.ts";
import { stripAnsi } from "../../coding-agent/src/utils/ansi.ts";
import { SessionMenuComponent } from "../src/components/session-menu.ts";

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

	it("shows the age of a session without its message count", async () => {
		const modified = new Date(Date.now() - 3 * 60 * 60 * 1000);
		const menu = new SessionMenuComponent({
			currentLoad: async () => [{ ...makeSession("a"), messageCount: 42, modified }],
			allLoad: async () => [],
			onSelect: () => {},
			onCancel: () => {},
		});
		await flushPromises();

		const row = stripAnsi(menu.render(120).join("\n"))
			.split("\n")
			.find((line) => line.includes("message a"));
		expect(row).toBeDefined();
		expect(row).toContain("3h");
		expect(row).not.toContain("42");
	});

	it("puts the age next to the title instead of at the edge of the screen", async () => {
		const modified = new Date(Date.now() - 3 * 60 * 60 * 1000);
		const menu = new SessionMenuComponent({
			currentLoad: async () => [{ ...makeSession("a"), modified }],
			allLoad: async () => [],
			onSelect: () => {},
			onCancel: () => {},
		});
		await flushPromises();

		const row = stripAnsi(menu.render(120).join("\n"))
			.split("\n")
			.find((line) => line.includes("message a"));
		expect(row).toBeDefined();
		expect(row).toMatch(/message a\s+3h$/);
		// The row ends where the age is: the metadata is not pushed to the edge.
		expect(row!.trimEnd().length).toBeLessThan(40);
	});

	it("puts the hints on a single line", async () => {
		const menu = new SessionMenuComponent({
			currentLoad: async () => [makeSession("a")],
			allLoad: async () => [],
			onSelect: () => {},
			onCancel: () => {},
			renameSession: async () => {},
		});
		await flushPromises();

		const hintLines = stripAnsi(menu.render(100).join("\n"))
			.split("\n")
			.filter((line) => line.includes("scope: current"));
		expect(hintLines).toHaveLength(1);
		expect(hintLines[0]).toContain("ctrl+r rename");
	});
});
