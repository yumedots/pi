#!/usr/bin/env node
// Benchmark runner.
//
//   node bench/bench.mjs --profile npm
//   node bench/bench.mjs --profile bun
//   node bench/bench.mjs --profile npm --only install --only build
//
// Writes bench/<profile>.json. bench/render.mjs turns the JSON into Markdown.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { benchDir, measureMemory, repoRoot, systemInfo, timeCommand, writeJson } from "./lib.mjs";
import { cliStartupMetrics, memoryMetricsFor, metricsFor } from "./metrics.mjs";

function parseArgs(argv) {
	const args = { profile: null, only: [], skipMemory: false, skipCli: false, runs: null, merge: false, out: null };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--profile") args.profile = argv[++i];
		else if (arg === "--only") args.only.push(argv[++i]);
		else if (arg === "--skip-memory") args.skipMemory = true;
		else if (arg === "--skip-cli") args.skipCli = true;
		else if (arg === "--merge") args.merge = true;
		else if (arg === "--out") args.out = argv[++i];
		else if (arg === "--runs") args.runs = Number(argv[++i]);
		else if (arg === "--help" || arg === "-h") {
			console.log("Usage: node bench/bench.mjs --profile <npm|bun> [--only <prefix>] [--out <name>]");
			process.exit(0);
		} else throw new Error(`Unknown argument: ${arg}`);
	}
	if (!args.profile) throw new Error("--profile is required");
	return args;
}

const args = parseArgs(process.argv.slice(2));

const timings = [];
const memory = [];
const failures = [];

console.log(`# benchmark profile: ${args.profile}`);
console.log(`# repo: ${repoRoot}`);

const info = systemInfo();
console.log(`# ${info.platform} ${info.os} | ${info.cpuCount} cores | ${info.totalMemoryGiB.toFixed(1)} GiB`);
console.log(`# node ${info.node} | npm ${info.npm} | bun ${info.bun} | hyperfine ${info.hyperfine}`);

const all = [...metricsFor(args.profile, { include: args.only.length > 0 ? args.only : null })];
if (!args.skipCli) all.push(...cliStartupMetrics().filter(matchesInclude));
if (!args.skipMemory) all.push(...memoryMetricsFor(args.profile).filter(matchesInclude));

function matchesInclude(metric) {
	if (args.only.length === 0) return true;
	return args.only.some((prefix) => metric.name === prefix || metric.name.startsWith(`${prefix}.`));
}

for (const metric of all) {
	const isMemory = metric.group === "memory";
	process.stdout.write(`- ${metric.name} ... `);
	try {
		if (isMemory) {
			const result = measureMemory(metric.command, { prepare: metric.prepare ?? null });
			memory.push({ ...result, name: metric.name, group: metric.group, note: metric.note });
			console.log(`${result.maxRssMiB} MiB peak RSS`);
		} else {
			const result = timeCommand(metric.name, metric.command, {
				runs: args.runs ?? metric.runs ?? 5,
				warmup: 1,
				prepare: metric.prepare ?? null,
				cwd: metric.cwd ?? repoRoot,
			});
			timings.push({ ...result, group: metric.group, note: metric.note });
			console.log(
				`mean ${result.meanMs} ms | min ${result.minMs} ms | max ${result.maxMs} ms | sd ${result.stddevMs} ms | rss ${result.maxRssMiB} MiB`,
			);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		failures.push({ name: metric.name, error: message.split("\n").slice(0, 8).join("\n") });
		console.log(`FAILED: ${message.split("\n")[0]}`);
	}
}

const output = {
	profile: args.profile,
	generatedAt: new Date().toISOString(),
	system: info,
	timings,
	memory,
	failures,
};

// The npm profile is the baseline; the Bun profile is the candidate.
const outputName = args.out ?? (args.profile === "npm" ? "baseline" : args.profile);
const outputPath = join(benchDir, `${outputName}.json`);
if (args.merge && existsSync(outputPath)) {
	const previous = JSON.parse(readFileSync(outputPath, "utf8"));
	const byName = new Map(previous.timings.map((entry) => [entry.name, entry]));
	for (const entry of timings) byName.set(entry.name, entry);
	const memoryByName = new Map(previous.memory.map((entry) => [entry.name, entry]));
	for (const entry of memory) memoryByName.set(entry.name, entry);
	output.timings = [...byName.values()];
	output.memory = [...memoryByName.values()];
	output.failures = [...previous.failures.filter((f) => !failures.some((n) => n.name === f.name)), ...failures];
	output.generatedAt = new Date().toISOString();
}

mkdirSync(benchDir, { recursive: true });
writeJson(outputPath, output);

console.log(`\nwrote bench/${outputName}.json (${timings.length} timings, ${memory.length} memory, ${failures.length} failures)`);
if (failures.length > 0) {
	for (const failure of failures) console.error(`\n--- ${failure.name} ---\n${failure.error}`);
	process.exitCode = 1;
}
