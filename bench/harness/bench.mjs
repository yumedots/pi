#!/usr/bin/env node
/**
 * Benchmark of the coding agent: boot to the first screen, the round trip of a
 * message, the memory, the cpu time and the disk usage.
 *
 * Every scenario runs under every runtime, so the numbers can be compared
 * without changing anything else. The runs are wrapped in `/usr/bin/time -l`,
 * which reports the peak resident set size and the cpu time of the child.
 *
 * Usage:
 *   node bench/harness/bench.mjs [options]
 *
 * Options:
 *   --runs <n>        Measured runs per scenario (default: 5)
 *   --warmup <n>      Warmup runs per scenario (default: 1)
 *   --only <name>     Run one scenario (repeatable)
 *   --runtime <name>  Run one runtime: node, bun, binary (repeatable)
 *   --out <path>      Write the results as JSON (default: bench/harness/results.json)
 *   --markdown <path> Write the results as a markdown table
 *   --no-model         Skip the scenarios that need a model
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const PACKAGE_DIR = join(REPO_ROOT, "packages/coding-agent");
const DIST_CLI = join(PACKAGE_DIR, "dist/cli.js");
const SRC_CLI = join(PACKAGE_DIR, "src/cli.ts");
const BINARY = join(PACKAGE_DIR, "dist/pi");
const TIME_BIN = "/usr/bin/time";

const options = {
	runs: 5,
	warmup: 1,
	only: [],
	runtime: [],
	out: join(HERE, "results.json"),
	markdown: undefined,
	model: true,
};

function parseArgs(argv) {
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--runs" || arg === "--warmup" || arg === "--only" || arg === "--runtime" || arg === "--out" || arg === "--markdown") {
			const value = argv[++index];
			if (value === undefined) throw new Error(`Missing value for ${arg}`);
			if (arg === "--runs" || arg === "--warmup") options[arg.slice(2)] = Number.parseInt(value, 10);
			else if (arg === "--only") options.only.push(value);
			else if (arg === "--runtime") options.runtime.push(value);
			else if (arg === "--out") options.out = resolve(value);
			else options.markdown = resolve(value);
			continue;
		}
		if (arg === "--no-model") {
			options.model = false;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			process.stdout.write(`${readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]}\n`);
			process.exit(0);
		}
		throw new Error(`Unknown option: ${arg}`);
	}
}

/** The runtimes the agent can run on. */
function availableRuntimes() {
	const runtimes = [
		{
			name: "node",
			command: process.execPath,
			args: [DIST_CLI],
			floorArgs: ["-e", ""],
			available: existsSync(DIST_CLI),
		},
		{
			name: "bun",
			command: "bun",
			args: [SRC_CLI],
			floorArgs: ["-e", "0"],
			available: hasBun(),
		},
		{
			name: "bun-smol",
			command: "bun",
			args: ["--smol", SRC_CLI],
			floorArgs: ["--smol", "-e", "0"],
			available: hasBun(),
		},
		{
			name: "binary",
			command: BINARY,
			args: [],
			floorArgs: ["--version"],
			available: existsSync(BINARY),
		},
	];
	return runtimes.filter((runtime) => {
		if (!runtime.available) return false;
		return options.runtime.length === 0 || options.runtime.includes(runtime.name);
	});
}

/**
 * The runtimes that only have a floor, because the agent does not run on them.
 *
 * Deno resolves the workspace through the package exports, not the path aliases
 * of the tsconfig, so the agent does not start on it without a resolver. Its
 * floor still decides whether it could ever be the runtime of a harness.
 */
function floorCandidates() {
	const candidates = [
		{ name: "node", command: process.execPath, args: ["-e", ""] },
		{ name: "bun", command: "bun", args: ["-e", "0"] },
		{ name: "bun-smol", command: "bun", args: ["--smol", "-e", "0"] },
		{ name: "deno", command: "deno", args: ["eval", "console.log(1)"] },
		{ name: "native", command: "/usr/bin/true", args: [] },
	];
	return candidates.filter((candidate) => {
		if (candidate.name === "deno" && spawnSync("deno", ["--version"], { encoding: "utf8" }).status !== 0) {
			return false;
		}
		if (candidate.name === "bun" && !hasBun()) return false;
		return true;
	});
}

function hasBun() {
	return spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;
}

/**
 * The charge of the battery, or undefined on a machine without one.
 *
 * The battery is the other side of the cpu time: a run that burns cpu time
 * burns battery. The charge before and after a run shows the drain of the run.
 * The percentage is too coarse for a run of a few seconds, so the charge in
 * milliamp hours is measured as well.
 */
function batteryCharge() {
	const result = spawnSync("ioreg", ["-rn", "AppleSmartBattery"], { encoding: "utf8" });
	if (result.status !== 0) return undefined;
	const percent = result.stdout.match(/"CurrentCapacity" = (\d+)/);
	const mah = result.stdout.match(/"RemainingCapacity"=(\d+)/);
	const adapter = result.stdout.match(/"ExternalConnected"\s*=\s*(\w+)/);
	if (!percent && !mah) return undefined;
	return {
		percent: percent ? Number.parseInt(percent[1], 10) : undefined,
		mah: mah ? Number.parseInt(mah[1], 10) : undefined,
		onAc: adapter?.[1] === "Yes",
	};
}

function batteryCapacity() {
	return batteryCharge()?.percent;
}

/** The report of `/usr/bin/time -l`, parsed out of the stderr of the child. */
function parseTimeReport(stderr) {
	const report = {};
	const rss = stderr.match(/(\d+)\s+maximum resident set size/);
	if (rss) report.peakRssBytes = Number.parseInt(rss[1], 10);
	const real = stderr.match(/([\d.]+)\s+real\s+([\d.]+)\s+user\s+([\d.]+)\s+sys/);
	if (real) {
		report.wallSeconds = Number.parseFloat(real[1]);
		report.userSeconds = Number.parseFloat(real[2]);
		report.sysSeconds = Number.parseFloat(real[3]);
	}
	// The counters of the processor. The energy of a run follows them, and they are
	// the only power measure that does not need the battery to be discharging.
	const instructions = stderr.match(/(\d+)\s+instructions retired/);
	if (instructions) report.instructionsRetired = Number.parseInt(instructions[1], 10);
	const cycles = stderr.match(/(\d+)\s+cycles elapsed/);
	if (cycles) report.cyclesElapsed = Number.parseInt(cycles[1], 10);
	const faults = stderr.match(/(\d+)\s+page faults/);
	if (faults) report.pageFaults = Number.parseInt(faults[1], 10);
	return report;
}

/** The startup phases the agent reports on stderr. */
function parseStartupTimings(stderr) {
	const timings = {};
	const lines = stderr.split(/\r?\n/);
	let inBlock = false;
	for (const line of lines) {
		if (/^--- Startup Timings(?:: [^-]+)? ---$/.test(line.trim())) {
			inBlock = true;
			continue;
		}
		if (!inBlock) continue;
		if (line.includes("---")) break;
		const match = line.match(/^\s+([^:]+):\s+(\d+)ms$/);
		if (match) timings[match[1].trim()] = Number.parseInt(match[2], 10);
	}
	return timings;
}

/**
 * Run a child under `/usr/bin/time -l` and collect its output.
 *
 * The child gets the pipes, so a scenario can talk to it while it runs.
 */
function runUnderTime(command, args, { env = {}, cwd = REPO_ROOT, onChild, timeoutMs = 120_000 } = {}) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(TIME_BIN, ["-l", command, ...args], {
			cwd,
			env: { ...process.env, ...env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`Timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`));
		}, timeoutMs);
		child.once("error", reject);
		child.once("close", (code) => {
			clearTimeout(timer);
			resolvePromise({ code, stdout, stderr, report: parseTimeReport(stderr) });
		});
		if (onChild) onChild(child);
	});
}

/**
 * A scenario that builds the workspace from source.
 *
 * The build is the pipeline of the repository: every package is compiled with
 * tsc and the coding agent is bundled. The size of the output is part of the
 * measurement, because the build decides what ships.
 */
async function measureBuild() {
	const startedAt = performance.now();
	const result = await runUnderTime("npm", ["run", "build:offline"], {
		cwd: REPO_ROOT,
		timeoutMs: 600_000,
	});
	const wallMs = performance.now() - startedAt;
	return {
		wallMs,
		...result.report,
		distBytes: sizeOf(join(PACKAGE_DIR, "dist")),
		exitCode: result.code,
	};
}

/** A scenario that only starts the agent and waits for it to finish. */
async function measureSpawn(runtime, args, env) {
	const startedAt = performance.now();
	const result = await runUnderTime(runtime.command, [...runtime.args, ...args], { env });
	const wallMs = performance.now() - startedAt;
	return {
		wallMs,
		...result.report,
		startupTimings: parseStartupTimings(result.stderr),
		exitCode: result.code,
	};
}

/**
 * The resident set size of a running process, in bytes.
 *
 * The peak of `/usr/bin/time` counts the transient of the startup, which is
 * not what a running agent holds. This is the memory it keeps.
 */
function residentSetSize(pid) {
	const result = spawnSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" });
	const kilobytes = Number.parseInt(result.stdout.trim(), 10);
	return Number.isFinite(kilobytes) ? kilobytes * 1024 : undefined;
}

/**
 * The resident set size of the agent, not of the wrapper around it.
 *
 * The measured process is `/usr/bin/time`, which runs the agent as its child.
 */
function agentResidentSetSize(pid) {
	if (!pid) return undefined;
	const children = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" })
		.stdout.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	return residentSetSize(children[0] ?? pid);
}

/**
 * A scenario that runs the interactive mode in a terminal.
 *
 * The interactive mode needs a terminal, so it runs in a tmux session. The agent
 * exits by itself after the first screen when PI_STARTUP_BENCHMARK is set, and it
 * writes its startup phases and the time report to a file.
 */
async function measureTui(runtime, env) {
	const session = `pi-bench-${process.pid}-${Math.floor(performance.now())}`;
	const stderrPath = join(tmpdir(), `pi-bench-${session}.log`);
	const donePath = join(tmpdir(), `pi-bench-${session}.done`);
	rmSync(donePath, { force: true });
	const command = [
		`${TIME_BIN} -l`,
		shellQuote(runtime.command),
		...runtime.args.map(shellQuote),
		`2>${shellQuote(stderrPath)}`,
	].join(" ");
	const envPrefix = Object.entries(env)
		.map(([key, value]) => `${key}=${shellQuote(value)}`)
		.join(" ");
	spawnSync("tmux", ["kill-session", "-t", session]);
	const startedAt = performance.now();
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
		`${envPrefix} ${command}; date +%s%3N > ${shellQuote(donePath)}; sleep 2`,
	]);
	// The agent exits by itself after the first screen and the shell writes the marker.
	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline && !existsSync(donePath)) {
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
	}
	const wallMs = performance.now() - startedAt;
	spawnSync("tmux", ["kill-session", "-t", session]);
	const stderr = existsSync(stderrPath) ? readFileSync(stderrPath, "utf8") : "";
	rmSync(stderrPath, { force: true });
	rmSync(donePath, { force: true });
	return {
		wallMs,
		...parseTimeReport(stderr),
		startupTimings: parseStartupTimings(stderr),
	};
}

function shellQuote(value) {
	return `'${String(value).replaceAll("'", "'\\''")}'`;
}

/**
 * A scenario that talks to the agent over the rpc protocol.
 *
 * The rpc mode answers `get_state` as soon as the session is up, which is the
 * moment the first screen can be drawn, and streams the events of a turn.
 */
async function measureRpc(runtime, script) {
	const childEnv = { PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TIMING: "1" };
	const startedAt = performance.now();
	const result = await runUnderTime(runtime.command, [...runtime.args, "--mode", "rpc", "--no-session"], {
		env: childEnv,
		onChild: (child) => {
			script.start(child, startedAt);
		},
	});
	return {
		// The wall time of the rpc mode is the time until the session answers, not the
		// time until the process leaves.
		wallMs: script.measurements.firstScreenMs ?? performance.now() - startedAt,
		...script.measurements,
		...result.report,
		startupTimings: parseStartupTimings(result.stderr),
		measurements: script.measurements,
		exitCode: result.code,
	};
}

/** The script of the rpc scenario: ask for the state, then send a message. */
function rpcScript({ prompt, model, agentDir }) {
	const state = { measurements: {}, startedAt: 0 };
	const lines = [];
	let buffer = "";
	let childRef;

	const onLine = (line) => {
		if (!line.trim()) return;
		lines.push(line);
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}
		const now = performance.now();
		if (event.type === "response" && event.command === "get_state" && state.measurements.firstScreenMs === undefined) {
			state.measurements.firstScreenMs = now - state.startedAt;
			// The memory the agent holds once it is up, without the transient of the startup.
			state.measurements.settledRssBytes = agentResidentSetSize(childRef?.pid);
			if (prompt) {
				// The session is up. The message goes out now, so the round trip does not
				// include the startup of the agent.
				state.promptSentAt = now;
				childRef?.stdin.write(`${JSON.stringify({ id: "prompt", type: "prompt", message: prompt })}\n`);
			} else {
				// The rpc mode exits when its input ends.
				childRef?.stdin.end();
			}
		}
		if (event.type === "message_update" && state.measurements.firstTokenMs === undefined) {
			state.measurements.firstTokenMs = now - state.promptSentAt;
		}
		if (event.type === "message_end") {
			const usage = event.message?.usage;
			if (usage) {
				state.measurements.usage = {
					input: usage.input,
					output: usage.output,
					cacheRead: usage.cacheRead,
					cacheWrite: usage.cacheWrite,
					total: (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0),
				};
			}
		}
		if (event.type === "agent_settled" && state.measurements.turnMs === undefined) {
			state.measurements.turnMs = now - state.promptSentAt;
			childRef?.stdin.end();
		}
	};

	return {
		measurements: state.measurements,
		start(child, startedAt) {
			childRef = child;
			state.startedAt = startedAt;
			child.stdout.setEncoding("utf8");
			child.stdout.on("data", (chunk) => {
				buffer += chunk;
				let index;
				while ((index = buffer.indexOf("\n")) >= 0) {
					const line = buffer.slice(0, index);
					buffer = buffer.slice(index + 1);
					onLine(line);
				}
			});
			child.stdin.write(`${JSON.stringify({ id: "state", type: "get_state" })}\n`);
		},
	};
}

function summarize(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const total = sorted.reduce((sum, value) => sum + value, 0);
	const middle = Math.floor(sorted.length / 2);
	return {
		min: sorted[0],
		max: sorted[sorted.length - 1],
		avg: total / sorted.length,
		median: sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle],
	};
}

function summarizeRuns(runs) {
	const summary = {};
	const numeric = (runs, key) => {
		const values = runs.map((run) => run[key]).filter((value) => typeof value === "number" && Number.isFinite(value));
		if (values.length === 0) return undefined;
		return summarize(values);
	};
	summary.wallMs = numeric(runs, "wallMs");
	summary.peakRssBytes = numeric(runs, "peakRssBytes");
	summary.userSeconds = numeric(runs, "userSeconds");
	summary.sysSeconds = numeric(runs, "sysSeconds");
	summary.firstScreenMs = numeric(runs, "firstScreenMs");
	summary.firstTokenMs = numeric(runs, "firstTokenMs");
	summary.turnMs = numeric(runs, "turnMs");
	summary.batteryDrainPercent = numeric(runs, "batteryDrainPercent");
	summary.instructionsRetired = numeric(runs, "instructionsRetired");
	summary.cyclesElapsed = numeric(runs, "cyclesElapsed");
	summary.pageFaults = numeric(runs, "pageFaults");
	summary.distBytes = numeric(runs, "distBytes");
	summary.settledRssBytes = numeric(runs, "settledRssBytes");
	const startup = {};
	for (const run of runs) {
		for (const [label, value] of Object.entries(run.startupTimings ?? {})) {
			(startup[label] ??= []).push(value);
		}
	}
	if (Object.keys(startup).length > 0) {
		summary.startupTimings = Object.fromEntries(Object.entries(startup).map(([label, values]) => [label, summarize(values)]));
	}
	const usage = runs.map((run) => run.usage?.total).filter((value) => typeof value === "number");
	if (usage.length > 0) summary.usageTotal = summarize(usage);
	return summary;
}

function formatMb(bytes) {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatMs(value) {
	return value === undefined ? "-" : `${value.toFixed(1)} ms`;
}

/** The size of a directory or file, in bytes. */
function sizeOf(path) {
	if (!existsSync(path)) return undefined;
	const stats = statSync(path);
	if (stats.isFile()) return stats.size;
	let total = 0;
	for (const entry of readdirSync(path, { withFileTypes: true })) {
		const child = join(path, entry.name);
		total += entry.isDirectory() ? (sizeOf(child) ?? 0) : statSync(child).size;
	}
	return total;
}

function diskUsage() {
	const usage = {};
	for (const [name, path] of [
		["node_modules", join(REPO_ROOT, "node_modules")],
		["coding-agent dist", join(PACKAGE_DIR, "dist")],
		["compiled binary", BINARY],
		["tui dist", join(REPO_ROOT, "packages/tui/dist")],
		["ai dist", join(REPO_ROOT, "packages/ai/dist")],
	]) {
		const size = sizeOf(path);
		if (size !== undefined) usage[name] = size;
	}
	return usage;
}

function machineInfo() {
	return {
		platform: `${process.platform} ${process.arch}`,
		cpus: cpus().length,
		cpuModel: cpus()[0]?.model,
		totalMemoryBytes: totalmem(),
		node: process.version,
	};
}

async function main() {
	parseArgs(process.argv.slice(2));
	const runtimes = availableRuntimes();
	if (runtimes.length === 0) {
		throw new Error("No runtime available. Build the packages first: npm run build");
	}

	const prompt = process.env.PI_BENCH_PROMPT ?? "Reply with the single word: ready";
	const agentDir = process.env.PI_BENCH_AGENT_DIR;
	const scenarios = [
		{
			name: "runtime-floor",
			description: "The runtime itself, without the agent.",
			// The floor of every runtime, not only of the ones the agent runs on.
			floors: true,
			run: (runtime) => measureSpawn({ ...runtime, args: runtime.floorArgs ?? runtime.args }, [], {}),
		},
		{
			name: "cli-version",
			description: "The agent starts and prints its version.",
			run: (runtime) => measureSpawn(runtime, ["--version"], {}),
		},
		{
			name: "tui-first-screen",
			description: "The interactive mode reaches its first screen.",
			run: (runtime) =>
				measureTui(runtime, {
					PI_TIMING: "1",
					PI_STARTUP_BENCHMARK: "1",
					...(agentDir ? { PI_CODING_AGENT_DIR: agentDir } : {}),
				}),
		},
		{
			name: "rpc-first-screen",
			description: "The rpc mode answers the first state request.",
			run: (runtime) => measureRpc(runtime, rpcScript({ prompt: undefined, agentDir })),
		},
		...(options.model
			? [
					{
						name: "rpc-turn",
						description: "A message is sent and the answer comes back.",
						run: (runtime) => measureRpc(runtime, rpcScript({ prompt, agentDir })),
					},
				]
			: []),
		{
			name: "build",
			description: "The whole workspace is built from source.",
			// The build belongs to the toolchain, not to a runtime, so it runs once.
			once: true,
			run: () => measureBuild(),
		},
	];

	const results = {
		machine: machineInfo(),
		date: new Date().toISOString(),
		options: { runs: options.runs, warmup: options.warmup, prompt },
		disk: diskUsage(),
		battery: { before: batteryCharge() },
		scenarios: {},
	};

	for (const scenario of scenarios) {
		if (options.only.length > 0 && !options.only.includes(scenario.name)) continue;
		results.scenarios[scenario.name] = { description: scenario.description, runtimes: {} };
		// The floor scenario measures the runtimes themselves, not the agent.
		const scenarioRuntimes = scenario.floors ? floorCandidates() : runtimes;
		if (scenario.once) {
			const batteryBefore = batteryCapacity();
			const run = await scenario.run();
			const batteryAfter = batteryCapacity();
			if (batteryBefore !== undefined && batteryAfter !== undefined) {
				run.batteryDrainPercent = batteryBefore - batteryAfter;
			}
			results.scenarios[scenario.name].runtimes.toolchain = {
				summary: summarizeRuns([run]),
				runs: [
					{
						wallMs: run.wallMs,
						peakRssBytes: run.peakRssBytes,
						userSeconds: run.userSeconds,
						sysSeconds: run.sysSeconds,
						batteryDrainPercent: run.batteryDrainPercent,
						instructionsRetired: run.instructionsRetired,
						cyclesElapsed: run.cyclesElapsed,
						pageFaults: run.pageFaults,
						distBytes: run.distBytes,
					},
				],
			};
			process.stdout.write(`${scenario.name} / toolchain: done\n`);
			continue;
		}
		for (const runtime of scenarioRuntimes) {
			const runs = [];
			for (let index = 0; index < options.warmup + options.runs; index++) {
				const batteryBefore = batteryCapacity();
				const run = await scenario.run(runtime);
				const batteryAfter = batteryCapacity();
				if (batteryBefore !== undefined && batteryAfter !== undefined) {
					run.batteryDrainPercent = batteryBefore - batteryAfter;
				}
				if (index >= options.warmup) runs.push(run);
			}
			results.scenarios[scenario.name].runtimes[runtime.name] = {
				summary: summarizeRuns(runs),
				runs: runs.map((run) => ({
					wallMs: run.wallMs,
					peakRssBytes: run.peakRssBytes,
					userSeconds: run.userSeconds,
					sysSeconds: run.sysSeconds,
					firstScreenMs: run.firstScreenMs,
					firstTokenMs: run.firstTokenMs,
					turnMs: run.turnMs,
					settledRssBytes: run.settledRssBytes,
					batteryDrainPercent: run.batteryDrainPercent,
					instructionsRetired: run.instructionsRetired,
					cyclesElapsed: run.cyclesElapsed,
					pageFaults: run.pageFaults,
					distBytes: run.distBytes,
					usage: run.usage,
					startupTimings: run.startupTimings,
				})),
			};
			process.stdout.write(`${scenario.name} / ${runtime.name}: done\n`);
		}
	}

	mkdirSync(dirname(options.out), { recursive: true });
	results.battery.after = batteryCharge();
	if (results.battery.before !== undefined && results.battery.after !== undefined) {
		results.battery.drainPercent = results.battery.before.percent - results.battery.after.percent;
	}
	writeFileSync(options.out, `${JSON.stringify(results, null, 2)}\n`);
	process.stdout.write(`\nWrote ${options.out}\n`);
	if (options.markdown) {
		writeFileSync(options.markdown, renderMarkdown(results));
		process.stdout.write(`Wrote ${options.markdown}\n`);
	}
}

function renderMarkdown(results) {
	const lines = [];
	lines.push("# Harness benchmark");
	lines.push("");
	lines.push(`- Machine: ${results.machine.cpuModel}, ${results.machine.cpus} cores, ${formatMb(results.machine.totalMemoryBytes)}`);
	lines.push(`- Node: ${results.machine.node}`);
	lines.push(`- Date: ${results.date}`);
	lines.push("");
	lines.push("| Scenario | Runtime | Wall | Peak RSS | Settled RSS | CPU (user+sys) | Instructions | Cycles | Battery | First screen | First token | Turn | Tokens |");
	lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
	for (const [name, scenario] of Object.entries(results.scenarios)) {
		for (const [runtime, entry] of Object.entries(scenario.runtimes)) {
			const s = entry.summary;
			const cpu = s.userSeconds && s.sysSeconds ? `${(s.userSeconds.avg + s.sysSeconds.avg).toFixed(2)} s` : "-";
			const battery = s.batteryDrainPercent ? `${s.batteryDrainPercent.avg.toFixed(2)}%` : "-";
			lines.push(
				`| ${name} | ${runtime} | ${formatMs(s.wallMs?.avg)} | ${s.peakRssBytes ? formatMb(s.peakRssBytes.avg) : "-"} | ${s.settledRssBytes ? formatMb(s.settledRssBytes.avg) : "-"} | ${cpu} | ${s.instructionsRetired ? `${(s.instructionsRetired.avg / 1e6).toFixed(0)}M` : "-"} | ${s.cyclesElapsed ? `${(s.cyclesElapsed.avg / 1e6).toFixed(0)}M` : "-"} | ${battery} | ${formatMs(s.firstScreenMs?.avg)} | ${formatMs(s.firstTokenMs?.avg)} | ${formatMs(s.turnMs?.avg)} | ${s.usageTotal ? Math.round(s.usageTotal.avg) : "-"} |`,
			);
		}
	}
	lines.push("");
	lines.push("## Disk");
	lines.push("");
	lines.push("| Path | Size |");
	lines.push("| --- | --- |");
	for (const [name, size] of Object.entries(results.disk)) {
		lines.push(`| ${name} | ${formatMb(size)} |`);
	}
	lines.push("");
	if (results.battery?.before !== undefined) {
		const before = results.battery.before;
		const after = results.battery.after;
		lines.push("## Battery and power");
		lines.push("");
		lines.push(`- Power source: ${before.onAc ? "AC power" : "battery"}`);
		lines.push(`- Charge before the run: ${before.percent}% (${before.mah} mAh)`);
		lines.push(`- Charge after the run: ${after?.percent}% (${after?.mah} mAh)`);
		if (before.mah !== undefined && after?.mah !== undefined) {
			lines.push(`- Drain of the run: ${before.mah - after.mah} mAh (${results.battery.drainPercent ?? 0}%)`);
		}
		if (before.onAc) {
			lines.push(
				"- On AC power the battery does not drain, so the drain of a run is below what the machine reports. The instructions and the cycles of the processor are the power measure of the table above: the energy of a run follows them.",
			);
		}
		lines.push("");
	}
	return lines.join("\n");
}

main().catch((error) => {
	process.stderr.write(`${error.stack ?? error.message}\n`);
	process.exit(1);
});
