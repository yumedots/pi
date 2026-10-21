#!/usr/bin/env node
/**
 * The performance table of the Rust port against the TypeScript original.
 *
 * One command, one table: how long each side takes to be ready, how long it
 * takes to paint its first screen, how long each menu takes to open, how much
 * disk each side needs and how much battery each side draws.
 *
 * Both sides run against the same fixture, in the same terminal, on the same
 * machine, so the two columns can be read next to each other.
 *
 * The energy is not measured in watts: `powermetrics` needs root, so the draw
 * is inferred from the level of the battery, which `pmset -g batt` reports.
 * The number is the drop of the level over the workload, and the table says
 * so.
 *
 * Usage:
 *   node bench/harness/perf-table.mjs [options]
 *
 * Options:
 *   --runs <n>            Measured runs per timing (default: 5)
 *   --warmup <n>          Warmup runs per timing (default: 1)
 *   --side <name>         ts or rpi (repeatable, default: both)
 *   --scenario <name>     One scenario of the table (repeatable, default: all)
 *   --energy-seconds <n>  The length of the fixed energy workload (default: 60)
 *   --work-dir <path>     The directory the agents run in
 *   --fixture <path>      The agent directory with the session fixture
 *   --sessions <n>        The number of session files in the fixture (default: 2563)
 *   --rust-binary <path>  The Rust binary to measure (default: rpi/target/debug/rpi)
 *   --ts-root <path>      The TypeScript original (default: /Users/gabriel/pi)
 *   --out <path>          Write the raw results as JSON
 *   --markdown <path>     Write the table as markdown
 *   --allow-ac            Do not fail when the machine runs on AC power
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { cpus, loadavg, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { FIRST_SCREEN_MARKER, MENUS, command, measureMenu, waitForFirstScreen } from "./menus.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const RPI_ROOT = join(REPO_ROOT, "rpi");
const TMUX_SOCKET = "pi-perf";

const options = {
	runs: 5,
	warmup: 1,
	sides: [],
	scenarios: [],
	energySeconds: 60,
	workDir: "/tmp/pi-perf-table/work",
	fixture: "/tmp/pi-perf-table/fixture",
	sessions: 2563,
	rustBinary: join(RPI_ROOT, "target/debug/rpi"),
	tsRoot: "/Users/gabriel/pi",
	out: join(HERE, "perf-table.json"),
	markdown: join(HERE, "RESULTS-perf.md"),
	allowAc: false,
};

function parseArgs(argv) {
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		const value = argv[++index];
		if (arg === "--runs") options.runs = Number.parseInt(value, 10);
		else if (arg === "--warmup") options.warmup = Number.parseInt(value, 10);
		else if (arg === "--side") options.sides.push(value);
		else if (arg === "--scenario") options.scenarios.push(value);
		else if (arg === "--energy-seconds") options.energySeconds = Number.parseInt(value, 10);
		else if (arg === "--work-dir") options.workDir = resolve(value);
		else if (arg === "--fixture") options.fixture = resolve(value);
		else if (arg === "--sessions") options.sessions = Number.parseInt(value, 10);
		else if (arg === "--rust-binary") options.rustBinary = resolve(value);
		else if (arg === "--ts-root") options.tsRoot = resolve(value);
		else if (arg === "--out") options.out = resolve(value);
		else if (arg === "--markdown") options.markdown = resolve(value);
		else if (arg === "--allow-ac") options.allowAc = true;
		else if (arg === "--help" || arg === "-h") {
			process.stdout.write(`${readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]}\n`);
			process.exit(0);
		} else throw new Error(`Unknown option: ${arg}`);
	}
	if (!Number.isFinite(options.runs) || options.runs < 1) throw new Error("--runs must be at least 1");
	if (!Number.isFinite(options.energySeconds) || options.energySeconds < 1) throw new Error("--energy-seconds must be at least 1");
	if (options.sides.length === 0) options.sides = ["ts", "rpi"];
}

/**
 * The measurements of the table.
 *
 * `method` is the way the number is taken: `rpc` is the headless mode, `tmux`
 * is a real terminal, `fs` is the file system and `battery` is the level of
 * the battery. Every entry names a measure, so the table cannot lose a row.
 */
export const SCENARIOS = [
	{ id: "startup-ready", label: "process startup to ready", method: "rpc", kind: "timing" },
	{ id: "first-screen", label: "first screen painted", method: "tmux", kind: "timing" },
	{ id: "menu-session", label: "time to open the session picker", method: "tmux", kind: "timing", menu: "session" },
	{
		id: "menu-session-rows",
		label: "time to open the session picker with its rows",
		method: "tmux",
		kind: "timing",
		menu: "session",
		rows: true,
	},
	{ id: "menu-settings", label: "time to open the settings menu", method: "tmux", kind: "timing", menu: "settings" },
	{ id: "menu-model", label: "time to open the model picker", method: "tmux", kind: "timing", menu: "model" },
	{ id: "menu-provider", label: "time to open the provider list", method: "tmux", kind: "timing", menu: "provider" },
	{ id: "disk-binary", label: "the built binary", method: "fs", kind: "bytes" },
	{ id: "disk-target", label: "the build output directory", method: "fs", kind: "bytes" },
	{ id: "energy", label: "energy draw of the fixed workload", method: "battery", kind: "energy" },
];

/**
 * The measure of every scenario of the table.
 *
 * A measure returns a number for a timing, a number of bytes for the disk and
 * an object for the energy. It throws when the number cannot be taken, so the
 * table never carries a number that was not measured.
 */
export const MEASURES = {
	"startup-ready": (side, ctx) => measureStartupReady(side, ctx),
	"first-screen": (side, ctx) => measureFirstScreen(side, ctx),
	"menu-session": (side, ctx) => measureMenuTime(side, ctx, "session"),
	"menu-session-rows": (side, ctx) => measureMenuTime(side, ctx, "session", true),
	"menu-settings": (side, ctx) => measureMenuTime(side, ctx, "settings"),
	"menu-model": (side, ctx) => measureMenuTime(side, ctx, "model"),
	"menu-provider": (side, ctx) => measureMenuTime(side, ctx, "provider"),
	"disk-binary": (side, ctx) => measureDiskBinary(side, ctx),
	"disk-target": (side, ctx) => measureDiskTarget(side, ctx),
	energy: (side, ctx) => measureEnergy(side, ctx),
};

function summarize(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const total = sorted.reduce((sum, value) => sum + value, 0);
	const middle = Math.floor(sorted.length / 2);
	return {
		min: sorted[0],
		max: sorted[sorted.length - 1],
		avg: total / sorted.length,
		median: sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle],
		spread: sorted[sorted.length - 1] - sorted[0],
	};
}

function formatMs(value) {
	return value === undefined ? "-" : `${value.toFixed(1)} ms`;
}

function formatBytes(bytes) {
	if (bytes === undefined) return "-";
	if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function tmux(args) {
	return spawnSync("tmux", ["-L", TMUX_SOCKET, ...args], { encoding: "utf8" });
}

function readPane(session) {
	return tmux(["capture-pane", "-p", "-t", session]).stdout ?? "";
}

function killSession(session) {
	spawnSync("tmux", ["-L", TMUX_SOCKET, "kill-session", "-t", session], { stdio: "ignore" });
}

/**
 * The path without a symbolic link in it.
 *
 * The original resolves the directory it runs in before it encodes it into the
 * name of the session directory, so a scratch directory under `/tmp` (which is
 * a link to `/private/tmp` on macOS) would give the two sides a different
 * session list. The real path is used everywhere, so both sides look at the
 * same sessions.
 */
function realPath(path) {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/**
 * The agent directory of the fixture, with its session files.
 *
 * The fixture is built by `make-session-fixture.mjs`, so both sides read the
 * same sessions, the same models and the same stored credentials.
 */
function ensureFixture(dir, count, cwd) {
	const models = join(dir, "models.json");
	const sessions = join(dir, "sessions");
	if (existsSync(models) && existsSync(sessions)) {
		const files = readdirSync(sessions, { recursive: true }).filter((name) => String(name).endsWith(".jsonl"));
		if (files.length >= count) return { dir, sessions: files.length, cwd };
	}
	mkdirSync(dirname(dir), { recursive: true });
	const result = spawnSync(
		process.execPath,
		[join(HERE, "make-session-fixture.mjs"), "--out", dir, "--count", String(count), "--cwd", cwd],
		{ encoding: "utf8" },
	);
	if (result.status !== 0) {
		throw new Error(`The session fixture could not be built: ${result.stderr?.trim() ?? result.stdout?.trim()}`);
	}
	const files = readdirSync(sessions, { recursive: true }).filter((name) => String(name).endsWith(".jsonl"));
	return { dir, sessions: files.length, cwd };
}

/**
 * The two sides of the table.
 *
 * The original runs on bun, from its sources, the way the user runs it. The
 * port runs on its binary, and the profile of that binary is part of the
 * table: the numbers of a debug build are not the numbers of a release build.
 */
function buildSides(ctx) {
	const tsCli = join(ctx.tsRoot, "packages/coding-agent/src/cli.ts");
	return {
		ts: {
			id: "ts",
			label: "TypeScript original",
			runtime: `bun ${bunVersion()}`,
			buildProfile: "the TypeScript sources, run by bun",
			command: ["bun", tsCli],
			tsCli,
			env: {
				HOME: ctx.fixture,
				PI_CODING_AGENT_DIR: ctx.fixture,
				PI_OFFLINE: "1",
				PI_SKIP_VERSION_CHECK: "1",
			},
			rpcReady: (event) => event.type === "response" && event.command === "get_state" && event.success !== false,
		},
		rpi: {
			id: "rpi",
			label: "Rust port",
			runtime: "native binary",
			buildProfile: "debug (the dev profile of cargo, no release build on this machine)",
			command: [ctx.rustBinary],
			tsCli,
			env: {
				HOME: ctx.fixture,
				PI_CODING_AGENT_DIR: ctx.fixture,
				RPI_OFFLINE: "1",
			},
			rpcReady: (event) => event.type === "response" && event.id === "state" && event.status === "ok",
		},
	};
}

function bunVersion() {
	const result = spawnSync("bun", ["--version"], { encoding: "utf8" });
	return result.status === 0 ? result.stdout.trim() : "not installed";
}

/**
 * The size of a file or a directory, in bytes.
 *
 * A directory is walked by hand, so the size does not depend on `du` and its
 * block size.
 */
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

/**
 * The time from the start of the process to the moment it is ready.
 *
 * The rpc mode is the one place where the agent says that it is up: it
 * answers the first state request as soon as the session is there. The
 * request goes out right after the process starts, so the number is the
 * startup and not the round trip of a warm process.
 */
async function measureStartupReady(side, ctx) {
	const args = ["--mode", "rpc", "--no-session", "--provider", "local", "--model", "local/smollm2-1.7b-instruct"];
	if (side.id === "rpi") args.push("--api-key", "local");
	return new Promise((resolvePromise, reject) => {
		const started = performance.now();
		const child = spawn(side.command[0], [...side.command.slice(1), ...args], {
			cwd: ctx.workDir,
			env: { ...process.env, ...side.env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let buffer = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`The rpc mode of ${side.label} did not answer within ${ctx.timeoutMs} ms`));
		}, ctx.timeoutMs);
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			buffer += chunk;
			let index;
			while ((index = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, index);
				buffer = buffer.slice(index + 1);
				if (!line.trim()) continue;
				let event;
				try {
					event = JSON.parse(line);
				} catch {
					continue;
				}
				if (!side.rpcReady(event)) continue;
				clearTimeout(timer);
				const elapsed = performance.now() - started;
				child.stdin.end();
				child.kill("SIGTERM");
				resolvePromise(elapsed);
				return;
			}
		});
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("close", () => {
			clearTimeout(timer);
			reject(new Error(`The rpc mode of ${side.label} stopped before it was ready: ${stderr.trim().slice(0, 400)}`));
		});
		child.stdin.write(`${JSON.stringify({ id: "state", type: "get_state" })}\n`);
	});
}

/**
 * The time from the start of the process to the first screen on the pane.
 *
 * The program runs in a real terminal, and the pane is read until it holds
 * the text of the first screen. The two programs draw the same first screen,
 * so the same text tells the harness that the screen is there.
 */
async function measureFirstScreen(side, ctx) {
	const session = `pi-perf-${side.id}-first-${process.pid}-${Math.floor(performance.now())}`;
	killSession(session);
	const started = performance.now();
	tmux([
		"new-session",
		"-d",
		"-s",
		session,
		"-x",
		String(ctx.paneWidth),
		"-y",
		String(ctx.paneHeight),
		"sh",
		"-c",
		command(side.id, ctx),
	]);
	const ready = await waitForFirstScreen(session, { socket: TMUX_SOCKET, timeoutMs: ctx.timeoutMs, marker: FIRST_SCREEN_MARKER });
	const elapsed = performance.now() - started;
	const pane = readPane(session);
	const alive = tmux(["has-session", "-t", session]).status === 0;
	killSession(session);
	if (!ready) {
		throw new Error(
			`The first screen of ${side.label} never showed up (the session was ${alive ? "alive" : "gone"}):\n${pane}\n${command(side.id, ctx)}`,
		);
	}
	return elapsed;
}

/**
 * The time between the keystroke that opens a menu and the menu on the pane.
 */
async function measureMenuTime(side, ctx, menu, rows = false) {
	const run = await measureMenu(side.id, menu, {
		socket: TMUX_SOCKET,
		agentDir: ctx.fixture,
		workDir: ctx.workDir,
		rustBinary: ctx.rustBinary,
		tsCli: side.tsCli,
		paneWidth: ctx.paneWidth,
		paneHeight: ctx.paneHeight,
	});
	if (!run.found) {
		throw new Error(`The ${MENUS[menu].label} of ${side.label} never showed up:\n${run.pane}`);
	}
	if (rows) {
		if (run.rowsMs === undefined) {
			throw new Error(`The rows of the ${MENUS[menu].label} of ${side.label} never showed up:\n${run.pane}`);
		}
		return run.rowsMs;
	}
	return run.elapsedMs;
}

/**
 * The size of the binary that ships the agent.
 */
function measureDiskBinary(side, ctx) {
	const path = ctx.diskPaths[side.id].binary;
	const size = sizeOf(path);
	if (size === undefined) {
		throw new Error(`The binary of ${side.label} is missing: ${path}`);
	}
	return size;
}

/**
 * The size of the directory the build writes into.
 */
function measureDiskTarget(side, ctx) {
	const path = ctx.diskPaths[side.id].target;
	const size = sizeOf(path);
	if (size === undefined) {
		throw new Error(`The build output directory of ${side.label} is missing: ${path}`);
	}
	return size;
}

/**
 * The level of the battery, and whether the machine is on AC power.
 *
 * `pmset -g batt` is the only reading of the battery that needs no root. The
 * percentage is what it reports; the milliamp hours are read from the same
 * battery through `ioreg`, and they are a finer version of the same number.
 */
function readBattery() {
	const result = spawnSync("pmset", ["-g", "batt"], { encoding: "utf8" });
	if (result.error) {
		throw new Error(`pmset -g batt could not be run: ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(`pmset -g batt failed: ${result.stderr?.trim() ?? ""}`);
	}
	const percent = result.stdout.match(/(\d+)%/);
	if (!percent) {
		throw new Error(`The battery level could not be read from pmset -g batt:\n${result.stdout.trim()}`);
	}
	return {
		percent: Number.parseInt(percent[1], 10),
		onAc: /AC Power/i.test(result.stdout),
		raw: result.stdout.trim(),
	};
}

/**
 * The charge of the battery in milliamp hours, when the machine has one.
 */
function readMilliampHours() {
	const result = spawnSync("ioreg", ["-rn", "AppleSmartBattery"], { encoding: "utf8" });
	if (result.status !== 0) return undefined;
	const match = result.stdout.match(/"RemainingCapacity"=(\d+)/);
	return match ? Number.parseInt(match[1], 10) : undefined;
}

/**
 * The energy draw of a fixed workload, inferred from the battery.
 *
 * The workload is the interactive mode of the agent, held up for a fixed
 * number of seconds. The level of the battery is read before and after it,
 * and the difference is the draw. It is not a measurement in watts: it is the
 * level of the battery, which the machine reports in whole percent.
 */
async function measureEnergy(side, ctx) {
	const before = readBattery();
	if (before.onAc && !options.allowAc) {
		throw new Error(
			"The machine runs on AC power, so the level of the battery does not move and the energy draw cannot be inferred from it. Run the harness on the battery, or pass --allow-ac to record that the draw was not measurable.",
		);
	}
	const mahBefore = readMilliampHours();
	const session = `pi-perf-${side.id}-energy-${process.pid}`;
	killSession(session);
	tmux([
		"new-session",
		"-d",
		"-s",
		session,
		"-x",
		String(ctx.paneWidth),
		"-y",
		String(ctx.paneHeight),
		"sh",
		"-c",
		command(side.id, ctx),
	]);
	const started = performance.now();
	await new Promise((resolvePromise) => setTimeout(resolvePromise, ctx.energySeconds * 1000));
	const elapsedSeconds = (performance.now() - started) / 1000;
	killSession(session);
	const after = readBattery();
	const mahAfter = readMilliampHours();
	return {
		deltaPercent: before.onAc ? undefined : before.percent - after.percent,
		elapsedSeconds,
		percentBefore: before.percent,
		percentAfter: after.percent,
		mahBefore,
		mahAfter,
		mahDelta: mahBefore !== undefined && mahAfter !== undefined ? mahBefore - mahAfter : undefined,
		onAc: before.onAc,
	};
}

/**
 * The state of the machine, next to every number of the table.
 */
function machineInfo() {
	const load = loadavg();
	return {
		platform: `${process.platform} ${process.arch}`,
		cpuModel: cpus()[0]?.model,
		cpus: cpus().length,
		totalMemoryBytes: totalmem(),
		loadAverage: load.map((value) => Number(value.toFixed(2))),
		node: process.version,
		bun: bunVersion(),
	};
}

/**
 * The table, as markdown.
 */
export function renderMarkdown(results) {
	const lines = [];
	lines.push("# The performance table of the Rust port");
	lines.push("");
	lines.push(`- Date: ${results.date}`);
	lines.push(`- Machine: ${results.machine.cpuModel}, ${results.machine.cpus} cores, ${formatBytes(results.machine.totalMemoryBytes)}, ${results.machine.platform}`);
	lines.push(`- Load average when the run started: ${results.machine.loadAverage.join(", ")}`);
	if (results.machine.loadAverageEnd) {
		lines.push(`- Load average when the run ended: ${results.machine.loadAverageEnd.join(", ")}`);
	}
	lines.push(`- Node: ${results.machine.node}, Bun: ${results.machine.bun}`);
	lines.push(`- Terminal: ${results.options.paneWidth} columns by ${results.options.paneHeight} rows, tmux`);
	lines.push(`- Fixture: ${results.fixture.sessions} session files in ${results.fixture.dir}, the agents run in ${results.fixture.cwd}`);
	lines.push(`- Runs: ${results.options.runs} measured runs after ${results.options.warmup} warmup runs`);
	for (const side of results.sides) {
		lines.push(`- ${side.label}: ${side.runtime}, ${side.buildProfile}`);
	}
	lines.push("");
	lines.push("| Measurement | Method | TypeScript original | Rust port |");
	lines.push("| --- | --- | --- | --- |");
	for (const scenario of results.scenarios) {
		const ts = scenario.sides.ts;
		const rpi = scenario.sides.rpi;
		lines.push(`| ${scenario.label} | ${scenario.method} | ${formatCell(scenario.kind, ts)} | ${formatCell(scenario.kind, rpi)} |`);
	}
	lines.push("");
	if (results.energy?.floor) {
		const floor = results.energy.floor;
		lines.push(
			`The floor of the machine, a terminal with nothing in it for ${floor.elapsedSeconds.toFixed(0)} s, moved the level of the battery by ${floor.deltaPercent === undefined ? "nothing measurable" : `${floor.deltaPercent.toFixed(1)}%`}.`,
		);
		lines.push("");
	}
	lines.push(
		"The energy is inferred from the level of the battery, which `pmset -g batt` reports in whole percent: it is not a measurement in watts, and `powermetrics` needs root.",
	);
	lines.push("");
	return lines.join("\n");
}

function formatCell(kind, entry) {
	if (!entry) return "-";
	if (kind === "timing") {
		const summary = entry.summary;
		return `${formatMs(summary.median)} median (${formatMs(summary.min)}-${formatMs(summary.max)})`;
	}
	if (kind === "bytes") {
		return formatBytes(entry.value);
	}
	if (kind === "energy") {
		const value = entry.value;
		if (!value || value.onAc) return "not measurable on AC power";
		if (value.deltaPercent === undefined) return "-";
		const mah = value.mahDelta === undefined ? "" : `, ${value.mahDelta} mAh`;
		return `${value.deltaPercent.toFixed(1)}% over ${value.elapsedSeconds.toFixed(0)} s${mah}`;
	}
	return "-";
}

async function main() {
	parseArgs(process.argv.slice(2));

	const workDir = realPath(options.workDir);
	mkdirSync(workDir, { recursive: true });
	const workDirReal = realPath(workDir);
	const fixtureDir = realPath(options.fixture);
	const fixture = ensureFixture(fixtureDir, options.sessions, workDirReal);

	if (!existsSync(options.rustBinary)) {
		throw new Error(`The binary of the port is missing: ${options.rustBinary}. Check out the rpi branch and build it there: scripts/agent-cargo.sh build -p rpi-cli`);
	}
	const tsCli = join(options.tsRoot, "packages/coding-agent/src/cli.ts");
	if (!existsSync(tsCli)) {
		throw new Error(`The TypeScript original is missing: ${tsCli}`);
	}

	const ctx = {
		workDir: workDirReal,
		fixture: fixture.dir,
		agentDir: fixture.dir,
		tsCli,
		timeoutMs: 60_000,
		paneWidth: 100,
		paneHeight: 30,
		energySeconds: options.energySeconds,
		rustBinary: options.rustBinary,
		tsRoot: options.tsRoot,
		diskPaths: {
			ts: {
				binary: join(options.tsRoot, "packages/coding-agent/dist/pi"),
				target: join(options.tsRoot, "packages/coding-agent/dist"),
			},
			rpi: {
				binary: options.rustBinary,
				target: join(RPI_ROOT, "target"),
			},
		},
	};

	const sides = buildSides(ctx);
	const results = {
		date: new Date().toISOString(),
		machine: machineInfo(),
		options: {
			runs: options.runs,
			warmup: options.warmup,
			paneWidth: ctx.paneWidth,
			paneHeight: ctx.paneHeight,
			energySeconds: options.energySeconds,
		},
		fixture,
		sides: Object.values(sides).map((side) => ({
			id: side.id,
			label: side.label,
			runtime: side.runtime,
			buildProfile: side.buildProfile,
		})),
		scenarios: [],
	};

	const wanted = options.scenarios.length > 0 ? options.scenarios : SCENARIOS.map((scenario) => scenario.id);
	for (const id of wanted) {
		if (!SCENARIOS.some((scenario) => scenario.id === id)) {
			throw new Error(`Unknown scenario: ${id}. The scenarios are: ${SCENARIOS.map((scenario) => scenario.id).join(", ")}`);
		}
	}
	for (const scenario of SCENARIOS) {
		if (!wanted.includes(scenario.id)) continue;
		const measure = MEASURES[scenario.id];
		if (!measure) {
			throw new Error(`The scenario ${scenario.id} has no measure`);
		}
		const entry = {
			id: scenario.id,
			label: scenario.label,
			method: scenario.method,
			kind: scenario.kind,
			sides: {},
		};
		for (const sideId of options.sides) {
			const side = sides[sideId];
			if (!side) {
				throw new Error(`Unknown side: ${sideId}`);
			}
			if (scenario.kind === "timing") {
				const samples = [];
				for (let index = 0; index < options.warmup + options.runs; index++) {
					const value = await measure(side, ctx);
					if (typeof value !== "number" || !Number.isFinite(value)) {
						throw new Error(`The ${scenario.label} of ${side.label} was not measured`);
					}
					if (index >= options.warmup) {
						samples.push(value);
						process.stdout.write(`  ${scenario.id} / ${sideId} run ${index - options.warmup + 1}/${options.runs}: ${value.toFixed(1)} ms\n`);
					}
				}
				entry.sides[sideId] = {
					samples: samples.map((value) => Number(value.toFixed(1))),
					summary: summarize(samples),
				};
			} else if (scenario.kind === "bytes") {
				const value = await measure(side, ctx);
				entry.sides[sideId] = { value };
			} else {
				const value = await measure(side, ctx);
				entry.sides[sideId] = { value };
			}
			process.stdout.write(`${scenario.id} / ${sideId}: done\n`);
		}
		results.scenarios.push(entry);
	}

	const energy = results.scenarios.find((scenario) => scenario.id === "energy");
	if (energy) {
		results.energy = { floor: await measureEnergyFloor(ctx) };
	}
	results.machine.loadAverageEnd = loadavg().map((value) => Number(value.toFixed(2)));

	mkdirSync(dirname(options.out), { recursive: true });
	writeFileSync(options.out, `${JSON.stringify(results, null, 2)}\n`);
	process.stdout.write(`\nWrote ${options.out}\n`);
	const markdown = renderMarkdown(results);
	if (options.markdown) {
		mkdirSync(dirname(options.markdown), { recursive: true });
		writeFileSync(options.markdown, `${markdown}\n`);
		process.stdout.write(`Wrote ${options.markdown}\n`);
	}
	process.stdout.write(`\n${markdown}\n`);
}

/**
 * The floor of the machine: a terminal with nothing in it, for the same time
 * as the workload of the energy scenario.
 */
async function measureEnergyFloor(ctx) {
	const before = readBattery();
	if (before.onAc) return { deltaPercent: undefined, elapsedSeconds: ctx.energySeconds, onAc: true };
	const mahBefore = readMilliampHours();
	const session = `pi-perf-energy-floor-${process.pid}`;
	killSession(session);
	tmux(["new-session", "-d", "-s", session, "-x", String(ctx.paneWidth), "-y", String(ctx.paneHeight), "sh", "-c", "sleep 600"]);
	const started = performance.now();
	await new Promise((resolvePromise) => setTimeout(resolvePromise, ctx.energySeconds * 1000));
	const elapsedSeconds = (performance.now() - started) / 1000;
	killSession(session);
	const after = readBattery();
	const mahAfter = readMilliampHours();
	return {
		deltaPercent: before.percent - after.percent,
		elapsedSeconds,
		percentBefore: before.percent,
		percentAfter: after.percent,
		mahBefore,
		mahAfter,
		mahDelta: mahBefore !== undefined && mahAfter !== undefined ? mahBefore - mahAfter : undefined,
		onAc: false,
	};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		process.stderr.write(`${error.stack ?? error.message}\n`);
		process.exit(1);
	});
}
