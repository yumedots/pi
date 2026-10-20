#!/usr/bin/env node
/**
 * The 3dicon frame check.
 *
 * It renders the logo at the same elapsed times on both sides and compares the
 * lines character for character. The TypeScript original reads the harness's
 * virtual clock, so the elapsed time is the same on both sides.
 *
 * Usage: node scripts/parity/3dicon.mjs
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const TS = "/Users/gabriel/pi";
const TIMES = [0, 2, 5];

const clockDir = mkdtempSync(join(tmpdir(), "pi-3dicon-"));
const clock = join(clockDir, "clock");

const tsScript = join(clockDir, "logo.ts");
writeFileSync(
	tsScript,
	`import { writeFileSync } from "node:fs";
import { initTheme } from "${TS}/packages/coding-agent/src/modes/interactive/theme/theme.ts";
import { PiLogo3d } from "${TS}/packages/coding-agent/src/modes/interactive/components/easter-egg-3d.ts";
initTheme();
const logo = new PiLogo3d({ requestRender() {} } as unknown as never, [0, 0, 0]);
writeFileSync(process.env.PI_PARITY_CLOCK!, String(Number(process.env.PI_PARITY_ELAPSED_MS)));
const lines = logo.render(100);
process.stdout.write(lines.join("\\n"));
`,
);

function tsFrame(elapsed) {
	writeFileSync(clock, "0");
	const result = spawnSync(
		"bun",
		["--preload", join(HERE, "clock-preload.mjs"), tsScript],
		{
			cwd: TS,
			encoding: "utf8",
			env: { ...process.env, PI_PARITY_CLOCK: clock, PI_PARITY_ELAPSED_MS: String(elapsed * 1000) },
		},
	);
	if (result.status !== 0) throw new Error(`the TypeScript logo failed: ${result.stderr}`);
	return result.stdout.replace(/\n+$/, "").split("\n");
}

function rustFrame(elapsed) {
	const binary = join(ROOT, "rpi/target/debug/examples/logo3d");
	if (!existsSync(binary)) {
		throw new Error(`build it first: cd ${join(ROOT, "rpi")} && cargo build -p rpi-tui --example logo3d`);
	}
	return execFileSync(binary, [String(elapsed)], { encoding: "utf8" }).replace(/\n+$/, "").split("\n");
}

let failures = 0;
for (const elapsed of TIMES) {
	const ts = tsFrame(elapsed);
	const rust = rustFrame(elapsed);
	if (ts.join("\n") === rust.join("\n")) {
		console.log(`t=${elapsed}s: identical (${ts.length} lines)`);
		continue;
	}
	failures++;
	console.log(`t=${elapsed}s: DIFFERENT`);
	for (let i = 0; i < Math.max(ts.length, rust.length); i++) {
		if (ts[i] !== rust[i]) {
			console.log(`  line ${i}`);
			console.log(`  the original: ${JSON.stringify(ts[i])}`);
			console.log(`  the port:     ${JSON.stringify(rust[i])}`);
			break;
		}
	}
}

if (failures > 0) {
	console.log(`\n${failures} of ${TIMES.length} frames differ`);
	process.exit(1);
}
console.log(`\nall ${TIMES.length} frames are identical`);
