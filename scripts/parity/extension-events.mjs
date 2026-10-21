// The extension events: the port must publish the same events, with the same
// payload keys, as the TypeScript original.
//
// The check runs pi's OWN example extension against both sides and looks at
// what it wrote: `packages/coding-agent/examples/extensions/provider-payload.ts`
// subscribes to `before_provider_request` and `after_provider_response` and
// appends the request payload and the response status to
// `<cwd>/.pi/provider-payload.log`. An extension written for pi must work on
// the port unchanged, so the log is the evidence.
//
//   node scripts/parity/extension-events.mjs            # both sides
//   node scripts/parity/extension-events.mjs rust       # the port only
//
// The event probe (every category, every payload key) is the wider check; this
// one is the end-to-end proof that a pi extension runs on the port.

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startMockServerProcess } from "./mock-server.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const TS_ROOT = process.env.PI_PARITY_TS_ROOT ?? "/Users/gabriel/pi";
const RUST_BIN = process.env.PI_PARITY_RUST_BIN ?? join(ROOT, "rpi/target-agents/debug/rpi");
const WORK_DIR = join(ROOT, "rpi/target-agents/parity/extension-events");
const AGENT_DIR = join(WORK_DIR, "agent");
const CONFIG_DIR = join(WORK_DIR, ".pi");
const LOG_PATH = join(CONFIG_DIR, "provider-payload.log");

const SCRIPT = {
	turns: [
		{
			type: "toolCall",
			name: "read",
			arguments: { path: "tool-input.txt" },
		},
		{ type: "text", text: "The fixture file says hello." },
	],
};

const sleep = (ms) => spawnSync("sleep", [String(ms / 1000)]);
const tmux = (args) => execFileSync("tmux", ["-L", "pi-ext-events", ...args], { encoding: "utf8" });

function writeAgentDir(baseUrl) {
	rmSync(AGENT_DIR, { recursive: true, force: true });
	mkdirSync(join(AGENT_DIR, "extensions"), { recursive: true });
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

/** The example extension, copied next to the agent dir so both sides load it. */
function writeExampleExtension() {
	const source = join(TS_ROOT, "packages/coding-agent/examples/extensions/provider-payload.ts");
	if (!existsSync(source)) {
		throw new Error(`no pi example extension at ${source}`);
	}
	copyFileSync(source, join(AGENT_DIR, "extensions", "provider-payload.ts"));
}

function commandFor(side, baseUrl) {
	if (side === "ts") {
		return [
			`cd ${WORK_DIR} &&`,
			`PI_CODING_AGENT_DIR=${AGENT_DIR}`,
			`bun ${join(TS_ROOT, "packages/coding-agent/src/cli.ts")}`,
			`--offline --provider mock --model mock/mock-1`,
		].join(" ");
	}
	return [
		`cd ${WORK_DIR} &&`,
		`PI_CODING_AGENT_DIR=${AGENT_DIR}`,
		`${RUST_BIN}`,
		`--offline --provider mock --model mock/mock-1 --api-key parity-key`,
	].join(" ");
}

async function runSide(side) {
	rmSync(LOG_PATH, { force: true });
	mkdirSync(CONFIG_DIR, { recursive: true });
	const mock = await startMockServerProcess(SCRIPT);
	writeAgentDir(mock.baseUrl);
	writeExampleExtension();
	const session = `ext-events-${side}`;
	spawnSync("tmux", ["-L", "pi-ext-events", "kill-session", "-t", session], { stdio: "ignore" });
	tmux(["new-session", "-d", "-s", session, "-x", "120", "-y", "40", "sh", "-c", commandFor(side, mock.baseUrl)]);
	sleep(9000);
	tmux(["send-keys", "-t", session, "hello"]);
	sleep(1200);
	tmux(["send-keys", "-t", session, "Enter"]);
	sleep(9000);
	spawnSync("tmux", ["-L", "pi-ext-events", "kill-session", "-t", session], { stdio: "ignore" });
	await mock.close();
	if (!existsSync(LOG_PATH)) return { log: "", missing: true };
	return { log: readFileSync(LOG_PATH, "utf8"), missing: false };
}

/** What the log must show: the request payload and the response status. */
function check(label, result) {
	const problems = [];
	if (result.missing) {
		problems.push(`${label}: the example extension wrote no log`);
		return problems;
	}
	const hasPayload = /"messages"\s*:/.test(result.log);
	const hasStatus = /\[\d+\]\s*\{/.test(result.log);
	if (!hasPayload) problems.push(`${label}: no request payload in the log`);
	if (!hasStatus) problems.push(`${label}: no response status in the log`);
	return problems;
}

async function main() {
	const only = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
	const sides = only.length ? only : ["ts", "rust"];
	mkdirSync(WORK_DIR, { recursive: true });
	writeFileSync(join(WORK_DIR, "tool-input.txt"), "hello\n");
	const problems = [];
	for (const side of sides) {
		const result = await runSide(side);
		const found = check(side, result);
		problems.push(...found);
		console.log(`${side}: ${found.length ? "FAIL" : "ok"}`);
		for (const line of result.log.split("\n").filter(Boolean).slice(0, 6)) {
			console.log(`  ${line.slice(0, 160)}`);
		}
	}
	if (problems.length) {
		console.log("");
		for (const problem of problems) console.log(`FAIL ${problem}`);
		process.exitCode = 1;
		return;
	}
	console.log("\nok: pi's provider-payload example sees the provider events on every side");
}

await main();
