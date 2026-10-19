#!/usr/bin/env node
// Renders bench/<profile>.json into Markdown.
//
//   bun bench/render.mjs              # writes bench/baseline.md, bench/bun.md and bench/compare.md
//   bun bench/render.mjs --compare    # only writes bench/compare.md

import { existsSync } from "node:fs";
import { join } from "node:path";
import { benchDir, readJson, round, writeText } from "./lib.mjs";

const args = process.argv.slice(2);
const onlyCompare = args.includes("--compare");

function formatMs(value) {
	if (value === undefined || value === null) return "-";
	if (value >= 1000) return `${round(value / 1000, 2)} s`;
	return `${round(value, 0)} ms`;
}

function profileMarkdown(profile, data) {
	const lines = [];
	lines.push(`# Benchmark: ${profile}`);
	lines.push("");
	lines.push(`Generated ${data.generatedAt}`);
	lines.push("");
	lines.push("## Machine");
	lines.push("");
	lines.push("| Property | Value |");
	lines.push("| --- | --- |");
	lines.push(`| Platform | ${data.system.platform} |`);
	lines.push(`| OS | ${data.system.os} |`);
	lines.push(`| CPU | ${data.system.cpuModel} |`);
	lines.push(`| Cores | ${data.system.cpuCount} |`);
	lines.push(`| RAM | ${round(data.system.totalMemoryGiB, 1)} GiB |`);
	lines.push(`| Node | ${data.system.node} |`);
	lines.push(`| npm | ${data.system.npm} |`);
	lines.push(`| Bun | ${data.system.bun} |`);
	lines.push(`| hyperfine | ${data.system.hyperfine} |`);
	lines.push("");
	lines.push("## Timings");
	lines.push("");
	lines.push("| Metric | Mean | Min | Max | Std dev | Runs |");
	lines.push("| --- | --- | --- | --- | --- | --- |");
	for (const timing of data.timings) {
		lines.push(
			`| \`${timing.name}\` | ${formatMs(timing.meanMs)} | ${formatMs(timing.minMs)} | ${formatMs(timing.maxMs)} | ${formatMs(timing.stddevMs)} | ${timing.runs} |`,
		);
	}
	lines.push("");
	lines.push("## Memory (peak RSS)");
	lines.push("");
	lines.push("| Metric | Peak RSS |");
	lines.push("| --- | --- |");
	for (const entry of data.memory) {
		lines.push(`| \`${entry.name}\` | ${entry.maxRssMiB} MiB |`);
	}
	lines.push("");
	if (data.failures.length > 0) {
		lines.push("## Failures");
		lines.push("");
		for (const failure of data.failures) {
			lines.push(`- \`${failure.name}\`: ${failure.error.split("\n")[0]}`);
		}
		lines.push("");
	}
	return lines.join("\n");
}

/** Metrics that only exist in one profile, or that measure the same thing. */
const comparisonRows = [
	{ key: "install.cold", label: "Install, cold cache", note: "Empty node_modules, cleared package-manager cache." },
	{ key: "install.warm", label: "Install, warm cache", note: "Empty node_modules, warm cache." },
	{ key: "build.full", label: "Full build (build:offline)", note: "The repository's own build script." },
	{ key: "build.full.sequential", label: "Full build, explicit sequential chain", note: "Isolates the script runner's overhead." },
	{ key: "check.full", label: "Check (biome + tsc --noEmit + checks)", note: "" },
	{ key: "test.full", label: "Full test suite", note: "Through the isolated test runner." },
	{ key: "test.one", label: "One test file", note: "packages/agent." },
	{ key: "script.startup", label: "One script invocation", note: "Process startup for a trivial script." },
	{ key: "build.binary", label: "Build the compiled binary", note: "bun build --compile." },
	{ key: "cli.startup.node", label: "CLI startup on Node (--version)", note: "" },
	{ key: "cli.startup.binary", label: "CLI startup, compiled binary (--version)", note: "" },
	{ key: "cli.startup.node.models", label: "CLI startup on Node (--list-models)", note: "" },
	{ key: "cli.startup.binary.models", label: "CLI startup, compiled binary (--list-models)", note: "" },
];

function compareMarkdown(baseline, bun) {
	const lines = [];
	lines.push("# npm + Node vs Bun");
	lines.push("");
	lines.push(`Baseline: ${baseline.generatedAt}`);
	lines.push("");
	lines.push(`Bun: ${bun.generatedAt}`);
	lines.push("");
	lines.push(
		`Same machine, same settings, same method (hyperfine, ${baseline.timings[0]?.runs ?? "?"}+ runs, 1 warmup). ` +
			"Lower is better except for the memory and size rows.",
	);
	lines.push("");
	lines.push("| Metric | npm + Node | Bun | Speedup | Notes |");
	lines.push("| --- | --- | --- | --- | --- |");

	const byName = (data) => new Map(data.timings.map((entry) => [entry.name, entry]));
	const npmTimings = byName(baseline);
	const bunTimings = byName(bun);

	for (const row of comparisonRows) {
		const npmEntry = npmTimings.get(row.key);
		const bunEntry = bunTimings.get(row.key);
		if (!npmEntry && !bunEntry) continue;
		const npmValue = npmEntry ? formatMs(npmEntry.meanMs) : "-";
		const bunValue = bunEntry ? formatMs(bunEntry.meanMs) : "-";
		let speedup = "-";
		if (npmEntry && bunEntry && bunEntry.meanMs > 0) {
			const factor = npmEntry.meanMs / bunEntry.meanMs;
			speedup = `${round(factor, 2)}x`;
		}
		const notes = [];
		if (row.note) notes.push(row.note);
		if (npmEntry && bunEntry) {
			const npmSd = npmEntry.stddevMs;
			const bunSd = bunEntry.stddevMs;
			if (npmSd > npmEntry.meanMs * 0.1 || bunSd > bunEntry.meanMs * 0.1) {
				notes.push(`variance: npm sd ${formatMs(npmSd)}, Bun sd ${formatMs(bunSd)}`);
			}
		}
		lines.push(`| ${row.label} | ${npmValue} | ${bunValue} | ${speedup} | ${notes.join(" ")} |`);
	}

	lines.push("");
	lines.push("## Per-package tsc build");
	lines.push("");
	lines.push("| Package | npm + Node | Bun | Speedup |");
	lines.push("| --- | --- | --- | --- |");
	for (const npmEntry of baseline.timings) {
		if (!npmEntry.name.startsWith("build.pkg.")) continue;
		const bunEntry = bunTimings.get(npmEntry.name);
		const speedup =
			bunEntry && bunEntry.meanMs > 0 ? `${round(npmEntry.meanMs / bunEntry.meanMs, 2)}x` : "-";
		lines.push(
			`| \`${npmEntry.name.slice("build.pkg.".length)}\` | ${formatMs(npmEntry.meanMs)} | ${bunEntry ? formatMs(bunEntry.meanMs) : "-"} | ${speedup} |`,
		);
	}

	lines.push("");
	lines.push("## Memory (peak RSS)");
	lines.push("");
	lines.push("| Measurement | npm + Node | Bun |");
	lines.push("| --- | --- | --- |");
	const npmMemory = new Map(baseline.memory.map((entry) => [entry.name, entry]));
	const bunMemory = new Map(bun.memory.map((entry) => [entry.name, entry]));
	for (const name of new Set([...npmMemory.keys(), ...bunMemory.keys()])) {
		const npmEntry = npmMemory.get(name);
		const bunEntry = bunMemory.get(name);
		lines.push(
			`| \`${name}\` | ${npmEntry ? `${npmEntry.maxRssMiB} MiB` : "-"} | ${bunEntry ? `${bunEntry.maxRssMiB} MiB` : "-"} |`,
		);
	}

	lines.push("");
	lines.push("## Raw data");
	lines.push("");
	lines.push("- `bench/baseline.json`");
	lines.push("- `bench/bun.json`");
	lines.push("");
	return lines.join("\n");
}
const baselinePath = join(benchDir, "baseline.json");
const bunPath = join(benchDir, "bun.json");

if (!onlyCompare) {
	if (existsSync(baselinePath)) {
		const baseline = readJson(baselinePath);
		writeText(join(benchDir, "baseline.md"), profileMarkdown("npm + Node (baseline)", baseline));
	}
	if (existsSync(bunPath)) {
		const bun = readJson(bunPath);
		writeText(join(benchDir, "bun.md"), profileMarkdown("Bun", bun));
	}
}

if (existsSync(baselinePath) && existsSync(bunPath)) {
	writeText(join(benchDir, "compare.md"), compareMarkdown(readJson(baselinePath), readJson(bunPath)));
	console.log("wrote bench/baseline.md, bench/bun.md and bench/compare.md");
} else if (!onlyCompare) {
	console.log("wrote bench/baseline.md and/or bench/bun.md (bench/compare.md needs both)");
} else {
	console.error("bench/compare.md needs both bench/npm.json and bench/bun.json");
	process.exitCode = 1;
}
