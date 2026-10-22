#!/usr/bin/env node
/**
 * How long pi takes to show its first frame.
 *
 * The binary is the thing the user runs, so the measurement is the whole run: the
 * process starts, the client starts the server, the server opens the session and the
 * terminal UI draws. The frame is read from a tmux pane, so the measurement includes
 * the terminal the user actually has.
 *
 * Usage: node scripts/profile-startup.mjs [options]
 *
 * Options:
 *   --binary <path>   The client binary (default packages/client/dist/bundle/cli.js)
 *   --runtime <name>  bun or node, for a JavaScript entry (default bun)
 *   --runs <n>        Number of measured runs (default 3)
 *   --extensions <n>  Install n real extensions in the agent directory
 *   --help            Show this help
 */

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES = join(ROOT, "packages", "coding-agent", "examples", "extensions");
const SESSION = "pi-startup";
const POLL_MS = 25;
const TIMEOUT_MS = 30_000;
const FIRST_FRAME = /New session|escape interrupt/;

function parseArgs(argv) {
	const options = { binary: join(ROOT, "packages", "client", "dist", "bundle", "cli.js"), runtime: "bun", runs: 3, extensions: 0 };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--binary") options.binary = argv[++index];
		else if (arg === "--runtime") options.runtime = argv[++index];
		else if (arg === "--runs") options.runs = Number.parseInt(argv[++index], 10);
		else if (arg === "--extensions") options.extensions = Number.parseInt(argv[++index], 10);
		else if (arg === "--help") {
			console.log(`Usage: node scripts/profile-startup.mjs [--binary <path>] [--runtime bun] [--runs n] [--extensions n]`);
			process.exit(0);
		}
	}
	return options;
}

function tmux(args) {
	return spawnSync("tmux", args, { encoding: "utf8" });
}

/** Wait until the pane shows the first frame, and return the time it took. */
function waitForFrame(startedAt) {
	const deadline = startedAt + TIMEOUT_MS;
	while (performance.now() < deadline) {
		const pane = tmux(["capture-pane", "-t", SESSION, "-p"]).stdout ?? "";
		if (FIRST_FRAME.test(pane)) return performance.now() - startedAt;
		spawnSync("sleep", [String(POLL_MS / 1000)]);
	}
	return undefined;
}

const options = parseArgs(process.argv.slice(2));
const launch = options.binary.endsWith(".js") ? `${options.runtime} ${options.binary}` : options.binary;
const runs = [];

for (let run = 0; run < options.runs; run++) {
	const dir = mkdtempSync(join(tmpdir(), "pi-startup-"));
	const agentDir = join(dir, "agent");
	const project = join(dir, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(project, { recursive: true });
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "always" }));
	if (options.extensions > 0) {
		const extensions = join(agentDir, "extensions");
		mkdirSync(extensions, { recursive: true });
		for (const name of ["message-renderer.ts", "custom-header.ts", "widget-placement.ts"].slice(0, options.extensions)) {
			cpSync(join(EXAMPLES, name), join(extensions, name));
		}
	}

	tmux(["kill-session", "-t", SESSION]);
	const startedAt = performance.now();
	const child = spawnSync(
		"tmux",
		["new-session", "-d", "-s", SESSION, "-x", "120", "-y", "40", `cd ${project} && PI_CODING_AGENT_DIR=${agentDir} PI_OFFLINE=1 ${launch}`],
		{ encoding: "utf8" },
	);
	if (child.status !== 0) throw new Error(`tmux failed: ${child.stderr}`);
	const frameMs = waitForFrame(startedAt);
	runs.push(frameMs);
	tmux(["kill-session", "-t", SESSION]);
	// The server the client started stays alive; stop it through its registration file.
	const registrationPath = join(agentDir, "server.json");
	if (existsSync(registrationPath)) {
		try {
			const registration = JSON.parse(execFileSync("cat", [registrationPath], { encoding: "utf8" }));
			process.kill(registration.pid, "SIGTERM");
		} catch {
			// The server already stopped.
		}
	}
	rmSync(dir, { recursive: true, force: true });
}

const measured = runs.filter((value) => value !== undefined).sort((a, b) => a - b);
const label = `first frame (${options.extensions} extension(s))`;
if (measured.length === 0) {
	console.log(`${label}: no frame in ${TIMEOUT_MS} ms`);
	process.exitCode = 1;
} else {
	const median = measured[Math.floor(measured.length / 2)];
	console.log(`${label}: median ${median.toFixed(0)} ms (min ${measured[0].toFixed(0)}, max ${measured[measured.length - 1].toFixed(0)})`);
}
