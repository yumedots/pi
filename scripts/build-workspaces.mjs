#!/usr/bin/env node
// Builds every workspace package, honouring the dependency order between them
// and running independent packages in parallel.
//
// The root `build` and `build:offline` scripts used to be a hand-written
// `cd packages/X && npm run build` chain. That chain is correct but serial:
// packages/tui, packages/codemode and packages/mcp do not depend on each
// other, and neither do durable/agent or env/coding-agent.
//
// Usage:
//   bun scripts/build-workspaces.mjs [--offline] [--package-manager <npm|bun>]
//
//   --offline              Use packages/ai's `build:offline` script (bundled
//                          model data) instead of `build` (fetches models.dev).
//   --package-manager      Which runner to invoke the workspace scripts with.
//                          Defaults to PI_PACKAGE_MANAGER, then to the runtime
//                          this script runs on.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

const args = process.argv.slice(2);
const offline = args.includes("--offline");
const packageManagerIndex = args.indexOf("--package-manager");
const explicitPackageManager = packageManagerIndex === -1 ? undefined : args[packageManagerIndex + 1];
for (const arg of args) {
	if (arg === "--offline" || arg === "--package-manager" || arg === explicitPackageManager) continue;
	console.error(`Unknown argument: ${arg}`);
	process.exit(1);
}

const packageManager =
	explicitPackageManager ?? process.env.PI_PACKAGE_MANAGER ?? (process.versions.bun ? "bun" : "npm");
if (packageManager !== "npm" && packageManager !== "bun") {
	console.error(`Unsupported package manager: ${packageManager}`);
	process.exit(1);
}

/**
 * The buildable workspaces: a direct child of `packages/` that declares a
 * `build` script. The extension examples under
 * `packages/coding-agent/examples/extensions/` are not part of the package
 * build chain, so they stay out.
 */
function readBuildableWorkspaces() {
	const packagesDir = join(repoRoot, "packages");
	const workspaces = [];
	for (const name of readdirSync(packagesDir).sort()) {
		const directory = join(packagesDir, name);
		const manifestPath = join(directory, "package.json");
		if (!existsSync(manifestPath)) continue;
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (typeof manifest.scripts?.build !== "string") continue;
		workspaces.push({ directory, name: manifest.name, manifest });
	}
	return workspaces;
}

/** Group workspaces into levels where every package in a level only depends on earlier levels. */
function buildLevels(workspaces) {
	const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
	const levels = [];
	const placed = new Set();
	let remaining = [...workspaces];

	while (remaining.length > 0) {
		const level = remaining.filter((workspace) =>
			Object.keys(workspace.manifest.dependencies ?? {}).every(
				(dependency) => !byName.has(dependency) || placed.has(dependency),
			),
		);
		if (level.length === 0) {
			// A dependency cycle. Fall back to one package at a time so the build still runs.
			const next = remaining[0];
			levels.push([next]);
			placed.add(next.name);
			remaining = remaining.filter((workspace) => workspace !== next);
			continue;
		}
		levels.push(level);
		for (const workspace of level) placed.add(workspace.name);
		remaining = remaining.filter((workspace) => !placed.has(workspace.name));
	}
	return levels;
}

function scriptFor(workspace) {
	if (offline && workspace.name === "@earendil-works/pi-ai") return "build:offline";
	return "build";
}

function runScript(workspace) {
	const script = scriptFor(workspace);
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(packageManager, ["run", script], {
			cwd: workspace.directory,
			stdio: "inherit",
			env: process.env,
		});
		child.on("error", rejectPromise);
		child.on("exit", (code, signal) => {
			if (code === 0) {
				resolvePromise();
				return;
			}
			rejectPromise(new Error(`${workspace.name}: ${script} failed (${signal ?? `exit ${code}`})`));
		});
	});
}

const workspaces = readBuildableWorkspaces();
const levels = buildLevels(workspaces);

console.log(`Building ${workspaces.length} workspace packages with ${packageManager}:`);
for (const level of levels) {
	console.log(`  level: ${level.map((workspace) => workspace.name).join(", ")}`);
}

const started = Date.now();
for (const level of levels) {
	// Independent packages in one level run at the same time.
	const levelStarted = Date.now();
	await Promise.all(level.map((workspace) => runScript(workspace)));
	console.log(
		`  ${((Date.now() - levelStarted) / 1000).toFixed(1)}s: ${level.map((workspace) => workspace.name).join(", ")}`,
	);
}
console.log(`Build finished in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
