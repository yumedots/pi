#!/usr/bin/env node
import { execFileSync } from "node:child_process";

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { installConsumer, packageConsumerDirectoryName, smokeTestNpmConsumer } from "./local-package-install.mjs";
import { produceArtifactSet } from "./package-artifacts.mjs";
import { smokeTestCodingAgent } from "./coding-agent-smoke.mjs";
import { clientName, smokeTestClient } from "./client-smoke.mjs";
import { execBunSync } from "./npm-command.mjs";

function printUsage() {
	console.log(`Usage: node scripts/local-release.mjs [options]

Builds and packs the publishable packages, then installs the tarballs into
isolated directories outside the repository for local release testing.

Options:
  --out <dir>          Output directory. Defaults to a new directory under ${tmpdir()}
  --force              Remove --out first if it already exists
  --skip-check         Do not run bun run check before building
  --skip-test          Do not run ./scripts/test.sh after building
  --skip-install       Only create the artifact set; do not create isolated installs
  --skip-bun-install   Do not create the isolated Bun install
  --help               Show this help
`);
}

function currentBinaryPlatform() {
	if (process.platform === "win32") return process.arch === "arm64" ? "windows-arm64" : "windows-x64";
	if (process.platform === "darwin") return process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
	if (process.platform === "linux") return process.arch === "arm64" ? "linux-arm64" : "linux-x64";
	throw new Error(`Unsupported binary platform: ${process.platform} ${process.arch}`);
}

function buildBunBinaryRelease(targetDirectory, archiveDirectory, repoRoot) {
	const platform = currentBinaryPlatform();
	// The `pi` binary ships with the client package; the coding agent is the runtime it drives.
	execBunSync(["run", "--filter", clientName, "build:binary"], { cwd: repoRoot, stdio: "inherit" });
	const buildDirectory = join(repoRoot, "packages", "client", "dist", "binary");
	rmSync(targetDirectory, { force: true, recursive: true });
	cpSync(buildDirectory, targetDirectory, { recursive: true });
	// The release ships the documentation of the runtime next to the binary. The system
	// prompt points the model at the README next to the executable, so it has to be there.
	for (const extra of ["README.md", "CHANGELOG.md", "docs", "examples"]) {
		const source = join(repoRoot, "packages", "coding-agent", extra);
		if (existsSync(source)) cpSync(source, join(targetDirectory, extra), { recursive: true });
	}
	const archiveName = platform.startsWith("windows-") ? `pi-${platform}.zip` : `pi-${platform}.tar.gz`;
	const archivePath = join(archiveDirectory, archiveName);
	rmSync(archivePath, { force: true });
	if (platform.startsWith("windows-")) {
		execFileSync("zip", ["-r", archivePath, "."], { cwd: targetDirectory, stdio: "inherit" });
	} else {
		// The archive carries a wrapper directory, so that mise and other version
		// managers find the binary in a directory they can track.
		const wrapper = join(archiveDirectory, "pi");
		rmSync(wrapper, { force: true, recursive: true });
		cpSync(targetDirectory, wrapper, { recursive: true });
		execFileSync("tar", ["-czf", archivePath, "-C", archiveDirectory, "pi"], { stdio: "inherit" });
		rmSync(wrapper, { force: true, recursive: true });
	}
	return platform;
}

function createPiShim(installDirectory) {
	const binDirectory = join(installDirectory, "node_modules", ".bin");
	if (process.platform === "win32") {
		if (existsSync(join(binDirectory, "pi.cmd"))) {
			writeFileSync(join(installDirectory, "pi.cmd"), '@ECHO off\r\n"%~dp0node_modules\\.bin\\pi.cmd" %*\r\n');
			writeFileSync(join(installDirectory, "pi.ps1"), '& "$PSScriptRoot/node_modules/.bin/pi.ps1" @args\n');
			return;
		}
		writeFileSync(join(installDirectory, "pi.cmd"), '@ECHO off\r\n"%~dp0node_modules\\.bin\\pi.exe" %*\r\n');
		writeFileSync(join(installDirectory, "pi.ps1"), '& "$PSScriptRoot/node_modules/.bin/pi.exe" @args\n');
		return;
	}
	symlinkSync(join("node_modules", ".bin", "pi"), join(installDirectory, "pi"));
}

const { values } = parseArgs({
	options: {
		force: { type: "boolean", default: false },
		help: { type: "boolean", default: false },
		out: { type: "string" },
		"skip-bun-install": { type: "boolean", default: false },
		"skip-check": { type: "boolean", default: false },
		"skip-install": { type: "boolean", default: false },
		"skip-test": { type: "boolean", default: false },
	},
});
if (values.help) {
	printUsage();
	process.exit(0);
}
const options = {
	force: values.force,
	outDir: values.out,
	skipBunInstall: values["skip-bun-install"],
	skipCheck: values["skip-check"],
	skipInstall: values["skip-install"],
	skipTest: values["skip-test"],
};
const repoRoot = process.cwd();
const rootPackageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
if (rootPackageJson.name !== "pi-monorepo") throw new Error("Run this script from the repository root");

execBunSync(["run", "generate:models"], { cwd: repoRoot, stdio: "inherit" });
if (!options.skipCheck) execBunSync(["run", "check"], { cwd: repoRoot, stdio: "inherit" });

const artifactSet = produceArtifactSet({
	build: true,
	force: options.force,
	offlineModelData: true,
	outDir: options.outDir,
	repoRoot,
});
const outDir = artifactSet.artifactDirectory;
const binaryDirectory = join(outDir, "bun");
const nodeInstallDirectory = join(outDir, "node");
const bunInstallDirectory = join(outDir, "bun-install");

if (!options.skipTest) execFileSync("bash", ["./scripts/test.sh"], { cwd: repoRoot, stdio: "inherit" });

let binaryPlatform;
if (!options.skipInstall) {
	binaryPlatform = buildBunBinaryRelease(binaryDirectory, outDir, repoRoot);
	const validationRoot = mkdtempSync(join(tmpdir(), "pi-local-release-consumers-"));
	try {
		for (const pkg of artifactSet.packages) {
			const directory = pkg.name === clientName
				? nodeInstallDirectory
				: join(validationRoot, "npm", packageConsumerDirectoryName(pkg.name));
			installConsumer({ artifactSet, directory, packageNames: [pkg.name] });
			smokeTestNpmConsumer({ artifactSet, directory, packageName: pkg.name });
			if (pkg.name === codingAgentName) smokeTestCodingAgent(directory);
			if (pkg.name === clientName) {
				smokeTestClient(directory);
				smokeTestCodingAgent(directory);
			}
		}
		createPiShim(nodeInstallDirectory);

		if (!options.skipBunInstall) {
			installConsumer({ artifactSet, directory: bunInstallDirectory, packageManager: "bun", packageNames: [clientName] });
			smokeTestClient(bunInstallDirectory, "bun");
			smokeTestCodingAgent(bunInstallDirectory, "bun");
			createPiShim(bunInstallDirectory);
		}
	} finally {
		rmSync(validationRoot, { force: true, recursive: true });
	}
}

console.log(`\nLocal release artifacts created: ${outDir}`);
console.log(`Manifest: ${artifactSet.manifestPath}`);
console.log("\nTarballs:");
for (const pkg of artifactSet.packages) console.log(`  ${pkg.tarballPath}`);

if (!options.skipInstall) {
	console.log("\nLocal Bun binary release:");
	console.log(`  ${binaryDirectory}`);
	console.log(`  ${join(outDir, `pi-${binaryPlatform}.${String(binaryPlatform).startsWith("windows-") ? "zip" : "tar.gz"}`)}`);
	console.log("\nRun the local Bun binary release from outside the repository:");
	console.log(`  ${join(binaryDirectory, String(binaryPlatform).startsWith("windows-") ? "pi.exe" : "pi")} --help`);

	console.log("\nIsolated npm install:");
	console.log(`  ${nodeInstallDirectory}`);
	console.log("\nRun the locally packed npm CLI from outside the repository:");
	console.log(`  ${join(nodeInstallDirectory, process.platform === "win32" ? "pi.cmd" : "pi")} --help`);

	if (!options.skipBunInstall) {
		console.log("\nIsolated Bun package install:");
		console.log(`  ${bunInstallDirectory}`);
		console.log("\nRun the locally packed Bun package CLI from outside the repository:");
		console.log(`  ${join(bunInstallDirectory, process.platform === "win32" ? "pi.cmd" : "pi")} --help`);
	}
}
