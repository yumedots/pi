// The check for `scripts/parity/GAPS.md`.
//
// The gaps file is an inventory: every row is one gap, and the summary at the
// top counts them. The counts have to reconcile with the rows, or the file is
// worse than no file — so this script parses the rows and the summary and
// fails when they disagree.
//
//   node scripts/parity/gaps-count.mjs
//
// It checks four things:
//   1. every row's id is unique and its area's ids run 1..n without a gap;
//   2. every row carries exactly one status, and only the three known ones;
//   3. the summary's per-status counts equal the rows' per-status counts;
//   4. the summary's per-area table equals the rows' per-area counts.
//
// The row format is the markdown table row: `| <ID> | <gap> | <original> |
// <port> | <what the user sees> | <status> |`, with `\|` for a literal pipe.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = process.argv[2] ?? join(HERE, "GAPS.md");

const STATUSES = ["porting", "exception", "limitation"];
const AREAS = ["MCP", "CMD", "SET", "TOOL", "EXT", "SES", "TUI", "PRV", "ADD"];

const text = readFileSync(FILE, "utf8");
const lines = text.split("\n");

/** Split a table row into its cells, honouring the `\|` escape. */
function cells(line) {
	const out = [];
	let current = "";
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === "\\" && line[i + 1] === "|") {
			current += "|";
			i++;
			continue;
		}
		if (ch === "|") {
			out.push(current.trim());
			current = "";
			continue;
		}
		current += ch;
	}
	out.push(current.trim());
	return out;
}

const rows = [];
for (const [index, line] of lines.entries()) {
	const match = /^\|\s*([A-Z]+)-(\d+)\s*\|/.exec(line);
	if (!match) continue;
	const parts = cells(line);
	// A leading and a trailing empty string come from the outer pipes.
	const body = parts.slice(1, -1);
	const status = body[body.length - 1] ?? "";
	rows.push({
		id: `${match[1]}-${match[2]}`,
		area: match[1],
		number: Number(match[2]),
		status: status.replace(/`/g, "").split(" ")[0],
		line: index + 1,
	});
}

const problems = [];

// 1. The ids.
const seen = new Set();
const byArea = new Map();
for (const row of rows) {
	if (seen.has(row.id)) problems.push(`line ${row.line}: duplicate id ${row.id}`);
	seen.add(row.id);
	if (!byArea.has(row.area)) byArea.set(row.area, []);
	byArea.get(row.area).push(row);
}
for (const [area, areaRows] of byArea) {
	const numbers = areaRows.map((row) => row.number).sort((a, b) => a - b);
	for (const [index, number] of numbers.entries()) {
		if (number !== index + 1) {
			problems.push(`${area}: the ids are not 1..n (${numbers.join(",")})`);
			break;
		}
	}
}

// 2. The statuses.
for (const row of rows) {
	if (!STATUSES.includes(row.status)) {
		problems.push(`line ${row.line}: unknown status "${row.status}"`);
	}
}

// 3 and 4. The summary.
const counts = new Map(STATUSES.map((status) => [status, 0]));
for (const row of rows) {
	if (counts.has(row.status)) counts.set(row.status, counts.get(row.status) + 1);
}

const summaryTotal = /\| \*\*Total gaps\*\* \| \*\*(\d+)\*\* \|/.exec(text);
if (!summaryTotal) problems.push("the summary has no 'Total gaps' row");
const summaryTotalNumber = summaryTotal ? Number(summaryTotal[1]) : -1;
if (summaryTotalNumber !== rows.length) {
	problems.push(`the summary says ${summaryTotalNumber} gaps, the rows carry ${rows.length}`);
}

for (const status of STATUSES) {
	const pattern = new RegExp(`\\| \`${status}\`[^|]*\\|\\s*(\\d+)\\s*\\|`);
	const match = pattern.exec(text);
	if (!match) {
		problems.push(`the summary has no row for "${status}"`);
		continue;
	}
	const stated = Number(match[1]);
	if (stated !== counts.get(status)) {
		problems.push(`the summary says ${stated} "${status}" rows, the rows carry ${counts.get(status)}`);
	}
}

// The per-area table. The summary names the areas by their section heading, so
// the heading gives the label the table row uses.
const areaLabels = new Map();
for (const line of lines) {
	const heading = /^##\s*(\d+)\.\s*(.+?)\s*—\s*\d+\s+gaps?\s*$/.exec(line);
	if (heading) areaLabels.set(Number(heading[1]), heading[2]);
}

for (const [area, areaRows] of byArea) {
	const label = areaLabels.get(AREAS.indexOf(area) + 1);
	if (!label) {
		problems.push(`the file has no section heading for the area ${area}`);
		continue;
	}
	const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(
		`^\\|\\s*\\d+\\.\\s*${escaped}\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|`,
		"m",
	);
	const match = pattern.exec(text);
	if (!match) {
		problems.push(`the summary has no row for the area ${area} (${label})`);
		continue;
	}
	const stated = match.slice(1).map(Number);
	const actual = [
		areaRows.length,
		areaRows.filter((row) => row.status === "porting").length,
		areaRows.filter((row) => row.status === "exception").length,
		areaRows.filter((row) => row.status === "limitation").length,
	];
	if (stated.join(",") !== actual.join(",")) {
		problems.push(`the summary says ${area} = ${stated.join("/")}, the rows carry ${actual.join("/")}`);
	}
}

if (problems.length > 0) {
	console.error(`GAPS.md does not reconcile:`);
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}

console.log(
	`GAPS.md reconciles: ${rows.length} gaps — ` +
		`${counts.get("porting")} porting, ${counts.get("exception")} exception, ${counts.get("limitation")} limitation.`,
);
