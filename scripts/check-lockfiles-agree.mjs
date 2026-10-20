#!/usr/bin/env node
// Verifies that bun.lock and package-lock.json resolve the same package versions.
//
// The repository keeps both lockfiles:
//   - package-lock.json is the source of truth. The nix build reads it with
//     importNpmLock, and packages/coding-agent/install-lock (the shrinkwrap the
//     published installer uses) is generated from it.
//   - bun.lock is what `bun install` reads. It is generated from
//     package-lock.json with `bun pm migrate`, so both describe one tree.
//
// If the two ever disagree, the shrinkwrap that end users install would no
// longer match the tree the project is built and tested against. This check
// makes that drift a hard failure.
//
// Usage: node scripts/check-lockfiles-agree.mjs

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const npmLockPath = join(repoRoot, "package-lock.json");
const bunLockPath = join(repoRoot, "bun.lock");

/** Parse bun.lock, which is JSON with comments and trailing commas. */
function parseJsonc(text) {
	const withoutComments = text.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
	return JSON.parse(withoutComments.replace(/,(\s*[}\]])/g, "$1"));
}

/** "name@version" -> { name, version }. Scoped names keep their leading "@". */
function splitSpec(spec) {
	const separator = spec.lastIndexOf("@");
	if (separator <= 0) return { name: spec, version: "" };
	return { name: spec.slice(0, separator), version: spec.slice(separator + 1) };
}

function addVersion(map, name, version) {
	if (!version) return;
	if (!map.has(name)) map.set(name, new Set());
	map.get(name).add(version);
}

/**
 * npm records nested copies under a workspace symlink, for example
 * packages/coding-agent/node_modules/@earendil-works/pi-ai/node_modules/typebox.
 * Those directories are unreachable: Node resolves the symlink to packages/ai
 * and finds packages/ai/node_modules first. npm keeps them in the lockfile but
 * does not need them, and Bun does not create them.
 */
function isUnreachableWorkspaceNest(lockPath) {
	return /^packages\/[^/]+\/node_modules\/@earendil-works\//.test(lockPath);
}

function bunVersions() {
	const lock = parseJsonc(readFileSync(bunLockPath, "utf8"));
	const versions = new Map();
	for (const entry of Object.values(lock.packages ?? {})) {
		const { name, version } = splitSpec(entry[0]);
		// Workspace links are recorded as "name@workspace:path".
		if (version.startsWith("workspace:")) continue;
		addVersion(versions, name, version);
	}
	return versions;
}

function npmVersions() {
	const lock = JSON.parse(readFileSync(npmLockPath, "utf8"));
	const versions = new Map();
	for (const [lockPath, entry] of Object.entries(lock.packages ?? {})) {
		if (entry.link || !entry.version) continue;
		if (isUnreachableWorkspaceNest(lockPath)) continue;
		const marker = "node_modules/";
		const index = lockPath.lastIndexOf(marker);
		if (index === -1) continue;
		const rest = lockPath.slice(index + marker.length);
		const name = rest.startsWith("@") ? rest.split("/").slice(0, 2).join("/") : rest.split("/")[0];
		addVersion(versions, name, entry.version);
	}
	return versions;
}

if (!existsSync(bunLockPath)) {
	console.error("bun.lock is missing. Run: bun pm migrate && bun install");
	process.exit(1);
}
if (!existsSync(npmLockPath)) {
	console.error("package-lock.json is missing. The nix build and the installer shrinkwrap need it.");
	process.exit(1);
}

const bun = bunVersions();
const npm = npmVersions();
const problems = [];

for (const [name, versions] of bun) {
	const npmSet = npm.get(name);
	if (!npmSet) {
		problems.push(`${name}@${[...versions].join(", ")} is in bun.lock but not in package-lock.json`);
		continue;
	}
	for (const version of versions) {
		if (!npmSet.has(version)) {
			problems.push(`${name}@${version} is in bun.lock but package-lock.json resolves ${[...npmSet].join(", ")}`);
		}
	}
}
for (const [name, versions] of npm) {
	if (!bun.has(name)) {
		problems.push(`${name}@${[...versions].join(", ")} is in package-lock.json but not in bun.lock`);
	}
}

if (problems.length > 0) {
	console.error("bun.lock and package-lock.json disagree:");
	for (const problem of problems) console.error(`  ${problem}`);
	console.error("\nRegenerate bun.lock from package-lock.json: bun pm migrate");
	process.exit(1);
}

console.log(`bun.lock and package-lock.json agree on ${bun.size} packages.`);
