#!/usr/bin/env node
/**
 * Where the memory of the agent goes, module by module.
 *
 * Every step imports the modules before it, so the number it reports is what
 * the module adds on top of them. The steps are the modules the agent loads at
 * startup, and the last one is the agent itself.
 *
 * Usage: node bench/harness/memory-attribution.mjs
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const PKG = join(REPO_ROOT, "packages/coding-agent");
const AI = join(REPO_ROOT, "packages/ai");
const TUI = join(REPO_ROOT, "packages/tui");

/** The modules of the agent, in the order it loads them. */
const steps = [
	["the runtime itself", null],
	["typebox (the schema builder)", "typebox"],
	["typebox/compile (the schema compiler)", "typebox/compile"],
	["undici (the http client)", "undici"],
	["the model catalog (every provider)", `${AI}/dist/providers/all.js`],
	["the pi-ai package", `${AI}/dist/index.js`],
	["the terminal interface", `${TUI}/dist/index.js`],
	["the syntax highlighter", `${PKG}/dist/utils/syntax-highlight.js`],
	["the tools and their schemas", `${PKG}/dist/core/tools/index.js`],
	["the settings", `${PKG}/dist/core/settings-manager.js`],
	["the model runtime", `${PKG}/dist/core/model-runtime.js`],
	["the session", `${PKG}/dist/core/agent-session.js`],
	["the interactive mode", `${PKG}/dist/modes/interactive/interactive-mode.js`],
];

/** The resident set size of a process that imported the given modules. */
function measure(specifiers) {
	const imports = specifiers.map((specifier) => `await import(${JSON.stringify(specifier)});`).join("\n");
	const script = `
		const rss = () => Math.round(process.memoryUsage().rss / 1048576);
		const before = rss();
		${imports}
		process.stdout.write(String(rss() - before));
	`;
	const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
		cwd: REPO_ROOT,
		encoding: "utf8",
	});
	const delta = Number.parseInt(result.stdout.trim(), 10);
	return Number.isFinite(delta) ? delta : undefined;
}

let previous = 0;
console.log(`${"module".padEnd(38)} cost`);
for (const [label, specifier] of steps) {
	const specifiers = steps
		.slice(0, steps.findIndex(([name]) => name === label) + 1)
		.map(([, value]) => value)
		.filter(Boolean);
	const total = measure(specifiers);
	if (total === undefined) {
		console.log(`${label.padEnd(38)} ?`);
		continue;
	}
	console.log(`${label.padEnd(38)} ${total - previous >= 0 ? "+" : ""}${total - previous} MB`);
	previous = total;
}
console.log(`${"the whole agent".padEnd(38)} ${previous} MB`);
