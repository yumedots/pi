#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installConsumer, packageConsumerDirectoryName, smokeTestNpmConsumer } from "./local-package-install.mjs";
import { produceArtifactSet } from "./package-artifacts.mjs";
import { codingAgentName, smokeTestCodingAgent } from "./coding-agent-smoke.mjs";
import { clientName, smokeTestClient } from "./client-smoke.mjs";

/**
 * The `pi` binary belongs to the client package.
 *
 * The coding agent is the runtime the client depends on, so it must not ship a `pi`
 * binary of its own: two packages with the same binary name fight over the PATH.
 */
function assertBinaryOwnership(directory, packageName) {
	const manifest = JSON.parse(
		readFileSync(join(directory, "node_modules", ...packageName.split("/"), "package.json"), "utf8"),
	);
	const bins = typeof manifest.bin === "string" ? { [packageName.split("/").at(-1)]: manifest.bin } : (manifest.bin ?? {});
	if (packageName === clientName) {
		if (!bins.pi) throw new Error(`${clientName} must ship the pi binary`);
		return;
	}
	if (bins.pi) throw new Error(`${packageName} must not ship the pi binary; ${clientName} owns it`);
}

const root = mkdtempSync(join(tmpdir(), "pi-package-install-"));
try {
	const artifactSet = produceArtifactSet({ build: false, outDir: join(root, "artifacts"), repoRoot: process.cwd() });
	for (const pkg of artifactSet.packages) {
		const directory = join(root, "consumers", packageConsumerDirectoryName(pkg.name));
		installConsumer({ artifactSet, directory, packageNames: [pkg.name] });
		smokeTestNpmConsumer({ artifactSet, directory, packageName: pkg.name });
		if (pkg.name === codingAgentName) smokeTestCodingAgent(directory);
		if (pkg.name === clientName) smokeTestClient(directory);
		assertBinaryOwnership(directory, pkg.name);
	}
	console.log(`Verified ${artifactSet.packages.length} isolated package consumers.`);
} finally {
	rmSync(root, { force: true, recursive: true });
}
