#!/usr/bin/env node
/**
 * Compare the session list the port shows with the list the original shows.
 *
 * The original's rows come from `measure-session-list-original.mjs` (JSON), the
 * port's rows from the port's own dump (TSV: id, title, timestamp, path).
 *
 * Usage:
 *   node bench/harness/compare-session-list.mjs --original <json> --port <tsv>
 */
import { readFileSync } from "node:fs";

const options = { original: "", port: "" };
for (let index = 2; index < process.argv.length; index++) {
	const arg = process.argv[index];
	const value = process.argv[++index];
	if (arg === "--original") options.original = value;
	else if (arg === "--port") options.port = value;
	else throw new Error(`Unknown option: ${arg}`);
}
if (!options.original || !options.port) throw new Error("Missing --original/--port");

const original = JSON.parse(readFileSync(options.original, "utf8"));

const port = new Map();
for (const line of readFileSync(options.port, "utf8").split("\n")) {
	if (!line.trim()) continue;
	const [id, title, timestamp, path] = line.split("\t");
	port.set(id, { title, timestamp, path });
}

const originalById = new Map();
for (const row of original.rows) originalById.set(row.id, row);

const missingInPort = [];
const extraInPort = [];
const titleDifferences = [];
const timestampDifferences = [];

for (const [id, row] of originalById) {
	if (!port.has(id)) {
		missingInPort.push(id);
		continue;
	}
	const expectedTitle = row.name ?? row.firstMessage;
	const portRow = port.get(id);
	if (portRow.title !== expectedTitle) {
		titleDifferences.push({ id, port: portRow.title, original: expectedTitle });
	}
	if (portRow.timestamp !== row.created) {
		timestampDifferences.push({ id, port: portRow.timestamp, original: row.created });
	}
}
for (const id of port.keys()) {
	if (!originalById.has(id)) extraInPort.push(id);
}

const result = {
	originalFiles: original.rows.length,
	portRows: port.size,
	missingInPort: missingInPort.length,
	extraInPort: extraInPort.length,
	titleDifferences: titleDifferences.length,
	timestampDifferences: timestampDifferences.length,
	samples: {
		missingInPort: missingInPort.slice(0, 5),
		extraInPort: extraInPort.slice(0, 5),
		titleDifferences: titleDifferences.slice(0, 5),
		timestampDifferences: timestampDifferences.slice(0, 5),
	},
};

process.stdout.write(`${JSON.stringify(result, null, 1)}\n`);
process.exit(
	result.missingInPort === 0 &&
		result.extraInPort === 0 &&
		result.titleDifferences === 0 &&
		result.timestampDifferences === 0
		? 0
		: 1,
);
