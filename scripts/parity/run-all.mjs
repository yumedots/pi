import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_DIR, MOCKS, SCENARIOS, SCENARIO_NAMES, WORK_DIR, drive, gitCommit, rustCommand, tsCommand, writeAgentDir } from "./drive.mjs";
import { commitNote, diffNormalized, diffTraces } from "./compare.mjs";
import { startMockServerProcess } from "./mock-server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "out");
const GOLDEN = join(HERE, "golden");

const WORK = WORK_DIR;
const AGENT = AGENT_DIR;

const EXPECT = {
	prompt: ["Hello from the parity mock."],
	tool: ["The fixture file says hello."],
	markdown: ["E = mc²", "```rust", "- [x] done"],
};

function pickTsRoot() {
	const override = process.env.PI_PARITY_TS_ROOT;
	if (override) return override;
	for (const candidate of [ROOT, "/Users/gabriel/pi"]) {
		if (
			existsSync(join(candidate, "packages/coding-agent/src/cli.ts")) &&
			existsSync(join(candidate, "node_modules"))
		) {
			return candidate;
		}
	}
	return ROOT;
}

function volatilePaths(...paths) {
	const out = [];
	for (const path of paths) {
		if (!path) continue;
		out.push(path);
		try {
			const real = realpathSync(path);
			if (real !== path) out.push(real);
		} catch {}
	}
	return [...new Set(out)].sort((a, b) => b.length - a.length);
}

function printDifference(difference) {
	console.log(`\n=== ${difference.step}: ${difference.reason ?? "the pane differs"}`);
	if (difference.golden) {
		console.log("--- golden ---\n" + difference.golden.join("\n"));
		console.log("--- current ---\n" + difference.current.join("\n"));
	}
}

function lastPane(trace) {
	return trace.steps[trace.steps.length - 1]?.pane.join("\n") ?? "";
}

async function main() {
	const args = process.argv.slice(2);
	const update = args.includes("--update");
	const only = args.filter((arg) => !arg.startsWith("--"));
	const scenarios = only.length ? only : SCENARIO_NAMES;
	for (const scenario of scenarios) {
		if (!SCENARIOS[scenario]) throw new Error(`unknown scenario: ${scenario}`);
	}

	mkdirSync(WORK, { recursive: true });
	mkdirSync(OUT, { recursive: true });
	writeFileSync(join(WORK, "tool-input.txt"), "hello from the parity fixture\n");

	const tsRoot = pickTsRoot();
	const rustBin = process.env.PI_PARITY_RUST_BIN ?? join(ROOT, "rpi/target/debug/rpi");
	if (!existsSync(rustBin)) throw new Error(`no Rust binary: ${rustBin} (build it with: cargo build -p rpi-cli --bin rpi)`);
	const clock = join(OUT, "clock");
	writeFileSync(clock, "0");

	const volatile = volatilePaths(WORK, AGENT, tsRoot, ROOT);
	let failed = false;

	for (const scenario of scenarios) {
		const baseMeta = {
			scenario,
			tsRoot,
			tsCommit: gitCommit(tsRoot),
			repoCommit: gitCommit(ROOT),
			volatile,
		};
		const traces = {};
		for (const side of ["ts", "rust"]) {
			// Each side gets its own mock server: the script's turns are served
			// in order, so a shared mock would hand the second side the
			// scenario's second turn instead of its first one.
			const mock = await startMockServerProcess(MOCKS[scenario] ?? {});
			writeAgentDir(AGENT, mock.baseUrl);
			try {
				const command =
					side === "ts"
						? tsCommand({ tsRoot, cwd: WORK, agentDir: AGENT, clock })
						: rustCommand({ rustBin, cwd: WORK, agentDir: AGENT, clock });
				const trace = drive({
					name: `${side}-${scenario}`,
					command,
					scenario,
					clock,
					meta: { ...baseMeta, side },
				});
				traces[side] = trace;
				writeFileSync(join(OUT, `${side}-${scenario}.json`), `${JSON.stringify(trace, null, 1)}\n`);
			} finally {
				await mock.close();
			}
		}

		console.log(`\n=== scenario: ${scenario}`);
		const goldenPath = join(GOLDEN, `ts-${scenario}.json`);
		if (update) {
			writeFileSync(goldenPath, `${JSON.stringify(traces.ts, null, 1)}\n`);
			console.log(`golden written: ${goldenPath}`);
			continue;
		}
		if (!existsSync(goldenPath)) {
			console.log(`no golden trace: ${goldenPath} (capture one with: node scripts/parity/run-all.mjs ${scenario} --update)`);
			failed = true;
			continue;
		}
		const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
		const note = commitNote(golden, traces.ts);
		if (note) console.log(`note: ${note}`);

		for (const side of ["ts", "rust"]) {
			const differences = diffNormalized(golden, traces[side]);
			const raw = diffTraces(golden, traces[side]);
			if (differences.length === 0) {
				const note2 = raw.length === 0 ? "" : ` (${raw.length} step(s) differ only in volatile fields)`;
				console.log(`${side}: matches the golden trace (${traces[side].steps.length} steps)${note2}`);
			} else {
				console.log(`${side}: ${differences.length} step(s) differ from the golden trace`);
				for (const difference of differences) printDifference(difference);
				failed = true;
			}
		}

		const crossSide = diffNormalized(traces.ts, traces.rust);
		if (crossSide.length === 0) {
			console.log("ts and rust: the two traces are identical");
		} else {
			console.log(`ts and rust: ${crossSide.length} step(s) differ`);
			failed = true;
		}

		for (const expected of EXPECT[scenario] ?? []) {
			const onTs = lastPane(traces.ts).includes(expected);
			const onRust = lastPane(traces.rust).includes(expected);
			console.log(`reply ${JSON.stringify(expected)}: ts ${onTs ? "present" : "MISSING"}, rust ${onRust ? "present" : "MISSING"}`);
			if (!onTs || !onRust) failed = true;
		}
	}

	if (failed) {
		console.log("\nparity: differences found");
		process.exit(1);
	}
	console.log("\nparity: every scenario matches the golden traces");
}

await main();
