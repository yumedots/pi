#!/usr/bin/env node
/**
 * The power of the agent, measured on the battery.
 *
 * The machine has to run on its battery for this: on AC power the battery does
 * not discharge and the drain of a run is below what the system reports. The
 * charge is read from the system before and after the workload, and the energy
 * follows from the charge and the voltage of the pack.
 *
 * Usage:
 *   node bench/harness/power.mjs [options]
 *
 * Options:
 *   --iterations <n>  How many times the workload runs (default: 60)
 *   --workload <name> floor, tui or rpc (default: tui)
 *   --runtime <name>  node, bun or binary (repeatable, default: all)
 *   --json <path>     Write the measurements as JSON
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const PKG = join(REPO_ROOT, "packages/coding-agent");

const options = {
	iterations: 60,
	workload: "tui",
	runtimes: [],
	json: undefined,
};

for (let index = 2; index < process.argv.length; index++) {
	const arg = process.argv[index];
	const value = process.argv[++index];
	if (arg === "--iterations") options.iterations = Number.parseInt(value, 10);
	else if (arg === "--workload") options.workload = value;
	else if (arg === "--runtime") options.runtimes.push(value);
	else if (arg === "--json") options.json = resolve(value);
	else if (arg === "--help" || arg === "-h") {
		process.stdout.write(`${readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]}\n`);
		process.exit(0);
	} else throw new Error(`Unknown option: ${arg}`);
}

/**
 * The state of the battery: the charge, the voltage and whether the machine
 * runs on AC.
 */
function battery() {
	const result = spawnSync("ioreg", ["-rn", "AppleSmartBattery"], { encoding: "utf8" });
	if (result.status !== 0) return undefined;
	const read = (pattern) => {
		const match = result.stdout.match(pattern);
		return match ? Number.parseInt(match[1], 10) : undefined;
	};
	const mah = read(/"RemainingCapacity"=(\d+)/);
	const percent = read(/"CurrentCapacity" = (\d+)/);
	const millivolt = read(/"Voltage" = (\d+)/);
	const adapter = result.stdout.match(/"ExternalConnected"\s*=\s*(\w+)/);
	if (mah === undefined) return undefined;
	return { mah, percent, millivolt, onAc: adapter?.[1] === "Yes" };
}

/** The runtimes and the workload of one iteration. */
function workloads(agentDir) {
	const tui = { name: "tui", description: "the interactive mode until its first screen" };
	const floor = { name: "floor", description: "an empty program on the runtime" };
	const terminalFloor = { name: "terminal-floor", description: "a terminal that starts and ends" };
	const rpc = { name: "rpc", description: "the headless mode until it answers" };

	const runtimes = [];
	const wanted = options.runtimes.length > 0 ? options.runtimes : ["node", "bun", "binary"];
	for (const name of wanted) {
		if (name === "node") {
			runtimes.push({ name, command: process.execPath, args: [] });
		} else if (name === "bun") {
			runtimes.push({ name, command: "bun", args: [] });
		} else if (name === "binary") {
			runtimes.push({ name, command: join(PKG, "dist/pi"), args: [] });
		}
	}

	const runs = [];
	for (const runtime of runtimes) {
		if (options.workload === "terminal-floor") {
			// The same terminal, without the agent. Its power is the harness the
			// measurement of the interactive mode runs in.
			runs.push({
				runtime: "terminal",
				description: terminalFloor.description,
				command: "/usr/bin/true",
				args: [],
				terminal: true,
			});
		} else if (options.workload === "floor") {
			const args = runtime.name === "bun" ? ["-e", "0"] : runtime.name === "binary" ? ["--version"] : ["-e", ""];
			runs.push({ runtime: runtime.name, description: floor.description, command: runtime.command, args });
		} else if (options.workload === "tui") {
			const args =
				runtime.name === "bun"
					? [join(PKG, "src/cli.ts")]
					: runtime.name === "binary"
						? []
						: [join(PKG, "dist/cli.js")];
			runs.push({
				runtime: runtime.name,
				description: tui.description,
				command: runtime.command,
				args: [...args, "--no-session"],
				env: { PI_TIMING: "1", PI_STARTUP_BENCHMARK: "1", PI_CODING_AGENT_DIR: agentDir },
				terminal: true,
			});
		} else {
			const args =
				runtime.name === "bun"
					? [join(PKG, "src/cli.ts"), "--mode", "rpc", "--no-session"]
					: runtime.name === "binary"
						? ["--mode", "rpc", "--no-session"]
						: [join(PKG, "dist/cli.js"), "--mode", "rpc", "--no-session"];
			runs.push({
				runtime: runtime.name,
				description: rpc.description,
				command: runtime.command,
				args,
				env: { PI_CODING_AGENT_DIR: agentDir },
				terminal: false,
			});
		}
	}
	return runs;
}

/** Run one iteration and wait for it to finish. */
function runOnce(run) {
	return new Promise((resolvePromise) => {
		const child = spawn(run.command, run.args, {
			cwd: REPO_ROOT,
			env: { ...process.env, ...run.env },
			stdio: run.terminal ? ["ignore", "ignore", "ignore"] : ["pipe", "pipe", "ignore"],
		});
		let output = "";
		if (!run.terminal) {
			child.stdout.setEncoding("utf8");
			child.stdout.on("data", (chunk) => {
				output += chunk;
			});
		}
		const finish = () => resolvePromise(output);
		if (run.terminal) {
			// The interactive mode needs a terminal. It runs in one, and it exits by
			// itself after the first screen.
			const session = `pi-power-${process.pid}-${Math.floor(performance.now())}`;
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
				`${Object.entries(run.env ?? {})
					.map(([key, value]) => `${key}=${value}`)
					.join(" ")} ${run.command} ${run.args.map(shellQuote).join(" ")}`,
			]);
			const deadline = Date.now() + 60_000;
			const poll = setInterval(() => {
				if (spawnSync("tmux", ["has-session", "-t", session]).status !== 0 || Date.now() > deadline) {
					clearInterval(poll);
					spawnSync("tmux", ["kill-session", "-t", session]);
					finish();
				}
			}, 50);
			return;
		}
		child.once("close", finish);
		// The headless mode waits for its input, so it is told to finish.
		setTimeout(() => {
			child.stdin.write(`${JSON.stringify({ id: "s", type: "get_state" })}\n`);
			setTimeout(() => child.stdin.end(), 300);
		}, 100);
	});
}

function shellQuote(value) {
	return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function main() {
	// The interactive mode asks whether the project may be used. The answer is
	// written down, so the measurement is the startup and not the prompt.
	const agentDir = join(tmpdir(), "pi-power-agent");
	mkdirSync(agentDir, { recursive: true });
	const trustPath = join(agentDir, "trust.json");
	if (!existsSync(trustPath)) {
		writeFileSync(trustPath, `${JSON.stringify({ [REPO_ROOT]: true }, null, "\t")}\n`);
	}
	const runs = workloads(agentDir);
	const results = [];
	for (const run of runs) {
		const before = battery();
		const startedAt = performance.now();
		for (let index = 0; index < options.iterations; index++) {
			await runOnce(run);
		}
		const elapsedMs = performance.now() - startedAt;
		const after = battery();
		const drainedMah = before?.mah !== undefined && after?.mah !== undefined ? before.mah - after.mah : undefined;
		const millivolt = after?.millivolt ?? before?.millivolt;
		// mAh times volts is milliwatt hours.
		const energyMwh = drainedMah !== undefined && millivolt !== undefined ? (drainedMah * millivolt) / 1000 : undefined;
		// One milliwatt hour is 3.6 joule, so a milliwatt per second is 3.6 watt.
		const averagePowerWatt =
			energyMwh !== undefined && elapsedMs > 0 ? (energyMwh / (elapsedMs / 1000)) * 3.6 : undefined;
		const measurement = {
			runtime: run.runtime,
			workload: run.description,
			iterations: options.iterations,
			elapsedMs: Math.round(elapsedMs),
			before,
			after,
			drainedMah,
			energyMwh,
			averagePowerWatt,
			energyJoule: energyMwh !== undefined ? energyMwh * 3.6 : undefined,
			perIterationMs: Math.round(elapsedMs / options.iterations),
		};
		results.push(measurement);
		process.stdout.write(
			`${run.runtime.padEnd(8)} ${run.description}: ${measurement.elapsedMs} ms, ${drainedMah ?? "?"} mAh, ` +
				`${energyMwh !== undefined ? `${(energyMwh / 1000).toFixed(2)} Wh` : "?"}, ` +
				`${measurement.averagePowerWatt !== undefined ? `${measurement.averagePowerWatt.toFixed(2)} W` : "?"}, ` +
				`${measurement.energyJoule !== undefined ? `${(measurement.energyJoule / measurement.iterations).toFixed(2)} J per run` : ""}\n`,
		);
	}

	if (options.json) {
		mkdirSync(dirname(options.json), { recursive: true });
		writeFileSync(options.json, `${JSON.stringify(results, null, 2)}\n`);
	}
}

main().catch((error) => {
	process.stderr.write(`${error.stack ?? error.message}\n`);
	process.exit(1);
});
