import assert from "node:assert/strict";
import test from "node:test";
import { MEASURES, SCENARIOS, renderMarkdown } from "./perf-table.mjs";

/**
 * The entry of one side of one scenario, with the shape the harness writes.
 */
function fakeEntry(kind) {
	if (kind === "timing") {
		return { samples: [1], summary: { min: 1, max: 1, avg: 1, median: 1, spread: 0 } };
	}
	if (kind === "energy") {
		return { value: { deltaPercent: 0, elapsedSeconds: 60, mahDelta: 0, onAc: false } };
	}
	return { value: 1 };
}

/**
 * The results of a run, with every scenario of the table in it.
 *
 * The shape is the one the harness writes, so the table can be rendered
 * without running the measurements.
 */
function fakeResults() {
	return {
		date: "2026-01-01T00:00:00.000Z",
		machine: {
			platform: "darwin arm64",
			cpuModel: "Apple M3 Pro",
			cpus: 11,
			totalMemoryBytes: 18 * 1024 * 1024 * 1024,
			loadAverage: [1, 1, 1],
			node: "v26.10.0",
			bun: "1.4.3",
		},
		options: { runs: 5, warmup: 1, paneWidth: 100, paneHeight: 30, energySeconds: 60 },
		fixture: { dir: "/tmp/fixture", sessions: 2563, cwd: "/tmp/work" },
		sides: [
			{ id: "ts", label: "TypeScript original", runtime: "bun 1.4.3", buildProfile: "the sources" },
			{ id: "rpi", label: "Rust port", runtime: "native binary", buildProfile: "debug" },
		],
		scenarios: SCENARIOS.map((scenario) => ({
			id: scenario.id,
			label: scenario.label,
			method: scenario.method,
			kind: scenario.kind,
			sides: {
				ts: fakeEntry(scenario.kind),
				rpi: fakeEntry(scenario.kind),
			},
		})),
	};
}

test("the table has a scenario for every measurement", () => {
	assert.ok(SCENARIOS.length > 0, "the table has no scenario");
	for (const scenario of SCENARIOS) {
		assert.equal(typeof scenario.id, "string");
		assert.equal(typeof scenario.label, "string");
		assert.equal(typeof scenario.method, "string", `the scenario ${scenario.id} has no method`);
		assert.ok(scenario.method.length > 0, `the scenario ${scenario.id} has an empty method`);
		assert.equal(typeof scenario.kind, "string");
	}
});

test("every scenario of the table has a measure", () => {
	for (const scenario of SCENARIOS) {
		assert.equal(typeof MEASURES[scenario.id], "function", `the scenario ${scenario.id} has no measure`);
	}
});

test("the scenarios of the table have different names", () => {
	const names = SCENARIOS.map((scenario) => scenario.id);
	assert.equal(new Set(names).size, names.length);
});

test("the table renders a row for every scenario", () => {
	const markdown = renderMarkdown(fakeResults());
	for (const scenario of SCENARIOS) {
		assert.ok(markdown.includes(scenario.label), `the scenario ${scenario.label} is missing from the table`);
		assert.ok(markdown.includes(scenario.method), `the method of ${scenario.label} is missing from the table`);
	}
});
