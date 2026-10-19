// Shared helpers for the Bun migration benchmarks.
//
// Every measurement in this directory is produced by this file so the npm
// baseline and the Bun run use the exact same method, machine and settings.

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const benchDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(benchDir, "..");

export function run(cmd, args, options = {}) {
	return execFileSync(cmd, args, {
		cwd: options.cwd ?? repoRoot,
		encoding: "utf8",
		stdio: options.stdio ?? "pipe",
		maxBuffer: 256 * 1024 * 1024,
		...options,
	});
}

export function shell(command, options = {}) {
	return execSync(command, {
		cwd: options.cwd ?? repoRoot,
		encoding: "utf8",
		stdio: options.stdio ?? "pipe",
		maxBuffer: 256 * 1024 * 1024,
		...options,
	});
}

export function has(command) {
	try {
		shell(`command -v ${command}`, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

export function toolVersion(command, args = ["--version"]) {
	try {
		return run(command, args, { stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0];
	} catch {
		return "unavailable";
	}
}

export function systemInfo() {
	const os = process.platform === "darwin" ? shell("sw_vers -productVersion").trim() : shell("uname -sr").trim();
	return {
		platform: `${process.platform}-${process.arch}`,
		os,
		cpuModel: process.platform === "darwin" ? shell("sysctl -n machdep.cpu.brand_string").trim() : shell("grep -m1 'model name' /proc/cpuinfo | cut -d: -f2-").trim(),
		cpuCount: Number(shell("getconf _NPROCESSORS_ONLN").trim()),
		totalMemoryGiB: Number(shell(process.platform === "darwin" ? "sysctl -n hw.memsize" : "grep MemTotal /proc/meminfo | awk '{print $2}'").trim()) / 1024 ** 3,
		node: toolVersion("node"),
		npm: toolVersion("npm"),
		bun: toolVersion("bun"),
		hyperfine: toolVersion("hyperfine"),
	};
}

/**
 * Run one command under hyperfine and return the timing summary.
 * `prepare` runs before every iteration (used to reset caches or state).
 *
 * hyperfine 2.x exports schema_version 2, where the summary lives under
 * results[0].summary; 1.x put it straight on results. Both are handled.
 */
export function timeCommand(name, command, { runs = 5, warmup = 1, prepare = null, cwd = repoRoot, shellMode = true } = {}) {
	const exportPath = join(benchDir, `.hyperfine-${name}.json`);
	// hyperfine 2.x refuses shell syntax unless the shell mode is chosen explicitly.
	const args = [
		"--warmup",
		String(warmup),
		"--runs",
		String(runs),
		"--export-json",
		exportPath,
		shellMode ? "--shell=default" : "--shell=none",
	];
	if (prepare) args.push("--prepare", prepare);
	args.push(command);
	run("hyperfine", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
	const parsed = JSON.parse(readFileSync(exportPath, "utf8"));
	rmSync(exportPath, { force: true });

	const summary = parsed.schema_version === 2 ? parsed.results[0].summary : null;
	const wall = summary ? summary.time_wall_clock : parsed.results;
	const memory = summary ? summary.memory_peak_resident : undefined;

	return {
		name,
		command,
		prepare: prepare ?? null,
		runs: wall.count ?? parsed.results.length,
		meanMs: round(wall.mean * 1000),
		minMs: round(wall.min * 1000),
		maxMs: round(wall.max * 1000),
		stddevMs: round((wall.stddev ?? wall.standard_deviation ?? 0) * 1000),
		medianMs: round(wall.median * 1000),
		maxRssMiB: memory ? round(memory.mean / 1024 ** 2, 1) : null,
	};
}

/**
 * Measure peak resident set size of a command with /usr/bin/time.
 * The wrapper normalizes macOS (`time -l`, bytes) and Linux (`time -v`, KiB).
 */
export function measureMemory(command, { cwd = repoRoot } = {}) {
	const wrapper = join(benchDir, "measure-memory.sh");
	const raw = run("/bin/bash", [wrapper, "sh", "-c", command], {
		cwd,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const match = raw.match(/max_rss_bytes=(\d+)/);
	return { command, maxRssMiB: match ? round(Number(match[1]) / 1024 ** 2, 1) : 0 };
}

export function round(value, digits = 1) {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

export function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeText(path, text) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text.endsWith("\n") ? text : `${text}\n`);
}

export function fileSizeBytes(path) {
	if (!existsSync(path)) return 0;
	return readFileSync(path).length;
}
