import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setKeybindings } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { SessionInfo } from "../src/core/session-manager.ts";
import { SessionMenuComponent } from "../src/modes/interactive/components/session-menu.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (err: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
	let resolve: (value: T) => void = () => {};
	let reject: (err: unknown) => void = () => {};
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
	await new Promise<void>((resolve) => {
		setImmediate(resolve);
	});
}

function stripAnsi(text: string): string {
	return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function makeSession(overrides: Partial<SessionInfo> & { id: string }): SessionInfo {
	return {
		path: overrides.path ?? `/tmp/${overrides.id}.jsonl`,
		id: overrides.id,
		cwd: overrides.cwd ?? "",
		name: overrides.name,
		parentSessionPath: overrides.parentSessionPath,
		created: overrides.created ?? new Date(0),
		modified: overrides.modified ?? new Date(0),
		messageCount: overrides.messageCount ?? 1,
		firstMessage: overrides.firstMessage ?? "hello",
		allMessagesText: overrides.allMessagesText ?? "hello",
	};
}

function createSymlinkedSessionPaths(): {
	baseDir: string;
	parentAliasA: string;
	parentAliasB: string;
	childAliasB: string;
} {
	const baseDir = mkdtempSync(join(tmpdir(), "pi-session-menu-"));
	const realDir = join(baseDir, "real");
	const aliasADir = join(baseDir, "alias-a");
	const aliasBDir = join(baseDir, "alias-b");
	mkdirSync(realDir, { recursive: true });
	mkdirSync(aliasADir, { recursive: true });
	mkdirSync(aliasBDir, { recursive: true });

	const sharedDir = join(realDir, "sessions");
	mkdirSync(sharedDir, { recursive: true });
	const aliasASessions = join(aliasADir, "sessions");
	const aliasBSessions = join(aliasBDir, "sessions");
	symlinkSync(sharedDir, aliasASessions);
	symlinkSync(sharedDir, aliasBSessions);

	const parentRealPath = join(sharedDir, "parent.jsonl");
	const childRealPath = join(sharedDir, "child.jsonl");
	writeFileSync(parentRealPath, "parent\n");
	writeFileSync(childRealPath, "child\n");

	return {
		baseDir,
		parentAliasA: join(aliasASessions, "parent.jsonl"),
		parentAliasB: join(aliasBSessions, "parent.jsonl"),
		childAliasB: join(aliasBSessions, "child.jsonl"),
	};
}

const CTRL_D = "\x04";
const CTRL_BACKSPACE = "\x1b[127;5u";

describe("session menu path/delete interactions", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	beforeEach(() => {
		// Ensure test isolation: keybindings are a global singleton
		setKeybindings(new KeybindingsManager());
	});

	beforeAll(() => {
		// session menu uses the global theme instance
		initTheme("dark");
	});

	it("does not treat Ctrl+Backspace as delete when search query is non-empty", async () => {
		const sessions = [makeSession({ id: "a" }), makeSession({ id: "b" })];

		const selector = new SessionMenuComponent({
			currentLoad: async () => sessions,
			allLoad: async () => [],
			onSelect: () => {},
			onCancel: () => {},
		});
		await flushPromises();

		selector.handleInput("a");
		selector.handleInput(CTRL_BACKSPACE);

		expect(stripAnsi(selector.render(120).join("\n"))).not.toContain("Delete session?");
	});

	it("enters confirmation mode on Ctrl+D even with a non-empty search query", async () => {
		const sessions = [makeSession({ id: "a" }), makeSession({ id: "b" })];

		const selector = new SessionMenuComponent({
			currentLoad: async () => sessions,
			allLoad: async () => [],
			onSelect: () => {},
			onCancel: () => {},
		});
		await flushPromises();

		selector.handleInput("a");
		selector.handleInput(CTRL_D);

		expect(stripAnsi(selector.render(120).join("\n"))).toContain("Delete session?");
	});

	it("enters confirmation mode on Ctrl+Backspace when search query is empty", async () => {
		const sessions = [makeSession({ id: "a" }), makeSession({ id: "b" })];

		const selector = new SessionMenuComponent({
			currentLoad: async () => sessions,
			allLoad: async () => [],
			onSelect: () => {},
			onCancel: () => {},
		});
		await flushPromises();

		selector.handleInput(CTRL_BACKSPACE);
		expect(stripAnsi(selector.render(120).join("\n"))).toContain("Delete session?");

		selector.handleInput("\x1b");
		expect(stripAnsi(selector.render(120).join("\n"))).not.toContain("Delete session?");
	});

	it("does not switch scope back to All when All load resolves after toggling back to Current", async () => {
		const currentSessions = [makeSession({ id: "current" })];
		const allDeferred = createDeferred<SessionInfo[]>();
		let allLoadCalls = 0;

		const selector = new SessionMenuComponent({
			currentLoad: async () => currentSessions,
			allLoad: async () => {
				allLoadCalls++;
				return allDeferred.promise;
			},
			onSelect: () => {},
			onCancel: () => {},
		});
		await flushPromises();

		selector.handleInput("\t"); // current -> all (starts async load)
		selector.handleInput("\t"); // all -> current

		allDeferred.resolve([makeSession({ id: "all" })]);
		await flushPromises();

		expect(allLoadCalls).toBe(1);
		const output = stripAnsi(selector.render(120).join("\n"));
		expect(output).toContain("Current Folder");
		expect(output).not.toContain("(All)");
	});

	it("does not truncate the session text to the minimum width", async () => {
		const sessions = [makeSession({ id: "a", firstMessage: "a long first message that should not be cut off" })];

		const selector = new SessionMenuComponent({
			currentLoad: async () => sessions,
			allLoad: async () => [],
			onSelect: () => {},
			onCancel: () => {},
		});
		await flushPromises();

		const output = stripAnsi(selector.render(120).join("\n"));
		expect(output).toContain("a long first message that should not be cut off");
	});

	it("shows the child session nested under its parent in threaded mode", async () => {
		const { baseDir, parentAliasA, childAliasB } = createSymlinkedSessionPaths();
		tempDirs.push(baseDir);

		const parent = makeSession({
			id: "parent",
			path: parentAliasA,
			firstMessage: "parent session",
			allMessagesText: "parent session",
			modified: new Date(0),
		});
		const child = makeSession({
			id: "child",
			path: childAliasB,
			parentSessionPath: parentAliasA,
			firstMessage: "child session",
			allMessagesText: "child session",
			modified: new Date(1000),
		});

		const selector = new SessionMenuComponent({
			currentLoad: async () => [parent, child],
			allLoad: async () => [],
			onSelect: () => {},
			onCancel: () => {},
		});
		await flushPromises();

		const output = stripAnsi(selector.render(120).join("\n"));
		expect(output).toContain("parent");
		expect(output).toContain("child");
		// The child is rendered as a tree entry under the parent.
		expect(output).toContain("└─");
	});
});
