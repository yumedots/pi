#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SCREENS } from "./screens.mjs";
import { PORT_FILES } from "./port-files.mjs";
import { RUST_BIN, TS_ROOT } from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The exact build the panes came from: the path and when it was linked. */
function binaryIdentity(path) {
	try {
		const stat = statSync(path);
		return `${path} (mtime ${stat.mtime.toISOString()})`;
	} catch {
		return `${path} (missing)`;
	}
}
const DIFFS = join(HERE, "diffs");

/**
 * Parts of a screen that are fresh on every run. They are masked on both sides
 * before the comparison, so the diff shows the real differences and not the
 * random PKCE challenge, the pairing code, the session id, the animation frame
 * counter or a duration.
 */
const VOLATILE = [
	[/pi-screens\/(work|agent|home)\/(ts|rust)\//g, "pi-screens/$1/"],
	[/code_challenge=[^&\s]+/g, "code_challenge=<n>"],
	[/state=[^&\s]+/g, "state=<n>"],
	[/redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A\d+/g, "redirect_uri=<local>"],
	[/Enter code: [A-Z0-9-]+/g, "Enter code: <code>"],
	[/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/g, "<timestamp>"],
	[/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, "<uuid>"],
	[/Frame: \d+/g, "Frame: <n>"],
	[/· \d+(?:\.\d+)?s\b/g, "· <duration>"],
	[/Took \d+(?:\.\d+)?(?:ms|s|m)\b/g, "Took <duration>"],
	[/\b\d[\d,]* tokens\b/g, "<n> tokens"],
];

export function normalize(text) {
	let out = text;
	for (const [pattern, replacement] of VOLATILE) out = out.replace(pattern, replacement);
	return out;
}

function readScreen(side, name) {
	const path = join(HERE, side, `${name}.txt`);
	if (!existsSync(path)) return null;
	const raw = readFileSync(path, "utf8");
	const lines = raw.split("\n");
	// The header comment block comes first; the pane starts after the blank line.
	let start = -1;
	for (let index = 1; index < lines.length; index++) {
		if (lines[index] === "" && lines[index - 1].startsWith("#")) {
			start = index;
			break;
		}
	}
	const body = start === -1 ? lines : lines.slice(start + 1);
	while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
	return { raw, body };
}

function firstDifference(left, right) {
	const max = Math.max(left.length, right.length);
	for (let index = 0; index < max; index++) {
		if (left[index] !== right[index]) {
			return { line: index + 1, left: left[index] ?? "(missing)", right: right[index] ?? "(missing)" };
		}
	}
	return null;
}

function countDifferences(left, right) {
	const max = Math.max(left.length, right.length);
	let count = 0;
	for (let index = 0; index < max; index++) {
		if (left[index] !== right[index]) count++;
	}
	return count;
}

function unifiedDiff(left, right, name) {
	const lines = [`--- ts/${name}.txt`, `+++ rust/${name}.txt`];
	const max = Math.max(left.length, right.length);
	for (let index = 0; index < max; index++) {
		if (left[index] === right[index]) continue;
		if (left[index] !== undefined) lines.push(`-${left[index]}`);
		if (right[index] !== undefined) lines.push(`+${right[index]}`);
	}
	return `${lines.join("\n")}\n`;
}

mkdirSync(DIFFS, { recursive: true });

const rows = [];
let matching = 0;
let differing = 0;
let missing = 0;

for (const spec of SCREENS) {
	const ts = readScreen("ts", spec.name);
	const rust = readScreen("rust", spec.name);
	const keys = [];
	for (const step of spec.steps) for (const key of step.keys ?? []) keys.push(key);
	const rustKeys = [];
	for (const step of spec.stepsBySide?.rust ?? spec.steps) for (const key of step.keys ?? []) rustKeys.push(key);
	const row = {
		name: spec.name,
		keys: keys.length > 0 ? keys.join(" ") : "(none)",
		rustKeys: rustKeys.length > 0 ? rustKeys.join(" ") : "(none)",
		note: spec.note ?? "",
		status: "match",
		firstDiff: "",
		diffLines: 0,
	};
	if (spec.unreachable) {
		row.status = "not reachable";
		row.firstDiff = spec.unreachable;
		missing++;
		rows.push(row);
		continue;
	}
	if (spec.rustUnreachable || spec.tsUnreachable) {
		row.status = "not reachable on one side";
		row.firstDiff = spec.rustUnreachable ?? spec.tsUnreachable;
		missing++;
		rows.push(row);
		continue;
	}
	if (!ts || !rust) {
		row.status = "not reachable";
		row.firstDiff = !ts ? "the original was not captured" : "the port was not captured";
		missing++;
		rows.push(row);
		continue;
	}
	const left = normalize(ts.body.join("\n")).split("\n");
	const right = normalize(rust.body.join("\n")).split("\n");
	const difference = firstDifference(left, right);
	if (!difference) {
		row.status = "match";
		matching++;
	} else {
		row.status = "differs";
		row.firstDiff = `line ${difference.line}: ts ${JSON.stringify(difference.left)} vs rust ${JSON.stringify(difference.right)}`;
		row.diffLines = countDifferences(left, right);
		differing++;
		writeFileSync(join(DIFFS, `${spec.name}.diff`), unifiedDiff(left, right, spec.name));
	}
	rows.push(row);
}

	const index = [
		"# Screen parity index",
		"",
		"Every screen of the TypeScript original and of the Rust port, captured as exact pane text.",
		"",
		"- `ts/<screen>.txt` is the original's pane, `rust/<screen>.txt` is the port's.",
		"- The pane was captured in a tmux session of 100x30, with the clock frozen",
		"  through `scripts/parity/clock-preload.mjs`, and both sides were driven with the",
		"  keystrokes in the *Keys (ts)* and *Keys (rust)* columns. Where the two",
		"  programs reach the same screen by different keys, the column holds the keys",
		"  that side needs.",
		"- The diff ignores the parts that are fresh on every run (the random PKCE",
		"  challenge and state, the pairing code, the session uuid, the export",
		"  timestamp, the animation frame counter and a duration) and the per-side",
		"  scratch path.",
		"- `diffs/<screen>.diff` holds the line diff of the screens that differ.",
		"- *Port file* names the file in the port that draws the screen, relative to",
		"  `rpi/crates`.",
		"- The port's panes were captured against the binary below; the original's",
		"  against the TypeScript tree in `packages/coding-agent/src/cli.ts`.",
		"",
		"  - port: `" + binaryIdentity(RUST_BIN) + "`",
		"  - original: `" + TS_ROOT + "/packages/coding-agent/src/cli.ts` (run with bun)",
		"",
		"  The port's tree is edited in place, so re-run",
		"  `node scripts/parity/screens/run.mjs rust` against a fresh binary and then",
		"  `node scripts/parity/screens/diff.mjs` to refresh this index.",
		"",
		"| Screen | Keys (ts) | Keys (rust) | Match | First differing line | Port file |",
		"|---|---|---|---|---|---|",
		...rows.map(
			(row) =>
				`| \`${row.name}\` | ${row.keys === "(none)" ? "" : row.keys} | ${row.rustKeys === "(none)" ? "" : row.rustKeys} | ${row.status} | ${row.firstDiff || ""} | ${PORT_FILES[row.name] ?? ""} |`,
		),
		"",
		`${matching} match, ${differing} differ, ${missing} not reachable.`,
		"",
	];

writeFileSync(join(HERE, "INDEX.md"), `${index.join("\n")}\n`);
console.log(`${matching} match, ${differing} differ, ${missing} not reachable`);
for (const row of rows) console.log(`${row.status.padEnd(13)} ${row.name}`);
