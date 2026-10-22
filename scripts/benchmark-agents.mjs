#!/usr/bin/env node
/**
 * The benchmark of the new pi and the vanilla pi.
 *
 * Both arms run the same task in a workspace of their own, with the same model, the
 * same agent directory and the same tools. The script compares the tokens, the cost,
 * the number of model requests, the wall time, the peak memory and the answer.
 *
 * Usage: node scripts/benchmark-agents.mjs [options]
 */

import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MODEL = "opencode-go/beam-free";
const DEFAULT_TASK = 'Read the file "answer.txt" in the current directory and reply with its content, nothing else.';
const DEFAULT_SOURCE_AGENT_DIR = join(homedir(), ".pi", "agent");
const DEFAULT_VANILLA_CLI = "/tmp/vanilla-pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js";
const DEFAULT_CLIENT_CLI = join(ROOT, "packages", "client", "dist", "cli.js");
const DEFAULT_CLIENT_BUNDLE_CLI = join(ROOT, "packages", "client", "dist", "bundle", "cli.js");
const AGENT_DIR_FILES = ["auth.json", "settings.json", "models-store.json", "trust.json"];
const RUN_TIMEOUT_MS = 180_000;
const SAMPLE_INTERVAL_MS = 40;

function printHelp() {
	console.log(`Usage:
  node scripts/benchmark-agents.mjs [options]

Runs the same task through the new pi (client + server) and through the vanilla pi
(the single process agent published on npm), and compares them.

Options:
  --runs <n>             Number of runs per arm (default: 3)
  --arm <name>           vanilla, new, new-bundle or all (default: all)
  --model <id>           Model of both arms (default: ${DEFAULT_MODEL})
  --task <text>          The prompt of both arms (default: a task that reads a file)
  --agent-dir <dir>      The agent directory to copy the credentials and settings from
                         (default: ${DEFAULT_SOURCE_AGENT_DIR})
  --vanilla <path>       The cli.js of the vanilla pi
                         (default: ${DEFAULT_VANILLA_CLI})
  --client <path>        The cli.js of the new pi client (default: ${DEFAULT_CLIENT_CLI})
  --client-bundle <path> The bundled cli.js of the new pi client
                         (default: ${DEFAULT_CLIENT_BUNDLE_CLI})
  --base-dir <dir>       Where the workspaces live (default: a temp dir)
  --keep                 Keep the workspaces of the runs
  --json <path>          Write the raw results to a JSON file
  --help                 Show this help
`);
}

function parseArgs(argv) {
	const options = {
		runs: 3,
		arm: "all",
		model: DEFAULT_MODEL,
		task: DEFAULT_TASK,
		sourceAgentDir: DEFAULT_SOURCE_AGENT_DIR,
		vanillaCli: DEFAULT_VANILLA_CLI,
		clientCli: DEFAULT_CLIENT_CLI,
		clientBundleCli: DEFAULT_CLIENT_BUNDLE_CLI,
		baseDir: "",
		keep: false,
		json: "",
	};
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--runs") options.runs = Number.parseInt(argv[++index], 10);
		else if (arg === "--arm") options.arm = argv[++index];
		else if (arg === "--model") options.model = argv[++index];
		else if (arg === "--task") options.task = argv[++index];
		else if (arg === "--agent-dir") options.sourceAgentDir = argv[++index];
		else if (arg === "--vanilla") options.vanillaCli = argv[++index];
		else if (arg === "--client") options.clientCli = argv[++index];
		else if (arg === "--client-bundle") options.clientBundleCli = argv[++index];
		else if (arg === "--base-dir") options.baseDir = argv[++index];
		else if (arg === "--keep") options.keep = true;
		else if (arg === "--json") options.json = argv[++index];
		else if (arg === "--help") {
			printHelp();
			process.exit(0);
		} else throw new Error(`Unknown option: ${arg}`);
	}
	if (!Number.isFinite(options.runs) || options.runs < 1) throw new Error("--runs needs a number");
	return options;
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function findFiles(dir, suffix) {
	if (!existsSync(dir)) return [];
	const found = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) found.push(...findFiles(path, suffix));
		else if (path.endsWith(suffix)) found.push(path);
	}
	return found;
}

function rssOf(pids) {
	if (pids.length === 0) return {};
	try {
		const output = execFileSync("ps", ["-o", "pid=,rss=", "-p", pids.join(",")], { encoding: "utf8" });
		const rss = {};
		for (const line of output.split("\n")) {
			const match = line.trim().match(/^(\d+)\s+(\d+)$/);
			if (match) rss[match[1]] = Number(match[2]);
		}
		return rss;
	} catch {
		return {};
	}
}

function seedAgentDir(sourceAgentDir, targetAgentDir) {
	mkdirSync(targetAgentDir, { recursive: true });
	for (const name of AGENT_DIR_FILES) {
		const source = join(sourceAgentDir, name);
		if (existsSync(source)) copyFileSync(source, join(targetAgentDir, name));
	}
}

function sessionSummary(path) {
	const entries = [];
	for (const line of readFileSync(path, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			entries.push(JSON.parse(line));
		} catch {
			continue;
		}
	}
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };
	const requestUsage = [];
	let requests = 0;
	let answer = "";
	let systemPrompt = "";
	const toolCalls = [];
	const toolNames = [];
	let sessionStartedAt = 0;
	let userAt = 0;
	let firstAssistantAt = 0;
	let lastAssistantAt = 0;
	for (const entry of entries) {
		if (entry.type === "session" && !sessionStartedAt) sessionStartedAt = Date.parse(entry.timestamp);
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "user" && !userAt) userAt = message.timestamp ?? 0;
		if (message.role === "assistant") {
			if (message.timestamp) {
				if (!firstAssistantAt) firstAssistantAt = message.timestamp;
				lastAssistantAt = message.timestamp;
			}
			if (message.usage) {
				requests++;
				requestUsage.push({
					input: message.usage.input ?? 0,
					output: message.usage.output ?? 0,
					cacheRead: message.usage.cacheRead ?? 0,
					totalTokens: message.usage.totalTokens ?? 0,
					stopReason: message.stopReason ?? "",
				});
				usage.input += message.usage.input ?? 0;
				usage.output += message.usage.output ?? 0;
				usage.cacheRead += message.usage.cacheRead ?? 0;
				usage.cacheWrite += message.usage.cacheWrite ?? 0;
				usage.totalTokens += message.usage.totalTokens ?? 0;
				usage.cost += message.usage.cost?.total ?? 0;
			}
			for (const part of message.content ?? []) {
				if (part.type === "text" && part.text) answer = part.text;
				if (part.type === "toolCall") toolCalls.push(part.name);
			}
		}
		if (message.role === "system" && !systemPrompt) {
			systemPrompt =
				typeof message.content === "string"
					? message.content
					: (message.content ?? []).map((part) => part.text ?? "").join("\n");
			if (message.sections?.docs) systemPrompt += `\n${message.sections.docs}`;
			for (const tool of message.toolsAdded ?? []) toolNames.push(tool.name);
		}
	}
	return {
		usage,
		requests,
		requestUsage,
		answer: answer.trim(),
		systemPrompt,
		toolCalls,
		toolNames,
		entries: entries.length,
		sessionStartedAt,
		userAt,
		firstAssistantAt,
		lastAssistantAt,
	};
}

function stopServer(agentDir) {
	const file = join(agentDir, "server.json");
	if (!existsSync(file)) return;
	let pid;
	try {
		pid = JSON.parse(readFileSync(file, "utf8")).pid;
	} catch {
		return;
	}
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		return;
	}
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		try {
			process.kill(pid, 0);
		} catch {
			return;
		}
		execFileSync("sleep", ["0.1"]);
	}
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		return;
	}
}

function cliFor(arm, options) {
	if (arm === "vanilla") return options.vanillaCli;
	if (arm === "new-bundle") return options.clientBundleCli;
	return options.clientCli;
}

async function runOnce(arm, options, runIndex, secret) {
	const dir = mkdtempSync(join(options.baseDir, `bench-${arm}-`));
	const workspace = join(dir, "workspace");
	const agentDir = join(dir, "agent");
	const sessionDir = join(dir, "sessions");
	mkdirSync(workspace, { recursive: true });
	mkdirSync(sessionDir, { recursive: true });
	seedAgentDir(options.sourceAgentDir, agentDir);
	writeFileSync(join(workspace, "answer.txt"), `${secret}\n`);

	const cli = cliFor(arm, options);
	const args = ["--model", options.model, "-p", options.task];
	const env = {
		...process.env,
		PI_CODING_AGENT_DIR: agentDir,
		PI_CODING_AGENT_SESSION_DIR: sessionDir,
		PI_CODING_AGENT: "true",
	};

	const started = performance.now();
	const startedAtWall = Date.now();
	const child = spawn(process.execPath, [cli, ...args], { cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});

	const peak = new Map();
	let serverPid;
	let serverStartMs;
	const sampler = setInterval(() => {
		const pids = [child.pid];
		if (serverPid) pids.push(serverPid);
		for (const [pid, rss] of Object.entries(rssOf(pids))) {
			peak.set(pid, Math.max(peak.get(pid) ?? 0, rss));
		}
		if (!serverPid) {
			const file = join(agentDir, "server.json");
			if (existsSync(file)) {
				try {
					serverPid = JSON.parse(readFileSync(file, "utf8")).pid;
					serverStartMs = performance.now() - started;
				} catch {
					serverPid = undefined;
				}
			}
		}
	}, SAMPLE_INTERVAL_MS);

	const timeout = setTimeout(() => child.kill("SIGKILL"), RUN_TIMEOUT_MS);
	const exit = await new Promise((resolveExit) => {
		child.on("exit", (code, signal) => resolveExit({ code, signal }));
	});
	clearTimeout(timeout);
	clearInterval(sampler);
	const wallMs = performance.now() - started;

	stopServer(agentDir);

	const sessionFiles = [...findFiles(sessionDir, ".jsonl"), ...findFiles(join(agentDir, "sessions"), ".jsonl")];
	sessionFiles.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
	const session = sessionFiles.length > 0 ? sessionSummary(sessionFiles[0]) : null;

	const clientRssKb = peak.get(String(child.pid)) ?? 0;
	// The print mode hosts the server in the client process, so the server is the client.
	const serverPidIsTheClient = serverPid !== undefined && String(serverPid) === String(child.pid);
	const serverRssKb = serverPid && !serverPidIsTheClient ? (peak.get(String(serverPid)) ?? 0) : 0;
	const modelMs = session?.userAt && session?.lastAssistantAt ? session.lastAssistantAt - session.userAt : 0;
	const startedAt = session?.sessionStartedAt ? session.sessionStartedAt : startedAtWall;
	const result = {
		arm,
		run: runIndex,
		exitCode: exit.code,
		signal: exit.signal,
		wallMs: Math.round(wallMs),
		startupMs: session?.sessionStartedAt ? session.sessionStartedAt - startedAtWall : 0,
		prepareMs: session?.userAt ? session.userAt - startedAt : 0,
		modelMs,
		finishMs: session?.lastAssistantAt ? Math.round(wallMs - (session.lastAssistantAt - startedAtWall)) : 0,
		overheadMs: Math.round(wallMs - modelMs),
		serverStartMs: serverStartMs === undefined ? undefined : Math.round(serverStartMs),
		answer: session?.answer ?? stdout.trim(),
		stdout: stdout.trim(),
		stderr: stderr.trim(),
		requests: session?.requests ?? 0,
		usage: session?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
		toolCalls: session?.toolCalls ?? [],
		toolNames: session?.toolNames ?? [],
		requestUsage: session?.requestUsage ?? [],
		systemPrompt: session?.systemPrompt ?? "",
		sessionFile: sessionFiles[0] ?? "",
		peakRssMb: {
			client: Number((clientRssKb / 1024).toFixed(1)),
			server: Number((serverRssKb / 1024).toFixed(1)),
			sum: Number(((clientRssKb + serverRssKb) / 1024).toFixed(1)),
		},
		dir,
	};
	if (!options.keep) rmSync(dir, { recursive: true, force: true });
	return result;
}

function summarize(results) {
	return {
		answer: results.map((result) => result.answer),
		requests: results.map((result) => result.requests),
		input: results.map((result) => result.usage.input),
		output: results.map((result) => result.usage.output),
		cacheRead: results.map((result) => result.usage.cacheRead),
		cacheWrite: results.map((result) => result.usage.cacheWrite),
		totalTokens: results.map((result) => result.usage.totalTokens),
		cost: results.map((result) => result.usage.cost),
		wallMs: results.map((result) => result.wallMs),
		startupMs: results.map((result) => result.startupMs),
		prepareMs: results.map((result) => result.prepareMs),
		modelMs: results.map((result) => result.modelMs),
		finishMs: results.map((result) => result.finishMs),
		overheadMs: results.map((result) => result.overheadMs),
		serverStartMs: results.map((result) => result.serverStartMs ?? 0),
		clientRss: results.map((result) => result.peakRssMb.client),
		serverRss: results.map((result) => result.peakRssMb.server),
		sumRss: results.map((result) => result.peakRssMb.sum),
		tools: results[0].toolNames ?? [],
	};
}

function spread(values) {
	return `${median(values).toFixed(2)} (min ${Math.min(...values)}, max ${Math.max(...values)})`;
}

function reportTable(summaries) {
	const arms = Object.keys(summaries);
	const rows = [
		["answer", (s) => s.answer.map((a) => a || "(empty)").join(" | ")],
		["model requests", (s) => spread(s.requests)],
		["tools", (s) => s.tools.join(", ")],
		["input tokens", (s) => spread(s.input)],
		["output tokens", (s) => spread(s.output)],
		["cache read tokens", (s) => spread(s.cacheRead)],
		["cache write tokens", (s) => spread(s.cacheWrite)],
		["total tokens", (s) => spread(s.totalTokens)],
		["cost (USD)", (s) => spread(s.cost)],
		["wall time (ms)", (s) => spread(s.wallMs)],
		["startup to session (ms)", (s) => spread(s.startupMs)],
		["session to prompt (ms)", (s) => spread(s.prepareMs)],
		["model time (ms)", (s) => spread(s.modelMs)],
		["answer to exit (ms)", (s) => spread(s.finishMs)],
		["agent overhead (ms)", (s) => spread(s.overheadMs)],
		["server start (ms)", (s) => spread(s.serverStartMs)],
		["peak RSS client (MB)", (s) => spread(s.clientRss)],
		["peak RSS server (MB)", (s) => spread(s.serverRss)],
		["peak RSS sum (MB)", (s) => spread(s.sumRss)],
	];
	const header = ["metric", ...arms.map((arm) => `${arm} (median, spread)`)];
	const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
	for (const [label, format] of rows) {
		lines.push(`| ${label} | ${arms.map((arm) => format(summaries[arm])).join(" | ")} |`);
	}
	console.log(lines.join("\n"));
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (!existsSync(options.sourceAgentDir)) throw new Error(`No agent directory: ${options.sourceAgentDir}`);
	const arms = ["vanilla", "new", "new-bundle"];
	if (options.arm !== "all" && !arms.includes(options.arm)) {
		throw new Error(`Unknown arm: ${options.arm}`);
	}
	const selected = options.arm === "all" ? ["vanilla", "new"] : [options.arm];
	for (const arm of selected) {
		const cli = cliFor(arm, options);
		if (!existsSync(cli)) throw new Error(`No cli for the ${arm} arm: ${cli}`);
	}

	const baseDir = options.baseDir || join(tmpdir(), "pi-benchmark-");
	mkdirSync(baseDir, { recursive: true });
	const secret = `BENCH-${randomBytes(4).toString("hex")}`;
	console.log(`Task: ${options.task}`);
	console.log(`Secret in answer.txt: ${secret}`);
	console.log(`Model: ${options.model}`);
	console.log(`Runs per arm: ${options.runs}`);
	console.log(`Workspaces: ${baseDir}`);
	console.log("");

	const results = [];
	for (let run = 0; run < options.runs; run++) {
		const order = run % 2 === 0 ? selected : [...selected].reverse();
		for (const arm of order) {
			const result = await runOnce(arm, options, run + 1, secret);
			results.push(result);
			console.log(
				`${arm} run ${run + 1}: ${result.wallMs} ms, ${result.requests} requests, ` +
					`${result.usage.totalTokens} tokens, rss ${result.peakRssMb.sum} MB, answer: ${result.answer || "(empty)"}`,
			);
			if (result.exitCode !== 0) console.log(`  exit ${result.exitCode}: ${result.stderr.slice(0, 400)}`);
		}
	}

	const summaries = {};
	for (const arm of selected) {
		summaries[arm] = summarize(results.filter((result) => result.arm === arm));
	}
	console.log("");
	reportTable(summaries);

	const vanillaPrompt = results.find((result) => result.arm === "vanilla")?.systemPrompt ?? "";
	const newPrompt = results.find((result) => result.arm === "new")?.systemPrompt ?? "";
	if (vanillaPrompt && newPrompt) {
		const same = vanillaPrompt === newPrompt;
		console.log(`\nSystem prompt identical: ${same}`);
		if (!same) {
			const vanillaLines = vanillaPrompt.split("\n");
			const newLines = newPrompt.split("\n");
			const differences = vanillaLines
				.filter((line) => !newLines.includes(line))
				.map((line) => `  vanilla only: ${line}`)
				.concat(newLines.filter((line) => !vanillaLines.includes(line)).map((line) => `  new only: ${line}`));
			console.log(differences.join("\n"));
		}
	}

	if (options.json) {
		writeFileSync(
			options.json,
			JSON.stringify({ model: options.model, task: options.task, secret, results }, null, 2),
		);
		console.log(`\nRaw results: ${options.json}`);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
