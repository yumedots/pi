#!/usr/bin/env node
/**
 * The biggest holders in a heap snapshot.
 *
 * Usage: node bench/harness/heap-report.mjs <snapshot>
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
	process.stderr.write("Usage: node bench/harness/heap-report.mjs <snapshot>\n");
	process.exit(1);
}
const snapshot = JSON.parse(readFileSync(file, "utf8"));
const { node_fields, node_types } = snapshot.snapshot.meta;
const fieldCount = node_fields.length;
const nameIndex = node_fields.indexOf("name");
const typeIndex = node_fields.indexOf("type");
const sizeIndex = node_fields.indexOf("self_size");
const nodes = snapshot.nodes;
const strings = snapshot.strings;
const types = node_types[0];

const byName = new Map();
let total = 0;
let count = 0;
for (let index = 0; index < nodes.length; index += fieldCount) {
	const size = nodes[index + sizeIndex];
	const name = strings[nodes[index + nameIndex]];
	const type = types[nodes[index + typeIndex]];
	total += size;
	count += 1;
	const key = `${type}:${name}`.slice(0, 90);
	byName.set(key, (byName.get(key) ?? 0) + size);
}

const rows = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
process.stdout.write(`nodes: ${count}, self size: ${(total / 1048576).toFixed(1)} MB\n`);
for (const [key, size] of rows) {
	process.stdout.write(`${(size / 1048576).toFixed(2).padStart(8)} MB  ${key}\n`);
}
