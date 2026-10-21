#!/usr/bin/env node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installConsumer, packageConsumerDirectoryName, smokeTestNpmConsumer } from "./local-package-install.mjs";
import { produceArtifactSet } from "./package-artifacts.mjs";
import { codingAgentName, smokeTestCodingAgent } from "./coding-agent-smoke.mjs";
import { clientName, smokeTestClient } from "./client-smoke.mjs";

const root = mkdtempSync(join(tmpdir(), "pi-package-install-"));
try {
	const artifactSet = produceArtifactSet({ build: false, outDir: join(root, "artifacts"), repoRoot: process.cwd() });
	for (const pkg of artifactSet.packages) {
		const directory = join(root, "consumers", packageConsumerDirectoryName(pkg.name));
		installConsumer({ artifactSet, directory, packageNames: [pkg.name] });
		smokeTestNpmConsumer({ artifactSet, directory, packageName: pkg.name });
		if (pkg.name === codingAgentName) smokeTestCodingAgent(directory);
		if (pkg.name === clientName) smokeTestClient(directory);
	}
	console.log(`Verified ${artifactSet.packages.length} isolated package consumers.`);
} finally {
	rmSync(root, { force: true, recursive: true });
}
