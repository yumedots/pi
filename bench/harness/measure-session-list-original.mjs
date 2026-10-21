#!/usr/bin/env node
/**
 * Measure the original TypeScript runtime's session listing on a fixture
 * directory: the time until the first painted row and the time until the full
 * list is ready.
 *
 * Usage:
 *   node bench/harness/measure-session-list-original.mjs --dir <sessions dir> [--cwd <cwd>]
 */
import { performance } from "node:perf_hooks";

const ORIGINAL = "/Users/gabriel/pi/packages/coding-agent/src/core/session-manager.ts";

const options = { dir: "", cwd: "/Users/gabriel/pi" };
for (let index = 2; index < process.argv.length; index++) {
	const arg = process.argv[index];
	const value = process.argv[++index];
	if (arg === "--dir") options.dir = value;
	else if (arg === "--cwd") options.cwd = value;
	else throw new Error(`Unknown option: ${arg}`);
}
if (!options.dir) throw new Error("Missing --dir");

const { SessionManager } = await import(ORIGINAL);

let firstPaintMs = null;
let firstPaintCount = 0;
let lastProgressMs = null;

const started = performance.now();
const sessions = await SessionManager.list(options.cwd, options.dir, (loaded, total, partial) => {
	if (partial && partial.length > 0 && firstPaintMs === null) {
		firstPaintMs = performance.now() - started;
		firstPaintCount = partial.length;
	}
	lastProgressMs = performance.now() - started;
});
const totalMs = performance.now() - started;

const rows = sessions.map((session) => ({
	path: session.path,
	id: session.id,
	name: session.name ?? null,
	firstMessage: session.firstMessage,
	messageCount: session.messageCount,
	created: session.created.toISOString(),
	modified: session.modified.toISOString(),
	cwd: session.cwd,
}));

process.stdout.write(
	`${JSON.stringify(
		{
			runtime: "original",
			files: rows.length,
			firstPaintMs: firstPaintMs === null ? null : Math.round(firstPaintMs),
			firstPaintCount,
			lastProgressMs: lastProgressMs === null ? null : Math.round(lastProgressMs),
			totalMs: Math.round(totalMs),
			rows,
		},
		null,
		1,
	)}\n`,
);
