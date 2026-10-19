#!/usr/bin/env node
/**
 * Shows where the memory of the agent goes.
 *
 * Every step imports one group of modules and reports the resident set size
 * after it. The steps are ordered the way the agent loads them, so the numbers
 * add up to the footprint of a running agent.
 *
 * Usage: node bench/harness/memory-attribution.mjs
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const PKG = join(REPO_ROOT, "packages/coding-agent");
const AI = join(REPO_ROOT, "packages/ai");

const rss = () => Math.round(process.memoryUsage().rss / 1048576);

const steps = [
	["the runtime itself", null],
	["typebox (the schema builder)", "typebox"],
	["typebox/compile (the schema compiler)", "typebox/compile"],
	["undici (the http client)", "undici"],
	["yaml (the config parser)", "yaml"],
	["the model catalog", `${AI}/dist/models.js`],
	["the pi-ai package", `${AI}/dist/index.js`],
	["the durable harness (the agent library)", `${join(REPO_ROOT, "packages/durable/dist/index.js")}`],
	["the terminal interface", `${join(REPO_ROOT, "packages/tui/dist/index.js")}`],
	["the tools and their schemas", `${PKG}/dist/core/tools/index.js`],
	["the settings", `${PKG}/dist/core/settings-manager.js`],
	["the session", `${PKG}/dist/core/agent-session.js`],
	["the interactive mode", `${PKG}/dist/modes/interactive/interactive-mode.js`],
];

let previous = rss();
console.log(`${"step".padEnd(38)} rss   delta`);
for (const [label, specifier] of steps) {
	if (specifier) await import(specifier);
	const current = rss();
	console.log(`${label.padEnd(38)} ${String(current).padStart(4)}MB ${String(current - previous).padStart(6)}MB`);
	previous = current;
}
