// Benchmark metric definitions for the npm/Node baseline and the Bun setup.
//
// Each metric is measured with the same method in both profiles so the
// comparison table in bench/compare.md is apples-to-apples.

import { join } from "node:path";
import { repoRoot } from "./lib.mjs";

// Dependency order used by the repository's root build script.
export const buildOrder = ["chord", "tui", "codemode", "mcp", "ai", "durable", "env", "agent", "coding-agent"];

// Independent packages per dependency level. Used to build in parallel.
export const buildLevels = [
	["tui", "codemode", "mcp"],
	["chord", "ai"],
	["durable", "agent"],
	["env", "coding-agent"],
];

export const profiles = {
	npm: {
		label: "npm + Node",
		run: (script) => `npm run ${script}`,
		install: "npm ci --ignore-scripts",
		// `npm cache clean --force` only drops part of the cache: 815 MB of
		// cache became 673 MB. Removing the content-addressable store is what
		// actually makes the install cold.
		installColdPrepare: "rm -rf node_modules && rm -rf ~/.npm/_cacache",
		installWarmPrepare: "rm -rf node_modules",
		// The type checker and bundler are the same in both profiles; only the
		// package manager and script runner change.
		tsc: "./node_modules/.bin/tsc",
		// The repository's test runner isolates the environment. PI_TEST_PACKAGE_MANAGER
		// selects which package manager drives the suite.
		test: "./test.sh",
		// The parallel build script picks its runner from the runtime it runs on.
		// Pin it so the npm profile really drives the workspace scripts with npm.
		buildEnv: "PI_PACKAGE_MANAGER=npm",
	},
	bun: {
		label: "Bun",
		run: (script) => `bun run ${script}`,
		install: "bun install --frozen-lockfile --ignore-scripts",
		installColdPrepare: "rm -rf node_modules && rm -rf ~/.bun/install/cache",
		installWarmPrepare: "rm -rf node_modules",
		tsc: "./node_modules/.bin/tsc",
		test: "PI_TEST_PACKAGE_MANAGER=bun ./test.sh",
		buildEnv: "PI_PACKAGE_MANAGER=bun",
	},
};

/**
 * Remove every workspace package's build output, so a build metric always
 * measures a full compile.
 */
const cleanAllPackages = `rm -rf ${buildOrder.map((pkg) => `packages/${pkg}/dist`).join(" ")}`;

/**
 * The repository's original explicit build chain, with the script runner
 * swapped for the profile under test. Both profiles run the identical command
 * sequence, so the difference is only npm's runner overhead.
 */
function sequentialChain(profile) {
	const parts = [];
	buildOrder.forEach((pkg, index) => {
		const script = pkg === "ai" ? "build:offline" : "build";
		// The original chain walks the packages with relative `cd ../name` steps.
		const directory = index === 0 ? `cd packages/${pkg}` : `cd ../${pkg}`;
		parts.push(`${directory} && ${profile.run(script)}`);
	});
	return parts.join(" && ");
}

/**
 * Build the metric list for a profile.
 * `opts.include` filters by metric name prefix.
 */
export function metricsFor(profileName, options = {}) {
	const profile = profiles[profileName];
	if (!profile) throw new Error(`Unknown profile: ${profileName}`);
	const include = options.include;
	const metrics = [];

	const add = (metric) => {
		if (include && !include.some((prefix) => metric.name === prefix || metric.name.startsWith(`${prefix}.`))) return;
		metrics.push(metric);
	};

	// --- install -------------------------------------------------------
	add({
		name: "install.cold",
		group: "install",
		command: profile.install,
		prepare: profile.installColdPrepare,
		note: "Empty node_modules and a cleared package-manager cache.",
	});
	add({
		name: "install.warm",
		group: "install",
		command: profile.install,
		prepare: profile.installWarmPrepare,
		note: "Empty node_modules, warm package-manager cache.",
	});

	// --- build ---------------------------------------------------------
	// Every build metric starts from a clean package output directory, so both
	// profiles measure a full compile rather than an incremental no-op.
	add({
		name: "build.full",
		group: "build",
		command: `${profile.buildEnv} ${profile.run("build:offline")}`,
		prepare: cleanAllPackages,
		note: "The repository's own build script, with this profile's runner, from a clean tree.",
	});
	add({
		name: "build.full.sequential",
		group: "build",
		command: sequentialChain(profile),
		prepare: cleanAllPackages,
		note: "The original explicit per-package chain, run with this profile's script runner.",
	});
	for (const pkg of buildOrder) {
		add({
			name: `build.pkg.${pkg}`,
			group: "build",
			command: `cd packages/${pkg} && ../../node_modules/.bin/tsc -p tsconfig.build.json`,
			prepare: `rm -rf packages/${pkg}/dist`,
			cwd: repoRoot,
			note: `tsc -p tsconfig.build.json for packages/${pkg}, from a clean output directory.`,
		});
	}
	add({
		name: "build.incremental",
		group: "build",
		command: "cd packages/coding-agent && ../../node_modules/.bin/tsc -p tsconfig.build.json",
		// Build once so the build info exists, then change one file. What is
		// measured is the rebuild that follows the change.
		prepare: "cd packages/coding-agent && ../../node_modules/.bin/tsc -p tsconfig.build.json && touch src/cli.ts",
		note: "Rebuild of packages/coding-agent after touching one source file.",
	});

	// --- check ---------------------------------------------------------
	add({
		name: "check.full",
		group: "check",
		command: profile.run("check"),
		note: "biome, the lockfile checks, tsc --noEmit and the smoke checks.",
	});

	// --- test ----------------------------------------------------------
	add({
		name: "test.full",
		group: "test",
		command: profile.test,
		// The suite has one timing-sensitive test in packages/codemode that
		// flakes under load. Record the exit codes instead of aborting the
		// whole benchmark on the first flake.
		ignoreFailure: true,
		note: "Full suite through the repository's isolated test runner.",
	});
	add({
		name: "test.one",
		group: "test",
		command: "cd packages/agent && ../../node_modules/.bin/vitest --run test/agent.test.ts",
		cwd: repoRoot,
		note: "One vitest file (packages/agent).",
	});

	// --- script runner overhead ---------------------------------------
	add({
		name: "script.startup",
		group: "runner",
		command: profile.run("bench:noop"),
		note: "Cost of one package-manager script invocation, including process startup.",
	});

	// --- binary --------------------------------------------------------
	add({
		name: "build.binary",
		group: "binary",
		command:
			profileName === "npm"
				? "npm --prefix packages/coding-agent run build:binary"
				: "cd packages/coding-agent && bun run build:binary",
		prepare: cleanAllPackages,
		note: "Standalone compiled binary (bun build --compile), from a clean tree.",
		runs: 3,
	});

	return metrics;
}

/** Memory measurements, run once each because they are not timing-sensitive. */
export function memoryMetricsFor(profileName) {
	const profile = profiles[profileName];
	return [
		{
			name: "memory.build.full",
			group: "memory",
			command: profile.run("build:offline"),
			prepare: cleanAllPackages,
			note: "Peak RSS of the full offline build.",
		},
		{
			name: "memory.check.full",
			group: "memory",
			command: profile.run("check"),
			note: "Peak RSS of the check pipeline.",
		},
		{
			name: "memory.cli.node",
			group: "memory",
			command: "node packages/coding-agent/dist/bundle/cli.js --version",
			note: "Peak RSS of the Node CLI startup.",
		},
		{
			name: "memory.cli.binary",
			group: "memory",
			command: "packages/coding-agent/dist/pi --version",
			note: "Peak RSS of the compiled Bun binary startup.",
		},
	];
}

export function cliStartupMetrics() {
	return [
		{
			name: "cli.startup.node",
			group: "cli",
			command: "node packages/coding-agent/dist/bundle/cli.js --version",
			note: "Node running the bundled CLI, --version.",
		},
		{
			name: "cli.startup.binary",
			group: "cli",
			command: "packages/coding-agent/dist/pi --version",
			note: "Compiled Bun binary, --version.",
		},
		{
			name: "cli.startup.node.models",
			group: "cli",
			command: "node packages/coding-agent/dist/bundle/cli.js --list-models",
			note: "Node running the bundled CLI, a real command that lists models.",
		},
		{
			name: "cli.startup.binary.models",
			group: "cli",
			command: "packages/coding-agent/dist/pi --list-models",
			note: "Compiled Bun binary, a real command that lists models.",
		},
	];
}
