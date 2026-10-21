import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.PI_PARITY_OUT ?? join(HERE, "out");
const GOLDEN = join(HERE, "golden");

const RULES = [
	[/Hi [^,\n]+, what are we building today\?/g, "Hi <user>, what are we building today?"],
	[/\b(Took|Elapsed) [0-9]+(?:\.[0-9]+)?(?:ms|s|m)\b/g, "$1 <duration>"],
	[/ · [0-9]+(?:\.[0-9]+)?s\b/g, " · <duration>"],
	[/\b\d[\d,]* tokens\b/g, "<n> tokens"],
	[/\b\d[\d,]*\b(?= tokens)/g, "<n>"],
	[/[█▉▊▋▌▍▎▏░]+/g, "<bar>"],
];

export function normalizePane(pane, volatile = []) {
	let text = pane.join("\n");
	for (const path of volatile) {
		if (!path) continue;
		text = text.split(path).join("<path>");
	}
	for (const [pattern, replacement] of RULES) text = text.replace(pattern, replacement);
	return text;
}

export function normalizeTrace(trace) {
	const volatile = trace?.meta?.volatile ?? [];
	return {
		...trace,
		steps: trace.steps.map((step) => ({ ...step, normalized: normalizePane(step.pane, volatile) })),
	};
}

export function diffTraces(golden, current) {
	const differences = [];
	const names = new Set([...golden.steps.map((s) => s.name), ...current.steps.map((s) => s.name)]);
	for (const name of names) {
		const a = golden.steps.find((s) => s.name === name);
		const b = current.steps.find((s) => s.name === name);
		if (!a || !b) {
			differences.push({ step: name, reason: !a ? "missing in the current trace" : "missing in the golden trace" });
			continue;
		}
		if (a.pane.join("\n") !== b.pane.join("\n")) {
			differences.push({ step: name, golden: a.pane, current: b.pane });
		}
	}
	return differences;
}

export function diffNormalized(golden, current) {
	const left = normalizeTrace(golden);
	const right = normalizeTrace(current);
	const differences = [];
	const names = new Set([...left.steps.map((s) => s.name), ...right.steps.map((s) => s.name)]);
	for (const name of names) {
		const a = left.steps.find((s) => s.name === name);
		const b = right.steps.find((s) => s.name === name);
		if (!a || !b) {
			differences.push({ step: name, reason: !a ? "missing in the current trace" : "missing in the golden trace" });
			continue;
		}
		if (a.normalized !== b.normalized) {
			differences.push({ step: name, golden: a.normalized.split("\n"), current: b.normalized.split("\n") });
		}
	}
	return differences;
}

export function commitNote(golden, current) {
	const goldenCommit = golden?.meta?.tsCommit;
	const currentCommit = current?.meta?.tsCommit;
	if (!goldenCommit || !currentCommit || goldenCommit === currentCommit) return null;
	return `the golden was captured against the TypeScript commit ${goldenCommit}, this run used ${currentCommit}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [side = "rust", scenario = "startup"] = process.argv.slice(2);
	const goldenPath = join(GOLDEN, `ts-${scenario}.json`);
	const currentPath = join(OUT, `${side}-${scenario}.json`);
	if (!existsSync(goldenPath)) throw new Error(`no golden trace: ${goldenPath}`);
	const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
	const current = JSON.parse(readFileSync(currentPath, "utf8"));
	const note = commitNote(golden, current);
	if (note) console.log(`note: ${note}`);
	const differences = diffTraces(golden, current);
	if (differences.length === 0) {
		console.log(`identical: ${side} matches the golden trace for ${scenario}`);
		process.exit(0);
	}
	for (const difference of differences) {
		console.log(`\n=== ${difference.step}: ${difference.reason ?? "the pane differs"}`);
		if (difference.golden) {
			console.log("--- golden ---\n" + difference.golden.join("\n"));
			console.log("--- current ---\n" + difference.current.join("\n"));
		}
	}
	console.log(`\n${differences.length} difference(s) in ${scenario}`);
	process.exit(1);
}
