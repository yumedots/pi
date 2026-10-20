#!/usr/bin/env node
/**
 * Session-file round trip: the acceptance test for the session format work.
 *
 * Drives the TypeScript original and the Rust port once each against the mock
 * model, then has each side import the *other* side's session file and checks
 * two things:
 *
 *   1. the file OPENS — the import succeeds and the transcript appears;
 *   2. the CONTENT SURVIVES — the turns the producer showed (the user turn,
 *      the assistant reply, the thinking block, the tool call) are still
 *      visible in the consumer.
 *
 * A session that opens and loses the thinking level, the tool call or the
 * usage is still broken, so both are checked and reported separately.
 *
 * Usage:  node scripts/parity/session-compat.mjs
 * Env:    PI_PARITY_TS_ROOT     the TypeScript checkout (default: the repo root)
 *         PI_PARITY_RUST_BIN    the rpi binary (default: rpi/target/debug/rpi)
 *         PI_PARITY_HOME        scratch directory (default: /tmp/pi-parity)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startMockServerProcess } from "./mock-server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const TS = process.env.PI_PARITY_TS_ROOT ?? ROOT;
const RUST_BIN = process.env.PI_PARITY_RUST_BIN ?? join(ROOT, "rpi/target/debug/rpi");
const HOME = process.env.PI_PARITY_HOME ?? "/tmp/pi-parity";
const WORK = join(HOME, "session-compat");
const SOCKET = "pi-session-compat";

const PANE_WIDTH = 100;
const PANE_HEIGHT = 30;
const PROMPT = "hello world";

/**
 * The facts a session must carry from one program to the other. `content` is
 * the transcript the user sees; `stats` is the session's accounting, which the
 * original recomputes on import and a port may not.
 */
const FACTS = [
	{ id: "user turn", kind: "content", match: /hello world/i },
	{ id: "assistant reply", kind: "content", match: /Hello from the parity mock\./ },
	{ id: "thinking block", kind: "content", match: /The parity mock thinks before it answers\./ },
	{ id: "tool call", kind: "content", match: /round-trip\.txt/ },
	{ id: "token usage", kind: "stats", match: /\b\d[\d,]* tokens\b/ },
];

/** The pane text that means "the import did not work". */
const FAILURE = /no session matches|Could not open|not a JSONL|Unknown .*format|Usage: \/import|Failed to import|Import cancelled/i;

function tmux(args) {
	return execFileSync("tmux", ["-L", SOCKET, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
}

/**
 * Keep the tmux server alive for the whole run. A tmux server dies with its
 * last session, so a boot session holds it open.
 */
function ensureServer() {
	try {
		tmux(["list-sessions"]);
	} catch {
		tmux(["new-session", "-d", "-s", "compat-boot", "sleep", "600"]);
	}
}

function pane(session) {
	try {
		return tmux(["capture-pane", "-p", "-t", session]);
	} catch {
		return "";
	}
}

/** Run a command in a tmux pane, wait, and return the pane text. */
function runInPane(session, command, steps) {
	ensureServer();
	spawnSync("tmux", ["-L", SOCKET, "kill-session", "-t", session], { stdio: "ignore" });
	tmux(["new-session", "-d", "-s", session, "-x", String(PANE_WIDTH), "-y", String(PANE_HEIGHT), "sh", "-c", command]);
	try {
		for (const step of steps) {
			for (const key of step.keys ?? []) tmux(["send-keys", "-t", session, key]);
			spawnSync("sleep", [String((step.settle ?? 1000) / 1000)]);
		}
		return pane(session);
	} finally {
		spawnSync("tmux", ["-L", SOCKET, "kill-session", "-t", session], { stdio: "ignore" });
	}
}

/** Minimal write helper (the audit scripts avoid an fs import for writes). */
function writeFile(path, contents) {
	mkdirSync(dirname(path), { recursive: true });
	spawnSync("sh", ["-c", `cat > '${path}'`], { input: contents, encoding: "utf8" });
}

/** The agent dir each side needs: the mock provider and the settings both read. */
function writeAgentDir(agentDir, baseUrl) {
	mkdirSync(agentDir, { recursive: true });
	writeFile(
		join(agentDir, "models.json"),
		`${JSON.stringify(
			{
				providers: {
					mock: {
						baseUrl,
						api: "openai-completions",
						apiKey: "parity-key",
						models: [{ id: "mock-1", name: "Mock Model", contextWindow: 128000, maxTokens: 4096 }],
					},
				},
			},
			null,
			1,
		)}\n`,
	);
	// `hideThinkingBlock: false` so the thinking block is visible in the pane
	// and the round trip can be checked for it.
	writeFile(
		join(agentDir, "settings.json"),
		`${JSON.stringify({ threeDEmptySession: true, hideThinkingBlock: false }, null, 1)}\n`,
	);
}

function tsCommand({ cwd, agentDir, clock }) {
	return [
		`cd ${cwd} &&`,
		`PI_CODING_AGENT_DIR=${agentDir}`,
		`PI_PARITY_CLOCK=${clock}`,
		`bun --preload ${join(HERE, "clock-preload.mjs")} ${join(TS, "packages/coding-agent/src/cli.ts")}`,
		"--offline --provider mock --model mock/mock-1",
	].join(" ");
}

function rustCommand({ cwd, agentDir, clock }) {
	return [
		`cd ${cwd} &&`,
		`RPI_CODING_AGENT_DIR=${agentDir}`,
		`PI_PARITY_CLOCK=${clock}`,
		RUST_BIN,
		"--offline --provider mock --model mock/mock-1 --api-key parity-key",
	].join(" ");
}

/** Every session file under a directory tree. */
function sessionFiles(dir) {
	const found = [];
	const walk = (current) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith(".jsonl") && statSync(full).size > 0) found.push(full);
		}
	};
	if (existsSync(dir)) walk(dir);
	return found.sort();
}

/** The facts a pane shows. */
function factsIn(screen) {
	return FACTS.filter((fact) => fact.match.test(screen)).map((fact) => fact.id);
}

/** Run one side once and return the session file it wrote plus the pane. */
function produceSession(side, baseUrl, clock) {
	const agentDir = join(WORK, `${side}-agent`);
	const cwd = join(WORK, `${side}-work`);
	rmSync(agentDir, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	writeAgentDir(agentDir, baseUrl);
	const command =
		side === "ts" ? tsCommand({ cwd, agentDir, clock }) : rustCommand({ cwd, agentDir, clock });
	const screen = runInPane(`compat-${side}`, command, [
		{ settle: 5000 },
		{ keys: [PROMPT], settle: 800 },
		{ keys: ["Enter"], settle: 5000 },
		{ settle: 4000 },
	]);
	const files = sessionFiles(side === "ts" ? join(agentDir, "sessions") : join(cwd, ".rpi", "sessions"));
	return { screen, facts: factsIn(screen), files };
}

/** Have one side import a session file and report what it did. */
function importSession(side, baseUrl, clock, file) {
	const agentDir = join(WORK, `${side}-import-agent`);
	const cwd = join(WORK, `${side}-import-work`);
	rmSync(agentDir, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	writeAgentDir(agentDir, baseUrl);
	const command =
		side === "ts" ? tsCommand({ cwd, agentDir, clock }) : rustCommand({ cwd, agentDir, clock });
	const screen = runInPane(`compat-import-${side}`, command, [
		{ settle: 5000 },
		{ keys: [`/import ${file}`], settle: 800 },
		{ keys: ["Enter"], settle: 1500 },
		// The original asks "Replace current session with <file>?" before it
		// imports; the port does not. Answer the dialog so both sides get the
		// same chance.
		{ keys: ["Enter"], settle: 4000 },
		{ settle: 2000 },
	]);
	const failure = screen.match(FAILURE);
	const facts = factsIn(screen);
	const tail = screen
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(-6)
		.join(" | ");
	return { failure: failure ? failure[0] : null, facts, tail, screen };
}

const mock = await startMockServerProcess({
	turns: [
		{ type: "thinking", thinking: "The parity mock thinks before it answers.", text: "Hello from the parity mock." },
		{ type: "toolCall", name: "read", arguments: { path: "round-trip.txt" } },
		{ type: "text", text: "The round trip is complete." },
	],
});
try {
	rmSync(WORK, { recursive: true, force: true });
	mkdirSync(WORK, { recursive: true });
	const clock = join(WORK, "clock");
	writeFile(clock, "0");
	ensureServer();

	const produced = {};
	for (const side of ["ts", "rust"]) {
		const { files, facts } = produceSession(side, mock.baseUrl, clock);
		if (files.length === 0) {
			console.log(`${side}: wrote no session file`);
			process.exitCode = 1;
			continue;
		}
		const copy = join(WORK, `${side}-session.jsonl`);
		copyFileSync(files[0], copy);
		produced[side] = { file: copy, facts };
		console.log(`${side}: wrote ${files[0]}`);
		console.log(`${side}: pane shows ${facts.join(", ") || "nothing"}`);
	}

	const rows = [];
	for (const producer of ["ts", "rust"]) {
		const consumer = producer === "ts" ? "rust" : "ts";
		if (!produced[producer]) {
			rows.push({ producer, consumer, result: "skipped", detail: "the producer wrote no session file" });
			continue;
		}
		const outcome = importSession(consumer, mock.baseUrl, clock, produced[producer].file);
		if (outcome.failure) {
			rows.push({
				producer,
				consumer,
				result: "BROKEN",
				detail: `the import failed: ${outcome.failure}`,
				tail: outcome.tail,
			});
			continue;
		}
		const expected = FACTS.filter((fact) => fact.kind === "content" && produced[producer].facts.includes(fact.id));
		const lost = expected.filter((fact) => !outcome.facts.includes(fact.id)).map((fact) => fact.id);
		const statsLost = FACTS.filter(
			(fact) => fact.kind === "stats" && produced[producer].facts.includes(fact.id) && !outcome.facts.includes(fact.id),
		).map((fact) => fact.id);
		rows.push({
			producer,
			consumer,
			result: lost.length === 0 ? (statsLost.length === 0 ? "ok" : "lossy") : "BROKEN",
			detail:
				lost.length === 0
					? statsLost.length === 0
						? "the session opened and the transcript survived"
						: `the transcript survived; lost: ${statsLost.join(", ")}`
					: `the transcript lost: ${lost.join(", ")}`,
			tail: outcome.tail,
		});
	}

	console.log("\n## session file round trip");
	for (const row of rows) {
		console.log(`${row.producer} -> ${row.consumer}: ${row.result} (${row.detail})`);
		if (row.result !== "ok" && row.tail) console.log(`    last pane: ${row.tail}`);
	}
	if (rows.some((row) => row.result === "BROKEN" || row.result === "lossy")) process.exitCode = 1;
} finally {
	await mock.close();
	spawnSync("tmux", ["-L", SOCKET, "kill-session", "-t", "compat-boot"], { stdio: "ignore" });
}
