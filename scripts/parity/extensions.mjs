#!/usr/bin/env node

/**
 * The extension compatibility suite.
 *
 * Every example extension that changes something runs on both sides with the
 * same input, and the panes are diffed. The report says, per extension,
 * whether it loads, whether it takes effect, and what still differs.
 *
 *   node scripts/parity/extensions.mjs               # the screen-changing set
 *   node scripts/parity/extensions.mjs --all          # every example extension
 *   node scripts/parity/extensions.mjs status-line.ts # one extension
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_DIR, MOCKS, WORK_DIR, drive, gitCommit, rustCommand, tsCommand, writeAgentDir } from "./drive.mjs";
import { normalizePane } from "./compare.mjs";
import { startMockServerProcess } from "./mock-server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "out");

/** The scenario the suite drives: one prompt, so the transcript and the dock are both on screen. */
const SCENARIO = "extension";

/**
 * The example extensions that change something.
 *
 * The first group changes the screen; the second changes what the session
 * does. Every one of them must load on the Rust host.
 */
const SCREEN_EXTENSIONS = [
	"built-in-tool-renderer.ts",
	"custom-footer.ts",
	"custom-header.ts",
	"entry-renderer.ts",
	"input-transform.ts",
	"message-renderer.ts",
	"model-status.ts",
	"overlay-test.ts",
	"status-line.ts",
	"widget-placement.ts",
];

const BEHAVIOR_EXTENSIONS = [
	"commands.ts",
	"custom-compaction.ts",
	"dynamic-tools.ts",
	"event-bus.ts",
	"hello.ts",
	"input-transform-streaming.ts",
	"notify.ts",
	"prompt-customizer.ts",
	"question.ts",
	"tool-override.ts",
];

function pickTsRoot() {
	const override = process.env.PI_PARITY_TS_ROOT;
	if (override) return override;
	for (const candidate of ["/Users/gabriel/pi", ROOT]) {
		if (existsSync(join(candidate, "packages/coding-agent/src/cli.ts"))) return candidate;
	}
	return ROOT;
}

/** Every example extension: the single files and the directories with an entry point. */
function allExamples(examplesDir) {
	const found = [];
	for (const name of readdirSync(examplesDir).sort()) {
		const path = join(examplesDir, name);
		if (statSync(path).isDirectory()) {
			for (const entry of ["index.ts", "index.js"]) {
				if (existsSync(join(path, entry))) {
					found.push(`${name}/${entry}`);
					break;
				}
			}
			continue;
		}
		if (name.endsWith(".ts") || name.endsWith(".js")) found.push(name);
	}
	return found;
}

function paneOf(trace) {
	return trace.steps[trace.steps.length - 1]?.pane ?? [];
}

/**
 * The lines that say an extension did not load.
 *
 * Both sides write the same words for a load failure — `Failed to load
 * extension "<path>": <error>` — and the runtime failures use another
 * wording, so the two are told apart.
 */
function loadErrorLines(pane) {
	return pane.filter((line) => /Failed to load extension/.test(line));
}

/** The lines that say an extension failed while it ran. */
function runtimeErrorLines(pane) {
	return pane.filter(
		(line) => /Extension ".*" error:/.test(line) || /Extension error:/.test(line),
	);
}

/**
 * The lines a pane gained against a baseline.
 *
 * The two sides do not share a startup block, so the extension's effect is
 * what the pane gained — not the whole pane.
 */
function addedLines(baseline, current) {
	const rows = baseline.length;
	const columns = current.length;
	const table = Array.from({ length: rows + 1 }, () => new Array(columns + 1).fill(0));
	for (let row = rows - 1; row >= 0; row--) {
		for (let column = columns - 1; column >= 0; column--) {
			table[row][column] =
				baseline[row] === current[column]
					? table[row + 1][column + 1] + 1
					: Math.max(table[row + 1][column], table[row][column + 1]);
		}
	}
	const added = [];
	let row = 0;
	let column = 0;
	while (row < rows && column < columns) {
		if (baseline[row] === current[column]) {
			row++;
			column++;
			continue;
		}
		if (table[row + 1][column] >= table[row][column + 1]) {
			row++;
			continue;
		}
		added.push(current[column]);
		column++;
	}
	while (column < columns) {
		added.push(current[column]);
		column++;
	}
	return added;
}

/** The lines that differ between the two sides' effects. */
function paneDifference(left, right) {
	const lines = [];
	const count = Math.max(left.length, right.length);
	for (let index = 0; index < count; index++) {
		if (left[index] === right[index]) continue;
		lines.push({ line: index + 1, ts: left[index] ?? "", rust: right[index] ?? "" });
	}
	return lines;
}

async function runSide({ side, tsRoot, rustBin, clock, extensionPath }) {
	const extra = extensionPath ? `-e ${extensionPath}` : "";
	const mock = await startMockServerProcess(MOCKS[SCENARIO] ?? {});
	writeAgentDir(AGENT_DIR, mock.baseUrl);
	try {
		const command =
			side === "ts"
				? tsCommand({ tsRoot, cwd: WORK_DIR, agentDir: AGENT_DIR, clock, extra })
				: rustCommand({ rustBin, cwd: WORK_DIR, agentDir: AGENT_DIR, clock, extra });
		return await drive({
			name: `${side}-ext`,
			command,
			scenario: SCENARIO,
			clock,
			meta: { side },
		});
	} finally {
		await mock.close();
	}
}

async function main() {
	const args = process.argv.slice(2);
	const all = args.includes("--all");
	const only = args.filter((arg) => !arg.startsWith("--"));

	const tsRoot = pickTsRoot();
	const examplesDir = join(tsRoot, "packages/coding-agent/examples/extensions");
	const rustBin = process.env.PI_PARITY_RUST_BIN ?? join(ROOT, "rpi/target/debug/rpi");
	if (!existsSync(rustBin)) {
		throw new Error(`no Rust binary: ${rustBin} (build it with: cargo build -p rpi-cli --bin rpi)`);
	}

	let names = only.length ? only : [...SCREEN_EXTENSIONS, ...BEHAVIOR_EXTENSIONS];
	if (all) names = allExamples(examplesDir);

	mkdirSync(OUT, { recursive: true });
	mkdirSync(WORK_DIR, { recursive: true });
	const clock = join(OUT, "clock");
	writeFileSync(clock, "0");

	const results = [];
	{
		const baseline = {};
		for (const side of ["ts", "rust"]) {
			// Two runs: the mock or the answer can be slow, and the baseline
			// has to hold every line the extension run adds.
			const first = paneOf(await runSide({ side, tsRoot, rustBin, clock }));
			const second = paneOf(await runSide({ side, tsRoot, rustBin, clock }));
			baseline[side] = first.length >= second.length ? first : second;
		}

		for (const name of names) {
			const extensionPath = join(examplesDir, name);
			if (!existsSync(extensionPath)) {
				results.push({ name, missing: true });
				continue;
			}
			const panes = {};
			for (const side of ["ts", "rust"]) {
				panes[side] = paneOf(await runSide({ side, tsRoot, rustBin, clock, extensionPath }));
			}
			const tsLoadErrors = loadErrorLines(panes.ts);
			const rustLoadErrors = loadErrorLines(panes.rust);
			const tsErrors = runtimeErrorLines(panes.ts);
			const rustErrors = runtimeErrorLines(panes.rust);
			const tsDelta = addedLines(baseline.ts, panes.ts);
			const rustDelta = addedLines(baseline.rust, panes.rust);
			const tsEffect = tsDelta.length > 0;
			const rustEffect = rustDelta.length > 0;
			results.push({
				name,
				tsLoadErrors,
				rustLoadErrors,
				tsErrors,
				rustErrors,
				tsEffect,
				rustEffect,
				tsDelta,
				rustDelta,
				loads: tsLoadErrors.length === 0 && rustLoadErrors.length === 0,
				matches: normalizePane(tsDelta) === normalizePane(rustDelta),
				difference: paneDifference(tsDelta, rustDelta),
			});
			const mark = results[results.length - 1];
			console.log(
				`${mark.matches ? "ok  " : "diff"} ${name.padEnd(30)} loads=${mark.loads ? "yes" : "no"} ts=${mark.tsEffect ? "effect" : "no effect"} rust=${mark.rustEffect ? "effect" : "no effect"}`,
			);
		}
	}

	const report = renderReport(results, { tsRoot, tsCommit: gitCommit(tsRoot), repoCommit: gitCommit(ROOT) });
	writeFileSync(join(OUT, "extensions-report.md"), report);
	console.log(`\nreport: ${join(OUT, "extensions-report.md")}`);
	console.log(report);
}

function renderReport(results, meta) {
	const lines = [];
	lines.push("# The extension compatibility report");
	lines.push("");
	lines.push(`- TypeScript original: \`${meta.tsRoot}\` (${meta.tsCommit})`);
	lines.push(`- Rust port: ${meta.repoCommit}`);
	lines.push(`- Scenario: \`${SCENARIO}\` (one prompt, so the transcript and the dock are on screen)`);
	lines.push("");
	const loaded = results.filter((result) => !result.missing && result.loads).length;
	const total = results.filter((result) => !result.missing).length;
	const identical = results.filter((result) => !result.missing && result.matches && result.loads).length;
	lines.push(`- Extensions that load on both sides: **${loaded} of ${total}**`);
	lines.push(`- Extensions whose panes are identical: **${identical} of ${total}**`);
	lines.push("");
	lines.push("| extension | loads (ts) | loads (rust) | takes effect (ts) | takes effect (rust) | panes match |");
	lines.push("| --- | --- | --- | --- | --- | --- |");
	for (const result of results) {
		if (result.missing) {
			lines.push(`| ${result.name} | missing | - | - | - | - |`);
			continue;
		}
		lines.push(
			`| ${result.name} | ${result.tsLoadErrors.length === 0 ? "yes" : "no"} | ${result.rustLoadErrors.length === 0 ? "yes" : "no"} | ${result.tsEffect ? "yes" : "no"} | ${result.rustEffect ? "yes" : "no"} | ${result.matches ? "yes" : "no"} |`,
		);
	}
	lines.push("");
	for (const result of results) {
		if (result.missing) continue;
		if (result.matches && result.loads && result.tsErrors.length === 0 && result.rustErrors.length === 0) {
			continue;
		}
		lines.push(`## ${result.name}`);
		lines.push("");
		if (!result.loads) {
			lines.push("The extension does not load:");
			lines.push("");
			for (const line of result.tsLoadErrors) lines.push(`- ts: ${line.trim()}`);
			for (const line of result.rustLoadErrors) lines.push(`- rust: ${line.trim()}`);
			lines.push("");
		}
		if (result.tsErrors.length > 0 || result.rustErrors.length > 0) {
			lines.push("The extension failed while it ran:");
			lines.push("");
			for (const line of result.tsErrors) lines.push(`- ts: ${line.trim()}`);
			for (const line of result.rustErrors) lines.push(`- rust: ${line.trim()}`);
			lines.push("");
		}
		if (!result.tsEffect) {
			lines.push("The TypeScript original shows no effect for this extension.");
			lines.push("");
		}
		if (!result.rustEffect) {
			lines.push("The Rust port shows no effect for this extension.");
			lines.push("");
		}
		if (!result.matches) {
			lines.push("The effects differ:");
			lines.push("");
			lines.push("```");
			for (const entry of result.difference) {
				lines.push(`line ${entry.line}`);
				lines.push(`  ts:   ${entry.ts}`);
				lines.push(`  rust: ${entry.rust}`);
			}
			lines.push("```");
			lines.push("");
		}
	}
	return `${lines.join("\n")}\n`;
}

await main();
