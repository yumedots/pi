#!/usr/bin/env node
/**
 * The interactive path's session check.
 *
 * The session round trip (`session-compat.mjs`) also drives the TUI, but it
 * only reads the file the *other* side can open — a producer whose run never
 * happened still passes it, because there is nothing to lose. This check
 * drives the port in the TUI and then looks at the file the port wrote:
 *
 *   1. a prompt, an answer, a clean `/quit` — the run must really happen;
 *   2. the session file must hold the header, the user message and the
 *      assistant message, in the original's shapes;
 *   3. a session that never chatted must leave no file behind — the original
 *      writes the file with the first user or assistant message
 *      (`packages/coding-agent/src/core/session-manager.ts:1165-1189`), so
 *      opening and closing pi without chatting leaves nothing on disk.
 *
 * Usage:  node scripts/parity/interactive-session.mjs
 * Env:    PI_PARITY_RUST_BIN    the rpi binary (default: rpi/target/debug/rpi)
 *         PI_PARITY_HOME        scratch directory (default: /tmp/pi-parity)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startMockServerProcess } from "./mock-server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const RUST_BIN =
	process.env.PI_PARITY_RUST_BIN ??
	(existsSync(join(ROOT, "rpi/target-agents/debug/rpi"))
		? join(ROOT, "rpi/target-agents/debug/rpi")
		: join(ROOT, "rpi/target/debug/rpi"));
const HOME = process.env.PI_PARITY_HOME ?? "/tmp/pi-parity";
const WORK = join(HOME, "interactive-session");
const SOCKET = "pi-interactive-session";

const PANE_WIDTH = 100;
const PANE_HEIGHT = 30;
const PROMPT = "hello world";
const REPLY = "Hello from the parity mock.";
/** The footer names the resolved model: the app is up and the session is live. */
const READY = "mock/mock-1";
/** The theme picker's marker: it owns the pane until it is dismissed. */
const THEME_PICKER = "Pick a theme";

function tmux(args) {
	return execFileSync("tmux", ["-L", SOCKET, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
}

function pane(session) {
	try {
		return tmux(["capture-pane", "-p", "-t", session]);
	} catch {
		return "";
	}
}

function sleep(ms) {
	spawnSync("sleep", [String(ms / 1000)]);
}

/** Write a file, creating the directories above it. */
function writeFile(path, contents) {
	mkdirSync(dirname(path), { recursive: true });
	spawnSync("sh", ["-c", `cat > '${path}'`], { input: contents, encoding: "utf8" });
}

/** Every session file under a directory tree. */
function sessionFiles(dir) {
	const found = [];
	const walk = (current) => {
		let entries;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith(".jsonl")) found.push(full);
		}
	};
	walk(dir);
	return found.sort();
}

/** The agent dir and the work dir of one run. */
function freshDirs(name) {
	const agentDir = join(WORK, `${name}-agent`);
	const cwd = join(WORK, `${name}-work`);
	rmSync(agentDir, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	writeFile(
		join(agentDir, "models.json"),
		`${JSON.stringify(
			{
				providers: {
					mock: {
						baseUrl: process.env.PI_PARITY_MOCK_URL,
						api: "openai-completions",
						apiKey: "parity-key",
						models: [
							{ id: "mock-1", name: "Mock Model", contextWindow: 128000, maxTokens: 4096 },
						],
					},
				},
			},
			null,
			1,
		)}\n`,
	);
	// A settings file makes the agent dir an existing profile, so the first-run
	// theme picker stays out of the way — the original skips it for a custom
	// agent dir anyway (`packages/coding-agent/src/cli/first-time-setup.ts:37`).
	writeFile(join(agentDir, "settings.json"), `${JSON.stringify({ hideThinkingBlock: false }, null, 1)}\n`);
	return { agentDir, cwd };
}

function portCommand({ cwd, agentDir }) {
	return [
		`cd ${cwd} &&`,
		`PI_CODING_AGENT_DIR=${agentDir}`,
		RUST_BIN,
		"--offline --provider mock --model mock/mock-1 --api-key parity-key",
	].join(" ");
}

/** Start the port in a pane of its own. */
function startPort(session, command) {
	spawnSync("tmux", ["-L", SOCKET, "kill-session", "-t", session], { stdio: "ignore" });
	spawnSync("tmux", ["-L", SOCKET, "new-session", "-d", "-s", session], { stdio: "ignore" });
	tmux([
		"new-session",
		"-d",
		"-s",
		session,
		"-x",
		String(PANE_WIDTH),
		"-y",
		String(PANE_HEIGHT),
		"sh",
		"-c",
		command,
	]);
}

/**
 * Wait for the port to be ready to take a prompt.
 *
 * The readiness signal is the pane itself: the theme picker (when the agent
 * dir has no settings file) owns the pane until it is dismissed, and the
 * footer line with the resolved model means the app is up. A port that never
 * becomes ready fails here instead of silently measuring nothing.
 */
function waitForReady(session, timeoutMs = 20000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const screen = pane(session);
		if (screen.includes(READY) && !screen.includes(THEME_PICKER)) return true;
		sleep(250);
	}
	return false;
}

/** Wait for the answer to show up in the pane. */
function waitForReply(session, timeoutMs = 30000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (pane(session).includes(REPLY)) return true;
		sleep(250);
	}
	return false;
}

/** Type a line and press Enter. */
function submit(session, text) {
	tmux(["send-keys", "-t", session, text]);
	sleep(200);
	tmux(["send-keys", "-t", session, "Enter"]);
}

/** The entries of a session file, oldest first. */
function readEntries(file) {
	return readFileSync(file, "utf8")
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line));
}

const failures = [];

function check(condition, message) {
	if (!condition) failures.push(message);
	return condition;
}

const mock = await startMockServerProcess({ turns: [{ type: "text", text: REPLY }] });
try {
	rmSync(WORK, { recursive: true, force: true });
	mkdirSync(WORK, { recursive: true });

	// ---- 1. a run in the TUI leaves the messages on disk ----
	{
		const { agentDir, cwd } = freshDirs("run");
		const session = "interactive-run";
		startPort(session, portCommand({ cwd, agentDir }));
		const ready = waitForReady(session);
		check(ready, "the port never became ready (the pane never showed the model footer)");
		if (ready) {
			submit(session, PROMPT);
			const answered = waitForReply(session);
			check(answered, "the prompt was not accepted: the answer never appeared in the pane");
		}
		// A clean quit: the file must survive it.
		submit(session, "/quit");
		sleep(2000);

		const files = sessionFiles(join(agentDir, "sessions"));
		check(files.length === 1, `expected one session file, found ${files.length}`);
		if (files.length === 1) {
			const entries = readEntries(files[0]);
			const header = entries[0];
			check(header?.type === "session", "the first line is not the session header");
			check(header?.version === 3, `the header is not version 3 (${header?.version})`);
			const messages = entries.filter((entry) => entry.type === "message");
			const user = messages.find((entry) => entry.message?.role === "user");
			const assistant = messages.find((entry) => entry.message?.role === "assistant");
			check(!!user, "the session file has no user message");
			check(!!assistant, "the session file has no assistant message");
			const userText =
				typeof user?.message?.content === "string"
					? user.message.content
					: (user?.message?.content ?? [])
							.map((block) => block?.text ?? "")
							.join("");
			check(userText.includes(PROMPT), `the user message does not carry the prompt (${userText})`);
			const assistantText = (assistant?.message?.content ?? [])
				.map((block) => block?.text ?? "")
				.join("");
			check(
				assistantText.includes(REPLY),
				`the assistant message does not carry the answer (${assistantText})`,
			);
			check(
				assistant?.parentId === user?.id,
				"the assistant message is not a child of the user message",
			);
			console.log(
				`the run wrote ${statSync(files[0]).size} bytes: ${entries.length} entries (${messages.length} messages)`,
			);
		}
		spawnSync("tmux", ["-L", SOCKET, "kill-session", "-t", session], { stdio: "ignore" });
	}

	// ---- 2. a session that never chatted leaves no file ----
	{
		const { agentDir, cwd } = freshDirs("quiet");
		const session = "interactive-quiet";
		startPort(session, portCommand({ cwd, agentDir }));
		const ready = waitForReady(session);
		check(ready, "the port never became ready (the pane never showed the model footer)");
		submit(session, "/quit");
		sleep(2000);
		const files = sessionFiles(join(agentDir, "sessions"));
		check(
			files.length === 0,
			`a session that never chatted left ${files.length} file(s) behind: the original writes the file with the first turn`,
		);
		spawnSync("tmux", ["-L", SOCKET, "kill-session", "-t", session], { stdio: "ignore" });
	}
} finally {
	await mock.close();
	spawnSync("tmux", ["-L", SOCKET, "kill-session", "-t", "interactive-run"], { stdio: "ignore" });
	spawnSync("tmux", ["-L", SOCKET, "kill-session", "-t", "interactive-quiet"], { stdio: "ignore" });
}

if (failures.length > 0) {
	console.log("\n## interactive session check");
	for (const failure of failures) console.log(`FAILED: ${failure}`);
	process.exitCode = 1;
} else {
	console.log("\n## interactive session check");
	console.log("the TUI run wrote the messages to the session file, and a quiet session left no file");
}
