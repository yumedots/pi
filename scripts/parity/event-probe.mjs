#!/usr/bin/env node

/**
 * The extension event probe: what the host publishes, in what order, with
 * which payload keys.
 *
 * The probe extension (`fixtures/event-probe.ts`) subscribes to every
 * category pi publishes and writes one JSON line per event: the category and
 * the payload's keys. The script runs the probe on one side (the TypeScript
 * original or the Rust port), types one prompt that makes the model call a
 * tool, and writes the trace.
 *
 *   node scripts/parity/event-probe.mjs ts      # the original
 *   node scripts/parity/event-probe.mjs rust    # the port
 *   node scripts/parity/event-probe.mjs both    # both, and the difference
 *
 * The golden trace of the original is `scripts/parity/golden/ts-events.json`.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockServerProcess } from "./mock-server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const TS_ROOT = process.env.PI_PARITY_TS_ROOT ?? "/Users/gabriel/pi";
const RUST_BIN = process.env.PI_PARITY_RUST_BIN ?? join(ROOT, "rpi/target/debug/rpi");
const WORK_DIR = join(ROOT, "rpi/target-agents/parity/event-probe");
const AGENT_DIR = join(WORK_DIR, "agent");
const PROBE = join(HERE, "fixtures", "event-probe.ts");
const OUT = join(HERE, "out");

/** One prompt, one tool call, one answer: the events of a whole run. */
const SCRIPT = {
	turns: [
		{ type: "toolCall", name: "read", arguments: { path: "tool-input.txt" } },
		{ type: "text", text: "The fixture file says hello." },
	],
};

const sleep = (ms) => spawnSync("sleep", [String(ms / 1000)]);
const tmux = (args) => execFileSync("tmux", ["-L", "pi-event-probe", ...args], { encoding: "utf8" });

function writeAgentDir(baseUrl) {
	rmSync(AGENT_DIR, { recursive: true, force: true });
	mkdirSync(AGENT_DIR, { recursive: true });
	writeFileSync(
		join(AGENT_DIR, "models.json"),
		JSON.stringify(
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
		),
	);
	writeFileSync(join(AGENT_DIR, "settings.json"), JSON.stringify({ threeDEmptySession: true }, null, 1));
}

function commandFor(side, logPath) {
	const env = `PI_PROBE_LOG=${logPath} PI_CODING_AGENT_DIR=${AGENT_DIR}`;
	if (side === "ts") {
		return [
			`cd ${WORK_DIR} &&`,
			env,
			`bun ${join(TS_ROOT, "packages/coding-agent/src/cli.ts")}`,
			`--offline --no-session --provider mock --model mock/mock-1 -e ${PROBE}`,
		].join(" ");
	}
	return [
		`cd ${WORK_DIR} &&`,
		env,
		`${RUST_BIN}`,
		`--offline --provider mock --model mock/mock-1 --api-key parity-key --extension ${PROBE}`,
	].join(" ");
}

async function runSide(side) {
	const logPath = join(WORK_DIR, `probe-${side}.log`);
	rmSync(logPath, { force: true });
	const mock = await startMockServerProcess(SCRIPT);
	writeAgentDir(mock.baseUrl);
	const session = `event-probe-${side}`;
	spawnSync("tmux", ["-L", "pi-event-probe", "kill-session", "-t", session], { stdio: "ignore" });
	tmux([
		"new-session",
		"-d",
		"-s",
		session,
		"-x",
		"120",
		"-y",
		"40",
		"sh",
		"-c",
		commandFor(side, logPath),
	]);
	sleep(9000);
	tmux(["send-keys", "-t", session, "hello"]);
	sleep(1200);
	tmux(["send-keys", "-t", session, "Enter"]);
	sleep(12000);
	spawnSync("tmux", ["-L", "pi-event-probe", "kill-session", "-t", session], { stdio: "ignore" });
	await mock.close();
	if (!existsSync(logPath)) return [];
	return readFileSync(logPath, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

/** The categories that fired, in order, without the repeats. */
function categories(trace) {
	const seen = [];
	for (const entry of trace) {
		if (!seen.includes(entry.category)) seen.push(entry.category);
	}
	return seen;
}

/** The payload keys of the first event of every category. */
function shapes(trace) {
	const first = new Map();
	for (const entry of trace) {
		if (!first.has(entry.category)) first.set(entry.category, entry.keys);
	}
	return first;
}

async function main() {
	const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
	const sides = args.length ? args : ["ts", "rust"];
	mkdirSync(WORK_DIR, { recursive: true });
	mkdirSync(OUT, { recursive: true });
	writeFileSync(join(WORK_DIR, "tool-input.txt"), "hello\n");

	const traces = {};
	for (const side of sides) {
		const trace = await runSide(side);
		traces[side] = trace;
		writeFileSync(join(OUT, `events-${side}.json`), `${JSON.stringify(trace, null, 1)}\n`);
		const fired = categories(trace);
		console.log(`${side}: ${fired.length} categories fired`);
		for (const category of fired) {
			console.log(`  ${category}: ${shapes(trace).get(category).join(", ")}`);
		}
	}

	if (traces.ts && traces.rust) {
		const tsCategories = categories(traces.ts);
		const rustCategories = categories(traces.rust);
		const missing = tsCategories.filter((category) => !rustCategories.includes(category));
		const extra = rustCategories.filter((category) => !tsCategories.includes(category));
		const tsShapes = shapes(traces.ts);
		const rustShapes = shapes(traces.rust);
		const different = tsCategories
			.filter((category) => rustCategories.includes(category))
			.filter((category) => {
				const left = tsShapes.get(category).join(",");
				const right = rustShapes.get(category).join(",");
				return left !== right;
			});
		console.log("");
		console.log(`missing on the port: ${missing.length ? missing.join(", ") : "none"}`);
		console.log(`extra on the port: ${extra.length ? extra.join(", ") : "none"}`);
		for (const category of different) {
			console.log(`  ${category}`);
			console.log(`    ts:   ${tsShapes.get(category).join(", ")}`);
			console.log(`    rust: ${rustShapes.get(category).join(", ")}`);
		}
	}
}

await main();
