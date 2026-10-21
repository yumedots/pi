#!/usr/bin/env node
/**
 * The editor parity harness.
 *
 * `EDITOR.md` compares pi's editor with the port's behaviour by behaviour:
 * one row per behaviour, pi's rule, the port's rule, whether they agree and
 * the file:line on both sides. This script is what regenerates that file's
 * summary and what keeps it honest:
 *
 *  - it parses every row of the three comparison tables,
 *  - it counts the rows per status,
 *  - it refuses a row that still differs and is not signed off in
 *    `SIGN-OFF.md` (a difference is either fixed or signed off, never both
 *    forgotten),
 *  - it rewrites the summary block of `EDITOR.md`,
 *  - with `--test` it runs the port's editor behaviour tests through the
 *    build wrapper, so the pinned behaviour is the one that shipped.
 *
 * Usage:
 *   node scripts/parity/editor-parity.mjs          # check + regenerate
 *   node scripts/parity/editor-parity.mjs --write  # write the summary back
 *   node scripts/parity/editor-parity.mjs --test   # also run the Rust tests
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const EDITOR_MD = join(HERE, "EDITOR.md");
const SIGN_OFF_MD = join(HERE, "SIGN-OFF.md");

const args = process.argv.slice(2);
const write = args.includes("--write");
const runTests = args.includes("--test");

const editor = readFileSync(EDITOR_MD, "utf8");
const signOff = readFileSync(SIGN_OFF_MD, "utf8");

/** The rows of the comparison tables: `| behaviour | pi | port | status |`. */
function parseRows(markdown) {
	const rows = [];
	for (const line of markdown.split("\n")) {
		if (!line.startsWith("|")) continue;
		const cells = line
			.split("|")
			.slice(1, -1)
			.map((cell) => cell.trim());
		if (cells.length < 4) continue;
		if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
		if (cells[0] === "behaviour" || cells[0] === "") continue;
		rows.push({ behaviour: cells[0], pi: cells[1], port: cells[2], status: cells[3] });
	}
	return rows;
}

const rows = parseRows(editor);

/** The status of a row: `agree`, `differ`, `≈` (close) or `n/a`. */
function statusOf(row) {
	const status = row.status.toLowerCase().replace(/[*_`]/g, "").trim();
	if (status.startsWith("no") || status.startsWith("differ")) return "differ";
	if (status.includes("≈")) return "close";
	if (status.startsWith("n/a")) return "n/a";
	return "agree";
}

/** The sign-off section a row points at, if any. */
function signOffOf(row) {
	const match = row.status.match(/SIGN-OFF\s*§\s*([0-9]+)/i);
	return match ? match[1] : null;
}

const counts = { agree: 0, differ: 0, close: 0, "n/a": 0 };
const unsigned = [];

for (const row of rows) {
	const status = statusOf(row);
	counts[status] += 1;
	if (status !== "differ") continue;
	const section = signOffOf(row);
	if (!section) {
		unsigned.push(row.behaviour);
		continue;
	}
	const heading = new RegExp(`^##\\s*${section}\\.`, "m");
	if (!heading.test(signOff)) {
		unsigned.push(`${row.behaviour} (SIGN-OFF §${section} is missing)`);
	}
}

const total = rows.length;

const summary = [
	`| | rows |`,
	`|---|---|`,
	`| the behaviours compared | ${total} |`,
	`| the port agrees with pi | ${counts.agree} |`,
	`| the port differs | ${counts.differ} |`,
	`| the port is close but not identical (≈) | ${counts.close} |`,
	`| not applicable on one side | ${counts["n/a"]} |`,
].join("\n");

const start = "<!-- summary:start -->";
const end = "<!-- summary:end -->";
const startIndex = editor.indexOf(start);
const endIndex = editor.indexOf(end);
if (startIndex === -1 || endIndex === -1) {
	console.error("EDITOR.md has no summary markers; add <!-- summary:start --> and <!-- summary:end -->.");
	process.exit(1);
}
const regenerated = editor.slice(0, startIndex + start.length) + "\n" + summary + "\n" + editor.slice(endIndex);

if (write && regenerated !== editor) {
	writeFileSync(EDITOR_MD, regenerated);
	console.log(`EDITOR.md summary regenerated: ${total} rows, ${counts.differ} differ.`);
} else if (regenerated !== editor) {
	console.log("The summary would change; re-run with --write to apply it.");
}

if (unsigned.length > 0) {
	console.error("These rows still differ and are not signed off in SIGN-OFF.md:");
	for (const behaviour of unsigned) console.error(`  - ${behaviour}`);
	process.exit(1);
}

if (runTests) {
	console.log("Running the port's editor behaviour tests...");
	const result = spawnSync("scripts/agent-cargo.sh", ["test", "-p", "rpi-tui", "--lib", "editor"], {
		cwd: ROOT,
		stdio: "inherit",
	});
	if (result.status !== 0) {
		console.error("The editor behaviour tests failed.");
		process.exit(result.status ?? 1);
	}
}

console.log(
	`${total} rows: ${counts.agree} agree, ${counts.differ} differ (all signed off), ${counts.close} close, ${counts["n/a"]} n/a.`,
);
if (!existsSync(SIGN_OFF_MD)) process.exit(1);
