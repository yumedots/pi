#!/usr/bin/env node
/**
 * The time it takes to open a menu, measured the way a user feels it.
 *
 * Every menu is opened in a real terminal (tmux), with the real program, and
 * the time is the interval between the keystroke that opens the menu and the
 * pane that shows it. The session picker is measured against a directory that
 * looks like the user's: thousands of session files, most of them empty.
 *
 * The first screen is waited for before the keystroke, so the startup of the
 * program is not part of the number: the number is the menu, not the boot.
 *
 * Usage:
 *   node bench/harness/menus.mjs [options]
 *
 * Options:
 *   --runs <n>       Measured runs per menu (default: 5)
 *   --warmup <n>     Warmup runs per menu (default: 1)
 *   --side <name>    ts or rpi (repeatable, default: both)
 *   --menu <name>    session, settings, model or provider (repeatable)
 *   --agent-dir <p>  The agent directory the programs run with
 *   --out <path>     Write the results as JSON
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const TS_ROOT = process.env.PI_MENUS_TS_ROOT ?? "/Users/gabriel/pi";
export const TS_CLI = join(TS_ROOT, "packages/coding-agent/src/cli.ts");
export const RUST_BINARY = process.env.PI_MENUS_RUST_BIN ?? "/tmp/rpi-rel/release/rpi";
export const TMUX_SOCKET = process.env.PI_MENUS_TMUX_SOCKET ?? "pi-menus";
export const PANE_WIDTH = 100;
export const PANE_HEIGHT = 30;
export const AGENT_DIR = process.env.PI_MENUS_AGENT_DIR ?? "/tmp/pi-fixture-2563";
export const WORK_DIR = process.env.PI_MENUS_WORK_DIR ?? "/tmp/pi-menu-bench/work";

/**
 * The text that is on the pane of the first screen of both programs.
 *
 * The two programs draw the same first screen, so the same text tells the
 * harness that the program is up and can take the keystroke.
 */
export const FIRST_SCREEN_MARKER = "escape interrupt";

/**
 * The menus, and how each side shows them.
 *
 * `open` is the keystroke sequence that opens the menu. `detector` is the
 * text that is only on the pane when the menu is open: the two programs word
 * their menus differently, so each side has its own detector.
 */
export const MENUS = {
	session: {
		label: "the session picker",
		open: { ts: ["/resume", "Enter"], rpi: ["/resume", "Enter"] },
		detect: { ts: "Sessions", rpi: "Resume session" },
		rows: { ts: "(1/", rpi: "(1/" },
	},
	settings: {
		label: "the settings menu",
		open: { ts: ["/settings", "Enter"], rpi: ["/settings", "Enter"] },
		detect: { ts: "Auto-compact", rpi: "Auto-compact" },
	},
	model: {
		label: "the model picker",
		open: { ts: ["/model", "Enter"], rpi: ["/model", "Enter"] },
		detect: { ts: "Only showing models from configured providers", rpi: "Only showing models from configured providers" },
	},
	provider: {
		label: "the provider list",
		open: { ts: ["/logout", "Enter"], rpi: ["/logout", "Enter"] },
		detect: { ts: "Select provider to logout", rpi: "Select provider to logout" },
	},
};

const options = { runs: 5, warmup: 1, sides: [], menus: [], agentDir: AGENT_DIR, out: undefined };

/**
 * The options of the script.
 *
 * They are read when the script runs on its own, so that another script can
 * import the measurements of this one without its own options being read as
 * unknown ones.
 */
export function parseArgs(argv) {
	for (let index = 2; index < argv.length; index++) {
		const arg = argv[index];
		const value = argv[++index];
		if (arg === "--runs") options.runs = Number.parseInt(value, 10);
		else if (arg === "--warmup") options.warmup = Number.parseInt(value, 10);
		else if (arg === "--side") options.sides.push(value);
		else if (arg === "--menu") options.menus.push(value);
		else if (arg === "--agent-dir") options.agentDir = resolve(value);
		else if (arg === "--out") options.out = resolve(value);
		else throw new Error(`Unknown option: ${arg}`);
	}
	if (options.sides.length === 0) options.sides = ["ts", "rpi"];
	if (options.menus.length === 0) options.menus = ["session", "settings", "model", "provider"];
	return options;
}

function tmux(args, socket = TMUX_SOCKET) {
	return spawnSync("tmux", ["-L", socket, ...args], { encoding: "utf8" });
}

function readPane(session, socket = TMUX_SOCKET) {
	const result = tmux(["capture-pane", "-p", "-t", session], socket);
	return result.stdout ?? "";
}

function killSession(session, socket = TMUX_SOCKET) {
	spawnSync("tmux", ["-L", socket, "kill-session", "-t", session], { stdio: "ignore" });
}

function shellQuote(value) {
	return `'${String(value).replaceAll("'", "'\\''")}'`;
}

/**
 * The command that starts a side in the work directory.
 *
 * The programs run offline against a local model, so nothing leaves the
 * machine and the model is not part of the measurement.
 */
export function command(side, config = {}) {
	const agentDir = config.agentDir ?? AGENT_DIR;
	const workDir = config.workDir ?? WORK_DIR;
	const rustBinary = config.rustBinary ?? RUST_BINARY;
	const tsCli = config.tsCli ?? TS_CLI;
	const env = [
		`HOME=${shellQuote(agentDir)}`,
		`PI_CODING_AGENT_DIR=${shellQuote(agentDir)}`,
		"PI_OFFLINE=1",
		"RPI_OFFLINE=1",
	];
	if (side === "ts") {
		return [
			`cd ${shellQuote(workDir)} &&`,
			env.join(" "),
			`bun ${shellQuote(tsCli)}`,
			"--offline",
			"--no-session",
			"--provider local",
			"--model local/smollm2-1.7b-instruct",
		].join(" ");
	}
	return [
		`cd ${shellQuote(workDir)} &&`,
		env.join(" "),
		shellQuote(rustBinary),
		"--offline",
		"--no-session",
		"--provider local",
		"--model local/smollm2-1.7b-instruct",
		"--api-key local",
	].join(" ");
}

/**
 * Wait until the pane shows the first screen of the program.
 *
 * The program is up when the text of its first screen is on the pane. The
 * pane of a terminal that has not drawn anything yet does not hold it.
 */
export async function waitForFirstScreen(session, { socket = TMUX_SOCKET, timeoutMs = 120_000, marker = FIRST_SCREEN_MARKER } = {}) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const pane = readPane(session, socket);
		if (pane.includes(marker)) return true;
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
	}
	return false;
}

/**
 * Start the program, wait until its first screen is on the pane, then send
 * the keystrokes and wait for the menu to show up.
 *
 * The time that is measured is the one the user feels: from the keystroke
 * that opens the menu to the pane that shows it. The startup before it is
 * waited for separately, so the startup of the program is not in the number.
 */
export async function measureMenu(side, menu, config = {}) {
	const socket = config.socket ?? TMUX_SOCKET;
	const session = `pi-menus-${side}-${menu}-${process.pid}-${Math.floor(performance.now())}`;
	killSession(session, socket);
	tmux(
		[
			"new-session",
			"-d",
			"-s",
			session,
			"-x",
			String(config.paneWidth ?? PANE_WIDTH),
			"-y",
			String(config.paneHeight ?? PANE_HEIGHT),
			"sh",
			"-c",
			command(side, config),
		],
		socket,
	);
	if (!(await waitForFirstScreen(session, { socket }))) {
		const pane = readPane(session, socket);
		killSession(session, socket);
		return { elapsedMs: undefined, found: false, pane };
	}
	const paneBefore = readPane(session, socket);
	const started = performance.now();
	for (const key of MENUS[menu].open[side]) {
		tmux(["send-keys", "-t", session, key], socket);
	}
	const detector = MENUS[menu].detect[side];
	const rowsDetector = MENUS[menu].rows?.[side];
	const deadline = Date.now() + 120_000;
	let found = false;
	let rowsMs;
	while (Date.now() < deadline) {
		const pane = readPane(session, socket);
		const now = performance.now();
		if (rowsDetector !== undefined && rowsMs === undefined && pane.includes(rowsDetector)) {
			rowsMs = now - started;
		}
		if (!found && pane.includes(detector) && pane !== paneBefore) {
			found = true;
			if (rowsDetector === undefined) break;
		}
		if (found && (rowsDetector === undefined || rowsMs !== undefined)) break;
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 2));
	}
	const elapsedMs = performance.now() - started;
	const pane = readPane(session, socket);
	killSession(session, socket);
	return { elapsedMs, rowsMs, found, pane };
}

export function summarize(values) {
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

async function main() {
	parseArgs(process.argv);
	mkdirSync(WORK_DIR, { recursive: true });
	const results = { date: new Date().toISOString(), agentDir: options.agentDir, runs: options.runs, warmup: options.warmup, menus: {} };
	for (const menu of options.menus) {
		results.menus[menu] = { label: MENUS[menu].label, sides: {} };
		for (const side of options.sides) {
			const samples = [];
			for (let index = 0; index < options.warmup + options.runs; index++) {
				const run = await measureMenu(side, menu, { agentDir: options.agentDir });
				if (!run.found) {
					process.stderr.write(`${side}/${menu}: the menu never showed up\n`);
					process.stderr.write(`${run.pane}\n`);
					continue;
				}
				if (index >= options.warmup) samples.push(run.elapsedMs);
			}
			results.menus[menu].sides[side] = {
				summary: samples.length > 0 ? summarize(samples) : undefined,
				samples: samples.map((value) => Math.round(value * 10) / 10),
			};
			const summary = results.menus[menu].sides[side].summary;
			process.stdout.write(
				`${menu}/${side}: ${summary ? `${summary.avg.toFixed(1)} ms mean, ${summary.max.toFixed(1)} ms worst (${samples.length} runs)` : "no samples"}\n`,
			);
		}
	}
	if (options.out) {
		mkdirSync(dirname(options.out), { recursive: true });
		writeFileSync(options.out, `${JSON.stringify(results, null, 2)}\n`);
		process.stdout.write(`Wrote ${options.out}\n`);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		process.stderr.write(`${error.stack ?? error.message}\n`);
		process.exit(1);
	});
}
