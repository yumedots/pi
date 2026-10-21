import assert from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const primitive = "packages/tui/src/spinner.ts";
const frameList = '"⠋", "⠙", "⠹"';

function collectFiles(dir: string, out: string[] = []): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (entry === "node_modules" || entry === "dist") continue;
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) collectFiles(full, out);
		else out.push(full);
	}
	return out;
}

describe("spinner primitive", () => {
	it("is declared in exactly one file", () => {
		const offenders: string[] = [];
		for (const file of collectFiles(path.join(repoRoot, "packages"))) {
			const relative = path.relative(repoRoot, file).split(path.sep).join("/");
			const isSource = relative.includes("/src/") || relative.startsWith("packages/coding-agent/examples/");
			if (!isSource) continue;
			if (relative === primitive) continue;
			if (readFileSync(file, "utf8").includes(frameList)) offenders.push(relative);
		}
		assert.deepStrictEqual(offenders, []);
	});
});
