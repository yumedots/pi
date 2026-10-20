#!/usr/bin/env node
/**
 * Settings parity: for each settings key, the port's behaviour with the key
 * set must equal pi's behaviour with the key set.
 *
 * This is the measurement for the settings keys. It is not a golden-trace
 * test — the two programs are compared against **each other**, so a difference
 * is a difference and not a description.
 *
 * How a case works:
 *   - the shared agent settings file is written with the case's key set;
 *   - both programs are driven with the same keys in the same project;
 *   - the pane is read and the case's facts are extracted from each side;
 *   - the facts must agree. "present on the original, absent on the port" is
 *     the port ignoring the key; "present on both" is the port honouring it.
 *
 * Usage:  node scripts/parity/settings-parity.mjs [case-id …]
 * Env:    PI_PARITY_TS_ROOT     the TypeScript checkout (default: the repo root)
 *         PI_PARITY_RUST_BIN    the rpi binary (default: rpi/target/debug/rpi)
 *         PI_PARITY_HOME        scratch directory (default: /tmp/pi-parity)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startMockServerProcess } from "./mock-server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const TS = process.env.PI_PARITY_TS_ROOT ?? ROOT;
const RUST_BIN = process.env.PI_PARITY_RUST_BIN ?? join(ROOT, "rpi/target/debug/rpi");
const HOME = process.env.PI_PARITY_HOME ?? "/tmp/pi-parity";
const WORK = join(HOME, "settings-parity");
const SOCKET = "pi-settings-parity";

const PANE_WIDTH = 100;
const PANE_HEIGHT = 30;

/**
 * The cases. Each one sets a key, drives both programs the same way, and
 * declares the facts to read off the pane.
 *
 *   facts: [{ id, match, when }] — `when` is "present" (must show on both
 *   sides) or "absent" (must not show on either side). A fact that shows on
 *   one side and not the other is the difference.
 *
 *   compare: an optional extra comparison on the two panes — "order" reads
 *   the line index of two markers and requires the same order on both sides.
 */
const CASES = [
	{
		id: "autocompletePosition-above",
		settings: { autocompletePosition: "above" },
		keys: ["/he"],
		facts: [
			{ id: "the autocomplete lists /help", match: /\/help/, when: "present" },
			{ id: "the autocomplete lists /hotkeys", match: /\/hotkeys/, when: "present" },
		],
		compare: { type: "order", first: /\/help/, second: /^ > /m },
	},
	{
		id: "autocompletePosition-below",
		settings: { autocompletePosition: "below" },
		keys: ["/he"],
		facts: [{ id: "the autocomplete lists /help", match: /\/help/, when: "present" }],
		compare: { type: "order", first: /^ > /m, second: /\/help/ },
	},
	{
		id: "autocompleteMaxVisible-3",
		settings: { autocompleteMaxVisible: 3 },
		keys: ["/"],
		facts: [{ id: "the autocomplete opens", match: /\/help/, when: "present" }],
	},
	{
		id: "autocompleteMaxVisible-20",
		settings: { autocompleteMaxVisible: 20 },
		keys: ["/"],
		facts: [{ id: "the autocomplete opens", match: /\/help/, when: "present" }],
	},
	{
		id: "hideThinkingBlock-true",
		settings: { hideThinkingBlock: true },
		keys: ["hello world", "Enter"],
		facts: [{ id: "the thinking text is hidden", match: /The parity mock thinks before it answers\./, when: "absent" }],
	},
	{
		id: "hideThinkingBlock-false",
		settings: { hideThinkingBlock: false },
		keys: ["hello world", "Enter"],
		facts: [{ id: "the thinking text is shown", match: /The parity mock thinks before it answers\./, when: "present" }],
	},
	{
		id: "enableSkillCommands-true",
		settings: { enableSkillCommands: true },
		keys: ["/skill"],
		facts: [{ id: "the skill is offered as a command", match: /skill:demo/, when: "present" }],
	},
	{
		id: "enableSkillCommands-false",
		settings: { enableSkillCommands: false },
		keys: ["/skill"],
		facts: [{ id: "the skill is not offered", match: /skill:demo/, when: "absent" }],
	},
	{
		id: "quietStartup-true",
		settings: { quietStartup: true },
		keys: [],
		facts: [{ id: "the startup summary is hidden", match: /Tools \(\d+\)/, when: "absent" }],
	},
	{
		id: "quietStartup-false",
		settings: { quietStartup: false },
		keys: [],
		facts: [{ id: "the startup summary is shown", match: /Tools \(\d+\)/, when: "present" }],
	},
	{
		id: "outputPad-0",
		settings: { outputPad: 0 },
		keys: ["hello world", "Enter"],
		facts: [{ id: "the user turn is shown", match: /hello world/, when: "present" }],
		compare: { type: "indent", marker: /hello world/ },
	},
	{
		id: "outputPad-1",
		settings: { outputPad: 1 },
		keys: ["hello world", "Enter"],
		facts: [{ id: "the user turn is shown", match: /hello world/, when: "present" }],
		compare: { type: "indent", marker: /hello world/ },
	},
	{
		id: "editorPaddingX-0",
		settings: { editorPaddingX: 0 },
		keys: [],
		facts: [{ id: "the input is shown", match: /^\s*> ?$/m, when: "present" }],
		compare: { type: "indent", marker: /^\s*> ?$/m },
	},
	{
		id: "editorPaddingX-2",
		settings: { editorPaddingX: 2 },
		keys: [],
		facts: [{ id: "the input is shown", match: /^\s*> ?$/m, when: "present" }],
		compare: { type: "indent", marker: /^\s*> ?$/m },
	},
	{
		id: "doubleEscapeAction-none",
		settings: { doubleEscapeAction: "none" },
		keys: ["Escape", "Escape"],
		facts: [{ id: "the tree picker stays closed", match: /Navigate session tree|Select a branch/i, when: "absent" }],
	},
	{
		id: "doubleEscapeAction-tree",
		settings: { doubleEscapeAction: "tree" },
		keys: ["Escape", "Escape"],
		facts: [{ id: "the tree picker opens", match: /Navigate session tree|Select a branch|Session tree/i, when: "present" }],
	},
	{
		id: "defaultProjectTrust-always",
		settings: { defaultProjectTrust: "always" },
		keys: [],
		facts: [{ id: "no trust prompt", match: /Trust project folder\?/i, when: "absent" }],
	},
	{
		id: "defaultProjectTrust-ask",
		settings: { defaultProjectTrust: "ask" },
		keys: [],
		facts: [{ id: "the trust prompt appears", match: /Trust project folder\?/i, when: "present" }],
	},
];

/** The project fixture. Written under both `.pi` and `.rpi` so a case measures
 * the setting and not the project-directory question (SESSIONS.md §11). */
function writeFixture(cwd) {
	const skill = `---
name: demo
description: A demo skill for the settings parity check
---
Demo skill body.
`;
	for (const dir of [".pi", ".rpi"]) {
		const skills = join(cwd, dir, "skills", "demo");
		mkdirSync(skills, { recursive: true });
		const target = join(skills, "SKILL.md");
		spawnSync("sh", ["-c", `cat > '${target}'`], { input: skill, encoding: "utf8" });
	}
}

function tmux(args) {
	return execFileSync("tmux", ["-L", SOCKET, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
}

function ensureServer() {
	try {
		tmux(["list-sessions"]);
	} catch {
		tmux(["new-session", "-d", "-s", "settings-boot", "sleep", "900"]);
	}
}

function pane(session) {
	try {
		return tmux(["capture-pane", "-p", "-t", session]);
	} catch {
		return "";
	}
}

function writeFile(path, contents) {
	mkdirSync(dirname(path), { recursive: true });
	spawnSync("sh", ["-c", `cat > '${path}'`], { input: contents, encoding: "utf8" });
}

function writeAgentDir(agentDir, baseUrl, settings) {
	mkdirSync(agentDir, { recursive: true });
	writeFile(
		join(agentDir, "models.json"),
		`${JSON.stringify(
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
		)}\n`,
	);
	writeFile(join(agentDir, "settings.json"), `${JSON.stringify(settings, null, 1)}\n`);
}

function tsCommand({ cwd, agentDir, clock }) {
	return [
		`cd ${cwd} &&`,
		`PI_CODING_AGENT_DIR=${agentDir}`,
		`PI_PARITY_CLOCK=${clock}`,
		`bun --preload ${join(HERE, "clock-preload.mjs")} ${join(TS, "packages/coding-agent/src/cli.ts")}`,
		"--offline --provider mock --model mock/mock-1",
	].join(" ");
}

function rustCommand({ cwd, agentDir, clock }) {
	return [
		`cd ${cwd} &&`,
		`RPI_CODING_AGENT_DIR=${agentDir}`,
		`PI_PARITY_CLOCK=${clock}`,
		RUST_BIN,
		"--offline --provider mock --model mock/mock-1 --api-key parity-key",
	].join(" ");
}

/** Drive one program and return its pane. */
function drive(side, { cwd, agentDir, clock }, keys) {
	ensureServer();
	const session = `settings-${side}`;
	spawnSync("tmux", ["-L", SOCKET, "kill-session", "-t", session], { stdio: "ignore" });
	const command =
		side === "ts" ? tsCommand({ cwd, agentDir, clock }) : rustCommand({ cwd, agentDir, clock });
	tmux(["new-session", "-d", "-s", session, "-x", String(PANE_WIDTH), "-y", String(PANE_HEIGHT), "sh", "-c", command]);
	try {
		spawnSync("sleep", ["6"]);
		for (const key of keys) {
			tmux(["send-keys", "-t", session, key]);
			spawnSync("sleep", ["1"]);
		}
		if (keys.includes("Enter")) spawnSync("sleep", ["5"]);
		else spawnSync("sleep", ["2"]);
		return pane(session);
	} finally {
		spawnSync("tmux", ["-L", SOCKET, "kill-session", "-t", session], { stdio: "ignore" });
	}
}

/** The facts a pane shows. */
function factsIn(screen, facts) {
	return facts.filter((fact) => fact.match.test(screen)).map((fact) => fact.id);
}

/** The column the marker starts at. */
function indentOf(screen, marker) {
	const line = screen.split("\n").find((candidate) => marker.test(candidate));
	if (line === undefined) return null;
	return line.length - line.trimStart().length;
}

/** The line index of the first line matching the marker. */
function lineOf(screen, marker) {
	const lines = screen.split("\n");
	const index = lines.findIndex((line) => marker.test(line));
	return index === -1 ? null : index;
}

/** Run one case on one side. */
function runCase(side, testCase, baseUrl, clock) {
	const agentDir = join(WORK, `${side}-agent`);
	const cwd = join(WORK, `${side}-work`);
	rmSync(agentDir, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	writeFixture(cwd);
	writeAgentDir(agentDir, baseUrl, testCase.settings);
	const screen = drive(side, { cwd, agentDir, clock }, testCase.keys ?? []);
	return { screen, facts: factsIn(screen, testCase.facts ?? []) };
}

const mock = await startMockServerProcess({
	turns: [
		{ type: "thinking", thinking: "The parity mock thinks before it answers.", text: "Hello from the parity mock." },
	],
});
try {
	rmSync(WORK, { recursive: true, force: true });
	mkdirSync(WORK, { recursive: true });
	const clock = join(WORK, "clock");
	writeFile(clock, "0");
	ensureServer();

	const wanted = process.argv.slice(2);
	const cases = wanted.length === 0 ? CASES : CASES.filter((c) => wanted.includes(c.id));
	const rows = [];
	for (const testCase of cases) {
		const ts = runCase("ts", testCase, mock.baseUrl, clock);
		const rust = runCase("rust", testCase, mock.baseUrl, clock);
		const differences = [];
		for (const fact of testCase.facts ?? []) {
			const inTs = ts.facts.includes(fact.id);
			const inRust = rust.facts.includes(fact.id);
			if (inTs !== inRust) {
				differences.push(
					`${fact.id}: the original ${inTs ? "shows it" : "hides it"}, the port ${inRust ? "shows it" : "hides it"}`,
				);
			}
		}
		if (testCase.compare?.type === "order") {
			const tsOrder = [lineOf(ts.screen, testCase.compare.first), lineOf(ts.screen, testCase.compare.second)];
			const rustOrder = [lineOf(rust.screen, testCase.compare.first), lineOf(rust.screen, testCase.compare.second)];
			const tsOrderOk = tsOrder[0] !== null && tsOrder[1] !== null && tsOrder[0] < tsOrder[1];
			const rustOrderOk = rustOrder[0] !== null && rustOrder[1] !== null && rustOrder[0] < rustOrder[1];
			if (tsOrderOk !== rustOrderOk) {
				differences.push(
					`the order of the two markers differs: the original ${tsOrderOk ? "keeps" : "reverses"} it, the port ${rustOrderOk ? "keeps" : "reverses"} it`,
				);
			}
		}
		if (testCase.compare?.type === "indent") {
			const tsIndent = indentOf(ts.screen, testCase.compare.marker);
			const rustIndent = indentOf(rust.screen, testCase.compare.marker);
			if (tsIndent !== null && rustIndent !== null && tsIndent !== rustIndent) {
				differences.push(`the indent differs: the original ${tsIndent}, the port ${rustIndent}`);
			}
		}
		rows.push({ id: testCase.id, settings: testCase.settings, differences });
	}

	console.log("\n## settings parity");
	for (const row of rows) {
		const label = Object.entries(row.settings)
			.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
			.join(" ");
		if (row.differences.length === 0) {
			console.log(`${row.id} (${label}): same on both sides`);
		} else {
			console.log(`${row.id} (${label}): DIFFERS`);
			for (const difference of row.differences) console.log(`    ${difference}`);
		}
	}
	if (rows.some((row) => row.differences.length > 0)) process.exitCode = 1;
} finally {
	await mock.close();
	spawnSync("tmux", ["-L", SOCKET, "kill-session", "-t", "settings-boot"], { stdio: "ignore" });
}
