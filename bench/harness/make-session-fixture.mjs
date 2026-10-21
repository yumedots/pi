#!/usr/bin/env node
/**
 * Build a scratch agent directory whose session list looks like the user's.
 *
 * The user has 2563 sessions, most of them with no messages, and the session
 * picker is slow with them. This writes a directory with the same shape: the
 * session files of one encoded cwd, most of them header-only.
 *
 * Usage:
 *   node bench/harness/make-session-fixture.mjs --out <dir> --count 2563
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");

const options = { out: "", count: 2563, empty: 0.9, cwd: "/Users/gabriel/pi" };
for (let index = 2; index < process.argv.length; index++) {
	const arg = process.argv[index];
	const value = process.argv[++index];
	if (arg === "--out") options.out = resolve(value);
	else if (arg === "--count") options.count = Number.parseInt(value, 10);
	else if (arg === "--empty") options.empty = Number.parseFloat(value);
	else if (arg === "--cwd") options.cwd = value;
	else throw new Error(`Unknown option: ${arg}`);
}
if (!options.out) throw new Error("Missing --out");

/**
 * The directory name the agent gives to the sessions of one cwd: the cwd with
 * its leading slash and its separators replaced by dashes, between two dashes.
 * Mirrors pi's `getDefaultSessionDirPath`.
 */
function encodeCwd(cwd) {
	return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

function header(id, timestamp, cwd) {
	return `${JSON.stringify({
		type: "session",
		version: 3,
		id,
		timestamp,
		cwd,
	})}\n`;
}

function withPrompt(id, timestamp, cwd, index) {
	const lines = [
		header(id, timestamp, cwd),
		`${JSON.stringify({
			type: "model_change",
			id: "360e47a5",
			parentId: null,
			timestamp,
			provider: "local",
			modelId: "smollm2-1.7b-instruct",
		})}\n`,
		`${JSON.stringify({
			type: "message",
			id: "25f5dff0",
			parentId: "360e47a5",
			timestamp,
			message: { role: "user", content: `fixture prompt ${index}` },
		})}\n`,
	];
	return lines.join("");
}

const sessionsDir = join(options.out, "sessions", encodeCwd(options.cwd));
rmSync(options.out, { recursive: true, force: true });
mkdirSync(sessionsDir, { recursive: true });

const emptyCount = Math.round(options.count * options.empty);
let written = 0;
for (let index = 0; index < options.count; index++) {
	const timestamp = new Date(Date.UTC(2026, 9, 1 + (index % 28), index % 24, index % 60)).toISOString();
	const id = `${String(index).padStart(8, "0")}-fixture-0000-0000-000000000000`;
	const body = index < emptyCount ? header(id, timestamp, options.cwd) : withPrompt(id, timestamp, options.cwd, index);
	writeFileSync(join(sessionsDir, `2026-10-${String(1 + (index % 28)).padStart(2, "0")}T00-00-00-000Z_${id}.jsonl`), body);
	written++;
}

writeFileSync(
	join(options.out, "models.json"),
	`${JSON.stringify(
		{
			providers: {
				local: {
					baseUrl: "http://127.0.0.1:8081/v1",
					apiKey: "local",
					api: "openai-completions",
					models: [
						{ id: "smollm2-1.7b-instruct", name: "SmolLM2 1.7B", contextWindow: 8192, maxTokens: 512 },
					],
				},
			},
		},
		null,
		1,
	)}\n`,
);
writeFileSync(join(options.out, "settings.json"), `${JSON.stringify({ theme: "dark" }, null, 1)}\n`);

// The stored credentials of two providers, so the provider list has something
// to show on both sides: without them the agent answers that there is
// nothing to log out from.
writeFileSync(
	join(options.out, "auth.json"),
	`${JSON.stringify(
		{
			anthropic: { type: "api_key", key: "fixture-anthropic-key" },
			openai: { type: "api_key", key: "fixture-openai-key" },
		},
		null,
		1,
	)}\n`,
);

process.stdout.write(`${written} session files in ${sessionsDir} (${emptyCount} header-only)\n`);
