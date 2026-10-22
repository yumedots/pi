/**
 * The verification of the client in a real terminal.
 *
 * The other tests of the client drive the pieces directly. This one starts the client the way
 * a user does — in a terminal, over a real tmux pane — and reads the screen that comes out.
 * What it checks is the things a user sees: the banner, the prompt, the server the client is
 * connected to, the pairing dialog and the layout in a narrow window.
 *
 * The client runs in a temporary project directory with a temporary agent directory, so the
 * test neither touches the real ones nor depends on the extensions of the checkout.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/** The root of the repository, three levels above this file. */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The entry point of the client. */
const CLIENT_ENTRY = join(REPO_ROOT, "packages/client/src/cli.ts");

/** The environment variable that moves the agent directory, and with it the sessions. */
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/**
 * The tmux socket the test uses.
 *
 * A socket of its own keeps the session alive when something else on the machine kills the
 * default tmux server.
 */
const TMUX_SOCKET = `pi-tmux-verify-${process.pid}`;

/** The tmux session the client runs in. */
const SESSION_NAME = "client";

/** How long the pane is waited for, in milliseconds. */
const WAIT_TIMEOUT_MS = 30_000;

/** How often the pane is polled, in milliseconds. */
const POLL_INTERVAL_MS = 200;

/** The width of the narrow window. */
const NARROW_WIDTH = 60;

/** The width of the wide window. */
const WIDE_WIDTH = 120;

/** The height of the window. */
const WINDOW_HEIGHT = 40;

/**
 * The share of the screen the extension diagnostics may take.
 *
 * A wall of text is not a diagnosis, it is noise: the diagnostics of the extensions belong in
 * a few lines, not in a screenful.
 */
const DIAGNOSTICS_WALL_SHARE = 0.5;

/** The temporary agent directory of the run. */
let agentDir = "";

/** The temporary project directory of the run. */
let projectDir = "";

/** The screen of the client, wide. */
let widePane = "";

/** The screen of the client, narrow. */
let narrowPane = "";

/** The screen of the client with the pairing dialog open. */
let pairPane = "";

/** The url of the server the client talks to. */
let serverUrl = "";

/**
 * Run a tmux command on the socket of the test.
 *
 * A command that fails is not fatal when the caller says so: the socket of the test does not
 * exist before the first session and after the cleanup.
 */
function tmux(args: string[], allowFailure = false): string {
	try {
		return execFileSync("tmux", ["-L", TMUX_SOCKET, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		if (allowFailure) return "";
		throw error;
	}
}

/**
 * The text of the pane, with the scrollback.
 */
function capturePane(): string {
	return tmux(["capture-pane", "-p", "-t", SESSION_NAME, "-S", "-2000"]);
}

/**
 * The text of the visible pane.
 */
function captureVisiblePane(): string {
	return tmux(["capture-pane", "-p", "-t", SESSION_NAME]);
}

/**
 * Wait for a while.
 *
 * The test drives a real terminal, so the wait is a real wait: the screen is polled until it
 * shows what the test waits for.
 */
async function delay(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	await promise;
}

/**
 * Wait until the pane matches a predicate.
 */
async function waitForPane(description: string, predicate: (pane: string) => boolean): Promise<string> {
	const deadline = Date.now() + WAIT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const pane = captureVisiblePane();
		if (pane.length > 0 && predicate(pane)) return pane;
		await delay(POLL_INTERVAL_MS);
	}
	throw new Error(`The pane never showed ${description}. The screen was:\n${captureVisiblePane()}`);
}

/**
 * The registration of the server the client started.
 */
function readServerRegistration(): { url: string; pid: number } | undefined {
	const path = join(agentDir, "server.json");
	if (!existsSync(path)) return undefined;
	try {
		const body = JSON.parse(readFileSync(path, "utf8")) as { url?: string; pid?: number };
		if (typeof body.url !== "string" || typeof body.pid !== "number") return undefined;
		return { url: body.url, pid: body.pid };
	} catch {
		return undefined;
	}
}

/**
 * The host and the port of a url, the way the footer shows them.
 */
function hostPortOf(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
	} catch {
		return url;
	}
}

/**
 * The lines of the screen that report an extension problem.
 *
 * The block starts at the "[Client extension issues]" header and ends where the next
 * section of the screen starts.
 */
function diagnosticsBlock(pane: string): string[] {
	const lines = pane.split("\n");
	const start = lines.findIndex((line) => line.includes("[Client extension issues]"));
	if (start < 0) return [];
	let end = start + 1;
	while (end < lines.length && !/^\s*(Warning:|\[)/.test(lines[end]!)) end++;
	return lines.slice(start, end);
}

describe("the client in a terminal", () => {
	beforeAll(async () => {
		agentDir = mkdtempSync(join(tmpdir(), "pi-tmux-verify-agent-"));
		projectDir = mkdtempSync(join(tmpdir(), "pi-tmux-verify-project-"));

		// Two extensions that the client has something to say about: one that declares the
		// server side (the client does not render with it) and one that registers a command
		// that clashes with a built-in one. The screen must say so in a line or two, not in a
		// screenful.
		const extensionDir = join(projectDir, ".pi", "extensions");
		mkdirSync(extensionDir, { recursive: true });
		writeFileSync(
			join(extensionDir, "server-side.ts"),
			[
				'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
				"",
				"export default function (pi: ExtensionAPI) {",
				'\tpi.setSide("server");',
				'\tpi.registerCommand("srvdemo", { description: "demo", handler: async () => {} });',
				"}",
				"",
			].join("\n"),
		);
		writeFileSync(
			join(extensionDir, "conflict.ts"),
			[
				'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
				"",
				"export default function (pi: ExtensionAPI) {",
				'\tpi.setSide("client");',
				'\tpi.registerCommand("fork", { description: "clashes with a built-in", handler: async () => {} });',
				"}",
				"",
			].join("\n"),
		);

		tmux(["kill-session", "-t", SESSION_NAME], true);
		tmux([
			"new-session",
			"-d",
			"-s",
			SESSION_NAME,
			"-x",
			String(WIDE_WIDTH),
			"-y",
			String(WINDOW_HEIGHT),
			"-c",
			projectDir,
			`PI_OFFLINE=1 ${AGENT_DIR_ENV}=${agentDir} bun ${CLIENT_ENTRY}`,
		]);

		try {
			await waitForPane("the project trust question", (pane) => pane.includes("Trust the project folder"));
			tmux(["send-keys", "-t", SESSION_NAME, "y", "Enter"]);

			await waitForPane(
				"the client and the server it is connected to",
				(pane) => /server \S+:\d+/.test(pane) && /^\s*>\s*$/m.test(pane),
			);
			widePane = capturePane();

			// The narrow layout is checked before the pairing dialog opens, because the dialog
			// takes the focus and the keys do not reach the editor while it is up.
			tmux(["resize-window", "-t", SESSION_NAME, "-x", String(NARROW_WIDTH), "-y", String(WINDOW_HEIGHT)]);
			await waitForPane(
				"the narrow layout",
				(pane) => pane.includes("no-model") && pane.split("\n").every((line) => line.length <= NARROW_WIDTH),
			);
			narrowPane = captureVisiblePane();

			tmux(["resize-window", "-t", SESSION_NAME, "-x", String(WIDE_WIDTH), "-y", String(WINDOW_HEIGHT)]);
			await waitForPane("the wide layout again", (pane) => pane.includes("no-model"));

			tmux(["send-keys", "-t", SESSION_NAME, "/pair"]);
			await delay(500);
			tmux(["send-keys", "-t", SESSION_NAME, "Enter"]);
			await waitForPane("the pairing dialog", (pane) => pane.includes("Code:"));
			pairPane = captureVisiblePane();

			const registration = readServerRegistration();
			serverUrl = registration?.url ?? "";
		} catch (error) {
			cleanup();
			throw error;
		}
	}, 180_000);

	afterAll(() => {
		cleanup();
	});

	test("the banner and the prompt are on the screen", () => {
		expect(widePane).toMatch(/v\d+\.\d+\.\d+/);
		expect(widePane).toMatch(/^\s*>\s*$/m);
		expect(widePane).toContain("ctrl+c twice to exit");
	});

	test("the server the client is connected to is visible", () => {
		expect(serverUrl).not.toBe("");
		expect(widePane).toContain(`server ${hostPortOf(serverUrl)}`);
	});

	test("the extension diagnostics are not a wall of text", () => {
		expect(widePane).not.toContain("conflicts with built-in interactive command");
		expect(widePane).not.toContain("declares the server side");
		const block = diagnosticsBlock(widePane);
		expect(block.length).toBeLessThanOrEqual(Math.ceil(WINDOW_HEIGHT * DIAGNOSTICS_WALL_SHARE));
	});

	test("/pair shows a QR code and the pairing code", () => {
		const code = /Code:\s*([A-Za-z0-9_-]{8,})/.exec(pairPane)?.[1];
		expect(code).toBeDefined();
		expect(pairPane).toContain(`/auth/connect/${code}`);
		const qrLines = pairPane.split("\n").filter((line) => /[█▀▄]/.test(line));
		expect(qrLines.length).toBeGreaterThanOrEqual(10);
	});

	test("the layout stays usable in a narrow window", () => {
		expect(narrowPane).toMatch(/^\s*>\s*$/m);
		expect(narrowPane).toContain("no-model");
		expect(narrowPane).toMatch(/v\d+\.\d+\.\d+/);
		for (const line of narrowPane.split("\n")) {
			expect(line.length).toBeLessThanOrEqual(NARROW_WIDTH);
		}
	});
});

/**
 * Kill the tmux session and the server the client started, and remove the temporary directories.
 */
function cleanup(): void {
	// The socket file outlives the server that owned it, so its path is read before the
	// server goes away.
	const socketPath = tmux(["display-message", "-p", "#{socket_path}"], true).trim();
	tmux(["kill-session", "-t", SESSION_NAME], true);
	tmux(["kill-server"], true);
	if (socketPath) rmSync(socketPath, { force: true });
	const registration = readServerRegistration();
	if (registration) {
		try {
			process.kill(registration.pid, "SIGTERM");
		} catch {}
	}
	if (agentDir) {
		rmSync(agentDir, { recursive: true, force: true });
	}
	if (projectDir) {
		rmSync(projectDir, { recursive: true, force: true });
	}
}
