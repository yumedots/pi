#!/usr/bin/env node
/**
 * The soak test: many turns against a local model, in one session.
 *
 * It answers the questions a single run cannot: does the memory grow while the
 * model is on, how long a turn takes over a long session, and how many tokens a
 * turn costs when the history grows.
 *
 * Usage:
 *   node bench/harness/soak.mjs [options]
 *
 * Options:
 *   --turns <n>        Turns to run (default: 50)
 *   --agent-dir <dir>  The agent directory (default: PI_BENCH_AGENT_DIR)
 *   --runtime <name>   node or bun (default: node)
 *   --prompt <text>    The prompt of every turn
 *   --json <path>      Write the measurements as JSON
 */
import { execFile, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const PKG = join(REPO_ROOT, "packages/coding-agent");

const options = {
	turns: 50,
	agentDir: process.env.PI_BENCH_AGENT_DIR,
	runtime: "node",
	prompt: "Reply with the single word: ready",
	maxTokens: 512,
	model: "local/smollm2-1.7b-instruct",
	snapshot: false,
	heapMb: 0,
	extraArgs: [],
	json: undefined,
};

for (let index = 2; index < process.argv.length; index++) {
	const arg = process.argv[index];
	const value = process.argv[++index];
	if (arg === "--turns") options.turns = Number.parseInt(value, 10);
	else if (arg === "--agent-dir") options.agentDir = resolve(value);
	else if (arg === "--runtime") options.runtime = value;
	else if (arg === "--prompt") options.prompt = value;
	else if (arg === "--json") options.json = resolve(value);
	else if (arg === "--max-tokens") options.maxTokens = Number.parseInt(value, 10);
	else if (arg === "--model") options.model = value;
	else if (arg === "--snapshot") options.snapshot = true;
	else if (arg === "--heap-mb") options.heapMb = Number.parseInt(value, 10);
	else if (arg === "--extra-arg") options.extraArgs.push(value);
	else throw new Error(`Unknown option: ${arg}`);
}

/** The charge of the battery, in percent and in milliamp hours. */
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

/** The resident set size of a process, in bytes. */
function residentSetSize(pid) {
	const result = spawnSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" });
	const kilobytes = Number.parseInt(result.stdout.trim(), 10);
	return Number.isFinite(kilobytes) ? kilobytes * 1024 : undefined;
}

/**
 * The resident set size of a process, without blocking the event loop.
 *
 * The blocking version starves the reader of the agent's output, and the agent
 * then waits for a reader that never comes.
 */
function residentSetSizeAsync(pid) {
	return new Promise((resolvePromise) => {
		execFile("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }, (error, stdout) => {
			if (error) {
				resolvePromise(undefined);
				return;
			}
			const kilobytes = Number.parseInt(stdout.trim(), 10);
			resolvePromise(Number.isFinite(kilobytes) ? kilobytes * 1024 : undefined);
		});
	});
}

function percentile(values, fraction) {
	if (values.length === 0) return undefined;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
	return sorted[index];
}

async function main() {
	const sourceAgentDir = options.agentDir;
	if (!sourceAgentDir) throw new Error("An agent directory is needed: --agent-dir or PI_BENCH_AGENT_DIR");
	const agentDir = mkdtempSync(join(tmpdir(), "pi-soak-"));
	for (const file of ["settings.json", "auth.json", "models.json"]) {
		const source = join(sourceAgentDir, file);
		if (existsSync(source)) {
			const content = readFileSync(source, "utf8");
			writeFileSync(
				join(agentDir, file),
				file === "models.json"
					? content
							.replace(/http:\/\/127\.0\.0\.1:\d+/g, "http://127.0.0.1:8081")
							.replace(/"maxTokens": \d+/g, `"maxTokens": ${options.maxTokens}`)
							.replace(/"name": "SmolLM2 1.7B"/, `"name": "SmolLM2 1.7B", "samplingParams": { "temperature": 0 }`)
					: content,
			);
		}
	}

	const args =
		options.runtime === "bun"
			? [join(PKG, "src/cli.ts"), "--mode", "rpc", "--no-session", "--model", options.model]
			: [
					...options.extraArgs,
					...(options.heapMb > 0 ? [`--max-old-space-size=${options.heapMb}`] : []),
					...(options.snapshot ? ["--heapsnapshot-signal=SIGUSR2"] : []),
					join(PKG, "dist/cli.js"),
					"--mode",
					"rpc",
					"--no-session",
					"--model",
					options.model,
				];
	const child = spawn(options.runtime === "bun" ? "bun" : process.execPath, args, {
		cwd: REPO_ROOT,
		env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
		stdio: ["pipe", "pipe", "inherit"],
	});

	if (process.env.PI_SOAK_TRACE) {
		process.stderr.write(`agent dir ${agentDir}\n${readFileSync(join(agentDir, "models.json"), "utf8")}\n`);
	}
	const batteryBefore = batteryCharge();
	const samples = [];
	const turns = [];
	let buffer = "";
	let sentAt = 0;
	let firstTokenMs;
	let pendingUsage;
	let turnTimer = setTimeout(() => {
		process.stderr.write("a turn did not settle in 180 s\n");
		child.stdin.end();
	}, 180_000);
	let sampling = false;
	const sampler = setInterval(() => {
		if (sampling) return;
		sampling = true;
		void residentSetSizeAsync(child.pid).then((rss) => {
			sampling = false;
			if (rss !== undefined) samples.push({ at: Math.round(performance.now() - startedAt), rss });
		});
	}, 200);

	const startedAt = performance.now();
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
			if (process.env.PI_SOAK_TRACE) process.stderr.write(`event ${event.type}\n`);
			if (event.type === "extension_ui_request") {
				// The interface of an extension asks the client. The soak has no interface,
				// so the request is dismissed.
				child.stdin.write(
					`${JSON.stringify({ type: "extension_ui_response", id: event.id, cancelled: true })}\n`,
				);
				continue;
			}
			if (event.type === "response" && event.command === "get_state" && !sentAt) {
				sentAt = performance.now();
				child.stdin.write(`${JSON.stringify({ id: "p", type: "prompt", message: options.prompt })}\n`);
				continue;
			}
			if (event.type === "message_update" && firstTokenMs === undefined) {
				firstTokenMs = performance.now() - sentAt;
			}
			if (event.type === "message_end" && event.message?.usage) {
				pendingUsage = event.message.usage;
			}
			if (event.type === "agent_settled") {
				const turn = {
					turn: turns.length + 1,
					firstTokenMs: firstTokenMs ?? 0,
					turnMs: performance.now() - sentAt,
					input: pendingUsage?.input ?? 0,
					output: pendingUsage?.output ?? 0,
					cacheRead: pendingUsage?.cacheRead ?? 0,
					total: pendingUsage?.totalTokens ?? 0,
					rss: residentSetSize(child.pid),
				};
				turns.push(turn);
				process.stderr.write(
					`turn ${turn.turn}: ${turn.turnMs.toFixed(0)} ms, ${(turn.rss / 1048576).toFixed(1)} MB, ${turn.total} tokens\n`,
				);
				firstTokenMs = undefined;
				pendingUsage = undefined;
				if (turns.length < options.turns) {
					clearTimeout(turnTimer);
					turnTimer = setTimeout(() => {
						process.stderr.write("a turn did not settle in 180 s\n");
						child.stdin.end();
					}, 180_000);
					sentAt = performance.now();
					child.stdin.write(
						`${JSON.stringify({ id: `p${turns.length}`, type: "prompt", message: options.prompt })}\n`,
					);
				} else {
					if (options.snapshot) {
						// The snapshot of the heap shows what the session kept.
						child.kill("SIGUSR2");
						setTimeout(() => child.stdin.end(), 2000);
					} else {
						child.stdin.end();
					}
				}
			}
		}
	});

	// The session has to be up before the first turn, so the state is asked for first.
	child.stdin.write(`${JSON.stringify({ id: "s", type: "get_state" })}\n`);

	await new Promise((resolvePromise) => {
		child.once("close", resolvePromise);
	});
	clearInterval(sampler);
	clearTimeout(turnTimer);
	const batteryAfter = batteryCharge();

	const rssValues = samples.map((sample) => sample.rss);
	const firstTokens = turns.map((turn) => turn.firstTokenMs);
	const turnTimes = turns.map((turn) => turn.turnMs);
	const inputs = turns.map((turn) => turn.input);
	const totals = turns.map((turn) => turn.total);
	const growthPerTurn =
		turns.length > 1 ? (turns.at(-1).rss - turns[0].rss) / (turns.length - 1) : undefined;

	const result = {
		date: new Date().toISOString(),
		runtime: options.runtime,
		turns: options.turns,
		elapsedMs: Math.round(performance.now() - startedAt),
		memory: {
			startBytes: samples[0]?.rss,
			peakBytes: Math.max(...rssValues),
			endBytes: samples.at(-1)?.rss,
			growthPerTurnBytes: growthPerTurn,
			samples: samples.length,
		},
		battery: {
			before: batteryBefore,
			after: batteryAfter,
			drainMah:
				batteryBefore?.mah !== undefined && batteryAfter?.mah !== undefined ? batteryBefore.mah - batteryAfter.mah : undefined,
			onAc: batteryBefore?.onAc,
		},
		latency: {
			firstTokenMs: {
				p50: percentile(firstTokens, 0.5),
				p95: percentile(firstTokens, 0.95),
				max: Math.max(...firstTokens),
			},
			turnMs: {
				p50: percentile(turnTimes, 0.5),
				p95: percentile(turnTimes, 0.95),
				max: Math.max(...turnTimes),
			},
		},
		tokens: {
			inputFirst: inputs[0],
			inputLast: inputs.at(-1),
			totalFirst: totals[0],
			totalLast: totals.at(-1),
		},
		turnDetails: turns,
	};

	rmSync(agentDir, { recursive: true, force: true });
	if (options.json) {
		mkdirSync(dirname(options.json), { recursive: true });
		writeFileSync(options.json, `${JSON.stringify(result, null, 2)}\n`);
	}
	const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
	process.stdout.write(
		[
			`${result.turns} turns in ${(result.elapsedMs / 1000).toFixed(1)} s on ${result.runtime}`,
			`memory: ${mb(result.memory.startBytes)} -> ${mb(result.memory.endBytes)} (peak ${mb(result.memory.peakBytes)})`,
			`growth per turn: ${growthPerTurn === undefined ? "-" : mb(growthPerTurn)}`,
			`first token: p50 ${result.latency.firstTokenMs.p50?.toFixed(0)} ms, p95 ${result.latency.firstTokenMs.p95?.toFixed(0)} ms, max ${result.latency.firstTokenMs.max.toFixed(0)} ms`,
			`turn: p50 ${result.latency.turnMs.p50?.toFixed(0)} ms, p95 ${result.latency.turnMs.p95?.toFixed(0)} ms, max ${result.latency.turnMs.max.toFixed(0)} ms`,
			`tokens: input ${result.tokens.inputFirst} -> ${result.tokens.inputLast}, total ${result.tokens.totalFirst} -> ${result.tokens.totalLast}`,
			`battery: ${result.battery.onAc ? "on AC power, the battery does not drain" : `drained ${result.battery.drainMah} mAh`}`,
			"",
		].join("\n"),
	);
}

main().catch((error) => {
	process.stderr.write(`${error.stack ?? error.message}\n`);
	process.exit(1);
});
