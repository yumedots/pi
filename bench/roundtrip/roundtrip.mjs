#!/usr/bin/env node
/**
 * Message round trip: the time from submitting a message to the assistant's
 * reply being complete, the TypeScript original against the Rust port.
 *
 * Both sides run the same agent in `rpc` mode, the same model (`mock/mock-1`)
 * and the same prompt, against the same mock provider: the parity harness'
 * server (`scripts/parity/mock-server.mjs`), which answers over the OpenAI
 * chat-completions SSE protocol with a scripted turn. No real model and no
 * llama-server are involved, so the numbers measure each runtime's overhead.
 *
 * The metrics are read from the client side, the same way for both runtimes:
 * - submit to the first token: the prompt is written to the agent, the first
 *   streamed text delta arrives.
 * - first token to the final token: the first text delta to the last one.
 * - the whole turn: the prompt is written to the assistant message is
 *   complete (`agent_settled`), which includes the tool round trip in the
 *   `tool` scenario.
 *
 * The Rust port also timestamps the three moments itself (submit, first token
 * rendered, turn end) and writes them to stderr as a `turn_timing` JSON line
 * when `RPI_TURN_TIMING=1` is set. The script fails when that line is missing
 * or malformed: a run without the port's instrumentation must not look like a
 * run that measured nothing.
 *
 * Usage:
 *   node bench/roundtrip/roundtrip.mjs [options]
 *
 * Options:
 *   --runs <n>         Repetitions per runtime (default: 5)
 *   --warmup <n>       Warmup runs per runtime, discarded (default: 1)
 *   --scenario <name>  text, tool or both (default: both)
 *   --prompt <text>    The user message (default: "Say hello in three words")
 *   --runtimes <list>  Comma separated: ts, rpi (default: both)
 *   --rpi <path>       The Rust binary (default: rpi/target/debug/rpi)
 *   --ts-root <dir>    The TypeScript repository (default: this repository,
 *                      then /Users/gabriel/pi)
 *   --json <path>      Write the raw measurements as JSON
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const PARITY = join(ROOT, "scripts", "parity");

const { startMockServer } = await import(join(PARITY, "mock-server.mjs"));
const { writeAgentDir } = await import(join(PARITY, "drive.mjs"));

const MOCK_MODEL = "mock/mock-1";
const MOCK_PROVIDER = "mock";
const MOCK_API_KEY = "parity-key";

const TEXT_TURNS = [
	{ type: "text", text: "Hello from the round trip mock. This answer has a few words in it." },
];

const TOOL_TURNS = [
	{ type: "toolCall", name: "read", arguments: { path: "tool-input.txt" } },
	{ type: "text", text: "The fixture file says hello." },
];

const options = {
	runs: 5,
	warmup: 1,
	scenario: "both",
	prompt: "Say hello in three words",
	runtimes: ["ts", "rpi"],
	rpi: join(ROOT, "rpi/target/debug/rpi"),
	tsRoot: undefined,
	json: undefined,
};

for (let index = 2; index < process.argv.length; index++) {
	const arg = process.argv[index];
	if (arg === "--runs") options.runs = Number.parseInt(process.argv[++index], 10);
	else if (arg === "--warmup") options.warmup = Number.parseInt(process.argv[++index], 10);
	else if (arg === "--scenario") options.scenario = process.argv[++index];
	else if (arg === "--prompt") options.prompt = process.argv[++index];
	else if (arg === "--runtimes") options.runtimes = process.argv[++index].split(",").map((n) => n.trim());
	else if (arg === "--runtime") options.runtimes = [process.argv[++index].trim()];
	else if (arg === "--rpi") options.rpi = resolve(process.argv[++index]);
	else if (arg === "--ts-root") options.tsRoot = resolve(process.argv[++index]);
	else if (arg === "--json") options.json = resolve(process.argv[++index]);
	else throw new Error(`Unknown option: ${arg}`);
}

if (!Number.isFinite(options.runs) || options.runs < 1) throw new Error("--runs must be at least 1");
if (!Number.isFinite(options.warmup) || options.warmup < 0) throw new Error("--warmup must be zero or more");
for (const runtime of options.runtimes) {
	if (runtime !== "ts" && runtime !== "rpi") throw new Error(`Unknown runtime: ${runtime}`);
}
const scenarios = options.scenario === "both" ? ["text", "tool"] : [options.scenario];
for (const scenario of scenarios) {
	if (scenario !== "text" && scenario !== "tool") throw new Error(`Unknown scenario: ${scenario}`);
}

function pickTsRoot() {
	if (options.tsRoot) return options.tsRoot;
	const override = process.env.PI_ROUNDTRIP_TS_ROOT;
	if (override) return override;
	const candidates = [ROOT, "/Users/gabriel/pi"];
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "packages/coding-agent/dist/cli.js"))) return candidate;
	}
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "packages/coding-agent/src/cli.ts"))) return candidate;
	}
	throw new Error("No TypeScript repository found (pass --ts-root)");
}

function tsCommand(tsRoot) {
	const dist = join(tsRoot, "packages/coding-agent/dist/cli.js");
	if (existsSync(dist)) {
		return { command: process.execPath, args: [dist], flavor: "node dist/cli.js" };
	}
	const source = join(tsRoot, "packages/coding-agent/src/cli.ts");
	if (existsSync(source) && spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0) {
		return { command: "bun", args: [source], flavor: "bun src/cli.ts" };
	}
	throw new Error(`No runnable TypeScript CLI in ${tsRoot} (no dist/cli.js and no bun)`);
}

function rpiCommand() {
	if (!existsSync(options.rpi)) {
		throw new Error(
			`No Rust binary at ${options.rpi} (build it with: scripts/agent-cargo.sh build -p rpi-cli)`,
		);
	}
	return { command: options.rpi, args: [] };
}

function commonArgs() {
	return [
		"--mode",
		"rpc",
		"--no-session",
		"--offline",
		"--provider",
		MOCK_PROVIDER,
		"--model",
		MOCK_MODEL,
		"--api-key",
		MOCK_API_KEY,
	];
}

/**
 * The text delta of a message update event, whatever the runtime calls it.
 *
 * Both runtimes stream the assistant's text as `message_update` events: the
 * TypeScript original nests the delta under `assistantMessageEvent`, the Rust
 * port mirrors that and adds a flat `delta`. Only text deltas count: a tool
 * call's arguments are not a token the user reads.
 */
function textDeltaOf(event) {
	if (event.type !== "message_update") return null;
	const nested = event.assistantMessageEvent;
	if (nested && nested.type === "text_delta" && typeof nested.delta === "string" && nested.delta.length > 0) {
		return nested.delta;
	}
	if (event.eventType === "text_delta" && typeof event.delta === "string" && event.delta.length > 0) {
		return event.delta;
	}
	return null;
}

/** The `turn_timing` line the Rust port writes to stderr. */
function parseTurnTiming(stderr) {
	for (const line of stderr.split("\n")) {
		if (!line.includes("\"turn_timing\"")) continue;
		try {
			return JSON.parse(line);
		} catch {
			continue;
		}
	}
	return null;
}

function assertTurnTiming(timing, stderr) {
	if (!timing) {
		throw new Error(
			"The Rust port wrote no turn_timing line (RPI_TURN_TIMING=1). " +
				"The measurement is missing, not zero. stderr:\n" +
				stderr.slice(-2000),
		);
	}
	const phases = Array.isArray(timing.phases) ? timing.phases : [];
	const expected = ["submitted", "first_token", "turn_end"];
	if (phases.join(",") !== expected.join(",")) {
		throw new Error(`The turn_timing phases are ${JSON.stringify(phases)}, expected ${JSON.stringify(expected)}`);
	}
	const values = ["submit_ms", "first_token_ms", "turn_end_ms"].map((key) => timing[key]);
	for (const value of values) {
		if (typeof value !== "number" || !Number.isFinite(value)) {
			throw new Error(`The turn_timing line has no usable ${JSON.stringify(value)}: ${JSON.stringify(timing)}`);
		}
	}
	if (!(values[0] <= values[1] && values[1] <= values[2])) {
		throw new Error(`The turn_timing timestamps are not monotonic: ${JSON.stringify(values)}`);
	}
}

/** Run one turn of the agent and return the timestamps of its moments. */
async function runTurn(runtime, { agentDir, cwd, prompt, turns }) {
	const { command, args: prefix } =
		runtime === "ts" ? tsCommand(pickTsRoot()) : rpiCommand();
	const server = await startMockServer({ turns });
	writeAgentDir(agentDir, server.baseUrl);
	try {
		return await new Promise((resolvePromise, reject) => {
			const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
			if (runtime === "rpi") env.RPI_TURN_TIMING = "1";
			const child = spawn(command, [...prefix, ...commonArgs()], {
				cwd,
				env,
				stdio: ["pipe", "pipe", "pipe"],
			});
			let buffer = "";
			let stderr = "";
			let submitted = false;
			let firstToken = null;
			let lastToken = null;
			let settled = null;
			let promptDone = null;
			const marks = {};
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
					const now = performance.now();
					if (event.type === "response" && event.id === "s") {
						if (!submitted) {
							submitted = true;
							const promptLine = `${JSON.stringify({ id: "p0", type: "prompt", message: prompt, content: prompt })}\n`;
							child.stdin.write(promptLine);
							marks.submitted = performance.now();
						}
						continue;
					}
					const delta = textDeltaOf(event);
					if (delta) {
						if (firstToken === null) firstToken = now;
						lastToken = now;
						continue;
					}
					if (event.type === "agent_settled") {
						settled = now;
						marks.settled = now;
					}
					if (event.type === "response" && event.id === "p0") {
						promptDone = now;
					}
				}
			});
			child.stderr.setEncoding("utf8");
			child.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
			child.once("error", reject);
			const finish = () => {
				child.stdin.end();
				child.kill();
			};
			const timer = setTimeout(() => {
				finish();
				reject(new Error(`The ${runtime} run did not finish in time. stderr:\n${stderr.slice(-2000)}`));
			}, 120000);
			const settleCheck = setInterval(() => {
				if (settled === null || promptDone === null) return;
				const timing = runtime === "rpi" ? parseTurnTiming(stderr) : null;
				if (runtime === "rpi" && !timing && performance.now() - marks.settled < 2000) {
					return;
				}
				clearInterval(settleCheck);
				clearTimeout(timer);
				if (runtime === "rpi") {
					if (!timing) {
						finish();
						reject(
							new Error(
								"The Rust port wrote no turn_timing line (RPI_TURN_TIMING=1). " +
									"The measurement is missing, not zero. stderr:\n" +
									stderr.slice(-2000),
							),
						);
						return;
					}
					assertTurnTiming(timing, stderr);
				}
				finish();
				resolvePromise({
					submit: marks.submitted,
					firstToken,
					lastToken,
					settled,
					turnTiming: timing,
				});
			}, 5);
			child.stdin.write(`${JSON.stringify({ id: "s", type: "get_state" })}\n`);
		});
	} finally {
		await server.close();
	}
}

function metricsOf(run) {
	if (run.firstToken === null) throw new Error("No token arrived");
	if (run.lastToken === null) throw new Error("No token arrived");
	if (run.settled === null) throw new Error("The turn never settled");
	return {
		submitToFirstToken: run.firstToken - run.submit,
		firstToLastToken: run.lastToken - run.firstToken,
		wholeTurn: run.settled - run.submit,
	};
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function batteryPercent() {
	try {
		const result = spawnSync("pmset", ["-g", "batt"], { encoding: "utf8" });
		const match = /\b(\d+)%/.exec(result.stdout ?? "");
		return match ? Number.parseInt(match[1], 10) : null;
	} catch {
		return null;
	}
}

function buildProfile() {
	return options.rpi.includes("/release/") ? "release" : "debug";
}

const METRICS = [
	{ key: "submitToFirstToken", label: "submit to first token" },
	{ key: "firstToLastToken", label: "first token to final token" },
	{ key: "wholeTurn", label: "whole turn" },
];

const workDir = mkdtempSync(join(tmpdir(), "pi-roundtrip-"));
const agentDir = join(workDir, "agent");
mkdirSync(agentDir, { recursive: true });
writeFileSync(join(workDir, "tool-input.txt"), "hello from the round trip fixture\n");

const results = { provider: null, prompt: options.prompt, model: MOCK_MODEL, scenarios: {} };

for (const scenario of scenarios) {
	const turns = scenario === "tool" ? TOOL_TURNS : TEXT_TURNS;
	const perRuntime = {};
	for (const runtime of options.runtimes) {
		const samples = [];
		for (let index = 0; index < options.warmup + options.runs; index++) {
			const run = await runTurn(runtime, {
				agentDir,
				cwd: workDir,
				prompt: options.prompt,
				turns,
			});
			if (index < options.warmup) continue;
			samples.push({ ...metricsOf(run), turnTiming: run.turnTiming });
		}
		perRuntime[runtime] = samples;
	}
	results.scenarios[scenario] = perRuntime;
	results.provider = {
		kind: "mock provider (openai-completions SSE)",
		server: "scripts/parity/mock-server.mjs",
		provider: MOCK_PROVIDER,
		model: MOCK_MODEL,
		turns: scenario === "tool" ? "tool call, then text" : "text",
	};
}

rmSync(workDir, { recursive: true, force: true });

const battery = batteryPercent();
const profile = buildProfile();

function formatMs(value) {
	return `${value.toFixed(1)} ms`;
}

function ratioOf(rust, ts) {
	if (!Number.isFinite(ts) || ts <= 0) return "-";
	return `${(rust / ts).toFixed(2)}x`;
}

const lines = [];
lines.push("# Message round trip");
lines.push("");
lines.push(`Provider path: ${results.provider.kind} (${results.provider.server}), provider \`${MOCK_PROVIDER}\`, model \`${MOCK_MODEL}\`.`);
lines.push(`Prompt: ${JSON.stringify(options.prompt)}`);
lines.push(`Machine: battery ${battery === null ? "unknown" : `${battery}%`}, Rust build ${profile}.`);
lines.push("");
for (const scenario of scenarios) {
	const perRuntime = results.scenarios[scenario];
	const tsSamples = perRuntime.ts ?? [];
	const rustSamples = perRuntime.rpi ?? [];
	lines.push(`## Scenario: ${scenario}`);
	lines.push("");
	lines.push("| metric | TypeScript original | Rust port | ratio (Rust/TS) |");
	lines.push("| --- | --- | --- | --- |");
	for (const metric of METRICS) {
		const ts = tsSamples.length ? median(tsSamples.map((s) => s[metric.key])) : null;
		const rust = rustSamples.length ? median(rustSamples.map((s) => s[metric.key])) : null;
		lines.push(
			`| ${metric.label} | ${ts === null ? "-" : formatMs(ts)} | ${rust === null ? "-" : formatMs(rust)} | ${
				ts === null || rust === null ? "-" : ratioOf(rust, ts)
			} |`,
		);
	}
	lines.push("");
	if (rustSamples.length) {
		const timings = rustSamples.map((sample) => sample.turnTiming);
		const medianOf = (key) =>
			median(timings.map((timing) => timing[key]).filter((value) => typeof value === "number"));
		lines.push("The Rust port's own timestamps, median over the same runs:");
		lines.push("");
		lines.push("| port metric | value |");
		lines.push("| --- | --- |");
		lines.push(`| submit to first token | ${formatMs(medianOf("submit_to_first_token_ms"))} |`);
		lines.push(`| first token to turn end | ${formatMs(medianOf("first_token_to_turn_end_ms"))} |`);
		lines.push(`| submit to turn end | ${formatMs(medianOf("submit_to_turn_end_ms"))} |`);
		lines.push("");
		const timing = timings[timings.length - 1];
		lines.push(
			`The last run's raw stamps, relative to the port's start: submit ${formatMs(timing.submit_ms)}, first token ${formatMs(
				timing.first_token_ms,
			)}, turn end ${formatMs(timing.turn_end_ms)}.`,
		);
		lines.push("");
	}
}

const output = lines.join("\n");
process.stdout.write(`${output}\n`);

if (options.json) {
	writeFileSync(options.json, `${JSON.stringify({ ...results, battery, profile }, null, 1)}\n`);
}
