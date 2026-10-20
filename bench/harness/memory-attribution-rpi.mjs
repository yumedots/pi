#!/usr/bin/env node
/**
 * Where the memory of the Rust port goes, layer by layer.
 *
 * The TypeScript agent is measured by importing its modules one by one, so every
 * step is what the module adds on top of the ones before it. The Rust port is
 * one binary, so its layers are the modes that load them: the version, the
 * model catalog, the headless agent and the interactive mode. Every step is the
 * state of the one before it plus the layer it names, and the cost is the
 * difference between them.
 *
 * Usage:
 *   node bench/harness/memory-attribution-rpi.mjs [options]
 *
 * Options:
 *   --agent-dir <dir> The agent directory (default: PI_BENCH_AGENT_DIR)
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const RPI = join(REPO_ROOT, "rpi/target/release/rpi");
const TIME_BIN = "/usr/bin/time";

const options = { agentDir: process.env.PI_BENCH_AGENT_DIR };

for (let index = 2; index < process.argv.length; index++) {
	const arg = process.argv[index];
	const value = process.argv[++index];
	if (arg === "--agent-dir") options.agentDir = resolve(value);
	else throw new Error(`Unknown option: ${arg}`);
}

/** The layers of the binary, in the order they are loaded. */
const steps = [
	{ label: "the runtime itself", command: "/usr/bin/true", args: [] },
	{ label: "the cli (the arguments, the config)", command: RPI, args: ["--version"] },
	{ label: "the model catalog (every provider)", command: RPI, args: ["--list-models"] },
	{ label: "the agent, the tools and their schemas", command: RPI, args: ["--mode", "rpc", "--no-session"], rpc: true },
	{ label: "the interactive mode", command: RPI, args: [], tui: true },
];

/** The peak resident set size of a run, out of the report of `/usr/bin/time -l`. */
function peakRssBytes(stderr) {
	const match = stderr.match(/(\d+)\s+maximum resident set size/);
	return match ? Number.parseInt(match[1], 10) : undefined;
}

function shellQuote(value) {
	return `'${String(value).replaceAll("'", "'\\''")}'`;
}

/** A run that ends by itself. */
function measureOnce(command, args, env) {
	const result = spawnSync(TIME_BIN, ["-l", command, ...args], { encoding: "utf8", env });
	return peakRssBytes(result.stderr);
}

/**
 * A run that stays up: the rpc mode, which answers on stdin, and the
 * interactive mode, which needs a terminal.
 */
function measureWhileUp(command, args, env, { rpc = false, tui = false } = {}) {
	if (tui) return measureInTmux(command, args, env);
	return new Promise((resolvePromise) => {
		const child = spawn(TIME_BIN, ["-l", command, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
		let stderr = "";
		let buffer = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			buffer += chunk;
			if (!rpc || !buffer.includes("\n")) return;
			child.stdin.end();
		});
		child.stdin.write(`${JSON.stringify({ id: "s", type: "get_state" })}\n`);
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
		}, 5000);
		child.once("close", () => {
			clearTimeout(timer);
			resolvePromise(peakRssBytes(stderr));
		});
	});
}

/** The deepest process of a chain, the agent under the shell and the timer. */
function deepestPid(pid) {
	const children = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" })
		.stdout.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (children.length === 0) return pid;
	return deepestPid(children[0]);
}

/** A run of the interactive mode, in a terminal. */
function measureInTmux(command, args, env) {
	const session = `pi-mem-${process.pid}`;
	const stderrPath = join(tmpdir(), `pi-mem-${session}.log`);
	rmSync(stderrPath, { force: true });
	const envPrefix = Object.entries(env)
		.map(([key, value]) => `${key}=${shellQuote(value)}`)
		.join(" ");
	const line = [
		`${TIME_BIN} -l`,
		shellQuote(command),
		...args.map(shellQuote),
		`2>${shellQuote(stderrPath)}`,
	].join(" ");
	spawnSync("tmux", ["kill-session", "-t", session]);
	spawnSync("tmux", [
		"new-session",
		"-d",
		"-s",
		session,
		"-x",
		"120",
		"-y",
		"40",
		"-c",
		REPO_ROOT,
		`${envPrefix} ${line}`,
	]);
	return new Promise((resolvePromise) => {
		setTimeout(() => {
			const pane = spawnSync("tmux", ["list-panes", "-t", session, "-F", "#{pane_pid}"], {
				encoding: "utf8",
			}).stdout.trim();
			if (pane) {
				const agent = deepestPid(pane);
				spawnSync("kill", ["-TERM", String(agent)]);
			}
			setTimeout(() => {
				spawnSync("tmux", ["kill-session", "-t", session]);
				const stderr = existsSync(stderrPath) ? readFileSync(stderrPath, "utf8") : "";
				rmSync(stderrPath, { force: true });
				resolvePromise(peakRssBytes(stderr));
			}, 500);
		}, 4000);
	});
}

if (!existsSync(RPI)) {
	throw new Error(`The Rust binary is not there: ${RPI}. Build it with: cargo build --release -p rpi-cli`);
}

const env = { ...process.env };
if (options.agentDir) env.PI_CODING_AGENT_DIR = options.agentDir;

console.log(`${"layer".padEnd(38)} cost`);
let previous = 0;
for (const step of steps) {
	const bytes =
		step.rpc || step.tui
			? await measureWhileUp(step.command, step.args, env, step)
			: measureOnce(step.command, step.args, env);
	if (bytes === undefined) {
		console.log(`${step.label.padEnd(38)} ?`);
		continue;
	}
	const megabytes = Math.round(bytes / 1048576);
	console.log(`${step.label.padEnd(38)} ${megabytes - previous >= 0 ? "+" : ""}${megabytes - previous} MB`);
	previous = megabytes;
}
console.log(`${"the whole agent".padEnd(38)} ${previous} MB`);
